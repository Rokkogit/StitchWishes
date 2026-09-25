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

Then visit <http://127.0.0.1:4173>. No build step. The storefront falls back
to its bundled catalog when it cannot reach the live one, so it works served
this way — but /admin needs `vercel dev`, because static file serving cannot
run functions.

## The catalog pipeline

`stitch-products.json` is the source of truth — a dump of the store's
catalog (15 products). Each build regenerates its own product list from it:

```bash
cd stitch-wishes-2050
node generate-products.mjs   # -> products.js
```

Two things the generator handles:

- **Image resolution.** Each product gets an `images` array holding *every*
  photograph the catalog lists for it, not just the first — several products
  carry ten. Anything without a local copy in `assets/` is dropped rather
  than falling back to the Shopify CDN, because that store is deactivated and
  a CDN URL is now a guaranteed broken image.

  The two builds' generators have diverged as a result: `stitch-wishes-2050/`
  emits `images` arrays from local files, while `stitch-wishes-modern/` still
  emits a single CDN `image` per product. Only the 2050 generator is
  maintained.
- **Ordering.** Products are sorted alphabetically by title, which is what
  the live store's collection page uses ("Alphabetically, A-Z"), so the
  catalog order matches it.

`products.js` is generated — edit `stitch-products.json` and re-run the
generator rather than hand-editing it.

## The admin

`/admin` is a passphrase-gated panel for editing the catalog. **Edits go live
in about ten seconds without a deploy.**

One dependency, `@vercel/blob`, is used by the photo upload endpoint. Vercel
installs it; the static site still has no build step. Everything else uses Node
built-ins only.

```
api/admin-login.mjs    POST { code }   -> sets the session cookie
api/admin-logout.mjs   POST            -> clears it
api/admin-session.mjs  GET             -> { authed }
api/admin-catalog.mjs  GET  editor state · POST validated write
api/admin-upload.mjs   POST a photo    -> stores it, returns a URL
api/catalog.mjs        GET  public, CDN-cached, hidden pieces filtered

lib/session.mjs        sign + verify sessions, compare the passphrase
lib/catalog.mjs        validate, order, derive health
lib/global-config.mjs  read + write the catalog store
lib/upload.mjs         what may be uploaded
lib/http.mjs           response shaping
lib/assets-manifest.mjs  generated list of assets/, for the picker

tests/                 node --test
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

### Where the catalog lives

`products.js` still ships with the site, but it is no longer what the
storefront reads. The live catalog is one key in a **Vercel Global Config**
store, which the admin writes and `/api/catalog` serves.

```
admin save ──PATCH──▶ Global Config ──▶ propagates in ~10s
                            │
storefront ──▶ /api/catalog ┘   falls back to the bundled products.js
                                 if the store is unreachable or unseeded
```

The bundled copy is the fallback and the seed for an empty store, so the shop
never renders blank. Global Config keeps 7 days of restorable backups.

The first write to a store creates the key; Vercel answers `upsert` on a
key that has never existed with `404 Edge Config Item not found`, so the
write retries once as `create`.

### What it does and does not protect

The passphrase is checked on the server and never reaches the browser. But
`/admin`'s HTML is a public file — anyone can load the login screen, and that
is fine. What the cookie protects is *actions*.

**So: every admin operation must go through an `api/` route that verifies the
session.** A panel that did its work purely in the browser would reduce this to
decoration.

Image paths are validated server-side against two shapes and nothing else: a
single filename under `assets/`, or a URL on your own
`*.public.blob.vercel-storage.com` host. The catalog is serialised into
something every visitor executes, so an unchecked path there is script
injection rather than a broken image.

### Photographs

Uploads are resized to 1600px and re-encoded as JPEG **in the browser**,
before being sent. That is what makes uploading from a phone work: a raw
photograph is 3–12 MB and Vercel caps a request body at 4.5 MB. It also
converts HEIC to JPEG on the way through, which is why two photographs from
the original Shopify catalog are missing — nothing could display them.

### Setup

Environment variables, in the Vercel dashboard under
**Settings → Environment Variables**, ticked for Production, Preview and
Development:

| Name | What it is | Where it comes from |
|---|---|---|
| `ADMIN_CODE` | The passphrase you type. **12 characters minimum** | You choose it |
| `ADMIN_SESSION_SECRET` | Signs session cookies. 64 random hex chars | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GLOBAL_CONFIG` | Connection string for the catalog store | Added automatically when you connect a Global Config store |
| `VERCEL_API_TOKEN` | Writes to the store. Needs **Full Account** scope | Account Settings → Tokens |
| `BLOB_READ_WRITE_TOKEN` | Stores uploaded photographs | Added automatically when you create a Blob store |
| `VERCEL_TEAM_ID` | Only if the store belongs to a team | Team Settings → General |
| `RESEND_API_KEY` | Emails each order to the shop | resend.com → API Keys |
| `ORDER_EMAIL_TO` | Optional. Where orders go. Defaults to `stitch.wishess@gmail.com` | You choose it |
| `ORDER_EMAIL_FROM` | Optional. Defaults to Resend's shared address | Only needed once a domain is verified |

Five things worth knowing:

- Environment variable changes apply only to *new* deployments. Change a value
  and the live site keeps using the old one until you redeploy.
- Rotating `ADMIN_SESSION_SECRET` invalidates every existing session. That is
  the "sign everyone out" button.
- `VERCEL_API_TOKEN` expires. When it does, saving fails with a message that
  says so rather than a generic error — but it is worth a calendar reminder.
- Order email needs no domain bought and no DNS records set, but only because
  of a restriction that happens to suit this shop: Resend's shared
  `onboarding@resend.dev` sender can deliver **only to the address the Resend
  account was opened with**. So that account must be opened with
  `stitch.wishess@gmail.com`, and orders must go to the same address. Customer
  receipts are Stripe's job and go out over Stripe's own domain, so the limit
  never reaches a customer. Sending to anyone else needs a verified domain.
- Nothing about email can fail an order. Every send reports failure by
  returning it, and `sendOrderEmail` logs and swallows the result, so a paid
  order is never rejected because a mail provider was having a bad afternoon.
  The cost of that choice is that a silent failure is possible — which is
  what the **Send me a test order** button in the Checkout tab is for.

The 12-character floor on `ADMIN_CODE` is load-bearing. Serverless instances do
not share memory, so per-instance attempt counters are not real rate limiting —
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
npm test
```

194 tests on Node's built-in runner, no test framework. Keep the glob quoted;
passing a bare directory (`node --test tests/`) fails on Windows.

`tests/real-catalog.test.mjs` validates the actual `products.js` on every run.
It exists because a validation rule once rejected four live handles for
containing underscores, which would have locked the shop out of its own admin.

## Notes

- One product (`Stitch Witch Signature Car Coasters`) has no photograph in
  the source catalog, so it renders a "photograph coming soon" placeholder.
  That matches the live store, where it also has no image.
