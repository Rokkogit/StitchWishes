import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Session handling for the /admin gate.
//
// This lives in lib/ rather than api/ because EVERY file in api/ is deployed
// as a route — an underscore prefix does not exempt it, only a leading dot
// does. Vercel traces imports, so a module here is bundled into each function
// that imports it without ever being reachable over HTTP.
//
// The endpoints hold no crypto of their own. Everything about how a session is
// proven lives here, so there is one place to audit and one place to change.

/* -------------------------------------------------------------- config */

// Serverless instances do not share memory, so per-instance attempt counters
// are not real rate limiting. Passphrase length is the actual control against
// brute force. Lowering this is not a config tweak — it requires adding a
// shared rate-limit store first.
export const MIN_CODE_LENGTH = 12;

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Fails closed, always. A misconfigured deploy must refuse every login rather
// than fall back to something permissive. The `reason` is for the server log;
// callers must not return it to the client, since it describes our config.
export function readConfig(env) {
  if (!present(env.ADMIN_SESSION_SECRET)) {
    return { ok: false, reason: 'missing-secret' };
  }
  if (!present(env.ADMIN_CODE)) {
    return { ok: false, reason: 'missing-code' };
  }
  if (env.ADMIN_CODE.length < MIN_CODE_LENGTH) {
    return { ok: false, reason: 'code-too-short' };
  }

  return {
    ok: true,
    code: env.ADMIN_CODE,
    secret: env.ADMIN_SESSION_SECRET,
  };
}

/* ---------------------------------------------------------- passphrase */

// Compare in constant time. A naive `===` on strings short-circuits at the
// first differing byte, which leaks how much of a guess was correct and lets
// an attacker recover the passphrase one character at a time.
//
// timingSafeEqual demands equal-length buffers, and the passphrase is
// variable-length, so both sides are hashed to a fixed 32 bytes first. That
// also stops the comparison itself from revealing the real length.
export function checkCode(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();

  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------- session tokens */

// There is no database, so a session cannot be looked up — it has to carry its
// own proof. The token is its own record: an expiry, plus an HMAC over that
// expiry. Anyone can read it; only someone holding the secret can mint or
// alter one.
//
//   base64url({"exp":<ms>}) . base64url(HMAC-SHA256(payload, secret))

const MALFORMED = { valid: false, reason: 'malformed' };
const BAD_SIGNATURE = { valid: false, reason: 'bad-signature' };

function sign(secret, encodedPayload) {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest();
}

export function createToken(secret, ttlMs) {
  const payload = JSON.stringify({ exp: Date.now() + ttlMs });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');

  return `${encoded}.${sign(secret, encoded).toString('base64url')}`;
}

export function verifyToken(secret, token) {
  if (typeof token !== 'string') return MALFORMED;

  const parts = token.split('.');
  if (parts.length !== 2) return MALFORMED;

  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return MALFORMED;

  // Check the signature BEFORE parsing anything. The payload is attacker-
  // supplied until proven otherwise, and there is no reason to hand untrusted
  // bytes to JSON.parse to find out.
  const provided = Buffer.from(encodedSignature, 'base64url');
  const expected = sign(secret, encodedPayload);

  if (provided.length !== expected.length) return BAD_SIGNATURE;
  if (!timingSafeEqual(provided, expected)) return BAD_SIGNATURE;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return MALFORMED;
  }

  if (typeof payload?.exp !== 'number') return MALFORMED;
  if (Date.now() >= payload.exp) return { valid: false, reason: 'expired' };

  return { valid: true, exp: payload.exp };
}

/* -------------------------------------------------------------- cookies */

export const COOKIE_NAME = 'sw_admin';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// HttpOnly  — page scripts cannot read this, so an XSS bug cannot steal it
// Secure    — HTTPS only
// SameSite  — Strict, so it never rides along on a cross-site request (CSRF)
const FLAGS = 'Path=/; HttpOnly; Secure; SameSite=Strict';

export function sessionCookie(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; ${FLAGS}; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; ${FLAGS}; Max-Age=0`;
}

// Deliberately splits on ';' and compares the name exactly. A substring or
// regex search would let `notsw_admin=forged` be mistaken for the real cookie.
export function readCookie(header, name) {
  if (typeof header !== 'string' || header.length === 0) return null;

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return null;
}
