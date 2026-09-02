# Stitch Wishess — "Holo-Craft"

A redesign concept for `stitch-wishess.myshopify.com`, alongside
`../stitch-wishes-modern/`.

Direction: **pastel futurism**. The future as imagined by someone who works in
iridescent beads, thread and resin — luminous and soft rather than
chrome-and-neon. Every colour is sampled directly from the studio's own
artwork, so the palette matches the original storefront rather than
approximating it.

## Palette

Sampled from `assets/stitch-witch-portrait.png` and `assets/sky-texture.png`:

| Token | Hex | Source |
| --- | --- | --- |
| `--aurora` | `#8fd4e6` | dominant sky cyan |
| `--periwinkle` | `#9cc2e6` | sky blue |
| `--mint` | `#aee2d2` | sky mint |
| `--lilac` | `#e4cce4` | medallion interior |
| `--blossom` | `#f0c0e4` | medallion interior |
| `--peach` | `#fcd8cc` | medallion interior |
| `--ink` | `#0d2a31` | deep teal, from the live theme |

`--holo-ink` is the same iridescence pitched dark enough to read as type.

## Background

The page sits on the studio's own painted sky (`assets/sky-texture.png`,
originally `IMG_4083.png`) — fixed, cover, slowly drifting. A 46% paper-toned
veil sits over it so body copy stays readable across the more saturated bands.

## Type

- **Unbounded** — display
- **Manrope** — body
- **DM Mono** — labels, prices, specs

## Signature element

The **thread**: a dashed stitch line down the left rail that sews itself in as
you scroll, with a bead at each section anchor. It mirrors how the beaded pens
are actually made — beads strung on a strand — so the rail doubles as a map of
the page rather than decoration. Hidden below 720px.

## Preview

Serve the parent folder and open:

`http://127.0.0.1:4173/stitch-wishes-2050/`

## Pages

- `index.html` — hero medallion, featured pieces, the maker, materials
- `collection.html` — full catalog
- `product.html?handle=<handle>` — single piece
- `about.html` — Abi's story

## Assets

**All images are local.** `assets/` holds 62 images pulled from the Shopify CDN
while it was still serving. The storefront itself is deactivated ("This store is
currently unavailable"), so the CDN is no longer a safe dependency — nothing
here hotlinks it. Images were fetched at `width=1600`, not full resolution.

`products.js` is generated from `../stitch-products.json` by
`generate-products.mjs`, then rewritten to point at `assets/`. Re-running the
generator will restore the CDN URLs, so repoint them afterwards.

## Out of scope

No cart or checkout, no Storefront API, no search or filtering — this is a
static visual concept.
