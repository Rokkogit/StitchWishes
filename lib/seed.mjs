// Filling in designs for a catalog stored before designs existed.
//
// The store is authoritative. This is a migration, not an override, and the
// distinction has to hold in both directions: a piece that has never carried
// the field gets the shipped designs, and a piece saved with none keeps none.
//
// That works because validateProduct always writes `designs`, even as null.
// So the key being ABSENT means "this was stored before the feature", while
// the key being present and null means "someone decided there are none". The
// moment anything is saved, this stops applying — which is the correct
// lifetime for a migration.

export function fillMissingDesigns(products, seed) {
  if (!Array.isArray(products)) return [];
  if (!Array.isArray(seed)) return products;

  const bySeedHandle = new Map(seed.map((piece) => [piece?.handle, piece]));

  return products.map((piece) => {
    const source = bySeedHandle.get(piece?.handle);
    if (!source) return piece;

    const filled = { ...piece };
    let changed = false;

    // `in` rather than a truthiness check: null is a decision, absent is not.
    if (!('designs' in filled) && source.designs) {
      filled.designs = structuredClone(source.designs);
      changed = true;
    }

    if (!('choices' in filled) && source.choices?.length) {
      filled.choices = structuredClone(source.choices);
      changed = true;
    }

    return changed ? filled : piece;
  });
}
