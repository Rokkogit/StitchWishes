// Ways to take money off an order.
//
// Four kinds, because they answer four different questions:
//
//   code    somebody types SAVE10 in the bag
//   sale    a percentage off, automatically, between two dates
//   bundle  buy three of a thing, and the three cost a set price
//   spend   spend $50, get $10 off
//
// They are kept in one module because they share the hard part. Taking money
// off is easy; taking the RIGHT money off, once, in an order the customer can
// check and the shop can afford, is not.
//
// The rules that hold all four together:
//
//   A sale changes what a piece costs. It is not a discount line - it is the
//   price. That is why a sale shows as a struck-through price on the shelf and
//   why the bag's subtotal is already the sale subtotal.
//
//   Everything else is a line on the order, worked out from that subtotal, so
//   a customer can see what came off and why.
//
//   Nothing ever comes off postage, fees or tax. The total discount is capped
//   at what the pieces are worth, so a generous code cannot turn an order into
//   a refund.
//
//   One code per order. Codes stacking is how a shop accidentally gives 70%
//   off, and explaining why two codes did not combine is worse than saying so
//   up front.
//
// Every amount here is in cents. Percentages of money in floating point drift,
// and an order that is a penny out is an order somebody emails about.

export const KINDS = Object.freeze(['code', 'sale', 'bundle', 'spend']);

// Fifty is far more than a one-person shop will run at once, and a ceiling
// means a corrupted store cannot produce a list that takes a second to price.
export const MAX_PROMOTIONS = 50;

// Ninety percent, not a hundred. A free order is almost always a typo, and the
// one time it is not, it is two codes away from being one anyway.
export const MAX_PERCENT = 90;
export const MAX_AMOUNT = 500;
export const MAX_LABEL = 60;
export const MAX_CODE = 24;

const cents = (value) => Math.round(Number(value) * 100);
const fromCents = (value) => Math.round(value) / 100;

/* ----------------------------------------------------------- validation */

const clean = (value, max) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// Codes are compared with case and spacing thrown away, because a customer
// typing " save10 " on a phone keyboard means SAVE10 and being told otherwise
// is a sale lost to punctuation.
export const normalizeCode = (value) =>
  String(value ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .slice(0, MAX_CODE);

const readDate = (value) => {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
};

const readNumber = (value) => {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/* Never refuses the whole list over one bad entry.

   A promotion is a thing somebody typed into a form. One of them being wrong
   should cost that one promotion, not the shop's ability to save anything -
   and certainly not the four that were already running. */
export function validatePromotions(value) {
  if (value == null) return { ok: true, value: [], errors: [] };
  if (!Array.isArray(value)) return { ok: true, value: [], errors: [] };

  const errors = [];
  const out = [];
  const codesSeen = new Set();

  for (const [index, raw] of value.slice(0, MAX_PROMOTIONS).entries()) {
    if (!raw || typeof raw !== 'object') continue;

    const kind = KINDS.includes(raw.kind) ? raw.kind : 'code';
    const label = clean(raw.label, MAX_LABEL);

    const percent = readNumber(raw.percent);
    const amount = readNumber(raw.amount);

    const hasPercent = percent !== null && percent > 0;
    const hasAmount = amount !== null && amount > 0;

    // A bundle needs neither: the free piece IS the discount, and asking for a
    // percentage on top would be a second deal nobody asked for.
    //
    // Everything else without one is a promotion that takes nothing off, which
    // would sit in the list looking live and do nothing.
    if (kind !== 'bundle' && !hasPercent && !hasAmount) {
      errors.push({ field: `promotions[${index}]`, message: 'Say how much comes off.' });
      continue;
    }

    if (hasPercent && percent > MAX_PERCENT) {
      errors.push({
        field: `promotions[${index}]`,
        message: `${MAX_PERCENT}% is the most you can take off.`,
      });
      continue;
    }

    if (hasAmount && amount > MAX_AMOUNT) {
      errors.push({ field: `promotions[${index}]`, message: `$${MAX_AMOUNT} is the most you can take off.` });
      continue;
    }

    const promo = {
      id: clean(raw.id, 40) || `promo-${index}`,
      kind,
      label: label || defaultLabel(kind),
      // Percentage wins where both are set, rather than silently applying both.
      percent: hasPercent ? Math.round(percent * 100) / 100 : null,
      amount: hasAmount && !hasPercent ? Math.round(amount * 100) / 100 : null,
      enabled: raw.enabled !== false,
      starts: readDate(raw.starts),
      ends: readDate(raw.ends),
      // What it applies to: everything, one category, or one piece.
      scope: ['all', 'category', 'piece'].includes(raw.scope) ? raw.scope : 'all',
      target: clean(raw.target, 80) || null,
      // Whether the shop advertises it. On unless switched off, including for
      // codes - a code is usually made to be told to people. The switch is
      // there for the one that is not: a code given to a single customer to
      // put something right should not end up on the shelf.
      showOnSite: raw.showOnSite !== false,
    };

    if (promo.starts && promo.ends && promo.ends <= promo.starts) {
      errors.push({ field: `promotions[${index}]`, message: 'It ends before it starts.' });
      continue;
    }

    if (kind === 'code') {
      promo.code = normalizeCode(raw.code);
      if (!promo.code) {
        errors.push({ field: `promotions[${index}]`, message: 'A discount code needs a code.' });
        continue;
      }

      // Two codes with one word is a coin toss over which one a customer gets.
      if (codesSeen.has(promo.code)) {
        errors.push({ field: `promotions[${index}]`, message: `${promo.code} is used twice.` });
        continue;
      }

      codesSeen.add(promo.code);

      const limit = readNumber(raw.limit);
      promo.limit = limit !== null && limit > 0 ? Math.trunc(limit) : null;
    }

    if (kind === 'bundle') {
      const buy = readNumber(raw.buy);
      promo.buy = buy !== null && buy >= 2 ? Math.trunc(buy) : 2;

      // What that many cost together. The whole point of this kind: "3 for
      // $30" is a number somebody can picture, where "buy 3 pay for 2" makes
      // them do arithmetic on prices they have not added up yet.
      const price = readNumber(raw.price);
      if (price === null || price < 0) {
        errors.push({ field: `promotions[${index}]`, message: 'Say what the set costs together.' });
        continue;
      }

      if (price > MAX_AMOUNT * 10) {
        errors.push({ field: `promotions[${index}]`, message: 'That set price looks like a typo.' });
        continue;
      }

      promo.price = Math.round(price * 100) / 100;
    }

    if (kind === 'spend') {
      const spend = readNumber(raw.spend);
      if (spend === null || spend <= 0) {
        errors.push({ field: `promotions[${index}]`, message: 'Say how much they have to spend.' });
        continue;
      }
      promo.spend = Math.round(spend * 100) / 100;
    }

    out.push(promo);
  }

  return { ok: true, value: out, errors };
}

const defaultLabel = (kind) =>
  ({ code: 'Discount code', sale: 'Sale', bundle: 'Bundle deal', spend: 'Spend and save' })[kind] ?? 'Discount';

/* --------------------------------------------------------------- status */

/* Whether a promotion is doing anything right now, and why not if it is not.

   Four states rather than a boolean, because "off" and "finished" and "not
   started yet" need different things done about them, and a panel that shows
   them all as "inactive" makes somebody check the dates by hand. */
export function statusOf(promo, now = Date.now(), usage = {}) {
  if (!promo || promo.enabled === false) return 'off';
  if (promo.starts && now < promo.starts) return 'scheduled';
  if (promo.ends && now > promo.ends) return 'ended';

  if (promo.kind === 'code' && promo.limit) {
    const used = Number(usage?.[promo.id] ?? 0);
    if (used >= promo.limit) return 'used up';
  }

  return 'live';
}

export const isLive = (promo, now = Date.now(), usage = {}) => statusOf(promo, now, usage) === 'live';

/* ---------------------------------------------------------------- scope */

// Whether this promotion touches this piece. A category or a single piece
// rather than a free-form rule: anything cleverer is a rule nobody can predict
// the effect of, on their own shop, at eleven at night.
export function covers(promo, product) {
  if (!promo || !product) return false;
  if (promo.scope === 'all') return true;
  if (promo.scope === 'category') return (product.category ?? null) === promo.target;
  if (promo.scope === 'piece') return product.handle === promo.target;

  return false;
}

/* ---------------------------------------------------------------- sales */

/* The catalog at today's prices.

   A sale is not a line on an order; it is what the piece costs today. So it is
   applied to the catalog itself, before anything is priced, and every part of
   the shop that reads a price gets the sale price without knowing a sale
   exists. The original is kept as wasPrice so the shelf can show what it was.

   Designs carry their own prices where they have them, so they are reduced
   too - otherwise choosing the dearer design would quietly escape the sale. */
export function applySales(products, promotions, now = Date.now()) {
  const list = Array.isArray(products) ? products : [];

  const sales = (Array.isArray(promotions) ? promotions : []).filter(
    (promo) => promo.kind === 'sale' && isLive(promo, now)
  );

  if (!sales.length) return list;

  return list.map((product) => {
    if (!product || product.price == null) return product;

    // The best one wins. Two sales on one piece stacking is how 30% and 30%
    // becomes 51% off and nobody notices until the month's takings.
    const best = sales
      .filter((promo) => covers(promo, product))
      .reduce((most, promo) => Math.max(most, cutFor(promo, cents(product.price))), 0);

    if (best <= 0) return product;

    const reduce = (price) => {
      if (price == null) return price;
      const base = cents(price);
      return fromCents(Math.max(0, base - cutFor(bestPromoFor(sales, product, base), base)));
    };

    const sale = { ...product, price: reduce(product.price), wasPrice: product.price };

    const options = product.designs?.options;
    if (Array.isArray(options) && options.length) {
      sale.designs = {
        ...product.designs,
        options: options.map((option) =>
          option && option.price != null
            ? { ...option, price: reduce(option.price), wasPrice: option.price }
            : option
        ),
      };
    }

    return sale;
  });
}

const bestPromoFor = (sales, product, base) =>
  sales
    .filter((promo) => covers(promo, product))
    .reduce((best, promo) => (cutFor(promo, base) > cutFor(best, base) ? promo : best), null);

// What one promotion takes off a given number of cents.
function cutFor(promo, base) {
  if (!promo || base <= 0) return 0;
  if (promo.percent) return Math.round((base * promo.percent) / 100);

  return Math.min(base, cents(promo.amount ?? 0));
}

/* ------------------------------------------------------------ discounts */

/* Everything that comes off the order after the pieces are priced.

   Returns cents and a line per discount, so the bag can show what happened
   rather than a smaller number with no explanation.

   A code is only applied if one was typed AND it is live AND it has not run
   out. A code that does not exist is reported rather than ignored, because a
   customer who typed one and sees no change assumes the shop is broken. */
export function orderDiscounts({ items, products, promotions, code, now = Date.now(), usage = {} } = {}) {
  const lines = [];
  const list = Array.isArray(promotions) ? promotions : [];
  const byHandle = new Map((Array.isArray(products) ? products : []).map((p) => [p?.handle, p]));

  const rows = (Array.isArray(items) ? items : []).map((item) => ({
    item,
    product: byHandle.get(item?.handle) ?? null,
    each: cents(item?.price ?? 0),
    quantity: Math.max(1, Math.trunc(Number(item?.quantity) || 1)),
  }));

  const subtotal = rows.reduce((sum, row) => sum + row.each * row.quantity, 0);
  if (subtotal <= 0) return { cents: 0, lines: [], code: null, codeProblem: null };

  /* bundles: any N of these cost a set price */
  for (const promo of list.filter((p) => p.kind === 'bundle' && isLive(p, now))) {
    const eligible = rows.filter((row) => row.product && covers(promo, row.product));

    // Dearest first, so a complete set is made of the most expensive things
    // the customer is buying. That is the version of the deal they would pick
    // for themselves, and picking it for them is the only way the number on
    // the shelf stays true whatever ends up in the bag.
    const units = eligible
      .flatMap((row) => Array.from({ length: row.quantity }, () => row.each))
      .sort((a, b) => b - a);

    const sets = Math.floor(units.length / promo.buy);
    if (sets <= 0) continue;

    const setPrice = cents(promo.price);
    let off = 0;

    for (let set = 0; set < sets; set += 1) {
      const group = units.slice(set * promo.buy, (set + 1) * promo.buy);
      const full = group.reduce((sum, price) => sum + price, 0);

      // Never negative. A set price above what the pieces cost is a bad deal,
      // not a surcharge, so it simply does nothing.
      off += Math.max(0, full - setPrice);
    }

    if (off > 0) lines.push({ label: promo.label, amount: fromCents(off), cents: off, id: promo.id });
  }

  /* spend and save */
  for (const promo of list.filter((p) => p.kind === 'spend' && isLive(p, now))) {
    if (subtotal < cents(promo.spend)) continue;

    const off = cutFor(promo, subtotal);
    if (off > 0) lines.push({ label: promo.label, amount: fromCents(off), cents: off, id: promo.id });
  }

  /* one code */
  let applied = null;
  let codeProblem = null;
  const typed = normalizeCode(code);

  if (typed) {
    const match = list.find((promo) => promo.kind === 'code' && promo.code === typed);

    if (!match) {
      codeProblem = `${typed} is not a code we recognise.`;
    } else {
      const state = statusOf(match, now, usage);

      if (state === 'live') {
        // Only the part of the order the code covers.
        const base = rows
          .filter((row) => row.product && covers(match, row.product))
          .reduce((sum, row) => sum + row.each * row.quantity, 0);

        const off = cutFor(match, base);

        if (off > 0) {
          applied = match.code;
          lines.push({ label: match.label, amount: fromCents(off), cents: off, id: match.id, code: match.code });
        } else {
          codeProblem = `${typed} does not apply to anything in your bag.`;
        }
      } else {
        codeProblem =
          state === 'used up'
            ? `${typed} has been used as many times as it can be.`
            : state === 'ended'
              ? `${typed} has expired.`
              : `${typed} is not running yet.`;
      }
    }
  }

  // Never more than the pieces are worth. Postage, fees and tax are not
  // discounted away, and an order can never come to less than nothing.
  const total = Math.min(subtotal, lines.reduce((sum, line) => sum + line.cents, 0));

  return { cents: total, lines, code: applied, codeProblem };
}

/* ------------------------------------------------------------ the shelf */

// What a storefront needs to say about a piece: whether it is reduced, and
// from what. Kept here so a page never has to work out a sale for itself.
export function saleBadge(product) {
  if (!product?.wasPrice || product.price == null) return null;
  if (product.wasPrice <= product.price) return null;

  return {
    was: product.wasPrice,
    now: product.price,
    percent: Math.round(((product.wasPrice - product.price) / product.wasPrice) * 100),
  };
}

/* ---------------------------------------------------------- describing */

/* A promotion as a sentence somebody would say.

   Built here rather than in the storefront so the shelf, the piece, the bag
   and the panel all describe a deal the same way. Four places inventing their
   own wording is four chances to describe the same offer differently, and a
   customer who reads two of them stops believing either.

   Names are looked up rather than guessed: "Any 3 of Beaded Pens for $30"
   beats "Any 3 of blue-alien-beaded-pens for $30". */
export function describe(promo, { products = [], categories = [], short = false } = {}) {
  if (!promo) return '';

  const money = (value) => `$${(Number(value) || 0).toFixed(2)}`;

  const where =
    promo.scope === 'piece'
      ? products.find((piece) => piece?.handle === promo.target)?.title ?? 'this piece'
      : promo.scope === 'category'
        ? categories.find((entry) => entry?.id === promo.target)?.label ?? 'these'
        : 'everything';

  const off = promo.percent ? `${promo.percent}% off` : `${money(promo.amount)} off`;

  if (promo.kind === 'bundle') {
    // On a card the piece is already named above the line, so saying it again
    // just makes the line too long to read at a glance.
    if (short) return `Any ${promo.buy} for ${money(promo.price)}`;

    return `Any ${promo.buy} ${promo.scope === 'all' ? 'pieces' : `of ${where}`} for ${money(promo.price)}`;
  }

  if (promo.kind === 'spend') return `Spend ${money(promo.spend)}, get ${off}`;

  if (promo.kind === 'code') {
    if (short) return `${off} with ${promo.code}`;
    return `${off} ${promo.scope === 'all' ? '' : `on ${where} `}with code ${promo.code}`.replace(/\s+/g, ' ');
  }

  if (short) return off;

  return `${off} ${promo.scope === 'all' ? 'everything' : where}`;
}

/* Everything running right now that the shop is willing to advertise.

   Each one carries which handles it touches, so a page showing one piece can
   ask "does this apply here" without knowing what a scope is. */
export function liveOffers(promotions, products = [], categories = [], now = Date.now()) {
  return (Array.isArray(promotions) ? promotions : [])
    .filter((promo) => promo.showOnSite !== false && isLive(promo, now))
    .map((promo) => ({
      id: promo.id,
      kind: promo.kind,
      says: describe(promo, { products, categories }),
      // The same offer with the piece's name left out, for a card that
      // already carries it.
      short: describe(promo, { products, categories, short: true }),
      ends: promo.ends ?? null,
      scope: promo.scope,
      target: promo.target ?? null,
      buy: promo.buy ?? null,
      price: promo.price ?? null,
      spend: promo.spend ?? null,
      handles: (Array.isArray(products) ? products : [])
        .filter((piece) => covers(promo, piece))
        .map((piece) => piece.handle),
    }));
}

/* ------------------------------------------------------------- so close */

/* Offers the bag is one step away from.

   The most useful thing a shop can say at the bag is not "we have deals" but
   "one more and you have it". It is specific, it is true, and the customer is
   already holding the thing.

   Nothing invented: every line here is arithmetic on what is actually in the
   bag against a deal that is actually running. If the bag is not close to
   anything, this says nothing at all rather than nudging for its own sake. */
export function nearMisses({ items, products, promotions, now = Date.now() } = {}) {
  const list = (Array.isArray(promotions) ? promotions : []).filter((promo) => isLive(promo, now));
  const byHandle = new Map((Array.isArray(products) ? products : []).map((p) => [p?.handle, p]));

  const rows = (Array.isArray(items) ? items : []).map((item) => ({
    product: byHandle.get(item?.handle) ?? null,
    each: cents(item?.price ?? 0),
    quantity: Math.max(1, Math.trunc(Number(item?.quantity) || 1)),
  }));

  const subtotal = rows.reduce((sum, row) => sum + row.each * row.quantity, 0);
  const out = [];

  for (const promo of list) {
    if (promo.kind === 'bundle') {
      const units = rows
        .filter((row) => row.product && covers(promo, row.product))
        .reduce((count, row) => count + row.quantity, 0);

      // Nothing eligible in the bag at all is an advert, not a nudge, and the
      // offer is already shown on the pieces it covers.
      if (units === 0) continue;

      const short = promo.buy - (units % promo.buy);
      if (short === promo.buy) continue;   // already a whole number of sets

      out.push({
        id: promo.id,
        kind: 'bundle',
        need: short,
        says: `Add ${short} more and any ${promo.buy} come to ${fromCents(cents(promo.price)).toFixed(2)}`,
      });
    }

    if (promo.kind === 'spend') {
      const needed = cents(promo.spend) - subtotal;
      if (needed <= 0 || subtotal <= 0) continue;

      const off = promo.percent ? `${promo.percent}% off` : `$${Number(promo.amount).toFixed(2)} off`;

      out.push({
        id: promo.id,
        kind: 'spend',
        need: fromCents(needed),
        says: `Spend $${fromCents(needed).toFixed(2)} more to get ${off}`,
      });
    }
  }

  return out;
}
