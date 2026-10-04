// Filling in designs for a catalog stored before designs existed, and real
// names for designs that never got one.
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

import { isPlaceholderName } from './design-names.mjs';
import { renameLegacyHandles } from './handles.mjs';

// A name of "Design 3" was written by the generator, not chosen by anyone, so
// replacing it is not overriding a decision — it is finishing one that was
// never made. A name Abi has actually typed is left alone forever.
//
// Matched by photograph rather than by id: the photograph is what a design is,
// and ids are positional.
function namedFromSeed(designs, source) {
  const options = designs?.options ?? [];
  if (!options.length) return designs;

  const bySeedImage = new Map(
    (source?.designs?.options ?? []).map((option) => [option?.image, option?.name])
  );

  let changed = false;

  const named = options.map((option) => {
    if (!isPlaceholderName(option?.name)) return option;

    const better = bySeedImage.get(option?.image);
    if (!better || isPlaceholderName(better)) return option;

    changed = true;
    return { ...option, name: better };
  });

  return changed ? { ...designs, options: named } : designs;
}

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

    // Applies whether the designs were just filled in above or were already
    // stored. A catalog saved while the names were still placeholders would
    // otherwise keep them forever, with no way out but renaming 44 by hand.
    const named = namedFromSeed(filled.designs, source);
    if (named !== filled.designs) {
      filled.designs = named;
      changed = true;
    }

    return changed ? filled : piece;
  });
}

// Everything that has to happen between reading the store and using what it
// holds. One function because seven routes read the catalog, and a fix applied
// in six of them is a bug in the seventh - the catalog page would show one
// address while checkout expected another.
//
// Order matters: the designs are matched against the shipped catalog by
// handle, so that has to happen while the stored handles are still the ones
// the shipped catalog knows.
export function readyCatalog(products, seed) {
  return renameLegacyHandles(fillMissingDesigns(products, seed));
}
