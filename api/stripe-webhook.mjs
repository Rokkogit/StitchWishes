// POST /api/stripe-webhook -> Stripe telling us an order was paid for.
//
// This endpoint is public and unauthenticated, so the signature is the only
// thing standing between it and anyone who knows the URL claiming an order was
// paid. Nothing is read out of the payload before the signature holds.
//
// It answers 200 to almost everything on purpose. A non-2xx tells Stripe to
// retry, and retrying does not fix a failed email — it just sends the same event
// again for days. The only 4xx here is a signature that does not verify.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readStore } from '../lib/global-config.mjs';
import { readyCatalog } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';
import { resolveCart } from '../lib/cart.mjs';
import { readStripeConfig, verifyWebhook, cartFromMetadata, encodeCart, recordNotice } from '../lib/stripe.mjs';
import { sendOrderEmail } from '../lib/notify.mjs';
import { shippingOf, formatAddress } from '../lib/orders.mjs';

// Stripe can deliver the same event more than once, and two identical order
// emails is a real annoyance. This only covers repeats that land on the same warm
// instance, which is most of them in practice; durable deduplication arrives with
// order storage.
const seen = new Set();
const SEEN_MAX = 500;

export function clearSeen() {
  seen.clear();
}

function remember(id) {
  if (seen.has(id)) return false;

  // Bounded, so a long-lived instance cannot grow this without limit.
  if (seen.size >= SEEN_MAX) seen.clear();
  seen.add(id);

  return true;
}

export async function handle(request, fetchImpl = fetch) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const config = readStripeConfig(process.env);

  if (!config.webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is unset; refusing everything');
    // 503 rather than 200: this one should be retried, because the fix is
    // configuration and the event is worth keeping.
    return json(503, { error: 'Webhooks are not configured.' });
  }

  // The raw text, not request.json(). The signature covers the bytes as they
  // arrived; parsing and re-serialising changes them and verification then fails
  // for no visible reason.
  const raw = await request.text();

  const result = verifyWebhook(config.webhookSecret, raw, request.headers.get('stripe-signature'));

  if (!result.ok) {
    console.error(`[stripe-webhook] rejected: ${result.reason}`);
    return json(400, { error: 'Signature check failed.' });
  }

  const event = result.event;

  if (event?.type !== 'checkout.session.completed') {
    // Acknowledged rather than refused. Stripe sends whatever the endpoint is
    // subscribed to, and an event this code does not care about is not an error.
    return json(200, { received: true, ignored: event?.type ?? 'unknown' });
  }

  if (!remember(event.id)) {
    console.log(`[stripe-webhook] ${event.id} already handled`);
    return json(200, { received: true, duplicate: true });
  }

  const session = event.data?.object ?? {};

  // Belt and braces: a session can complete without being paid when it is set up
  // asynchronously. Only a paid one becomes an order to make.
  if (session.payment_status && session.payment_status !== 'paid') {
    console.log(`[stripe-webhook] ${session.id} is ${session.payment_status}, not making it yet`);
    return json(200, { received: true, unpaid: true });
  }

  const reference = session.metadata?.reference || session.id;

  // The catalog supplies the names, designs and choices; Stripe supplies what was
  // actually charged. Neither is asked for what the other knows better.
  const store = await readStore(process.env);
  const catalog = readyCatalog(store.ok ? store.products : SEED, SEED);

  const ordered = cartFromMetadata(session.metadata);
  const { items } = resolveCart(ordered, catalog);

  // If the catalog could not name everything - an unreachable store, or a piece
  // deleted between paying and this arriving - the raw identifiers go in the note
  // rather than nowhere. An order that says what was paid but not what to make is
  // not an order anyone can fulfil, and the money has already moved.
  const unresolved =
    items.length === ordered.length
      ? ''
      : `Some pieces could not be looked up${store.ok ? '' : ' (the catalog store was unreachable)'}. ` +
        `What was ordered, as handle:design:quantity - ${encodeCart(ordered)}`;

  const shipping = shippingOf(session);

  const order = {
    reference,
    items,
    totals: {
      // Stripe's figures, because they are what the customer paid. Recomputing
      // them here would invent a second opinion about a settled fact.
      subtotal: (session.amount_subtotal ?? 0) / 100,
      total: (session.amount_total ?? 0) / 100,
      shipping: (session.total_details?.amount_shipping ?? 0) / 100,
      tax: (session.total_details?.amount_tax ?? 0) / 100,
      fees: 0,
      lines: (session.total_details?.amount_shipping ?? 0)
        ? [{ label: 'Shipping', amount: session.total_details.amount_shipping / 100 }]
        : [],
    },
    customer: {
      name: shipping?.name ?? session.customer_details?.name ?? '',
      email: session.customer_details?.email ?? '',
      address: formatAddress(shipping),
      note: unresolved,
    },
  };

  console.log(
    `[stripe-webhook] ${reference} paid ${session.amount_total} cents, ${items.length} lines`
  );

  // The order is already paid for. If the email fails, that is logged and the
  // event is still acknowledged: asking Stripe to retry would not make the mail
  // provider work, and the money has moved either way.
  const sent = await sendOrderEmail(process.env, order, fetchImpl);

  if (!sent.ok) {
    console.error(
      `[stripe-webhook] ${reference} PAID BUT NOT EMAILED: ${sent.reason} ${sent.detail ?? ''}`
    );
  }

  // Written onto the payment so the Orders tab can say what happened. A log
  // line only helps somebody who already suspects a problem, and the whole
  // difficulty with a missing notification is that nothing suggests looking.
  //
  // Best effort, and deliberately last: the money has moved and the mail has
  // either gone or not, so failing here would turn a bookkeeping miss into a
  // retried event and a second copy of the same order in the inbox.
  const paymentIntent =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  if (paymentIntent) {
    try {
      await recordNotice(
        config,
        paymentIntent,
        sent.ok
          ? { at: new Date().toISOString() }
          : { error: [sent.reason, sent.detail].filter(Boolean).join(': ') },
        fetchImpl
      );
    } catch (error) {
      console.error(`[stripe-webhook] ${reference} could not record the notice: ${error?.message}`);
    }
  }

  return json(200, { received: true, reference, emailed: sent.ok });
}

export default {
  fetch: (request) => handle(request, fetch),
};
