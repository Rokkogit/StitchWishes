// Guards against validation that the real catalog cannot satisfy.
//
// Written after the handle pattern rejected four live products: their handles
// carry underscores ("untitled-apr30_16-33"), which the first draft of the
// pattern disallowed. Those are URLs customers already hold, so the rule had
// to bend, not the data. Unit tests with tidy fixtures did not catch it —
// only the real catalog did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateCatalog } from '../lib/catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function realCatalog() {
  const source = readFileSync(join(here, '..', 'stitch-wishes-2050', 'products.js'), 'utf8');
  const scope = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', source)(scope.window);
  return scope.window.STITCH_PRODUCTS;
}

test('the live catalog file parses', () => {
  const products = realCatalog();

  assert.ok(Array.isArray(products));
  assert.ok(products.length > 0);
});

// The one that matters: whatever the rules are, the real catalog must pass
// them, or the admin panel cannot save the shop it is managing.
test('the live catalog passes validation unchanged', () => {
  const result = validateCatalog(realCatalog());

  assert.equal(
    result.ok,
    true,
    `the real catalog must validate; got: ${JSON.stringify(result.errors?.slice(0, 4))}`
  );
});

test('every live handle survives validation, underscores included', () => {
  const products = realCatalog();
  const underscored = products.filter((p) => p.handle.includes('_'));

  assert.ok(underscored.length > 0, 'this guard is pointless if none use underscores');

  const result = validateCatalog(products);
  const handleErrors = (result.errors ?? []).filter((e) => e.field === 'handle');

  assert.deepEqual(handleErrors, []);
});

test('every live image path is accepted', () => {
  const result = validateCatalog(realCatalog());
  const imageErrors = (result.errors ?? []).filter((e) => e.field === 'images');

  assert.deepEqual(imageErrors, []);
});

test('the live catalog fits the store with room to spare', () => {
  const result = validateCatalog(realCatalog());

  assert.ok(result.size < 200_000, `catalog is ${result.size} bytes`);
});

/* ---------------------------------------- designs built from the catalog */
// The generator turns Shopify variants into designs. These guard the rules
// that make a design usable rather than just present.

test('the generated designs all validate', () => {
  const result = validateCatalog(realCatalog());
  const designErrors = (result.errors ?? []).filter((e) => e.field === 'designs');

  assert.deepEqual(designErrors, []);
});

test('some pieces actually got designs', () => {
  const withDesigns = realCatalog().filter((p) => p.designs?.options?.length);

  assert.ok(withDesigns.length >= 5, `only ${withDesigns.length} pieces carry designs`);
});

// A design is chosen by its photograph, so two designs that look identical
// are not a choice a customer can make.
test('no piece offers two designs with the same photograph', () => {
  for (const piece of realCatalog()) {
    const images = (piece.designs?.options ?? []).map((d) => d.image);
    assert.equal(
      new Set(images).size,
      images.length,
      `${piece.title} repeats a design photograph`
    );
  }
});

test('every design photograph is one the catalog accepts', () => {
  const result = validateCatalog(realCatalog());

  assert.equal(result.ok, true);
});

// One design is not a choice; the picker would be a single button.
test('no piece offers exactly one design', () => {
  for (const piece of realCatalog()) {
    const count = piece.designs?.options?.length ?? 0;
    assert.notEqual(count, 1, `${piece.title} has a single design`);
  }
});

test('designs default to made to order rather than sold out', () => {
  for (const piece of realCatalog()) {
    for (const design of piece.designs?.options ?? []) {
      assert.notEqual(design.stock, 0, `${piece.title} ships a design already sold out`);
    }
  }
});

test('a second choice axis carries real labels, not Option 1', () => {
  for (const piece of realCatalog()) {
    for (const axis of piece.choices ?? []) {
      for (const value of axis.values) {
        assert.doesNotMatch(value.label, /^Option \d+$/, `${piece.title}: ${value.label}`);
      }
    }
  }
});
