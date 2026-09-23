// GET -> { products } for the storefront. Public, no authentication.
//
// Only visible pieces are returned. Hiding happens here rather than in the
// browser, so a hidden piece is never delivered to a visitor at all.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readCatalog } from '../lib/global-config.mjs';
import { visibleProducts } from '../lib/catalog.mjs';
import { fillMissingDesigns } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';

// Global Config takes up to ten seconds to propagate a write, so caching for
// ten adds no delay anyone can perceive while removing nearly every function
// invocation. stale-while-revalidate keeps the page fast during the refresh.
const CACHE = 'public, s-maxage=10, stale-while-revalidate=59';

export default {
  async fetch(request) {
    if (request.method !== 'GET') return methodNotAllowed('GET');

    const result = await readCatalog(process.env);

    if (!result.ok) {
      // The storefront keeps a bundled copy and falls back to it. Saying so
      // plainly beats returning an empty catalog, which would look like a shop
      // with nothing in it.
      console.error(`[catalog] unavailable: ${result.reason ?? result.status}`);
      return json(503, { error: 'Catalog unavailable.', fallback: true });
    }

    // A store nobody has saved to yet is not an empty shop — it is a shop that
    // has not been moved in. Fall back rather than serving nothing.
    if (!result.seeded) {
      return json(503, { error: 'Catalog not set up yet.', fallback: true });
    }

    // A catalog stored before designs existed gets them from the shipped
    // copy. Applied here rather than in the page, so /api/quote sees exactly
    // the same catalog — otherwise the shop would offer a design the checkout
    // would then refuse.
    const products = fillMissingDesigns(result.products, SEED);

    return json(200, { products: visibleProducts(products) }, { 'Cache-Control': CACHE });
  },
};
