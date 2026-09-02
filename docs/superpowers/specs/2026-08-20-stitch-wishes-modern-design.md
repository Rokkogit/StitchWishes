# Stitch Wishess — Modern Minimal Craft Redesign

## Summary

A fresh, standalone static redesign of the Stitch Wishess storefront
(`stitch-wishess.myshopify.com`). Built as its own project root at
`D:\StitchWishes\`, separate from the original `TwistedSisters` project on
C:, which holds the existing concept folders (`stitch-wishes/`,
`stitch-wishes-live-clone/`, `stitch-wishes-shopify-polished/`) untouched for
comparison. The source catalog (`stitch-products.json`) has been copied into
`D:\StitchWishes\` as the input to the data pipeline below.

Direction: modern minimal craft — clean whitespace, restrained color accents,
confident typography, editorial product photography. No moving backgrounds,
no floating hero imagery, no stickers/badges.

Scope: full static site — home, collection, product, about — using the real
Stitch Wishess catalog (`stitch-products.json`, 15 products, live Shopify CDN
images).

## Folder Structure

New top-level folder: `stitch-wishes-modern/`

```
stitch-wishes-modern/
  index.html          — homepage
  collection.html     — all-products grid
  product.html         — single product template (?handle=... driven)
  about.html           — brand story
  styles.css           — shared design system
  products.js          — generated data module (trimmed catalog)
  main.js              — rendering logic (cards, product detail, nav)
  README.md
```

Static HTML/CSS/JS, no build tooling — matches the rest of the repo's
conventions. `product.html` is a single template that reads a `handle` query
parameter and looks itself up in `products.js`, so all 15 products render
from one file rather than 15 hand-authored pages.

## Visual Design System

**Palette** — modern minimal, but keeping a visible thread back to the brand
so it still reads as Stitch Wishess rather than a generic template:

- Background: near-white (`#FAFAF8`)
- Header/footer/dark accents: deep starlit-navy (`#12142B`)
- One confident accent color, used sparingly (links, buttons, price
  highlights): a clear aqua/periwinkle (~`#5B7FFF`)
- Neutral grays for body text and borders
- No gradients, no moving/animated backgrounds

**Typography** — a strong serif or high-contrast display face for headings
(supports the "personal imagination architect" brand storytelling), paired
with a clean neutral sans for body/UI text. Generous line-height and
whitespace; a larger type scale than the existing concepts so typography
carries the premium feel instead of decorative elements.

**Shared components:**

- Nav: logo left, minimal text links (Shop / About), cart icon right, no
  background clutter
- Product card: square-ish product photo, title, price, subtle hover
  (image crossfade or slight scale) — no stickers or badges
- Buttons: solid navy or outline style, sharp/minimal corners, no drop
  shadows
- Footer: three-column minimal layout — shop links, brand story blurb,
  contact/social

## Pages

### Home (`index.html`)
- Full-width hero: one strong product/lifestyle image + headline + short
  brand tagline + CTA to Shop
- Featured row: 3–4 curated product cards
- Brand story teaser: 2–3 sentences + "Read more" link to About
- Footer

### Collection (`collection.html`)
- Page header (title + short line)
- Grid of all 15 products as cards (image, title, price), each linking to
  `product.html?handle=<handle>`
- No filters/search in v1 (YAGNI — can be added later if needed)

### Product (`product.html`)
- Single template driven by `?handle=` query param, resolved against
  `products.js`
- Large product image, title, price, description, "Add to Cart" button
  (non-functional stub — no cart/checkout backend exists in this repo yet,
  consistent with the root README's stated next steps)
- "You might also like": 3 other products from the catalog
- If the `handle` param doesn't match any product, show a simple
  "product not found" message

### About (`about.html`)
- Brand story (adapted from the existing "Abi's story" content referenced in
  `stitch-wishes-shopify-polished/README.md`)
- Full-bleed image, simple single-column layout

## Data Pipeline

A one-time generation step reads `stitch-products.json` and writes
`stitch-wishes-modern/products.js` as a plain JS array
(`window.STITCH_PRODUCTS = [...]`), trimmed to what the UI needs per product:

- `handle`
- `title`
- `price` (from the first/default variant)
- `image` (first image's `src`, used directly as the remote Shopify CDN URL
  — no local image download)
- `description` (from `body_html`, stripped of HTML tags for card/teaser
  use; a lightly-cleaned version retained for the product detail page)

This is a static generated file committed to the repo, not a build step —
regenerating it if the source catalog changes is a manual re-run.

## Error Handling

Minimal by design, appropriate for a static concept site:

- Broken product image: browser falls back to alt text
- Unknown `handle` on `product.html`: render a "product not found" message
  instead of a blank/broken page
- No form validation needed — there is no real cart/checkout in this version

## Verification

No build step, so verification is manual:

1. Serve `stitch-wishes-modern/` locally (matching the
   `http://127.0.0.1:4173/...` convention used by the other concept folders)
2. Visually check Home, Collection, a Product page, and About in a browser
3. Check both desktop and mobile widths
4. Confirm all 15 products resolve correctly on `product.html`

## Out of Scope

- Cart/checkout functionality
- Shopify Storefront API integration
- Search/filtering on the collection page
- Downloading/hosting product images locally (CDN URLs used directly)
