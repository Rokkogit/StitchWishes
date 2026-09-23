// Filling in designs for a catalog stored before designs existed.
//
// The store is authoritative. This is a migration, not an override, so it has
// to be impossible for it to resurrect designs someone deliberately removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fillMissingDesigns } from '../lib/seed.mjs';

const seed = [
  {
    handle: 'signs',
    title: 'Metal Sign',
    price: 16.99,
    designs: { label: 'Design', options: [{ id: 'd1', name: 'Design 1', image: 'assets/a.jpg', price: null, stock: null }] },
    choices: [{ id: 'c1', label: 'Scent', values: [{ id: 'v1', label: 'One' }, { id: 'v2', label: 'Two' }] }],
  },
  { handle: 'plain', title: 'Plain', price: 5 },
];

// A catalog saved before designs existed has no such key at all.
const oldStore = () => [
  { handle: 'signs', title: 'Metal Sign', price: 16.99 },
  { handle: 'plain', title: 'Plain', price: 5 },
];

test('a store written before designs gets them filled in', () => {
  const result = fillMissingDesigns(oldStore(), seed);

  assert.equal(result[0].designs.options.length, 1);
  assert.equal(result[0].choices.length, 1);
});

test('a piece the seed knows nothing about is left alone', () => {
  const result = fillMissingDesigns(oldStore(), seed);

  assert.equal(result[1].designs, undefined);
});

// The rule that makes this safe. Any save writes the key, even when empty, so
// an explicit "no designs" is distinguishable from "never had the field".
test('a piece saved with no designs is NOT refilled', () => {
  const saved = [{ handle: 'signs', title: 'Metal Sign', price: 16.99, designs: null }];

  const result = fillMissingDesigns(saved, seed);

  assert.equal(result[0].designs, null);
});

test('a piece with its own designs keeps them', () => {
  const own = [
    {
      handle: 'signs',
      title: 'Metal Sign',
      price: 16.99,
      designs: { label: 'Style', options: [{ id: 'x', name: 'Mine', image: 'assets/z.jpg', price: null, stock: null }] },
    },
  ];

  const result = fillMissingDesigns(own, seed);

  assert.equal(result[0].designs.options[0].name, 'Mine');
});

test('prices and titles from the store always win — only designs are filled', () => {
  const edited = [{ handle: 'signs', title: 'Renamed Sign', price: 99 }];

  const result = fillMissingDesigns(edited, seed);

  assert.equal(result[0].title, 'Renamed Sign');
  assert.equal(result[0].price, 99);
  assert.ok(result[0].designs);
});

test('the input is not mutated', () => {
  const store = oldStore();
  const before = JSON.stringify(store);

  fillMissingDesigns(store, seed);

  assert.equal(JSON.stringify(store), before);
});

test('a seed entry with no designs fills nothing', () => {
  const result = fillMissingDesigns([{ handle: 'plain', title: 'Plain', price: 5 }], seed);

  assert.equal(result[0].designs, undefined);
});

test('missing or malformed inputs do not throw', () => {
  for (const bad of [null, undefined, {}, 'x']) {
    assert.deepEqual(fillMissingDesigns(bad, seed), []);
    assert.ok(Array.isArray(fillMissingDesigns(oldStore(), bad)));
  }
});
