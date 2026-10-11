// A colour the customer picks, all the way from the product page to the
// packing list.
//
// This is a value a stranger types into an order, so it gets the same
// treatment as every other such value: narrow shape, checked against the piece
// rather than trusted, and carried through to the one place it has to arrive -
// the Orders tab, where somebody has to make the thing in that colour.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateProduct } from '../lib/catalog.mjs';
import { validateCustomColor, isHexColour, readColourChoice } from '../lib/variants.mjs';
import { resolveCart } from '../lib/cart.mjs';
import { orderTotal, DEFAULT_SETTINGS } from '../lib/settings.mjs';
import { checkedSessionParams } from '../lib/checkout.mjs';
import { cartMetadata, decodeCart, encodeCart } from '../lib/stripe.mjs';
import { toOrder } from '../lib/orders.mjs';
import { orderEmail } from '../lib/notify.mjs';

const SKULL = {
  handle: 'skull-organizer',
  title: 'Flutter & Flourish Skull Organizer',
  price: 30,
  images: ['assets/skull.jpg'],
  customColor: { enabled: true, label: 'Resin colour', preset: '#8fd4e6' },
};

const MOUSEPAD = { handle: 'mousepad', title: 'Mousepad', price: 13.99, images: ['assets/m.jpg'] };

const CATALOG = [SKULL, MOUSEPAD];

/* ----------------------------------------------------- offered per piece */

test('a piece only offers a colour when it has been switched on', () => {
  assert.equal(validateCustomColor({ enabled: true, label: 'Resin colour' }).value.label, 'Resin colour');
  assert.equal(validateCustomColor({ enabled: false, label: 'Resin colour' }).value, null);
  assert.equal(validateCustomColor(null).value, null);
  assert.equal(validateCustomColor('yes').value, null);
});

test('switched off stores nothing rather than storing off', () => {
  // "Not offered" and "offered but off" are the same thing, so keeping the
  // second would be a difference that means nothing.
  assert.equal(validateProduct({ ...SKULL, customColor: { enabled: false } }).value.customColor, null);
});

test('the option survives an admin save', () => {
  // validateProduct builds its result from known keys, so a field it does not
  // know about is dropped the first time anything is saved.
  const saved = validateProduct(SKULL);

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.value.customColor, {
    enabled: true,
    label: 'Resin colour',
    preset: '#8fd4e6',
  });
});

test('a missing label falls back rather than leaving the control unnamed', () => {
  assert.equal(validateCustomColor({ enabled: true }).value.label, 'Colour');
});

test('a label cannot smuggle control characters or run on forever', () => {
  const { value } = validateCustomColor({ enabled: true, label: `Re\u0000d\n\n${'x'.repeat(200)}` });

  assert.ok(!/[\u0000-\u001f]/.test(value.label));
  assert.ok(value.label.length <= 40);
});

/* -------------------------------------------------------- what is accepted */

test('only a six digit hex colour is a colour', () => {
  for (const good of ['#b026ff', '#B026FF', '#000000', '#ffffff']) {
    assert.equal(isHexColour(good), true, good);
  }

  for (const bad of ['red', '#fff', '#12345', '#1234567', 'javascript:alert(1)', '', null, 42, {}]) {
    assert.equal(isHexColour(bad), false, JSON.stringify(bad));
  }
});

test('a colour is only accepted on a piece that offers one', () => {
  assert.equal(readColourChoice(SKULL, '#B026FF'), '#b026ff');
  assert.equal(readColourChoice(MOUSEPAD, '#B026FF'), null);
  assert.equal(readColourChoice(SKULL, 'red'), null);
});

/* ----------------------------------------------------------------- the bag */

test('the colour reaches the bag, named the way the piece names it', () => {
  const { items } = resolveCart([{ handle: 'skull-organizer', quantity: 1, colour: '#B026FF' }], CATALOG);

  assert.equal(items[0].colour, '#b026ff');
  assert.equal(items[0].colourLabel, 'Resin colour');
});

test('a piece that offers no colour cannot be given one', () => {
  const { items } = resolveCart([{ handle: 'mousepad', quantity: 1, colour: '#B026FF' }], CATALOG);

  assert.equal(items[0].colour, null);
  assert.equal(items[0].colourLabel, null);
});

test('junk in the colour is dropped, not carried', () => {
  const { items } = resolveCart(
    [{ handle: 'skull-organizer', quantity: 1, colour: '"><script>alert(1)</script>' }],
    CATALOG
  );

  assert.equal(items[0].colour, null);
});

test('two of the same colour are one line', () => {
  const { items } = resolveCart(
    [
      { handle: 'skull-organizer', quantity: 1, colour: '#b026ff' },
      { handle: 'skull-organizer', quantity: 2, colour: '#B026FF' },
    ],
    CATALOG
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 3);
});

test('two different colours are two lines, because they are two things to make', () => {
  const { items } = resolveCart(
    [
      { handle: 'skull-organizer', quantity: 1, colour: '#b026ff' },
      { handle: 'skull-organizer', quantity: 1, colour: '#00ff88' },
    ],
    CATALOG
  );

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.colour).sort(), ['#00ff88', '#b026ff']);
});

/* ------------------------------------------------------ through to Stripe */

test('the colour survives the trip through Stripe metadata', () => {
  const { items } = resolveCart([{ handle: 'skull-organizer', quantity: 1, colour: '#B026FF' }], CATALOG);
  const order = toOrder(
    { id: 'cs_1', payment_status: 'paid', metadata: cartMetadata(items) },
    CATALOG
  );

  assert.equal(order.items[0].colour, '#b026ff');
  assert.equal(order.items[0].colourLabel, 'Resin colour');
});

test('an order placed before colours existed still reads', () => {
  // Three parts instead of five. No colour recorded, which is true of it.
  assert.deepEqual(decodeCart('skull-organizer::2'), [
    { handle: 'skull-organizer', design: null, quantity: 2, choices: {}, colour: null },
  ]);
});

test('a piece with a colour and no choices keeps its place in the encoding', () => {
  // The colour sits in the fifth slot, so the empty fourth has to be written.
  const encoded = encodeCart([{ handle: 'x', design: 'd1', quantity: 1, colour: '#b026ff' }]);

  assert.equal(encoded, 'x:d1:1::%23b026ff');
  assert.equal(decodeCart(encoded)[0].colour, '#b026ff');
});

test('the customer sees the colour before they pay', () => {
  const { items } = resolveCart([{ handle: 'skull-organizer', quantity: 1, colour: '#B026FF' }], CATALOG);

  const checked = checkedSessionParams({
    items,
    totals: orderTotal(items, DEFAULT_SETTINGS),
    settings: DEFAULT_SETTINGS,
    origin: 'https://www.stitchwishess.com',
  });

  assert.equal(checked.ok, true, checked.reason);
  assert.match(checked.params.line_items[0].price_data.product_data.description, /Resin colour: #b026ff/);
});

test('the money is unchanged by any of this', () => {
  const { items } = resolveCart([{ handle: 'skull-organizer', quantity: 2, colour: '#b026ff' }], CATALOG);

  assert.equal(orderTotal(items, DEFAULT_SETTINGS).total, 60);
});

/* ------------------------------------------------- through to the parcel */

test('the order email says which colour to make it in', () => {
  const { items } = resolveCart([{ handle: 'skull-organizer', quantity: 1, colour: '#B026FF' }], CATALOG);

  const { text } = orderEmail({
    reference: 'SW-1',
    items,
    totals: orderTotal(items, DEFAULT_SETTINGS),
    customer: { name: 'Jane', email: 'jane@example.com' },
  });

  assert.match(text, /Resin colour: #b026ff/);
});

test('every piece in a mixed order keeps its own colour', () => {
  const { items } = resolveCart(
    [
      { handle: 'skull-organizer', quantity: 1, colour: '#b026ff' },
      { handle: 'skull-organizer', quantity: 1, colour: '#00ff88' },
      { handle: 'mousepad', quantity: 1 },
    ],
    CATALOG
  );

  const order = toOrder(
    { id: 'cs_1', payment_status: 'paid', metadata: cartMetadata(items) },
    CATALOG
  );

  const colours = order.items.map((i) => i.colour);

  assert.equal(order.items.length, 3);
  assert.deepEqual(colours.filter(Boolean).sort(), ['#00ff88', '#b026ff']);
  assert.equal(order.items.find((i) => i.handle === 'mousepad').colour, null);
});
