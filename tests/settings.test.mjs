// Stock, shipping and fees. Nothing here takes money yet, but these are the
// numbers that will decide what a customer is charged, so they are validated
// as strictly as anything that does.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateProduct } from '../lib/catalog.mjs';
import {
  MAX_AMOUNT,
  DEFAULT_SETTINGS,
  validateSettings,
  orderTotal,
} from '../lib/settings.mjs';

/* ------------------------------------------------------------------ stock */

const piece = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded Pen',
  price: 12.99,
  description: 'A pen.',
  images: [],
  hidden: false,
  ...over,
});

// null is the default so the existing catalog is unaffected until a quantity
// is set deliberately.
test('stock defaults to null, meaning made to order', () => {
  const result = validateProduct(piece());

  assert.equal(result.ok, true);
  assert.equal(result.value.stock, null);
});

test('a whole number of items in stock is accepted', () => {
  assert.equal(validateProduct(piece({ stock: 3 })).value.stock, 3);
});

test('zero stock is accepted and means sold out', () => {
  const result = validateProduct(piece({ stock: 0 }));

  assert.equal(result.ok, true);
  assert.equal(result.value.stock, 0);
});

test('negative stock is refused', () => {
  const result = validateProduct(piece({ stock: -1 }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'stock'));
});

test('fractional stock is refused', () => {
  assert.equal(validateProduct(piece({ stock: 1.5 })).ok, false);
});

test('a numeric string stock is coerced', () => {
  assert.equal(validateProduct(piece({ stock: '4' })).value.stock, 4);
});

test('unparseable stock is refused rather than silently becoming unlimited', () => {
  for (const bad of ['lots', {}, [], NaN, Infinity]) {
    assert.equal(validateProduct(piece({ stock: bad })).ok, false, String(bad));
  }
});

/* --------------------------------------------------------------- settings */

test('the defaults are themselves valid', () => {
  assert.equal(validateSettings(DEFAULT_SETTINGS).ok, true);
});

test('shipping and fees round-trip', () => {
  const result = validateSettings({
    shipping: { label: 'Postage', amount: 4.5, enabled: true },
    fees: [{ id: 'a', label: 'Handling', amount: 1.5, enabled: true }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.shipping.amount, 4.5);
  assert.equal(result.value.fees[0].label, 'Handling');
});

test('a missing settings object falls back to the defaults', () => {
  for (const missing of [null, undefined]) {
    const result = validateSettings(missing);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, DEFAULT_SETTINGS);
  }
});

// A fee applies to every order automatically. A slipped decimal point would
// not produce one odd total, it would overcharge everyone until noticed.
test('an amount over the cap is refused', () => {
  const result = validateSettings({
    shipping: { label: 'Shipping', amount: MAX_AMOUNT + 1, enabled: true },
    fees: [],
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /shipping/i.test(e.field)));
});

test('a fee over the cap is refused', () => {
  const result = validateSettings({
    shipping: DEFAULT_SETTINGS.shipping,
    fees: [{ id: 'a', label: 'Oops', amount: 50_000, enabled: true }],
  });

  assert.equal(result.ok, false);
});

test('a negative amount is refused', () => {
  assert.equal(
    validateSettings({ shipping: { label: 'S', amount: -1, enabled: true }, fees: [] }).ok,
    false
  );
});

test('a non-finite amount is refused', () => {
  for (const bad of [NaN, Infinity, 'free', {}]) {
    const result = validateSettings({
      shipping: { label: 'S', amount: bad, enabled: true },
      fees: [],
    });
    assert.equal(result.ok, false, String(bad));
  }
});

test('a fee with no label is refused', () => {
  const result = validateSettings({
    shipping: DEFAULT_SETTINGS.shipping,
    fees: [{ id: 'a', label: '   ', amount: 1, enabled: true }],
  });

  assert.equal(result.ok, false);
});

test('a fee keeps its id so switching it off does not lose it', () => {
  const result = validateSettings({
    shipping: DEFAULT_SETTINGS.shipping,
    fees: [{ id: 'keep-me', label: 'Rush', amount: 2, enabled: false }],
  });

  assert.equal(result.value.fees[0].id, 'keep-me');
  assert.equal(result.value.fees[0].enabled, false);
});

test('zero is a legitimate amount', () => {
  const result = validateSettings({
    shipping: { label: 'Free shipping', amount: 0, enabled: true },
    fees: [],
  });

  assert.equal(result.ok, true);
});

/* ------------------------------------------------------------- orderTotal */

const settings = {
  shipping: { label: 'Shipping', amount: 5, enabled: true },
  fees: [
    { id: 'a', label: 'Handling', amount: 1.5, enabled: true },
    { id: 'b', label: 'Rush', amount: 10, enabled: false },
  ],
};

test('a total is pieces plus shipping plus enabled fees', () => {
  const total = orderTotal([{ price: 12.99, quantity: 1 }], settings);

  assert.equal(total.subtotal, 12.99);
  assert.equal(total.shipping, 5);
  assert.equal(total.fees, 1.5);
  assert.equal(total.total, 19.49);
});

test('a disabled fee is not charged', () => {
  const total = orderTotal([{ price: 10, quantity: 1 }], settings);

  assert.ok(!total.lines.some((line) => line.label === 'Rush'));
});

test('disabled shipping is not charged', () => {
  const total = orderTotal([{ price: 10, quantity: 1 }], {
    ...settings,
    shipping: { ...settings.shipping, enabled: false },
  });

  assert.equal(total.shipping, 0);
});

test('quantities multiply', () => {
  const total = orderTotal([{ price: 10, quantity: 3 }], settings);

  assert.equal(total.subtotal, 30);
});

// Money in floating point: 0.1 + 0.2 is famously not 0.3.
test('totals do not drift on repeating decimals', () => {
  const total = orderTotal(
    [{ price: 0.1, quantity: 1 }, { price: 0.2, quantity: 1 }],
    { shipping: { label: 'S', amount: 0, enabled: true }, fees: [] }
  );

  assert.equal(total.total, 0.3);
});

test('a total is never negative', () => {
  const total = orderTotal([], { shipping: { label: 'S', amount: 0, enabled: true }, fees: [] });

  assert.equal(total.total, 0);
});

test('every charge appears as its own labelled line', () => {
  const total = orderTotal([{ price: 12.99, quantity: 1 }], settings);
  const labels = total.lines.map((line) => line.label);

  assert.ok(labels.includes('Shipping'));
  assert.ok(labels.includes('Handling'));
});

// An empty cart was quoting at the price of postage and handling on nothing.
test('an empty cart costs nothing, not the price of shipping', () => {
  const total = orderTotal([], settings);

  assert.equal(total.total, 0);
  assert.equal(total.shipping, 0);
  assert.equal(total.fees, 0);
  assert.deepEqual(total.lines, []);
});

/* ------------------------------------------------------------------ tax */
// Tax is a percentage, not a fee. A flat amount would undercharge a $4
// keychain and overcharge a $30 canvas, and she carries the difference.

const taxed = (rate, over = {}) => ({
  shipping: { label: 'Shipping', amount: 5, enabled: true },
  fees: [],
  tax: { label: 'Sales tax', rate, enabled: true, includeShipping: false, ...over },
});

test('tax is a percentage of what the pieces cost', () => {
  const total = orderTotal([{ price: 100, quantity: 1 }], taxed(9.5));

  assert.equal(total.tax, 9.5);
  assert.equal(total.total, 100 + 5 + 9.5);
});

test('tax scales with the order, unlike a flat fee', () => {
  const small = orderTotal([{ price: 4, quantity: 1 }], taxed(10));
  const large = orderTotal([{ price: 30, quantity: 1 }], taxed(10));

  assert.equal(small.tax, 0.4);
  assert.equal(large.tax, 3);
});

test('tax rounds to whole cents', () => {
  const total = orderTotal([{ price: 12.99, quantity: 1 }], taxed(9.5));

  assert.equal(total.tax, 1.23);   // 12.99 * 0.095 = 1.23405
});

test('tax is off unless switched on', () => {
  const total = orderTotal([{ price: 100, quantity: 1 }], taxed(9.5, { enabled: false }));

  assert.equal(total.tax, 0);
  assert.equal(total.total, 105);
});

// Whether shipping is taxable varies by state, so it is a decision rather
// than a guess baked into the code.
test('shipping is taxed only when asked for', () => {
  const without = orderTotal([{ price: 100, quantity: 1 }], taxed(10));
  const with_ = orderTotal([{ price: 100, quantity: 1 }], taxed(10, { includeShipping: true }));

  assert.equal(without.tax, 10);
  assert.equal(with_.tax, 10.5);
});

test('tax appears as its own line, showing the rate', () => {
  const total = orderTotal([{ price: 100, quantity: 1 }], taxed(9.5));
  const line = total.lines.find((l) => /tax/i.test(l.label));

  assert.ok(line, 'tax must be visible to the customer, not folded into the total');
  assert.match(line.label, /9\.5/);
});

test('an empty cart is not taxed', () => {
  assert.equal(orderTotal([], taxed(9.5)).tax, 0);
});

test('a zero rate adds no line', () => {
  const total = orderTotal([{ price: 100, quantity: 1 }], taxed(0));

  assert.equal(total.tax, 0);
  assert.ok(!total.lines.some((l) => /tax/i.test(l.label)));
});

test('settings with no tax at all still work', () => {
  const total = orderTotal([{ price: 100, quantity: 1 }], { shipping: { label: 'S', amount: 0, enabled: false }, fees: [] });

  assert.equal(total.tax, 0);
});

/* ------------------------------------------------------- tax validation */

const withTax = (tax) => validateSettings({ shipping: DEFAULT_SETTINGS.shipping, fees: [], tax });

test('a sensible rate is accepted', () => {
  const result = withTax({ label: 'Sales tax', rate: 9.5, enabled: true });

  assert.equal(result.ok, true);
  assert.equal(result.value.tax.rate, 9.5);
});

// The typo this catches: 950 meant as 9.50.
test('a rate above the cap is refused', () => {
  assert.equal(withTax({ label: 'Sales tax', rate: 950, enabled: true }).ok, false);
});

test('a negative rate is refused', () => {
  assert.equal(withTax({ label: 'Sales tax', rate: -1, enabled: true }).ok, false);
});

test('a non-numeric rate is refused', () => {
  for (const bad of ['lots', NaN, Infinity, {}]) {
    assert.equal(withTax({ label: 'Sales tax', rate: bad, enabled: true }).ok, false, String(bad));
  }
});

test('settings without tax default to none, switched off', () => {
  const result = validateSettings({ shipping: DEFAULT_SETTINGS.shipping, fees: [] });

  assert.equal(result.ok, true);
  assert.equal(result.value.tax.enabled, false);
  assert.equal(result.value.tax.rate, 0);
});
