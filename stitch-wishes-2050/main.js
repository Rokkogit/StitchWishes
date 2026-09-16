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

  // The count tells you there is more to see before you open the piece —
  // several products carry ten photographs.
  const count =
    images.length > 1
      ? `<span class="card__count">${images.length} photos</span>`
      : '';

  return `
    <div class="${cls}">
      <img src="${escapeHtml(images[0])}" alt="${escapeHtml(product.title)}" loading="lazy">
      ${count}
    </div>
  `;
}

/* ---------------------------------------------------------------- gallery */

// Every photograph the studio took of a piece, not just the first. Thumbnails
// are buttons rather than divs so the gallery works from the keyboard.
function galleryHtml(product) {
  const images = product.images ?? [];
  if (!images.length) return emptyMediaHtml('detail__media');

  const main = `
    <div class="detail__media">
      <img src="${escapeHtml(images[0])}" alt="${escapeHtml(product.title)}" data-gallery-main>
    </div>
  `;

  if (images.length === 1) return main;

  const thumbs = images
    .map(
      (src, index) => `
      <button class="thumb${index === 0 ? ' is-active' : ''}" type="button"
              data-thumb="${escapeHtml(src)}"
              aria-label="Photograph ${index + 1} of ${images.length}">
        <img src="${escapeHtml(src)}" alt="" loading="lazy">
      </button>`
    )
    .join('');

  return `${main}<div class="thumbs">${thumbs}</div>`;
}

function initGallery(root) {
  const main = root.querySelector('[data-gallery-main]');
  const thumbs = Array.from(root.querySelectorAll('[data-thumb]'));
  if (!main || !thumbs.length) return;

  thumbs.forEach((thumb) => {
    thumb.addEventListener('click', () => {
      main.src = thumb.dataset.thumb;
      thumbs.forEach((other) => other.classList.toggle('is-active', other === thumb));
    });
  });
}

function cardHtml(product) {
  return `
    <a class="card" href="product.html?handle=${encodeURIComponent(product.handle)}">
      ${mediaHtml(product)}
      <div class="card__body">
        <h3 class="card__title">${escapeHtml(product.title)}</h3>
        <p class="card__price">${formatPrice(product.price)}</p>
      </div>
    </a>
  `;
}

function renderGrid(el, products) {
  if (el) el.innerHTML = products.map(cardHtml).join('');
}

function pickRandom(products, count, exclude) {
  const pool = products.filter((p) => p.handle !== exclude);
  const picked = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
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

async function fetchLiveProducts() {
  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) return null;          // 503 means "use your bundled copy"

    const data = await response.json();
    return Array.isArray(data.products) ? data.products : null;
  } catch {
    return null;
  }
}

function renderAll(products) {
  renderGrid(document.querySelector('[data-featured]'), products.slice(0, 8));
  renderGrid(document.querySelector('[data-collection]'), products);

  const detail = document.querySelector('[data-product-detail]');
  if (detail) {
    const handle = new URLSearchParams(window.location.search).get('handle');
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
          <div class="detail__desc"><p>${escapeHtml(product.description)}</p></div>
          <button class="btn btn-primary" type="button">Add to bag</button>
        </div>
      `;
      initGallery(detail);
      renderGrid(document.querySelector('[data-related]'), pickRandom(products, 4, product.handle));
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const bundled = window.STITCH_PRODUCTS || [];

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
