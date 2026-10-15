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

/* --------------------------------------------------- what it says about postage */

// shopShipping is a top-level `let`, so it lives in the context's lexical scope
// rather than on its global object. Assigning through the same context is how
// the page's two states get exercised.
const setShipping = (value) => vm.runInContext(`shopShipping = ${JSON.stringify(value)}`, main);

test('before the server answers, the shop says postage is free', () => {
  // The page renders once from its bundled catalog before /api/catalog replies.
  // Showing a postage figure and then taking it back is worse than either.
  setShipping(null);

  assert.equal(main.postageIsFree(), true);
  assert.match(main.freeShippingNote(), /Free shipping/);
});

test('the page trusts the server rather than working it out again', () => {
  // The rule depends on a key older saved settings do not carry. A second copy
  // of it here is how a site starts advertising free postage while the bag
  // charges for it.
  setShipping({ label: 'Shipping', amount: 6, enabled: true, free: true });
  assert.equal(main.postageIsFree(), true);

  setShipping({ label: 'Shipping', amount: 6, enabled: true, free: false });
  assert.equal(main.postageIsFree(), false);
});

test('free shipping is said on the piece, next to the price', () => {
  setShipping({ free: true, amount: 6, enabled: true });

  assert.match(main.freeShippingNote(), /Free shipping on every order/);
  assert.match(main.assuranceHtml({ stock: null }), /Free shipping/);
});

test('a shop that charges for postage prints the real figure instead', () => {
  setShipping({ label: 'Shipping', amount: 6, enabled: true, free: false });

  assert.equal(main.freeShippingNote(), '');
  assert.match(main.assuranceHtml({ stock: null }), /\$6\.00 flat postage/);
});

test('the price and the postage note are rendered together', () => {
  setShipping({ free: true, amount: 6, enabled: true });

  // Both come off the same render, so a piece cannot show one without the
  // other. Restored afterwards so the order of tests does not matter.
  const html = `${main.detailPriceHtml(PENS)}${main.freeShippingNote()}`;

  assert.match(html, /\$12\.99 each/);
  assert.match(html, /Free shipping/);

  setShipping(null);
});

/* ------------------------------------------------ only the designs can be picked */

test('the strip holds nothing but designs', () => {
  // The strip is the picker: tapping a thumbnail chooses that design. A
  // photograph of the whole set sitting among them reads as one more option,
  // and tapping it does nothing - the worst answer a control can give.
  const html = main.galleryHtml(PENS);

  const thumbs = [...html.matchAll(/<button class="thumb[^"]*"([\s\S]*?)>/g)];
  assert.equal(thumbs.length, PENS.designs.options.length);

  for (const [, attrs] of thumbs) {
    assert.match(attrs, /data-design="/, 'a thumbnail that selects nothing is in the picker');
  }
});

test('the group shot is not offered as a design', () => {
  assert.ok(
    !main.galleryHtml(PENS).includes(PENS.images[0]),
    'the photograph of all four pens is still in the picker'
  );
});

test('the group shot still sells the range on the catalog card', () => {
  // It is not lost, and this is where it does its job: the whole set at a
  // glance, with a badge saying how many designs there are.
  const card = main.mediaHtml(PENS);

  assert.ok(card.includes(PENS.images[0]));
  assert.ok(card.includes(`${PENS.designs.options.length} designs`));
});

test('a piece with no designs still shows all its photographs', () => {
  // Nothing to pick there, so every photograph belongs.
  const plain = { title: 'Mousepad', price: 13.99, images: ['a.jpg', 'b.jpg', 'c.jpg'] };
  const html = main.galleryHtml(plain);

  for (const image of plain.images) assert.ok(html.includes(image), image);
});

test('a design whose photograph is not in the gallery is still reachable', () => {
  // A design nobody can pick is a piece nobody can buy.
  const odd = {
    title: 'Pens',
    price: 12,
    images: ['group.jpg'],
    designs: { label: 'Design', options: [{ id: 'd1', name: 'One', image: 'lonely.jpg' }] },
  };

  assert.ok(main.galleryHtml(odd).includes('lonely.jpg'));
});

test('no piece in the shop offers a photograph that selects nothing', () => {
  for (const piece of CATALOG) {
    if (!piece.designs?.options?.length) continue;

    for (const [, attrs] of main.galleryHtml(piece).matchAll(/<button class="thumb[^"]*"([\s\S]*?)>/g)) {
      assert.match(attrs, /data-design="/, `${piece.handle} has a dead thumbnail`);
    }
  }
});

/* ------------------------------------------------------------- our picks */

test('the row never comes to rest past the card it is showing', () => {
  // The invariant the drift depends on. If the offset ever lands beyond the
  // first remaining card, the row jumps a whole card width in one frame -
  // which is exactly what a marquee is supposed to stop happening.
  const widths = [200, 200, 200, 200];

  for (const distance of [0, 1, 199, 200, 201, 399, 400, 401, 599, 1000]) {
    const { offset, drop } = main.advancePicks(0, widths, distance);

    assert.ok(offset >= 0, `negative offset at ${distance}`);
    assert.ok(drop <= widths.length, `dropped more cards than there are at ${distance}`);

    const remaining = widths.slice(drop);
    if (remaining.length) {
      assert.ok(offset < remaining[0], `offset ${offset} is past a ${remaining[0]} card`);
    }
  }
});

test('nothing is dropped until a card has fully left', () => {
  // A card still half on screen must stay, or it vanishes mid-view.
  // Compared field by field: the object comes back from a vm context, so it
  // does not share a prototype with one built here.
  const just = main.advancePicks(0, [200, 200], 199);
  assert.equal(just.drop, 0);
  assert.equal(just.offset, 199);

  const gone = main.advancePicks(0, [200, 200], 200);
  assert.equal(gone.drop, 1);
  assert.equal(gone.offset, 0);
});

test('a big jump drops every card it passed, not just one', () => {
  // A tab coming back from the background hands over a large delta. Dropping
  // one card per frame there would leave the row out of position for seconds.
  const { offset, drop } = main.advancePicks(0, [100, 100, 100, 100], 350);

  assert.equal(drop, 3);
  assert.equal(offset, 50);
});

test('the drift carries on from where it was', () => {
  // The offset going in is mid-card, which is the normal case every frame.
  const { offset, drop } = main.advancePicks(150, [200, 200], 100);

  assert.equal(drop, 1);
  assert.equal(offset, 50);
});

test('a zero-width card cannot spin the loop forever', () => {
  // It should not happen. If it did, an unguarded loop would take the tab down
  // with it, which is a worse outcome than a row that looks wrong.
  const { drop } = main.advancePicks(0, [0, 0, 0], 10);

  assert.equal(drop, 0);
});

test('the row stops recycling once it runs out of cards to drop', () => {
  const { offset, drop } = main.advancePicks(0, [100, 100], 10_000);

  assert.equal(drop, 2);
  assert.ok(offset > 0, 'it should still report how far past the end it went');
});

/* ------------------------------------------------------------- on sale */

const REDUCED = { handle: 'reduced', title: 'Reduced', price: 9.74, wasPrice: 12.99, images: ['a.jpg'] };

test('a reduced price shows what it was, struck through', () => {
  const html = main.priceHtml(REDUCED);

  assert.match(html, /<s class="was"/, 'the old price is not struck through');
  assert.match(html, /\$12\.99/);
  assert.match(html, /\$9\.74/);
});

test('the struck-through price says it is the old one, for a screen reader', () => {
  // Two prices read in a row with no label is two numbers and no idea which
  // one is being charged.
  assert.match(main.priceHtml(REDUCED), /aria-label="Was \$12\.99"/);
});

test('a piece that is not reduced shows one plain price', () => {
  const plain = main.priceHtml({ price: 12.99 });

  assert.equal(plain, '$12.99');
  assert.ok(!plain.includes('<s'));
});

test('a wasPrice that is not actually higher is ignored', () => {
  // A stale or equal wasPrice would otherwise strike through the same number
  // twice and look like a bug, which it would be.
  assert.equal(main.priceHtml({ price: 10, wasPrice: 10 }), '$10.00');
  assert.equal(main.priceHtml({ price: 10, wasPrice: 8 }), '$10.00');
  assert.equal(main.priceHtml({ price: 10, wasPrice: null }), '$10.00');
});

test('the card carries a flash saying how much off', () => {
  const card = main.mediaHtml(REDUCED);

  assert.match(card, /card__sale/);
  assert.match(card, /25% off/);
});

test('a card for something not on sale carries no flash', () => {
  assert.ok(!main.mediaHtml({ price: 10, images: ['a.jpg'] }).includes('card__sale'));
});

test('the piece itself shows the saving in money, not a percentage', () => {
  // Money is the thing being decided about.
  const html = main.detailPriceHtml(REDUCED);

  assert.match(html, /Save \$3\.25/);
  assert.match(html, /<s class="was"/);
});

test('"each" survives a sale', () => {
  // A sale on a piece with several designs must not lose the word that stops
  // the price reading as the price of all of them.
  const many = {
    ...REDUCED,
    designs: { label: 'Design', options: [{ id: 'd1', image: 'a.jpg' }, { id: 'd2', image: 'b.jpg' }] },
  };

  assert.match(main.detailPriceHtml(many), /each/);
});

test('the sale appears in every place a price is drawn', () => {
  // The failure this guards: a reduced price on the card and the old one on
  // the piece, so a visitor trusts neither.
  for (const draw of [main.mediaHtml, main.detailPriceHtml, main.picksHtml]) {
    assert.match(draw(REDUCED), /was|card__sale/, `${draw.name} does not show a sale`);
  }
});

/* --------------------------------------------------------------- offers */

test('the piece has a slot for the offers that cover it', () => {
  // The bug this guards: paintOffers ran before the detail was rendered, so
  // it filled an element that did not exist yet. The offers showed above the
  // grid - whose slot is in the static HTML - and nowhere on the piece.
  const js = readFileSync(new URL('../stitch-wishes-2050/main.js', import.meta.url), 'utf8');

  const renderAll = js.slice(js.indexOf('function renderAll('), js.indexOf('// The thank-you page.'));

  const slot = renderAll.indexOf('data-offers-for=');
  const paint = renderAll.lastIndexOf('paintOffers()');

  assert.ok(slot > 0, 'the piece has nowhere to show an offer');
  assert.ok(paint > slot, 'the offers are painted before the slot exists');
});

test('the offers are painted even when the catalog has not changed', () => {
  // They arrive with the catalog fetch and nothing has drawn them yet. Leaving
  // it to the repaint meant they appeared only when the live catalog happened
  // to differ from the bundled copy.
  const js = readFileSync(new URL('../stitch-wishes-2050/main.js', import.meta.url), 'utf8');
  const after = js.slice(js.indexOf('const live = await fetchLiveProducts()'));

  const paint = after.indexOf('paintOffers()');
  const bail = after.indexOf('JSON.stringify(live) === JSON.stringify(bundled)');

  assert.ok(paint > 0 && paint < bail, 'offers are only painted when the catalog changed');
});

test('a card says what deal is on that piece', () => {
  // A grid is scanned, not read. The card is where somebody decides whether
  // to open a piece at all, so an offer that only appears after they open it
  // is an offer that did not do its job.
  const js = readFileSync(new URL('../stitch-wishes-2050/main.js', import.meta.url), 'utf8');

  assert.match(js, /cardOffersHtml\(product\.handle\)/, 'the card never asks about offers');
  assert.match(js, /class="card__offer/, 'there is nowhere on the card to say it');
});

test('the grids are drawn again when the offers arrive', () => {
  // A card carries its offer in its own markup, so it cannot be filled in
  // place the way the slots on a page can - it has to be redrawn.
  const js = readFileSync(new URL('../stitch-wishes-2050/main.js', import.meta.url), 'utf8');
  const paint = js.slice(js.indexOf('function paintOffers()'), js.indexOf('/* ------------------------------------------------------------- on sale */'));

  assert.match(paint, /renderCollection\(\)/, 'the catalog grid is never redrawn with its offers');
  assert.match(paint, /data-featured/, 'the featured grid is never redrawn with its offers');
});

test('an offer carries its arithmetic, which is what sells it', () => {
  // "$38.97 -> $15.00, save $23.97" does more work than any adjective, and it
  // has the advantage of being true.
  const js = readFileSync(new URL('../stitch-wishes-2050/main.js', import.meta.url), 'utf8');
  const card = js.slice(js.indexOf('function offerCardHtml'), js.indexOf('const endsOn ='));

  assert.match(card, /offer__save/, 'the saving is never shown');
  assert.match(card, /offer\.was/, 'the old total is never shown');
});

test('the shop still invents no urgency', () => {
  // The rest of this site says nothing it cannot stand behind. A deal is
  // exciting enough without a clock on it.
  //
  // Comments are stripped first, because this codebase states that principle
  // out loud in several places and a test that cannot tell a promise from a
  // breach of it is worse than no test.
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const name of ['styles.css', 'main.js', 'bag.js']) {
    const code = strip(readFileSync(new URL(`../stitch-wishes-2050/${name}`, import.meta.url), 'utf8'));

    assert.ok(!/hurry|act fast|limited time|selling fast/i.test(code), `invented urgency in ${name}`);
    assert.ok(!/setInterval[\s\S]{0,120}(ends|expire|remain)/i.test(code), `a countdown in ${name}`);
  }
});

test('the sparkle stops for anyone who asked it to', () => {
  const css = readFileSync(new URL('../stitch-wishes-2050/styles.css', import.meta.url), 'utf8');
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

  assert.match(reduced, /\.offer,/);
  assert.match(reduced, /\.card__offer \{ animation: none/);
});
