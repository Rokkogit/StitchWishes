// robots.txt and sitemap.xml.
//
// Both are functions rather than static files so they can reflect the live
// catalog and whatever host the request arrived on. They share one function for
// the same reason the admin auth routes do: a Hobby deployment allows twelve,
// and these are two of the smallest.

import { readCatalog } from './global-config.mjs';
import { visibleProducts } from './catalog.mjs';
import { SEED } from './catalog-seed.mjs';
import { sitemapXml } from './page-meta.mjs';

// An hour. A crawler does not come back within ten seconds, and there is no
// reason to run a function for every polite robot on the internet.
const CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

export function originOf(request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (host) return `${proto}://${host}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

// The sitemap line carries the request's own host. Written as a static file this
// would have to name a domain, and it would keep naming stitch-wishes.vercel.app
// after a real one was bought — pointing every crawler at the wrong sitemap,
// silently, with nothing to notice.
export function robotsBody(origin) {
  // /admin is already noindex in its own markup; saying so here keeps it out of
  // the crawl entirely rather than relying on a robot reading the page first.
  // /api is disallowed because none of it is content — a crawler spending its
  // budget on JSON endpoints is budget not spent on pieces.
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
}

const text = (body, type) =>
  new Response(body, {
    headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': CACHE },
  });

export async function robots(request) {
  return text(robotsBody(originOf(request)), 'text/plain');
}

export async function sitemap(request) {
  const result = await readCatalog(process.env);

  // The bundled copy rather than an empty sitemap. Submitting one that lists
  // nothing is a way to tell a crawler the shop has no products.
  const products =
    result.ok && result.seeded ? visibleProducts(result.products) : visibleProducts(SEED);

  return text(sitemapXml(products, originOf(request)), 'application/xml');
}

export function documentFor(request) {
  const url = new URL(request.url, 'https://placeholder.invalid');

  const asked = url.searchParams.get('doc');
  if (asked) return asked;

  return /robots/.test(url.pathname) ? 'robots' : 'sitemap';
}

export async function handle(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Use GET.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  return documentFor(request) === 'robots' ? robots(request) : sitemap(request);
}
