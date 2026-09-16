# Stitch Wishess

Static storefront redesigns for the Stitch Wishess studio — handmade and
made-to-order blue-alien keepsakes: beaded pens, painted canvases, keychains,
signs and decals.

Two independent static builds share one catalog:

| Build | Images | Notes |
|---|---|---|
| `stitch-wishes-2050/` | local `assets/` | Holo-craft concept. Storefront runs fully offline. **This is the current build.** |
| `stitch-wishes-modern/` | Shopify CDN | Earlier modern-minimal draft. Needs an internet connection. |

There is also a password-gated `/admin` route, which is the one part of the
site that is not static — see [The admin gate](#the-admin-gate) below.

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

## The admin gate

`/admin` is a passphrase-gated screen. It is the only part of this repo with
server-side code — three Vercel Functions in `api/`, which use Node built-ins
only. No packages, no build step.

```
api/admin-login.mjs   POST { code }  -> sets the session cookie
api/admin-logout.mjs  POST           -> clears it
api/admin-session.mjs GET            -> { authed }
lib/session.mjs       sign + verify sessions, compare the passphrase
lib/http.mjs          shared response shaping
tests/                node --test
```

Two layout rules worth not relearning the hard way:

- `api/` must sit at the repo root, not inside a build folder.
  `outputDirectory` in `vercel.json` controls only what is served
  *statically*, so the two coexist.
- **Everything in `api/` is deployed as a route.** An underscore prefix does
  not exempt a file; only a leading dot does. Shared code therefore lives in
  `lib/`, which Vercel bundles into each function that imports it by tracing
  the imports. Never add `lib/` to `.vercelignore` — that excludes it from the
  upload and breaks those imports.

### What it does and does not protect

The passphrase is checked on the server and never reaches the browser. But
`/admin`'s HTML is a public file — anyone can load the login screen, and that
is fine. What the cookie protects is *actions*.

**So: every admin operation added later must go through an `api/` route that
verifies the session.** A panel that does its work purely in the browser would
reduce this to decoration.

### Setup

Two environment variables, in the Vercel dashboard under
**Settings → Environment Variables**, ticked for Production, Preview and
Development:

| Name | Value |
|---|---|
| `ADMIN_CODE` | The passphrase. **12 characters minimum** — logins are refused below that. |
| `ADMIN_SESSION_SECRET` | 64 random hex characters (see below) |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Two things worth knowing:

- Environment variable changes apply only to *new* deployments. Change a value
  and the live site keeps using the old one until you redeploy.
- Rotating `ADMIN_SESSION_SECRET` invalidates every existing session. That is
  the "sign everyone out" button.

The 12-character floor is load-bearing. Serverless instances do not share
memory, so per-instance attempt counters are not real rate limiting —
passphrase length is what actually stops brute force. Lowering it means adding
a shared rate-limit store first.

### Running it locally

The storefront is unchanged and still works under any static server. `/admin`
does not, because static file serving cannot execute functions:

```bash
npm i -g vercel
vercel link
vercel dev
```

`vercel dev` loads the Development environment variables automatically. The
session cookie is marked `Secure`, which is fine locally — browsers treat
`localhost` and `127.0.0.1` as trustworthy origins.

Without `vercel dev` the page loads and says so rather than failing silently.

### Tests

```bash
node --test "tests/*.test.mjs"
```

55 tests, no framework and no dependencies — Node's built-in runner. Keep the
glob quoted; passing a bare directory (`node --test tests/`) fails on Windows.

## Notes

- One product (`Stitch Witch Signature Car Coasters`) has no photograph in
  the source catalog, so it renders a "photograph coming soon" placeholder.
  That matches the live store, where it also has no image.
