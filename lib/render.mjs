// Putting server-rendered content into the static page shell.
//
// The alternative was to write the page shell a second time inside a function,
// which would mean a header, a footer and a script list that have to be kept
// in step with product.html by hand. They would drift. So the shell stays the
// single static file everyone already edits, and this rewrites the parts that
// have to differ per piece.
//
// Kept separate from the route, and pure, so the string surgery can be tested
// without a network or a deployment.

// The original title and description have to go rather than be added to. A
// document with two <title> elements uses the first one, so leaving the shell's
// "Piece — Stitch Wishess" in place would beat everything injected below it.
const TITLE = /<title>[\s\S]*?<\/title>\s*/i;
const DESCRIPTION = /<meta\s+name=["']description["'][^>]*>\s*/i;

// product.html carries noindex, because /product?handle=x is the old address and
// two URLs for one piece is a duplicate a crawler has to guess between. The
// rendered page at /p/<handle> is the one that should be indexed, so the
// directive is stripped on the way through. Getting this backwards would
// de-index the entire catalog, quietly.
const ROBOTS = /<meta\s+name=["']robots["'][^>]*>\s*/i;

const HEAD_END = '</head>';

// Matched as an empty element on purpose. If this container ever stops being
// empty in the shell, the replacement should fail loudly in a test rather than
// silently double the content on every product page.
const DETAIL = /<div class="detail" data-product-detail><\/div>/;

export function injectHead(html, tags) {
  const cleaned = String(html)
    .replace(TITLE, '')
    .replace(DESCRIPTION, '')
    .replace(ROBOTS, '');
  const at = cleaned.toLowerCase().indexOf(HEAD_END);

  // A shell with no </head> is a broken shell, and returning it unchanged is
  // more useful than returning nothing: the page still works, it just shares
  // the previews it had before.
  if (at === -1) return cleaned;

  return `${cleaned.slice(0, at)}  ${tags}\n${cleaned.slice(at)}`;
}

export function injectDetail(html, body) {
  return String(html).replace(
    DETAIL,
    `<div class="detail" data-product-detail>${body}</div>`
  );
}

export function hasDetailContainer(html) {
  return DETAIL.test(String(html));
}

// Relative links in the shell (styles.css, logo.svg, collection.html) resolve
// against the current directory. Served from /p/<handle>, that directory is
// /p/, so every one of them would 404 — the page would arrive unstyled with a
// broken navigation. A <base> fixes all of them at once, which is why the
// links themselves are left alone.
export function injectBase(html, href = '/') {
  const at = String(html).toLowerCase().indexOf('<head>');
  if (at === -1) return String(html);

  const after = at + '<head>'.length;
  return `${html.slice(0, after)}\n  <base href="${href}">${html.slice(after)}`;
}
