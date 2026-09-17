// Which image paths the catalog will accept.
//
// Extracted so the catalog and the design options share one definition. Two
// copies of a security check are two chances for one of them to drift, and
// this is the check that matters most: the catalog is serialised into
// something every visitor's browser acts on, so an unchecked path here is
// script injection rather than a broken image.

// One path segment under assets/, nothing more. No directories, no traversal,
// no scheme.
const BUNDLED = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Photographs uploaded from a phone land in Vercel Blob. The host is pinned to
// the end of the string, because a lookalike such as
// "abc.public.blob.vercel-storage.com.evil.com" contains the real host as a
// substring and would pass any looser check. https only, and no character that
// could break out of the attribute it ends up inside.
const UPLOADED =
  /^https:\/\/[a-z0-9][a-z0-9-]*\.public\.blob\.vercel-storage\.com\/[A-Za-z0-9/_.~%-]+$/;

export function isUsableImage(path) {
  return typeof path === 'string' && (BUNDLED.test(path) || UPLOADED.test(path));
}
