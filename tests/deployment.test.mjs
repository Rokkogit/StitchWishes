// Things that are only wrong at deploy time.
//
// Written after a deployment failed silently: api/ reached thirteen route files
// and a Hobby deployment allows twelve, so the build was rejected outright. The
// site kept serving the previous version, every test passed, and the only symptom
// was that a pushed change never appeared. That is a bad way to find out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

const ROUTES = readdirSync(new URL('api/', ROOT)).filter((name) => name.endsWith('.mjs'));

const config = JSON.parse(read('vercel.json'));

// Vercel's Hobby plan: no more than twelve Serverless Functions per deployment.
// Every file in api/ is one function — an underscore prefix does not exempt it,
// only a leading dot does, which is why shared code lives in lib/.
const HOBBY_FUNCTION_LIMIT = 12;

test(`api/ stays within the ${HOBBY_FUNCTION_LIMIT}-function Hobby limit`, () => {
  assert.ok(
    ROUTES.length <= HOBBY_FUNCTION_LIMIT,
    `${ROUTES.length} functions in api/; the build fails above ${HOBBY_FUNCTION_LIMIT}. ` +
      `Merge routes into one function and dispatch with a rewrite, as api/admin-auth.mjs and api/seo.mjs do.`
  );
});

test('every route exports a fetch handler', () => {
  // A file in api/ that does not is deployed as a function that cannot answer.
  for (const name of ROUTES) {
    const source = read(`api/${name}`);
    assert.match(source, /export default \{[\s\S]*fetch/, `api/${name} has no fetch export`);
  }
});

/* ----------------------------------------------------------------- routing */

const rewrites = config.rewrites ?? [];
const destinations = rewrites.map((rule) => rule.destination);

test('every rewrite points at a route that exists', () => {
  for (const rule of rewrites) {
    const file = `${rule.destination.replace(/^\/api\//, '').split('?')[0]}.mjs`;
    assert.ok(ROUTES.includes(file), `${rule.source} points at api/${file}, which is missing`);
  }
});

test('every /api URL the browser calls is answered by something', () => {
  // The merge of three auth routes into one function was invisible to the admin
  // page only because of rewrites. If one of those is ever dropped, login breaks
  // with a 404 and nothing else notices.
  const scripts = ['admin.js', 'admin-catalog.js', 'bag.js', 'main.js', 'cart.js'];

  const called = new Set();
  for (const name of scripts) {
    for (const [, path] of read(`stitch-wishes-2050/${name}`).matchAll(/['"`](\/api\/[a-z-]+)['"`]/g)) {
      called.add(path);
    }
  }

  assert.ok(called.size > 0, 'found no API calls at all, so this test proves nothing');

  for (const path of called) {
    const direct = ROUTES.includes(`${path.replace('/api/', '')}.mjs`);
    const rewritten = rewrites.some((rule) => rule.source === path);

    assert.ok(direct || rewritten, `${path} is called by the site but nothing serves it`);
  }
});

test('the paths a crawler expects are routed', () => {
  for (const source of ['/robots.txt', '/sitemap.xml', '/p/:handle']) {
    assert.ok(
      rewrites.some((rule) => rule.source === source),
      `${source} has no rewrite`
    );
  }
});

/* ----------------------------------------------------------------- headers */

test('the security headers are all still set', () => {
  const headers = (config.headers ?? []).flatMap((rule) => rule.headers.map((h) => h.key));

  for (const key of [
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'X-Frame-Options',
    'Permissions-Policy',
  ]) {
    assert.ok(headers.includes(key), `${key} is missing`);
  }
});

test('the CSP allows exactly the outside hosts the site uses', () => {
  const csp = config.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === 'Content-Security-Policy').value;

  // Google Fonts, and the Blob store for uploaded photographs. Nothing else.
  assert.match(csp, /style-src[^;]*fonts\.googleapis\.com/);
  assert.match(csp, /font-src[^;]*fonts\.gstatic\.com/);
  assert.match(csp, /img-src[^;]*blob\.vercel-storage\.com/);

  // No unsafe-inline or unsafe-eval for scripts, which is what makes the policy
  // worth having at all.
  const scriptSrc = csp.match(/script-src([^;]*)/)[1];
  assert.ok(!scriptSrc.includes('unsafe'), `script-src is not safe: ${scriptSrc}`);
});

/* -------------------------------------------------------------- packaging */

test('lib/ is never excluded from the upload', () => {
  // api/ imports it and Vercel bundles imported modules by tracing them from the
  // files it uploads. Excluding lib/ would deploy functions that cannot start.
  const ignored = read('.vercelignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  assert.ok(!ignored.some((line) => line.replace(/\/$/, '') === 'lib'));
});

test('the only dependency is the one that needs to be there', () => {
  // Stripe, Resend and the config store are all reached over plain fetch. Blob
  // needs its SDK because it signs uploads.
  const pkg = JSON.parse(read('package.json'));

  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ['@vercel/blob']);
});
