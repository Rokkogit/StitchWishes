// Giving four pieces addresses a person would be willing to send someone.
//
// Shopify generated these from the time of day a draft was created:
//
//   /p/untitled-may1_12-21
//   /p/untitled-apr30_15-01
//   /p/untitled-apr26_16-08
//   /p/untitled-apr30_16-33
//
// Nobody chose them. They are the same kind of artefact as the design names
// that read "Design 3", and they are fixed the same way: at read time, on the
// way out of the store, because there are no credentials here to write to it.
// The moment anything is saved in the admin panel, the new handles are written
// down and this stops doing anything.
//
// The safety net is previousHandles, which /p/ redirects from and the cart
// resolves through - so every link already shared, every bag already filled
// and every past order still works. Renaming a URL with nothing catching the
// old one turns somebody trying to buy into a 404, which is why these sat
// ugly rather than being quietly swapped.

export const RENAMES = Object.freeze({
  'untitled-may1_12-21': 'blue-alien-beaded-pens',
  'untitled-apr30_15-01': 'blue-alien-keychains',
  'untitled-apr26_16-08': 'stitchery-notebook',
  'untitled-apr30_16-33': 'hunny-beaded-pens',
});

// Only an address nobody chose. A handle somebody typed is a decision and is
// never touched - the same rule that lets design names be filled in without
// overwriting a name Abi wrote herself.
export function renameLegacyHandles(products) {
  if (!Array.isArray(products)) return [];

  // Never rename onto an address already in use. If a piece called
  // blue-alien-beaded-pens exists, two pieces would answer to one URL and one
  // of them would become unreachable.
  const taken = new Set(products.map((piece) => piece?.handle).filter(Boolean));

  return products.map((piece) => {
    const next = RENAMES[piece?.handle];
    if (!next || taken.has(next)) return piece;

    return {
      ...piece,
      handle: next,
      previousHandles: [
        ...(piece.previousHandles ?? []).filter((h) => h !== piece.handle && h !== next),
        piece.handle,
      ].slice(-10),
    };
  });
}

// Every address a piece answers to, current and former. Used where something
// recorded earlier - a bag in somebody's browser, the cart written into a
// Stripe payment months ago - still names the old one.
export function handlesOf(piece) {
  return [piece?.handle, ...(piece?.previousHandles ?? [])].filter(Boolean);
}
