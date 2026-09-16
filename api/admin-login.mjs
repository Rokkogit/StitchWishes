// POST { code } -> a session cookie, if the code is right.
//
// This is the only place the admin passphrase is ever compared. It lives in an
// environment variable and never leaves the server — the browser sends a
// guess, and gets back a yes or a no.

import { json, methodNotAllowed, sleep } from '../lib/http.mjs';
import {
  readConfig,
  checkCode,
  createToken,
  sessionCookie,
  SESSION_TTL_MS,
} from '../lib/session.mjs';

// Defense in depth, and honestly not much more than that: serverless instances
// do not share memory, so this cannot add up to real rate limiting across a
// distributed attack. The passphrase length minimum is the actual control.
const ATTEMPT_DELAY_MS = 250;

export default {
  async fetch(request) {
    if (request.method !== 'POST') return methodNotAllowed('POST');

    const config = readConfig(process.env);
    if (!config.ok) {
      // The reason describes our deployment, so it goes to the log, never to
      // the response.
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

    // Applied to success and failure alike, so the delay itself reveals
    // nothing about whether the guess was close.
    await sleep(ATTEMPT_DELAY_MS);

    if (!checkCode(body.code, config.code)) {
      return json(401, { error: 'That code did not match.' });
    }

    const token = createToken(config.secret, SESSION_TTL_MS);

    return json(
      200,
      { ok: true },
      { 'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / 1000) }
    );
  },
};
