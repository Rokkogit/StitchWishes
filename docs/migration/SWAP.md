# Moving to the new accounts

Everything tied to the old GitHub account and the old Vercel project, and what
has to happen to each. Written while doing the GitHub half, so the Vercel half
is a checklist rather than a memory.

The live site at the time of writing is `stitch-wishes.vercel.app`, built from
`Rokkogit/StitchWishes`, and it keeps building from there until Vercel is
pointed somewhere else. **Pushing to the new repo deploys nothing.** The site
does not break, it simply stops changing — which is the failure mode worth
worrying about, because it looks like success.

## Done

- **Git remote.** `origin` → `StitchWishes/StitchWishes`. The old repo is kept
  as the `rokkogit` remote rather than deleted; it is still what the live site
  builds from.
- **Credential routing for this repo.** `credential.username = StitchWishes`,
  set locally. This was necessary: the machine's generic `github.com` credential
  resolves to **MotherlyCreations**, so without pinning, a push here could
  authenticate as the wrong account. That is how a deploy got blocked before.
- **History.** All commits pushed to the new repo. Both remotes hold the same
  tip.
- **The stale link in the admin panel.** The Catalog tab printed
  `stitch-wishes.vercel.app/product?handle=…` under every piece — wrong host
  *and* the old URL scheme that `/p/<handle>` replaced. It reads the host off
  the browser now, so it cannot go stale again.
- **A snapshot of the live catalog**, in `live-catalog-snapshot.json` next to
  this file.

## The catalog: nothing to migrate

The live Global Config store was compared against the catalog bundled in the
repo — every product, price, photograph, design, design name, choice and stock
value. **They are identical.** So a brand-new, empty Global Config store on the
new Vercel loses nothing: the first admin save seeds it from the bundled copy,
exactly as it did the first time.

The snapshot is there so this claim can be re-checked rather than trusted.

Checkout settings are the same story: nothing was ever saved, so shipping is
coming from the `$6` fallback in code, not from the store.

## Uploaded photographs: nothing to migrate

All 104 photographs in the catalog are bundled in the repo under `assets/`.
**Zero have been uploaded through the admin panel**, so the old Blob store holds
nothing. A new one starts empty and correct.

## Environment variables to recreate

None of these carry over. Every one has to be created again on the new project,
ticked for **Production, Preview and Development**.

| Variable | Account-scoped? | Where the new value comes from |
|---|---|---|
| `ADMIN_CODE` | No | Choose it. **12 characters minimum** — that floor is load-bearing, see the README. |
| `ADMIN_SESSION_SECRET` | No | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. A fresh one signs everyone out, which is what you want on a move. |
| `GLOBAL_CONFIG` | **Yes** | Added automatically when you connect a new Global Config store. |
| `VERCEL_API_TOKEN` | **Yes** | New account → Settings → Tokens. Needs **Full Account** scope. |
| `BLOB_READ_WRITE_TOKEN` | **Yes** | Added automatically when you create a Blob store. Only needed for photo uploads. |
| `VERCEL_TEAM_ID` | **Yes** | Only if the new project lives under a team. |
| `RESEND_API_KEY` | No | Carries over if you keep the same Resend account. |
| `ORDER_EMAIL_TO` / `ORDER_EMAIL_FROM` | No | Optional; defaults to `stitch.wishess@gmail.com`. |
| `STRIPE_SECRET_KEY` | No | Carries over if you keep the same Stripe account. |
| `STRIPE_WEBHOOK_SECRET` | No | **Changes even if Stripe does not** — see below. |

## Stripe

Stripe holds the orders, not Vercel, so **order history is unaffected** by the
Vercel move and follows the Stripe account instead.

One thing must change regardless: **the webhook endpoint URL**. It currently
points at the old host. Stripe → Developers → Webhooks → either edit the
existing endpoint or add one at:

```
https://<new-host>/api/stripe-webhook
```

subscribed to `checkout.session.completed`. Adding a new endpoint issues a **new
signing secret**, so `STRIPE_WEBHOOK_SECRET` has to be updated to match. Get
this wrong and checkout still works, payments still succeed, and no order email
ever arrives — a silent failure, which is why the webhook logs
`PAID BUT NOT EMAILED`.

Nothing else Stripe-facing is hardcoded: the success and cancel URLs are built
from the request's own host.

## Changing the site's own address

Eleven files name the origin, because a static `.html` has nowhere to read its
own host from and an Open Graph image must be absolute. One command:

```bash
node scripts/set-site-origin.mjs https://new-host.vercel.app
```

It leaves the hosts that are supposed to be named alone — Google Fonts,
Instagram, Stripe, schema.org. `tests/pages.test.mjs` fails if the pages ever
disagree about the origin, so a half-finished swap is caught.

The dynamic routes need no change: `/p/<handle>`, `/sitemap.xml` and
`/robots.txt` all read the host off the request. That was deliberate.

## Still pointing at the old accounts

- **Commit identity** is `TheJackieD <Sticksgaming5000@gmail.com>`, which is
  neither of the new accounts. Left alone deliberately — see the warning below.
- **The `rokkogit` remote**, kept on purpose until Vercel has moved.
- **The machine's generic `github.com` credential** still resolves to
  MotherlyCreations. Only this repo is pinned. Any other repo that does not pin
  a username can still authenticate as the wrong account.

## The private-repo trap, which has already happened once

The new repo is **private**. The error from last time was:

> The deployment was blocked because the commit author did not have contributing
> access to the project on Vercel. The Hobby Plan does not support collaboration
> for private repositories.

That is a private repo, plus a commit author Vercel does not recognise. It was
fixed by making the repo public. Both halves are back: the new repo is private,
and commits are authored by an account that owns neither.

So before expecting a deploy, do one of:

- make the new repo public, or
- set the commit identity to the account that owns the new Vercel project, or
- accept that deploys need the commit author to have project access.

## Order of operations

1. Create the Vercel project from `StitchWishes/StitchWishes`.
2. Connect a Global Config store and a Blob store.
3. Create the API token, then add every variable in the table above.
4. Deploy once. Expect it to fail or serve a bare catalog until the variables
   are in — they only apply to **new** deployments.
5. Run `set-site-origin.mjs` with the real host, commit, push.
6. Repoint the Stripe webhook and update `STRIPE_WEBHOOK_SECRET`.
7. Check `/api/catalog`, `/sitemap.xml`, `/robots.txt` and a `/p/<handle>` page
   on the new host.
8. Sign in to `/admin`, press **Save** once to seed the store, then set shipping
   and press **Send me a test order**.
9. Only then retire the `rokkogit` remote and the old project.
