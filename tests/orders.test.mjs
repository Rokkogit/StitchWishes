// Orders, read back out of Stripe.
//
// The cases that matter are the ones where the catalog and Stripe disagree:
// a piece renamed, deleted, or a store that cannot be reached. An order is
// already paid for by then, so "show nothing" is never an acceptable answer.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { handle as orders } from '../api/admin-orders.mjs';
import {
  toOrder,
  sortOrders,
  dashboardUrl,
  orderSummary,
  formatAddress,
  shippingOf,
} from '../lib/orders.mjs';
import { listSessions, readStripeConfig } from '../lib/stripe.mjs';
import { createToken, COOKIE_NAME } from '../lib/session.mjs';
import { CATALOG_KEY } from '../lib/global-config.mjs';

const SECRET = 'f'.repeat(64);

const piece = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded Pen',
  price: 12.99,
  description: 'A hand-beaded pen.',
  images: ['assets/pen.jpg'],
  hidden: false,
  ...over,
});

const session = (over = {}) => ({
  id: 'cs_test_1',
  created: 1_790_000_000,
  livemode: false,
  status: 'complete',
  payment_status: 'paid',
  payment_intent: 'pi_123',
  currency: 'usd',
  amount_subtotal: 1299,
  amount_total: 1899,
  total_details: { amount_shipping: 600, amount_tax: 0, amount_discount: 0 },
  metadata: { cart: 'beaded-pen::1', reference: 'SW-260927-001' },
  customer_details: { name: 'Jane Doe', email: 'jane@example.com', phone: '' },
  collected_information: {
    shipping_details: {
      name: 'Jane Doe',
      address: {
        line1: '1 Example St',
        city: 'Springfield',
        state: 'IL',
        postal_code: '62701',
        country: 'US',
      },
    },
  },
  ...over,
});

/* ---------------------------------------------------------------- shaping */

test('an order is named from the catalog, and totalled from Stripe', () => {
  const order = toOrder(session(), [piece()]);

  assert.equal(order.reference, 'SW-260927-001');
  assert.equal(order.items[0].title, 'Beaded Pen');
  assert.equal(order.items[0].quantity, 1);
  assert.equal(order.totals.total, 18.99);
  assert.equal(order.totals.shipping, 6);
  assert.equal(order.paid, true);
  assert.equal(order.live, false);
  assert.equal(order.itemsFromStripe, false);
});

test('a deleted piece falls back to what Stripe recorded at the time', () => {
  // The order is paid. Showing an empty row would be worse than a stale name.
  const withLines = session({
    line_items: { data: [{ description: 'Beaded Pen — Design 1', quantity: 2, amount_total: 2598 }] },
  });

  const order = toOrder(withLines, []);

  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].title, 'Beaded Pen — Design 1');
  assert.equal(order.items[0].quantity, 2);
  assert.equal(order.items[0].price, 12.99);
  assert.equal(order.itemsFromStripe, true);
});

test('the raw cart is kept whatever happens, so nothing is unrecoverable', () => {
  const order = toOrder(session(), []);

  assert.deepEqual(order.rawCart, [{ handle: 'beaded-pen', design: null, quantity: 1 }]);
});

test('a piece with no name anywhere still produces a row', () => {
  const order = toOrder(session({ line_items: { data: [] } }), []);

  assert.equal(order.items.length, 0);
  // But the identifiers survive.
  assert.equal(order.rawCart.length, 1);
});

test('the address is formatted the way it would be written on a parcel', () => {
  const order = toOrder(session(), [piece()]);

  assert.equal(
    order.customer.address,
    'Jane Doe\n1 Example St\nSpringfield, IL, 62701\nUS'
  );
});

test('the older shipping_details shape is read too', () => {
  const older = session({
    collected_information: undefined,
    shipping_details: { name: 'Old Shape', address: { line1: '2 Legacy Rd', country: 'US' } },
  });

  assert.equal(shippingOf(older).name, 'Old Shape');
  assert.match(toOrder(older, [piece()]).customer.address, /2 Legacy Rd/);
});

test('a missing address is empty rather than a row of undefined', () => {
  assert.equal(formatAddress(null), '');
  assert.equal(formatAddress({ name: 'X' }), '');
});

test('a design and its choices reach the order', () => {
  const withDesign = session({ metadata: { cart: 'beaded-pen:d1:1', reference: 'SW-2' } });

  const catalog = [
    piece({
      designs: {
        options: [
          { id: 'd1', image: 'assets/a.jpg', name: 'Blue holographic' },
          { id: 'd2', image: 'assets/b.jpg', name: 'Pink' },
        ],
      },
    }),
  ];

  const order = toOrder(withDesign, catalog);

  assert.equal(order.items[0].designName, 'Blue holographic');
});

/* ------------------------------------------------------------- summaries */

test('the summary counts paid orders and totals them in cents', () => {
  const summary = orderSummary([
    { paid: true, live: false, totals: { total: 18.99 } },
    { paid: true, live: false, totals: { total: 12.01 } },
    { paid: false, live: false, totals: { total: 99 } },
  ]);

  assert.equal(summary.count, 2);
  // 18.99 + 12.01 is 31.000000000000004 added as floats.
  assert.equal(summary.total, 31);
  assert.equal(summary.anyTest, true);
  assert.equal(summary.anyLive, false);
});

test('live and test orders together are both flagged', () => {
  const summary = orderSummary([
    { paid: true, live: true, totals: { total: 10 } },
    { paid: true, live: false, totals: { total: 10 } },
  ]);

  assert.equal(summary.anyLive, true);
  assert.equal(summary.anyTest, true);
});

test('orders come back newest first', () => {
  const sorted = sortOrders([
    { placedAt: '2026-01-01T00:00:00.000Z' },
    { placedAt: '2026-09-01T00:00:00.000Z' },
    { placedAt: '2026-05-01T00:00:00.000Z' },
  ]);

  assert.deepEqual(sorted.map((o) => o.placedAt.slice(0, 7)), ['2026-09', '2026-05', '2026-01']);
});

test('the dashboard link points at the right half of Stripe', () => {
  // Getting this backwards sends her to an empty page and looks like a lost order.
  assert.match(dashboardUrl({ paymentIntent: 'pi_1', live: false }), /dashboard\.stripe\.com\/test\/payments\/pi_1/);
  assert.match(dashboardUrl({ paymentIntent: 'pi_1', live: true }), /dashboard\.stripe\.com\/payments\/pi_1/);
  assert.equal(dashboardUrl({ paymentIntent: null }), null);
});

/* ------------------------------------------------------------- the query */

test('only completed sessions are asked for, with line items expanded', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  };

  await listSessions(readStripeConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }), {}, fetchImpl);

  assert.match(calls[0].url, /status=complete/);
  // Without expanding, an order for a deleted piece would show nothing at all.
  assert.match(calls[0].url, /expand%5B%5D=data\.line_items|expand\[\]=data\.line_items/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk_test_x');
});

test('the page size is clamped to what Stripe accepts', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response('{"data":[]}', { status: 200 });
  };

  const config = readStripeConfig({ STRIPE_SECRET_KEY: 'sk_test_x' });

  await listSessions(config, { limit: 5000 }, fetchImpl);
  assert.match(calls[0], /limit=100/);

  await listSessions(config, { limit: -3 }, fetchImpl);
  assert.match(calls[1], /limit=1/);
});

/* ------------------------------------------------------------- endpoint */

const savedEnv = {};
let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  for (const key of ['ADMIN_CODE', 'ADMIN_SESSION_SECRET', 'GLOBAL_CONFIG', 'STRIPE_SECRET_KEY']) {
    savedEnv[key] = process.env[key];
  }
  process.env.ADMIN_CODE = 'test-passphrase-fixture';
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.GLOBAL_CONFIG = 'https://global-config.vercel.com/ecfg_a/items?token=read';
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function store({ items = [piece()], fail = false } = {}) {
  globalThis.fetch = async () => {
    if (fail) throw new Error('store down');
    return { ok: true, status: 200, async json() { return { [CATALOG_KEY]: items }; } };
  };
}

const stripeList = (sessions, extra = {}) => async () =>
  new Response(JSON.stringify({ data: sessions, has_more: false, ...extra }), { status: 200 });

const authCookie = () => `${COOKIE_NAME}=${createToken(SECRET, 60_000)}`;

const request = (cookie = authCookie(), query = '') =>
  new Request(`https://x/api/admin-orders${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

test('orders are only for someone signed in', async () => {
  store();
  let called = false;
  const response = await orders(request(null), async () => {
    called = true;
    return new Response('{}');
  });

  assert.equal(response.status, 401);
  // Names, addresses and what people spent. Not fetched at all without a session.
  assert.equal(called, false);
});

test('a signed-in request gets the orders, named and totalled', async () => {
  store();
  const response = await orders(request(), stripeList([session()]));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.testMode, true);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].items[0].title, 'Beaded Pen');
  assert.equal(body.summary.count, 1);
  assert.equal(body.summary.total, 18.99);
  assert.match(body.orders[0].dashboard, /test\/payments\/pi_123/);
});

test('unpaid sessions never appear as orders', async () => {
  store();
  const body = await (
    await orders(request(), stripeList([session(), session({ id: 'cs_2', payment_status: 'unpaid' })]))
  ).json();

  assert.equal(body.orders.length, 1);
});

test('no Stripe key is explained, not left as an empty list', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  store();

  const body = await (await orders(request(), stripeList([]))).json();

  assert.equal(body.configured, false);
  assert.match(body.message, /not switched on/);
  assert.deepEqual(body.orders, []);
});

test('an unreachable catalog still lists the orders, and says so', async () => {
  store({ fail: true });

  const withLines = session({
    line_items: { data: [{ description: 'Beaded Pen', quantity: 1, amount_total: 1299 }] },
  });

  const body = await (await orders(request(), stripeList([withLines]))).json();

  assert.equal(body.catalogOk, false);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].itemsFromStripe, true);
});

test('a refused Stripe key says which failure it was', async () => {
  store();
  const failing = async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), { status: 401 });

  const response = await orders(request(), failing);
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.match(body.error, /refused the key/);
  assert.match(body.error, /Invalid API Key/);
});

test('POST is refused', async () => {
  store();
  const response = await orders(
    new Request('https://x/api/admin-orders', { method: 'POST', headers: { Cookie: authCookie() } }),
    stripeList([])
  );

  assert.equal(response.status, 405);
});

test('the paging cursor is handed back for older orders', async () => {
  store();
  const body = await (
    await orders(request(), stripeList([session()], { has_more: true }))
  ).json();

  assert.equal(body.hasMore, true);
  assert.equal(body.nextAfter, 'cs_test_1');
});
