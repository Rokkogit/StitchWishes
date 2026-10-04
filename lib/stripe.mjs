// Talking to Stripe, over plain fetch and node:crypto.
//
// No SDK, for the same reason the catalog store and the mail provider have none:
// one fewer dependency to keep patched, and the whole surface used here is two
// calls. Stripe's API is form-encoded, which is the only awkward part.
//
// The webhook signature is verified by hand. That is the one piece worth reading
// carefully, because a webhook endpoint that does not verify is an endpoint
// where anyone who knows the URL can claim an order was paid for.

import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';

// Money is handled in cents everywhere it touches Stripe. Stripe only speaks
// cents, and the conversion is the obvious place for a rounding error to get in.
export const toCents = (dollars) => Math.round(Number(dollars) * 100);

export function readStripeConfig(env = {}) {
  const key = typeof env.STRIPE_SECRET_KEY === 'string' ? env.STRIPE_SECRET_KEY.trim() : '';
  if (!key) return { ok: false, reason: 'not-configured' };

  return {
    ok: true,
    key,
    // A live key is worth knowing about: it is the difference between a test
    // card and somebody's actual money.
    live: key.startsWith('sk_live_'),
    webhookSecret:
      typeof env.STRIPE_WEBHOOK_SECRET === 'string' ? env.STRIPE_WEBHOOK_SECRET.trim() : '',
  };
}

/* ------------------------------------------------------------- encoding */

// Stripe takes application/x-www-form-urlencoded with bracketed paths for nested
// values: line_items[0][price_data][unit_amount]=1299. Built recursively so the
// call sites can pass ordinary objects and arrays.
export function formEncode(value, prefix = '', out = []) {
  if (value === null || value === undefined) return out;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => formEncode(entry, `${prefix}[${index}]`, out));
    return out;
  }

  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      formEncode(entry, prefix ? `${prefix}[${key}]` : key, out);
    }
    return out;
  }

  out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  return out;
}

const body = (params) => formEncode(params).join('&');

/* ------------------------------------------------------------ requests */

async function post(config, path, params, fetchImpl) {
  let response;

  try {
    response = await fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body(params),
      // A hung call here holds a customer on a spinner. Fifteen seconds is far
      // longer than this ever legitimately takes.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ok: false, reason: 'unreachable', detail: error?.message };
  }

  const raw = await response.text().catch(() => '');

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    // Stripe's own message, carried out. Its errors are unusually specific and
    // throwing that away in favour of "payment failed" wastes the best
    // diagnostic available.
    return {
      ok: false,
      reason: response.status === 401 ? 'rejected-key' : 'refused',
      status: response.status,
      detail: parsed?.error?.message ?? raw.slice(0, 300),
      code: parsed?.error?.code ?? null,
    };
  }

  return { ok: true, value: parsed };
}

export function createCheckoutSession(config, params, fetchImpl = fetch) {
  return post(config, '/checkout/sessions', params, fetchImpl);
}

async function get(config, path, query, fetchImpl) {
  let response;

  try {
    response = await fetchImpl(`${API}${path}${query ? `?${query}` : ''}`, {
      headers: { Authorization: `Bearer ${config.key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ok: false, reason: 'unreachable', detail: error?.message };
  }

  const raw = await response.text().catch(() => '');

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: response.status === 401 ? 'rejected-key' : 'refused',
      status: response.status,
      detail: parsed?.error?.message ?? raw.slice(0, 300),
    };
  }

  return { ok: true, value: parsed };
}

// Completed sessions, newest first, with the line items Stripe recorded at the
// time of sale. Those are the fallback for a piece the catalog can no longer
// name; without expanding them, an order for a deleted piece would show nothing.
export function listSessions(config, { limit = 25, startingAfter = null } = {}, fetchImpl = fetch) {
  const query = [
    // Only completed ones. An abandoned checkout is not an order, and listing
    // them would fill the panel with things nobody paid for.
    'status=complete',
    `limit=${Math.min(Math.max(Math.trunc(limit) || 25, 1), 100)}`,
    'expand[]=data.line_items',
    // The payment carries whether the parcel has gone out - see markShipped.
    'expand[]=data.payment_intent',
    startingAfter ? `starting_after=${encodeURIComponent(startingAfter)}` : null,
  ]
    .filter(Boolean)
    .join('&');

  return get(config, '/checkout/sessions', query, fetchImpl);
}

// Marking an order as sent.
//
// Stored on Stripe's own payment record rather than in a database of ours.
// There is no database here by design, and this is one flag per order that
// belongs to the order - inventing a store for it would mean a second place
// that can disagree with Stripe about what happened.
export function markShipped(config, paymentIntentId, shippedAt, fetchImpl = fetch) {
  return post(
    config,
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    // An empty string clears a metadata key in Stripe, which is exactly what
    // un-marking should do - no tombstone left behind.
    { metadata: { shipped_at: shippedAt || '' } },
    fetchImpl
  );
}

/* Recording whether the order got emailed.

   On the payment record, for the same reason "sent" is: there is no database
   here, and Stripe already holds one durable object per order.

   This exists because a failed notification is the only failure in the shop
   that looks exactly like a quiet day. Written down, the Orders tab can tell
   the three cases apart, and they have three different fixes:

     notified_at set      the webhook ran and the mail went out
     notify_error set     the webhook ran, the mail provider refused
     neither set          the webhook never reached us at all - Stripe is not
                          calling, or the signing secret belongs to the other
                          mode, which is the usual answer after going live

   An empty string clears a key in Stripe, so success wipes a previous error
   rather than leaving a stale one next to a sent message. */
export function recordNotice(config, paymentIntentId, { at = '', error = '' } = {}, fetchImpl = fetch) {
  return post(
    config,
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    { metadata: { notified_at: at || '', notify_error: String(error || '').slice(0, 450) } },
    fetchImpl
  );
}

/* ------------------------------------------------- webhook verification */

// Stripe-Signature looks like: t=1699999999,v1=abc...,v1=def...
// More than one v1 is normal during a secret rotation, and both have to be
// accepted or every event is rejected for the duration of the rollover.
export function parseSignature(header) {
  const parts = String(header ?? '').split(',');
  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key?.trim() === 't') timestamp = value?.trim() ?? null;
    if (key?.trim() === 'v1' && value) signatures.push(value.trim());
  }

  return { timestamp, signatures };
}

const equal = (a, b) => {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');

  // timingSafeEqual throws on a length mismatch, and the lengths are not secret.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

// Five minutes, which is Stripe's own default. The timestamp is what stops a
// captured request being replayed tomorrow.
const TOLERANCE_SECONDS = 300;

export function verifyWebhook(secret, rawBody, header, now = Date.now()) {
  if (!secret) return { ok: false, reason: 'not-configured' };

  const { timestamp, signatures } = parseSignature(header);
  if (!timestamp || !signatures.length) return { ok: false, reason: 'malformed-signature' };

  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (!Number.isFinite(age)) return { ok: false, reason: 'malformed-signature' };
  if (age > TOLERANCE_SECONDS) return { ok: false, reason: 'stale' };

  // The signed payload is the timestamp, a literal dot, then the raw body. It
  // has to be the bytes as they arrived: parsing the JSON and re-serialising it
  // changes them, and the signature stops matching for no visible reason.
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  if (!signatures.some((signature) => equal(expected, signature))) {
    return { ok: false, reason: 'bad-signature' };
  }

  // Parsed only after the signature holds. Parsing first would mean acting on
  // the shape of a payload nobody has authenticated yet.
  try {
    return { ok: true, event: JSON.parse(rawBody) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/* ----------------------------------------------------------- cart codec */

// The cart, small enough to travel in session metadata and come back in the
// webhook. Line-item metadata is not returned on webhook events, and the
// alternative — writing the order somewhere before it is paid for — would leave
// a row behind for every abandoned checkout.
//
// Only what identifies a line goes in. Prices and names are read from the
// catalog on the way out, exactly as they are everywhere else.
/* What was ordered, small enough to live in Stripe's metadata.

   handle:design:quantity, and then the choices as id=id pairs - the scent, the
   ink, whatever the piece offers. The choices are here because this is what the
   Orders tab reads an order back out of, and a packing list that does not say
   which scent somebody paid for is a packing list that gets the parcel wrong.

   The choice ids are percent-encoded. They are editable text in the panel, so
   one of them containing a colon or a pipe would otherwise silently cut an
   order in half. Handles cannot - they are checked against a pattern - and
   design ids have never been anything but d1, d2, so those stay plain and
   orders placed before this still read correctly.

   An entry with only three parts is one of those older orders: no choices
   recorded, which decodes to none rather than to an error. */
const encodeChoices = (chosen) =>
  Object.entries(chosen ?? {})
    .map(([axis, value]) => `${encodeURIComponent(axis)}=${encodeURIComponent(value)}`)
    .join(',');

function decodeChoices(part) {
  const chosen = {};

  for (const pair of String(part ?? '').split(',').filter(Boolean)) {
    const at = pair.indexOf('=');
    if (at < 1) continue;

    try {
      chosen[decodeURIComponent(pair.slice(0, at))] = decodeURIComponent(pair.slice(at + 1));
    } catch {
      // A malformed escape is one unreadable choice, not an unreadable order.
    }
  }

  return chosen;
}

export function encodeCart(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const base = [item?.handle ?? '', item?.design ?? '', item?.quantity ?? 1];
      const chosen = encodeChoices(item?.choiceIds);

      return (chosen ? [...base, chosen] : base).join(':');
    })
    .join('|');
}

export function decodeCart(encoded) {
  return String(encoded ?? '')
    .split('|')
    .filter(Boolean)
    .map((entry) => {
      const [handle, design, quantity, chosen] = entry.split(':');
      return {
        handle,
        design: design || null,
        quantity: Math.max(1, Math.trunc(Number(quantity) || 1)),
        choices: decodeChoices(chosen),
      };
    })
    .filter((line) => line.handle);
}

// Stripe caps a metadata value at 500 characters, so a large order is split
// across numbered keys rather than silently truncated — a truncated cart is an
// order that arrives missing pieces somebody has paid for.
const METADATA_LIMIT = 500;

export function cartMetadata(items) {
  const encoded = encodeCart(items);
  const chunks = [];

  for (let at = 0; at < encoded.length; at += METADATA_LIMIT) {
    chunks.push(encoded.slice(at, at + METADATA_LIMIT));
  }

  if (chunks.length <= 1) return { cart: encoded };

  return Object.fromEntries(chunks.map((chunk, index) => [`cart_${index}`, chunk]));
}

export function cartFromMetadata(metadata = {}) {
  if (metadata?.cart) return decodeCart(metadata.cart);

  const parts = Object.keys(metadata)
    .filter((key) => /^cart_\d+$/.test(key))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((key) => metadata[key]);

  return decodeCart(parts.join(''));
}
