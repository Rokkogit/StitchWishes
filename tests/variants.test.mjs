// Designs and choices.
//
// A design is something you pick by looking at it: a photograph, optionally
// its own price and its own stock. A choice is a plain list like scent, which
// is recorded on the order and changes nothing about what is charged.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDesigns,
  validateChoices,
  findDesign,
  priceFor,
  stockFor,
  designsInStock,
  MAX_DESIGNS,
} from '../lib/variants.mjs';

const design = (over = {}) => ({
  id: 'd1',
  name: 'Cute Trouble',
  image: 'assets/IMG_4082.png',
  price: null,
  stock: null,
  ...over,
});

/* ------------------------------------------------------ validateDesigns */

test('no designs at all is valid — most pieces have none', () => {
  for (const empty of [null, undefined]) {
    const result = validateDesigns(empty);
    assert.equal(result.ok, true);
    assert.equal(result.value, null);
  }
});

test('a design set round-trips', () => {
  const result = validateDesigns({ label: 'Design', options: [design()] });

  assert.equal(result.ok, true);
  assert.equal(result.value.label, 'Design');
  assert.equal(result.value.options[0].name, 'Cute Trouble');
});

// The photograph is the whole point — it is how a customer tells one from
// another, since the names came through as "Option 1".
test('a design must have a photograph', () => {
  const result = validateDesigns({ label: 'Design', options: [design({ image: null })] });

  assert.equal(result.ok, false);
});

test('a design photograph is checked like any other image path', () => {
  for (const bad of ['https://evil.example.com/x.jpg', '../escape', 'assets/a/b.jpg']) {
    const result = validateDesigns({ label: 'Design', options: [design({ image: bad })] });
    assert.equal(result.ok, false, bad);
  }
});

test('a blob URL is a valid design photograph', () => {
  const result = validateDesigns({
    label: 'Design',
    options: [design({ image: 'https://a1.public.blob.vercel-storage.com/uploads/x.jpg' })],
  });

  assert.equal(result.ok, true);
});

test('duplicate design ids are refused', () => {
  const result = validateDesigns({
    label: 'Design',
    options: [design(), design({ name: 'Other' })],
  });

  assert.equal(result.ok, false);
});

test('a design may carry its own price', () => {
  const result = validateDesigns({ label: 'Design', options: [design({ price: 13.99 })] });

  assert.equal(result.value.options[0].price, 13.99);
});

test('a negative design price is refused', () => {
  assert.equal(validateDesigns({ label: 'Design', options: [design({ price: -1 })] }).ok, false);
});

test('a design may carry its own stock', () => {
  const result = validateDesigns({ label: 'Design', options: [design({ stock: 2 })] });

  assert.equal(result.value.options[0].stock, 2);
});

test('fractional or negative design stock is refused', () => {
  for (const bad of [-1, 1.5]) {
    assert.equal(validateDesigns({ label: 'Design', options: [design({ stock: bad })] }).ok, false, String(bad));
  }
});

test('too many designs is refused', () => {
  const many = Array.from({ length: MAX_DESIGNS + 1 }, (_, i) =>
    design({ id: `d${i}`, name: `Design ${i}` })
  );

  assert.equal(validateDesigns({ label: 'Design', options: many }).ok, false);
});

test('an empty options list means no designs', () => {
  const result = validateDesigns({ label: 'Design', options: [] });

  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

/* ------------------------------------------------------ validateChoices */

const scent = () => ({
  id: 'c1',
  label: 'Scent',
  values: [
    { id: 'v1', label: 'Pineapple Punch on Kauai' },
    { id: 'v2', label: 'Experiment 626 Dark Side' },
  ],
});

test('no choices at all is valid', () => {
  const result = validateChoices(null);

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, []);
});

test('a choice set round-trips', () => {
  const result = validateChoices([scent()]);

  assert.equal(result.ok, true);
  assert.equal(result.value[0].values.length, 2);
});

test('a choice needs a label', () => {
  assert.equal(validateChoices([{ ...scent(), label: '  ' }]).ok, false);
});

test('a choice needs at least two values to be a choice', () => {
  const result = validateChoices([{ ...scent(), values: [{ id: 'v1', label: 'Only one' }] }]);

  assert.equal(result.ok, false);
});

test('a choice value needs a label', () => {
  const result = validateChoices([
    { ...scent(), values: [{ id: 'v1', label: 'Fine' }, { id: 'v2', label: '' }] },
  ]);

  assert.equal(result.ok, false);
});

/* ------------------------------------------------------------ selection */

const product = (over = {}) => ({
  handle: 'signs',
  title: 'Signs',
  price: 16.99,
  stock: null,
  designs: {
    label: 'Design',
    options: [
      design({ id: 'a', name: 'A' }),
      design({ id: 'b', name: 'B', price: 13.99, stock: 0 }),
      design({ id: 'c', name: 'C', stock: 2 }),
    ],
  },
  ...over,
});

test('a design is found by its id', () => {
  assert.equal(findDesign(product(), 'b').name, 'B');
});

test('an unknown design id finds nothing', () => {
  assert.equal(findDesign(product(), 'nope'), null);
});

test('a piece with no designs finds nothing', () => {
  assert.equal(findDesign({ handle: 'x', price: 5 }, 'a'), null);
});

// The money rule: a design price wins, otherwise the piece price.
test('price falls back to the piece when a design has none', () => {
  assert.equal(priceFor(product(), 'a'), 16.99);
});

test('a design price overrides the piece price', () => {
  assert.equal(priceFor(product(), 'b'), 13.99);
});

test('price with no design selected is the piece price', () => {
  assert.equal(priceFor(product(), null), 16.99);
});

test('an unknown design does not silently fall back to the piece price', () => {
  assert.equal(priceFor(product(), 'nope'), null);
});

test('stock falls back to the piece when a design has none', () => {
  assert.equal(stockFor(product(), 'a'), null);
});

test('a design stock overrides the piece stock', () => {
  assert.equal(stockFor(product(), 'c'), 2);
  assert.equal(stockFor(product(), 'b'), 0);
});

test('designs still in stock are listed, sold out ones are not', () => {
  const available = designsInStock(product()).map((d) => d.id);

  assert.deepEqual(available, ['a', 'c']);
});

test('a piece whose designs have all sold out reports none available', () => {
  const gone = product();
  for (const option of gone.designs.options) option.stock = 0;

  assert.deepEqual(designsInStock(gone), []);
});
