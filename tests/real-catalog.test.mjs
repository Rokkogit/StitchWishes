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
