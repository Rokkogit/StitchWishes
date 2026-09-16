// Global Config transport.
//
// Reads and writes use different hosts, different tokens, and different
// protocols, which is easy to get subtly wrong:
//
//   read   global-config.vercel.com  + read token   (optimised, edge-replicated)
//   write  api.vercel.com            + account token (REST, not optimised)
//
// Reading through api.vercel.com works but loses the optimisations Vercel
// attributes to the global-config host — "hundreds of milliseconds" on their
// numbers. Reads happen on every storefront load, so that path is never used
// here. Writes have no alternative; the SDK cannot write at all.
//
// fetch is injected so this is testable without calling Vercel.

export const CATALOG_KEY = 'products';

const READ_HOST = 'https://global-config.vercel.com';
const WRITE_HOST = 'https://api.vercel.com/v1/global-config';

/* -------------------------------------------------------------- config */

// Vercel stores the id and read token together in one connection string.
export function parseConnectionString(value) {
  if (typeof value !== 'string' || value.length === 0) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!/^(global|edge)-config\.vercel\.com$/.test(url.hostname)) return null;

  const id = url.pathname.replace(/^\/+|\/+$/g, '');
  const token = url.searchParams.get('token');

  if (!id || !token) return null;

  return { id, token };
}

export function readStoreConfig(env = {}) {
  if (!env.GLOBAL_CONFIG) return { ok: false, reason: 'missing-connection' };

  const parsed = parseConnectionString(env.GLOBAL_CONFIG);
  if (!parsed) return { ok: false, reason: 'bad-connection' };

  // Reading needs only the connection string. Writing additionally needs an
  // account token, so a missing one is reported rather than failing outright —
  // the storefront must keep working even if writes are not configured.
  return {
    ok: true,
    id: parsed.id,
    readToken: parsed.token,
    apiToken: env.VERCEL_API_TOKEN ?? null,
    teamId: env.VERCEL_TEAM_ID ?? null,
    canWrite: Boolean(env.VERCEL_API_TOKEN),
  };
}

/* --------------------------------------------------------------- reads */

async function getJson(url, token, fetchImpl) {
  let response;
  try {
    // Bearer header rather than ?token=, so the credential stays out of URLs
    // and therefore out of logs.
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (!response.ok) {
    return { ok: false, reason: 'upstream', status: response.status };
  }

  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export async function readCatalog(env = {}, fetchImpl = fetch) {
  const config = readStoreConfig(env);
  if (!config.ok) return config;

  const result = await getJson(`${READ_HOST}/${config.id}/items`, config.readToken, fetchImpl);
  if (!result.ok) return result;

  const value = result.body?.[CATALOG_KEY];

  // A store that exists but has never been seeded is not a failure — it is a
  // new store. Distinguish it from a populated one so callers can offer to
  // seed rather than showing an empty catalog as if that were the truth.
  if (value === undefined) return { ok: true, products: [], seeded: false };

  return {
    ok: true,
    products: Array.isArray(value) ? value : [],
    seeded: true,
  };
}

export async function readDigest(env = {}, fetchImpl = fetch) {
  const config = readStoreConfig(env);
  if (!config.ok) return config;

  const result = await getJson(`${READ_HOST}/${config.id}/digest`, config.readToken, fetchImpl);
  if (!result.ok) return result;

  // Documented as an object, but tolerate a bare string: the digest's shape is
  // explicitly undocumented and treated as opaque.
  const digest = typeof result.body === 'string' ? result.body : result.body?.digest;

  return { ok: true, digest: digest ?? null };
}

/* -------------------------------------------------------------- writes */

async function patchItems(config, operation, products, fetchImpl) {
  const query = config.teamId ? `?teamId=${encodeURIComponent(config.teamId)}` : '';

  return fetchImpl(`${WRITE_HOST}/${config.id}/items${query}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [{ operation, key: CATALOG_KEY, value: products }],
    }),
  });
}

export async function writeCatalog(env = {}, products, fetchImpl = fetch) {
  const config = readStoreConfig(env);
  if (!config.ok) return config;
  if (!config.canWrite) return { ok: false, reason: 'missing-api-token' };

  // Whatever Vercel says describes OUR configuration, not a secret, and it is
  // the difference between a diagnosis and a guess. Read once: a body can only
  // be consumed a single time.
  async function reasonFor(response) {
    try {
      const body = await response.json();
      return body?.error?.message ?? body?.error?.code ?? null;
    } catch {
      return null;   // not every failure comes back as JSON
    }
  }

  let response;
  let detail;

  try {
    response = await patchItems(config, 'upsert', products, fetchImpl);
    detail = response.ok ? null : await reasonFor(response);

    // Vercel answers the first write to a key that has never existed with
    // 404 "Edge Config Item not found": the documented upsert behaves as an
    // update here. Create it instead, once. Afterwards the key exists and
    // upsert succeeds, so this costs a second request on the first save only.
    //
    // Only when the ITEM is missing. A missing store is a configuration
    // problem, and creating a key would not repair it.
    if (response.status === 404 && /item/i.test(detail ?? '')) {
      response = await patchItems(config, 'create', products, fetchImpl);
      detail = response.ok ? null : await reasonFor(response);
    }
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (response.ok) return { ok: true };

  // Access tokens expire, and Vercel recommends setting an expiry. When that
  // day comes this must read as "your token expired", not as a generic outage,
  // or it is a miserable thing to debug.
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'bad-api-token', status: response.status, detail };
  }

  return { ok: false, reason: 'upstream', status: response.status, detail };
}
