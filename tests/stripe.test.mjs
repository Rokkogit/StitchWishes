// The money path: form encoding, the total guard, and webhook signatures.
//
// The webhook tests are the ones that matter most. That endpoint is public and
// unauthenticated, so a signature check that can be fooled is a way for anyone
// who knows the URL to claim an order was paid for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  toCents,
  readStripeConfig,
  formEncode,
  createCheckoutSession,
  parseSignature,
  verifyWebhook,
  encodeCart,
  decodeCart,
  cartMetadata,
  cartFromMetadata,
} from '../lib/stripe.mjs';
import {
  lineItems,
  sessionParams,
  stripeTotalCents,
  checkedSessionParams,
} from '../lib/checkout.mjs';
import { orderTotal } from '../lib/settings.mjs';

const ORIGIN = 'https://shop.example';
const KEY = { STRIPE_SECRET_KEY: 'sk_test_abc' };
const SECRET = 'whsec_testsecret';

const item = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded pen',
  designName: 'Blue holographic',
  design: 'd1',
  price: 12.99,
  quantity: 1,
  image: 'assets/pen.jpg',
  choices: [],
  ...over,
});

const CHARGES = {
  shipping: { label: 'Shipping', amount: 6, enabled: true },
  fees: [],
  tax: { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false },
};

/* ------------------------------------------------------------------ money */

test('dollars become cents without floating-point drift', () => {
  assert.equal(toCents(12.99), 1299);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(19.995), 2000);
  assert.equal(toCents(0), 0);
});

test('a live key is distinguishable from a test key', () => {
  assert.equal(readStripeConfig(KEY).live, false);
  assert.equal(readStripeConfig({ STRIPE_SECRET_KEY: 'sk_live_x' }).live, true);
  assert.equal(readStripeConfig({}).ok, false);
  assert.equal(readStripeConfig({ STRIPE_SECRET_KEY: '  ' }).ok, false);
});

/* --------------------------------------------------------------- encoding */

test('nested parameters encode the way Stripe expects', () => {
  const encoded = formEncode({
    mode: 'payment',
    line_items: [{ price_data: { currency: 'usd', unit_amount: 1299 }, quantity: 2 }],
  });

  assert.ok(encoded.includes('mode=payment'));
  assert.ok(encoded.includes('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1299'));
  assert.ok(encoded.includes('line_items%5B0%5D%5Bquantity%5D=2'));
});

test('undefined values are dropped rather than sent as the string undefined', () => {
  const encoded = formEncode({ a: 1, b: undefined, c: null });

  assert.deepEqual(encoded, ['a=1']);
});

test('a name with an ampersand survives encoding', () => {
  const encoded = formEncode({ name: 'Pens & things' });

  assert.deepEqual(encoded, ['name=Pens%20%26%20things']);
});

/* ------------------------------------------------------------ line items */

test('a line carries the piece, the design and the choices', () => {
  const [line] = lineItems(
    [item({ choices: [{ label: 'Ink', value: 'Black' }] })],
    ORIGIN
  );

  assert.equal(line.price_data.product_data.name, 'Beaded pen — Blue holographic');
  assert.equal(line.price_data.product_data.description, 'Ink: Black');
  assert.equal(line.price_data.unit_amount, 1299);
  assert.deepEqual(line.price_data.product_data.images, ['https://shop.example/assets/pen.jpg']);
});

test('the photograph is absolute, since Stripe fetches it from outside', () => {
  const blob = 'https://abc.public.blob.vercel-storage.com/uploads/x.jpg';
  const [line] = lineItems([item({ image: blob })], ORIGIN);

  assert.deepEqual(line.price_data.product_data.images, [blob]);
});

test('no photograph means no images key at all', () => {
  const [line] = lineItems([item({ image: null })], ORIGIN);

  assert.equal(line.price_data.product_data.images, undefined);
});

/* ---------------------------------------------------------------- session */

test('shipping is a shipping option, not a product on the receipt', () => {
  const items = [item()];
  const params = sessionParams({
    items,
    totals: orderTotal(items, CHARGES),
    settings: CHARGES,
    origin: ORIGIN,
    reference: 'SW-1',
  });

  assert.equal(params.shipping_options[0].shipping_rate_data.fixed_amount.amount, 600);
  assert.equal(params.shipping_options[0].shipping_rate_data.display_name, 'Shipping');
  // One line item: the pen. Postage is not a thing she made.
  assert.equal(params.line_items.length, 1);
});

test('free shipping sends no shipping option', () => {
  const settings = { ...CHARGES, shipping: { label: 'Shipping', amount: 0, enabled: false } };
  const items = [item()];

  const params = sessionParams({
    items,
    totals: orderTotal(items, settings),
    settings,
    origin: ORIGIN,
  });

  assert.equal(params.shipping_options, undefined);
});

test('fees and tax become their own labelled lines', () => {
  const settings = {
    shipping: { label: 'Shipping', amount: 6, enabled: true },
    fees: [
      { label: 'Gift wrap', amount: 2, enabled: true },
      { label: 'Switched off', amount: 99, enabled: false },
    ],
    tax: { label: 'Sales tax', rate: 10, enabled: true, includeShipping: false },
  };

  const items = [item()];
  const params = sessionParams({
    items,
    totals: orderTotal(items, settings),
    settings,
    origin: ORIGIN,
  });

  const names = params.line_items.map((line) => line.price_data.product_data.name);

  assert.ok(names.includes('Gift wrap'));
  assert.ok(!names.includes('Switched off'), 'a disabled fee was charged');
  // The rate is in the label so a customer can check the arithmetic.
  assert.ok(names.some((name) => name === 'Sales tax (10%)'));
});

test('only US addresses are collected, matching the policy', () => {
  const items = [item()];
  const params = sessionParams({ items, totals: orderTotal(items, CHARGES), settings: CHARGES, origin: ORIGIN });

  assert.deepEqual(params.shipping_address_collection.allowed_countries, ['US']);
});

test('the success url carries the session placeholder and the cancel url returns to the bag', () => {
  const items = [item()];
  const params = sessionParams({ items, totals: orderTotal(items, CHARGES), settings: CHARGES, origin: ORIGIN });

  assert.equal(params.success_url, 'https://shop.example/thanks?session={CHECKOUT_SESSION_ID}');
  assert.equal(params.cancel_url, 'https://shop.example/bag');
});

test('payment method types are left unset so wallets appear on their own', () => {
  const items = [item()];
  const params = sessionParams({ items, totals: orderTotal(items, CHARGES), settings: CHARGES, origin: ORIGIN });

  assert.equal(params.payment_method_types, undefined);
});

/* ------------------------------------------------------- the total guard */

test('what Stripe will charge equals what the bag showed', () => {
  const items = [item({ quantity: 2 }), item({ handle: 'night-light', price: 24, quantity: 1 })];
  const settings = {
    shipping: { label: 'Shipping', amount: 6, enabled: true },
    fees: [{ label: 'Gift wrap', amount: 2, enabled: true }],
    tax: { label: 'Sales tax', rate: 9.5, enabled: true, includeShipping: false },
  };

  const totals = orderTotal(items, settings);
  const checked = checkedSessionParams({ items, totals, settings, origin: ORIGIN });

  assert.equal(checked.ok, true);
  assert.equal(checked.cents, toCents(totals.total));
  assert.equal(stripeTotalCents(checked.params), toCents(totals.total));
});

test('a mismatch refuses rather than charging a different number', () => {
  const items = [item()];
  const totals = { ...orderTotal(items, CHARGES), total: 999 };

  const checked = checkedSessionParams({ items, totals, settings: CHARGES, origin: ORIGIN });

  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'total-mismatch');
  // Both figures are reported, because the difference is the diagnostic.
  assert.equal(checked.expected, 99_900);
  assert.equal(checked.actual, 1899);
});

test('three of an odd price still agrees to the cent', () => {
  // 3 * 19.99 is 59.969999999999999 in floating point.
  const items = [item({ price: 19.99, quantity: 3 })];
  const totals = orderTotal(items, CHARGES);

  const checked = checkedSessionParams({ items, totals, settings: CHARGES, origin: ORIGIN });

  assert.equal(checked.ok, true);
  assert.equal(checked.cents, 6597);
});

/* --------------------------------------------------------- cart metadata */

test('a cart survives the trip through Stripe metadata', () => {
  const items = [item({ quantity: 2 }), item({ handle: 'night-light', design: null })];
  const back = cartFromMetadata(cartMetadata(items));

  assert.deepEqual(back, [
    { handle: 'beaded-pen', design: 'd1', quantity: 2 },
    { handle: 'night-light', design: null, quantity: 1 },
  ]);
});

test('a cart too long for one metadata value is split, not truncated', () => {
  // Truncation would be an order arriving short of pieces somebody paid for.
  const many = Array.from({ length: 60 }, (_, i) =>
    item({ handle: `a-rather-long-product-handle-number-${i}`, design: `design-${i}` })
  );

  const metadata = cartMetadata(many);
  assert.ok(Object.keys(metadata).length > 1, 'was not split');
  for (const value of Object.values(metadata)) {
    assert.ok(value.length <= 500, 'a value exceeded the metadata limit');
  }

  assert.equal(cartFromMetadata(metadata).length, 60);
});

test('metadata chunks reassemble in order, not alphabetically', () => {
  // cart_10 sorts before cart_2 as a string, which would scramble the cart.
  const metadata = {};
  for (let i = 0; i < 12; i += 1) metadata[`cart_${i}`] = `h${i}::1|`;

  const cart = cartFromMetadata(metadata);
  assert.equal(cart[2].handle, 'h2');
  assert.equal(cart[10].handle, 'h10');
});

test('rubbish metadata yields an empty cart rather than throwing', () => {
  assert.deepEqual(cartFromMetadata({}), []);
  assert.deepEqual(cartFromMetadata({ cart: '' }), []);
  assert.deepEqual(decodeCart('||::||'), []);
  assert.deepEqual(decodeCart(null), []);
});

test('a quantity that is not a number falls back to one', () => {
  assert.deepEqual(decodeCart('pen:d1:abc'), [{ handle: 'pen', design: 'd1', quantity: 1 }]);
  assert.deepEqual(decodeCart('pen:d1:-5'), [{ handle: 'pen', design: 'd1', quantity: 1 }]);
});

/* --------------------------------------------------------- the api call */

test('a session is created with a bearer key and form encoding', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/x' }), {
      status: 200,
    });
  };

  const result = await createCheckoutSession(readStripeConfig(KEY), { mode: 'payment' }, fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.value.url, 'https://checkout.stripe.com/x');
  assert.match(calls[0].url, /api\.stripe\.com\/v1\/checkout\/sessions/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk_test_abc');
  assert.match(calls[0].options.headers['Content-Type'], /x-www-form-urlencoded/);
});

test("Stripe's own error message is carried out, not replaced", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid API Key provided', code: 'api_key_invalid' } }), {
      status: 401,
    });

  const result = await createCheckoutSession(readStripeConfig(KEY), {}, fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rejected-key');
  assert.match(result.detail, /Invalid API Key/);
  assert.equal(result.code, 'api_key_invalid');
});

test('an unreachable Stripe is a returned reason, never an exception', async () => {
  const fetchImpl = async () => {
    throw new Error('ENOTFOUND');
  };

  const result = await createCheckoutSession(readStripeConfig(KEY), {}, fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
});

/* ------------------------------------------------- webhook verification */

const sign = (payload, secret = SECRET, at = Math.floor(Date.now() / 1000)) => {
  const signature = createHmac('sha256', secret).update(`${at}.${payload}`, 'utf8').digest('hex');
  return `t=${at},v1=${signature}`;
};

test('the signature header is parsed, including a rotation with two signatures', () => {
  const parsed = parseSignature('t=123,v1=aaa,v1=bbb,v0=ignored');

  assert.equal(parsed.timestamp, '123');
  assert.deepEqual(parsed.signatures, ['aaa', 'bbb']);
});

test('a genuine event verifies and comes back parsed', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const result = verifyWebhook(SECRET, payload, sign(payload));

  assert.equal(result.ok, true);
  assert.equal(result.event.id, 'evt_1');
});

test('either signature verifying is enough, so a secret rotation does not drop events', () => {
  const payload = '{"id":"evt_2"}';
  const at = Math.floor(Date.now() / 1000);
  const good = createHmac('sha256', SECRET).update(`${at}.${payload}`).digest('hex');

  const header = `t=${at},v1=${'0'.repeat(64)},v1=${good}`;
  assert.equal(verifyWebhook(SECRET, payload, header).ok, true);
});

test('a forged signature is refused', () => {
  const payload = '{"id":"evt_3"}';
  const at = Math.floor(Date.now() / 1000);

  assert.equal(verifyWebhook(SECRET, payload, `t=${at},v1=${'a'.repeat(64)}`).reason, 'bad-signature');
});

test('a signature made with the wrong secret is refused', () => {
  const payload = '{"id":"evt_4"}';

  assert.equal(verifyWebhook(SECRET, payload, sign(payload, 'whsec_someoneelse')).reason, 'bad-signature');
});

test('a body altered after signing is refused', () => {
  const payload = '{"amount_total":1299}';
  const header = sign(payload);

  // The attack this stops: a valid signature replayed over a bigger order.
  assert.equal(verifyWebhook(SECRET, '{"amount_total":1}', header).reason, 'bad-signature');
});

test('re-serialised JSON does not verify, which is why the raw body is used', () => {
  const payload = JSON.stringify({ id: 'evt_5', a: 1 });
  const header = sign(payload);

  // Same data, different bytes. This is the most common way this check is
  // broken by accident.
  const reserialised = JSON.stringify(JSON.parse(payload), null, 2);
  assert.equal(verifyWebhook(SECRET, reserialised, header).ok, false);
});

test('an old event is refused, so a captured request cannot be replayed', () => {
  const payload = '{"id":"evt_6"}';
  const longAgo = Math.floor(Date.now() / 1000) - 3600;

  assert.equal(verifyWebhook(SECRET, payload, sign(payload, SECRET, longAgo)).reason, 'stale');
});

test('a timestamp from the future is refused too', () => {
  const payload = '{"id":"evt_7"}';
  const ahead = Math.floor(Date.now() / 1000) + 3600;

  assert.equal(verifyWebhook(SECRET, payload, sign(payload, SECRET, ahead)).reason, 'stale');
});

test('a missing or malformed header is refused', () => {
  for (const header of [null, '', 'garbage', 't=123', `v1=${'a'.repeat(64)}`]) {
    const result = verifyWebhook(SECRET, '{}', header);
    assert.equal(result.ok, false, String(header));
  }
});

test('no configured secret refuses everything rather than trusting anything', () => {
  const payload = '{"id":"evt_8"}';

  assert.equal(verifyWebhook('', payload, sign(payload)).reason, 'not-configured');
});

test('a verified body that is not JSON is reported, not thrown', () => {
  const payload = 'not json at all';

  assert.equal(verifyWebhook(SECRET, payload, sign(payload)).reason, 'unreadable');
});
