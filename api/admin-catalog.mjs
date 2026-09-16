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
import { readCatalog, readDigest, writeCatalog } from '../lib/global-config.mjs';
import { validateCatalog, catalogHealth } from '../lib/catalog.mjs';
import { ASSETS } from '../lib/assets-manifest.mjs';

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
  const [catalog, digest] = await Promise.all([
    readCatalog(process.env),
    readDigest(process.env),
  ]);

  if (!catalog.ok) {
    console.error(`[admin-catalog] read failed: ${catalog.reason ?? catalog.status}`);
    return json(503, { error: 'Cannot reach the catalog store.' });
  }

  return json(200, {
    products: catalog.products,
    seeded: catalog.seeded,
    // Null rather than an error: a missing digest costs conflict detection on
    // the next save, which is worth degrading rather than blocking an edit.
    digest: digest.ok ? digest.digest : null,
    assets: ASSETS,
    health: catalogHealth(catalog.products, ASSETS),
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
  if (!result.ok) {
    return json(400, { error: 'Some pieces need fixing.', errors: result.errors });
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

  const write = await writeCatalog(process.env, result.value);

  if (!write.ok) {
    console.error(`[admin-catalog] write failed: ${write.reason} ${write.status ?? ''}`);

    if (write.reason === 'missing-api-token') {
      return json(503, { error: 'Saving is not configured: VERCEL_API_TOKEN is unset.' });
    }
    if (write.reason === 'bad-api-token') {
      return json(502, {
        error: 'The Vercel API token was refused — it has expired, been revoked, or lacks the scope to write.',
      });
    }
    return json(502, { error: 'The catalog store refused the write. Nothing was changed.' });
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
