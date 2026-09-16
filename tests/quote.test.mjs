// The quote endpoint, driven with real Request objects.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import quote from '../api/quote.mjs';

const ID = 'ecfg_abc123';
const saved = {};
let realFetch;

const CATALOG = [
  { handle: 'pen', title: 'Pen', price: 12.99, images: [], hidden: false, stock: 3 },
  { handle: 'gone', title: 'Gone', price: 5, images: [], hidden: false, stock: 0 },
];

const SETTINGS = {
  shipping: { label: 'Postage', amount: 5, enabled: true },
  fees: [{ id: 'h', label: 'Handling', amount: 1.5, enabled: true }],
};

beforeEach(() => {
  realFetch = globalThis.fetch;
  saved.GLOBAL_CONFIG = process.env.GLOBAL_CONFIG;
  process.env.GLOBAL_CONFIG = `https://global-config.vercel.com/${ID}?token=t`;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { products: CATALOG, settings: SETTINGS };
    },
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (saved.GLOBAL_CONFIG === undefined) delete process.env.GLOBAL_CONFIG;
  else process.env.GLOBAL_CONFIG = saved.GLOBAL_CONFIG;
});

const post = (cart) =>
  new Request('https://x/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart }),
  });

test('a quote prices the cart from the catalog', async () => {
  const body = await (await quote.fetch(post([{ handle: 'pen', quantity: 2 }]))).json();

  assert.equal(body.items[0].price, 12.99);
  assert.equal(body.items[0].quantity, 2);
});

// The whole point of quoting on the server.
test('a price sent by the browser is ignored', async () => {
  const body = await (await quote.fetch(post([{ handle: 'pen', quantity: 1, price: 0.01 }]))).json();

  assert.equal(body.items[0].price, 12.99);
  assert.equal(body.total, 19.49);   // not 12.99 + 5 + 1.5, which is 19.490000000000002
});

test('shipping and fees are included as their own lines', async () => {
  const body = await (await quote.fetch(post([{ handle: 'pen', quantity: 1 }]))).json();
  const labels = body.lines.map((line) => line.label);

  assert.ok(labels.includes('Postage'));
  assert.ok(labels.includes('Handling'));
});

test('a sold out piece is removed and explained', async () => {
  const body = await (await quote.fetch(post([{ handle: 'gone', quantity: 1 }]))).json();

  assert.equal(body.items.length, 0);
  assert.match(body.problems[0].message, /sold out/i);
});

test('an empty cart quotes to nothing, not an error', async () => {
  const response = await quote.fetch(post([]));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.total, 0);
});

test('a quote is never cached', async () => {
  const response = await quote.fetch(post([{ handle: 'pen', quantity: 1 }]));

  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
});

test('a GET is refused', async () => {
  const response = await quote.fetch(new Request('https://x/api/quote', { method: 'GET' }));

  assert.equal(response.status, 405);
});

test('a malformed body is refused', async () => {
  const response = await quote.fetch(
    new Request('https://x/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
  );

  assert.equal(response.status, 400);
});

// Quoting from a stale or empty catalog would price things wrongly, which is
// worse than briefly refusing to quote at all.
test('an unreachable store refuses to quote rather than guessing', async () => {
  globalThis.fetch = async () => {
    throw new Error('down');
  };

  const response = await quote.fetch(post([{ handle: 'pen', quantity: 1 }]));

  assert.equal(response.status, 503);
});
