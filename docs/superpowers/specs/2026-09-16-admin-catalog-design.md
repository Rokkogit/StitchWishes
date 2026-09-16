# Stitch Wishess — Admin Catalog

## Summary

Turn the empty `/admin` shell into a working catalog manager. Edits go live in
about ten seconds **without a deploy**, which is the requirement that drives
every decision here.

Modelled on the MotherlyCreations admin, but deliberately not a port of it.

## Why not a port

The source was examined in detail. It cannot be copied:

- `commerce-admin.js` requires `_lib/gift-cards` and `_lib/commerce-codes`.
  Neither exists on disk or in git history, so the module throws at import.
- `@neondatabase/serverless` is imported but is in neither `package.json` nor
  `node_modules`.
- `admin.html` calls `/api/upload-image` and `/api/order-intents`; neither
  endpoint exists.
- Gift cards, promos, Stripe checkout, Sheets sync and AI social posts have no
  counterpart in a fifteen-piece catalog with no cart.

Its authentication is also weaker than what this repo already ships: the PIN
lives in `localStorage` in plaintext, travels on every request, is compared
with `!==`, and its four-hour expiry is enforced **only in the browser** —
`requireAdmin` never checks it, so the PIN is valid forever. None of that is
carried over.

What is worth taking is the shape of the feature set, and the idea that a
static site can persist edits without a database.

## Storage: Global Config

| | |
| --- | --- |
| Catalog size | 18.7 KB (8.2 KB gzipped) |
| Store limit | 1 MB — the catalog uses 1.9% |
| Reads | sub-millisecond, replicated to every region |
| Write propagation | up to 10 seconds globally |
| Backups | 7 days, automatic, restorable |
| Cost | free on Hobby |

Vercel's stated use case is "data that is read often but changes rarely",
which describes a product catalog exactly. Postgres would be overkill for
18.7 KB; Blob is for files and is the right answer for image uploads later.

### No npm dependency

The `@vercel/global-config` SDK is ergonomics only. Reading with plain `fetch`
against `https://global-config.vercel.com/<id>/items` carries the same
optimisations — the docs attribute the "hundreds of milliseconds faster" gain
to that endpoint, not the package. Reads via `api.vercel.com` do **not** get
them and are not used.

Writes have no SDK path at all: `PATCH https://api.vercel.com/v1/global-config
/<id>/items` with a Vercel access token.

So the repo keeps its no-dependency, no-build-step property.

### No GitHub write on save

An earlier draft dual-wrote each save to GitHub as a durable record. That is
dropped: a commit triggers a rebuild, which is the exact cost this design
exists to remove. Global Config's own 7-day backups cover undo, and the
committed `products.js` remains the fallback copy.

A manual "export to repo" action may be added later. It must never be
automatic.

## Architecture

```
lib/
  catalog.mjs        validate, normalise, derive health   (pure, tested)
  global-config.mjs  read + write the store               (tested via stub fetch)
  session.mjs        unchanged
api/
  catalog.mjs        GET  public, CDN-cached, no auth
  admin-catalog.mjs  GET  full catalog + assets + digest  (auth)
                     POST validate, write, return digest  (auth)
stitch-wishes-2050/
  admin.js           gate + shell + view routing
  admin-catalog.js   the editor
  main.js            fetch catalog, fall back to bundled products.js
```

Every `admin-*` route calls `verifyToken` first, honouring the constraint set
in the gate spec: the panel's HTML is public, so only verified operations
protect anything.

## Data flow

```
admin edits          draft in localStorage, nothing sent
    │ Save
    ▼
POST /api/admin-catalog ── verify cookie
                        ── validate every field
                        ── compare digest  ──▶ 409 if the store moved
                        ── PATCH Global Config
    │
    ▼
propagates globally (~10s)
    │
storefront ──▶ GET /api/catalog  (s-maxage=10, stale-while-revalidate)
                        │ unreachable?
                        └──▶ bundled products.js
```

### Conflict detection

Global Config issues a digest that changes on every write. The editor receives
the digest it loaded; the save sends it back; the endpoint re-reads the current
digest and refuses with `409` if they differ. Two tabs cannot silently clobber
each other — the failure mode the MotherlyCreations version has.

## Catalog shape

`products` is one key in the store. Each product gains two fields the
generated file lacks:

| Field | Notes |
| --- | --- |
| `handle` | unique, `^[a-z0-9-]+$`, immutable once created |
| `title` | 1–200 chars |
| `price` | finite, >= 0, or null |
| `description` | 0–4000 chars |
| `images` | array of `assets/...` paths, order is display order, `[0]` is primary |
| `hidden` | **new** — excluded from the storefront without deletion |
| `position` | **new** — manual ordering; falls back to alphabetical |

## Validation

The endpoint trusts nothing from the browser. Rejections are per-field and
reported together, not one at a time:

- `handle` matches the pattern, is unique, and is not reassigned
- `price` is a finite number >= 0 or null; strings are coerced then checked
- `title` and `description` within length caps, control characters stripped
- **every image path must resolve inside `assets/`** — no absolute URLs, no
  `..`, no protocol. This file is executed by every visitor; an unchecked path
  is script injection.
- total serialised size stays under 900 KB, leaving headroom below the 1 MB
  store limit

## Interface: the admin mirrors the site

The editor is not a data table. It is the storefront with editing affordances
laid over it, so that what is being edited looks like what it will become:

```
  SITE                            ADMIN
  /collection  grid of cards  ->  the same grid, plus an "Add a piece" card
       | click                         | click
  /product     photo + info   ->  the same layout, fields editable in place
```

This reuses the storefront's own `.card`, `.grid` and `.detail` components
rather than introducing a second visual language for the same objects, and it
removes the translation step between a spreadsheet row and a product page.

**Catalog view** — every piece as a card, exactly as `/collection` draws it.
Hidden pieces stay in the grid, dimmed and marked, because a piece you cannot
see is a piece you will forget to restore. A dashed "Add a piece" card sits at
the end of the grid. A filter row narrows to pieces needing a photo, needing a
price, or hidden.

**Piece view** — the product page layout with the fields live: title, price and
description are inputs styled as the type they will become. The gallery carries
an "Add photo" button opening a picker over all 64 assets; photos can be
reordered, made primary, or removed.

**Dashboard** — piece count, pieces missing a photograph, a price, or carrying
a thin description; unused images; store size against the 1 MB ceiling.

**Drafts** — edits accumulate in `localStorage` with an unsaved marker; discard
restores the last saved state. Nothing reaches the server until Save.

**Re-seed** — restore from the committed `products.js`, for when an edit goes
wrong and the backup window has passed.

### Deliberately not built

A data table, and bulk select / hide / delete. Both are in the
MotherlyCreations original and both were considered and dropped: for fifteen
pieces a grid is easier to read than a table, and bulk actions are a power
feature that adds selection state to every card for an operation this catalog
will not need.

## Storefront changes

`main.js` fetches `/api/catalog` on load and renders from it. If the request
fails it uses the bundled `window.STITCH_PRODUCTS`, so the site never shows an
empty catalog. Hidden pieces are filtered out. A piece reached directly by
handle while hidden renders the existing not-found state.

## Error handling

| Condition | Behaviour |
| --- | --- |
| Store not configured | `503`; admin says so; storefront uses the bundle |
| Digest mismatch | `409`; editor keeps the draft and offers reload |
| Validation failure | `400` listing every offending field |
| Size over budget | `400` naming the overage before anything is written |
| Write rejected upstream | `502`; draft preserved; nothing partially applied |
| Catalog fetch fails | storefront falls back to the bundle, silently |

## Testing

`node --test "tests/*.test.mjs"`, still no framework and no dependencies.

`lib/catalog.mjs` is pure and fully covered: each validation rule, handle
collision, handle immutability, path traversal in images, size budget,
hidden-filtering, health derivation, alphabetical fallback ordering.

`lib/global-config.mjs` is tested against a stub `fetch` — the only mock, and
unavoidable without calling the real API: read parses items, write builds the
correct PATCH body, digest mismatch is detected, upstream failure surfaces
rather than being swallowed.

Endpoints are driven with real `Request` objects as the gate's tests already
do, including the auth check on every admin route.

## Configuration

Existing: `ADMIN_CODE`, `ADMIN_SESSION_SECRET`.

New:

| Name | Purpose |
| --- | --- |
| `GLOBAL_CONFIG` | Connection string; Vercel adds it when the store is connected. Read id and token are parsed from it. |
| `VERCEL_API_TOKEN` | Writes. Vercel account settings → Tokens. |

## Out of scope

- Image upload — Vercel Blob, a later phase
- Site copy — the text is hardcoded in HTML and needs extracting first
- Traffic analytics — needs a collection endpoint and its own storage
- Cart, checkout, orders, gift cards, promos — no commerce in this site
- Google Sheets sync — explicitly dropped
- AI social post generation — MotherlyCreations-specific
