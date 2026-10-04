// /api/checkout and /api/stripe-webhook, driven with real Request objects.
//
// The cart in these tests is treated as hostile, because in production it is:
// it comes from localStorage, which the person sending it owns.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { handle as checkout } from '../api/checkout.mjs';
import { handle as webhook, clearSeen } from '../api/stripe-webhook.mjs';
import { CATALOG_KEY, SETTINGS_KEY } from '../lib/global-config.mjs';

const SECRET = 'whsec_test';

const piece = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded Pen',
  price: 12.99,
  description: 'A hand-beaded pen.',
  images: ['assets/pen.jpg'],
  hidden: false,
  ...over,
});

const SETTINGS = {
  // Postage as a charged line, which is still a mode the shop can be put in.
  // The absorbed path is covered in tests/shipping-included.test.mjs.
  shipping: { label: 'Shipping', amount: 6, enabled: true, includedInPrices: false },
  fees: [],
  tax: { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false },
};

const saved = {};
let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  for (const key of ['GLOBAL_CONFIG', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) {
    saved[key] = process.env[key];
  }
  process.env.GLOBAL_CONFIG = 'https://global-config.vercel.com/ecfg_a/items?token=read';
  process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  delete process.env.RESEND_API_KEY;
  clearSeen();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearSeen();
});

// The store read goes through globalThis.fetch; the Stripe call is injected, so
// a broken store and a broken Stripe stay distinguishable.
function store({ items = [piece()], settings = SETTINGS, fail = false } = {}) {
  globalThis.fetch = async () => {
    if (fail) throw new Error('store down');
    return {
      ok: true,
      status: 200,
      async json() {
        return { [CATALOG_KEY]: items, [SETTINGS_KEY]: settings };
      },
    };
  };
}

function stripe({ status = 200, body = { id: 'cs_1', url: 'https://checkout.stripe.com/pay/x' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: new URLSearchParams(options.body) });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
}

const post = (cart) =>
  new Request('https://x/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-host': 'shop.example' },
    body: JSON.stringify({ cart }),
  });

/* ------------------------------------------------------------- checkout */

test('a good cart returns a Stripe url', async () => {
  store();
  const { calls, fetchImpl } = stripe();

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.url, 'https://checkout.stripe.com/pay/x');

  // Priced from the catalog and the stored settings: 12.99 + 6 postage.
  assert.equal(calls[0].body.get('line_items[0][price_data][unit_amount]'), '1299');
  assert.equal(calls[0].body.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'), '600');
});

test('a price sent by the browser is ignored', async () => {
  store();
  const { calls, fetchImpl } = stripe();

  // The attack: edit localStorage, pay one cent.
  await checkout(post([{ handle: 'beaded-pen', quantity: 1, price: 0.01, title: 'Free pen' }]), fetchImpl);

  assert.equal(calls[0].body.get('line_items[0][price_data][unit_amount]'), '1299');
  assert.equal(calls[0].body.get('line_items[0][price_data][product_data][name]'), 'Beaded Pen');
});

test('a hidden piece cannot be bought even by handle', async () => {
  store({ items: [piece({ hidden: true })] });
  const { calls, fetchImpl } = stripe();

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);

  assert.equal(response.status, 409);
  assert.equal(calls.length, 0, 'a hidden piece reached Stripe');
});

test('a sold-out piece is refused before any charge', async () => {
  store({ items: [piece({ stock: 0 })] });
  const { calls, fetchImpl } = stripe();

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.match(body.problems[0].message, /sold out/i);
  assert.equal(calls.length, 0);
});

test('more than the stock is reported rather than quietly reduced at Stripe', async () => {
  store({ items: [piece({ stock: 2 })] });
  const { calls, fetchImpl } = stripe();

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 5 }]), fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.match(body.problems[0].message, /Only 2/);
  // The customer sees this in their bag, not on a receipt.
  assert.equal(calls.length, 0);
});

test('an empty bag is refused', async () => {
  store();
  const { calls, fetchImpl } = stripe();

  assert.equal((await checkout(post([]), fetchImpl)).status, 400);
  assert.equal(calls.length, 0);
});

test('a piece that needs a design cannot be bought without one', async () => {
  store({
    items: [piece({ designs: { options: [{ id: 'd1', image: 'assets/a.jpg', name: 'One' }, { id: 'd2', image: 'assets/b.jpg', name: 'Two' }] } })],
  });
  const { calls, fetchImpl } = stripe();

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);

  assert.equal(response.status, 409);
  assert.equal(calls.length, 0);
});

test('no Stripe key means not switched on, not an error', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  store();
  const { fetchImpl } = stripe();

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not switched on/);
});

test('an unreachable store refuses rather than pricing from a stale copy', async () => {
  store({ fail: true });
  const { calls, fetchImpl } = stripe();

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);

  assert.equal(response.status, 503);
  // Charging against a catalog that might be months old is worse than waiting.
  assert.equal(calls.length, 0);
});

test('a refused Stripe key never tells the customer about the key', async () => {
  store();
  const { fetchImpl } = stripe({
    status: 401,
    body: { error: { message: 'Invalid API Key provided: sk_test_abc' } },
  });

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.match(body.error, /misconfigured/);
  assert.ok(!body.error.includes('sk_test'), 'a key fragment was leaked to the customer');
});

test('a session with no url is treated as a failure', async () => {
  store();
  const { fetchImpl } = stripe({ body: { id: 'cs_2' } });

  const response = await checkout(post([{ handle: 'beaded-pen', quantity: 1 }]), fetchImpl);

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Nothing has been charged/);
});

test('GET is refused', async () => {
  store();
  const response = await checkout(new Request('https://x/api/checkout'), stripe().fetchImpl);

  assert.equal(response.status, 405);
});

test('a body that is not JSON is refused', async () => {
  store();
  const request = new Request('https://x/api/checkout', { method: 'POST', body: 'not json' });

  assert.equal((await checkout(request, stripe().fetchImpl)).status, 400);
});

test('the cart travels in metadata so the webhook can rebuild the order', async () => {
  store();
  const { calls, fetchImpl } = stripe();

  await checkout(post([{ handle: 'beaded-pen', quantity: 3 }]), fetchImpl);

  assert.equal(calls[0].body.get('metadata[cart]'), 'beaded-pen::3');
  assert.match(calls[0].body.get('metadata[reference]'), /^SW-/);
});

/* -------------------------------------------------------------- webhook */

const event = (over = {}) => ({
  id: 'evt_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_1',
      payment_status: 'paid',
      amount_subtotal: 1299,
      amount_total: 1899,
      total_details: { amount_shipping: 600, amount_tax: 0 },
      metadata: { cart: 'beaded-pen::1', reference: 'SW-260927-001' },
      customer_details: { name: 'Jane Doe', email: 'jane@example.com' },
      collected_information: {
        shipping_details: {
          name: 'Jane Doe',
          address: { line1: '1 Example St', city: 'Springfield', state: 'IL', postal_code: '62701', country: 'US' },
        },
      },
      ...over,
    },
  },
});

function hook(payload, { secret = SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const signature = createHmac('sha256', secret).update(`${at}.${payload}`).digest('hex');

  return new Request('https://x/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${at},v1=${signature}` },
    body: payload,
  });
}

// Captures the order that would be emailed, without needing a mail provider.
function mail() {
  process.env.RESEND_API_KEY = 're_test';
  const sent = [];
  const fetchImpl = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  };
  return { sent, fetchImpl };
}

test('a signed paid session emails the order', async () => {
  store();
  const { sent, fetchImpl } = mail();

  const response = await webhook(hook(JSON.stringify(event())), fetchImpl);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.emailed, true);
  assert.equal(body.reference, 'SW-260927-001');

  assert.equal(sent.length, 1);
  // The piece is named from the catalog; the total is Stripe's.
  assert.match(sent[0].text, /Beaded Pen/);
  assert.match(sent[0].text, /\$18\.99/);
  assert.match(sent[0].text, /Jane Doe/);
  assert.match(sent[0].text, /1 Example St/);
  assert.match(sent[0].text, /Springfield, IL, 62701/);
  assert.equal(sent[0].reply_to, 'jane@example.com');
});

test('an unsigned request is refused and nothing is emailed', async () => {
  store();
  const { sent, fetchImpl } = mail();

  const request = new Request('https://x/api/stripe-webhook', {
    method: 'POST',
    body: JSON.stringify(event()),
  });

  const response = await webhook(request, fetchImpl);

  assert.equal(response.status, 400);
  assert.equal(sent.length, 0, 'an unverified event produced an order');
});

test('a forged signature is refused', async () => {
  store();
  const { sent, fetchImpl } = mail();

  const response = await webhook(hook(JSON.stringify(event()), { secret: 'whsec_wrong' }), fetchImpl);

  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
});

test('a replayed old event is refused', async () => {
  store();
  const { sent, fetchImpl } = mail();

  const at = Math.floor(Date.now() / 1000) - 7200;
  const response = await webhook(hook(JSON.stringify(event()), { at }), fetchImpl);

  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
});

test('the same event twice emails once', async () => {
  store();
  const { sent, fetchImpl } = mail();
  const payload = JSON.stringify(event());

  await webhook(hook(payload), fetchImpl);
  const second = await webhook(hook(payload), fetchImpl);

  assert.equal((await second.json()).duplicate, true);
  assert.equal(sent.length, 1, 'the order was emailed twice');
});

test('an unpaid session is acknowledged but not made', async () => {
  store();
  const { sent, fetchImpl } = mail();

  const response = await webhook(
    hook(JSON.stringify(event({ payment_status: 'unpaid' }))),
    fetchImpl
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).unpaid, true);
  assert.equal(sent.length, 0);
});

test('an event of another type is acknowledged rather than refused', async () => {
  store();
  const { sent, fetchImpl } = mail();

  const other = JSON.stringify({ id: 'evt_9', type: 'payment_intent.created', data: { object: {} } });
  const response = await webhook(hook(other), fetchImpl);

  // A non-2xx would make Stripe retry an event this code will never want.
  assert.equal(response.status, 200);
  assert.equal(sent.length, 0);
});

test('a failed email still returns 200, because the money has already moved', async () => {
  store();
  process.env.RESEND_API_KEY = 're_test';

  const fetchImpl = async () => {
    throw new Error('resend down');
  };

  const response = await webhook(hook(JSON.stringify(event())), fetchImpl);
  const body = await response.json();

  // Retrying would not fix the mail provider, and the order is already paid.
  assert.equal(response.status, 200);
  assert.equal(body.emailed, false);
  assert.equal(body.reference, 'SW-260927-001');
});

test('the older shipping_details shape is read too', async () => {
  store();
  const { sent, fetchImpl } = mail();

  const older = event({
    collected_information: undefined,
    shipping_details: {
      name: 'Old Shape',
      address: { line1: '2 Legacy Rd', city: 'Peoria', state: 'IL', postal_code: '61602', country: 'US' },
    },
  });

  await webhook(hook(JSON.stringify(older)), fetchImpl);

  assert.match(sent[0].text, /2 Legacy Rd/);
});

test('no webhook secret refuses the event and asks to be retried', async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  store();
  const { sent, fetchImpl } = mail();

  const response = await webhook(hook(JSON.stringify(event())), fetchImpl);

  // 503 rather than 400: the event is worth keeping, the fix is configuration.
  assert.equal(response.status, 503);
  assert.equal(sent.length, 0);
});

test('an unreachable store still says what was ordered', async () => {
  store({ fail: true });
  const { sent, fetchImpl } = mail();

  // The money has already moved, so an order must reach a human regardless - and
  // an order that says what was paid but not what to make is not fulfillable.
  const response = await webhook(hook(JSON.stringify(event())), fetchImpl);

  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /\$18\.99/);

  assert.match(sent[0].text, /could not be looked up/);
  assert.match(sent[0].text, /store was unreachable/);
  // The raw identifiers, so nothing about the order is actually lost.
  assert.match(sent[0].text, /beaded-pen::1/);
});

test('a piece deleted between paying and the webhook is still reported', async () => {
  store({ items: [] });
  const { sent, fetchImpl } = mail();

  await webhook(hook(JSON.stringify(event())), fetchImpl);

  assert.match(sent[0].text, /could not be looked up/);
  assert.match(sent[0].text, /beaded-pen::1/);
  // Not blamed on the store, which was reachable.
  assert.ok(!sent[0].text.includes('unreachable'));
});

test('a fully resolved order carries no apology note', async () => {
  store();
  const { sent, fetchImpl } = mail();

  await webhook(hook(JSON.stringify(event())), fetchImpl);

  assert.ok(!sent[0].text.includes('could not be looked up'));
});

test('GET is refused', async () => {
  const response = await webhook(new Request('https://x/api/stripe-webhook'), stripe().fetchImpl);

  assert.equal(response.status, 405);
});
