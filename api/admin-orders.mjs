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
import { readStripeConfig, listSessions } from '../lib/stripe.mjs';
import { toOrder, sortOrders, dashboardUrl, orderSummary } from '../lib/orders.mjs';
import { readStore } from '../lib/global-config.mjs';
import { fillMissingDesigns } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';

function authorized(request) {
  const config = readConfig(process.env);
  if (!config.ok) return false;

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return false;

  return verifyToken(config.secret, token).valid;
}

export async function handle(request, fetchImpl = fetch) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  if (!authorized(request)) return json(401, { error: 'Sign in first.' });

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
  const catalog = store.ok ? fillMissingDesigns(store.products, SEED) : SEED;

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
