# Stitch Wishess — Selling

## Summary

Let people buy pieces. Payment through Stripe Checkout, stock tracked so the
same one-of-a-kind piece cannot be sold twice, orders recorded and emailed.

Unlike everything built so far, a mistake here costs real money. A bad catalog
save is a reload away; a bad checkout means a customer is charged wrongly, or
paid for something that is already gone.

## Order of work

Each step is useful on its own and shippable before the next begins.

1. **Stock and the Checkout tab.** Quantities per piece, sold-out on the
   storefront, and the shipping and fees she will charge. Nothing takes money
   yet, so this step cannot cost anyone anything — and it is what the rest
   depends on.
2. **Buy one piece.** Stripe Checkout, webhook, stock decrement, order
   recorded, email sent. One real sale, end to end.
3. **Cart.** Several pieces in one order.
4. **Orders tab.** The fulfilment view in the admin.

## Two rules that are not negotiable

**Payment is confirmed by Stripe's webhook, never by the browser.** The
success redirect is a URL anyone can type. Only the signed webhook proves money
moved. Treating the redirect as proof is how a shop ships goods for free.

**Prices come from the server, never from the page.** The Checkout session is
built from the catalog held in the store, looked up by handle. If the browser
is allowed to say what something costs, eventually it will say one cent.

## Storage: no new system

Overselling is prevented with what is already here.

Global Config issues a digest that changes on every write, which is a
compare-and-swap. Stock is reserved **when the Checkout session is created**,
not when payment completes:

```
read catalog + digest
  piece in stock?  no  -> refuse, nothing charged
  yes -> write decremented stock, pinned to that digest
           conflict? -> someone else got there first, refuse
           written?  -> create the Stripe session
```

Two simultaneous buyers: the second write conflicts and is refused *before*
Stripe charges anyone. The propagation delay does not matter, because a stale
read produces a stale digest, and a stale digest is exactly what the
compare-and-swap rejects.

A session that is abandoned or expires releases its reservation, via Stripe's
`checkout.session.expired` webhook.

| Thing | Where |
| --- | --- |
| Stock per piece | the catalog, in Global Config |
| Orders | Vercel Blob, one JSON file each |
| Payment | Stripe |
| Email | Resend |

Orders go in Blob rather than Global Config because they grow without limit
and the store caps at 1 MB. One file per order also means two orders written at
the same moment cannot clobber each other.

## Catalog changes

Each piece gains one field:

| Field | Meaning |
| --- | --- |
| `stock` | `null` — made to order, no limit. A number — that many left. |

`null` is the default, so nothing about the existing catalog changes until a
quantity is set deliberately. A piece at `0` renders sold out and cannot be
bought; it stays visible, because a sold-out piece still shows what the studio
makes.

## Shipping and fees: a Checkout tab

A third tab in the admin, alongside Catalog and Homepage, holding everything
that affects what a customer is charged beyond the pieces themselves.

**Shipping.** One flat rate added to every order, with its own label so it can
read "Shipping" or "Postage & packing" as she prefers. Simple to build and
simple for a customer to understand; the difference on a heavy or distant
order is pennies for pens and keychains.

**Fees.** A list she can add to, edit, reorder and switch off — handling,
packaging, rush, whatever the shop needs later. Each carries a label and an
amount and appears as its own line at checkout, so a customer sees what they
are paying for rather than an inflated total.

Switching a fee off keeps it in the list rather than deleting it, because a
seasonal fee that comes back should not have to be retyped from memory.

Stored as a `settings` key in the same Global Config store as the catalog, so
it shares the digest, the conflict detection and the ten-second propagation
already built.

```json
{
  "shipping": { "label": "Shipping", "amount": 5.00, "enabled": true },
  "fees": [
    { "id": "...", "label": "Handling", "amount": 1.50, "enabled": true }
  ]
}
```

### Amounts are capped

Every amount is validated server-side as a finite number, at least zero, and
**no more than $500**. The cap is not bureaucracy: a fee is applied to every
order automatically, so a slipped decimal point does not produce a strange
total for one customer — it silently overcharges every customer until someone
notices. A limit turns a typo into a rejected save.

Totals are computed on the server from the stored settings, never from
anything the page sends, for the same reason prices are.

## Orders

Written by the webhook, never by the browser.

```json
{
  "id": "ord_...",
  "stripeSessionId": "cs_...",
  "placedAt": "2026-09-16T...",
  "items": [{ "handle": "...", "title": "...", "price": 0, "quantity": 1 }],
  "shipping": { "name": "...", "address": {}, "cost": 0 },
  "total": 0,
  "email": "...",
  "status": "paid"
}
```

Stored at `orders/<id>.json`. `status` moves to `shipped` from the admin.

## Email

Resend, free tier. One email to the studio per paid order, listing what sold
and where it goes. Sending failure is logged and does not fail the webhook —
the order is already recorded and paid, and Stripe retries a failed webhook,
which would double-send.

## Endpoints

| Route | Purpose |
| --- | --- |
| `api/checkout.mjs` | POST a handle -> reserve stock, create a Stripe session |
| `api/stripe-webhook.mjs` | Stripe -> verify signature, record order, email |
| `api/admin-orders.mjs` | GET the order list, POST a status change |

The webhook is the only route in the project that is public and trusted, and
it earns that with a signature check against `STRIPE_WEBHOOK_SECRET`. An
unverified webhook endpoint lets anyone declare an order paid.

## Error handling

| Condition | Behaviour |
| --- | --- |
| Piece sold out at session creation | 409, nothing charged, page says so |
| Digest conflict during reservation | 409, treated as sold out |
| Stripe unreachable | 502, reservation released |
| Webhook signature invalid | 400, nothing recorded |
| Webhook arrives twice | idempotent on session id — no double order |
| Email fails | logged, order still recorded, webhook still 200 |

## Testing

`node --test`. The pure parts are covered exhaustively: stock validation,
reservation arithmetic, order shaping, total calculation, webhook payload
parsing, idempotency.

Stripe and Resend are injected, as the Blob and Global Config calls already
are. The webhook signature check is tested against known-good and tampered
payloads.

Stripe's test mode is used for a real end-to-end run before any of this is
pointed at a live key.

## Configuration

Existing, plus:

| Name | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Creating Checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | Verifying that webhooks are really Stripe |
| `RESEND_API_KEY` | Sending the order email |
| `ORDER_EMAIL_TO` | Where order emails go |

Test keys until a real sale has been proven end to end.

## Out of scope

- Real-time carrier rates — every piece would need a weight
- Sales tax — worth revisiting with an accountant, not guessed at in code
- Discount codes, gift cards
- Customer accounts and order history
- Refunds from the admin: Stripe's dashboard does this well already
