// The upload endpoint, driven with real Request objects.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import upload from '../api/admin-upload.mjs';
import { createToken, COOKIE_NAME } from '../lib/session.mjs';
import { MAX_UPLOAD_BYTES } from '../lib/upload.mjs';

const SECRET = 'f'.repeat(64);
const saved = {};

beforeEach(() => {
  for (const key of ['ADMIN_CODE', 'ADMIN_SESSION_SECRET', 'BLOB_READ_WRITE_TOKEN']) {
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

test('a missing blob token reports configuration, not a crash', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const response = await upload.fetch(post(photo()));

  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not set up/i);
});

test('the unconfigured message does not leak the variable value', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = '';

  const body = await (await upload.fetch(post(photo()))).text();

  assert.doesNotMatch(body, /vercel_blob_rw/);
});
