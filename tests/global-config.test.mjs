// Global Config transport. The stub fetch is the only mock in this suite and
// is unavoidable — the alternative is calling Vercel's API from a unit test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseConnectionString,
  readStoreConfig,
  readCatalog,
  readDigest,
  writeCatalog,
  CATALOG_KEY,
} from '../lib/global-config.mjs';

const ID = 'ecfg_abc123';
const READ_TOKEN = 'read-token-value';
const API_TOKEN = 'vercel-api-token-value';
const CONNECTION = `https://global-config.vercel.com/${ID}?token=${READ_TOKEN}`;

const env = (over = {}) => ({
  GLOBAL_CONFIG: CONNECTION,
  VERCEL_API_TOKEN: API_TOKEN,
  ...over,
});

// Records what it was called with, replays what it was told to.
function stubFetch(responses) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls = [];

  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = queue.shift() ?? { status: 200, body: {} };
    if (next.throws) throw new Error('network down');
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      async json() {
        return next.body;
      },
      async text() {
        return JSON.stringify(next.body);
      },
    };
  };

  impl.calls = calls;
  return impl;
}

/* ------------------------------------------------- parseConnectionString */

test('parseConnectionString pulls the id and read token out', () => {
  const parsed = parseConnectionString(CONNECTION);

  assert.equal(parsed.id, ID);
  assert.equal(parsed.token, READ_TOKEN);
});

test('parseConnectionString also accepts the older edge-config host', () => {
  const parsed = parseConnectionString(`https://edge-config.vercel.com/${ID}?token=${READ_TOKEN}`);

  assert.equal(parsed.id, ID);
  assert.equal(parsed.token, READ_TOKEN);
});

test('parseConnectionString returns null for anything unusable', () => {
  for (const bad of ['', null, undefined, 'not-a-url', 'https://example.com/no-token', 42]) {
    assert.equal(parseConnectionString(bad), null, `expected ${JSON.stringify(bad)} to parse to null`);
  }
});

test('parseConnectionString returns null when the token is missing', () => {
  assert.equal(parseConnectionString(`https://global-config.vercel.com/${ID}`), null);
});

/* ------------------------------------------------------- readStoreConfig */

test('readStoreConfig succeeds with both variables present', () => {
  const config = readStoreConfig(env());

  assert.equal(config.ok, true);
  assert.equal(config.id, ID);
  assert.equal(config.readToken, READ_TOKEN);
  assert.equal(config.apiToken, API_TOKEN);
});

test('readStoreConfig fails closed when the connection string is missing', () => {
  const config = readStoreConfig(env({ GLOBAL_CONFIG: undefined }));

  assert.equal(config.ok, false);
  assert.equal(config.reason, 'missing-connection');
});

test('readStoreConfig fails closed when the connection string is malformed', () => {
  const config = readStoreConfig(env({ GLOBAL_CONFIG: 'garbage' }));

  assert.equal(config.ok, false);
  assert.equal(config.reason, 'bad-connection');
});

// Reads work without it; only writes need the API token, so this is reported
// separately rather than failing the whole config.
test('readStoreConfig reports a missing API token without failing reads', () => {
  const config = readStoreConfig(env({ VERCEL_API_TOKEN: undefined }));

  assert.equal(config.ok, true);
  assert.equal(config.canWrite, false);
});

test('readStoreConfig reports canWrite when the API token is present', () => {
  assert.equal(readStoreConfig(env()).canWrite, true);
});

/* ------------------------------------------------------------ readCatalog */

test('readCatalog calls the optimised global-config host, not the REST API', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { [CATALOG_KEY]: [] } });

  await readCatalog(env(), fetchImpl);

  const { url } = fetchImpl.calls[0];
  assert.ok(url.startsWith('https://global-config.vercel.com/'), `got ${url}`);
  assert.ok(!url.includes('api.vercel.com'), 'reads must not use the unoptimised REST API');
  assert.ok(url.includes(`/${ID}/items`));
});

test('readCatalog sends the read token as a bearer header, not a query param', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { [CATALOG_KEY]: [] } });

  await readCatalog(env(), fetchImpl);

  const { url, options } = fetchImpl.calls[0];
  assert.equal(options.headers.Authorization, `Bearer ${READ_TOKEN}`);
  assert.ok(!url.includes(READ_TOKEN), 'the token should not travel in the URL');
});

test('readCatalog returns the stored products', async () => {
  const products = [{ handle: 'pen', title: 'Pen' }];
  const fetchImpl = stubFetch({ status: 200, body: { [CATALOG_KEY]: products } });

  const result = await readCatalog(env(), fetchImpl);

  assert.equal(result.ok, true);
  assert.deepEqual(result.products, products);
});

// A store that exists but has never been seeded is not an error.
test('readCatalog returns an empty catalog when the key is absent', async () => {
  const fetchImpl = stubFetch({ status: 200, body: {} });

  const result = await readCatalog(env(), fetchImpl);

  assert.equal(result.ok, true);
  assert.deepEqual(result.products, []);
  assert.equal(result.seeded, false);
});

test('readCatalog marks a seeded store as seeded', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { [CATALOG_KEY]: [] } });

  assert.equal((await readCatalog(env(), fetchImpl)).seeded, true);
});

// Silently returning [] would wipe the storefront on a transient failure.
test('readCatalog surfaces an upstream failure rather than returning empty', async () => {
  const fetchImpl = stubFetch({ status: 500, body: { error: 'boom' } });

  const result = await readCatalog(env(), fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test('readCatalog surfaces a network error rather than throwing', async () => {
  const result = await readCatalog(env(), stubFetch({ throws: true }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
});

test('readCatalog fails closed when the store is not configured', async () => {
  const fetchImpl = stubFetch({ status: 200, body: {} });

  const result = await readCatalog(env({ GLOBAL_CONFIG: undefined }), fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(fetchImpl.calls.length, 0, 'must not call out when unconfigured');
});

/* ------------------------------------------------------------- readDigest */

test('readDigest asks the digest endpoint', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { digest: 'abc123' } });

  const result = await readDigest(env(), fetchImpl);

  assert.ok(fetchImpl.calls[0].url.includes(`/${ID}/digest`));
  assert.equal(result.ok, true);
  assert.equal(result.digest, 'abc123');
});

test('readDigest tolerates a bare string response', async () => {
  const fetchImpl = stubFetch({ status: 200, body: 'abc123' });

  assert.equal((await readDigest(env(), fetchImpl)).digest, 'abc123');
});

/* ----------------------------------------------------------- writeCatalog */

const products = [{ handle: 'pen', title: 'Pen', price: 1, description: '', images: [], hidden: false }];

test('writeCatalog PATCHes the Vercel REST API', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { status: 'ok' } });

  await writeCatalog(env(), products, fetchImpl);

  const { url, options } = fetchImpl.calls[0];
  assert.ok(url.startsWith('https://api.vercel.com/v1/global-config/'), `got ${url}`);
  assert.ok(url.includes(`/${ID}/items`));
  assert.equal(options.method, 'PATCH');
});

test('writeCatalog authenticates with the API token, not the read token', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { status: 'ok' } });

  await writeCatalog(env(), products, fetchImpl);

  assert.equal(fetchImpl.calls[0].options.headers.Authorization, `Bearer ${API_TOKEN}`);
});

test('writeCatalog sends a single upsert for the catalog key', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { status: 'ok' } });

  await writeCatalog(env(), products, fetchImpl);

  const body = JSON.parse(fetchImpl.calls[0].options.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].operation, 'upsert');
  assert.equal(body.items[0].key, CATALOG_KEY);
  assert.deepEqual(body.items[0].value, products);
});

test('writeCatalog appends the team id when one is configured', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { status: 'ok' } });

  await writeCatalog(env({ VERCEL_TEAM_ID: 'team_xyz' }), products, fetchImpl);

  assert.ok(fetchImpl.calls[0].url.includes('teamId=team_xyz'));
});

test('writeCatalog reports success', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { status: 'ok' } });

  assert.equal((await writeCatalog(env(), products, fetchImpl)).ok, true);
});

// The promised specific message: a token that expired should not read as a
// generic outage.
test('writeCatalog names an expired or revoked token on 401', async () => {
  const fetchImpl = stubFetch({ status: 401, body: { error: { code: 'forbidden' } } });

  const result = await writeCatalog(env(), products, fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-api-token');
});

test('writeCatalog names a scope problem on 403', async () => {
  const fetchImpl = stubFetch({ status: 403, body: { error: { code: 'forbidden' } } });

  const result = await writeCatalog(env(), products, fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-api-token');
});

test('writeCatalog surfaces any other upstream failure', async () => {
  const fetchImpl = stubFetch({ status: 500, body: { error: { message: 'boom' } } });

  const result = await writeCatalog(env(), products, fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test('writeCatalog refuses without an API token and never calls out', async () => {
  const fetchImpl = stubFetch({ status: 200, body: { status: 'ok' } });

  const result = await writeCatalog(env({ VERCEL_API_TOKEN: undefined }), products, fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-api-token');
  assert.equal(fetchImpl.calls.length, 0);
});

test('writeCatalog surfaces a network error rather than throwing', async () => {
  const result = await writeCatalog(env(), products, stubFetch({ throws: true }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
});

// The first real write failure returned a message that named no cause, which
// left the only diagnosis in a log I could not reach. Whatever Vercel says
// about OUR configuration is safe to repeat and is the fastest way to a fix.

test('writeCatalog reports the upstream status code', async () => {
  const fetchImpl = stubFetch({ status: 400, body: { error: { code: 'bad_request', message: 'Invalid key' } } });

  const result = await writeCatalog(env(), products, fetchImpl);

  assert.equal(result.status, 400);
});

test('writeCatalog carries the upstream message through', async () => {
  const fetchImpl = stubFetch({ status: 400, body: { error: { code: 'bad_request', message: 'Invalid key' } } });

  const result = await writeCatalog(env(), products, fetchImpl);

  assert.equal(result.detail, 'Invalid key');
});

test('writeCatalog falls back to the upstream code when there is no message', async () => {
  const fetchImpl = stubFetch({ status: 422, body: { error: { code: 'size_exceeded' } } });

  assert.equal((await writeCatalog(env(), products, fetchImpl)).detail, 'size_exceeded');
});

test('writeCatalog reports a detail on a refused token too', async () => {
  const fetchImpl = stubFetch({ status: 403, body: { error: { code: 'forbidden', message: 'Not authorized' } } });

  const result = await writeCatalog(env(), products, fetchImpl);

  assert.equal(result.reason, 'bad-api-token');
  assert.equal(result.detail, 'Not authorized');
});

test('writeCatalog survives an error body that is not JSON', async () => {
  const fetchImpl = stubFetch({ status: 502, body: undefined });

  const result = await writeCatalog(env(), products, fetchImpl);

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
});
