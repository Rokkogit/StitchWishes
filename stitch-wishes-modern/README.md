# Stitch Wishess — Modern Minimal Craft Redesign

A fresh, standalone static concept for `https://stitch-wishess.myshopify.com/`.
Direction: modern minimal craft — clean whitespace, restrained color accents,
confident typography, editorial product photography.

## Preview

Open `index.html` directly, or serve the folder locally:

`http://127.0.0.1:4173/stitch-wishes-modern/`

## Pages

- `index.html` — home (hero, featured products, story teaser)
- `collection.html` — all products
- `product.html?handle=<handle>` — single product template
- `about.html` — brand story

## Data

`products.js` is generated from the sibling `../stitch-products.json` catalog
by `generate-products.mjs`. Re-run it if the source catalog changes:

```
node generate-products.mjs
```

Product images are used directly from the live Shopify CDN — nothing is
downloaded locally.

## Out of Scope

No cart/checkout, no Storefront API integration, no search/filtering — this
is a static visual concept.
