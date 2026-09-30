// What kind of thing each piece is.
//
// The source catalog has no categories at all: product_type is empty on all
// fifteen, and the tags are search keywords rather than groupings — "Cheap
// stitch gifts", "Stitch fans", "Stitch lover". Useful to a search engine,
// useless for telling a shopper that this is a pen and that is a sign.
//
// So they are assigned here, by hand, from what the pieces actually are.
// Fifteen products is small enough that guessing from the title would be worse
// than deciding: a keyword match would put "Stitch Witch Signature Car
// Coasters" in whatever bucket matched first, and quietly move it the day
// somebody edits the title.
//
// Keyed by handle, because a handle is the piece's identity and a title is not.

export const CATEGORIES = Object.freeze([
  { id: 'pens', label: 'Beaded pens' },
  { id: 'wall', label: 'Wall & decor' },
  { id: 'car', label: 'For the car' },
  { id: 'desk', label: 'Desk & vanity' },
  { id: 'keyrings', label: 'Keychains' },
]);

const BY_HANDLE = Object.freeze({
  'untitled-may1_12-21': 'pens',
  'collector-beaded-pen': 'pens',
  'untitled-apr30_16-33': 'pens',

  'blue-alien-sign-collection-multiple-adorable-styles-available': 'wall',
  'cosmic-mischief-framed-blue-alien-acrylic-canvas-art': 'wall',
  'mischievous-blue-alien-collection-vinyl-wall-decals-options': 'wall',
  'starry-night-alien-626-wanderer-two-versions-fridge-magnet': 'wall',
  'mischievous-blue-alien-sweet-bear-friends-acrylic-night-light': 'wall',

  'the-mischievous-blue-alien-car-air-freshener-collection': 'car',
  'stitch-witch-signature-car-coasters': 'car',
  'mischievous-alien-couple-decorative-license-plate': 'car',

  'custom-beaded-makeup-brushes-blue-alien-edition': 'desk',
  'galactic-glitch-alien-mousepad': 'desk',
  'untitled-apr26_16-08': 'desk',

  'untitled-apr30_15-01': 'keyrings',
});

// Anything unrecognised gets no category rather than a wrong one. A piece added
// later shows up under "Everything" and nowhere else, which is visibly
// incomplete — better than being filed somewhere misleading.
export const categoryOf = (product) => BY_HANDLE[product?.handle] ?? null;

export const labelFor = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? null;

export const isCategory = (id) => CATEGORIES.some((c) => c.id === id);

// Only the categories that actually have something visible in them. A filter
// that returns an empty grid is a dead end, and hiding a piece should take its
// chip with it if it was the last one.
export function categoriesPresent(products) {
  const counts = new Map();

  for (const product of Array.isArray(products) ? products : []) {
    if (product?.hidden === true) continue;

    const id = product?.category ?? categoryOf(product);
    if (!id || !isCategory(id)) continue;

    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return CATEGORIES.filter((c) => counts.has(c.id)).map((c) => ({
    ...c,
    count: counts.get(c.id),
  }));
}
