// The upload endpoint, driven with real Request objects.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import upload from '../api/admin-upload.mjs';
import { createToken, COOKIE_NAME } from '../lib/session.mjs';
import { MAX_UPLOAD_BYTES } from '../lib/upload.mjs';

const SECRET = 'f'.repeat(64);
const saved = {};

beforeEach(() => {
  for (const key of [
    'ADMIN_CODE',
    'ADMIN_SESSION_SECRET',
    'BLOB_READ_WRITE_TOKEN',
    'BLOB_STORE_ID',
    'VERCEL_OIDC_TOKEN',
  ]) {
    saved[key] = process.env[key];
  }
  process.env.ADMIN_CODE = 'test-passphrase-fixture';
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_fake';
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const cookie = () => `${COOKIE_NAME}=${createToken(SECRET, 60_000)}`;

function post(bytes, { type = 'image/jpeg', auth = true } = {}) {
  return new Request('https://x/api/admin-upload', {
    method: 'POST',
    headers: {
      'Content-Type': type,
      ...(auth ? { Cookie: cookie() } : {}),
    },
    body: bytes,
  });
}

const photo = (size = 1024) => new Uint8Array(size).fill(1);

/* ----------------------------------------------------------------- auth */

// This is the one that matters most. An open upload endpoint is free file
// hosting for the internet, served from a domain people trust.
test('an unauthenticated upload is refused', async () => {
  const response = await upload.fetch(post(photo(), { auth: false }));

  assert.equal(response.status, 401);
});

test('an upload with a forged cookie is refused', async () => {
  const request = new Request('https://x/api/admin-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      Cookie: `${COOKIE_NAME}=${createToken('0'.repeat(64), 60_000)}`,
    },
    body: photo(),
  });

  assert.equal((await upload.fetch(request)).status, 401);
});

test('an upload with an expired cookie is refused', async () => {
  const request = new Request('https://x/api/admin-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      Cookie: `${COOKIE_NAME}=${createToken(SECRET, -1000)}`,
    },
    body: photo(),
  });

  assert.equal((await upload.fetch(request)).status, 401);
});

test('a GET is refused', async () => {
  const response = await upload.fetch(
    new Request('https://x/api/admin-upload', { method: 'GET', headers: { Cookie: cookie() } })
  );

  assert.equal(response.status, 405);
});

/* --------------------------------------------------------------- content */

// Authentication is checked before the body is read, so a hostile upload
// never gets as far as being buffered.
test('a non-image is refused', async () => {
  for (const type of ['text/html', 'image/svg+xml', 'application/pdf']) {
    const response = await upload.fetch(post(photo(), { type }));
    assert.equal(response.status, 400, type);
  }
});

test('an oversized file is refused', async () => {
  const response = await upload.fetch(post(photo(MAX_UPLOAD_BYTES + 1)));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /large/i);
});

test('an empty body is refused', async () => {
  const response = await upload.fetch(post(new Uint8Array(0)));

  assert.equal(response.status, 400);
});

/* ------------------------------------------------------------ not set up */

test('no credentials at all reports configuration, not a crash', async () => {
  // Every way of connecting a store removed, so the SDK itself is the thing
  // that refuses - which is the point. The route no longer decides for itself
  // whether a store is connected.
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  delete process.env.VERCEL_OIDC_TOKEN;

  const response = await upload.fetch(post(photo()));

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not connected/i);
});

test('the route does not decide for itself whether a store is connected', () => {
  // The bug this replaces. Vercel now connects a Blob store with a store id
  // and a token injected into the runtime, and no BLOB_READ_WRITE_TOKEN
  // anywhere. Gating on that one variable turned a working store into "photo
  // storage is not set up yet" - advice to go and do a thing already done.
  //
  // Asserted against the source because the alternative is letting the SDK
  // reach the network from a test. The rule is simple enough to state exactly:
  // the route must not read that variable at all. The SDK knows every way it
  // can authenticate; this file knows none of them, deliberately.
  const route = readFileSync(new URL('../api/admin-upload.mjs', import.meta.url), 'utf8');

  // Reads, not mentions: the comment explaining why names them on purpose.
  assert.doesNotMatch(
    route,
    /process\.env\.(BLOB_|VERCEL_OIDC)/,
    'the upload route is second-guessing the SDK about credentials again'
  );
});

test('the unconfigured message does not leak the variable value', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = '';
  delete process.env.BLOB_STORE_ID;
  delete process.env.VERCEL_OIDC_TOKEN;

  const body = await (await upload.fetch(post(photo()))).text();

  assert.doesNotMatch(body, /vercel_blob_rw/);
});

test('a private store is reported as the wrong kind of store, not as a crash', async () => {
  // Product photographs are fetched directly and anonymously by a visitor's
  // browser, by Stripe's checkout page and by link previews. A private store
  // hands them out only to whoever carries a token, so there is nothing to
  // work around here - it is the wrong kind of store, and the message has to
  // say which kind is needed.
  const route = readFileSync(new URL('../api/admin-upload.mjs', import.meta.url), 'utf8');

  assert.match(route, /private store\|private access/, 'the private-store case is not recognised');
  assert.match(route, /PUBLIC access/, 'the message does not say what kind of store to make');

  // And it is configuration rather than a fault, so it answers 503 like the
  // other configuration cases rather than 502.
  const branch = route.slice(route.indexOf('private store|private access'));
  assert.match(branch.slice(0, 600), /json\(503/);
});
