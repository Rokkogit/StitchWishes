// Orders, read back out of Stripe.
//
// Deliberately no storage of our own. Stripe already holds every completed
// order, durably, with the address and the amount, and it is the system of
// record for the money whatever this code does. Writing a second copy would
// mean a second thing that can disagree, and the two places available here are
// both poor fits: Vercel Blob serves from public URLs, which is not where a
// stranger's home address belongs, and Global Config shares one megabyte with
// the catalog, so a busy year of orders would eventually stop the shop being
// editable.
//
// Reading from Stripe also means this works backwards: orders placed before
// this tab existed appear in it.
//
// The pieces are still named from the catalog, because Stripe only knows what
// the line was called when it was sold, and the catalog knows the handle, the
// design and the choices — which is what actually has to be made.

import { cartFromMetadata } from './stripe.mjs';
import { resolveCart } from './cart.mjs';

export function formatAddress(details) {
  const address = details?.address;
  if (!address) return '';

  return [
    details.name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(', '),
    address.country,
  ]
    .filter(Boolean)
    .join('\n');
}

// Stripe moved shipping details under collected_information in later API
// versions. Both shapes are read, because which one arrives depends on the
// account's API version rather than on anything here.
export function shippingOf(session) {
  return session?.collected_information?.shipping_details ?? session?.shipping_details ?? null;
}

const money = (cents) => Math.round(Number(cents) || 0) / 100;

// What Stripe recorded at the time of sale, used when the catalog can no longer
// name a piece — it was deleted, renamed, or the store is unreachable. Worse
// than the catalog version, and far better than a blank row.
function itemsFromStripe(session) {
  return (session?.line_items?.data ?? []).map((line) => ({
    handle: null,
    title: line?.description ?? 'Item',
    designName: null,
    choices: [],
    quantity: line?.quantity ?? 1,
    price: money((line?.amount_total ?? 0) / (line?.quantity || 1)),
    image: null,
    fromStripe: true,
  }));
}

export function toOrder(session, catalog) {
  const ordered = cartFromMetadata(session?.metadata ?? {});
  const { items } = resolveCart(ordered, Array.isArray(catalog) ? catalog : []);

  // Only fall back wholesale. A partial match still names most of the order,
  // and mixing the two sources would double the rows.
  const resolved = items.length ? items : itemsFromStripe(session);

  const shipping = shippingOf(session);

  return {
    reference: session?.metadata?.reference || session?.id || '',
    sessionId: session?.id ?? '',
    paymentIntent:
      typeof session?.payment_intent === 'string'
        ? session.payment_intent
        : (session?.payment_intent?.id ?? null),

    // Written by the panel onto Stripe's own payment record. Absent means the
    // parcel has not gone yet, which is the state every order starts in.
    shippedAt:
      typeof session?.payment_intent === 'object'
        ? session.payment_intent?.metadata?.shipped_at || null
        : null,

    // Stripe's seconds, turned into something a browser can format.
    placedAt: session?.created ? new Date(session.created * 1000).toISOString() : null,

    live: session?.livemode === true,
    paid: session?.payment_status === 'paid',
    paymentStatus: session?.payment_status ?? 'unknown',

    items: resolved,
    // True when the catalog could not name the pieces, so the panel can say so
    // rather than quietly showing a thinner order than the one that was placed.
    itemsFromStripe: resolved.some((item) => item.fromStripe),
    // Kept regardless, so nothing about what was ordered is ever unrecoverable.
    rawCart: ordered,

    totals: {
      subtotal: money(session?.amount_subtotal),
      shipping: money(session?.total_details?.amount_shipping),
      tax: money(session?.total_details?.amount_tax),
      discount: money(session?.total_details?.amount_discount),
      total: money(session?.amount_total),
      currency: (session?.currency ?? 'usd').toUpperCase(),
    },

    customer: {
      name: shipping?.name || session?.customer_details?.name || '',
      email: session?.customer_details?.email || '',
      phone: session?.customer_details?.phone || '',
      address: formatAddress(shipping),
    },
  };
}

// Newest first. Stripe returns them that way already, but an order list sorted
// by anything else is a bug nobody reports and everybody works around.
export function sortOrders(orders) {
  return [...orders].sort((a, b) => String(b.placedAt ?? '').localeCompare(String(a.placedAt ?? '')));
}

// A dashboard link, so a row in the panel leads straight to the payment. The
// path differs between test and live, which is exactly the sort of detail that
// is wrong for months if it is guessed.
export function dashboardUrl(order) {
  if (!order?.paymentIntent) return null;

  return order.live
    ? `https://dashboard.stripe.com/payments/${order.paymentIntent}`
    : `https://dashboard.stripe.com/test/payments/${order.paymentIntent}`;
}

export function orderSummary(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const paid = list.filter((order) => order.paid);

  return {
    count: paid.length,
    // The number that actually matters day to day: parcels still to go out.
    toShip: paid.filter((order) => !order.shippedAt).length,
    // In cents on the way through, so a run of orders does not accumulate a
    // floating-point tail.
    total: Math.round(paid.reduce((sum, order) => sum + order.totals.total * 100, 0)) / 100,
    // A live order among test ones, or the reverse, is worth seeing.
    anyLive: paid.some((order) => order.live),
    anyTest: paid.some((order) => !order.live),
  };
}
