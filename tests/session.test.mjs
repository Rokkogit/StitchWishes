// Unit tests for the session module. Run with: node --test api/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  readConfig,
  checkCode,
  createToken,
  verifyToken,
  sessionCookie,
  clearCookie,
  readCookie,
  COOKIE_NAME,
  MIN_CODE_LENGTH,
} from '../lib/session.mjs';

/* ------------------------------------------------------------- readConfig */
// These matter more than they look: a permissive default here would mean a
// misconfigured deploy silently accepts any passphrase.

test('readConfig accepts a valid secret and a long enough code', () => {
  const result = readConfig({
    ADMIN_CODE: 'stitch-witch-hunny',
    ADMIN_SESSION_SECRET: 'a'.repeat(64),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'stitch-witch-hunny');
  assert.equal(result.secret, 'a'.repeat(64));
});

test('readConfig fails when the session secret is missing', () => {
  const result = readConfig({ ADMIN_CODE: 'stitch-witch-hunny' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-secret');
});

test('readConfig fails when the session secret is empty', () => {
  const result = readConfig({
    ADMIN_CODE: 'stitch-witch-hunny',
    ADMIN_SESSION_SECRET: '   ',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-secret');
});

test('readConfig fails when the code is missing', () => {
  const result = readConfig({ ADMIN_SESSION_SECRET: 'a'.repeat(64) });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-code');
});

test('readConfig fails when the code is one character too short', () => {
  const eleven = 'a'.repeat(MIN_CODE_LENGTH - 1);

  const result = readConfig({
    ADMIN_CODE: eleven,
    ADMIN_SESSION_SECRET: 'a'.repeat(64),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'code-too-short');
});

test('readConfig accepts a code of exactly the minimum length', () => {
  const result = readConfig({
    ADMIN_CODE: 'a'.repeat(MIN_CODE_LENGTH),
    ADMIN_SESSION_SECRET: 'a'.repeat(64),
  });

  assert.equal(result.ok, true);
});

test('readConfig never reports ok without also returning both values', () => {
  const result = readConfig({
    ADMIN_CODE: 'stitch-witch-hunny',
    ADMIN_SESSION_SECRET: 'a'.repeat(64),
  });

  assert.ok(result.code, 'a successful config must carry the code');
  assert.ok(result.secret, 'a successful config must carry the secret');
});

test('readConfig on a completely empty environment fails closed', () => {
  const result = readConfig({});

  assert.equal(result.ok, false);
  assert.ok(result.reason, 'failure must always explain itself for the logs');
});

/* -------------------------------------------------------------- checkCode */

const CORRECT = 'stitch-witch-hunny';

test('checkCode accepts the correct passphrase', () => {
  assert.equal(checkCode(CORRECT, CORRECT), true);
});

test('checkCode rejects a wrong passphrase of the same length', () => {
  const wrong = 'stitch-witch-HUNNY';
  assert.equal(wrong.length, CORRECT.length);

  assert.equal(checkCode(wrong, CORRECT), false);
});

test('checkCode is case sensitive', () => {
  assert.equal(checkCode(CORRECT.toUpperCase(), CORRECT), false);
});

test('checkCode rejects a prefix of the correct passphrase', () => {
  assert.equal(checkCode('stitch-witch', CORRECT), false);
});

test('checkCode rejects the correct passphrase with extra characters', () => {
  assert.equal(checkCode(CORRECT + 'x', CORRECT), false);
});

test('checkCode rejects an empty passphrase', () => {
  assert.equal(checkCode('', CORRECT), false);
});

// The body of a request is attacker-controlled, so these arrive as whatever
// JSON.parse produced. They must be rejected, not thrown on — an exception
// here would surface as a 500 and distinguish "malformed" from "wrong".
test('checkCode rejects non-string input without throwing', () => {
  assert.equal(checkCode(undefined, CORRECT), false);
  assert.equal(checkCode(null, CORRECT), false);
  assert.equal(checkCode(12345678901234, CORRECT), false);
  assert.equal(checkCode({}, CORRECT), false);
  assert.equal(checkCode([], CORRECT), false);
});

/* ------------------------------------------------------ session tokens */

const SECRET = 'f'.repeat(64);
const OTHER_SECRET = '0'.repeat(64);
const HOUR = 60 * 60 * 1000;

test('a freshly minted token verifies against the same secret', () => {
  const token = createToken(SECRET, HOUR);

  const result = verifyToken(SECRET, token);

  assert.equal(result.valid, true);
});

test('a verified token reports its expiry in the future', () => {
  const before = Date.now();

  const result = verifyToken(SECRET, createToken(SECRET, HOUR));

  assert.equal(result.valid, true);
  assert.ok(result.exp > before, 'expiry should be ahead of mint time');
  assert.ok(result.exp <= before + HOUR + 1000, 'expiry should respect the ttl');
});

// This is the whole point of signing. Without it, anyone could hand us a
// token claiming any expiry they liked.
test('a token with a tampered payload is rejected', () => {
  const token = createToken(SECRET, HOUR);
  const [, signature] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ exp: Date.now() + 100 * 365 * 24 * HOUR })
  ).toString('base64url');

  const result = verifyToken(SECRET, `${forgedPayload}.${signature}`);

  assert.equal(result.valid, false);
});

test('a token with a tampered signature is rejected', () => {
  const token = createToken(SECRET, HOUR);
  const [payload, signature] = token.split('.');
  const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');

  const result = verifyToken(SECRET, `${payload}.${flipped}`);

  assert.equal(result.valid, false);
});

test('a token signed with a different secret is rejected', () => {
  const token = createToken(OTHER_SECRET, HOUR);

  const result = verifyToken(SECRET, token);

  assert.equal(result.valid, false);
});

// Rotating ADMIN_SESSION_SECRET is the "sign everyone out" control, so this
// is the test that proves that control actually works.
test('rotating the secret invalidates existing tokens', () => {
  const issuedBeforeRotation = createToken(SECRET, HOUR);

  assert.equal(verifyToken(SECRET, issuedBeforeRotation).valid, true);
  assert.equal(verifyToken(OTHER_SECRET, issuedBeforeRotation).valid, false);
});

test('an expired token is rejected even though its signature is valid', () => {
  const expired = createToken(SECRET, -1000);

  const result = verifyToken(SECRET, expired);

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});

test('malformed tokens are rejected without throwing', () => {
  const garbage = [
    '',
    '.',
    'no-dot-at-all',
    'too.many.dots',
    'a.b',
    '!!!.???',
    undefined,
    null,
    42,
    {},
  ];

  for (const value of garbage) {
    const result = verifyToken(SECRET, value);
    assert.equal(result.valid, false, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

// Signed with the real secret on purpose. An unsigned garbage payload would
// be caught by the signature check and never reach the JSON parse, so this
// test would pass without proving anything.
test('a correctly signed payload that is not JSON is rejected', () => {
  const notJson = Buffer.from('this is not json').toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(notJson, 'utf8')
    .digest('base64url');

  const result = verifyToken(SECRET, `${notJson}.${signature}`);

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'malformed');
});

test('a correctly signed payload with no expiry is rejected', () => {
  const noExp = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
  const signature = createHmac('sha256', SECRET)
    .update(noExp, 'utf8')
    .digest('base64url');

  const result = verifyToken(SECRET, `${noExp}.${signature}`);

  assert.equal(result.valid, false);
});

/* ------------------------------------------------------------- cookies */

// Each of these flags is load-bearing. HttpOnly is what stops an XSS bug from
// reading the session out of document.cookie; SameSite=Strict is what stops
// another site from riding the cookie on a cross-site request.
test('sessionCookie carries the token and every security flag', () => {
  const header = sessionCookie('the-token', 604800);

  assert.match(header, /^sw_admin=the-token(;|$)/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\//);
  assert.match(header, /Max-Age=604800/);
});

test('sessionCookie uses the exported cookie name', () => {
  assert.ok(sessionCookie('x', 1).startsWith(`${COOKIE_NAME}=`));
});

test('clearCookie expires the cookie immediately', () => {
  const header = clearCookie();

  assert.match(header, /^sw_admin=(;|$)/);
  assert.match(header, /Max-Age=0/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Path=\//);
});

test('readCookie finds the session cookie on its own', () => {
  assert.equal(readCookie('sw_admin=abc123', 'sw_admin'), 'abc123');
});

test('readCookie finds the session cookie among others', () => {
  const header = '_vercel_jwt=xyz; sw_admin=abc123; other=value';

  assert.equal(readCookie(header, 'sw_admin'), 'abc123');
});

test('readCookie tolerates missing whitespace between cookies', () => {
  assert.equal(readCookie('a=1;sw_admin=abc123;b=2', 'sw_admin'), 'abc123');
});

test('readCookie returns null when the cookie is absent', () => {
  assert.equal(readCookie('other=value; another=thing', 'sw_admin'), null);
});

test('readCookie returns null for an absent or empty header', () => {
  assert.equal(readCookie(null, 'sw_admin'), null);
  assert.equal(readCookie(undefined, 'sw_admin'), null);
  assert.equal(readCookie('', 'sw_admin'), null);
});

// A substring match here would let `notsw_admin=forged` be read as the real
// session cookie.
test('readCookie does not match a cookie whose name merely contains the target', () => {
  assert.equal(readCookie('notsw_admin=forged', 'sw_admin'), null);
  assert.equal(readCookie('sw_admin_backup=forged', 'sw_admin'), null);
});

test('readCookie round-trips a real token through a real header', () => {
  const token = createToken(SECRET, HOUR);
  const header = `sw_admin=${token}`;

  assert.equal(verifyToken(SECRET, readCookie(header, COOKIE_NAME)).valid, true);
});
