// GET /robots.txt
//
// A function rather than a committed file so the sitemap line carries whatever
// host the request arrived on. Written as a static file it would have to name a
// domain, and it would keep naming stitch-wishes.vercel.app after a real domain
// was bought — pointing every crawler at the wrong sitemap, silently, with
// nothing to notice.

const CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

function originOf(request) {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (host) return `${proto}://${host}`;

  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Use GET.', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    // /admin is already noindex in its own markup; saying so here as well keeps
    // it out of the crawl entirely rather than relying on a robot reading the
    // page first. /api is disallowed because none of it is content — a crawler
    // spending its budget on JSON endpoints is budget not spent on pieces.
    const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${originOf(request)}/sitemap.xml
`;

    return new Response(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': CACHE,
      },
    });
  },
};
