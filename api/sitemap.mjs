// GET /sitemap.xml -> every page worth indexing, built from the live catalog.
//
// Served by a function rather than committed as a file for the same reason the
// product pages are: pieces are added and hidden in the admin panel without a
// deployment, so a file written at build time would stop matching the shop the
// first time anything changed. This cannot go out of date.

import { readCatalog } from '../lib/global-config.mjs';
import { visibleProducts } from '../lib/catalog.mjs';
import { SEED } from '../lib/catalog-seed.mjs';
import { sitemapXml } from '../lib/page-meta.mjs';

// An hour. A crawler does not come back within ten seconds, and there is no
// reason to run a function for every polite robot on the internet.
const CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

function originOf(request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (host) return `${proto}://${host}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Use GET.', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const result = await readCatalog(process.env);

    // The bundled copy rather than an empty sitemap. Submitting a sitemap that
    // lists nothing is a way to tell a crawler the shop has no products.
    const products =
      result.ok && result.seeded ? visibleProducts(result.products) : visibleProducts(SEED);

    return new Response(sitemapXml(products, originOf(request)), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': CACHE,
      },
    });
  },
};
