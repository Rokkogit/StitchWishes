// Free shipping, and the switch that turns the postage charge back on.
//
// The catalog's prices were set with postage already inside them. So nothing is
// added to a price anywhere - there is deliberately no code that lifts one -
// and nothing is charged for postage at the end. The shop says shipping is
// free, which is true.
//
// Switching it off turns the stored amount back into a charge. These tests
// exist because that is a money setting: what the bag totals, what Stripe is
// told, and what the pages say all have to follow it together, or the shop says
// one thing and bills another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  DEFAULT_SETTINGS,
  validateSettings,
  orderTotal,
  shippingIncluded,
  shippingIsFree,
} from '../lib/settings.mjs';
import { readyCatalog } from '../lib/seed.mjs';
import { resolveCart } from '../lib/cart.mjs';
import { checkedSessionParams, stripeTotalCents } from '../lib/checkout.mjs';
import { orderEmail } from '../lib/notify.mjs';
import { SEED } from '../lib/catalog-seed.mjs';

const FREE = {
  shipping: { label: 'Shipping', amount: 6, enabled: true, includedInPrices: true },
  fees: [],
  tax: { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false },
};

const CHARGED = {
  ...FREE,
  shipping: { ...FREE.shipping, includedInPrices: false },
};

const pen = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded pen',
  price: 12.99,
  images: ['assets/pen.jpg'],
  ...over,
});

/* ------------------------------------------------------------- the prices */

test('a price is what was typed, and nothing is added to it', () => {
  // The correction this file was rewritten for. The catalog's prices already
  // carry postage, so adding the shipping amount on top charged for it twice.
  // Nothing lifts a price now, in any mode.
  for (const settings of [FREE, CHARGED, DEFAULT_SETTINGS, null]) {
    const catalog = readyCatalog([pen()], []);
    const { items } = resolveCart([{ handle: 'beaded-pen', quantity: 1 }], catalog);

    assert.equal(items[0].price, 12.99, JSON.stringify(settings?.shipping ?? null));
  }
});

test('the real catalog is priced exactly as it is stored', () => {
  const ready = readyCatalog(SEED, SEED);

  for (const [i, piece] of ready.entries()) {
    assert.equal(piece.price ?? null, SEED[i].price ?? null, `${piece.handle} was repriced`);
  }
});

/* ------------------------------------------------------------ the setting */

test('postage is treated as already in the prices unless somebody says otherwise', () => {
  // Settings saved before this existed cannot carry the key, and there is no
  // migration step that could add it. Reading absent as "charge separately"
  // would put a postage line back on the shop until the switch was found.
  assert.equal(shippingIncluded({ shipping: { amount: 6, enabled: true } }), true);
  assert.equal(shippingIncluded(CHARGED), false);
});

test('the default settings say shipping is free', () => {
  assert.equal(shippingIncluded(DEFAULT_SETTINGS), true);
  assert.equal(shippingIncluded(null), true);
  assert.equal(shippingIsFree(null), true);
});

test('the amount is kept while it is not being charged', () => {
  // It is what the switch turns back on. Zeroing it would mean retyping it.
  assert.equal(DEFAULT_SETTINGS.shipping.amount, 6);
  assert.equal(validateSettings(FREE).value.shipping.amount, 6);
});

test('switching shipping off is free by the other route', () => {
  const off = { ...FREE, shipping: { label: 'Shipping', amount: 6, enabled: false } };

  assert.equal(shippingIsFree(off), true);
  assert.equal(orderTotal([{ price: 10, quantity: 1 }], off).shipping, 0);
});

test('free means free in both modes that are free, and not in the third', () => {
  assert.equal(shippingIsFree(FREE), true);
  assert.equal(shippingIsFree(CHARGED), false);
  assert.equal(shippingIsFree({ shipping: { amount: 0, enabled: true } }), true);
});

test('the switch survives a save, in both directions', () => {
  // validateSettings builds its result from known keys, so a field it does not
  // know about is dropped the first time anything is saved in the panel.
  assert.equal(validateSettings(FREE).value.shipping.includedInPrices, true);
  assert.equal(validateSettings(CHARGED).value.shipping.includedInPrices, false);
});

/* ---------------------------------------------------------------- the bag */

test('the bag charges nothing for postage and says so', () => {
  const totals = orderTotal([{ price: 12.99, quantity: 1 }], FREE);

  assert.equal(totals.shipping, 0);
  assert.equal(totals.total, 12.99);

  const line = totals.lines.find((entry) => entry.free);
  assert.ok(line, 'nothing in the bag tells a customer postage is free');
  assert.equal(line.amount, 0);
});

test('the free line is drawn even though it is worth nothing', () => {
  // A total with no shipping row at all leaves a customer waiting for postage
  // to be added. Saying "Shipping - Free" is the entire point.
  assert.equal(orderTotal([{ price: 10, quantity: 1 }], FREE).lines.length, 1);
});

test('an empty bag is still empty, not a free postage line on nothing', () => {
  assert.deepEqual(orderTotal([], FREE).lines, []);
  assert.equal(orderTotal([], FREE).total, 0);
});

test('two pieces are two prices and still no postage', () => {
  const totals = orderTotal([{ price: 12.99, quantity: 2 }], FREE);

  assert.equal(totals.total, 25.98);
  assert.equal(totals.shipping, 0);
});

/* ----------------------------------------------------- turning it back on */

test('switched off, the postage charge comes back as its own line', () => {
  const totals = orderTotal([{ price: 12.99, quantity: 1 }], CHARGED);

  assert.equal(totals.shipping, 6);
  assert.equal(totals.total, 18.99);
  assert.equal(totals.lines[0].label, 'Shipping');
  assert.ok(!totals.lines[0].free);
});

test('charged postage is once per order, not once per piece', () => {
  assert.equal(orderTotal([{ price: 10, quantity: 4 }], CHARGED).shipping, 6);
});

/* ------------------------------------------------------------- the charge */

test('what Stripe is told to charge is what the bag showed', () => {
  const catalog = readyCatalog([pen()], []);
  const { items } = resolveCart([{ handle: 'beaded-pen', quantity: 1 }], catalog);
  const totals = orderTotal(items, FREE);

  const checked = checkedSessionParams({
    items,
    totals,
    settings: FREE,
    origin: 'https://shop.example',
    reference: 'SW-1',
  });

  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.cents, 1299);
  assert.equal(stripeTotalCents(checked.params), 1299);
});

test('Stripe is sent no shipping option while postage is free', () => {
  const items = [{ handle: 'beaded-pen', title: 'Beaded pen', price: 12.99, quantity: 1 }];

  const checked = checkedSessionParams({
    items,
    totals: orderTotal(items, FREE),
    settings: FREE,
    origin: 'https://shop.example',
  });

  assert.equal(checked.ok, true);
  assert.equal(checked.params.shipping_options, undefined);
  assert.equal(checked.params.line_items.length, 1);
  assert.equal(checked.params.line_items[0].price_data.unit_amount, 1299);
});

test('switched off, Stripe is sent the shipping option again', () => {
  const items = [{ handle: 'beaded-pen', title: 'Beaded pen', price: 12.99, quantity: 1 }];

  const checked = checkedSessionParams({
    items,
    totals: orderTotal(items, CHARGED),
    settings: CHARGED,
    origin: 'https://shop.example',
  });

  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.params.shipping_options[0].shipping_rate_data.fixed_amount.amount, 600);
  assert.equal(checked.cents, 1899);
});

test('an awkward price still agrees to the cent across three of them', () => {
  const catalog = readyCatalog([pen({ price: 13.33 })], []);
  const { items } = resolveCart([{ handle: 'beaded-pen', quantity: 3 }], catalog);

  const checked = checkedSessionParams({
    items,
    totals: orderTotal(items, FREE),
    settings: FREE,
    origin: 'https://shop.example',
  });

  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.cents, 3999);
});

/* -------------------------------------------------------------- the email */

test('the order email says Free rather than $0.00', () => {
  const items = [{ title: 'Beaded pen', handle: 'beaded-pen', price: 12.99, quantity: 1 }];

  const { text, html } = orderEmail({
    reference: 'SW-1',
    items,
    totals: orderTotal(items, FREE),
    customer: { name: 'Jane', email: 'jane@example.com' },
  });

  assert.match(text, /Shipping\s+Free/);
  assert.ok(!text.includes('$0.00'), text);
  assert.match(html, /Free/);
});

/* --------------------------------------------------------- what pages say */

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
  // put them right if the switch is ever turned off.
  const dir = new URL('../stitch-wishes-2050/', import.meta.url);

  for (const name of ['policies.html', 'terms.html']) {
    const page = readFileSync(new URL(name, dir), 'utf8');

    assert.match(page, /data-postage/, `${name} cannot be corrected`);
    assert.match(page, /free|include/i, `${name} does not mention free shipping`);
  }
});
