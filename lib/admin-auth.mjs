// Signing in, signing out, and asking whether you are signed in.
//
// These were three files in api/, which is three of the twelve Serverless
// Functions a Hobby deployment is allowed. They are one function now, dispatched
// by a rewrite, so the URLs the admin page calls have not changed. The logic is
// unchanged from when it lived in three route files.

import { json, methodNotAllowed, sleep } from '../lib/http.mjs';
import {
  readConfig,
  checkCode,
  createToken,
  verifyToken,
  readCookie,
  sessionCookie,
  clearCookie,
  COOKIE_NAME,
  SESSION_TTL_MS,
} from '../lib/session.mjs';

// Defense in depth, and honestly not much more than that: serverless instances
// do not share memory, so this cannot add up to real rate limiting across a
// distributed attack. The passphrase length minimum is the actual control.
const ATTEMPT_DELAY_MS = 250;

/* -------------------------------------------------------------------- login */

// The only place the admin passphrase is ever compared. It lives in an
// environment variable and never leaves the server — the browser sends a guess
// and gets back a yes or a no.
export async function login(request) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const config = readConfig(process.env);
  if (!config.ok) {
    // The reason describes our deployment, so it goes to the log, never to the
    // response.
    console.error(`[admin-login] refusing all logins: ${config.reason}`);
    return json(503, { error: 'Admin login is not configured yet.' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Expected a JSON body.' });
  }

  if (typeof body?.code !== 'string') {
    return json(400, { error: 'Expected a code.' });
  }

  // Applied to success and failure alike, so the delay itself reveals nothing
  // about whether the guess was close.
  await sleep(ATTEMPT_DELAY_MS);

  if (!checkCode(body.code, config.code)) {
    return json(401, { error: 'That code did not match.' });
  }

  const token = createToken(config.secret, SESSION_TTL_MS);

  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / 1000) });
}

/* ------------------------------------------------------------------- logout */

// Sessions are stateless, so there is no server-side record to delete. Logging
// out means overwriting the cookie with an already-expired one. A token the
// browser has thrown away is gone as far as it is concerned; anything that still
// holds a copy stays valid until it expires, which is what rotating
// ADMIN_SESSION_SECRET is for.
export async function logout(request) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  return json(200, { ok: true }, { 'Set-Cookie': clearCookie() });
}

/* ------------------------------------------------------------------ session */

const ANONYMOUS = { authed: false };

// The session cookie is HttpOnly, so the page cannot read it. Asking here is the
// only way the browser can find out whether it is signed in.
export async function session(request) {
  if (request.method !== 'GET') return methodNotAllowed('GET');

  // 200 rather than 401: "am I signed in?" is a fair question for a signed-out
  // visitor, and the honest answer is "no", not "refused".
  const config = readConfig(process.env);
  if (!config.ok) {
    console.error(`[admin-session] not configured: ${config.reason}`);
    return json(200, ANONYMOUS);
  }

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return json(200, ANONYMOUS);

  const result = verifyToken(config.secret, token);
  if (!result.valid) return json(200, ANONYMOUS);

  return json(200, { authed: true, exp: result.exp });
}

/* ----------------------------------------------------------------- dispatch */

// Which action to run is read from the path as well as the query, so a direct
// call to the function still works if a rewrite is ever missing.
export function actionFor(request) {
  const url = new URL(request.url, 'https://placeholder.invalid');

  const fromQuery = url.searchParams.get('action');
  if (fromQuery) return fromQuery;

  const match = url.pathname.match(/admin-(login|logout|session)/);
  return match ? match[1] : null;
}

export async function handle(request) {
  switch (actionFor(request)) {
    case 'login':
      return login(request);
    case 'logout':
      return logout(request);
    case 'session':
      return session(request);
    default:
      return json(404, { error: 'Unknown action.' });
  }
}
