// Postage built into the prices, which is what the shop runs.
//
// The money has to agree in four places at once - what a price reads on the
// site, what the bag totals up, what Stripe is told to charge, and what the
// order email says. A shop that shows $18.99 and bills $12.99 is a bug nobody
// notices until a card statement, so the agreement is asserted rather than
// assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  validateSettings,
  orderTotal,
  shippingIncluded,
  includedShipping,
  shippingIsFree,
} from '../lib/settings.mjs';
import { withShippingInPrices, shopCatalog } from '../lib/pricing.mjs';
import { resolveCart } from '../lib/cart.mjs';
import { checkedSessionParams, stripeTotalCents } from '../lib/checkout.mjs';
import { orderEmail } from '../lib/notify.mjs';
import { SEED } from '../lib/catalog-seed.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const INCLUDED = {
  shipping: { label: 'Shipping', amount: 6, enabled: true, includedInPrices: true },
  fees: [],
  tax: { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false },
};

const CHARGED = {
  ...INCLUDED,
  shipping: { ...INCLUDED.shipping, includedInPrices: false },
};

const pen = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded pen',
  price: 12.99,
  images: ['assets/pen.jpg'],
  ...over,
});

/* ------------------------------------------------------------ the setting */

test('postage is built into the prices unless somebody says otherwise', () => {
  // Settings saved before this existed cannot carry the key. Reading absent as
  // "charge it separately" would leave a postage line on the shop until the
  // switch was found.
  assert.equal(shippingIncluded({ shipping: { amount: 6, enabled: true } }), true);
  assert.equal(includedShipping({ shipping: { amount: 6, enabled: true } }), 6);

  assert.equal(shippingIncluded(CHARGED), false);
  assert.equal(includedShipping(CHARGED), 0);
});

test('the default settings absorb postage', () => {
  assert.equal(shippingIncluded(DEFAULT_SETTINGS), true);
  assert.equal(shippingIncluded(null), true);
  assert.equal(includedShipping(null), 6);
});

test('switching shipping off absorbs nothing and is still free', () => {
  const off = { ...INCLUDED, shipping: { label: 'Shipping', amount: 6, enabled: false } };

  assert.equal(includedShipping(off), 0, 'a price was raised for postage nobody charges');
  assert.equal(shippingIsFree(off), true);
});

test('free shipping means free in both modes that are free, and not in the third', () => {
  assert.equal(shippingIsFree(INCLUDED), true);
  assert.equal(shippingIsFree(CHARGED), false);
  assert.equal(shippingIsFree({ shipping: { amount: 0, enabled: true } }), true);
});

test('the setting survives a save, in both directions', () => {
  // validateSettings builds its result from known keys, so a field it does not
  // know about is dropped the first time anything is saved in the panel.
  assert.equal(validateSettings(INCLUDED).value.shipping.includedInPrices, true);
  assert.equal(validateSettings(CHARGED).value.shipping.includedInPrices, false);
});

/* -------------------------------------------------------------- the price */

test('a price carries the postage', () => {
  const [piece] = withShippingInPrices([pen()], INCLUDED);

  assert.equal(piece.price, 18.99);
});

test('the stored price is never touched', () => {
  // The whole reason the amount can be changed in the panel: no price was ever
  // rewritten, so there is nothing to unpick when it changes.
  const stored = pen();
  withShippingInPrices([stored], INCLUDED);

  assert.equal(stored.price, 12.99);
});

test('changing the amount changes every price, with nothing to migrate', () => {
  const seven = { ...INCLUDED, shipping: { ...INCLUDED.shipping, amount: 7 } };

  assert.equal(withShippingInPrices([pen()], INCLUDED)[0].price, 18.99);
  assert.equal(withShippingInPrices([pen()], seven)[0].price, 19.99);
});

test('nothing is added when postage is charged separately', () => {
  assert.equal(withShippingInPrices([pen()], CHARGED)[0].price, 12.99);
});

test('a piece with no price does not become a piece that costs the postage', () => {
  // No price means not for sale yet. $6.00 would put it on sale.
  for (const nothing of [null, undefined]) {
    const [piece] = withShippingInPrices([pen({ price: nothing })], INCLUDED);
    assert.equal(piece.price ?? null, null, String(nothing));
  }
});

test('a design with its own price carries the postage too', () => {
  const [piece] = withShippingInPrices(
    [
      pen({
        designs: {
          label: 'Design',
          options: [
            { id: 'd1', name: 'One', image: 'a.jpg', price: 15 },
            { id: 'd2', name: 'Two', image: 'b.jpg' },
          ],
        },
      }),
    ],
    INCLUDED
  );

  assert.equal(piece.designs.options[0].price, 21);
  // A design with no price of its own inherits the piece's, which has already
  // been lifted. Lifting a null here would invent a price for it.
  assert.equal(piece.designs.options[1].price ?? null, null);
  assert.equal(piece.price, 18.99);
});

test('the arithmetic is done in cents', () => {
  // 12.99 + 6 is 18.990000000000002 in floating point, and that number would
  // travel all the way to a Stripe line item.
  const [piece] = withShippingInPrices([pen({ price: 12.99 })], INCLUDED);

  assert.equal(piece.price, 18.99);
  assert.equal(String(piece.price), '18.99');
});

test('every piece in the real catalog is lifted by exactly the postage', () => {
  const lifted = shopCatalog(SEED, SEED, INCLUDED);

  for (const [i, piece] of lifted.entries()) {
    if (SEED[i].price == null) continue;
    assert.equal(
      Math.round(piece.price * 100) - Math.round(SEED[i].price * 100),
      600,
      `${piece.handle} is out`
    );
  }
});

/* --------------------------------------------------------------- the bag */

test('the bag charges nothing for postage and says so', () => {
  const totals = orderTotal([{ price: 18.99, quantity: 1 }], INCLUDED);

  assert.equal(totals.shipping, 0);
  assert.equal(totals.total, 18.99);

  const line = totals.lines.find((entry) => entry.free);
  assert.ok(line, 'nothing in the bag tells a customer postage is free');
  assert.equal(line.amount, 0);
});

test('the free line is drawn even though it is worth nothing', () => {
  // A total with no shipping row at all leaves a customer waiting for postage
  // to be added. Saying "Shipping - Free" is the entire point of absorbing it.
  assert.equal(orderTotal([{ price: 10, quantity: 1 }], INCLUDED).lines.length, 1);
});

test('an empty bag is still empty, not a free postage line on nothing', () => {
  assert.deepEqual(orderTotal([], INCLUDED).lines, []);
  assert.equal(orderTotal([], INCLUDED).total, 0);
});

test('two pieces are two prices, each carrying postage', () => {
  // Stated plainly because it is the trade in this approach: postage is
  // absorbed per piece, so a second piece carries it again.
  const totals = orderTotal([{ price: 18.99, quantity: 2 }], INCLUDED);

  assert.equal(totals.total, 37.98);
  assert.equal(totals.shipping, 0);
});

/* ------------------------------------------------------------ the charge */

test('what Stripe is told to charge is what the bag showed', () => {
  const catalog = withShippingInPrices([pen()], INCLUDED);
  const { items } = resolveCart([{ handle: 'beaded-pen', quantity: 1 }], catalog);
  const totals = orderTotal(items, INCLUDED);

  const checked = checkedSessionParams({
    items,
    totals,
    settings: INCLUDED,
    origin: 'https://shop.example',
    reference: 'SW-1',
  });

  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.cents, 1899);
  assert.equal(stripeTotalCents(checked.params), 1899);
});

test('Stripe is sent no shipping option at all', () => {
  const totals = orderTotal([{ price: 18.99, quantity: 1 }], INCLUDED);

  const checked = checkedSessionParams({
    items: [{ handle: 'beaded-pen', title: 'Beaded pen', price: 18.99, quantity: 1 }],
    totals,
    settings: INCLUDED,
    origin: 'https://shop.example',
  });

  assert.equal(checked.ok, true);
  assert.equal(checked.params.shipping_options, undefined);
  // The postage is inside the one line item, not beside it.
  assert.equal(checked.params.line_items.length, 1);
  assert.equal(checked.params.line_items[0].price_data.unit_amount, 1899);
});

test('an awkward price still agrees to the cent across three of them', () => {
  const catalog = withShippingInPrices([pen({ price: 13.33 })], INCLUDED);
  const { items } = resolveCart([{ handle: 'beaded-pen', quantity: 3 }], catalog);
  const totals = orderTotal(items, INCLUDED);

  const checked = checkedSessionParams({
    items,
    totals,
    settings: INCLUDED,
    origin: 'https://shop.example',
  });

  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.cents, 5799);
});

/* ------------------------------------------------------------- the email */

test('the order email says Free rather than $0.00', () => {
  const items = [{ title: 'Beaded pen', handle: 'beaded-pen', price: 18.99, quantity: 1 }];

  const { text, html } = orderEmail({
    reference: 'SW-1',
    items,
    totals: orderTotal(items, INCLUDED),
    customer: { name: 'Jane', email: 'jane@example.com' },
  });

  assert.match(text, /Shipping\s+Free/);
  assert.ok(!text.includes('$0.00'), text);
  assert.match(html, /Free/);
});

/* ---------------------------------------------------------- what the pages say */

test('no page still promises a postage line', () => {
  // The pages someone reads to find out what they will be charged are the
  // worst place in the shop to be out of date.
  const dir = new URL('../stitch-wishes-2050/', import.meta.url);

  for (const name of readdirSync(dir).filter((file) => file.endsWith('.html'))) {
    const page = readFileSync(new URL(name, dir), 'utf8');

    assert.ok(
      !/Shipping is charged once per order/i.test(page),
      `${name} still says postage is charged`
    );
    assert.ok(
      !/Postage is added as its own line/i.test(page),
      `${name} still says postage is added at the end`
    );
  }
});

test('the pages that make a promise about postage can be corrected', () => {
  // They carry the free-shipping wording in their own markup, so they read
  // correctly with no scripts and to a crawler. The hook is what lets main.js
  // put them right if the Checkout tab is ever switched back.
  const dir = new URL('../stitch-wishes-2050/', import.meta.url);

  for (const name of ['policies.html', 'terms.html']) {
    const page = readFileSync(new URL(name, dir), 'utf8');

    assert.match(page, /data-postage/, `${name} cannot be corrected`);
    assert.match(page, /free|include/i, `${name} does not mention free shipping`);
  }
});
