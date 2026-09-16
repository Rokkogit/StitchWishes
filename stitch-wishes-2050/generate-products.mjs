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

// Every photo the catalog lists, not just the first — products carry up to 11
// and the site was showing one.
//
// Anything without a local copy is dropped rather than falling back to the
// Shopify CDN: that store is deactivated, so a CDN URL is a guaranteed broken
// image. Two photos are lost that way and cannot be recovered.
function resolveImages(images) {
  return (images ?? [])
    .map((image) => `assets/${basename(new URL(image.src).pathname)}`)
    .filter((path) => existsSync(path));
}

const products = raw.products.map((p) => {
  const variant = p.variants?.[0];
  return {
    handle: p.handle,
    title: p.title,
    price: variant ? Number(variant.price) : null,
    images: resolveImages(p.images),
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

const photos = products.reduce((total, p) => total + p.images.length, 0);
const without = products.filter((p) => p.images.length === 0).length;
console.log(
  `Wrote products.js with ${products.length} products and ${photos} photos ` +
    `(${without} product${without === 1 ? '' : 's'} with no photograph).`
);
