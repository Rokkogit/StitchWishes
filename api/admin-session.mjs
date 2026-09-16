// GET -> { authed: true | false }
//
// The session cookie is HttpOnly, so the page cannot read it. Asking here is
// the only way the browser can find out whether it is signed in.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readConfig, verifyToken, readCookie, COOKIE_NAME } from '../lib/session.mjs';

const ANONYMOUS = { authed: false };

export default {
  async fetch(request) {
    if (request.method !== 'GET') return methodNotAllowed('GET');

    // 200 rather than 401: "am I signed in?" is a fair question for a
    // signed-out visitor, and the honest answer is "no", not "refused".
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
  },
};
