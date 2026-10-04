// POST /api/checkout -> { url } to send the customer to Stripe.
//
// Public, and therefore the most hostile input in the whole project: the cart
// arrives from localStorage, which anyone can edit. Nothing in it is believed
// except which piece, which design, which choices and how many. Every price and
// every name is read from the catalog, and the total is recomputed here. A
// browser that could name its own price would eventually name one cent.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readStore } from '../lib/global-config.mjs';
import { readyCatalog } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';
import { visibleProducts } from '../lib/catalog.mjs';
import { resolveCart } from '../lib/cart.mjs';
import { orderTotal, DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { readStripeConfig, createCheckoutSession } from '../lib/stripe.mjs';
import { checkedSessionParams } from '../lib/checkout.mjs';
import { orderReference } from '../lib/notify.mjs';

function originOf(request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (host) return `${proto}://${host}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

export async function handle(request, fetchImpl = fetch) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const config = readStripeConfig(process.env);
  if (!config.ok) {
    // 503 rather than 500: nothing is broken, it is not switched on. The bag
    // already has wording for this case.
    return json(503, { error: 'Card payment is not switched on yet.' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Expected a JSON body.' });
  }

  // The store, not the bundled copy. A checkout must price against what the shop
  // is actually selling right now, so an unreachable store refuses rather than
  // falling back to a catalog that may be months old.
  const store = await readStore(process.env);
  if (!store.ok) {
    console.error(`[checkout] store unreachable: ${store.reason ?? store.status}`);
    return json(503, { error: 'The shop is briefly unavailable. Nothing has been charged.' });
  }

  const settings = store.settings ?? DEFAULT_SETTINGS;
  const catalog = visibleProducts(readyCatalog(store.products, SEED));

  const { items, problems } = resolveCart(body?.cart, catalog);

  // Anything reduced or removed goes back to the page instead of to Stripe. A
  // customer should see "only 2 left, the rest were removed" in their bag, not
  // discover it on a receipt.
  if (problems.length) {
    return json(409, {
      error: 'Your bag changed. Have a look before paying.',
      problems,
    });
  }

  if (!items.length) {
    return json(400, { error: 'There is nothing in your bag.' });
  }

  const totals = orderTotal(items, settings);
  const reference = orderReference();

  const checked = checkedSessionParams({
    items,
    totals,
    settings,
    origin: originOf(request),
    reference,
  });

  // The two totals disagreeing means a bug in this code, not bad input. Refusing
  // is the only safe answer: charging a number the customer was never shown is
  // worse than failing to charge at all.
  if (!checked.ok) {
    console.error(
      `[checkout] total mismatch: bag ${checked.expected} vs stripe ${checked.actual} cents`
    );
    return json(500, {
      error: 'The total did not add up, so nothing was charged. Please try again.',
    });
  }

  const session = await createCheckoutSession(config, checked.params, fetchImpl);

  if (!session.ok) {
    console.error(
      `[checkout] session failed: ${session.reason} ${session.status ?? ''} ${session.detail ?? ''}`
    );

    if (session.reason === 'rejected-key') {
      return json(502, {
        error: 'Payment is misconfigured. Nothing has been charged.',
      });
    }

    return json(502, {
      error: 'Could not open checkout. Nothing has been charged.',
    });
  }

  if (!session.value?.url) {
    console.error('[checkout] session created without a url');
    return json(502, { error: 'Could not open checkout. Nothing has been charged.' });
  }

  // The reference is logged so a support question about an order can be traced
  // even before order storage exists.
  console.log(
    `[checkout] ${reference} ${checked.cents} cents, ${items.length} lines, session ${session.value.id}`
  );

  return json(200, { url: session.value.url });
}

export default {
  fetch: (request) => handle(request, fetch),
};
