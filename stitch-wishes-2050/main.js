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

// Every photograph the studio took of a piece, not just the first. Thumbnails
// are buttons rather than divs so the gallery works from the keyboard.
function galleryHtml(product) {
  const entries = galleryEntries(product);
  if (!entries.length) return emptyMediaHtml('detail__media');

  const main = `
    <div class="detail__media">
      <img src="${escapeHtml(entries[0].src)}" alt="${escapeHtml(product.title)}" data-gallery-main>
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
      <button class="thumb${index === 0 ? ' is-active' : ''}${design ? ' is-design' : ''}${sold ? ' is-gone' : ''}"
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

/* Every design photograph is also a gallery photograph — the measurement is
   in the catalog: overlap equals the design count on all eight pieces. So
   there is one strip, not two. A thumbnail IS the design; choosing one shows
   it large and selects it.

   A handful of pieces carry one extra photograph, the group shot of the whole
   set. It stays in the strip and stays viewable, but it is not something you
   can buy, so it does not select anything. */
function galleryEntries(product) {
  const byImage = new Map(designsOf(product).map((design) => [design.image, design]));
  const images = product.images ?? [];

  const entries = images.map((src) => ({ src, design: byImage.get(src) ?? null }));

  // Defensive: a design whose photograph is not among the gallery images would
  // otherwise be unreachable. Does not happen in this catalog, but a design
  // nobody can pick is a piece nobody can buy.
  for (const design of designsOf(product)) {
    if (!images.includes(design.image)) entries.push({ src: design.image, design });
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

  const price = design?.price ?? product.price;
  const priceNode = root.querySelector('.detail__price');
  if (priceNode) priceNode.textContent = formatPrice(price);

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
function assuranceHtml(product) {
  const madeToOrder = !Number.isFinite(product.stock);

  const postage =
    shopShipping && shopShipping.enabled !== false && Number(shopShipping.amount) > 0
      ? `${formatPrice(Number(shopShipping.amount))} flat postage`
      : 'Postage shown in your bag';

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
    if (data.shipping) shopShipping = data.shipping;

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

function renderPicks(products) {
  const section = document.querySelector('[data-picks]');
  const track = document.querySelector('[data-picks-track]');
  if (!section || !track) return;

  // Anything visible with a photograph. A piece with no photograph would draw
  // an empty frame in a row whose entire job is to be looked at.
  const eligible = products.filter((p) => p.hidden !== true && (p.images?.length ?? 0) > 0);

  const curation = shopCopy?.curation;

  if (curation?.picksMode === 'chosen' && curation.picks?.length) {
    // Chosen, and in the order they were chosen. Dealing them would throw away
    // the one thing choosing them was for.
    pickedHandles = curation.picks;
  } else if (!pickedHandles) {
    pickedHandles = shuffle(eligible)
      .slice(0, 8)
      .map((p) => p.handle);
  }

  // Ordered by the deal, not by catalog order, so the row itself is shuffled
  // rather than just its membership.
  const byHandle = new Map(eligible.map((p) => [p.handle, p]));
  const picks = pickedHandles.map((handle) => byHandle.get(handle)).filter(Boolean);

  // Fewer than three and a drifting row looks broken rather than deliberate.
  if (picks.length < 3) {
    section.hidden = true;
    return;
  }

  section.hidden = false;

  const once = picks.map(picksHtml).join('');

  // Twice, so the reset lands on an identical frame. aria-hidden on the copy,
  // or a screen reader reads the whole row a second time.
  track.innerHTML = `${once}<span class="picks__copy" aria-hidden="true">${once}</span>`;

  // Speed from the number of cards rather than a fixed duration, so the row
  // drifts at the same pace whether it holds four pieces or eight.
  track.style.setProperty('--picks-duration', `${picks.length * 7}s`);
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
          <p class="detail__price">${formatPrice(product.price)}</p>

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
