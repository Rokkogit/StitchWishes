// What a machine sees when it looks at a page.
//
// Three different machines, wanting three different things:
//
//   - A link-preview bot (Instagram, iMessage, WhatsApp, Slack) reads Open
//     Graph tags out of <head> and runs no JavaScript at all. This is the one
//     that matters most here, because this shop's customers arrive from a DM.
//   - A search crawler reads the title, the description and JSON-LD.
//   - A person with JavaScript off, or on a slow connection before it loads,
//     reads whatever HTML actually arrived.
//
// None of the three were served anything: every product URL returned the same
// <title>Piece</title> with no product in the body.
//
// Everything here is pure and takes the origin as an argument rather than
// reading it from anywhere, because Open Graph images must be absolute URLs and
// the correct absolute URL differs between a preview deployment and the live
// site.

export const SITE_NAME = 'Stitch Wishess';

// Open Graph descriptions are truncated by every consumer at a different
// length. 160 is the figure that survives intact nearly everywhere and is also
// about what a search result shows.
const DESCRIPTION_MAX = 160;
const TITLE_MAX = 70;

/* ---------------------------------------------------------------- escaping */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// XML has no &quot; problem in text nodes but does need the other three, and a
// sitemap carrying a raw ampersand is a sitemap a crawler rejects outright.
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clean(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cut on a word boundary. A description that ends mid-word reads like a bug,
// and the ellipsis is what tells a reader there is more rather than that the
// sentence simply stopped.
export function truncate(value, max) {
  const text = clean(value);
  if (text.length <= max) return text;

  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');

  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}\u2026`;
}

/* -------------------------------------------------------------------- urls */

// A bundled photograph is stored as "assets/name.jpg" and an uploaded one as a
// full Blob URL, so both shapes have to come out absolute.
export function absoluteUrl(origin, path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const base = String(origin ?? '').replace(/\/+$/, '');
  return `${base}/${String(path).replace(/^\/+/, '')}`;
}

// The shareable address of a piece. One canonical URL per product, which is the
// whole point: product.html?handle=x served every piece from a single URL, so
// there was nothing for a crawler to index separately or a person to send.
export const productPath = (handle) => `/p/${encodeURIComponent(handle)}`;

/* ------------------------------------------------------------------ prices */

const dollars = (value) => (Math.round(Number(value) * 100) / 100).toFixed(2);

// A piece with designs can carry a different price per design, so the honest
// answer is sometimes a range rather than a number.
export function priceRange(product) {
  const options = product?.designs?.options ?? [];
  const base = Number(product?.price);

  const prices = (
    options.length
      ? options.map((option) => Number(option?.price ?? product?.price))
      : [base]
  ).filter((value) => Number.isFinite(value) && value >= 0);

  if (!prices.length) return null;

  return { low: Math.min(...prices), high: Math.max(...prices) };
}

// Made to order is the normal case here, and stock of null means exactly that:
// there is no ceiling, so it can be bought. Only an explicit zero is sold out.
export function availability(product) {
  const options = product?.designs?.options ?? [];

  if (options.length) {
    const anyAvailable = options.some(
      (option) => (option?.stock ?? product?.stock ?? null) !== 0
    );
    return anyAvailable ? 'InStock' : 'OutOfStock';
  }

  return (product?.stock ?? null) === 0 ? 'OutOfStock' : 'InStock';
}

/* -------------------------------------------------------------------- meta */

export function productMeta(product, origin) {
  const title = truncate(product?.title, TITLE_MAX - SITE_NAME.length - 3);
  const range = priceRange(product);

  // The price goes in the description because a preview card shows a title and
  // a line of text and nothing else. Someone deciding whether to tap should not
  // have to in order to find out what it costs.
  const price = range
    ? range.low === range.high
      ? `$${dollars(range.low)}. `
      : `From $${dollars(range.low)}. `
    : '';

  const images = [
    ...(product?.images ?? []),
    ...(product?.designs?.options ?? []).map((option) => option?.image),
  ]
    .filter(Boolean)
    .map((path) => absoluteUrl(origin, path));

  return {
    title: `${title} \u2014 ${SITE_NAME}`,
    description: truncate(`${price}${clean(product?.description)}`, DESCRIPTION_MAX),
    canonical: `${String(origin ?? '').replace(/\/+$/, '')}${productPath(product?.handle ?? '')}`,
    // Deduplicated: a design photograph is often also the first catalog image,
    // and repeating it tells a crawler nothing it did not already know.
    images: [...new Set(images)],
    range,
    availability: availability(product),
  };
}

export function productJsonLd(product, origin) {
  const meta = productMeta(product, origin);
  const range = meta.range;

  const offer = range
    ? range.low === range.high
      ? {
          '@type': 'Offer',
          price: dollars(range.low),
          priceCurrency: 'USD',
          availability: `https://schema.org/${meta.availability}`,
          url: meta.canonical,
          itemCondition: 'https://schema.org/NewCondition',
        }
      : {
          // A range has to be declared as a range. Publishing the low price as
          // if it were the price is the kind of mismatch between markup and
          // page that gets structured data ignored entirely.
          '@type': 'AggregateOffer',
          lowPrice: dollars(range.low),
          highPrice: dollars(range.high),
          priceCurrency: 'USD',
          offerCount: product?.designs?.options?.length ?? 1,
          availability: `https://schema.org/${meta.availability}`,
          url: meta.canonical,
        }
    : null;

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: clean(product?.title),
    description: clean(product?.description),
    // The handle is the shop's own identifier for the piece, and it is stable.
    sku: product?.handle,
    brand: { '@type': 'Brand', name: SITE_NAME },
    url: meta.canonical,
  };

  if (meta.images.length) data.image = meta.images.slice(0, 8);
  if (offer) data.offers = offer;

  return data;
}

// Serialised so it cannot break out of the script element. A description
// containing </script> would otherwise end the block early and spill the rest
// of the JSON onto the page as text.
export const jsonLdScript = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/* -------------------------------------------------------------------- head */

export function productHead(product, origin) {
  const meta = productMeta(product, origin);
  const image = meta.images[0];
  const range = meta.range;

  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}">`,

    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}">`,
  ];

  if (image) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(image)}">`,
      `<meta property="og:image:alt" content="${escapeHtml(truncate(product?.title, 100))}">`,
      // summary_large_image rather than summary: these are photographs of
      // handmade things, and the photograph is the reason anyone taps.
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:image" content="${escapeHtml(image)}">`
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary">`);
  }

  tags.push(
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`
  );

  if (range) {
    tags.push(
      `<meta property="product:price:amount" content="${escapeHtml(dollars(range.low))}">`,
      `<meta property="product:price:currency" content="USD">`,
      `<meta property="product:availability" content="${
        meta.availability === 'InStock' ? 'in stock' : 'out of stock'
      }">`
    );
  }

  tags.push(jsonLdScript(productJsonLd(product, origin)));

  return tags.join('\n  ');
}

/* -------------------------------------------------------------------- body */

// A readable version of the piece in the HTML itself, for a crawler that does
// not run scripts and for the moment before they load. main.js replaces this
// container wholesale when it starts, so this is a floor rather than a second
// renderer to keep in step with the first.
export function productBody(product, origin) {
  const meta = productMeta(product, origin);
  const range = meta.range;
  const image = meta.images[0];

  const price = range
    ? range.low === range.high
      ? `$${dollars(range.low)}`
      : `From $${dollars(range.low)}`
    : '';

  const designCount = product?.designs?.options?.length ?? 0;

  // These are the classes the stylesheet actually defines and the ones main.js
  // produces, so the pre-script view is styled rather than a pile of unstyled
  // text that flashes into place.
  return `<div class="gallery">
        ${
          image
            ? `<div class="detail__media"><img src="${escapeHtml(image)}" alt="${escapeHtml(clean(product?.title))}"></div>`
            : ''
        }
      </div>
      <div>
        <p class="label">${escapeHtml(SITE_NAME)}</p>
        <h1>${escapeHtml(clean(product?.title))}</h1>
        <p class="detail__price">${escapeHtml(price)}</p>
        <div class="detail__desc">
          <p>${escapeHtml(clean(product?.description))}</p>
          ${designCount ? `<p>${designCount} designs to choose from.</p>` : ''}
        </div>
        <noscript>
          <div class="detail__desc"><p>Turn on JavaScript to choose a design and
          add this to your bag, or message
          <a href="https://instagram.com/stitch.wishess">@stitch.wishess</a>.</p></div>
        </noscript>
      </div>`;
}

/* ----------------------------------------------------------------- sitemap */

// Built from the live catalog rather than written at deploy time, because the
// catalog is edited in the admin panel without a deploy. A sitemap generated at
// build time would start lying the first time a piece was added.
export function sitemapXml(products, origin, now = new Date()) {
  const base = String(origin ?? '').replace(/\/+$/, '');
  const stamp = now.toISOString().slice(0, 10);

  // Priorities are a hint and nothing more, but the ordering is still true:
  // the front page and the catalog are the ways in.
  const pages = [
    { path: '/', priority: '1.0', changefreq: 'weekly' },
    { path: '/collection', priority: '0.9', changefreq: 'weekly' },
    { path: '/about', priority: '0.5', changefreq: 'monthly' },
    { path: '/policies', priority: '0.4', changefreq: 'yearly' },
    { path: '/terms', priority: '0.3', changefreq: 'yearly' },
  ];

  const entries = pages.map(
    (page) => `  <url>
    <loc>${escapeXml(base + page.path)}</loc>
    <lastmod>${stamp}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
  );

  for (const product of Array.isArray(products) ? products : []) {
    // A hidden piece is not for sale, so inviting a crawler to index it would
    // advertise something nobody can buy.
    if (!product?.handle || product.hidden === true) continue;

    const image = (product.images ?? []).find(Boolean);

    entries.push(`  <url>
    <loc>${escapeXml(base + productPath(product.handle))}</loc>
    <lastmod>${stamp}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>${
      image
        ? `
    <image:image>
      <image:loc>${escapeXml(absoluteUrl(base, image))}</image:loc>
      <image:title>${escapeXml(clean(product.title))}</image:title>
    </image:image>`
        : ''
    }
  </url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>
`;
}
