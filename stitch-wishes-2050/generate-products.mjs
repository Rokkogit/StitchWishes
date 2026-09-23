// Generator: stitch-products.json -> products.js + ../lib/assets-manifest.mjs
// Run with: node generate-products.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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

const localPath = (src) => (src ? `assets/${basename(new URL(src).pathname)}` : null);

// Shopify calls an option axis "Options" with values "Option 1".."Option 10",
// which tells a customer nothing. What distinguishes them is the photograph
// attached to each variant, so designs are built from those.
//
// A design needs a photograph you can tell apart from the others. Two rules
// follow: a variant whose image was never downloaded is skipped, and a product
// whose variants all share one photograph gets no designs at all, because a
// row of identical pictures is worse than no picker.
function buildDesigns(product, basePrice) {
  const real = (product.options ?? []).filter(
    (o) => !(o.values.length === 1 && /default/i.test(o.values[0]))
  );
  if (!real.length) return { designs: null, choices: [], skipped: 0 };

  const seen = new Map();
  let skipped = 0;

  for (const variant of product.variants ?? []) {
    const key = variant.option1;
    if (!key || seen.has(key)) continue;

    const image = localPath(variant.featured_image?.src);
    if (!image || !existsSync(image)) {
      skipped += 1;
      continue;
    }

    seen.set(key, {
      image,
      // Only when it differs; otherwise the design inherits the piece price.
      price: Number(variant.price) === basePrice ? null : Number(variant.price),
    });
  }

  const unique = new Set([...seen.values()].map((v) => v.image));
  if (unique.size < 2) return { designs: null, choices: [], skipped };

  const designs = {
    label: 'Design',
    options: [...seen.values()].map((v, i) => ({
      id: `d${i + 1}`,
      // Neutral and obviously provisional. "Option 3" would look like a real
      // name; a blank would give the picker nothing to announce. Abi knows
      // what each one is and can rename them.
      name: `Design ${i + 1}`,
      image: v.image,
      price: v.price,
      stock: null,   // made to order until someone says otherwise
    })),
  };

  // A second axis is a plain list. Its values are real words here, unlike the
  // first axis, so they carry through as written.
  const choices = real.slice(1).map((axis, i) => ({
    id: `c${i + 1}`,
    label: axis.name,
    values: axis.values.map((label, j) => ({ id: `v${j + 1}`, label })),
  }));

  return { designs, choices, skipped };
}

const notes = [];

const products = raw.products.map((p) => {
  const variant = p.variants?.[0];
  const price = variant ? Number(variant.price) : null;
  const { designs, choices, skipped } = buildDesigns(p, price);

  if (skipped) notes.push(`${p.title.slice(0, 40)}: ${skipped} design(s) have no local photograph`);

  return {
    handle: p.handle,
    title: p.title,
    price,
    images: resolveImages(p.images),
    description: stripHtml(p.body_html ?? ''),
    ...(designs ? { designs } : {}),
    ...(choices.length ? { choices } : {}),
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

// The admin panel needs to know which images exist so it can offer them.
// A serverless function cannot read assets/ — Vercel bundles only what is
// imported — so the listing is emitted as a module the API can import, which
// the dependency tracer then pulls into the function.
const assets = readdirSync('assets')
  .filter((name) => /\.(jpe?g|png|webp|gif)$/i.test(name))
  .sort()
  .map((name) => `assets/${name}`);

// The same catalog as a module, so the API can read it too. products.js is a
// browser script that assigns to window and cannot be imported by a function,
// and the server needs this for two things: serving a real catalog when the
// store is unreachable, and filling in designs for a store written before
// designs existed.
writeFileSync(
  '../lib/catalog-seed.mjs',
  `// Generated by stitch-wishes-2050/generate-products.mjs — do not hand-edit.\n` +
    `// The catalog as it ships with the site: the fallback, and the seed.\n` +
    `export const SEED = ${JSON.stringify(products, null, 2)};\n`,
  'utf-8'
);

writeFileSync(
  '../lib/assets-manifest.mjs',
  `// Generated by stitch-wishes-2050/generate-products.mjs — do not hand-edit.\n` +
    `// Every image in stitch-wishes-2050/assets/, for the admin picker.\n` +
    `export const ASSETS = ${JSON.stringify(assets, null, 2)};\n`,
  'utf-8'
);

const photos = products.reduce((total, p) => total + p.images.length, 0);
const without = products.filter((p) => p.images.length === 0).length;
console.log(
  `Wrote products.js with ${products.length} products and ${photos} photos ` +
    `(${without} product${without === 1 ? '' : 's'} with no photograph).`
);
console.log(`Wrote ../lib/assets-manifest.mjs with ${assets.length} images.`);

const withDesigns = products.filter((p) => p.designs);
const designCount = withDesigns.reduce((n, p) => n + p.designs.options.length, 0);
const priced = withDesigns.reduce(
  (n, p) => n + p.designs.options.filter((d) => d.price != null).length,
  0
);

console.log(
  `${withDesigns.length} products carry ${designCount} designs ` +
    `(${priced} with their own price).`
);
for (const note of notes) console.log(`  note: ${note}`);
