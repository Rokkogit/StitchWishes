// Turning a priced-up bag into the parameters for a Stripe Checkout Session.
//
// Pure, and separate from the route, because this is where a customer's total is
// decided and it should be assertable in a test rather than only observable on a
// card statement.
//
// The rule that shapes it: what Stripe charges must equal what the bag showed.
// Stripe recomputes the total from the line items it is handed, so the two are
// worked out independently and then compared. If they disagree, nothing is
// charged at all — a customer seeing $31.98 and being billed $37.98 is the worst
// bug this code could have, and it is the kind that would go unnoticed for weeks.

import { toCents, cartMetadata } from './stripe.mjs';
import { absoluteUrl } from './page-meta.mjs';

// What a line is called on the Stripe page, on the receipt and on the card
// statement. The design belongs in the name because it is what distinguishes two
// otherwise identical rows.
function lineName(item) {
  return [item?.title, item?.designName].filter(Boolean).join(' — ');
}

// Choices are recorded so the piece can be made correctly, so they go where the
// customer can check them before paying.
function lineDescription(item) {
  const choices = (item?.choices ?? [])
    .map((choice) => `${choice?.label}: ${choice?.value}`)
    .join(', ');

  return choices || undefined;
}

export function lineItems(items, origin) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const image = absoluteUrl(origin, item?.image);

    return {
      price_data: {
        currency: 'usd',
        unit_amount: toCents(item?.price),
        product_data: {
          name: lineName(item) || 'Handmade piece',
          description: lineDescription(item),
          // Stripe takes up to eight; one is what a checkout page shows.
          images: image ? [image] : undefined,
        },
      },
      quantity: Math.max(1, Math.trunc(Number(item?.quantity) || 1)),
    };
  });
}

export function sessionParams({ items, totals, settings, origin, reference }) {
  const lines = lineItems(items, origin);

  // Fees ride as their own line items. Checkout has no generic "fee" concept, so
  // a clearly named line is the honest way to show one.
  const extras = [];

  for (const fee of settings?.fees ?? []) {
    if (fee?.enabled === false) continue;
    const amount = toCents(fee?.amount ?? 0);
    if (amount <= 0) continue;

    extras.push({
      price_data: {
        currency: 'usd',
        unit_amount: amount,
        product_data: { name: fee.label || 'Fee' },
      },
      quantity: 1,
    });
  }

  // Tax as a line item rather than through Stripe Tax. Stripe Tax is the right
  // mechanism eventually, but it needs a registration and a decision about where
  // the shop has an obligation — neither of which software can assume. This
  // charges exactly what the bag showed, labelled with the rate so a customer
  // can check the arithmetic.
  const taxCents = toCents(totals?.tax ?? 0);
  if (taxCents > 0) {
    const tax = settings?.tax ?? {};
    extras.push({
      price_data: {
        currency: 'usd',
        unit_amount: taxCents,
        product_data: { name: `${tax.label || 'Sales tax'} (${Number(tax.rate)}%)` },
      },
      quantity: 1,
    });
  }

  const shippingCents = toCents(totals?.shipping ?? 0);

  const params = {
    mode: 'payment',
    line_items: [...lines, ...extras],

    // No payment_method_types, deliberately. Left off, Stripe offers whatever
    // the account has enabled and the device supports, which is how Apple Pay
    // and Google Pay appear without any work here.
    submit_type: 'pay',

    // The session id comes back on the success page so it can show the order
    // rather than a bare thank you.
    success_url: `${origin}/thanks?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/bag`,

    // US only, matching the shipping policy. Collected by Stripe rather than by
    // a form here, so an address is validated before any money moves.
    shipping_address_collection: { allowed_countries: ['US'] },
    billing_address_collection: 'auto',

    metadata: { ...cartMetadata(items), reference: reference ?? '' },
  };

  if (shippingCents > 0) {
    params.shipping_options = [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: shippingCents, currency: 'usd' },
          display_name: settings?.shipping?.label || 'Shipping',
        },
      },
    ];
  }

  return params;
}

// What Stripe will arrive at, computed from the same parameters it is being
// handed rather than from the figures they were built out of.
export function stripeTotalCents(params) {
  const lines = (params?.line_items ?? []).reduce(
    (sum, line) => sum + (line?.price_data?.unit_amount ?? 0) * (line?.quantity ?? 1),
    0
  );

  const shipping = (params?.shipping_options ?? []).reduce(
    (sum, option) => sum + (option?.shipping_rate_data?.fixed_amount?.amount ?? 0),
    0
  );

  return lines + shipping;
}

// The check that matters. Returns the params only if Stripe's total matches the
// bag's, and says by how much it is out if not.
export function checkedSessionParams(input) {
  const params = sessionParams(input);

  const expected = toCents(input?.totals?.total ?? 0);
  const actual = stripeTotalCents(params);

  if (expected !== actual) {
    return {
      ok: false,
      reason: 'total-mismatch',
      expected,
      actual,
    };
  }

  return { ok: true, params, cents: actual };
}
