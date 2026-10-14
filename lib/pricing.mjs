// Pricing an order, start to finish.
//
// One function, used by both the bag's quote and the checkout. They used to do
// the steps themselves, which was fine while there were three; with sales and
// discounts there are five, and two copies of five steps is how a bag ends up
// showing one total while Stripe charges another.
//
// The checkout's own mismatch check would catch that - by refusing the payment
// outright - but it should never have to. That check is a seatbelt, not a
// method.
//
// The order of the steps is the whole point and is not interchangeable:
//
//   1. the stored catalog, with the fixes applied on the way out
//   2. today's sale prices, so a sale IS the price from here on
//   3. only what is actually on sale, hidden pieces removed
//   4. the bag resolved against that: real prices, real stock, real designs
//   5. discounts worked out from those resolved lines
//   6. totals, with the discounts taken off the pieces and tax on what is left
//
// Sales come before the cart is resolved because a sale changes what a piece
// costs; discounts come after because they are worked out from what the order
// came to.

import { readyCatalog } from './seed.mjs';
import { visibleProducts } from './catalog.mjs';
import { resolveCart } from './cart.mjs';
import { applySales, orderDiscounts } from './promotions.mjs';
import { orderTotal, DEFAULT_SETTINGS } from './settings.mjs';

/* The catalog as it is selling at this moment.

   What /api/catalog serves and what a bag is priced against are the same
   thing, deliberately: a price shown on a page is the price in the bag. */
export function sellingCatalog(products, seed, settings, now = Date.now()) {
  const ready = readyCatalog(products, seed);

  return applySales(ready, settings?.promotions ?? [], now);
}

/* A bag, priced.

   Everything a caller needs to show the order or to charge for it, worked out
   once. `code` is whatever the customer typed in the bag, or nothing. */
export function priceOrder({ cart, products, seed, settings, code, usage, now = Date.now() } = {}) {
  const config = settings ?? DEFAULT_SETTINGS;

  const selling = visibleProducts(sellingCatalog(products, seed, config, now));
  const { items, problems } = resolveCart(cart, selling);

  const discounts = orderDiscounts({
    items,
    products: selling,
    promotions: config.promotions ?? [],
    code,
    now,
    usage: usage ?? {},
  });

  const totals = orderTotal(items, config, discounts);

  return {
    items,
    problems,
    totals,
    // Which code was actually applied, and why one was not. A customer who
    // typed a code and sees no change assumes the shop is broken, so the
    // reason travels with the quote rather than being swallowed.
    code: discounts.code,
    codeProblem: discounts.codeProblem,
    discounts,
    catalog: selling,
  };
}
