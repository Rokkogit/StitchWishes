// Renaming four addresses that Shopify generated from a clock.
//
// The rename itself is three lines. Everything that could go wrong is in what
// still has to point at the piece afterwards: a link somebody sent, a bag
// filled before the rename, an order placed months ago. Those are what this
// file is mostly about.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RENAMES, renameLegacyHandles, handlesOf } from '../lib/handles.mjs';
import { readyCatalog, fillMissingDesigns } from '../lib/seed.mjs';
import { SEED } from '../lib/catalog-seed.mjs';
import { validateProduct } from '../lib/catalog.mjs';
import { resolveCart } from '../lib/cart.mjs';
import { sitemapXml } from '../lib/page-meta.mjs';

/* --------------------------------------------------------------- the map */

test('every address being replaced is one that actually exists', () => {
  // A typo in the map would be a rename that silently never happens.
  const shipped = new Set(SEED.map((piece) => piece.handle));

  for (const old of Object.keys(RENAMES)) {
    assert.ok(shipped.has(old), `nothing in the catalog is called ${old}`);
  }
});

test('every new address is one a URL can carry', () => {
  for (const next of Object.values(RENAMES)) {
    // Checked through the same validation an admin save goes through, so the
    // rename cannot produce something the panel would then refuse to keep.
    const saved = validateProduct({ ...SEED[0], handle: next });

    assert.equal(saved.ok, true, `${next} is not a usable handle`);
    assert.equal(saved.value.handle, next);
  }
});

test('no new address collides with a piece already using it', () => {
  const shipped = new Set(SEED.map((piece) => piece.handle));

  for (const next of Object.values(RENAMES)) {
    assert.ok(!shipped.has(next), `${next} is already taken`);
  }

  // And they are distinct from each other, or two pieces would share a URL.
  const all = Object.values(RENAMES);
  assert.equal(new Set(all).size, all.length);
});

test('no address left in the catalog reads like a timestamp', () => {
  // The actual complaint: /p/untitled-apr30_15-01. If a piece is added later
  // from the same export, this is what notices.
  const bad = renameLegacyHandles(SEED)
    .map((piece) => piece.handle)
    .filter((handle) => /untitled|_\d\d-\d\d|^\d/.test(handle));

  assert.deepEqual(bad, [], `still unreadable: ${bad.join(', ')}`);
});

/* ------------------------------------------------------------ the rename */

test('the four are renamed and nothing else moves', () => {
  const before = SEED.map((piece) => piece.handle);
  const after = renameLegacyHandles(SEED).map((piece) => piece.handle);

  const moved = before.filter((handle, i) => handle !== after[i]);

  assert.deepEqual(moved.sort(), Object.keys(RENAMES).sort());
  assert.equal(after.length, before.length, 'a piece was lost');
});

test('a handle somebody chose is never touched', () => {
  // The rule that makes this safe to leave in place: it only replaces an
  // address nobody decided on.
  const mine = [{ handle: 'abis-favourite-pens', title: 'Pens', price: 12 }];

  assert.equal(renameLegacyHandles(mine)[0], mine[0], 'the piece was rewritten');
});

test('the old address is kept, so something can redirect from it', () => {
  const [piece] = renameLegacyHandles([{ handle: 'untitled-may1_12-21', title: 'Pens' }]);

  assert.equal(piece.handle, 'blue-alien-beaded-pens');
  assert.deepEqual(piece.previousHandles, ['untitled-may1_12-21']);
});

test('an even older address is not lost when the piece is renamed again', () => {
  const [piece] = renameLegacyHandles([
    { handle: 'untitled-may1_12-21', previousHandles: ['the-first-name'] },
  ]);

  assert.deepEqual(piece.previousHandles, ['the-first-name', 'untitled-may1_12-21']);
});

test('nothing is renamed onto an address another piece is using', () => {
  // Otherwise two pieces answer to one URL and whichever loses becomes
  // unreachable - strictly worse than an ugly address.
  const products = [
    { handle: 'untitled-may1_12-21', title: 'The old one' },
    { handle: 'blue-alien-beaded-pens', title: 'Something already here' },
  ];

  const after = renameLegacyHandles(products);

  assert.equal(after[0].handle, 'untitled-may1_12-21');
  assert.equal(after[1].handle, 'blue-alien-beaded-pens');
});

test('renaming twice changes nothing the second time', () => {
  // It runs on every read, so it has to be safe to run on its own output.
  const once = renameLegacyHandles(SEED);
  const twice = renameLegacyHandles(once);

  assert.deepEqual(
    twice.map((p) => p.handle),
    once.map((p) => p.handle)
  );
  assert.deepEqual(twice.find((p) => p.previousHandles)?.previousHandles?.length, 1);
});

test('nonsense in place of a catalog does not throw', () => {
  for (const bad of [null, undefined, 'catalog', 42, {}]) {
    assert.deepEqual(renameLegacyHandles(bad), []);
  }

  assert.deepEqual(renameLegacyHandles([null, undefined]), [null, undefined]);
});

/* ----------------------------------------------------- the one read path */

test('the renames and the design names both arrive from one call', () => {
  // Seven routes read the catalog. They call readyCatalog, so a fix cannot be
  // applied to six of them - which would show one address on the catalog page
  // and expect another at checkout.
  const stored = SEED.map(({ designs, choices, ...rest }) => rest);

  const ready = readyCatalog(stored, SEED);
  const renamed = ready.find((piece) => piece.handle === 'blue-alien-keychains');

  assert.ok(renamed, 'the rename did not happen');
  assert.ok(renamed.designs?.options?.length, 'the designs did not come across');
  assert.ok(
    !renamed.designs.options.some((option) => /^Design \d+$/.test(option.name)),
    'a placeholder name survived'
  );
});

test('the designs are matched before the rename, not after', () => {
  // They are keyed by the stored handle. Rename first and every piece in the
  // map stops matching the shipped catalog, silently.
  const stored = SEED.map(({ designs, ...rest }) => rest);

  const filled = fillMissingDesigns(stored, SEED);
  const ready = readyCatalog(stored, SEED);

  for (const old of Object.keys(RENAMES)) {
    const was = filled.find((piece) => piece.handle === old);
    const now = ready.find((piece) => piece.previousHandles?.includes(old));

    assert.ok(now, `${old} was not renamed`);
    assert.deepEqual(now.designs, was.designs, `${old} lost its designs`);
  }
});

/* ------------------------------------------------------- what still points */

test('a bag filled before the rename still resolves', () => {
  // This is the money. A cart sits in localStorage for weeks; if the old handle
  // stops resolving, somebody who was ready to buy sees an empty bag.
  const catalog = renameLegacyHandles(SEED);
  const piece = catalog.find((p) => p.previousHandles?.includes('untitled-may1_12-21'));
  const design = piece.designs?.options?.[0]?.id ?? null;

  const { items, problems } = resolveCart(
    [{ handle: 'untitled-may1_12-21', design, quantity: 1 }],
    catalog
  );

  assert.deepEqual(problems, []);
  assert.equal(items.length, 1);
  // Recorded under the address it answers to now, so what goes to Stripe is
  // the current one.
  assert.equal(items[0].handle, 'blue-alien-beaded-pens');
});

test('the old and the new name in one bag are one line, not two', () => {
  // Two lines would each be checked against stock on its own, which is a way
  // to buy twice what is left.
  const catalog = renameLegacyHandles(SEED);
  const piece = catalog.find((p) => p.previousHandles?.includes('untitled-may1_12-21'));
  const design = piece.designs?.options?.[0]?.id ?? null;

  const { items } = resolveCart(
    [
      { handle: 'untitled-may1_12-21', design, quantity: 1 },
      { handle: 'blue-alien-beaded-pens', design, quantity: 1 },
    ],
    catalog
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 2);
});

test('a piece still cannot be bought under a name that was never its own', () => {
  const { items, problems } = resolveCart(
    [{ handle: 'untitled-jan1_00-00', quantity: 1 }],
    renameLegacyHandles(SEED)
  );

  assert.equal(items.length, 0);
  assert.equal(problems.length, 1);
});

test('a current address is never shadowed by another piece history', () => {
  // If one piece lists "pens" as a former name and another piece is called
  // "pens" today, the one called that now has to win.
  const catalog = [
    { handle: 'pens', title: 'The real pens', price: 12 },
    { handle: 'other', title: 'Something else', price: 5, previousHandles: ['pens'] },
  ];

  const { items } = resolveCart([{ handle: 'pens', quantity: 1 }], catalog);

  assert.equal(items[0].title, 'The real pens');
});

test('the sitemap lists the address the page actually answers with', () => {
  // A sitemap full of URLs that redirect tells a crawler the wrong address for
  // every piece on it.
  const xml = sitemapXml(renameLegacyHandles(SEED), 'https://stitchwishess.com');

  for (const [old, next] of Object.entries(RENAMES)) {
    assert.ok(xml.includes(`/p/${next}`), `${next} is missing from the sitemap`);
    assert.ok(!xml.includes(`/p/${old}`), `${old} is still being advertised`);
  }
});

/* ------------------------------------------------------------- handlesOf */

test('handlesOf gives every address a piece answers to', () => {
  assert.deepEqual(handlesOf({ handle: 'now', previousHandles: ['then', 'before'] }), [
    'now',
    'then',
    'before',
  ]);

  assert.deepEqual(handlesOf({ handle: 'only' }), ['only']);
  assert.deepEqual(handlesOf(null), []);
});
