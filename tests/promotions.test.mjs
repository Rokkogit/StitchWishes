// Taking money off an order.
//
// Every test here is about one of two things: that the right amount comes off,
// and that no amount of odd input can make the shop pay the customer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePromotions,
  normalizeCode,
  statusOf,
  applySales,
  orderDiscounts,
  saleBadge,
  covers,
  MAX_PERCENT,
  MAX_AMOUNT,
} from '../lib/promotions.mjs';
import { orderTotal, DEFAULT_SETTINGS, validateSettings } from '../lib/settings.mjs';
import { checkedSessionParams } from '../lib/checkout.mjs';

const CATALOG = [
  { handle: 'pen', title: 'Pen', price: 10, category: 'pens' },
  { handle: 'keyring', title: 'Keyring', price: 4, category: 'keyrings' },
  { handle: 'canvas', title: 'Canvas', price: 30, category: 'wall' },
];

const made = (over) => validatePromotions([{ id: 'p', label: 'Deal', ...over }]).value[0];

/* ------------------------------------------------------------ validation */

test('a promotion that takes nothing off is refused', () => {
  // It would sit in the list looking live and do nothing at all.
  const { value, errors } = validatePromotions([{ id: 'p', kind: 'code', code: 'X', label: 'Nothing' }]);

  assert.equal(value.length, 0);
  assert.match(errors[0].message, /how much/i);
});

test('one bad promotion does not cost the others', () => {
  // These are typed into a form. One being wrong should cost that one, not the
  // four already running.
  const { value, errors } = validatePromotions([
    { id: 'a', kind: 'code', code: 'GOOD', percent: 10 },
    { id: 'b', kind: 'code', code: 'BAD' },
    { id: 'c', kind: 'sale', percent: 20 },
  ]);

  assert.deepEqual(value.map((p) => p.id), ['a', 'c']);
  assert.equal(errors.length, 1);
});

test('nobody can take more than the ceiling off', () => {
  assert.equal(validatePromotions([{ id: 'p', kind: 'sale', percent: MAX_PERCENT + 1 }]).value.length, 0);
  assert.equal(validatePromotions([{ id: 'p', kind: 'sale', amount: MAX_AMOUNT + 1 }]).value.length, 0);
});

test('a percentage wins over an amount rather than both applying', () => {
  const both = made({ kind: 'code', code: 'X', percent: 10, amount: 5 });

  assert.equal(both.percent, 10);
  assert.equal(both.amount, null);
});

test('two codes with one word is refused', () => {
  // Otherwise which one a customer gets is a coin toss.
  const { value, errors } = validatePromotions([
    { id: 'a', kind: 'code', code: 'SAVE', percent: 10 },
    { id: 'b', kind: 'code', code: 'save', percent: 50 },
  ]);

  assert.equal(value.length, 1);
  assert.match(errors[0].message, /twice/i);
});

test('a promotion that ends before it starts is refused', () => {
  const { value } = validatePromotions([
    { id: 'p', kind: 'sale', percent: 10, starts: '2026-06-01', ends: '2026-05-01' },
  ]);

  assert.equal(value.length, 0);
});

test('a code is read the way somebody types it on a phone', () => {
  for (const typed of [' save10 ', 'Save10', 'SAVE 10', 'save10']) {
    assert.equal(normalizeCode(typed), 'SAVE10', typed);
  }
});

test('promotions survive an admin save', () => {
  // validateSettings builds its result from known keys, so a field it does not
  // know about is dropped the first time anything is saved.
  const saved = validateSettings({
    ...DEFAULT_SETTINGS,
    promotions: [{ id: 'p', kind: 'code', code: 'SAVE10', percent: 10, label: 'Welcome' }],
  });

  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  assert.equal(saved.value.promotions[0].code, 'SAVE10');
});

/* ---------------------------------------------------------------- status */

test('a promotion says why it is not running, not just that it is not', () => {
  const now = Date.parse('2026-06-15');

  assert.equal(statusOf(made({ kind: 'sale', percent: 10 }), now), 'live');
  assert.equal(statusOf(made({ kind: 'sale', percent: 10, enabled: false }), now), 'off');
  assert.equal(statusOf(made({ kind: 'sale', percent: 10, starts: '2026-07-01' }), now), 'scheduled');
  assert.equal(statusOf(made({ kind: 'sale', percent: 10, ends: '2026-06-01' }), now), 'ended');
});

test('a code that has been used its limit is used up', () => {
  const code = made({ kind: 'code', code: 'X', percent: 10, limit: 2 });

  assert.equal(statusOf(code, Date.now(), { p: 1 }), 'live');
  assert.equal(statusOf(code, Date.now(), { p: 2 }), 'used up');
  assert.equal(statusOf(code, Date.now(), { p: 99 }), 'used up');
});

/* ----------------------------------------------------------------- scope */

test('a promotion reaches only what it is pointed at', () => {
  const all = made({ kind: 'sale', percent: 10, scope: 'all' });
  const cat = made({ kind: 'sale', percent: 10, scope: 'category', target: 'pens' });
  const one = made({ kind: 'sale', percent: 10, scope: 'piece', target: 'canvas' });

  assert.equal(covers(all, CATALOG[0]), true);
  assert.equal(covers(cat, CATALOG[0]), true);
  assert.equal(covers(cat, CATALOG[2]), false);
  assert.equal(covers(one, CATALOG[2]), true);
  assert.equal(covers(one, CATALOG[0]), false);
});

/* ----------------------------------------------------------------- sales */

test('a sale is the price, not a line on the order', () => {
  // Which is why it shows as a struck-through price on the shelf and why the
  // bag's subtotal is already the sale subtotal.
  const [pen] = applySales([CATALOG[0]], [made({ kind: 'sale', percent: 20 })]);

  assert.equal(pen.price, 8);
  assert.equal(pen.wasPrice, 10);
  assert.deepEqual(saleBadge(pen), { was: 10, now: 8, percent: 20 });
});

test('two sales on one piece do not stack', () => {
  // 30% and 30% becoming 51% off is the kind of thing nobody notices until the
  // month's takings. The better one wins.
  const [pen] = applySales(
    [CATALOG[0]],
    validatePromotions([
      { id: 'a', kind: 'sale', percent: 30 },
      { id: 'b', kind: 'sale', percent: 10 },
    ]).value
  );

  assert.equal(pen.price, 7);
});

test('a design with its own price is reduced too', () => {
  // Otherwise choosing the dearer design quietly escapes the sale.
  const piece = {
    handle: 'pen',
    price: 10,
    designs: { label: 'Design', options: [{ id: 'd1', image: 'a.jpg', price: 20 }, { id: 'd2', image: 'b.jpg' }] },
  };

  const [sale] = applySales([piece], [made({ kind: 'sale', percent: 50 })]);

  assert.equal(sale.designs.options[0].price, 10);
  assert.equal(sale.designs.options[1].price ?? null, null, 'a design with no price must not gain one');
});

test('a scheduled sale changes nothing until it starts', () => {
  const soon = validatePromotions([{ id: 'p', kind: 'sale', percent: 50, starts: '2026-07-01' }]).value;

  assert.equal(applySales([CATALOG[0]], soon, Date.parse('2026-06-01'))[0].price, 10);
  assert.equal(applySales([CATALOG[0]], soon, Date.parse('2026-07-02'))[0].price, 5);
});

test('a piece with no price cannot be put on sale', () => {
  const [piece] = applySales([{ handle: 'x', price: null }], [made({ kind: 'sale', percent: 50 })]);

  assert.equal(piece.price ?? null, null);
});

/* ------------------------------------------------------------- discounts */

const bag = (over = []) => [{ handle: 'pen', price: 10, quantity: 3 }, ...over];

test('a code takes off what it says', () => {
  const promos = validatePromotions([{ id: 'c', kind: 'code', code: 'SAVE10', percent: 10, label: 'Welcome' }]).value;
  const out = orderDiscounts({ items: bag(), products: CATALOG, promotions: promos, code: 'save10' });

  assert.equal(out.cents, 300);
  assert.equal(out.code, 'SAVE10');
  assert.equal(out.codeProblem, null);
});

test('a code nobody recognises is said out loud', () => {
  // A customer who typed a code and sees no change assumes the shop is broken.
  const out = orderDiscounts({ items: bag(), products: CATALOG, promotions: [], code: 'NOPE' });

  assert.equal(out.cents, 0);
  assert.match(out.codeProblem, /not a code/i);
});

test('an expired code says it has expired', () => {
  const promos = validatePromotions([
    { id: 'c', kind: 'code', code: 'OLD', percent: 10, ends: '2020-01-01' },
  ]).value;

  const out = orderDiscounts({ items: bag(), products: CATALOG, promotions: promos, code: 'OLD' });

  assert.match(out.codeProblem, /expired/i);
  assert.equal(out.cents, 0);
});

test('a code that applies to nothing in the bag says so', () => {
  const promos = validatePromotions([
    { id: 'c', kind: 'code', code: 'WALL', percent: 50, scope: 'category', target: 'wall' },
  ]).value;

  const out = orderDiscounts({ items: bag(), products: CATALOG, promotions: promos, code: 'WALL' });

  assert.match(out.codeProblem, /does not apply/i);
});

test('a code only reduces the part of the order it covers', () => {
  const promos = validatePromotions([
    { id: 'c', kind: 'code', code: 'PENS', percent: 50, scope: 'category', target: 'pens' },
  ]).value;

  // 3 pens at 10, one canvas at 30. Half off the pens only.
  const out = orderDiscounts({
    items: bag([{ handle: 'canvas', price: 30, quantity: 1 }]),
    products: CATALOG,
    promotions: promos,
    code: 'PENS',
  });

  assert.equal(out.cents, 1500);
});

test('a bundle is a set price, not a free one', () => {
  // "3 for $30" is a number somebody can picture. "Buy 3 pay for 2" makes
  // them do arithmetic on prices they have not added up yet.
  const promos = validatePromotions([
    { id: 'b', kind: 'bundle', buy: 3, price: 25, scope: 'piece', target: 'pen', label: '3 for $25' },
  ]).value;

  const off = (quantity) =>
    orderDiscounts({
      items: [{ handle: 'pen', price: 10, quantity }],
      products: CATALOG,
      promotions: promos,
    }).cents;

  assert.equal(off(2), 0, 'an incomplete set is full price');
  assert.equal(off(3), 500, '30 becomes 25');
  assert.equal(off(5), 500, 'the two left over stay full price');
  assert.equal(off(6), 1000, 'two complete sets');
});

test('a bundle without a set price is refused', () => {
  const { value, errors } = validatePromotions([{ id: 'b', kind: 'bundle', buy: 3 }]);

  assert.equal(value.length, 0);
  assert.match(errors[0].message, /what the set costs/i);
});

test('a set price above what the pieces cost does nothing rather than charging more', () => {
  const promos = validatePromotions([
    { id: 'b', kind: 'bundle', buy: 2, price: 999, scope: 'piece', target: 'pen' },
  ]).value;

  const out = orderDiscounts({
    items: [{ handle: 'pen', price: 10, quantity: 2 }],
    products: CATALOG,
    promotions: promos,
  });

  assert.equal(out.cents, 0, 'a bad deal is not a surcharge');
});

test('a set is made of the dearest things in the bag', () => {
  // The version a customer would pick for themselves. Picking it for them is
  // the only way the number on the shelf stays true whatever ends up in it.
  const promos = validatePromotions([
    { id: 'b', kind: 'bundle', buy: 2, price: 20, scope: 'all' },
  ]).value;

  const out = orderDiscounts({
    items: [
      { handle: 'canvas', price: 30, quantity: 1 },
      { handle: 'pen', price: 10, quantity: 1 },
      { handle: 'keyring', price: 4, quantity: 1 },
    ],
    products: CATALOG,
    promotions: promos,
  });

  // The canvas and the pen: 40 becomes 20. Not the keyring and the pen.
  assert.equal(out.cents, 2000);
});

test('a bundle over a whole category still cannot make an order negative', () => {
  const promos = validatePromotions([{ id: 'b', kind: 'bundle', buy: 2, price: 0, scope: 'all' }]).value;

  const totals = orderTotal([{ price: 4, quantity: 2 }], DEFAULT_SETTINGS, {
    cents: orderDiscounts({
      items: [{ handle: 'keyring', price: 4, quantity: 2 }],
      products: CATALOG,
      promotions: promos,
    }).cents,
    lines: [{ label: 'Two for nothing', cents: 800 }],
  });

  assert.equal(totals.total, 0);
  assert.ok(totals.total >= 0);
});

test('spend and save only fires once the bag is big enough', () => {
  const promos = validatePromotions([{ id: 's', kind: 'spend', spend: 50, amount: 10 }]).value;
  const off = (quantity) =>
    orderDiscounts({ items: [{ handle: 'pen', price: 10, quantity }], products: CATALOG, promotions: promos }).cents;

  assert.equal(off(4), 0);
  assert.equal(off(5), 1000);
});

test('a code and a spend reward both apply, but two codes never do', () => {
  const promos = validatePromotions([
    { id: 'c1', kind: 'code', code: 'ONE', amount: 5 },
    { id: 'c2', kind: 'code', code: 'TWO', amount: 5 },
    { id: 's', kind: 'spend', spend: 20, amount: 2 },
  ]).value;

  const out = orderDiscounts({ items: bag(), products: CATALOG, promotions: promos, code: 'ONE' });

  // The spend reward and one code. There is no way to ask for both codes.
  assert.equal(out.cents, 700);
  assert.equal(out.lines.filter((line) => line.code).length, 1);
});

/* --------------------------------------------------- it can never go negative */

test('a discount never exceeds what the pieces are worth', () => {
  const promos = validatePromotions([{ id: 'c', kind: 'code', code: 'BIG', amount: MAX_AMOUNT }]).value;
  const out = orderDiscounts({ items: [{ handle: 'keyring', price: 4, quantity: 1 }], products: CATALOG, promotions: promos, code: 'BIG' });

  assert.equal(out.cents, 400);
});

test('postage and tax are never discounted away', () => {
  const taxed = {
    ...DEFAULT_SETTINGS,
    shipping: { label: 'Shipping', amount: 6, enabled: true, includedInPrices: false },
    tax: { label: 'Tax', rate: 10, enabled: true, includeShipping: false },
  };

  const totals = orderTotal([{ price: 10, quantity: 1 }], taxed, {
    cents: 9999,
    lines: [{ label: 'Absurd', cents: 9999 }],
  });

  assert.equal(totals.discount, 10, 'only the piece can be discounted');
  assert.equal(totals.shipping, 6, 'postage survives');
  assert.equal(totals.tax, 0, 'tax is charged on what is left, which is nothing');
  assert.equal(totals.total, 6);
});

test('an order can never come to less than nothing', () => {
  const totals = orderTotal([{ price: 5, quantity: 1 }], DEFAULT_SETTINGS, {
    cents: 100000,
    lines: [{ label: 'Oops', cents: 100000 }],
  });

  assert.equal(totals.total, 0);
  assert.ok(totals.total >= 0);
});

test('tax is charged on what is left after a discount', () => {
  const taxed = { ...DEFAULT_SETTINGS, tax: { label: 'Tax', rate: 10, enabled: true, includeShipping: false } };
  const totals = orderTotal([{ price: 100, quantity: 1 }], taxed, {
    cents: 5000,
    lines: [{ label: 'Half', cents: 5000 }],
  });

  assert.equal(totals.tax, 5, '10% of the fifty that is left, not of the hundred');
  assert.equal(totals.total, 55);
});

/* ------------------------------------------------------------- and Stripe */

test('what Stripe charges still matches what the bag showed', () => {
  // The guard that makes all of the above safe to be wrong about.
  const items = [{ handle: 'pen', title: 'Pen', price: 10, quantity: 3 }];
  const totals = orderTotal(items, DEFAULT_SETTINGS, { cents: 300, lines: [{ label: 'Welcome', cents: 300 }] });

  const checked = checkedSessionParams({
    items,
    totals,
    settings: DEFAULT_SETTINGS,
    origin: 'https://shop.example',
    coupon: 'co_one_time',
  });

  assert.equal(checked.ok, true, checked.reason);
  assert.equal(checked.cents, 2700);
  assert.deepEqual(checked.params.discounts, [{ coupon: 'co_one_time' }]);
});

test('a discount with no coupon is refused rather than charged in full', () => {
  // Forgetting the coupon would charge the customer the undiscounted total.
  // The mismatch check catches it, which is exactly what it is for.
  const items = [{ handle: 'pen', title: 'Pen', price: 10, quantity: 3 }];
  const totals = orderTotal(items, DEFAULT_SETTINGS, { cents: 300, lines: [{ label: 'Welcome', cents: 300 }] });

  const checked = checkedSessionParams({ items, totals, settings: DEFAULT_SETTINGS, origin: 'https://x' });

  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'total-mismatch');
});

test('the promotion travels on the session so it can be counted once paid', () => {
  const items = [{ handle: 'pen', title: 'Pen', price: 10, quantity: 1 }];
  const checked = checkedSessionParams({
    items,
    totals: orderTotal(items, DEFAULT_SETTINGS),
    settings: DEFAULT_SETTINGS,
    origin: 'https://x',
    promoId: 'promo-welcome',
  });

  assert.equal(checked.params.metadata.code, 'promo-welcome');
});
