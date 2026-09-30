// Categories, which the filter chips and the cross-sell both depend on.
//
// The source catalog had none — product_type is empty on all fifteen and the
// tags are search keywords — so these are assigned by hand. That makes "did
// anything get missed" the question worth asking automatically.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  categoryOf,
  labelFor,
  isCategory,
  categoriesPresent,
} from '../lib/categories.mjs';
import { validateProduct } from '../lib/catalog.mjs';
import { SEED } from '../lib/catalog-seed.mjs';

test('every piece in the catalog has a category', () => {
  // A piece added later with no category shows under Everything and nowhere
  // else — visibly incomplete, which is the point of failing here first.
  const missing = SEED.filter((piece) => !categoryOf(piece)).map((p) => p.handle);

  assert.deepEqual(missing, [], `uncategorised: ${missing.join(', ')}`);
});

test('every assigned category is one that actually exists', () => {
  for (const piece of SEED) {
    const id = categoryOf(piece);
    assert.ok(isCategory(id), `${piece.handle} is filed under "${id}", which is not a category`);
  }
});

test('the generated catalog carries the category through', () => {
  // Written by the generator. If this breaks, the chips render but filter
  // nothing, because every product would match none of them.
  assert.equal(SEED.filter((p) => p.category).length, SEED.length);
  assert.equal(SEED[0].category, categoryOf(SEED[0]));
});

test('a category survives an admin save', () => {
  // validateProduct builds its result from known keys only, so a field it does
  // not know about is silently dropped the first time anything is saved.
  const saved = validateProduct(SEED[0]);

  assert.equal(saved.ok, true);
  assert.equal(saved.value.category, SEED[0].category);
});

test('an unrecognised category is dropped, not refused', () => {
  // It only decides which chip a piece sits under. Losing the piece from the
  // catalog over a bad label would be wildly out of proportion.
  const odd = validateProduct({ ...SEED[0], category: 'nonsense' });

  assert.equal(odd.ok, true);
  assert.equal(odd.value.category, null);
});

test('no category is left empty in the shipped catalog', () => {
  // A chip that leads to an empty grid is a dead end.
  const present = categoriesPresent(SEED);

  assert.equal(present.length, CATEGORIES.length, 'a category has nothing in it');
  for (const category of present) {
    assert.ok(category.count > 0, `${category.id} is empty`);
  }
});

test('the counts add up to the whole catalog', () => {
  const total = categoriesPresent(SEED).reduce((sum, c) => sum + c.count, 0);

  assert.equal(total, SEED.filter((p) => p.hidden !== true).length);
});

test('hiding the last piece in a category takes its chip with it', () => {
  const keyrings = SEED.filter((p) => p.category === 'keyrings');
  assert.ok(keyrings.length > 0);

  const hidden = SEED.map((p) => (p.category === 'keyrings' ? { ...p, hidden: true } : p));

  assert.ok(!categoriesPresent(hidden).some((c) => c.id === 'keyrings'));
});

test('every category has a label a person would actually say', () => {
  for (const category of CATEGORIES) {
    assert.ok(labelFor(category.id), `${category.id} has no label`);
    assert.ok(category.label.length <= 20, `label too long for a chip: ${category.label}`);
    // Not just the id with a capital letter.
    assert.notEqual(category.label.toLowerCase(), category.id);
  }
});

test('an unknown piece gets no category rather than a wrong one', () => {
  assert.equal(categoryOf({ handle: 'something-new' }), null);
  assert.equal(categoryOf(null), null);
  assert.equal(categoryOf({}), null);
});

test('categories are spread across the catalog rather than all in one', () => {
  // A filter bar where one chip holds thirteen of fifteen is not a filter bar.
  const counts = categoriesPresent(SEED).map((c) => c.count);
  const biggest = Math.max(...counts);

  assert.ok(biggest < SEED.length * 0.6, `one category holds ${biggest} of ${SEED.length}`);
  assert.ok(counts.length >= 3, 'too few categories to be worth filtering');
});
