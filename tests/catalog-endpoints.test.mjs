// Catalog endpoints, driven with real Request objects.
// globalThis.fetch is swapped per test so no call reaches Vercel.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import publicCatalog from '../api/catalog.mjs';
import adminCatalog from '../api/admin-catalog.mjs';
import { createToken, COOKIE_NAME } from '../lib/session.mjs';
import { CATALOG_KEY } from '../lib/global-config.mjs';

const SECRET = 'f'.repeat(64);
const CODE = 'test-passphrase-fixture';
const ID = 'ecfg_abc123';
const DIGEST = 'digest-one';

const piece = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded Pen',
  price: 12.99,
  description: 'A hand-beaded pen made in the studio.',
  images: ['assets/IMG_4082.png'],
  hidden: false,
  ...over,
});

const saved = {};
let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  for (const key of ['ADMIN_CODE', 'ADMIN_SESSION_SECRET', 'GLOBAL_CONFIG', 'VERCEL_API_TOKEN']) {
    saved[key] = process.env[key];
  }
  process.env.ADMIN_CODE = CODE;
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.GLOBAL_CONFIG = `https://global-config.vercel.com/${ID}?token=read-token`;
  process.env.VERCEL_API_TOKEN = 'api-token';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// Routes by URL so one stub can serve items, digest and the write.
function stub({ items = [piece()], digest = DIGEST, writeStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });

    const reply = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
    });

    if (href.includes('/digest')) return reply(200, { digest });
    if (href.startsWith('https://api.vercel.com')) return reply(writeStatus, { status: 'ok' });
    return reply(200, items === null ? {} : { [CATALOG_KEY]: items });
  };
  return calls;
}

const authCookie = () => `${COOKIE_NAME}=${createToken(SECRET, 60_000)}`;

const adminGet = (cookie = authCookie()) =>
  new Request('https://x/api/admin-catalog', { method: 'GET', headers: cookie ? { Cookie: cookie } : {} });

const adminPost = (body, cookie = authCookie()) =>
  new Request('https://x/api/admin-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

/* ------------------------------------------------------- public /api/catalog */

test('the public catalog returns the stored products', async () => {
  stub();

  const response = await publicCatalog.fetch(new Request('https://x/api/catalog'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.products.length, 1);
  assert.equal(body.products[0].handle, 'beaded-pen');
});

// A hidden piece must never be delivered to a visitor, not merely not drawn.
test('the public catalog omits hidden pieces entirely', async () => {
  stub({ items: [piece(), piece({ handle: 'secret', title: 'Secret', hidden: true })] });

  const body = await (await publicCatalog.fetch(new Request('https://x/api/catalog'))).json();

  assert.equal(body.products.length, 1);
  assert.ok(!JSON.stringify(body).includes('Secret'));
});

test('the public catalog is CDN-cacheable', async () => {
  stub();

  const response = await publicCatalog.fetch(new Request('https://x/api/catalog'));

  assert.match(response.headers.get('cache-control') ?? '', /s-maxage=\d+/);
});

test('the public catalog needs no authentication', async () => {
  stub();

  const response = await publicCatalog.fetch(new Request('https://x/api/catalog'));

  assert.equal(response.status, 200);
});

test('the public catalog reports failure so the page can fall back', async () => {
  delete process.env.GLOBAL_CONFIG;

  const response = await publicCatalog.fetch(new Request('https://x/api/catalog'));

  assert.equal(response.status, 503);
});

test('an unseeded store tells the page to fall back rather than serving nothing', async () => {
  stub({ items: null });

  const response = await publicCatalog.fetch(new Request('https://x/api/catalog'));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.fallback, true);
});

test('a deliberately emptied but seeded store is served as empty', async () => {
  stub({ items: [] });

  const response = await publicCatalog.fetch(new Request('https://x/api/catalog'));

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).products, []);
});

test('the public catalog rejects a POST', async () => {
  stub();

  const response = await publicCatalog.fetch(new Request('https://x/api/catalog', { method: 'POST' }));

  assert.equal(response.status, 405);
});

/* --------------------------------------------------- admin GET /api/admin-catalog */

test('the admin catalog refuses an unauthenticated GET', async () => {
  stub();

  const response = await adminCatalog.fetch(adminGet(null));

  assert.equal(response.status, 401);
});

test('the admin catalog refuses a forged cookie', async () => {
  stub();

  const forged = `${COOKIE_NAME}=${createToken('0'.repeat(64), 60_000)}`;

  assert.equal((await adminCatalog.fetch(adminGet(forged))).status, 401);
});

test('an authenticated GET returns products, digest and the asset list', async () => {
  stub();

  const body = await (await adminCatalog.fetch(adminGet())).json();

  assert.equal(body.products.length, 1);
  assert.equal(body.digest, DIGEST);
  assert.ok(Array.isArray(body.assets));
  assert.ok(body.assets.length > 0, 'the picker needs images to offer');
});

test('an authenticated GET includes hidden pieces, unlike the public route', async () => {
  stub({ items: [piece(), piece({ handle: 'secret', hidden: true })] });

  const body = await (await adminCatalog.fetch(adminGet())).json();

  assert.equal(body.products.length, 2);
});

test('an authenticated GET reports catalog health', async () => {
  stub({ items: [piece(), piece({ handle: 'bare', price: null, images: [] })] });

  const body = await (await adminCatalog.fetch(adminGet())).json();

  assert.equal(body.health.total, 2);
  assert.equal(body.health.noPrice, 1);
  assert.equal(body.health.noPhoto, 1);
});

test('an authenticated GET flags a store that has never been seeded', async () => {
  stub({ items: null });

  const body = await (await adminCatalog.fetch(adminGet())).json();

  assert.equal(body.seeded, false);
});

/* -------------------------------------------------- admin POST /api/admin-catalog */

test('an unauthenticated POST is refused and writes nothing', async () => {
  const calls = stub();

  const response = await adminCatalog.fetch(adminPost({ products: [piece()], digest: DIGEST }, null));

  assert.equal(response.status, 401);
  assert.equal(calls.filter((c) => c.url.startsWith('https://api.vercel.com')).length, 0);
});

test('an authenticated POST writes the catalog', async () => {
  const calls = stub();

  const response = await adminCatalog.fetch(adminPost({ products: [piece()], digest: DIGEST }));

  assert.equal(response.status, 200);
  assert.equal(calls.filter((c) => c.options.method === 'PATCH').length, 1);
});

// The failure mode the MotherlyCreations version has: two tabs clobbering.
test('a stale digest is refused with 409 and writes nothing', async () => {
  const calls = stub({ digest: 'digest-two' });

  const response = await adminCatalog.fetch(adminPost({ products: [piece()], digest: 'digest-one' }));

  assert.equal(response.status, 409);
  assert.equal(calls.filter((c) => c.options.method === 'PATCH').length, 0);
});

test('an invalid product is refused with 400 and writes nothing', async () => {
  const calls = stub();

  const response = await adminCatalog.fetch(
    adminPost({ products: [piece({ title: '' })], digest: DIGEST })
  );

  assert.equal(response.status, 400);
  assert.equal(calls.filter((c) => c.options.method === 'PATCH').length, 0);
});

test('a 400 lists every offending field, not just the first', async () => {
  stub();

  const response = await adminCatalog.fetch(
    adminPost({ products: [piece({ title: '', price: -1, images: ['../escape'] })], digest: DIGEST })
  );
  const body = await response.json();

  const fields = body.errors.map((e) => e.field);
  for (const field of ['title', 'price', 'images']) {
    assert.ok(fields.includes(field), `expected an error for ${field}`);
  }
});

// The catalog is executed by every visitor; this is the one that really matters.
test('an image path escaping assets/ is refused and never written', async () => {
  const calls = stub();

  const response = await adminCatalog.fetch(
    adminPost({ products: [piece({ images: ['https://evil.example.com/x.jpg'] })], digest: DIGEST })
  );

  assert.equal(response.status, 400);
  assert.equal(calls.filter((c) => c.options.method === 'PATCH').length, 0);
});

test('a POST with a malformed body is refused with 400', async () => {
  stub();

  const response = await adminCatalog.fetch(
    new Request('https://x/api/admin-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie() },
      body: 'not json',
    })
  );

  assert.equal(response.status, 400);
});

test('an expired API token is reported as such, not as a generic outage', async () => {
  stub({ writeStatus: 401 });

  const response = await adminCatalog.fetch(adminPost({ products: [piece()], digest: DIGEST }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.match(body.error, /token/i);
});

test('a successful write returns the new digest so the editor stays in step', async () => {
  stub();

  const body = await (await adminCatalog.fetch(adminPost({ products: [piece()], digest: DIGEST }))).json();

  assert.ok(body.digest, 'the editor needs a fresh digest for its next save');
});

test('admin-catalog rejects an unsupported method', async () => {
  stub();

  const response = await adminCatalog.fetch(
    new Request('https://x/api/admin-catalog', { method: 'DELETE', headers: { Cookie: authCookie() } })
  );

  assert.equal(response.status, 405);
});
