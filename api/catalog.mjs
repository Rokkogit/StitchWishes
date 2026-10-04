// GET -> { products } for the storefront. Public, no authentication.
//
// Only visible pieces are returned. Hiding happens here rather than in the
// browser, so a hidden piece is never delivered to a visitor at all.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readStore } from '../lib/global-config.mjs';
import { DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { validateContent } from '../lib/content.mjs';
import { themeVars, validateTheme } from '../lib/theme.mjs';
import { visibleProducts } from '../lib/catalog.mjs';
import { readyCatalog } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';

// Global Config takes up to ten seconds to propagate a write, so caching for
// ten adds no delay anyone can perceive while removing nearly every function
// invocation. stale-while-revalidate keeps the page fast during the refresh.
const CACHE = 'public, s-maxage=10, stale-while-revalidate=59';

export default {
  async fetch(request) {
    if (request.method !== 'GET') return methodNotAllowed('GET');

    const result = await readStore(process.env);

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
    const products = readyCatalog(result.products, SEED);

    return json(
      200,
      {
        products: visibleProducts(products),
        // The shipping figure goes out with the catalog so the product page can
        // state it before anyone reaches the bag. A surprise at checkout is the
        // most common reason a bag is abandoned, and a number printed on a page
        // has to be the real one - hardcoding it would start lying the first
        // time it was changed in the admin panel.
        shipping: (result.settings ?? DEFAULT_SETTINGS).shipping,
        // The site's own words. Sent with the catalog rather than on a route of
        // their own: every page that wants them is already making this call,
        // and a second request would be a second chance to be slow.
        content: validateContent(result.content).value,
        // Computed on the server rather than in the page: the browser gets
        // finished values to set, and never has to know what a preset is.
        theme: (() => {
          const theme = validateContent(result.content).value.theme;
          return { vars: themeVars(theme), sections: validateTheme(theme).value.sections };
        })(),
      },
      { 'Cache-Control': CACHE }
    );
  },
};
