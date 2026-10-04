// The item page, which is where the price meets the photograph.
//
// main.js is a plain browser script rather than a module, so it is run here in
// a vm with just enough of a window to load. That is worth the small amount of
// scaffolding: every rendering decision on the page someone actually buys from
// was previously untested, and the bug this file was written for was a
// rendering decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { SEED } from '../lib/catalog-seed.mjs';
import { renameLegacyHandles } from '../lib/handles.mjs';

function loadMain() {
  const code = readFileSync(new URL('../stitch-wishes-2050/main.js', import.meta.url), 'utf8');

  const noop = () => {};
  const context = {
    console,
    URLSearchParams,
    JSON,
    Math,
    window: {
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      STITCH_PRODUCTS: [],
      addEventListener: noop,
      location: { pathname: '/', search: '' },
    },
    document: {
      addEventListener: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    fetch: async () => {
      throw new Error('the tests do not reach the network');
    },
  };

  vm.createContext(context);
  vm.runInContext(code, context);

  return context;
}

const main = loadMain();

const CATALOG = renameLegacyHandles(SEED);
const byHandle = (handle) => CATALOG.find((piece) => piece.handle === handle);

// The piece the complaint was about: the opening photograph is four pens in a
// stand, and the price is for one pen.
const PENS = byHandle('blue-alien-beaded-pens');

test('the fixture is the piece this is about', () => {
  // If the catalog changes shape, these tests would otherwise pass vacuously.
  assert.ok(PENS, 'blue-alien-beaded-pens is gone from the catalog');
  assert.ok(PENS.designs.options.length > 1, 'it no longer comes in several designs');
  assert.ok(
    !PENS.designs.options.some((design) => design.image === PENS.images[0]),
    'images[0] is no longer the group shot, so this fixture proves nothing'
  );
});

/* ----------------------------------------------- what the page opens on */

test('the large photograph is of something you can actually buy', () => {
  // The whole bug. images[0] is the studio group shot - four pens - and the
  // price sits directly beneath the large photograph. A group photograph
  // wearing one price reads as the price of the group.
  const html = main.galleryHtml(PENS);
  const opening = html.match(/<img src="([^"]+)"[^>]*data-gallery-main/)[1];

  const design = PENS.designs.options.find((option) => option.image === opening);

  assert.ok(design, `the page opens on ${opening}, which is not a design anyone can choose`);
});

test('the group shot is still there to look at', () => {
  // It is the best picture of the range. It just is not what the price labels.
  const html = main.galleryHtml(PENS);

  assert.ok(html.includes(PENS.images[0]), 'the group shot was dropped from the strip');
});

test('the thumbnail marked active is the one being shown', () => {
  const html = main.galleryHtml(PENS);
  const opening = html.match(/<img src="([^"]+)"[^>]*data-gallery-main/)[1];

  const active = html.match(/<button class="thumb is-active[^"]*"[\s\S]*?data-thumb="([^"]+)"/);

  assert.ok(active, 'no thumbnail is marked as the one on show');
  assert.equal(active[1], opening);
});

test('a piece with one photograph and no designs opens on that photograph', () => {
  const plain = { title: 'Mousepad', price: 13.99, images: ['assets/a.jpg'] };
  const html = main.galleryHtml(plain);

  assert.ok(html.includes('assets/a.jpg'));
});

test('a sold-out design is not what the page opens on', () => {
  const sold = {
    title: 'Pens',
    price: 12,
    images: ['assets/group.jpg', 'assets/one.jpg', 'assets/two.jpg'],
    designs: {
      label: 'Design',
      options: [
        { id: 'd1', name: 'One', image: 'assets/one.jpg', stock: 0 },
        { id: 'd2', name: 'Two', image: 'assets/two.jpg' },
      ],
    },
  };

  const opening = main.galleryHtml(sold).match(/<img src="([^"]+)"[^>]*data-gallery-main/)[1];

  assert.equal(opening, 'assets/two.jpg');
});

test('every design sold out still opens on a design rather than the group shot', () => {
  const gone = {
    title: 'Pens',
    price: 12,
    images: ['assets/group.jpg', 'assets/one.jpg'],
    designs: {
      label: 'Design',
      options: [{ id: 'd1', name: 'One', image: 'assets/one.jpg', stock: 0 }],
    },
  };

  const opening = main.galleryHtml(gone).match(/<img src="([^"]+)"[^>]*data-gallery-main/)[1];

  assert.equal(opening, 'assets/one.jpg');
});

/* ------------------------------------------------- what the price says */

test('a piece that comes in several designs is priced each', () => {
  // The second half of the same misreading: one number under a photograph of a
  // set is the price of the set unless it says otherwise.
  assert.equal(main.priceLabel(PENS, null), '$12.99 each');
});

test('the each survives choosing a design', () => {
  // The price line is written once into the markup and rewritten on every
  // selection. Those two drifting apart is how a page starts saying different
  // things about one number, so both go through this function.
  const design = PENS.designs.options[0];

  assert.match(main.priceLabel(PENS, design), /each$/);
});

test('a design with its own price is still priced each', () => {
  const product = {
    price: 12,
    designs: {
      options: [
        { id: 'd1', name: 'One', image: 'a.jpg', price: 20 },
        { id: 'd2', name: 'Two', image: 'b.jpg' },
      ],
    },
  };

  assert.equal(main.priceLabel(product, product.designs.options[0]), '$20.00 each');
});

test('a piece that is only ever one thing is not priced each', () => {
  // "each" on a single mousepad is noise, and noise in a price is not free.
  assert.equal(main.priceLabel({ price: 13.99 }, null), '$13.99');
  assert.equal(
    main.priceLabel({ price: 9, designs: { options: [{ id: 'd1', image: 'a.jpg' }] } }, null),
    '$9.00'
  );
});

test('a piece with no price says nothing rather than saying each', () => {
  assert.equal(main.priceLabel({ price: null }, null), '');
});

test('the rendered price line is the one this function produces', () => {
  // Otherwise the markup could go on saying something else entirely.
  const html = main.detailPriceHtml(PENS);

  assert.ok(html.includes('$12.99 each'), html);
});

/* ------------------------------------------------------- the catalog card */

test('the card still reads correctly, because it carries the design count', () => {
  // Why the catalog page never had this problem, kept honest: the same group
  // shot is fine there because a badge over it says how many designs it holds.
  const card = main.mediaHtml(PENS);

  assert.ok(card.includes(PENS.images[0]), 'the card no longer opens on the group shot');
  assert.ok(card.includes(`${PENS.designs.options.length} designs`), 'the badge is gone');
});

/* ------------------------------------------------- across the whole shop */

test('no piece in the shop opens on a photograph that cannot be bought', () => {
  // The three pen listings are the ones that prompted this, but the rule is
  // the rule, and the next piece with a group shot gets it for free.
  const wrong = [];

  for (const piece of CATALOG) {
    if (!piece.designs?.options?.length || !piece.images?.length) continue;

    const opening = main
      .galleryHtml(piece)
      .match(/<img src="([^"]+)"[^>]*data-gallery-main/)[1];

    if (!piece.designs.options.some((design) => design.image === opening)) {
      wrong.push(piece.handle);
    }
  }

  assert.deepEqual(wrong, [], `opens on an unbuyable photograph: ${wrong.join(', ')}`);
});

test('every piece sold in several designs says each', () => {
  const silent = CATALOG.filter(
    (piece) =>
      (piece.designs?.options?.length ?? 0) > 1 && !main.priceLabel(piece, null).endsWith('each')
  ).map((piece) => piece.handle);

  assert.deepEqual(silent, [], `priced as if there were one: ${silent.join(', ')}`);
});
