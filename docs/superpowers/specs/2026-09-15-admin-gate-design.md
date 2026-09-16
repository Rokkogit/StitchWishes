# Stitch Wishess — `/admin` Authentication Gate

## Summary

Add a password-gated `/admin` route to the `stitch-wishes-2050` build, backed
by the repo's first server-side code. A visitor to `/admin` sees a passphrase
screen; a correct passphrase is verified **on the server** against an
environment variable and exchanged for a signed, HttpOnly session cookie.

Scope is the **gate only**. What lives behind it is deliberately deferred to a
later design round; this spec ships an authenticated shell as its placeholder.

## Why server-side

A passphrase checked in browser JavaScript is not a lock — the value ships to
every visitor and can be read in DevTools. Verifying on the server means the
passphrase never leaves Vercel. This was chosen explicitly over a client-side
check and over Google Sign-In.

## The security boundary (binding constraint)

**`/admin`'s HTML is public.** Anyone can download `admin.html` and see the
login screen. This is normal and not a defect.

What the gate actually protects is *operations*. The cookie is only meaningful
if every admin action is performed by an API route that verifies it. Therefore:

> Every future admin panel operation that reads or writes data MUST go through
> an `api/` route that calls `verifyToken`. A panel that does its work purely
> in the browser reduces this authentication to decoration.

This constrains the next design round and is the main reason the panel was
deferred rather than guessed at.

## Architecture

```
StitchWishes/                     project root
├─ api/                           ROUTES ONLY — every file here is deployed
│   ├─ admin-login.mjs            POST { code }  -> Set-Cookie
│   ├─ admin-logout.mjs           POST           -> clear cookie
│   └─ admin-session.mjs          GET            -> { authed }
├─ lib/                           imported by api/, never routed
│   ├─ session.mjs                all session logic
│   └─ http.mjs                   response shaping
├─ tests/                         node --test, excluded from deploys
├─ vercel.json                    + "cleanUrls": true
├─ .vercelignore                  tests, docs
├─ .gitignore                     + .env, .env*.local
└─ stitch-wishes-2050/
    ├─ admin.html                 login screen + panel shell
    ├─ admin.js                   client state machine
    └─ admin.css                  reuses styles.css tokens
```

`api/` sits at the project root, not inside `stitch-wishes-2050/`.
`outputDirectory` governs only what is served *statically*; the two coexist
without restructuring.

**Shared code lives in `lib/`, not `api/`.** Every file in `api/` becomes a
deployed route — an underscore prefix does **not** exempt it, only a leading
dot does. Left in `api/`, the session module and the tests would each become a
broken endpoint. Vercel traces imports (via `@vercel/nft`), so a module in
`lib/` is bundled into every function that imports it while staying unreachable
over HTTP. `.vercelignore` must not list `lib/` for the same reason — it
excludes files from the upload entirely, which would break those imports.

Files use the `.mjs` extension so they are ES modules **without** a
`package.json`. The repo's "no build step, no dependencies" property is
preserved — the backend adds zero packages and uses only Node built-ins.

## Module: `lib/session.mjs`

The single source of truth for sessions. The three endpoints hold no crypto.

| Export | Purpose |
| --- | --- |
| `readConfig(env)` | Validate `ADMIN_CODE` / `ADMIN_SESSION_SECRET`; fail closed |
| `checkCode(provided, expected)` | Timing-safe passphrase comparison |
| `createToken(secret, ttlMs)` | Mint a signed session token |
| `verifyToken(secret, token)` | Verify signature and expiry |
| `sessionCookie(token, maxAgeSec)` | Build the `Set-Cookie` header |
| `clearCookie()` | Build the expiring `Set-Cookie` header |
| `readCookie(header, name)` | Parse one cookie out of a `Cookie` header |

### Token format

```
base64url({"exp":<ms epoch>}) . base64url(HMAC-SHA256(payload, secret))
```

Stateless by necessity — there is no database. The signature is what makes it
unforgeable; altering `exp` invalidates it.

### Comparison strategy

- **Passphrase** — attacker-controlled and variable length, so both sides are
  SHA-256'd to a fixed 32 bytes before `timingSafeEqual`. Comparing raw
  strings would leak length and prefix timing.
- **Signature** — the expected digest is always 32 bytes; a length mismatch is
  rejected up front, then `timingSafeEqual`.

### Fail-closed rules

`readConfig` returns a failure — never a permissive default — when:

- `ADMIN_SESSION_SECRET` is missing or empty
- `ADMIN_CODE` is missing or empty
- `ADMIN_CODE` is shorter than **12 characters**

Endpoints translate failure to `503` and log the reason server-side. The
response body never states which variable is wrong.

### On the 12-character minimum

Serverless instances do not share memory, so per-instance attempt counters are
not real rate limiting. **Passphrase length is the actual control.** 12+
characters puts brute force out of reach and is what lets this ship without a
shared store (Vercel KV / Upstash). A flat ~250 ms delay is applied to every
login attempt as defense-in-depth, not as the primary control.

Shortening the minimum later is not a config tweak — it requires adding a
rate-limiting store first.

## Endpoints

| Route | Method | Success | Failure |
| --- | --- | --- | --- |
| `/api/admin-login` | POST | `200` + `Set-Cookie` | `401` wrong code · `400` malformed · `503` unconfigured · `405` wrong method |
| `/api/admin-logout` | POST | `200` + expiring cookie | `405` |
| `/api/admin-session` | GET | `200 { authed }` | `405` |

`admin-session` returns `{ authed: false }` rather than `401` — "am I signed
in?" is a legitimate question for a signed-out visitor to ask.

### Cookie

```
sw_admin=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800
```

- `HttpOnly` — page JavaScript cannot read it, so an XSS bug cannot exfiltrate
  the session
- `SameSite=Strict` — not sent on cross-site requests, blocking CSRF
- `Secure` — HTTPS only
- 7-day lifetime

## Client (`admin.js`)

A three-state machine. It never holds the passphrase and cannot read the
cookie; session state is known only by asking the server.

```
checking ──GET /api/admin-session──> authed ──> panel
    └─────────────────────────────> anon   ──> login form
                                                 │ POST /api/admin-login
                                                 ├─ 200 -> panel
                                                 ├─ 401 -> "Incorrect code"
                                                 ├─ 503 -> "Not configured"
                                                 └─ network -> "vercel dev?"
```

Initial paint is the neutral `checking` state, so a signed-in admin never sees
the login form flash before the panel appears.

## Error handling

| Condition | Behavior |
| --- | --- |
| Wrong passphrase | `401`; form clears; message shown; no lockout |
| Env vars unset | `503`; message names the configuration, not the variable |
| Expired/tampered cookie | Treated as signed out; cookie cleared |
| Functions unreachable locally | Message naming `vercel dev` as the likely cause |
| Malformed JSON body | `400` |

## Testing

No test framework exists in this repo, and none is added — Node 24 ships
`node --test`. Run with `node --test "tests/*.test.mjs"`; the quoted glob
matters, because passing a bare directory fails on Windows.

`lib/session.mjs` is pure and fully unit-tested:

- round-trip: minted token verifies
- tampered payload rejected
- tampered signature rejected
- token signed with a different secret rejected
- expired token rejected
- malformed/garbage token rejected without throwing
- correct passphrase accepted; incorrect rejected
- passphrase differing only in length rejected
- `readConfig` fails on missing secret, missing code, and an 11-char code
- `readConfig` succeeds on a 12-char code
- cookie parsing handles absent, single, and multiple cookies

The endpoints are tested too, by driving the real handlers with real `Request`
objects — Node 24 has `Request`/`Response` as globals, so this needs no server
and no mocks:

- correct code returns 200 and a cookie carrying every security flag
- wrong code returns 401 and sets no cookie
- a cookie minted by a real login is accepted by the session endpoint
- expired, foreign-signed, and garbage cookies all read as signed out
- the cookie logout sets is not a valid session
- wrong methods return 405; malformed and code-less bodies return 400
- a too-short or missing `ADMIN_CODE` returns 503 and sets no cookie
- no response body ever contains the passphrase, the secret, or the
  configuration failure reason

Only the browser UI is verified by hand.

## Configuration

Two Vercel environment variables, set for Production, Preview and Development:

| Name | Value |
| --- | --- |
| `ADMIN_CODE` | The passphrase, 12+ characters |
| `ADMIN_SESSION_SECRET` | 64 hex chars from `randomBytes(32)` |

Rotating `ADMIN_SESSION_SECRET` invalidates every existing session — that is
the "sign everyone out" control.

Env var changes apply only to *new* deployments; a redeploy is required.

`.gitignore` gains `.env` and `.env*.local` before any local env file exists.

## Local development

- Storefront: unchanged, `python -m http.server 4173` still works
- `/admin`: requires `vercel dev` (`npm i -g vercel`, then `vercel link`),
  because static file serving cannot execute functions

The 2050 README's "Runs fully offline" claim becomes true of the storefront but
not `/admin`, and is corrected.

## Out of scope

- The contents of the admin panel — its own design round
- Multiple admin users, roles, password reset, account recovery
- Rate limiting with a shared store
- Editing the catalog, uploading images, or any write path
