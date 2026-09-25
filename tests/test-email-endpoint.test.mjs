// The endpoint behind the "send me a test order" button.
// globalThis.fetch is swapped per test, so nothing reaches Resend or Vercel.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import testEmail from '../api/admin-test-email.mjs';
import { createToken, COOKIE_NAME } from '../lib/session.mjs';
import { SETTINGS_KEY } from '../lib/global-config.mjs';

const SECRET = 'f'.repeat(64);

const saved = {};
let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  for (const key of [
    'ADMIN_CODE',
    'ADMIN_SESSION_SECRET',
    'GLOBAL_CONFIG',
    'RESEND_API_KEY',
    'ORDER_EMAIL_TO',
  ]) {
    saved[key] = process.env[key];
  }
  process.env.ADMIN_CODE = 'test-passphrase-fixture';
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.GLOBAL_CONFIG = 'https://global-config.vercel.com/ecfg_abc/items?token=read-token';
  process.env.RESEND_API_KEY = 're_test_key';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// One stub for both the settings read and the Resend send.
function stub({ sendStatus = 200, sendBody = { id: 'sent-1' }, settings = null } = {}) {
  const sends = [];

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);

    if (href.startsWith('https://api.resend.com')) {
      sends.push({ ...options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(sendBody), { status: sendStatus });
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return settings ? { [SETTINGS_KEY]: settings } : {};
      },
    };
  };

  return sends;
}

const authCookie = () => `${COOKIE_NAME}=${createToken(SECRET, 60_000)}`;

const request = (cookie = authCookie(), method = 'POST') =>
  new Request('https://x/api/admin-test-email', {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });

/* ------------------------------------------------------------------- auth */

test('sending mail requires a session', async () => {
  const sends = stub();
  const response = await testEmail.fetch(request(null));

  assert.equal(response.status, 401);
  // The point of the gate: an open endpoint that sends email on demand is a
  // way for a stranger to fill the shop's inbox.
  assert.equal(sends.length, 0, 'sent mail for an anonymous request');
});

test('a forged cookie does not get in', async () => {
  const sends = stub();
  const response = await testEmail.fetch(request(`${COOKIE_NAME}=not.a.token`));

  assert.equal(response.status, 401);
  assert.equal(sends.length, 0);
});

test('GET is refused', async () => {
  stub();
  const response = await testEmail.fetch(request(authCookie(), 'GET'));

  assert.equal(response.status, 405);
});

/* --------------------------------------------------------------- not set up */

test('a missing key says which variable to set rather than just failing', async () => {
  delete process.env.RESEND_API_KEY;
  const sends = stub();

  const response = await testEmail.fetch(request());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /RESEND_API_KEY/);
  assert.equal(sends.length, 0);
});

/* ------------------------------------------------------------------ happy */

test('a test order goes out, marked as a test', async () => {
  const sends = stub();
  const response = await testEmail.fetch(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.to, 'stitch.wishess@gmail.com');

  assert.equal(sends.length, 1);
  assert.match(sends[0].body.subject, /^\[Test\]/);
  // Unmistakably a test in the body too, so it can never be mistaken for a
  // parcel that needs making.
  assert.match(sends[0].body.text, /No real order was placed/);
});

test('the sample is priced with the live checkout settings when there are any', async () => {
  const sends = stub({
    settings: {
      shipping: { label: 'Postage', amount: 7.5, enabled: true },
      fees: [],
      tax: { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false },
    },
  });

  const body = await (await testEmail.fetch(request())).json();

  assert.match(body.pricedWith, /live/);
  // Proof the real settings were used: her own label and amount, not a default.
  assert.match(sends[0].body.text, /Postage/);
  assert.match(sends[0].body.text, /\$7\.50/);
});

test('an unreachable settings store still lets email be tested', async () => {
  // These are two separate systems, and a broken one should not mask the other.
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('https://api.resend.com')) {
      return new Response(JSON.stringify({ id: 'sent-2' }), { status: 200 });
    }
    throw new Error('store down');
  };

  const response = await testEmail.fetch(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.match(body.pricedWith, /default/);
});

/* --------------------------------------------------------------- failures */

test('a refused key is explained, with the provider\'s own words', async () => {
  stub({ sendStatus: 403, sendBody: { message: 'API key is invalid' } });

  const body = await (await testEmail.fetch(request())).json();

  assert.match(body.error, /refused/);
  assert.match(body.error, /API key is invalid/);
  assert.match(body.error, /HTTP 403/);
});

test('rate limiting tells her to wait rather than to fix something', async () => {
  stub({ sendStatus: 429, sendBody: { message: 'Too many requests' } });

  const body = await (await testEmail.fetch(request())).json();

  assert.match(body.error, /rate-limiting/);
  assert.match(body.error, /again in a minute/);
});

test('any other refusal still carries the detail out', async () => {
  stub({ sendStatus: 422, sendBody: { message: 'Invalid `to` field' } });

  const response = await testEmail.fetch(request());
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.match(body.error, /Invalid/);
});
