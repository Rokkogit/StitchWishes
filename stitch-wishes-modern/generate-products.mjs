// One-time generator: stitch-products.json -> products.js
// Run with: node generate-products.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const raw = JSON.parse(readFileSync('../stitch-products.json', 'utf-8'));

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Prefer the copy already downloaded into assets/ so the build keeps working
// offline. Falls back to the Shopify CDN only when this build has no local
// file for that image, which is what keeps a re-run from breaking the page.
function resolveImage(src) {
  if (!src) return null;
  const local = `assets/${basename(new URL(src).pathname)}`;
  return existsSync(local) ? local : src;
}

const products = raw.products.map((p) => {
  const variant = p.variants?.[0];
  return {
    handle: p.handle,
    title: p.title,
    price: variant ? Number(variant.price) : null,
    image: resolveImage(p.images?.[0]?.src),
    description: stripHtml(p.body_html ?? ''),
  };
});

// The live collection renders with Shopify's "Alphabetically, A-Z" sort,
// so mirror that here instead of keeping the API's own order.
products.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

const out = `// Generated from stitch-products.json by generate-products.mjs
// Do not hand-edit — re-run the generator if the source catalog changes.
// Order matches the live store: Shopify "Alphabetically, A-Z" by title.
window.STITCH_PRODUCTS = ${JSON.stringify(products, null, 2)};
`;

writeFileSync('products.js', out, 'utf-8');

const local = products.filter((p) => p.image?.startsWith('assets/')).length;
const remote = products.filter((p) => p.image?.startsWith('http')).length;
console.log(
  `Wrote products.js with ${products.length} products ` +
    `(${local} local images, ${remote} remote, ${products.length - local - remote} without).`
);
