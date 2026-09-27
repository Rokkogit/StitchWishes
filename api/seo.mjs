// /robots.txt and /sitemap.xml, both served here through rewrites.
//
// One function rather than two, to stay within the twelve a Hobby deployment
// allows. The logic is in lib/seo.mjs.

import { handle } from '../lib/seo.mjs';

export default {
  fetch: (request) => handle(request),
};
