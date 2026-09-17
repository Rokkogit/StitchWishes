// Catalog validation and shaping.
//
// Pure — no I/O, no environment. Everything here is about deciding whether a
// catalog is safe to store and serve, so it can be tested exhaustively without
// a network or a store.
//
// In lib/ rather than api/ because every file in api/ becomes a deployed
// route. See lib/session.mjs for the full note.

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 4000;

// The Global Config store caps at 1 MB. Stopping short of it leaves room for
// the other keys and turns "your write was rejected" into a message that names
// the problem before anything is sent.
export const MAX_BYTES = 900_000;

// Image path rules live in lib/images.mjs so the catalog and the design
// options cannot drift apart on the check that matters most.
import { isUsableImage } from './images.mjs';
import { validateDesigns, validateChoices } from './variants.mjs';

// Underscores are allowed because the live catalog already uses them —
// "untitled-apr30_16-33" and three siblings came from Shopify that way. These
// are the URLs customers and search engines already hold, so a pattern that
// rejects them would make four real pieces unsaveable. New handles are still
// minted with dashes only; this is about not breaking what exists.
const HANDLE_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/* ------------------------------------------------------------------ slugify */

export function slugify(title) {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // strip accents left by the decomposition
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ---------------------------------------------------------------- utilities */

// Control characters would survive JSON and land in the page. Strip rather
// than reject: a stray one is almost always a paste artefact, not an attack,
// and failing someone's save over an invisible byte is a poor trade.
function cleanText(value) {
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFilledString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/* --------------------------------------------------------- validateProduct */

export function validateProduct(product, options = {}) {
  const { takenHandles = new Set(), ownHandle = null } = options;
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });

  const source = product && typeof product === 'object' ? product : {};
  const value = {};

  /* handle */
  if (!isFilledString(source.handle) || !HANDLE_PATTERN.test(source.handle)) {
    fail('handle', 'Use lower-case letters, numbers and single dashes.');
  } else if (source.handle !== ownHandle && takenHandles.has(source.handle)) {
    fail('handle', `Another piece already uses "${source.handle}".`);
  } else {
    value.handle = source.handle;
  }

  /* title */
  if (!isFilledString(source.title)) {
    fail('title', 'Every piece needs a title.');
  } else if (cleanText(source.title).length > MAX_TITLE) {
    fail('title', `Titles cap at ${MAX_TITLE} characters.`);
  } else {
    value.title = cleanText(source.title);
  }

  /* price — null is legitimate; one piece genuinely has no price */
  if (source.price === null || source.price === undefined || source.price === '') {
    value.price = null;
  } else {
    const price = typeof source.price === 'string' ? Number(source.price.trim()) : source.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) {
      fail('price', 'Price must be a number, or empty.');
    } else if (price < 0) {
      fail('price', 'Price cannot be negative.');
    } else {
      value.price = price;
    }
  }

  /* description */
  const description = source.description == null ? '' : String(source.description);
  if (cleanText(description).length > MAX_DESCRIPTION) {
    fail('description', `Descriptions cap at ${MAX_DESCRIPTION} characters.`);
  } else {
    value.description = cleanText(description);
  }

  /* images */
  if (!Array.isArray(source.images)) {
    fail('images', 'Images must be a list.');
  } else {
    const bad = source.images.filter((path) => !isUsableImage(path));
    if (bad.length) {
      fail('images', `Not a photograph in this catalog: ${bad.map((b) => JSON.stringify(b)).join(', ')}`);
    } else {
      value.images = [...source.images];
    }
  }

  /* stock — null means made to order, with no limit.
     Defaulting to null rather than 0 matters: 0 means sold out, and treating
     an absent value as sold out would empty the shop the moment this field
     was introduced. */
  if (source.stock === null || source.stock === undefined || source.stock === '') {
    value.stock = null;
  } else {
    const stock = typeof source.stock === 'string' ? Number(source.stock.trim()) : source.stock;

    if (typeof stock !== 'number' || !Number.isFinite(stock)) {
      fail('stock', 'Stock must be a whole number, or empty for made to order.');
    } else if (stock < 0) {
      fail('stock', 'Stock cannot be negative.');
    } else if (!Number.isInteger(stock)) {
      fail('stock', 'Stock must be a whole number.');
    } else {
      value.stock = stock;
    }
  }

  /* designs and choices */
  const designs = validateDesigns(source.designs);
  if (!designs.ok) errors.push(...designs.errors);
  else value.designs = designs.value;

  const choices = validateChoices(source.choices);
  if (!choices.ok) errors.push(...choices.errors);
  else value.choices = choices.value;

  value.hidden = source.hidden === true;
  if (Number.isFinite(source.position)) value.position = source.position;

  return errors.length ? { ok: false, errors } : { ok: true, value, errors: [] };
}

/* --------------------------------------------------------- validateCatalog */

export function validateCatalog(products) {
  if (!Array.isArray(products)) {
    return {
      ok: false,
      errors: [{ index: null, field: 'catalog', message: 'The catalog must be a list of pieces.' }],
      size: 0,
    };
  }

  const errors = [];
  const value = [];
  const seen = new Set();

  products.forEach((product, index) => {
    const result = validateProduct(product, { takenHandles: seen });

    if (result.ok) {
      seen.add(result.value.handle);
      value.push(result.value);
      return;
    }

    for (const error of result.errors) errors.push({ index, ...error });
  });

  const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size > MAX_BYTES) {
    errors.push({
      index: null,
      field: 'size',
      message: `The catalog is ${Math.round(size / 1024)} KB; the ceiling is ${Math.round(MAX_BYTES / 1024)} KB.`,
    });
  }

  return errors.length ? { ok: false, errors, size } : { ok: true, value, errors: [], size };
}

/* -------------------------------------------------------------- storefront */

// A description shorter than this reads as a placeholder rather than a
// description, which is worth surfacing on the dashboard.
const THIN_DESCRIPTION = 20;

// What the storefront should show, in the order it should show it. Hidden
// pieces are dropped here rather than in the browser, so a hidden piece is
// never delivered to a visitor at all.
//
// Copies before sorting: callers pass the live catalog, and quietly reordering
// someone else's array is the kind of bug that surfaces three screens away.
export function visibleProducts(products) {
  const visible = (Array.isArray(products) ? products : []).filter((p) => p?.hidden !== true);

  return visible.slice().sort((a, b) => {
    const aPos = Number.isFinite(a.position);
    const bPos = Number.isFinite(b.position);

    // Explicitly positioned pieces lead, in their given order. Everything else
    // falls back to the alphabetical order the live store used.
    if (aPos && bPos) return a.position - b.position;
    if (aPos) return -1;
    if (bPos) return 1;

    return String(a.title ?? '').localeCompare(String(b.title ?? ''));
  });
}

/* --------------------------------------------------------------- dashboard */

export function catalogHealth(products, assetsOnDisk = null) {
  const list = Array.isArray(products) ? products : [];

  const used = new Set();
  for (const product of list) {
    for (const image of product?.images ?? []) used.add(image);
  }

  return {
    total: list.length,
    hidden: list.filter((p) => p?.hidden === true).length,
    noPhoto: list.filter((p) => !(p?.images?.length > 0)).length,
    noPrice: list.filter((p) => p?.price == null).length,
    thinDescription: list.filter((p) => String(p?.description ?? '').length < THIN_DESCRIPTION).length,
    // An image used only by a hidden piece still counts as used — it comes
    // back the moment that piece is shown again.
    unusedImages: (assetsOnDisk ?? []).filter((path) => !used.has(path)),
  };
}
