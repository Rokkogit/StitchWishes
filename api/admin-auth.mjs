// /api/admin-login, /api/admin-logout and /api/admin-session, all served here.
//
// Three routes, one function. A Hobby deployment allows twelve Serverless
// Functions and api/ had grown to thirteen, which fails the build outright
// rather than degrading. The three URLs are unchanged: rewrites in vercel.json
// point them here, so nothing in the admin page needed touching.

import { handle } from '../lib/admin-auth.mjs';

export default {
  fetch: (request) => handle(request),
};
