// Endpoint tests. These drive the real handlers with real Request objects —
// no mocks, no HTTP server. Run with: node --test "api/*.test.mjs"
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import login from '../api/admin-login.mjs';
import logout from '../api/admin-logout.mjs';
import session from '../api/admin-session.mjs';
import { createToken, COOKIE_NAME } from '../lib/session.mjs';

const CODE = 'test-passphrase-fixture';
const SECRET = 'f'.repeat(64);

const saved = {};

beforeEach(() => {
  saved.code = process.env.ADMIN_CODE;
  saved.secret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_CODE = CODE;
  process.env.ADMIN_SESSION_SECRET = SECRET;
});

afterEach(() => {
  restore('ADMIN_CODE', saved.code);
  restore('ADMIN_SESSION_SECRET', saved.secret);
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function postCode(code) {
  return new Request('https://example.com/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

/* ---------------------------------------------------------- admin-login */

test('login with the correct code returns 200 and sets a session cookie', async () => {
  const response = await login.fetch(postCode(CODE));

  assert.equal(response.status, 200);

  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'a successful login must set a cookie');
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=[^;]+`));
  assert.match(cookie, /HttpOnly/);
});

test('login with the wrong code returns 401 and sets no cookie', async () => {
  const response = await login.fetch(postCode('wrong-value-entirely'));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('login rejects a code that is right except for case', async () => {
  const response = await login.fetch(postCode(CODE.toUpperCase()));

  assert.equal(response.status, 401);
});

test('login rejects a GET with 405', async () => {
  const response = await login.fetch(
    new Request('https://example.com/api/admin-login', { method: 'GET' })
  );

  assert.equal(response.status, 405);
});

test('login returns 400 for a malformed body', async () => {
  const response = await login.fetch(
    new Request('https://example.com/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
    })
  );

  assert.equal(response.status, 400);
});

test('login returns 400 when the code field is missing', async () => {
  const response = await login.fetch(
    new Request('https://example.com/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    })
  );

  assert.equal(response.status, 400);
});

test('login fails closed with 503 when the secret is unset', async () => {
  delete process.env.ADMIN_SESSION_SECRET;

  const response = await login.fetch(postCode(CODE));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('login fails closed with 503 when the configured code is too short', async () => {
  process.env.ADMIN_CODE = 'short';

  const response = await login.fetch(postCode('short'));

  assert.equal(response.status, 503, 'a too-short code must not be usable');
  assert.equal(response.headers.get('set-cookie'), null);
});

// The reason a config is broken describes our deployment. It belongs in the
// server log, not in a response any visitor can read.
test('login never reveals the configuration reason to the client', async () => {
  delete process.env.ADMIN_CODE;

  const body = await (await login.fetch(postCode('anything at all'))).text();

  assert.doesNotMatch(body, /missing-code|missing-secret|code-too-short/);
  assert.doesNotMatch(body, new RegExp(SECRET));
});

test('login never echoes the correct code back', async () => {
  const body = await (await login.fetch(postCode('wrong-value'))).text();

  assert.doesNotMatch(body, new RegExp(CODE));
});

/* -------------------------------------------------------- admin-session */

function getSession(cookie) {
  return new Request('https://example.com/api/admin-session', {
    method: 'GET',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

test('session reports not authed when no cookie is present', async () => {
  const response = await session.fetch(getSession());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authed: false });
});

test('session reports authed for a valid cookie', async () => {
  const token = createToken(SECRET, 60_000);

  const response = await session.fetch(getSession(`${COOKIE_NAME}=${token}`));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).authed, true);
});

test('session reports not authed for an expired cookie', async () => {
  const token = createToken(SECRET, -1000);

  const response = await session.fetch(getSession(`${COOKIE_NAME}=${token}`));

  assert.equal((await response.json()).authed, false);
});

test('session reports not authed for a cookie signed with another secret', async () => {
  const token = createToken('0'.repeat(64), 60_000);

  const response = await session.fetch(getSession(`${COOKIE_NAME}=${token}`));

  assert.equal((await response.json()).authed, false);
});

test('session reports not authed for a garbage cookie', async () => {
  const response = await session.fetch(getSession(`${COOKIE_NAME}=garbage`));

  assert.equal((await response.json()).authed, false);
});

// The login flow is the only thing that can produce a valid session.
test('a cookie taken from a real login is accepted by the session endpoint', async () => {
  const cookie = (await login.fetch(postCode(CODE))).headers.get('set-cookie');
  const token = cookie.split(';')[0];

  const response = await session.fetch(getSession(token));

  assert.equal((await response.json()).authed, true);
});

test('session rejects a POST with 405', async () => {
  const response = await session.fetch(
    new Request('https://example.com/api/admin-session', { method: 'POST' })
  );

  assert.equal(response.status, 405);
});

/* --------------------------------------------------------- admin-logout */

test('logout returns 200 and an expiring cookie', async () => {
  const response = await logout.fetch(
    new Request('https://example.com/api/admin-logout', { method: 'POST' })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('the cookie logout sets is no longer a valid session', async () => {
  const cleared = (
    await logout.fetch(
      new Request('https://example.com/api/admin-logout', { method: 'POST' })
    )
  ).headers.get('set-cookie');

  const response = await session.fetch(getSession(cleared.split(';')[0]));

  assert.equal((await response.json()).authed, false);
});

test('logout rejects a GET with 405', async () => {
  const response = await logout.fetch(
    new Request('https://example.com/api/admin-logout', { method: 'GET' })
  );

  assert.equal(response.status, 405);
});
