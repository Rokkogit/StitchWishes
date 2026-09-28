// What the designs are called.
//
// These were all "Design 1" through "Design 10" — which is what a customer was
// choosing between on the product page, in the Stripe checkout and on the order
// email. The names come from looking at the photographs; these tests are about
// making sure they reach the shop and that a name Abi types is never overwritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DESIGN_NAMES, isPlaceholderName, nameFor } from '../lib/design-names.mjs';
import { fillMissingDesigns } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';

/* ----------------------------------------------------------- placeholders */

test('the generator\'s own placeholder is recognised as one', () => {
  for (const name of ['Design 1', 'Design 10', ' Design 3 ', '', '   ', null, undefined]) {
    assert.equal(isPlaceholderName(name), true, JSON.stringify(name));
  }
});

test('a real name is never mistaken for a placeholder', () => {
  for (const name of ['Pink Flamingo Float', 'Design of the Year', 'Ohana Means Family', 'Design']) {
    assert.equal(isPlaceholderName(name), false, name);
  }
});

test('a photograph with no name keeps whatever it was given', () => {
  assert.equal(nameFor('assets/unknown.jpg', 'Design 7'), 'Design 7');
  assert.equal(nameFor('assets/19E6E395-7C59-4D65-BB01-7DCAEC823026.jpg', 'Design 5'), 'Blue Butterfly');
});

/* ------------------------------------------------------------ the catalog */

test('every design in the shipped catalog has a real name', () => {
  // The thing this guards: a new design added later, shipping as "Design 9".
  const unnamed = [];

  for (const piece of SEED) {
    for (const option of piece.designs?.options ?? []) {
      if (isPlaceholderName(option.name)) unnamed.push(`${piece.handle}/${option.id}`);
    }
  }

  assert.deepEqual(unnamed, [], `unnamed designs: ${unnamed.join(', ')}`);
});

test('all 44 of them, so none were missed', () => {
  const count = SEED.reduce((sum, piece) => sum + (piece.designs?.options?.length ?? 0), 0);
  assert.equal(count, 44);
});

test('no two designs of one piece share a name', () => {
  // Two rows reading "Hippity Hoppity" in the same picker is no better than two
  // reading "Design 4" — the name has to carry what distinguishes them.
  for (const piece of SEED) {
    const names = (piece.designs?.options ?? []).map((option) => option.name);
    assert.equal(new Set(names).size, names.length, `${piece.handle} repeats a design name`);
  }
});

test('names stay short enough to read in a picker and on a receipt', () => {
  for (const piece of SEED) {
    for (const option of piece.designs?.options ?? []) {
      assert.ok(option.name.length <= 40, `too long: ${option.name}`);
    }
  }
});

test('every named photograph is one the catalog actually uses', () => {
  // A name keyed to a filename that no longer exists is a name that silently
  // never applies.
  const used = new Set(
    SEED.flatMap((piece) => (piece.designs?.options ?? []).map((option) => option.image))
  );

  const orphans = Object.keys(DESIGN_NAMES).filter((image) => !used.has(image));
  assert.deepEqual(orphans, [], `names for photographs nobody uses: ${orphans.join(', ')}`);
});

/* --------------------------------------------------------------- merging */

const stored = (over = {}) => ({
  handle: 'untitled-may1_12-21',
  title: 'Blue Alien Beaded Pen Classics(not fuzzy)',
  price: 12.99,
  ...over,
});

test('a stored catalog with placeholder names gets the real ones', () => {
  // This is the case that matters: designs already saved in the store, named
  // "Design 1". Without this the only fix would be renaming 44 by hand.
  const [piece] = fillMissingDesigns(
    [
      stored({
        designs: {
          label: 'Design',
          options: [
            { id: 'd1', name: 'Design 1', image: 'assets/AE4BE61A-5BDA-4493-9EA0-97DB44D77CF0.jpg' },
            { id: 'd2', name: 'Design 2', image: 'assets/1F8C9201-5F03-4D08-A37C-CCC50EDC2020.jpg' },
          ],
        },
      }),
    ],
    SEED
  );

  assert.equal(piece.designs.options[0].name, 'Scrump on Top, Pink Pearl');
  assert.equal(piece.designs.options[1].name, 'Little Green Frog');
});

test('a name someone actually typed is never overwritten', () => {
  const [piece] = fillMissingDesigns(
    [
      stored({
        designs: {
          label: 'Design',
          options: [
            { id: 'd1', name: "Abi's favourite", image: 'assets/AE4BE61A-5BDA-4493-9EA0-97DB44D77CF0.jpg' },
          ],
        },
      }),
    ],
    SEED
  );

  assert.equal(piece.designs.options[0].name, "Abi's favourite");
});

test('names are matched by photograph, not by position', () => {
  // The same two designs, stored in the other order. Matching by id would name
  // them backwards, which is worse than leaving them as numbers.
  const [piece] = fillMissingDesigns(
    [
      stored({
        designs: {
          label: 'Design',
          options: [
            { id: 'd1', name: 'Design 1', image: 'assets/1F8C9201-5F03-4D08-A37C-CCC50EDC2020.jpg' },
            { id: 'd2', name: 'Design 2', image: 'assets/AE4BE61A-5BDA-4493-9EA0-97DB44D77CF0.jpg' },
          ],
        },
      }),
    ],
    SEED
  );

  assert.equal(piece.designs.options[0].name, 'Little Green Frog');
  assert.equal(piece.designs.options[1].name, 'Scrump on Top, Pink Pearl');
});

test('a photograph the seed does not know keeps its placeholder', () => {
  const [piece] = fillMissingDesigns(
    [
      stored({
        designs: {
          label: 'Design',
          options: [
            {
              id: 'd1',
              name: 'Design 1',
              image: 'https://abc.public.blob.vercel-storage.com/uploads/new.jpg',
            },
          ],
        },
      }),
    ],
    SEED
  );

  // Nothing better is known, so nothing is invented.
  assert.equal(piece.designs.options[0].name, 'Design 1');
});

test('a piece that decided it has no designs still has none', () => {
  const [piece] = fillMissingDesigns([stored({ designs: null })], SEED);
  assert.equal(piece.designs, null);
});

test('a piece the seed has never heard of is passed through untouched', () => {
  const custom = { handle: 'brand-new', title: 'New', designs: { options: [{ id: 'd1', name: 'Design 1', image: 'assets/x.jpg' }] } };
  const [piece] = fillMissingDesigns([custom], SEED);

  assert.equal(piece.designs.options[0].name, 'Design 1');
});

test('the object is only rebuilt when something actually changed', () => {
  // Cheap, and it keeps the storefront from repainting over a gallery someone
  // is mid-click on.
  const already = stored({
    designs: {
      label: 'Design',
      options: [{ id: 'd1', name: 'Scrump on Top, Pink Pearl', image: 'assets/AE4BE61A-5BDA-4493-9EA0-97DB44D77CF0.jpg' }],
    },
    choices: [],
  });

  const [piece] = fillMissingDesigns([already], SEED);
  assert.equal(piece, already);
});
