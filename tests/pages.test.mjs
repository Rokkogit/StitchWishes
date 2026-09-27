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
