// POST a cart -> what it actually costs.
//
// Public, because the cart page needs it before anyone has identified
// themselves. It reveals nothing a visitor cannot already see by browsing.
//
// The point of this endpoint is that the browser never does arithmetic on
// money. It sends which pieces and how many; everything else — prices,
// availability, shipping, fees, the total — is decided here from the stored
// catalog and settings. What a customer is shown is therefore the same number
// the Checkout session will be built from, and there is no second copy of the
// maths to drift.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readStore } from '../lib/global-config.mjs';
import { priceOrder } from '../lib/pricing.mjs';
import { SEED } from '../lib/catalog-seed.mjs';
import { DEFAULT_SETTINGS } from '../lib/settings.mjs';

export default {
  async fetch(request) {
    if (request.method !== 'POST') return methodNotAllowed('POST');

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'Expected a JSON body.' });
    }

    const store = await readStore(process.env);
    if (!store.ok) {
      console.error(`[quote] store unreachable: ${store.reason ?? store.status}`);
      return json(503, { error: 'The shop is briefly unavailable. Try again in a moment.' });
    }

    // One pricing path, shared with the checkout, so the bag and the charge
    // cannot drift apart. Sales, the cart, discounts and totals in that order.
    const { items, problems, totals, code, codeProblem } = priceOrder({
      cart: body?.cart,
      products: store.products,
      seed: SEED,
      settings: store.settings ?? DEFAULT_SETTINGS,
      code: body?.code,
      usage: store.promotionUsage,
    });

    return json(
      200,
      {
        items,
        // Anything removed or reduced, so the page can say why rather than
        // silently showing a smaller cart than the one that was there.
        problems,
        subtotal: totals.subtotal,
        tax: totals.tax,
        shipping: totals.shipping,
        fees: totals.fees,
        discount: totals.discount,
        total: totals.total,
        lines: totals.lines,
        // Which code was applied, and why one was not. A customer who typed a
        // code and sees no change assumes the shop is broken.
        code,
        codeProblem,
      },
      { 'Cache-Control': 'no-store' }
    );
  },
};
