// Point the site at a different deployment.
//
//   node scripts/set-site-origin.mjs https://new-host.vercel.app
//
// The static pages have to name their own origin: a canonical link and an Open
// Graph image must be absolute URLs, and a plain .html file has nowhere to read
// the host from. So the address is written into eleven files, and moving the
// site means changing all eleven or quietly shipping a page that still points
// at a deployment somebody else owns.
//
// The dynamic routes — /p/<handle>, /sitemap.xml, /robots.txt — read the host
// off the request and need no change. This only touches what cannot.
//
// tests/pages.test.mjs fails if the pages ever disagree about the origin, so a
// half-finished swap is caught rather than shipped.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Everything that can name the origin. node_modules and .git are skipped for
// the obvious reason; assets because a rewrite inside a JPEG is not a rewrite.
const SEARCH = ['stitch-wishes-2050', 'lib', 'api', 'README.md', 'docs'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'assets', 'superpowers']);
const TEXT = /\.(html|css|js|mjs|json|md)$/;

function* walk(path) {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return;

  if (stats.isFile()) {
    if (TEXT.test(path)) yield path;
    return;
  }

  for (const entry of readdirSync(path)) {
    if (SKIP_DIRS.has(entry)) continue;
    yield* walk(join(path, entry));
  }
}

// Any https origin that is not the one being set. Deliberately broad: the point
// is to catch a stale host nobody remembered, including one this script itself
// wrote on a previous run.
const ORIGIN_PATTERN = /https:\/\/[a-z0-9][a-z0-9.-]*\.(?:vercel\.app|com|net|org|shop|store|co|io)(?=[/"'\s)<]|$)/gi;

// Hosts that are supposed to be named and must never be rewritten.
const KEEP = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /instagram\.com/,
  /schema\.org/,
  /api\.stripe\.com/,
  /checkout\.stripe\.com/,
  /dashboard\.stripe\.com/,
  /api\.resend\.com/,
  /resend\.com/,
  /github\.com/,
  /vercel\.com/,
  /api\.vercel\.com/,
  /global-config\.vercel\.com/,
  /blob\.vercel-storage\.com/,
  /openapi\.vercel\.sh/,
  /docs\.github\.com/,
  /placeholder\.invalid/,
  /example\./,
];

const protectedHost = (url) => KEEP.some((pattern) => pattern.test(url));

function main() {
  const next = process.argv[2];

  if (!next || !/^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(next.replace(/\/+$/, ''))) {
    console.error('Usage: node scripts/set-site-origin.mjs https://new-host.example');
    console.error('  (https, no trailing path — just the origin)');
    process.exit(1);
  }

  const target = next.replace(/\/+$/, '');

  const found = new Map();
  const files = [];

  for (const entry of SEARCH) {
    for (const file of walk(join(ROOT, entry))) files.push(file);
  }

  let changedFiles = 0;
  let changedRefs = 0;

  for (const file of files) {
    const before = readFileSync(file, 'utf8');

    const after = before.replace(ORIGIN_PATTERN, (match) => {
      if (protectedHost(match) || match === target) return match;

      found.set(match, (found.get(match) ?? 0) + 1);
      changedRefs += 1;
      return target;
    });

    if (after !== before) {
      writeFileSync(file, after);
      changedFiles += 1;
      console.log(`  ${relative(ROOT, file).replace(/\\/g, '/')}`);
    }
  }

  console.log();

  if (!changedRefs) {
    console.log(`Nothing to change — everything already points at ${target}.`);
    return;
  }

  console.log(`Replaced ${changedRefs} reference(s) across ${changedFiles} file(s):`);
  for (const [was, count] of found) console.log(`  ${was}  ->  ${target}   (${count}x)`);

  console.log();
  console.log('Now run the tests: they check every page agrees on one origin.');
}

main();
