// GET /api/admin-orders -> what has been bought.
//
// Read straight from Stripe rather than from storage of our own. Stripe is the
// system of record for the money whatever this code does, so a second copy would
// only be a second thing that can disagree — and it means orders placed before
// this tab existed show up in it.
//
// Session-protected: this is names, addresses and what people spent.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readConfig, verifyToken, readCookie, COOKIE_NAME } from '../lib/session.mjs';
import { readStripeConfig, listSessions, markShipped } from '../lib/stripe.mjs';
import { toOrder, sortOrders, dashboardUrl, orderSummary } from '../lib/orders.mjs';
import { readStore } from '../lib/global-config.mjs';
import { readyCatalog } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';

function authorized(request) {
  const config = readConfig(process.env);
  if (!config.ok) return false;

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return false;

  return verifyToken(config.secret, token).valid;
}

/*
   Marking a parcel as sent.

   Written onto Stripe's own payment record rather than into a store of ours.
   There is no database here by design, and this is one flag per order that
   belongs to the order - a second place to keep it is a second place that can
   disagree with Stripe about what happened.

   Served by this function rather than its own, because a Hobby deployment
   allows twelve and api/ is at eleven.
*/
async function handleShip(request, fetchImpl) {
  const stripe = readStripeConfig(process.env);
  if (!stripe.ok) return json(503, { error: 'Card payment is not switched on yet.' });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Expected a JSON body.' });
  }

  const paymentIntent = body?.paymentIntent;
  if (typeof paymentIntent !== 'string' || !paymentIntent.startsWith('pi_')) {
    return json(400, { error: 'Which order?' });
  }

  // The panel sends the state it wants, not a toggle. A toggle would flip the
  // wrong way if two tabs were open, or if a reply was lost and retried.
  const shippedAt = body?.shipped === false ? '' : new Date().toISOString();

  const result = await markShipped(stripe, paymentIntent, shippedAt, fetchImpl);

  if (!result.ok) {
    console.error(`[admin-orders] mark failed: ${result.reason} ${result.detail ?? ''}`);

    const said = [result.status && `HTTP ${result.status}`, result.detail].filter(Boolean).join(' — ');
    return json(502, { error: `Stripe would not record that (${said}).` });
  }

  return json(200, { ok: true, shippedAt: shippedAt || null });
}

export async function handle(request, fetchImpl = fetch) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return methodNotAllowed('GET, POST');
  }

  // Before anything else: this is names, addresses and what people spent.
  if (!authorized(request)) return json(401, { error: 'Sign in first.' });

  if (request.method === 'POST') return handleShip(request, fetchImpl);

  const stripe = readStripeConfig(process.env);
  if (!stripe.ok) {
    return json(200, {
      orders: [],
      configured: false,
      // Not an error. There are no orders because payments are not switched on,
      // and an empty list with no explanation looks like a shop nobody bought
      // from.
      message: 'Card payment is not switched on yet, so there are no orders.',
    });
  }

  const url = new URL(request.url, 'https://placeholder.invalid');

  const result = await listSessions(
    stripe,
    {
      limit: Number(url.searchParams.get('limit')) || 25,
      startingAfter: url.searchParams.get('after'),
    },
    fetchImpl
  );

  if (!result.ok) {
    console.error(`[admin-orders] ${result.reason} ${result.status ?? ''} ${result.detail ?? ''}`);

    const said = [result.status && `HTTP ${result.status}`, result.detail].filter(Boolean).join(' — ');

    if (result.reason === 'rejected-key') {
      return json(502, { error: `Stripe refused the key (${said}).` });
    }

    return json(502, { error: `Could not reach Stripe (${said}).` });
  }

  // The catalog names the pieces. A failure here is not fatal: toOrder falls
  // back to what Stripe recorded at the time of sale, which is worse but real.
  const store = await readStore(process.env);
  const catalog = readyCatalog(store.ok ? store.products : SEED, SEED);

  const sessions = result.value?.data ?? [];
  const orders = sortOrders(sessions.map((session) => toOrder(session, catalog)))
    .filter((order) => order.paid)
    .map((order) => ({ ...order, dashboard: dashboardUrl(order) }));

  return json(200, {
    orders,
    configured: true,
    summary: orderSummary(orders),
    // Stripe's own flag, so the panel can say plainly whether this is practice
    // or somebody's actual money.
    testMode: !stripe.live,
    // Stripe's paging cursor, passed straight back for "show older".
    hasMore: result.value?.has_more === true,
    nextAfter: sessions.length ? sessions[sessions.length - 1].id : null,
    catalogOk: store.ok,
  });
}

export default {
  fetch: (request) => handle(request, fetch),
};
