/* Stitch Wishess — Holo-Craft
   Product rendering, the scroll-sewn thread, and reveal transitions. */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function formatPrice(price) {
  return price == null ? '' : `$${price.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------------------------------------------------------------- products */

function emptyMediaHtml(cls) {
  return `<div class="${cls} card__media--empty">Photograph<br>coming soon</div>`;
}

function mediaHtml(product, modifier) {
  const cls = modifier || 'card__media';
  const images = product.images ?? [];
  if (!images.length) return emptyMediaHtml(cls);

  // What the badge says, in order of how much it helps someone deciding whether
  // to tap. "8 designs" is a choice you can make; "10 photos" is only pictures.
  // Several pieces carry both, and the designs are the reason to look.
  const designs = product.designs?.options?.length ?? 0;

  const count = designs
    ? `<span class="card__count">${designs} designs</span>`
    : images.length > 1
      ? `<span class="card__count">${images.length} photos</span>`
      : '';

  // Sold out is shown on the photograph rather than only in the price, so it
  // reads at a glance in a grid.
  const sold = product.stock === 0 ? '<span class="card__sold">Sold out</span>' : '';

  return `
    <div class="${cls}">
      <img src="${escapeHtml(images[0])}" alt="${escapeHtml(product.title)}" loading="lazy">
      ${count}
      ${sold}
    </div>
  `;
}

/* ---------------------------------------------------------------- gallery */

/* Which photograph the page opens on.

   Not images[0], which on several pieces is the studio's group shot: four
   pens in a stand, three notebooks, both magnets. The price sits directly
   under the large photograph, and a photograph of four things wearing one
   price reads as the price of all four.

   The catalog card gets away with the same photograph because it carries a
   badge over it saying "8 designs" — the group shot there reads as a range to
   choose from. The item page has no badge, only a number, so the photograph
   has to carry the meaning by itself.

   So the page opens on the first photograph of something that can actually be
   bought. The group shot keeps its place in the strip, because it is the best
   picture of the range; it just is not what the price is labelling. */
function openingIndex(entries) {
  const available = entries.findIndex((entry) => entry.design && entry.design.stock !== 0);
  if (available !== -1) return available;

  // Everything sold out: still a single piece rather than the set, because the
  // misreading is about the photograph, not about what is in stock.
  const anyDesign = entries.findIndex((entry) => entry.design);
  return anyDesign === -1 ? 0 : anyDesign;
}

// Every photograph the studio took of a piece, not just the first. Thumbnails
// are buttons rather than divs so the gallery works from the keyboard.
function galleryHtml(product) {
  const entries = galleryEntries(product);
  if (!entries.length) return emptyMediaHtml('detail__media');

  const opening = openingIndex(entries);

  const main = `
    <div class="detail__media">
      <img src="${escapeHtml(entries[opening].src)}" alt="${escapeHtml(product.title)}" data-gallery-main>
    </div>
  `;

  if (entries.length === 1) return main;

  const thumbs = entries
    .map((entry, index) => {
      const { src, design } = entry;
      const sold = design?.stock === 0;

      // What this thumbnail is determines what it announces. "Photograph 3 of
      // 9" is right for a picture; a design needs to say it can be chosen.
      const label = design
        ? `${design.name || 'Design'}${sold ? ', sold out' : ', choose this one'}`
        : `Photograph ${index + 1} of ${entries.length}`;

      return `
      <button class="thumb${index === opening ? ' is-active' : ''}${design ? ' is-design' : ''}${sold ? ' is-gone' : ''}"
              type="button"
              data-thumb="${escapeHtml(src)}"
              ${design ? `data-design="${escapeHtml(design.id)}"` : ''}
              ${sold ? 'disabled' : ''}
              title="${escapeHtml(design?.name ?? '')}"
              aria-label="${escapeHtml(label)}">
        <img src="${escapeHtml(src)}" alt="" loading="lazy">
        ${sold ? '<span class="thumb__gone">Sold</span>' : ''}
      </button>`;
    })
    .join('');

  return `${main}<div class="thumbs">${thumbs}</div>`;
}

/* What the price line says.

   "each" where a piece comes in several designs, because the photographs on
   this page are of a set and one number under a set is the price of the set
   unless it says otherwise. One word, and it is the difference between
   "$12.99 for these four pens" and "$12.99 for whichever one you pick".

   Not said where there is only ever one of something: "each" on a single
   mousepad is noise, and noise in a price is not free.

   One function because the line is written into the markup once and rewritten
   every time a design is chosen. Those two drifting apart is how a page starts
   saying two different things about one number. */
function priceLabel(product, design) {
  const price = design?.price ?? product.price;
  if (price == null) return '';

  return designsOf(product).length > 1 ? `${formatPrice(price)} each` : formatPrice(price);
}

function detailPriceHtml(product) {
  return `<p class="detail__price">${priceLabel(product, null)}</p>`;
}

// Sits above the button rather than above the strip: it is about what you are
// buying, not about what you are looking at.
function designStateHtml(product) {
  if (!designsOf(product).length) return '';

  return `
    <p class="chosen" data-chosen>
      <span class="label">${escapeHtml(product.designs.label || 'Design')}</span>
      <span data-design-name>Choose one from the photographs</span>
    </p>
  `;
}

/* --------------------------------------------------------------- designs */

/* The source catalog named these "Option 1" through "Option 10", which tells
   a customer nothing. What actually distinguishes them is the photograph, so
   that is what you pick from. Selecting one swaps the main image, so you are
   always looking at the thing you are about to buy. */

const chosen = { design: null, choices: {} };

const designsOf = (product) => product.designs?.options ?? [];

/* What the strip shows.

   The strip IS the picker - tapping a thumbnail chooses that design - so
   everything in it has to be something that can be chosen. A photograph of the
   whole set sitting among the designs reads as a ninth option, and tapping it
   does nothing, which is the worst answer a control can give.

   So where a piece comes in designs, the strip is the designs and nothing
   else. The group shot is not lost: it is the photograph on the catalog card,
   which is where it does its job - it sells the range at a glance, next to a
   badge saying how many designs there are. It just has no business in a picker.

   Where a piece has no designs there is nothing to pick, so the strip is simply
   its photographs and all of them belong. */
function galleryEntries(product) {
  const designs = designsOf(product);
  const images = product.images ?? [];

  if (!designs.length) return images.map((src) => ({ src, design: null }));

  const byImage = new Map(designs.map((design) => [design.image, design]));

  // Catalog order, so the strip reads the way the photographs were arranged.
  const entries = images.filter((src) => byImage.has(src)).map((src) => ({ src, design: byImage.get(src) }));

  // A design whose photograph is not among the gallery images would otherwise
  // be unreachable, and a design nobody can pick is a piece nobody can buy.
  const shown = new Set(entries.map((entry) => entry.src));
  for (const design of designs) {
    if (!shown.has(design.image)) entries.push({ src: design.image, design });
  }

  return entries;
}

function choicesHtml(product) {
  const axes = product.choices ?? [];
  if (!axes.length) return '';

  return axes
    .map(
      (axis) => `
      <div class="choices" data-axis="${escapeHtml(axis.id)}">
        <p class="label">${escapeHtml(axis.label)}</p>
        <div class="choices__row">
          ${axis.values
            .map(
              (value) => `
            <button class="choice" type="button"
                    data-choice="${escapeHtml(axis.id)}" data-value="${escapeHtml(value.id)}">
              ${escapeHtml(value.label)}
            </button>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('');
}

// Everything that depends on which design is selected, refreshed in place.
// Re-rendering the whole panel would throw away the gallery position.
function refreshSelection(root, product) {
  const design = designsOf(product).find((d) => d.id === chosen.design) ?? null;

  const priceNode = root.querySelector('.detail__price');
  if (priceNode) priceNode.textContent = priceLabel(product, design);

  const name = root.querySelector('[data-design-name]');
  if (name) name.textContent = design ? (design.name || 'Selected') : 'Choose one from the photographs';

  for (const button of root.querySelectorAll('[data-choice]')) {
    button.classList.toggle('is-on', chosen.choices[button.dataset.choice] === button.dataset.value);
  }

  // The strip is the picker, so the chosen design is marked there.
  for (const thumb of root.querySelectorAll('[data-thumb]')) {
    thumb.classList.toggle('is-chosen', Boolean(chosen.design) && thumb.dataset.design === chosen.design);
  }

  const add = root.querySelector('[data-add]');
  if (add) {
    const needsDesign = designsOf(product).length > 0 && !chosen.design;
    add.disabled = needsDesign;
    add.textContent = needsDesign ? 'Choose a design first' : 'Add to bag';
  }
}

/* ---------------------------------------------------------------- buying */

// Three states, and they are genuinely different: something with no price is
// not for sale yet, something at zero stock is gone, and everything else can
// go in the bag. Collapsing them would tell a customer the wrong thing.
/*
   What sits under the buy button.

   Everything here is a fact someone actually wants before deciding, and all of
   it is true: the piece is made after the order rather than pulled off a shelf,
   the wait is three to seven days, postage is flat and the figure comes from
   the shop's own settings rather than being written into the page.

   The point is removing uncertainty, which is the honest half of selling. A
   cost discovered at checkout is the most common reason a full bag is
   abandoned, so the number belongs here, before the bag, where it reassures
   instead of ambushing.

   There is deliberately no countdown, no "9 people are viewing this" and no
   invented review. Stock on these is null - made to order, no ceiling - so a
   scarcity line would be a plain lie, and this shop's whole character is a
   tribute to somebody's mother. Faking urgency would cheapen the thing being
   sold. Where stock IS finite, the real number is shown; see buyHtml.
*/
/* Whether the shop charges for postage.

   The server decides this and sends the answer with the catalog, because the
   rule depends on a setting that older saved settings do not carry. The page
   does not work it out for itself; a second copy of that rule is how a site
   starts advertising free postage while the bag charges for it.

   Unknown means free. The page renders once from its bundled catalog before
   /api/catalog has answered, and the shop builds postage into its prices, so
   that is what it says in the meantime rather than showing a figure it would
   then take back. */
function postageIsFree() {
  return shopShipping?.free !== false;
}

// Said wherever someone is deciding. Free postage is the single most effective
// thing a small shop can say, and it is only worth saying if it is everywhere
// the decision happens rather than discovered at the end.
/* The policy and terms pages say shipping is free, in their own markup, so they
   read correctly with no scripts and to a crawler. If the Checkout tab is ever
   switched back to charging for postage those two paragraphs become wrong in
   the worst possible place - the pages someone reads to find out what they will
   be charged - so they are corrected from the live setting. */
function applyPostageCopy() {
  if (postageIsFree()) return;

  const amount = formatPrice(Number(shopShipping.amount));

  for (const node of document.querySelectorAll('[data-postage]')) {
    node.textContent =
      `Postage is ${amount} per order, added as its own line in your bag before ` +
      'you pay, so the total you see is the total you are charged.';
  }
}

function freeShippingNote() {
  return postageIsFree() ? '<p class="detail__ship">Free shipping on every order</p>' : '';
}

function assuranceHtml(product) {
  const madeToOrder = !Number.isFinite(product.stock);

  const postage = postageIsFree()
    ? 'Free shipping, always'
    : `${formatPrice(Number(shopShipping.amount))} flat postage`;

  // Editable in the Words tab. Falls back to what the site has always said, so
  // a store with no content yet reads exactly as before.
  const says = shopCopy?.promises ?? {};

  const points = [
    madeToOrder ? escapeHtml(says.madeToOrder || 'Made for you after you order') : 'Ready to send',
    escapeHtml(says.delivery || 'Arrives in 3–7 days'),
    postage,
  ];

  return `
    <ul class="assure">
      ${points.map((point) => `<li>${point}</li>`).join('')}
    </ul>
    <p class="assure__maker">
      ${escapeHtml(says.maker || 'Made by hand by Abi, one at a time.')}
      <a href="about.html">Her story &rarr;</a>
    </p>
  `;
}

function buyHtml(product) {
  const designs = designsOf(product);

  // Every design gone is the same as the piece being gone, and saying so is
  // kinder than letting someone try each one in turn.
  if (designs.length && designs.every((design) => design.stock === 0)) {
    return `
      <p class="buy-note">Every one of these has sold. Message @stitch.wishess — another can usually be made.</p>
      <button class="btn btn-primary" type="button" disabled>Sold out</button>
    `;
  }

  if (product.stock === 0) {
    return `
      <p class="buy-note">This one has sold. Message @stitch.wishess — another can usually be made.</p>
      <button class="btn btn-primary" type="button" disabled>Sold out</button>
    `;
  }

  if (product.price == null) {
    return `
      <p class="buy-note">No price on this one yet. Message @stitch.wishess to ask.</p>
      <button class="btn btn-primary" type="button" disabled>Not for sale yet</button>
    `;
  }

  const left =
    Number.isFinite(product.stock) && product.stock <= 3
      ? `<p class="buy-note">Only ${product.stock} left.</p>`
      : '';

  return `
    ${left}
    <button class="btn btn-primary btn-buy" type="button" data-add>Add to bag</button>
    <p class="buy-note" data-added hidden>
      Added. <a href="bag.html">Go to your bag</a>
    </p>
    ${assuranceHtml(product)}
  `;
}

function initBuy(root, product) {
  chosen.design = null;
  chosen.choices = {};

  // A single design is not a choice — pick it for them rather than making
  // someone press a button that has no alternative.
  const designs = designsOf(product).filter((design) => design.stock !== 0);
  if (designs.length === 1) chosen.design = designs[0].id;

  // Same for a choice axis nobody can vary.
  for (const axis of product.choices ?? []) {
    if (axis.values.length === 1) chosen.choices[axis.id] = axis.values[0].id;
  }

  // Designs are chosen in the gallery strip, which handles its own clicks.
  // Only the plain choices are left for here.
  root.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-choice]');
    if (choice) {
      chosen.choices[choice.dataset.choice] = choice.dataset.value;
      refreshSelection(root, product);
    }
  });

  const button = root.querySelector('[data-add]');
  if (button) {
    button.addEventListener('click', () => {
      if (button.disabled) return;

      window.StitchCart?.add(product.handle, 1, {
        design: chosen.design,
        choices: { ...chosen.choices },
      });

      // Straight to the bag rather than a small "Added" line that is easy to
      // miss on a phone. The usual objection to this - that it interrupts
      // browsing - assumes the bag is a dead end; here it carries its own
      // suggestions and a "keep looking" link back, so it is a better selling
      // surface than the page being left, not a worse one.
      const added = root.querySelector('[data-added]');
      if (added) added.hidden = false;

      button.disabled = true;
      button.textContent = 'Added — opening your bag';

      // A beat before leaving, so the button visibly acknowledges the tap
      // rather than the page appearing to change on its own.
      window.setTimeout(() => {
        window.location.href = 'bag.html';
      }, 260);
    });
  }

  refreshSelection(root, product);
}

function initGallery(root, product) {
  const main = root.querySelector('[data-gallery-main]');
  const thumbs = Array.from(root.querySelectorAll('[data-thumb]'));
  if (!main || !thumbs.length) return;

  thumbs.forEach((thumb) => {
    thumb.addEventListener('click', () => {
      main.src = thumb.dataset.thumb;
      thumbs.forEach((other) => other.classList.toggle('is-active', other === thumb));

      // One click does both: show it, and — if it is something you can buy —
      // choose it. The group shot shows without changing what is chosen.
      if (thumb.dataset.design) {
        chosen.design = thumb.dataset.design;
        refreshSelection(root, product);
      }
    });
  });
}

// The designs, shown rather than counted. This catalog's whole character is
// that a piece comes in eight versions and each one is its own photograph;
// a card that says "8 designs" in text is hiding the reason to look.
//
// Four, then a remainder. Five thumbnails on a phone card is already a row of
// 28px squares, and past that they stop being recognisable as anything.
function swatchesHtml(product) {
  const options = product.designs?.options ?? [];
  if (options.length < 2) return '';

  const shown = options.slice(0, 4);
  const rest = options.length - shown.length;

  const thumbs = shown
    .map(
      (option) => `
      <span class="swatch${option.stock === 0 ? ' is-gone' : ''}">
        <img src="${escapeHtml(option.image)}" alt="" loading="lazy" width="40" height="40">
      </span>`
    )
    .join('');

  return `
    <div class="swatches" aria-hidden="true">
      ${thumbs}
      ${rest > 0 ? `<span class="swatch swatch--more">+${rest}</span>` : ''}
    </div>
  `;
}

function cardHtml(product) {
  return `
    <a class="card" href="/p/${encodeURIComponent(product.handle)}">
      ${mediaHtml(product)}
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(product.title)}</h3>
        ${swatchesHtml(product)}
        <p class="card__price">${formatPrice(product.price)}</p>
      </div>
    </a>
  `;
}

function renderGrid(el, products) {
  if (el) el.innerHTML = products.map(cardHtml).join('');
}
/* ------------------------------------------------------------------ clouds */

function initClouds() {
  if (document.querySelector('.clouds')) return;
  const clouds = document.createElement('div');
  clouds.className = 'clouds';
  clouds.setAttribute('aria-hidden', 'true');
  clouds.innerHTML = `
    <div class="cloud-layer cloud-layer--far"></div>
    <div class="cloud-layer cloud-layer--near"></div>
  `;
  document.body.appendChild(clouds);
}

/* ------------------------------------------------------------------ thread */

const THREAD_PATH = 'M44 0 C 30 250, 58 500, 44 750 S 30 950, 44 1000';

function buildThread(host) {
  host.innerHTML = `
    <svg class="thread__svg" viewBox="0 0 88 1000" preserveAspectRatio="none">
      <defs>
        <linearGradient id="threadHolo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8fd4e6"/>
          <stop offset="35%" stop-color="#9cc2e6"/>
          <stop offset="62%" stop-color="#f0c0e4"/>
          <stop offset="100%" stop-color="#aee2d2"/>
        </linearGradient>
        <clipPath id="threadClip">
          <rect x="0" y="0" width="88" height="0" data-clip></rect>
        </clipPath>
      </defs>
      <path class="thread__track" d="${THREAD_PATH}"></path>
      <path class="thread__stitch" d="${THREAD_PATH}" clip-path="url(#threadClip)"></path>
    </svg>
    <div class="thread__beads" data-beads></div>
  `;
}

function initThread() {
  const host = document.querySelector('[data-thread]');
  if (!host) return;

  buildThread(host);

  const clip = host.querySelector('[data-clip]');
  const beadHost = host.querySelector('[data-beads]');
  const sections = Array.from(document.querySelectorAll('[data-section]'));

  // Each bead sits at the scroll fraction where its section arrives,
  // so the rail is a true map of the page rather than decoration.
  const beads = sections.map((section) => {
    const el = document.createElement('span');
    el.className = 'bead';
    el.title = section.dataset.section;
    beadHost.appendChild(el);
    return { el, section, fraction: 0 };
  });

  function measure() {
    const scrollable = Math.max(document.body.scrollHeight - window.innerHeight, 1);
    beads.forEach((bead) => {
      const top = bead.section.getBoundingClientRect().top + window.scrollY;
      bead.fraction = Math.min(Math.max(top / scrollable, 0.04), 0.96);
      bead.el.style.top = `${bead.fraction * 100}%`;
    });
  }

  function update() {
    const scrollable = Math.max(document.body.scrollHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max(window.scrollY / scrollable, 0), 1);
    clip.setAttribute('height', String(progress * 1000));
    beads.forEach((bead) => {
      bead.el.classList.toggle('is-strung', progress >= bead.fraction - 0.02);
    });
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  }

  measure();
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    measure();
    update();
  });
}

/* ----------------------------------------------------------------- reveals */

function initReveals() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  if (REDUCED || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    });
  // threshold stays 0: a tall single-column grid can never expose a
  // percentage of itself large enough to trip a higher one on a phone.
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

  items.forEach((el) => observer.observe(el));
}

/* -------------------------------------------------------------------- boot */

/* The catalog now lives in a store the admin panel writes to, but the bundled
   copy ships with the page. So: paint from the bundle immediately, then ask
   the server and repaint only if it disagrees. No spinner, no empty shop if
   the API is unreachable, and edits still appear on the next load. */

/*
   The site's own words, applied over what the HTML already says.

   The pages ship with the current copy written into them, so they read
   correctly with no JavaScript, on a slow connection and for a crawler - and
   there is no flash of empty headings while a fetch is in flight. This only
   touches a line when the store actually holds something different, which for
   an unedited site is never.

   textContent rather than innerHTML: this is someone typing into a form, and
   it should not be able to put markup on the page.
*/
/*
   The look, applied as custom properties on the root element.

   The stylesheet already reads every colour, corner and spacing step from a
   token, so this changes the whole site without touching a rule. Set as
   properties rather than injected as a <style> block: no string building, and
   nothing that could put CSS text on the page.

   Sections she has switched off are hidden here rather than removed, so
   switching one back on needs no deploy.
*/
function applyTheme(theme) {
  if (!theme) return;

  const root = document.documentElement;

  for (const [name, value] of Object.entries(theme.vars ?? {})) {
    root.style.setProperty(name, value);
  }

  for (const [name, shown] of Object.entries(theme.sections ?? {})) {
    for (const node of document.querySelectorAll(`[data-section-name="${name}"]`)) {
      node.hidden = shown === false;
    }
  }
}

function applyCopy(content) {
  if (!content) return;

  for (const node of document.querySelectorAll('[data-copy]')) {
    const [group, key] = String(node.dataset.copy).split('.');
    const value = content?.[group]?.[key];

    if (typeof value !== 'string' || !value) continue;
    if (node.textContent === value) continue;

    node.textContent = value;
  }
}

async function fetchLiveProducts() {
  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) return null;          // 503 means "use your bundled copy"

    const data = await response.json();

    // Kept so the product page can print the real postage figure rather than
    // one written into the page, which would start lying the first time it was
    // changed in the admin panel.
    if (data.shipping) {
      shopShipping = data.shipping;
      applyPostageCopy();
    }

    if (data.content) {
      shopCopy = data.content;
      applyCopy(shopCopy);
    }

    if (data.theme) applyTheme(data.theme);

    return Array.isArray(data.products) ? data.products : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------ suggestive selling */
/*
   What used to sit under a piece was four products picked at random, which is
   not a suggestion so much as a shuffle. These are chosen.

   The rule is cross-sell, not more-of-the-same: something from a DIFFERENT
   category that costs LESS than what is being looked at. Someone deciding on a
   $16.99 sign is not helped by three more signs; they are helped by a $9
   keychain they had not thought of. Same-category pieces fill the row only if
   there are not enough of those, because an empty row is worse.
*/
function goesWellWith(product, all, limit = 4) {
  const others = all.filter((p) => p.handle !== product.handle && p.hidden !== true);

  const price = Number(product.price) || 0;
  const category = product.category ?? null;

  const cheaperElsewhere = others.filter(
    (p) => p.category !== category && (Number(p.price) || 0) <= price
  );

  // Closest in price first: a $12 add-on to a $17 piece reads as a pairing,
  // where the very cheapest thing in the shop reads as a consolation prize.
  cheaperElsewhere.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));

  const picked = cheaperElsewhere.slice(0, limit);
  if (picked.length >= limit) return picked;

  // Top up, still deliberately: anything else not already chosen.
  const taken = new Set(picked.map((p) => p.handle));
  for (const p of others) {
    if (picked.length >= limit) break;
    if (!taken.has(p.handle)) picked.push(p);
  }

  return picked;
}

/* -------------------------------------------------------------- filtering */

function categoriesInUse(products) {
  // From the store once a live read lands, else the copy bundled with the
  // site. Editable in the admin panel either way.
  const defined = shopCopy?.categories ?? window.STITCH_CATEGORIES ?? [];
  const counts = new Map();

  for (const product of products) {
    if (product.hidden === true) continue;
    if (!product.category) continue;
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }

  // Only chips that lead somewhere. A filter returning an empty grid is a dead
  // end, and hiding the last piece in a category should take its chip with it.
  return defined.filter((c) => counts.has(c.id)).map((c) => ({ ...c, count: counts.get(c.id) }));
}

function renderFilters(root, products, active) {
  if (!root) return;

  const categories = categoriesInUse(products);

  // One category is not a choice, so there is nothing to offer.
  if (categories.length < 2) {
    root.innerHTML = '';
    return;
  }

  const chip = (id, label, count) => `
    <button class="chip${active === id ? ' is-on' : ''}" type="button"
            data-filter="${escapeHtml(id)}"
            aria-pressed="${active === id}">
      ${escapeHtml(label)} <span class="chip__count">${count}</span>
    </button>
  `;

  const total = products.filter((p) => p.hidden !== true).length;

  root.innerHTML =
    chip('all', 'Everything', total) +
    categories.map((c) => chip(c.id, c.label, c.count)).join('');
}

// Held so a filter click can redraw without another catalog read.
// Sent with the catalog so the product page can state the real figure. Null
// until a live read lands, and the strip simply omits the number until then -
// a wrong price printed confidently is worse than no price.
let shopShipping = null;

// The site's own words, once a live read has landed.
let shopCopy = null;

let shopProducts = [];
let activeFilter = 'all';

/* ------------------------------------------------------------ our picks */
/*
   A drifting row above the grid, of the pieces with the most designs. The
   sub-heading says exactly that, so "Our picks" is a curation with its basis
   stated rather than a claim nobody can check.

   The motion is one continuous drift rather than a slideshow that jumps. The
   list is rendered twice and the track travels exactly half its width, so the
   second copy is under the first at the moment it resets and the loop has no
   seam. A card appears to swoosh in and out because the viewport is masked at
   both edges - it fades up as it arrives, is solid across the middle, and
   fades away as it leaves.

   It pauses when hovered, when focused, and entirely for anyone who has asked
   their system for less motion.
*/
function picksHtml(product) {
  const image = product.images?.[0];
  const designs = product.designs?.options?.length ?? 0;

  return `
    <a class="pick" href="/p/${encodeURIComponent(product.handle)}">
      <span class="pick__media">
        ${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ''}
        ${designs ? `<span class="pick__count">${designs} designs</span>` : ''}
      </span>
      <span class="pick__title">${escapeHtml(product.title)}</span>
      <span class="pick__price">${formatPrice(product.price)}</span>
    </a>
  `;
}

/*
   Fisher-Yates, not list.sort(() => Math.random() - 0.5). The sort trick is
   the famous one and it is not a shuffle: comparison sorts call the comparator
   an unpredictable number of times, so some orderings come up far more often
   than others. Asked for extremely random, so it may as well actually be.
*/
function shuffle(list) {
  const out = [...list];

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

// Dealt once per page load and then kept. renderAll runs twice - once from the
// bundled catalog, again when the live one lands - and re-dealing on the
// second pass would visibly swap the row out a second after arriving, mid
// drift. Handles rather than products, so the live catalog's own copies are
// used once it arrives.
let pickedHandles = null;

// Chosen in the panel, or the first eight if nobody has chosen. A handle that
// no longer matches anything is skipped rather than leaving a hole - a piece
// can be hidden and shown again, so the choice is kept either way.
function featuredFrom(products) {
  const chosen = shopCopy?.curation?.featured ?? [];
  if (!chosen.length) return products.slice(0, 8);

  const byHandle = new Map(products.map((p) => [p.handle, p]));
  const picked = chosen.map((handle) => byHandle.get(handle)).filter(Boolean);

  // Everything chosen has gone. Falling back beats showing an empty row where
  // a row of pieces used to be.
  return picked.length ? picked : products.slice(0, 8);
}

/* How fast the row travels, in pixels a second. Slow enough to read a title on
   the way past, quick enough that the row is visibly alive. */
const PICKS_SPEED = 34;

// Cancels the drift already running. renderAll runs twice - once from the
// bundled catalog, again when the live one lands - and a second loop on the
// same track would drive it at double speed forever.
let picksDrift = null;

/* One more card on the end, chosen at random.

   Not one of the last few, though. A row that shows the same piece twice
   within one screen reads as a bug rather than as a shuffle, and at eight
   cards to a screen that would happen constantly. */
function appendPick(track, pool, recent) {
  const avoid = new Set(recent);
  const open = pool.filter((piece) => !avoid.has(piece.handle));
  const from = open.length ? open : pool;

  const product = from[Math.floor(Math.random() * from.length)];
  track.insertAdjacentHTML('beforeend', picksHtml(product));

  recent.push(product.handle);
  while (recent.length > Math.max(1, Math.min(6, pool.length - 1))) recent.shift();

  return track.lastElementChild;
}

/* How far the row has travelled, and how many cards that takes off the front.

   Pure, and separate from the DOM, because this is the part that can be subtly
   wrong: the offset must always come to rest somewhere inside the first card
   still in the row, never past it. Past it and the row jumps a card width in
   one frame. */
function advancePicks(offset, widths, distance) {
  let moved = offset + distance;
  let drop = 0;

  while (drop < widths.length && widths[drop] > 0 && widths[drop] <= moved) {
    moved -= widths[drop];
    drop += 1;
  }

  return { offset: moved, drop };
}

/* The row, drifting forever.

   It used to be the list rendered twice, travelling exactly half its own
   width. That is the usual way to build a marquee and it has two faults here.
   Eight cards is about one screen wide, so on a wide monitor the second copy
   ran out at the right-hand edge before the reset came - you watched it empty
   and refill. And it was the same eight pieces in the same order every time
   round, so the shuffle only happened once, when the page loaded.

   This recycles instead. A card that has fully left on the left is removed and
   a new random one is added on the right, which keeps the row exactly as long
   as it needs to be and means the sequence never repeats - there is no loop to
   come back round to. The drift is one number going up, so nothing ever jumps:
   dropping a card subtracts its own width from that number in the same frame
   it leaves.
*/
function driftPicks(viewport, track, pool) {
  const recent = [];

  let offset = 0;
  let previous = null;
  let frame = null;

  let onScreen = true;
  let held = false;

  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  // Cards are a fixed width, so this does not change when a photograph loads.
  const widthOf = (node) => node.getBoundingClientRect().width + gap;

  // Enough to cover the viewport with a card or two to spare, so there is
  // never a frame with nothing at the right-hand edge.
  function fill() {
    let total = 0;
    for (const card of track.children) total += widthOf(card);

    const needed = viewport.getBoundingClientRect().width + 400;

    // A guard, not a limit: a zero-width card would otherwise spin here
    // forever and take the tab with it.
    let guard = 80;
    while (total < needed && guard > 0) {
      total += widthOf(appendPick(track, pool, recent));
      guard -= 1;
    }
  }

  function step(now) {
    frame = requestAnimationFrame(step);

    // A tab that has been in the background hands back an enormous first
    // delta. Capped, or the row lurches a screen sideways on the way back.
    const elapsed = previous === null ? 0 : Math.min(now - previous, 100) / 1000;
    previous = now;

    if (held || !onScreen) return;

    const widths = Array.from(track.children, widthOf);
    const moved = advancePicks(offset, widths, PICKS_SPEED * elapsed);

    offset = moved.offset;

    // One off the front, one onto the back, so the row stays exactly as long
    // as it needs to be and the piece arriving is a fresh random one.
    for (let dropped = 0; dropped < moved.drop; dropped += 1) {
      track.firstElementChild?.remove();
      appendPick(track, pool, recent);
    }

    track.style.transform = `translate3d(${-offset}px, 0, 0)`;
  }

  // Held while someone is reading it or reaching for a card. Recycling is
  // inside the same guard, so a card cannot be removed from under a finger or
  // out of the middle of tabbing through them.
  const hold = () => { held = true; };
  const release = () => { held = false; };

  viewport.addEventListener('pointerenter', hold);
  viewport.addEventListener('pointerleave', release);
  viewport.addEventListener('focusin', hold);
  viewport.addEventListener('focusout', release);

  // No reason to run a loop for a row that has been scrolled past. The tab
  // being in the background is already handled - requestAnimationFrame stops
  // on its own - but a visible tab scrolled to the footer is not.
  let watcher = null;
  if ('IntersectionObserver' in window) {
    watcher = new IntersectionObserver(
      ([entry]) => { onScreen = entry.isIntersecting; },
      { rootMargin: '100px' }
    );
    watcher.observe(viewport);
  }

  const onResize = () => fill();
  window.addEventListener('resize', onResize);

  fill();
  frame = requestAnimationFrame(step);

  return () => {
    cancelAnimationFrame(frame);
    watcher?.disconnect();
    window.removeEventListener('resize', onResize);
    viewport.removeEventListener('pointerenter', hold);
    viewport.removeEventListener('pointerleave', release);
    viewport.removeEventListener('focusin', hold);
    viewport.removeEventListener('focusout', release);
  };
}

function renderPicks(products) {
  const section = document.querySelector('[data-picks]');
  const track = document.querySelector('[data-picks-track]');
  const viewport = track?.parentElement;
  if (!section || !track || !viewport) return;

  // Anything visible with a photograph. A piece with no photograph would draw
  // an empty frame in a row whose entire job is to be looked at.
  const eligible = products.filter((p) => p.hidden !== true && (p.images?.length ?? 0) > 0);

  const curation = shopCopy?.curation;

  // Chosen in the panel narrows what the row draws from; it does not stop the
  // row drifting. Choosing six pieces should mean those six go past forever,
  // not that the row shows six and stops.
  let pool = eligible;

  if (curation?.picksMode === 'chosen' && curation.picks?.length) {
    const byHandle = new Map(eligible.map((p) => [p.handle, p]));
    const chosen = curation.picks.map((handle) => byHandle.get(handle)).filter(Boolean);
    if (chosen.length) pool = chosen;
  }

  // Fewer than three and a drifting row looks broken rather than deliberate.
  if (pool.length < 3) {
    section.hidden = true;
    return;
  }

  section.hidden = false;

  picksDrift?.();
  picksDrift = null;

  track.innerHTML = '';
  track.style.transform = 'translate3d(0, 0, 0)';

  // Anyone who has asked their system for less motion gets the row as a plain
  // scrollable strip: every piece, once, going nowhere.
  if (REDUCED) {
    for (const product of shuffle(pool)) track.insertAdjacentHTML('beforeend', picksHtml(product));
    return;
  }

  picksDrift = driftPicks(viewport, track, pool);
}

function renderCollection() {
  const grid = document.querySelector('[data-collection]');
  if (!grid) return;

  const shown =
    activeFilter === 'all'
      ? shopProducts
      : shopProducts.filter((p) => p.category === activeFilter);

  renderFilters(document.querySelector('[data-filters]'), shopProducts, activeFilter);
  renderGrid(grid, shown);

  const note = document.querySelector('[data-filter-note]');
  if (note) {
    note.textContent =
      activeFilter === 'all'
        ? `${shown.length} pieces`
        : `${shown.length} ${shown.length === 1 ? 'piece' : 'pieces'}`;
  }
}

function renderAll(products) {
  shopProducts = products.filter((p) => p.hidden !== true);

  renderPicks(shopProducts);

  renderGrid(document.querySelector('[data-featured]'), featuredFrom(products));
  renderCollection();

  const detail = document.querySelector('[data-product-detail]');
  if (detail) {
    // /p/<handle> is the real address of a piece; ?handle= is the old one, kept
    // working so links already shared in a DM do not break.
    const fromPath = window.location.pathname.match(/\/p\/([^/]+)/);
    const handle =
      new URLSearchParams(window.location.search).get('handle') ??
      (fromPath ? decodeURIComponent(fromPath[1]) : null);
    const product = products.find((p) => p.handle === handle);

    if (!product) {
      detail.innerHTML = `
        <div class="not-found">
          <p class="label">Not found</p>
          <h2>That piece isn't in the catalog</h2>
          <p>It may have sold, or the link may be out of date.</p>
          <a class="btn btn-primary" href="collection.html">Back to the catalog</a>
        </div>
      `;
      const related = document.querySelector('[data-related-band]');
      if (related) related.style.display = 'none';
    } else {
      document.title = `${product.title} — Stitch Wishess`;
      detail.innerHTML = `
        <div class="gallery">${galleryHtml(product)}</div>
        <div>
          <p class="label">Stitch Wishess</p>
          <h1>${escapeHtml(product.title)}</h1>
          ${detailPriceHtml(product)}
          ${freeShippingNote()}

          <!-- Choose, then buy, then read. The descriptions here run to about
               1,100 characters, which on a phone put the add-to-bag button
               roughly twenty lines below the price - someone who had already
               decided had to scroll past the sales pitch to act on it. -->
          ${designStateHtml(product)}
          ${choicesHtml(product)}
          ${buyHtml(product)}

          <div class="detail__desc detail__desc--after"><p>${escapeHtml(product.description)}</p></div>
        </div>
      `;
      initGallery(detail, product);
      initBuy(detail, product);
      renderGrid(document.querySelector('[data-related]'), goesWellWith(product, products, 4));
    }
  }
}

// The thank-you page. Reached only by Stripe redirecting after a payment that
// went through, so this is the one place the bag is known to be spent and safe to
// empty. Clearing it any earlier would lose an order to a closed tab.
function initThanks() {
  const slot = document.querySelector('[data-reference]');
  if (!slot) return;

  window.StitchCart?.clear();

  const session = new URLSearchParams(window.location.search).get('session');
  if (!session) return;

  // The tail of the Stripe session id. Enough for Abi to find the payment if
  // someone quotes it, where the whole id reads like noise.
  slot.textContent = `Reference ${session.slice(-8).toUpperCase()}`;
  slot.hidden = false;
}

function initFilters() {
  const bar = document.querySelector('[data-filters]');
  if (!bar) return;

  bar.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;

    activeFilter = chip.dataset.filter;
    renderCollection();

    // Re-run the reveal animation on the cards that just appeared, or a
    // filtered grid arrives invisible.
    initReveals();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const bundled = window.STITCH_PRODUCTS || [];

  initThanks();
  initFilters();
  renderAll(bundled);
  initClouds();
  initThread();
  initReveals();

  const live = await fetchLiveProducts();

  // Repaint only on a real difference. Redrawing identical markup would reset
  // a gallery someone is already clicking through.
  if (!live || JSON.stringify(live) === JSON.stringify(bundled)) return;

  renderAll(live);
  initReveals();

  // The grids changed height, so the thread's bead positions are stale. It
  // re-measures on resize, which is exactly the recalculation needed here.
  window.dispatchEvent(new Event('resize'));
});
