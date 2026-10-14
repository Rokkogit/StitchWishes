// Turning what a browser claims is in a cart into what may actually be sold.
//
// The incoming cart is untrusted. It comes from localStorage, which anyone can
// edit, so nothing in it is believed except which piece was meant, which
// design, which choices, and how many were wanted — and even the quantity is
// checked against stock.
//
// Prices, names and photographs all come from the catalog. If the browser were
// allowed to name a price, eventually it would name one cent.

import { findDesign, priceFor, stockFor, readColourChoice } from './variants.mjs';

function wantedQuantity(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return 1;
  return Math.trunc(number);
}

// A piece and a design together are what identifies a line. Two designs of the
// same sign are two different things to make and two different things to ship,
// so they cannot share a row.
// A colour counts too, where a piece offers one: two colours of the same piece
// are two different things to make and two different things to ship.
//
// (The separator used to be a literal NUL byte, which worked but made the file
// read as binary to every search tool there is.)
// Choices count too, for exactly the same reason: one Pineapple and one Dark
// Side are not two Pineapple. Left out of the key they merged into a single
// line, which recorded one scent, charged for two, and sent somebody two of
// the wrong thing.
//
// Only choices already resolved against the piece go in, so a junk id in
// localStorage cannot split one line into two and slip each half under the
// stock check.
const lineKey = (handle, designId, colour, choiceIds = {}) =>
  `${handle} | ${designId ?? ''} | ${colour ?? ''} | ${Object.keys(choiceIds)
    .sort()
    .map((axis) => `${axis}=${choiceIds[axis]}`)
    .join('&')}`;

// Only the choices the catalog actually offers, resolved to their labels. An
// id that means nothing is dropped rather than written onto an order, where it
// would be an instruction nobody can follow.
function resolveChoices(product, chosen) {
  const offered = Array.isArray(product?.choices) ? product.choices : [];
  if (!offered.length || !chosen || typeof chosen !== 'object') return { labels: [], ids: {} };

  const labels = [];
  const ids = {};

  for (const axis of offered) {
    const wantedId = chosen[axis.id];
    const value = (axis.values ?? []).find((entry) => entry.id === wantedId);
    if (!value) continue;

    labels.push({ label: axis.label, value: value.label });
    // The ids as well as the words. The words are for a person to read; the
    // ids are what gets written onto the order, so that reading it back
    // resolves against the catalog rather than against a string that may since
    // have been reworded.
    ids[axis.id] = value.id;
  }

  return { labels, ids };
}

export function resolveCart(cart, products) {
  const catalog = Array.isArray(products) ? products : [];
  const lines = Array.isArray(cart) ? cart : [];

  const byHandle = new Map(catalog.map((product) => [product?.handle, product]));

  // Former addresses too. A bag was filled weeks ago and still sits in
  // somebody's browser; an order placed last month recorded the handle a piece
  // had then. Both must still resolve, or renaming a piece empties carts and
  // blanks the rows the Orders tab needs to pack a parcel.
  //
  // A current handle always wins: added only where nothing claims the name, so
  // a piece's own address can never be shadowed by another's history.
  for (const product of catalog) {
    for (const old of product?.previousHandles ?? []) {
      if (!byHandle.has(old)) byHandle.set(old, product);
    }
  }

  // Merge first, so two entries for the same piece and design are checked
  // against stock once rather than each slipping under the limit on its own.
  const wanted = new Map();
  for (const line of lines) {
    const handle = line?.handle;
    if (typeof handle !== 'string' || !handle) continue;

    // Under the address the piece answers to now, so a bag holding both the old
    // and the new name is one row of two rather than two rows each checked
    // against stock on its own.
    const canonical = byHandle.get(handle)?.handle ?? handle;

    const designId = typeof line?.design === 'string' && line.design ? line.design : null;

    // Checked against the piece before it is used as part of an identity, so a
    // junk value cannot split one row into two, and a colour cannot be stuck
    // onto a piece that never offered one.
    const colour = readColourChoice(byHandle.get(canonical), line?.colour ?? line?.color);

    const key = lineKey(
      canonical,
      designId,
      colour,
      resolveChoices(byHandle.get(canonical), line?.choices).ids
    );
    const existing = wanted.get(key);

    if (existing) existing.quantity += wantedQuantity(line?.quantity);
    else {
      wanted.set(key, {
        handle: canonical,
        designId,
        quantity: wantedQuantity(line?.quantity),
        choices: line?.choices,
        colour,
      });
    }
  }

  const items = [];
  const problems = [];
  const reject = (handle, message) => problems.push({ handle, message });

  for (const line of wanted.values()) {
    if (line.quantity <= 0) continue;

    const product = byHandle.get(line.handle);
    if (!product) {
      reject(line.handle, 'That piece is no longer in the catalog.');
      continue;
    }

    if (product.hidden === true) {
      reject(line.handle, `"${product.title}" is not available right now.`);
      continue;
    }

    const hasDesigns = (product.designs?.options ?? []).length > 0;
    const design = hasDesigns ? findDesign(product, line.designId) : null;

    // A piece that comes in several designs cannot be bought as "the piece" —
    // there would be no way to know which one to make.
    if (hasDesigns && !design) {
      reject(
        line.handle,
        line.designId
          ? `That design of "${product.title}" is no longer offered. Choose another.`
          : `Choose a design for "${product.title}".`
      );
      continue;
    }

    const price = priceFor(product, design ? design.id : null);
    if (price == null) {
      reject(line.handle, `"${product.title}" has no price yet, so it cannot be bought.`);
      continue;
    }

    // null stock means made to order: there is no ceiling to hit.
    const chosenOptions = resolveChoices(product, line.choices);

    const stock = stockFor(product, design ? design.id : null);
    const name = design ? [product.title, design.name].filter(Boolean).join(' — ') : product.title;

    if (stock === 0) {
      reject(line.handle, `"${name}" is sold out.`);
      continue;
    }

    let allowed = line.quantity;
    if (Number.isFinite(stock) && line.quantity > stock) {
      allowed = stock;
      reject(line.handle, `Only ${stock} of "${name}" left, so the rest were removed.`);
    }

    items.push({
      handle: line.handle,
      design: design ? design.id : null,
      designName: design ? design.name : null,
      title: product.title,
      price,
      // What it cost before a sale reduced it, where one did. Carried so the
      // bag can strike it through rather than quietly charging less than the
      // page said and leaving somebody to wonder why.
      wasPrice: design?.wasPrice ?? product.wasPrice ?? null,
      quantity: allowed,
      // The design's own photograph, since that is what was actually chosen.
      image: design?.image ?? product.images?.[0] ?? null,
      // Already checked against the piece above. Carried on the item so the
      // bag, the Stripe line and the Orders tab all name the same colour.
      colour: line.colour,
      colourLabel: line.colour ? (product.customColor?.label ?? 'Colour') : null,
      choices: chosenOptions.labels,
      // Carried through to the Stripe metadata, which is what the Orders tab
      // reads an order back out of. Without it, somebody who picked a scent
      // has paid for one thing and the packing list says nothing about which.
      choiceIds: chosenOptions.ids,
    });
  }

  return { items, problems };
}
