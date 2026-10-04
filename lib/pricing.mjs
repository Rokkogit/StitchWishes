// Postage, built into the prices.
//
// The shop charges nothing for shipping. The cost is real, so it is carried by
// the prices instead: every piece shows its stored price plus the shipping
// amount, and the customer is told shipping is free. Both halves are true.
//
// The stored price is never touched. It stays what Abi typed - what she earns
// on the piece - and the figure the site shows is worked out from it on every
// read. That is what makes the amount a setting rather than a migration: she
// changes $6 to $7 in the Checkout tab and every price on the site moves,
// because no price anywhere was ever rewritten.
//
// It also means this is reversible. Switch it off and the prices are the
// prices again, with nothing to unpick.
//
// Applied on the way out to the public, which is every path except the admin
// catalog - that one edits the stored price, and showing an inflated figure in
// the box someone types into is how $6 gets added twice.

import { readyCatalog } from './seed.mjs';
import { includedShipping } from './settings.mjs';

// Through cents, because 12.99 + 6 is 18.990000000000002 in floating point and
// that number would travel all the way to a Stripe line item.
const cents = (value) => Math.round(Number(value) * 100);

function liftPrice(price, addCents) {
  // A piece with no price is not for sale yet. It must not become a piece that
  // costs exactly the postage.
  if (price == null || price === '') return price;

  const base = cents(price);
  if (!Number.isFinite(base)) return price;

  return Math.round(base + addCents) / 100;
}

export function withShippingInPrices(products, settings) {
  const list = Array.isArray(products) ? products : [];

  const add = cents(includedShipping(settings));
  if (!add) return list;

  return list.map((piece) => {
    if (!piece || typeof piece !== 'object') return piece;

    const lifted = { ...piece, price: liftPrice(piece.price, add) };

    // A design can carry its own price, and that is the one charged when it is
    // chosen. A design with no price of its own inherits the piece's, which has
    // already been lifted above - lifting a null here would invent a price for
    // it.
    const options = piece.designs?.options;
    if (Array.isArray(options) && options.length) {
      lifted.designs = {
        ...piece.designs,
        options: options.map((option) =>
          option && option.price != null
            ? { ...option, price: liftPrice(option.price, add) }
            : option
        ),
      };
    }

    return lifted;
  });
}

// What every public route reads: the stored catalog, with the fixes that are
// applied on the way out of the store, priced the way the site shows it.
//
// One function so that a route cannot get half of it. A page showing the price
// with postage in it while checkout works from the price without would be a
// shop that quotes one number and bills another.
export function shopCatalog(products, seed, settings) {
  return withShippingInPrices(readyCatalog(products, seed), settings);
}
