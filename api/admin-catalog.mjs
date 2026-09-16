// The catalog editor's backend.
//
//   GET   full catalog (hidden included), digest, asset list, health
//   POST  validate, check the digest, write
//
// Both require a verified session. This is the constraint the gate spec set:
// the admin page's HTML is public, so only verified operations protect
// anything.

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readConfig, verifyToken, readCookie, COOKIE_NAME } from '../lib/session.mjs';
import { readStore, readDigest, writeStore, CATALOG_KEY, SETTINGS_KEY } from '../lib/global-config.mjs';
import { validateCatalog, catalogHealth } from '../lib/catalog.mjs';
import { validateSettings, DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { ASSETS } from '../lib/assets-manifest.mjs';
import { list } from '@vercel/blob';

// Photographs uploaded from a phone live in Blob rather than in assets/, so
// the picker has to offer both. Newest first, because the one you just took is
// the one you are looking for.
//
// A failure here is not fatal: the bundled photographs still work, and an
// empty picker would be a worse answer than a slightly incomplete one.
async function uploadedPhotos() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];

  try {
    const { blobs } = await list({ prefix: 'uploads/', limit: 1000 });

    return blobs
      .slice()
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .map((blob) => blob.url);
  } catch (error) {
    console.error('[admin-catalog] could not list uploads:', error?.message);
    return [];
  }
}

function authorized(request) {
  const config = readConfig(process.env);
  if (!config.ok) return false;

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return false;

  return verifyToken(config.secret, token).valid;
}

const UNAUTHORIZED = () => json(401, { error: 'Sign in first.' });

/* -------------------------------------------------------------------- GET */

async function handleGet() {
  const [catalog, digest, uploads] = await Promise.all([
    readStore(process.env),
    readDigest(process.env),
    uploadedPhotos(),
  ]);

  if (!catalog.ok) {
    console.error(`[admin-catalog] read failed: ${catalog.reason ?? catalog.status}`);
    return json(503, { error: 'Cannot reach the catalog store.' });
  }

  return json(200, {
    products: catalog.products,
    // Defaults rather than null, so the editor always has a shape to draw and
    // a store with no settings yet is not a special case in the browser.
    settings: catalog.settings ?? DEFAULT_SETTINGS,
    seeded: catalog.seeded,
    // Null rather than an error: a missing digest costs conflict detection on
    // the next save, which is worth degrading rather than blocking an edit.
    digest: digest.ok ? digest.digest : null,
    assets: [...uploads, ...ASSETS],
    health: catalogHealth(catalog.products, [...uploads, ...ASSETS]),
  });
}

/* ------------------------------------------------------------------- POST */

async function handlePost(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Expected a JSON body.' });
  }

  const result = validateCatalog(body?.products);
  const settings = validateSettings(body?.settings);

  // Both are reported together. Fixing a price only to be told about a fee is
  // the kind of one-at-a-time validation that makes a form miserable.
  if (!result.ok || !settings.ok) {
    return json(400, {
      error: 'Some of this needs fixing.',
      errors: [...(result.errors ?? []), ...(settings.errors ?? [])],
    });
  }

  // Conflict check before writing, not after. The digest changes on every
  // write, so a digest that has moved since the editor loaded means someone
  // else saved in between — refuse rather than overwrite their work.
  const current = await readDigest(process.env);
  if (current.ok && body.digest && current.digest && current.digest !== body.digest) {
    return json(409, {
      error: 'The catalog changed somewhere else since you opened it. Reload to pick up those edits.',
    });
  }

  // Re-read to learn which keys the store already holds. A key that has never
  // existed must be created rather than upserted, and right after this feature
  // ships the normal state is a store with a catalog but no settings.
  const store = await readStore(process.env);
  const existing = store.ok ? store.existing : new Set();

  // One write for both, so the catalog and the prices that go with it change
  // together or not at all.
  const write = await writeStore(
    process.env,
    { [CATALOG_KEY]: result.value, [SETTINGS_KEY]: settings.value },
    existing
  );

  if (!write.ok) {
    console.error(
      `[admin-catalog] write failed: ${write.reason} ${write.status ?? ''} ${write.detail ?? ''}`
    );

    if (write.reason === 'missing-api-token') {
      return json(503, { error: 'Saving is not configured: VERCEL_API_TOKEN is unset.' });
    }
    if (write.reason === 'unreachable') {
      return json(502, { error: 'Could not reach the catalog store. Nothing was changed.' });
    }

    // The status and the store's own words go in the message. A failure nobody
    // can diagnose without server logs is barely better than a silent one.
    const said = [write.status && `HTTP ${write.status}`, write.detail].filter(Boolean).join(' — ');

    if (write.reason === 'bad-api-token') {
      return json(502, {
        error: `The Vercel API token was refused (${said}). It has expired, been revoked, or lacks the scope to write.`,
      });
    }

    return json(502, { error: `The catalog store refused the write (${said}). Nothing was changed.` });
  }

  // Hand back the new digest so the editor can save again without reloading.
  const next = await readDigest(process.env);

  return json(200, {
    ok: true,
    digest: next.ok ? next.digest : null,
    size: result.size,
    health: catalogHealth(result.value, ASSETS),
  });
}

/* -------------------------------------------------------------------- route */

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return methodNotAllowed('GET, POST');
    }

    if (!authorized(request)) return UNAUTHORIZED();

    return request.method === 'GET' ? handleGet() : handlePost(request);
  },
};
