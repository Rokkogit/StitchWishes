# Stitch Wishess

Static storefront redesigns for the Stitch Wishess studio — handmade and
made-to-order blue-alien keepsakes: beaded pens, painted canvases, keychains,
signs and decals.

Two independent static builds share one catalog:

| Build | Images | Notes |
|---|---|---|
| `stitch-wishes-2050/` | local `assets/` | Holo-craft concept. Runs fully offline. **This is the current build.** |
| `stitch-wishes-modern/` | Shopify CDN | Earlier modern-minimal draft. Needs an internet connection. |

## Running it

Either build is plain static HTML — serve the folder and open it:

```bash
cd stitch-wishes-2050
python -m http.server 4173 --bind 127.0.0.1
```

Then visit <http://127.0.0.1:4173>. No build step, no dependencies.

## The catalog pipeline

`stitch-products.json` is the source of truth — a dump of the store's
catalog (15 products). Each build regenerates its own product list from it:

```bash
cd stitch-wishes-2050
node generate-products.mjs   # -> products.js
```

Two things the generator handles:

- **Image resolution.** It prefers a copy already sitting in that build's
  `assets/` folder and falls back to the Shopify CDN only when there isn't
  one. That is what lets the same generator serve both builds correctly, and
  what keeps a re-run from quietly breaking the offline build.
- **Ordering.** Products are sorted alphabetically by title, which is what
  the live store's collection page uses ("Alphabetically, A-Z"), so the
  catalog order matches it.

`products.js` is generated — edit `stitch-products.json` and re-run the
generator rather than hand-editing it.

## Notes

- One product (`Stitch Witch Signature Car Coasters`) has no photograph in
  the source catalog, so it renders a "photograph coming soon" placeholder.
  That matches the live store, where it also has no image.
