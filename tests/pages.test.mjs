// Every page the public can reach, checked as a file on disk.
//
// This exists so the next page added to the site cannot ship without the things
// that are invisible in a browser: a canonical URL, a preview card, a way back
// to the policies. All of those look perfectly fine when missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../stitch-wishes-2050/', import.meta.url);

const read = (name) => readFileSync(new URL(name, DIR), 'utf8');

const ALL = readdirSync(DIR).filter((name) => name.endsWith('.html'));

// admin.html is not a public page: it is noindex by design and has no footer.
const PUBLIC = ALL.filter((name) => name !== 'admin.html');

// product.html is the shell for /p/<handle>, which supplies its own head at
// request time. Its own tags are deliberately minimal.
const SELF_CONTAINED = PUBLIC.filter((name) => name !== 'product.html');

test('the pages under test are the ones actually shipped', () => {
  // A guard on the guard: if this list empties out, everything below passes
  // vacuously and the suite would go quiet rather than red.
  assert.ok(ALL.length >= 8, `only found ${ALL.length} pages`);
  assert.ok(ALL.includes('index.html'));
  assert.ok(ALL.includes('404.html'));
  assert.ok(ALL.includes('terms.html'));
});

for (const name of SELF_CONTAINED) {
  test(`${name} can be shared and indexed correctly`, () => {
    const html = read(name);

    assert.match(html, /<title>[^<]+<\/title>/, 'no title');
    assert.match(html, /<meta name="description" content="[^"]+"/, 'no description');
    assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+"/, 'no canonical');

    for (const property of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image']) {
      assert.ok(html.includes(`property="${property}"`), `no ${property}`);
    }

    assert.match(html, /name="twitter:card"/, 'no twitter card');

    // A preview bot cannot resolve a relative image, so a relative og:image is
    // the same as no image at all.
    const image = html.match(/property="og:image" content="([^"]+)"/)?.[1];
    assert.ok(image?.startsWith('https://'), `og:image is not absolute: ${image}`);
  });
}

test('the bag and the 404 page are kept out of search results', () => {
  // Neither is content. An indexed empty bag is a bad first impression.
  for (const name of ['bag.html', '404.html']) {
    assert.match(read(name), /name="robots" content="noindex/, name);
  }
});

test('the pages meant to be found are not accidentally noindex', () => {
  for (const name of ['index.html', 'collection.html', 'about.html', 'policies.html', 'terms.html']) {
    assert.ok(!read(name).includes('noindex'), `${name} is noindex`);
  }
});

test('the admin page stays out of search entirely', () => {
  assert.match(read('admin.html'), /name="robots" content="noindex/);
});

test('every public page reaches the policies and the terms', () => {
  // Stripe looks for these, and a customer looking for a refund policy should
  // not have to go back to the front page to find one.
  for (const name of PUBLIC) {
    const html = read(name);
    assert.ok(html.includes('policies.html'), `${name} does not link the policies`);
    assert.ok(html.includes('terms.html'), `${name} does not link the terms`);
  }
});

test('every public page offers a way to make contact', () => {
  for (const name of PUBLIC) {
    assert.ok(read(name).includes('stitch.wishess@gmail.com'), `${name} has no contact address`);
  }
});

test('no page names the town', () => {
  // Removed deliberately: the studio is a home.
  for (const name of ALL) {
    const html = read(name);
    for (const word of ['Malvern', 'Arkansas']) {
      assert.ok(!html.includes(word), `${name} names ${word}`);
    }
  }
});

test('every page agrees on one site origin', () => {
  // Moving the site means rewriting the origin in every static page, because a
  // .html file has nowhere to read its own host from. Missing one ships a page
  // whose canonical URL and preview image point at a deployment somebody else
  // owns — which looks completely fine in a browser.
  const origins = new Set();

  for (const name of ALL) {
    for (const [, origin] of read(name).matchAll(
      /(?:rel="canonical" href=|property="og:(?:url|image)" content=|name="twitter:image" content=)"(https:\/\/[^/"]+)/g
    )) {
      origins.add(origin);
    }
  }

  assert.ok(origins.size > 0, 'no canonical or og tags found at all');
  assert.equal(
    origins.size,
    1,
    `pages disagree about the origin: ${[...origins].join(', ')} — run scripts/set-site-origin.mjs`
  );
});

test('every page asks for the same build of the css and js', () => {
  // A page left on an old ?v= serves a stylesheet that does not match its
  // markup, which is a class of bug that only shows up on one page.
  const versions = new Set();

  for (const name of ALL) {
    for (const [, version] of read(name).matchAll(/\?v=([a-z0-9]+)/g)) {
      versions.add(version);
    }
  }

  assert.equal(versions.size, 1, `mixed asset versions: ${[...versions].join(', ')}`);
});

test('nothing on a public page is an inline script the CSP would block', () => {
  // script-src 'self' silently kills both of these, and a page whose scripts do
  // not run looks like a page that is simply broken.
  for (const name of ALL) {
    const html = read(name);

    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/gi)].filter(
      (match) => !/type="application\/ld\+json"/i.test(match[0])
    );
    assert.equal(inline.length, 0, `${name} has an inline script`);

    assert.ok(!/\son(click|error|load|submit|change)=/i.test(html), `${name} has an inline handler`);
  }
});

/* --------------------------------------------------------- one axis only */

test('the page cannot be dragged sideways', () => {
  // overflow-x: hidden on the body alone was not enough - it leaves a
  // scrollport that a thumb can still drag. clip creates no scroll container
  // at all, so there is nothing to drag.
  const css = readFileSync(new URL('styles.css', DIR), 'utf8');
  const root = css.slice(css.indexOf('html {'), css.indexOf('body {'));

  assert.match(root, /overflow-x:\s*clip/, 'the root can still scroll sideways');
  // hidden stays first as the fallback for anything too old to know clip.
  assert.match(root, /overflow-x:\s*hidden[\s\S]*overflow-x:\s*clip/);
});

test('a sideways swipe inside a row stays in that row', () => {
  // The filter chips, the design thumbnails and the picks all scroll
  // sideways. Without this, a gesture that runs out of row hands the rest of
  // itself to the page, which is the other way the site moved under a thumb.
  const css = readFileSync(new URL('styles.css', DIR), 'utf8');

  const scrollers = [...css.matchAll(/overflow-x:\s*auto;([\s\S]{0,120})/g)];
  assert.ok(scrollers.length >= 2, 'no sideways scrollers found to check');

  for (const [, after] of scrollers) {
    assert.match(after, /overscroll-behavior-x/, 'a sideways scroller can chain to the page');
  }
});

/* ------------------------------------------------------------- the bag */

test('the pay button comes before the upsell, not after it', () => {
  // On a phone the bag stacks into one column in source order. Someone who has
  // decided should not have to scroll past "add a little something" to find the
  // button that takes their money.
  const bag = readFileSync(new URL('bag.js', DIR), 'utf8');

  const items = bag.indexOf('class="bag-items"');
  const pay = bag.indexOf('bag-total__pay');
  const extras = bag.indexOf('class="bag-extras"');

  assert.ok(items > 0 && pay > 0 && extras > 0, 'the bag no longer has these three parts');
  assert.ok(items < pay, 'the total is rendered before the items');
  assert.ok(pay < extras, 'the upsell is rendered before the pay button');
});

test('the way out sits with the items, not under the pay button', () => {
  // A link back to the catalog directly beneath the button that takes the
  // money is a way out placed next to the way forward.
  const bag = readFileSync(new URL('bag.js', DIR), 'utf8');

  const back = bag.indexOf('class="bag-back"');
  const pay = bag.indexOf('bag-total__pay');

  assert.ok(back > 0, 'the link back to the catalog is gone');
  assert.ok(back < pay, 'it is still below the pay button');
});

test('all three parts of the bag stack in one column on a phone', () => {
  // Any of them left in a second column would be off the side of the screen.
  const css = readFileSync(new URL('styles.css', DIR), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 860px)'));
  const block = phone.slice(0, phone.indexOf('\n}\n') + 3);

  for (const part of ['bag-main', 'bag-extras', 'bag-total']) {
    assert.match(block, new RegExp(part), `${part} is not placed on a phone`);
  }
  assert.match(block, /grid-template-columns:\s*1fr/);
});
