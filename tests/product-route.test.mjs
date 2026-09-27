// /p/<handle>, /sitemap.xml and /robots.txt, driven with real Request objects.
//
// globalThis.fetch is the catalog store; the shell fetch is passed in
// separately, so a broken store and a broken shell are distinguishable.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { render, clearShellCache } from '../api/p.mjs';
import { sitemap as sitemapFn, robots as robotsFn } from '../lib/seo.mjs';

// Both live in one function now, picked apart by a rewrite. Wrapped so the
// assertions still read as requests against two endpoints.
const sitemap = { fetch: sitemapFn };
const robots = { fetch: robotsFn };
import { CATALOG_KEY } from '../lib/global-config.mjs';
import { hasDetailContainer } from '../lib/render.mjs';

const HOST = 'shop.example';

const piece = (over = {}) => ({
  handle: 'beaded-pen',
  title: 'Beaded pen',
  price: 12.99,
  description: 'A hand-beaded pen made one at a time.',
  images: ['assets/pen.jpg'],
  hidden: false,
  ...over,
});

// The real file, so a change to product.html that breaks injection fails here
// rather than on the live site.
const SHELL = readFileSync(
  new URL('../stitch-wishes-2050/product.html', import.meta.url),
  'utf8'
);

const saved = {};
let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  saved.GLOBAL_CONFIG = process.env.GLOBAL_CONFIG;
  process.env.GLOBAL_CONFIG = 'https://global-config.vercel.com/ecfg_abc/items?token=read-token';
  clearShellCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (saved.GLOBAL_CONFIG === undefined) delete process.env.GLOBAL_CONFIG;
  else process.env.GLOBAL_CONFIG = saved.GLOBAL_CONFIG;
  clearShellCache();
});

function store(items = [piece()]) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return items === null ? {} : { [CATALOG_KEY]: items };
    },
  });
}

const shellFetch = (body = SHELL, status = 200) => async () =>
  new Response(body, { status });

const request = (path, method = 'GET') =>
  new Request(`https://internal.invalid${path}`, {
    method,
    headers: { 'x-forwarded-host': HOST, 'x-forwarded-proto': 'https' },
  });

/* ------------------------------------------------------- the real shell */

test('the shipped product.html still has the container this route fills', () => {
  // If this fails, /p/<handle> silently stops server-rendering anything.
  assert.ok(hasDetailContainer(SHELL), 'product.html no longer matches the injection point');
});

test('the shipped product.html is noindex, so it does not compete with /p/', () => {
  assert.match(SHELL, /<meta\s+name="robots"\s+content="noindex/i);
});

/* ------------------------------------------------------------ rendering */

test('a known piece renders with its own head, in the real shell', async () => {
  store();
  const response = await render(request('/api/p?handle=beaded-pen'), shellFetch());
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /text\/html/);

  assert.ok(html.includes('<title>Beaded pen — Stitch Wishess</title>'));
  assert.ok(html.includes('og:image'));
  assert.ok(html.includes('application/ld+json'));

  // The shell's own furniture survived.
  assert.ok(html.includes('site-header'));
  assert.ok(html.includes('main.js'));

  // One title, and not the placeholder.
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.ok(!html.includes('<title>Piece'));

  // The shell's noindex did not survive into the page meant to be indexed.
  assert.ok(!html.includes('noindex'));

  // And the piece is in the body, not only in the head.
  assert.ok(html.includes('<h1>Beaded pen</h1>'));
});

test('relative links are rebased, or the page arrives unstyled from /p/', async () => {
  store();
  const html = await (await render(request('/api/p?handle=beaded-pen'), shellFetch())).text();

  assert.ok(html.includes('<base href="/">'));
});

test('the absolute urls use the forwarded host, not the internal one', async () => {
  store();
  const html = await (await render(request('/api/p?handle=beaded-pen'), shellFetch())).text();

  assert.ok(html.includes(`https://${HOST}/p/beaded-pen`));
  assert.ok(html.includes(`https://${HOST}/assets/pen.jpg`));
  assert.ok(!html.includes('internal.invalid'), 'an internal hostname leaked into the page');
});

test('the handle can arrive in the path instead of the query', async () => {
  store();
  const html = await (await render(request('/p/beaded-pen'), shellFetch())).text();

  assert.ok(html.includes('<h1>Beaded pen</h1>'));
});

/* ---------------------------------------------------------------- misses */

test('an unknown handle is a 404 that is not indexable', async () => {
  store();
  const response = await render(request('/p/nothing-here'), shellFetch());
  const html = await response.text();

  assert.equal(response.status, 404);
  assert.match(html, /noindex/);
  assert.match(html, /isn't in the catalog/);
});

test('a hidden piece is treated as missing rather than advertised', async () => {
  store([piece({ hidden: true })]);
  const response = await render(request('/p/beaded-pen'), shellFetch());

  assert.equal(response.status, 404);
});

test('no handle at all is a 404, not a crash', async () => {
  store();
  assert.equal((await render(request('/api/p'), shellFetch())).status, 404);
});

test('POST is refused', async () => {
  store();
  const response = await render(request('/p/beaded-pen', 'POST'), shellFetch());

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
});

/* -------------------------------------------------------------- fallbacks */

test('an unreachable store falls back to the bundled catalog rather than erroring', async () => {
  // A crawler that gets a 503 may drop the URL entirely.
  globalThis.fetch = async () => {
    throw new Error('store down');
  };

  const response = await render(request('/p/untitled-may1_12-21'), shellFetch());

  assert.equal(response.status, 200);
  assert.match(await response.text(), /og:title/);
});

test('an unfetchable shell still serves correct preview tags', async () => {
  store();
  const response = await render(request('/p/beaded-pen'), shellFetch('nope', 500));
  const html = await response.text();

  assert.equal(response.status, 200);
  // The whole point of the route survives even with none of the styling.
  assert.ok(html.includes('og:image'));
  assert.ok(html.includes('<h1>Beaded pen</h1>'));
  assert.ok(html.includes('application/ld+json'));
});

test('the shell is fetched once and reused', async () => {
  store();
  let calls = 0;
  const counting = async () => {
    calls += 1;
    return new Response(SHELL, { status: 200 });
  };

  await render(request('/p/beaded-pen'), counting);
  await render(request('/p/beaded-pen'), counting);

  assert.equal(calls, 1);
});

/* --------------------------------------------------------------- sitemap */

test('the sitemap is xml and lists the live catalog', async () => {
  store([piece(), piece({ handle: 'night-light' })]);
  const response = await sitemap.fetch(request('/sitemap.xml'));
  const xml = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /xml/);
  assert.ok(xml.includes(`https://${HOST}/p/beaded-pen`));
  assert.ok(xml.includes(`https://${HOST}/p/night-light`));
});

test('a hidden piece never reaches the sitemap', async () => {
  store([piece(), piece({ handle: 'secret', hidden: true })]);
  const xml = await (await sitemap.fetch(request('/sitemap.xml'))).text();

  assert.ok(!xml.includes('secret'));
});

test('an unreachable store yields the bundled catalog, not an empty sitemap', async () => {
  // An empty sitemap tells a crawler the shop has nothing in it.
  globalThis.fetch = async () => {
    throw new Error('down');
  };

  const xml = await (await sitemap.fetch(request('/sitemap.xml'))).text();

  assert.ok(xml.includes('/p/'), 'the sitemap listed no products at all');
});

/* ---------------------------------------------------------------- robots */

test('robots points at the sitemap on the host it was asked on', async () => {
  const response = await robots.fetch(request('/robots.txt'));
  const body = await response.text();

  assert.match(response.headers.get('Content-Type'), /text\/plain/);
  assert.ok(body.includes(`Sitemap: https://${HOST}/sitemap.xml`));
  assert.ok(body.includes('Disallow: /admin'));
  assert.ok(body.includes('Disallow: /api/'));
  assert.ok(body.includes('Allow: /'));
});
