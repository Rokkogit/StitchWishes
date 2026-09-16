// Turning what a browser claims is in a cart into what may actually be sold.
//
// Everything here treats the incoming cart as untrusted, because it is: it
// comes from localStorage, which anyone can edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCart } from '../lib/cart.mjs';

const catalog = () => [
  { handle: 'pen', title: 'Pen', price: 12.99, images: ['assets/a.jpg'], hidden: false, stock: 3 },
  { handle: 'sign', title: 'Sign', price: 16.99, images: [], hidden: false, stock: null },
  { handle: 'gone', title: 'Gone', price: 5, images: [], hidden: false, stock: 0 },
  { handle: 'secret', title: 'Secret', price: 9, images: [], hidden: true, stock: 5 },
  { handle: 'free', title: 'No price', price: null, images: [], hidden: false, stock: 2 },
];

test('a normal cart resolves', () => {
  const result = resolveCart([{ handle: 'pen', quantity: 2 }], catalog());

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].title, 'Pen');
});

// The price comes from the catalog, never from the cart. If the browser could
// name a price, eventually it would name one cent.
test('the price is taken from the catalog, not from the cart', () => {
  const result = resolveCart([{ handle: 'pen', quantity: 1, price: 0.01 }], catalog());

  assert.equal(result.items[0].price, 12.99);
});

test('the title is taken from the catalog too', () => {
  const result = resolveCart([{ handle: 'pen', quantity: 1, title: 'Free Pen' }], catalog());

  assert.equal(result.items[0].title, 'Pen');
});

test('an unknown handle is dropped and reported', () => {
  const result = resolveCart([{ handle: 'nope', quantity: 1 }], catalog());

  assert.equal(result.items.length, 0);
  assert.equal(result.problems.length, 1);
});

test('a hidden piece cannot be bought', () => {
  const result = resolveCart([{ handle: 'secret', quantity: 1 }], catalog());

  assert.equal(result.items.length, 0);
  assert.match(result.problems[0].message, /no longer|not available/i);
});

test('a sold out piece cannot be bought', () => {
  const result = resolveCart([{ handle: 'gone', quantity: 1 }], catalog());

  assert.equal(result.items.length, 0);
  assert.match(result.problems[0].message, /sold out/i);
});

// The point of tracking stock at all.
test('a quantity beyond stock is clamped, not refused outright', () => {
  const result = resolveCart([{ handle: 'pen', quantity: 99 }], catalog());

  assert.equal(result.items[0].quantity, 3);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /3/);
});

test('made to order has no ceiling', () => {
  const result = resolveCart([{ handle: 'sign', quantity: 40 }], catalog());

  assert.equal(result.items[0].quantity, 40);
  assert.equal(result.problems.length, 0);
});

test('a piece with no price cannot be bought', () => {
  const result = resolveCart([{ handle: 'free', quantity: 1 }], catalog());

  assert.equal(result.items.length, 0);
  assert.match(result.problems[0].message, /price/i);
});

test('a quantity of zero or less is dropped', () => {
  for (const quantity of [0, -1, -99]) {
    const result = resolveCart([{ handle: 'pen', quantity }], catalog());
    assert.equal(result.items.length, 0, String(quantity));
  }
});

test('a fractional quantity is truncated', () => {
  const result = resolveCart([{ handle: 'pen', quantity: 2.7 }], catalog());

  assert.equal(result.items[0].quantity, 2);
});

test('a nonsense quantity is treated as one', () => {
  for (const quantity of [undefined, null, 'two', NaN, {}]) {
    const result = resolveCart([{ handle: 'pen', quantity }], catalog());
    assert.equal(result.items[0]?.quantity, 1, String(quantity));
  }
});

test('the same piece listed twice is merged', () => {
  const result = resolveCart(
    [{ handle: 'pen', quantity: 1 }, { handle: 'pen', quantity: 1 }],
    catalog()
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 2);
});

test('merging still respects stock', () => {
  const result = resolveCart(
    [{ handle: 'pen', quantity: 2 }, { handle: 'pen', quantity: 5 }],
    catalog()
  );

  assert.equal(result.items[0].quantity, 3);
});

test('an empty or malformed cart resolves to nothing, without throwing', () => {
  for (const bad of [[], null, undefined, {}, 'pen', [null], [{}]]) {
    const result = resolveCart(bad, catalog());
    assert.equal(result.items.length, 0, JSON.stringify(bad));
  }
});

test('a missing catalog resolves to nothing rather than selling everything', () => {
  for (const bad of [null, undefined, {}, []]) {
    assert.equal(resolveCart([{ handle: 'pen', quantity: 1 }], bad).items.length, 0);
  }
});

test('each item carries a photograph for the cart to show', () => {
  const result = resolveCart([{ handle: 'pen', quantity: 1 }], catalog());

  assert.equal(result.items[0].image, 'assets/a.jpg');
});

test('a piece with no photograph still resolves', () => {
  const result = resolveCart([{ handle: 'sign', quantity: 1 }], catalog());

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].image, null);
});
