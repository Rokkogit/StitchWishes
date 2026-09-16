// POST -> clears the session cookie.
//
// Sessions are stateless, so there is no server-side record to delete. Logging
// out means overwriting the cookie with an already-expired one. A token the
// browser has thrown away is gone as far as it is concerned; anything that
// still holds a copy stays valid until it expires, which is what rotating
// ADMIN_SESSION_SECRET is for.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { clearCookie } from '../lib/session.mjs';

export default {
  async fetch(request) {
    if (request.method !== 'POST') return methodNotAllowed('POST');

    return json(200, { ok: true }, { 'Set-Cookie': clearCookie() });
  },
};
