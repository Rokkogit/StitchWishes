# Putting the site on a Namecheap domain

Two halves, and they are independent. DNS points the name at Vercel. Then the
code has to be told what it is now called, because a static page cannot read its
own host.

Doing only the first half leaves a site that loads on the new domain while every
canonical link and every link-preview image still points at
`*.vercel.app` — which looks completely fine in a browser and is wrong
everywhere it matters.

Throughout, `example.com` stands for the domain that was actually bought.

---

## 1. Add the domain in Vercel first

Vercel → the project → **Settings → Domains** → enter `example.com` → **Add**.

Add it **before** touching Namecheap. Vercel then shows the exact records to
create, and those are what to copy.

When asked, take the option that makes `example.com` the primary and redirects
`www.example.com` to it. Either direction works; what matters is picking one, so
the two never index as separate sites.

### Use the values Vercel shows you

Vercel's published general-purpose values are an A record of `76.76.21.21` and a
CNAME of `cname.vercel-dns.com`, **but a project can be assigned different
ones.** The domain card in the dashboard shows what yours needs. Copy from
there rather than from any guide, including this one.

---

## 2. Namecheap

**Domain List → Manage → Advanced DNS.**

### First: check the nameservers

On the **Domain** tab, under *Nameservers*, it must say **Namecheap BasicDNS**.
If it says Custom DNS or anything else, records added on the Advanced DNS tab
are ignored and nothing will work. Set it to Namecheap BasicDNS.

### Second: delete what Namecheap put there

A new Namecheap domain ships with parking records that will fight the real ones:

- a **CNAME** for host `www` pointing at `parkingpage.namecheap.com`
- a **URL Redirect** record for host `@`

Delete both. Leaving either in place is the single most common reason this
setup appears to half-work.

### Third: add the records

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `@` | the IP Vercel shows | Automatic |
| CNAME Record | `www` | the CNAME Vercel shows | Automatic |

`@` means the bare domain. Namecheap fills in the rest.

### Fourth: remove anything that conflicts

- **Any AAAA record on the apex.** Vercel does not support IPv6 for domains on
  third-party DNS; an AAAA splits traffic and can stall the SSL certificate
  indefinitely.
- **CAA records, if any exist.** They restrict who may issue certificates. Either
  delete them or add one permitting `letsencrypt.org`, or the certificate will
  never be issued.
- Any other A or CNAME on `@` or `www`. Only one of each may exist.

Do not touch MX or TXT records. Those are email and verification, and nothing
here needs them changed.

---

## 3. Wait, then check

Back in Vercel → Settings → Domains, the entry goes from **Invalid
Configuration** to **Valid**, and a certificate is issued automatically. Usually
minutes; Namecheap can take up to a few hours.

Nothing further is needed for HTTPS. Vercel provisions and renews the
certificate itself.

---

## 4. Tell the code its new name

This is the half that is easy to forget, and invisible when skipped.

```bash
node scripts/set-site-origin.mjs https://example.com
npm test
git commit -am "Move the site to example.com"
git push
```

That rewrites the canonical link, the Open Graph tags and the structured data
across every static page, and leaves the hosts that are meant to be named
alone — Google Fonts, Instagram, Stripe, schema.org.

`tests/pages.test.mjs` fails if the pages disagree about the origin, so a
half-finished swap is caught before it ships.

The dynamic routes need no change at all. `/p/<handle>`, `/sitemap.xml` and
`/robots.txt` read the host off each request, so they start answering as the new
domain the moment DNS resolves. That was the point of building them that way.

---

## 5. Stripe

**Developers → Webhooks.** The endpoint still points at the old host. Either
edit it to:

```
https://example.com/api/stripe-webhook
```

or add a new one for `checkout.session.completed`.

**Adding a new endpoint issues a new signing secret,** so `STRIPE_WEBHOOK_SECRET`
must be updated to match and the project redeployed. Get this wrong and checkout
still works, payments still succeed, and no order email ever arrives — the
webhook logs `PAID BUT NOT EMAILED` and nothing else tells you.

Nothing else Stripe-facing needs changing: the success and cancel URLs are built
from the request's own host.

While there, **Settings → Business**: the public business name and the statement
descriptor. A charge nobody recognises on a card statement is one of the most
common causes of a chargeback.

---

## 6. Order email gets better, and it is worth doing

Owning a domain removes the restriction the shop has been living with.

Resend's shared sender delivers **only to the address its account was opened
with**, which is why order email only ever worked to one inbox. Verify the domain
in Resend — **Domains → Add Domain**, then add the DNS records it gives you in
Namecheap the same way as above — and that limit disappears.

Then set `ORDER_EMAIL_FROM` to something like:

```
Stitch Wishess <orders@example.com>
```

Orders can then be sent to any address, and they arrive from the shop's own
domain rather than a shared one, which lands in far fewer spam folders.

---

## 7. Search

The site has been live on a `vercel.app` address. Once the domain is primary:

- **Google Search Console** → add `example.com` as a property → submit
  `https://example.com/sitemap.xml`.
- Keep the Vercel address redirecting to the domain rather than deleting it, so
  anything already indexed or shared in a DM follows through.

`/robots.txt` names the sitemap on whatever host it is asked on, so it is already
correct.

---

## Order of operations

1. Add the domain in Vercel.
2. Namecheap: BasicDNS, delete the parking records, add A and CNAME, remove AAAA
   and CAA.
3. Wait for **Valid** and the certificate.
4. Run `set-site-origin.mjs`, test, commit, push.
5. Repoint the Stripe webhook and update the signing secret.
6. Verify the domain in Resend and set `ORDER_EMAIL_FROM`.
7. Submit the sitemap.

## Checking it afterwards

```bash
curl -sI https://example.com | head -1                 # 200
curl -s https://example.com/robots.txt                 # names the new sitemap
curl -s https://example.com/sitemap.xml | grep -c loc  # 20
curl -s https://example.com/ | grep -o 'og:url[^>]*'   # the new domain
curl -sI http://example.com | head -1                  # redirects to https
curl -sI https://www.example.com | head -1             # redirects to apex
```
