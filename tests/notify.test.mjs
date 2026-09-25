// Order forwarding. The failure that matters here is not an ugly email, it is
// an order that arrives at nobody, so most of what follows is about what
// happens when the provider says no.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readNotifyConfig,
  escapeHtml,
  orderEmail,
  sendEmail,
  sendOrderEmail,
  orderReference,
} from '../lib/notify.mjs';
import { orderTotal } from '../lib/settings.mjs';

const KEY = { RESEND_API_KEY: 're_test_key' };

const item = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded pen',
  designName: 'Blue holographic',
  price: 12,
  quantity: 1,
  choices: [],
  ...over,
});

const order = (over = {}) => ({
  reference: 'SW-260925-001',
  items: [item()],
  totals: orderTotal([item()], null),
  customer: { name: 'Jane Doe', email: 'jane@example.com' },
  ...over,
});

/* ---------------------------------------------------------- configuration */

test('no API key means not configured, not a broken send', () => {
  assert.equal(readNotifyConfig({}).ok, false);
  assert.equal(readNotifyConfig({}).reason, 'not-configured');
  // Whitespace is not a key.
  assert.equal(readNotifyConfig({ RESEND_API_KEY: '   ' }).ok, false);
});

test('the shop address is the default recipient, so one key is enough setup', () => {
  const config = readNotifyConfig(KEY);
  assert.equal(config.ok, true);
  assert.equal(config.to, 'stitch.wishess@gmail.com');
  assert.match(config.from, /resend\.dev/);
});

test('recipient and sender can both be overridden', () => {
  const config = readNotifyConfig({
    ...KEY,
    ORDER_EMAIL_TO: 'someone@else.com',
    ORDER_EMAIL_FROM: 'Shop <orders@shop.com>',
  });
  assert.equal(config.to, 'someone@else.com');
  assert.equal(config.from, 'Shop <orders@shop.com>');
});

/* -------------------------------------------------------------- escaping */

test('ampersands are escaped before the escapes they would corrupt', () => {
  // The order matters: escaping & last would turn &lt; into &amp;lt;.
  assert.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});

test("a customer's name cannot inject markup into the email", () => {
  const { html, text } = orderEmail(
    order({ customer: { name: '<script>alert(1)</script>', email: 'a@b.com' } })
  );

  assert.ok(!html.includes('<script>'), 'script tag survived into the HTML body');
  assert.ok(html.includes('&lt;script&gt;'));
  // Plain text has no markup to inject, so it is left readable.
  assert.ok(text.includes('<script>'));
});

test('a note cannot inject markup either, and keeps its paragraph breaks', () => {
  const { html } = orderEmail(
    order({
      customer: {
        name: 'Jane',
        email: 'a@b.com',
        note: 'line one\n\n<img src=x onerror=alert(1)>',
      },
    })
  );

  assert.ok(!html.includes('<img'), 'img tag survived into the HTML body');
  assert.ok(html.includes('white-space:pre-line'), 'line breaks were not preserved');
});

/* --------------------------------------------------------------- subject */

test('the subject carries the total, the name and the count', () => {
  const { subject } = orderEmail(order());
  assert.match(subject, /New order/);
  assert.match(subject, /\$12\.00/);
  assert.match(subject, /Jane Doe/);
  assert.match(subject, /1 piece\b/);
});

test('the count is plural for more than one, and counts quantity not rows', () => {
  const items = [item({ quantity: 2 }), item({ handle: 'night-light', quantity: 1 })];
  const { subject } = orderEmail({ ...order(), items, totals: orderTotal(items, null) });
  assert.match(subject, /3 pieces/);
});

test('a newline in a name cannot break the subject header', () => {
  const { subject } = orderEmail(
    order({ customer: { name: 'Jane\nBcc: someone@evil.com', email: 'a@b.com' } })
  );
  assert.ok(!subject.includes('\n'), 'subject contains a newline');
});

test('a test send says so in the subject and in the body', () => {
  const sample = orderEmail({ ...order(), test: true });
  assert.match(sample.subject, /^\[Test\]/);
  assert.match(sample.text, /This is a test/);
  assert.match(sample.html, /This is a test/);
});

/* ----------------------------------------------------------------- items */

test('every line says what to make: piece, design, choices and handle', () => {
  const { text, html } = orderEmail(
    order({
      items: [item({ quantity: 2, choices: [{ label: 'Ink', value: 'Black' }] })],
    })
  );

  for (const body of [text, html]) {
    assert.match(body, /Beaded pen/);
    assert.match(body, /Blue holographic/);
    assert.match(body, /Ink/);
    assert.match(body, /Black/);
    // The handle is how the piece is found in the admin panel.
    assert.match(body, /beaded-pen/);
  }
});

test('a row multiplies through cents rather than in floating point', () => {
  // 3 * 19.99 is 59.969999999999999 in floating point.
  const items = [item({ price: 19.99, quantity: 3 })];
  const { text } = orderEmail({ ...order(), items, totals: orderTotal(items, null) });

  assert.match(text, /\$59\.97/);
  assert.ok(!text.includes('59.96'), 'a floating-point artefact reached the email');
});

test('an order with no items still produces a readable email', () => {
  const empty = orderEmail({ items: [], totals: orderTotal([], null), customer: {} });
  assert.match(empty.subject, /\$0\.00/);
  assert.match(empty.text, /not given/);
});

test('shipping, fees and tax each appear as their own line', () => {
  const items = [item()];
  const totals = orderTotal(items, {
    shipping: { label: 'Shipping', amount: 5, enabled: true },
    fees: [{ label: 'Gift wrap', amount: 2, enabled: true }],
    tax: { label: 'Sales tax', rate: 10, enabled: true, includeShipping: false },
  });

  const { text, html } = orderEmail({ ...order(), items, totals });

  for (const body of [text, html]) {
    assert.match(body, /Shipping/);
    assert.match(body, /Gift wrap/);
    assert.match(body, /Sales tax/);
  }
  // 12 + 5 + 2 + 1.20
  assert.match(text, /\$20\.20/);
});

/* -------------------------------------------------------------- reply-to */

test('a plausible customer address becomes the reply-to', () => {
  assert.equal(orderEmail(order()).replyTo, 'jane@example.com');
});

test('an unusable address is left out rather than risking the whole send', () => {
  for (const bad of ['not an email', '', null, 'a@b', 'two@addresses.com, x@y.com']) {
    const { replyTo } = orderEmail(order({ customer: { name: 'Jane', email: bad } }));
    assert.equal(replyTo, null, `${JSON.stringify(bad)} was used as a reply-to`);
  }
});

test('an unusable address is still shown in the body, since it is all there is', () => {
  const { text } = orderEmail(order({ customer: { name: 'Jane', email: 'jane at example' } }));
  assert.match(text, /jane at example/);
});

/* --------------------------------------------------------------- sending */

function stub(status, body = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchImpl };
}

test('a successful send returns the provider id', async () => {
  const { calls, fetchImpl } = stub(200, { id: 'abc-123' });
  const result = await sendEmail(KEY, orderEmail(order()), fetchImpl);

  assert.deepEqual(result, { ok: true, id: 'abc-123' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.resend\.com/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer re_test_key');
  assert.deepEqual(calls[0].body.to, ['stitch.wishess@gmail.com']);
  assert.equal(calls[0].body.reply_to, 'jane@example.com');
  // Both parts, so a client that blocks HTML still shows the order.
  assert.ok(calls[0].body.text.length > 0);
  assert.ok(calls[0].body.html.length > 0);
});

test('no reply_to field at all when there is no usable address', async () => {
  const { calls, fetchImpl } = stub(200, { id: 'x' });
  await sendEmail(KEY, orderEmail(order({ customer: { name: 'J', email: 'nope' } })), fetchImpl);

  assert.ok(!('reply_to' in calls[0].body), 'sent an empty reply_to');
});

test('nothing is sent when there is no key', async () => {
  const { calls, fetchImpl } = stub(200);
  const result = await sendEmail({}, orderEmail(order()), fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-configured');
  assert.equal(calls.length, 0, 'called the provider without a key');
});

test('a refused key is reported as a key problem, with the reason', async () => {
  for (const status of [401, 403]) {
    const { fetchImpl } = stub(status, { message: 'API key is invalid' });
    const result = await sendEmail(KEY, orderEmail(order()), fetchImpl);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'rejected-key');
    assert.equal(result.status, status);
    // The provider's own words travel out. This is the difference between a
    // fixable error and a shrug.
    assert.match(result.detail, /API key is invalid/);
  }
});

test('the resend.dev recipient restriction arrives as a readable detail', async () => {
  // The real 403 when sending to anyone but the account owner. This is the
  // most likely first failure of this whole feature, so it must be legible.
  const { fetchImpl } = stub(403, {
    message: 'You can only send testing emails to your own email address',
  });
  const result = await sendEmail(KEY, orderEmail(order()), fetchImpl);

  assert.match(result.detail, /your own email address/);
});

test('rate limiting is its own reason, because waiting is the fix', async () => {
  const { fetchImpl } = stub(429, { message: 'Too many requests' });
  const result = await sendEmail(KEY, orderEmail(order()), fetchImpl);

  assert.equal(result.reason, 'rate-limited');
});

test('any other refusal is reported rather than thrown', async () => {
  const { fetchImpl } = stub(422, { message: 'Invalid `to` field' });
  const result = await sendEmail(KEY, orderEmail(order()), fetchImpl);

  assert.equal(result.reason, 'refused');
  assert.match(result.detail, /Invalid/);
});

test('a non-JSON error body still yields a detail', async () => {
  const fetchImpl = async () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
  const result = await sendEmail(KEY, orderEmail(order()), fetchImpl);

  assert.equal(result.ok, false);
  assert.match(result.detail, /Bad Gateway/);
});

test('a network failure is a returned reason, never an exception', async () => {
  const fetchImpl = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const result = await sendEmail(KEY, orderEmail(order()), fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
  assert.match(result.detail, /ENOTFOUND/);
});

test('sendOrderEmail swallows a failure so a paid order is never rejected for it', async () => {
  const fetchImpl = async () => {
    throw new Error('down');
  };

  // The contract the payment webhook depends on: this resolves, always.
  const result = await sendOrderEmail(KEY, order(), fetchImpl);
  assert.equal(result.ok, false);
});

/* ------------------------------------------------------------- reference */

test('an order reference is short, dated and sayable out loud', () => {
  const ref = orderReference(new Date('2026-09-25T10:00:00Z'), () => 0.42);
  assert.equal(ref, 'SW-260925-420');
  assert.match(orderReference(), /^SW-\d{6}-\d{3}$/);
});
