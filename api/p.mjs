// GET /p/<handle> -> the product page, with its own title, its own preview
// card and its own structured data.
//
// Reached through a rewrite in vercel.json rather than at /api/p, so the
// address people share is /p/beaded-pen and not a query string.
//
// Rendered per request rather than generated at deploy time, because the
// catalog is edited in the admin panel and never redeployed. A page built at
// deploy time would start lying the first time a price changed, which is
// exactly the thing the Global Config store was added to avoid.

import { readCatalog } from '../lib/global-config.mjs';
import { shopCatalog } from '../lib/pricing.mjs';
import { SEED } from '../lib/catalog-seed.mjs';
import { productHead, productBody, escapeHtml, SITE_NAME } from '../lib/page-meta.mjs';
import { injectHead, injectDetail, injectBase } from '../lib/render.mjs';

// Ten seconds, matching /api/catalog. Global Config takes up to ten seconds to
// propagate a write, so caching for ten costs no freshness anyone can perceive
// and removes nearly every invocation. The body a visitor ends up looking at is
// redrawn by main.js from a live catalog read regardless; what is cached here is
// what the preview bots and crawlers see.
const CACHE = 'public, s-maxage=10, stale-while-revalidate=59';

// The static shell changes only when the site is deployed, and a deployment
// means a new instance, so holding it for the life of the instance cannot serve
// a stale one.
let shellCache = null;

// Exists so tests can exercise the shell-unavailable path after another test has
// already cached a good shell. Nothing in the running site should call it: the
// cache is correct for the life of an instance.
export function clearShellCache() {
  shellCache = null;
}

function originOf(request) {
  // Behind Vercel's proxy the forwarded headers are the public address;
  // request.url is the internal one. Getting this wrong would put an unreachable
  // host into every og:image, which is the difference between a preview card
  // with a photograph and one with an empty grey box.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (host) return `${proto}://${host}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

function handleOf(request) {
  const url = new URL(request.url, 'https://placeholder.invalid');

  // The rewrite passes it as a query parameter; the path form is the fallback
  // for a direct hit on the function, and for local development where the
  // rewrite is not in play.
  const fromQuery = url.searchParams.get('handle');
  if (fromQuery) return fromQuery;

  const match = url.pathname.match(/\/p\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function shell(origin, fetchImpl) {
  if (shellCache) return shellCache;

  const response = await fetchImpl(`${origin}/product`, {
    headers: { 'User-Agent': 'stitch-wishes-renderer' },
  });

  if (!response.ok) throw new Error(`shell ${response.status}`);

  const html = await response.text();
  shellCache = injectBase(html, '/');

  return shellCache;
}

// Used when the shell cannot be fetched. It is worth having: a product URL that
// returns a page with correct preview tags is still doing the job this route
// exists for, even with none of the styling.
function barePage(product, origin) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${productHead(product, origin)}
</head>
<body>
  <main>${productBody(product, origin)}</main>
  <p><a href="/collection">See everything in the catalog</a></p>
</body>
</html>
`;
}

function notFound(origin) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Not found — ${escapeHtml(SITE_NAME)}</title>
  <!-- A URL that resolves to nothing must not be indexed, or a sold piece
       leaves a dead result in search for months. -->
  <meta name="robots" content="noindex">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="wrap">
    <div class="not-found">
      <p class="label">Not found</p>
      <h1>That piece isn't in the catalog</h1>
      <p>It may have sold, or the link may be out of date.</p>
      <a class="btn btn-primary" href="/collection">Back to the catalog</a>
    </div>
  </main>
</body>
</html>
`;
}

const html = (status, body, cache) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cache,
    },
  });

// Exported separately from the route so a test can supply its own fetch. The
// platform may pass a second argument to fetch(), so an injectable parameter
// there would silently be overwritten by whatever it passes.
export async function render(request, fetchImpl = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Use GET.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const origin = originOf(request);
  const handle = handleOf(request);

  if (!handle) return html(404, notFound(origin), 'no-store');

  const result = await readCatalog(process.env);

  // The bundled catalog rather than an error page. A crawler that gets a 503
  // may drop the URL; a visitor who gets one leaves. The shipped copy is old
  // at worst, and this route's whole job is that the URL always answers.
  // Priced the way the site shows it, so the preview card and the structured
  // data a search engine reads carry the same number as the page.
  const products = shopCatalog(
    result.ok && result.seeded ? result.products : SEED,
    SEED,
    result.settings
  );

  const product = products.find((piece) => piece?.handle === handle);

  // Followed an old address? Send them to the new one rather than to a 404.
  // 301 so a search engine moves its record across and a browser remembers,
  // because this is a permanent move rather than a temporary detour.
  if (!product) {
    const renamed = products.find(
      (piece) => piece?.hidden !== true && (piece?.previousHandles ?? []).includes(handle)
    );

    if (renamed) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: `${origin}/p/${encodeURIComponent(renamed.handle)}`,
          'Cache-Control': 'public, s-maxage=60',
        },
      });
    }
  }

  // A hidden piece is treated as missing. It is not for sale, and serving it
  // with full markup would advertise something nobody can buy.
  if (!product || product.hidden === true) {
    return html(404, notFound(origin), 'public, s-maxage=10');
  }

  let page;
  try {
    page = injectDetail(
      injectHead(await shell(origin, fetchImpl), productHead(product, origin)),
      productBody(product, origin)
    );
  } catch (error) {
    console.error(`[p] could not load the page shell: ${error?.message}`);
    page = barePage(product, origin);
  }

  return html(200, page, CACHE);
}

export default {
  fetch: (request) => render(request, fetch),
};
