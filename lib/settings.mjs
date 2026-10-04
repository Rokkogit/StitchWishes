// Shipping, fees, and what an order comes to.
//
// Pure. These are the numbers that will decide what a customer is charged, so
// they are validated as strictly as the catalog is, and totals are computed
// here rather than anywhere a browser can reach.

// A fee applies to every order automatically. A slipped decimal point would
// not produce one strange total, it would quietly overcharge every customer
// until somebody noticed. A ceiling turns that typo into a rejected save.
export const MAX_AMOUNT = 500;

// No US jurisdiction comes close to this. The cap exists to catch the typo
// that matters: 950 typed for 9.50, which would charge a customer ten times
// the order and is the kind of mistake that is noticed by a chargeback.
export const MAX_RATE = 25;

const MAX_LABEL = 60;

export const DEFAULT_SETTINGS = Object.freeze({
  // $6 flat, which is the shop's actual rate. This is a fallback, not the
  // setting: the moment anything is saved in the Checkout tab, the stored value
  // wins and this is never consulted again.
  //
  // It is a real rate rather than zero because of which way the mistake cuts. A
  // shop that has not configured shipping yet still has to put parcels in the
  // post, and free postage on every order is a loss that looks like nothing at
  // all. Postage that is briefly wrong is a number someone notices and fixes.
  //
  // includedInPrices is the shop's answer to the oldest finding in online
  // retail: a postage line added at the end loses orders that a higher price
  // never would. The amount is built into every price instead and the customer
  // is told, truthfully, that shipping is free.
  shipping: Object.freeze({ label: 'Shipping', amount: 6, enabled: true, includedInPrices: true }),
  fees: Object.freeze([]),
  // Off by default. Collecting tax is an obligation someone has to decide they
  // have; a shop should not start charging it because software assumed so.
  tax: Object.freeze({ label: 'Sales tax', rate: 0, enabled: false, includeShipping: false }),
});

/* ------------------------------------------------------------- money ---- */

// Money in floating point: 0.1 + 0.2 is 0.30000000000000004. Round through
// cents so a total is never a fraction of a penny out.
const cents = (value) => Math.round(Number(value) * 100);
const fromCents = (value) => Math.round(value) / 100;

function readAmount(value) {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return null;
  return number;
}

function cleanLabel(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------- validation ---- */

function checkCharge(charge, field, errors) {
  const label = cleanLabel(charge?.label);
  if (!label) {
    errors.push({ field, message: 'Give this a name customers will understand.' });
  } else if (label.length > MAX_LABEL) {
    errors.push({ field, message: `Names cap at ${MAX_LABEL} characters.` });
  }

  const amount = readAmount(charge?.amount);
  if (amount === null) {
    errors.push({ field, message: 'The amount must be a number.' });
  } else if (amount < 0) {
    errors.push({ field, message: 'The amount cannot be negative.' });
  } else if (amount > MAX_AMOUNT) {
    errors.push({ field, message: `The most you can charge here is $${MAX_AMOUNT}.` });
  }

  return { label, amount, enabled: charge?.enabled !== false };
}

export function validateSettings(settings) {
  if (settings == null) {
    return { ok: true, value: structuredClone(DEFAULT_SETTINGS), errors: [] };
  }

  if (typeof settings !== 'object') {
    return {
      ok: false,
      errors: [{ field: 'settings', message: 'Checkout settings are missing.' }],
    };
  }

  const errors = [];

  const givenShipping = settings.shipping ?? DEFAULT_SETTINGS.shipping;
  const shipping = checkCharge(givenShipping, 'shipping', errors);

  // Absent means included, which is the one default here that is not simply
  // "what was stored before".
  //
  // The reason is the same one that lets design names and handles be fixed on
  // the way out of the store: settings saved before this existed cannot carry
  // the key, and there is no migration step that could add it. Reading absent
  // as "charge it separately" would mean the shop kept a postage line until
  // somebody found the switch. Reading it as included matches what the shop
  // decided to do, and the switch is there to say otherwise.
  shipping.includedInPrices = givenShipping?.includedInPrices !== false;

  const rawFees = Array.isArray(settings.fees) ? settings.fees : [];
  const fees = rawFees.map((fee, index) => ({
    // Kept rather than regenerated: switching a fee off should not lose it,
    // and a seasonal fee that comes back should not need retyping.
    id: typeof fee?.id === 'string' && fee.id ? fee.id : `fee-${index}`,
    ...checkCharge(fee, `fees[${index}]`, errors),
  }));

  const tax = checkTax(settings.tax, errors);

  if (errors.length) return { ok: false, errors };

  return { ok: true, value: { shipping, fees, tax }, errors: [] };
}

function checkTax(tax, errors) {
  if (tax == null) return structuredClone(DEFAULT_SETTINGS.tax);

  const label = cleanLabel(tax.label) || 'Sales tax';
  const rate = readAmount(tax.rate);

  if (rate === null) {
    errors.push({ field: 'tax', message: 'The rate must be a number, like 9.5 for 9.5%.' });
  } else if (rate < 0) {
    errors.push({ field: 'tax', message: 'The rate cannot be negative.' });
  } else if (rate > MAX_RATE) {
    errors.push({ field: 'tax', message: `${MAX_RATE}% is the ceiling — check for a stray decimal point.` });
  }

  return {
    label,
    rate: rate ?? 0,
    enabled: tax.enabled === true,
    // Whether shipping is taxable varies by state, so this is a decision she
    // makes rather than something guessed at in code.
    includeShipping: tax.includeShipping === true,
  };
}

/* ---------------------------------------------------------- shipping ---- */

/* Whether postage is built into the prices rather than charged on top.

   This is the single answer to that question. Four things depend on it - what
   every price on the site reads, whether a shipping line appears on an order,
   what Stripe is told to charge, and what the pages say about postage - and
   they have to agree or the shop quotes one number and bills another. */
export function shippingIncluded(settings) {
  const shipping = (settings ?? DEFAULT_SETTINGS).shipping ?? DEFAULT_SETTINGS.shipping;

  // Switched off entirely is genuinely free: nothing is charged and nothing is
  // built in. Still free postage to a customer, so the site says the same
  // thing; it just has nothing to add to a price.
  if (shipping?.enabled === false) return false;

  return shipping?.includedInPrices !== false;
}

// What each price carries, in dollars. Zero whenever nothing is being
// absorbed, so callers can treat it as "add this" without asking why.
export function includedShipping(settings) {
  if (!shippingIncluded(settings)) return 0;

  const shipping = (settings ?? DEFAULT_SETTINGS).shipping ?? DEFAULT_SETTINGS.shipping;
  const amount = Number(shipping?.amount);

  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

// Whether the shop can say "free shipping" and mean it. True both when postage
// is built into the prices and when it is switched off altogether, because in
// both cases a customer pays nothing for postage at checkout.
export function shippingIsFree(settings) {
  const shipping = (settings ?? DEFAULT_SETTINGS).shipping ?? DEFAULT_SETTINGS.shipping;

  if (shipping?.enabled === false) return true;
  if (shippingIncluded(settings)) return true;

  return !(Number(shipping?.amount) > 0);
}

/* ------------------------------------------------------------ totals ---- */

// Every charge is its own labelled line, so a customer sees what they are
// paying for rather than one inflated number.
export function orderTotal(items, settings) {
  const config = settings ?? DEFAULT_SETTINGS;

  const list = Array.isArray(items) ? items : [];

  // An empty cart costs nothing. Shipping and fees attach to an order, and
  // there is no order — without this, an empty cart quoted at the price of
  // postage and handling on nothing at all.
  if (!list.length) {
    return { subtotal: 0, shipping: 0, fees: 0, tax: 0, total: 0, lines: [] };
  }

  const itemCents = list.reduce(
    (sum, item) => sum + cents(item?.price ?? 0) * Math.max(1, Math.trunc(item?.quantity ?? 1)),
    0
  );

  const lines = [];

  // Nothing is charged for postage when it is already inside the prices. The
  // line is still drawn, at zero and marked free, because a total with no
  // shipping row at all leaves a customer wondering when it gets added. Saying
  // "Shipping — Free" is the whole point of absorbing it.
  const absorbed = shippingIncluded(config);

  const shippingCents =
    absorbed || config.shipping?.enabled === false ? 0 : cents(config.shipping?.amount ?? 0);

  if (shippingCents > 0) {
    lines.push({ label: cleanLabel(config.shipping?.label) || 'Shipping', amount: fromCents(shippingCents) });
  } else if (shippingIsFree(config)) {
    lines.push({ label: cleanLabel(config.shipping?.label) || 'Shipping', amount: 0, free: true });
  }

  let feeCents = 0;
  for (const fee of config.fees ?? []) {
    if (fee?.enabled === false) continue;
    const amount = cents(fee?.amount ?? 0);
    if (amount <= 0) continue;

    feeCents += amount;
    lines.push({ label: cleanLabel(fee?.label) || 'Fee', amount: fromCents(amount) });
  }

  // Tax last, on the base it applies to. Percentages are computed in cents and
  // rounded once, so the figure is a real amount of money rather than a
  // fraction of a penny that drifts across an order.
  const tax = config.tax ?? DEFAULT_SETTINGS.tax;
  let taxCents = 0;

  if (tax.enabled === true && Number(tax.rate) > 0) {
    const base = itemCents + (tax.includeShipping === true ? shippingCents : 0);
    taxCents = Math.round((base * Number(tax.rate)) / 100);

    if (taxCents > 0) {
      // The rate is in the label so a customer can check the arithmetic, and
      // so a wrong rate is visible on the page rather than only in a total.
      lines.push({
        label: `${cleanLabel(tax.label) || 'Sales tax'} (${Number(tax.rate)}%)`,
        amount: fromCents(taxCents),
      });
    }
  }

  const totalCents = Math.max(0, itemCents + shippingCents + feeCents + taxCents);

  return {
    tax: fromCents(taxCents),
    // Named subtotal, not items: a caller that also has a list of items would
    // otherwise clobber one with the other when spreading this, which is
    // exactly what happened the first time.
    subtotal: fromCents(itemCents),
    shipping: fromCents(shippingCents),
    fees: fromCents(feeCents),
    total: fromCents(totalCents),
    lines,
  };
}
