// Everything somebody paid for, arriving on the Orders tab.
//
// This is the one path in the shop where being wrong costs money and goodwill
// at the same time: a parcel made from an incomplete packing list is the wrong
// parcel, and the customer finds out before Abi does.
//
// So it is tested end to end rather than in pieces - a cart goes in, a Stripe
// session is built from it exactly as the live route builds one, and the order
// is read back out of that session exactly as the Orders tab reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEED } from '../lib/catalog-seed.mjs';
import { readyCatalog } from '../lib/seed.mjs';
import { resolveCart } from '../lib/cart.mjs';
import { orderTotal, DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { checkedSessionParams } from '../lib/checkout.mjs';
import { toOrder, formatAddress, orderSummary } from '../lib/orders.mjs';
import { encodeCart, decodeCart } from '../lib/stripe.mjs';

const CATALOG = readyCatalog(SEED, SEED);

const SHIPPING = {
  name: 'Jane Doe',
  address: {
    line1: '12 Example Street',
    line2: 'Apt 4',
    city: 'Hot Springs',
    state: 'AR',
    postal_code: '71901',
    country: 'US',
  },
};

// A session shaped the way Stripe returns one to the Orders route, built from
// the parameters the checkout route would actually have sent.
function placeOrder(cart) {
  const { items, problems } = resolveCart(cart, CATALOG);
  assert.deepEqual(problems, [], 'the cart did not survive pricing');

  const totals = orderTotal(items, DEFAULT_SETTINGS);
  const checked = checkedSessionParams({
    items,
    totals,
    settings: DEFAULT_SETTINGS,
    origin: 'https://www.stitchwishess.com',
    reference: 'SW-260101-001',
  });

  assert.equal(checked.ok, true, checked.reason);

  return toOrder(
    {
      id: 'cs_live_1',
      metadata: checked.params.metadata,
      payment_status: 'paid',
      livemode: true,
      created: 1767225600,
      currency: 'usd',
      amount_subtotal: Math.round(totals.subtotal * 100),
      amount_total: Math.round(totals.total * 100),
      total_details: { amount_shipping: Math.round(totals.shipping * 100), amount_tax: 0 },
      payment_intent: { id: 'pi_live_1', metadata: {} },
      collected_information: { shipping_details: SHIPPING },
      customer_details: { name: 'Jane Doe', email: 'jane@example.com', phone: '+15015550123' },
      line_items: {
        data: checked.params.line_items.map((line) => ({
          description: line.price_data.product_data.name,
          quantity: line.quantity,
          amount_total: line.price_data.unit_amount * line.quantity,
        })),
      },
    },
    CATALOG
  );
}

const piece = (handle) => CATALOG.find((p) => p.handle === handle);

/* ------------------------------------------------------- what to make */

test('the order says which piece and which design', () => {
  const pen = piece('blue-alien-beaded-pens');
  const design = pen.designs.options[2];

  const order = placeOrder([{ handle: pen.handle, design: design.id, quantity: 1 }]);

  assert.equal(order.items[0].title, pen.title);
  assert.equal(order.items[0].designName, design.name);
  assert.equal(order.items[0].quantity, 1);
});

test('the order says which choice was made', () => {
  // The piece that comes in two scents. Without this the packing list names
  // the piece and says nothing about which of them was paid for, and a parcel
  // goes out smelling wrong.
  const freshener = piece('the-mischievous-blue-alien-car-air-freshener-collection');
  const axis = freshener.choices[0];
  const wanted = axis.values[1];

  const order = placeOrder([
    {
      handle: freshener.handle,
      design: freshener.designs.options[0].id,
      quantity: 1,
      choices: { [axis.id]: wanted.id },
    },
  ]);

  assert.deepEqual(order.items[0].choices, [{ label: axis.label, value: wanted.label }]);
});

test('every choice on a piece arrives, not just the first', () => {
  const made = {
    handle: 'custom',
    title: 'Custom',
    price: 10,
    choices: [
      { id: 'c1', label: 'Scent', values: [{ id: 'v1', label: 'Pineapple' }] },
      { id: 'c2', label: 'Ink', values: [{ id: 'v2', label: 'Black' }] },
    ],
  };

  const { items } = resolveCart(
    [{ handle: 'custom', quantity: 1, choices: { c1: 'v1', c2: 'v2' } }],
    [made]
  );

  const back = decodeCart(encodeCart(items));
  assert.deepEqual(back[0].choices, { c1: 'v1', c2: 'v2' });
});

test('a photograph of what to make comes with the row', () => {
  const pen = piece('blue-alien-beaded-pens');
  const design = pen.designs.options[1];

  const order = placeOrder([{ handle: pen.handle, design: design.id, quantity: 1 }]);

  // The design's own photograph, since that is what was chosen.
  assert.equal(order.items[0].image, design.image);
});

test('several pieces in one order all arrive', () => {
  const order = placeOrder([
    { handle: 'blue-alien-keychains', design: piece('blue-alien-keychains').designs.options[0].id, quantity: 2 },
    { handle: 'galactic-glitch-alien-mousepad', quantity: 1 },
  ]);

  assert.equal(order.items.length, 2);
  assert.equal(order.items.find((i) => i.handle === 'blue-alien-keychains').quantity, 2);
});

/* ------------------------------------------------------- where to send */

test('the whole address arrives, in the order an envelope wants it', () => {
  const order = placeOrder([{ handle: 'galactic-glitch-alien-mousepad', quantity: 1 }]);

  assert.equal(
    order.customer.address,
    'Jane Doe\n12 Example Street\nApt 4\nHot Springs, AR, 71901\nUS'
  );
  assert.equal(order.customer.name, 'Jane Doe');
  assert.equal(order.customer.email, 'jane@example.com');
  assert.equal(order.customer.phone, '+15015550123');
});

test('the address is read whichever shape Stripe sends it in', () => {
  // Stripe moved shipping details under collected_information in later API
  // versions, and which one arrives depends on the account's API version
  // rather than on anything here.
  const older = formatAddress(SHIPPING);
  assert.ok(older.includes('12 Example Street'));

  const fromOldShape = toOrder(
    { id: 'cs_1', payment_status: 'paid', shipping_details: SHIPPING, metadata: {} },
    CATALOG
  );

  assert.ok(fromOldShape.customer.address.includes('Hot Springs'));
});

test('a missing second address line does not leave a blank in the middle', () => {
  const addressed = formatAddress({ ...SHIPPING, address: { ...SHIPPING.address, line2: null } });

  assert.ok(!addressed.includes('\n\n'), addressed);
});

/* ----------------------------------------------------- what was paid */

test('the money on the order is the money Stripe took', () => {
  const pen = piece('blue-alien-beaded-pens');
  const order = placeOrder([
    { handle: pen.handle, design: pen.designs.options[0].id, quantity: 2 },
  ]);

  assert.equal(order.totals.total, pen.price * 2);
  assert.equal(order.totals.shipping, 0);
  assert.equal(order.totals.currency, 'USD');
  assert.equal(order.paid, true);
  assert.equal(order.live, true);
});

test('an order carries a reference and a way into Stripe', () => {
  const order = placeOrder([{ handle: 'galactic-glitch-alien-mousepad', quantity: 1 }]);

  assert.equal(order.reference, 'SW-260101-001');
  assert.equal(order.paymentIntent, 'pi_live_1');
  assert.ok(order.placedAt, 'an order with no date cannot be sorted or chased');
});

test('nothing ordered is ever unrecoverable', () => {
  // Even if every other field failed to resolve, what was bought is still
  // written down in a form that can be read by hand.
  const pen = piece('blue-alien-beaded-pens');
  const order = placeOrder([
    { handle: pen.handle, design: pen.designs.options[0].id, quantity: 1 },
  ]);

  assert.equal(order.rawCart[0].handle, pen.handle);
  assert.equal(order.rawCart[0].design, pen.designs.options[0].id);
});

/* ------------------------------------------------- when the catalog fails */

test('an order still names what was bought when the catalog cannot be read', () => {
  const pen = piece('blue-alien-beaded-pens');
  const design = pen.designs.options[0];

  const { items } = resolveCart(
    [{ handle: pen.handle, design: design.id, quantity: 1 }],
    CATALOG
  );

  const order = toOrder(
    {
      id: 'cs_1',
      payment_status: 'paid',
      metadata: {},
      collected_information: { shipping_details: SHIPPING },
      line_items: {
        data: [
          {
            description: `${pen.title} — ${design.name}`,
            quantity: 1,
            amount_total: 1299,
            price: { product: { description: 'Scent: Pineapple Punch on Kauai' } },
          },
        ],
      },
    },
    []
  );

  assert.equal(order.itemsFromStripe, true, 'the panel must be able to say this is the fallback');
  assert.match(order.items[0].title, /Beaded Pen/);
  // The choices were written onto the Stripe line so a customer could check
  // them before paying, which makes them readable back even now.
  assert.deepEqual(order.items[0].choices, [
    { label: 'Options', value: 'Scent: Pineapple Punch on Kauai' },
  ]);
  assert.ok(order.customer.address.includes('Hot Springs'));
});

/* --------------------------------------------------------- the packing list */

test('a parcel still to go out is counted as one', () => {
  const order = placeOrder([{ handle: 'galactic-glitch-alien-mousepad', quantity: 1 }]);

  assert.equal(order.shippedAt, null);
  assert.equal(orderSummary([order]).toShip, 1);
});

test('marking it shipped takes it off the list', () => {
  const shipped = toOrder(
    {
      id: 'cs_1',
      payment_status: 'paid',
      metadata: {},
      payment_intent: { id: 'pi_1', metadata: { shipped_at: '2026-01-02T00:00:00.000Z' } },
    },
    CATALOG
  );

  assert.equal(shipped.shippedAt, '2026-01-02T00:00:00.000Z');
  assert.equal(orderSummary([shipped]).toShip, 0);
});

test('an unpaid session is not an order', () => {
  // Stripe keeps abandoned sessions. One of them appearing as something to
  // make and post would be a parcel sent for nothing.
  const abandoned = toOrder({ id: 'cs_1', payment_status: 'unpaid', metadata: {} }, CATALOG);

  assert.equal(abandoned.paid, false);
  assert.equal(orderSummary([abandoned]).count, 0);
});

/* ------------------------------------------------- the whole catalog at once */

test('every piece in the shop can be ordered and read back whole', () => {
  // The guard that matters as the catalog grows: a piece added later with an
  // odd shape would otherwise fail silently, on the one page where silence is
  // a parcel that never goes out.
  for (const product of CATALOG) {
    if (product.hidden === true || product.price == null) continue;

    const design = product.designs?.options?.find((option) => option.stock !== 0) ?? null;
    const axes = product.choices ?? [];

    const chosen = {};
    for (const axis of axes) chosen[axis.id] = axis.values[0].id;

    const order = placeOrder([
      { handle: product.handle, design: design?.id ?? null, quantity: 1, choices: chosen },
    ]);

    assert.equal(order.items.length, 1, `${product.handle} did not come back`);
    assert.equal(order.items[0].title, product.title, product.handle);
    assert.equal(order.items[0].choices.length, axes.length, `${product.handle} lost a choice`);
    assert.ok(order.items[0].price > 0, `${product.handle} came back with no price`);
    assert.ok(order.customer.address, `${product.handle} lost the address`);
  }
});
