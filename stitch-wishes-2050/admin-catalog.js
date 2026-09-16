/* Stitch Wishess — the catalog editor.

   Two views that deliberately mirror the storefront: a grid that looks like
   /collection, and a piece editor that looks like /product. Editing something
   in the shape it will take removes the translation step a data table forces.

   Nothing reaches the server until Save. Until then edits live in a draft in
   localStorage, so a closed tab does not lose an afternoon's work. */

(function () {
  const DRAFT_KEY = 'sw_catalog_draft';

  const state = {
    products: [],      // the working copy
    saved: '',         // JSON of the last known server state, for dirty checks
    digest: null,
    assets: [],
    health: null,
    tab: 'catalog',    // 'catalog' | 'homepage'
    view: 'grid',      // 'grid' | 'piece'
    editing: null,     // handle being edited
    filter: 'all',
    picking: false,
    busy: false,
    dragFrom: null,   // index being dragged, or null
  };

  const el = {};

  /* ------------------------------------------------------------- helpers */

  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const money = (price) => (price == null ? 'No price' : `$${Number(price).toFixed(2)}`);

  const byHandle = (handle) => state.products.find((p) => p.handle === handle);

  const isDirty = () => JSON.stringify(state.products) !== state.saved;

  // Mirrors lib/catalog.mjs. The server validates regardless — this only
  // stops us proposing a handle the server would reject.
  function slugify(title) {
    return String(title ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function uniqueHandle(base) {
    const root = base || 'new-piece';
    if (!byHandle(root)) return root;

    let n = 2;
    while (byHandle(`${root}-${n}`)) n += 1;
    return `${root}-${n}`;
  }

  /* --------------------------------------------------------------- draft */

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ products: state.products, digest: state.digest }));
    } catch {
      // A full or blocked localStorage costs the draft, not the edit.
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to do */
    }
  };

  function touch() {
    saveDraft();
    renderStatus();
  }

  /* ------------------------------------------------------------- loading */

  async function load() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin-catalog', { credentials: 'same-origin' });

      if (response.status === 401) {
        window.location.reload();   // the gate will take it from here
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        fail(body.error || 'Could not load the catalog.');
        return;
      }

      const data = await response.json();
      console.info('[admin-catalog] loaded', {
        products: data.products?.length,
        assets: data.assets?.length,
        seeded: data.seeded,
        digest: data.digest,
      });
      state.assets = data.assets ?? [];
      state.health = data.health ?? null;
      state.digest = data.digest;
      state.saved = JSON.stringify(data.products ?? []);
      state.products = JSON.parse(state.saved);

      // A draft only belongs to the catalog it was taken from. If the store
      // has moved on since, the draft is stale and silently restoring it
      // would resurrect edits made against a different catalog.
      const draft = loadDraft();
      if (draft && draft.digest === data.digest && JSON.stringify(draft.products) !== state.saved) {
        state.products = draft.products;
      } else if (draft) {
        clearDraft();
      }

      if (!data.seeded) offerSeed();

      render();
    } catch (error) {
      // Distinguish a network failure from a crash while handling the reply.
      // Reporting both as "cannot reach" sent me hunting the wrong layer.
      renderFailure('the catalog load', error);
    } finally {
      setBusy(false);
    }
  }

  function offerSeed() {
    const bundled = window.STITCH_PRODUCTS;
    if (!Array.isArray(bundled) || !bundled.length) return;

    if (!state.products.length) {
      state.products = bundled.map((p) => ({ ...p, hidden: false }));
      toast(`Loaded ${bundled.length} pieces from the site. Nothing is saved until you press Save.`);
    }
  }

  /* --------------------------------------------------------------- save */

  async function save() {
    if (state.busy) return;
    setBusy(true);
    clearMessage();

    try {
      const response = await fetch('/api/admin-catalog', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: state.products, digest: state.digest }),
      });

      const body = await response.json().catch(() => ({}));

      if (response.ok) {
        state.saved = JSON.stringify(state.products);
        state.digest = body.digest ?? state.digest;
        state.health = body.health ?? state.health;
        clearDraft();
        toast('Saved. The site updates within about ten seconds.');
        render();
        return;
      }

      if (response.status === 400 && Array.isArray(body.errors)) {
        showFieldErrors(body.errors);
        return;
      }

      fail(body.error || 'The catalog could not be saved.');
    } catch {
      fail('Cannot reach the catalog service. Your edits are still here.');
    } finally {
      setBusy(false);
    }
  }

  function showFieldErrors(errors) {
    const lines = errors.map((e) => {
      const piece = e.index == null ? '' : `${state.products[e.index]?.title || 'A piece'}: `;
      return `${piece}${e.message}`;
    });
    fail(lines.join(' '));
  }

  /* ------------------------------------------------------------ mutation */

  function addPiece() {
    const piece = {
      handle: uniqueHandle('new-piece'),
      title: 'Untitled piece',
      price: null,
      description: '',
      images: [],
      hidden: true,   // new pieces start hidden so nothing half-made goes live
    };

    state.products.push(piece);
    touch();
    openPiece(piece.handle);
  }

  function removePiece(handle) {
    const piece = byHandle(handle);
    if (!piece) return;
    if (!window.confirm(`Remove "${piece.title}" from the catalog?`)) return;

    state.products = state.products.filter((p) => p.handle !== handle);
    touch();
    showGrid();
  }

  function updatePiece(handle, patch) {
    const piece = byHandle(handle);
    if (!piece) return;
    Object.assign(piece, patch);
    touch();
  }

  /* --------------------------------------------------------------- views */

  // A blank panel that explains nothing is worse than an error. Anything that
  // throws while drawing gets shown, in the page, with the detail needed to
  // act on it.
  function renderFailure(where, error) {
    const detail = error && error.stack ? error.stack : String(error);
    console.error(`[admin-catalog] ${where}`, error);

    if (!el.main) return;
    el.main.innerHTML = `
      <div class="admin-head"><div>
        <h1>The editor could not draw</h1>
        <p class="admin-sub">Something failed while rendering ${escapeHtml(where)}.
           Your saved catalog is untouched.</p>
      </div></div>
      <pre class="crash">${escapeHtml(detail)}</pre>
      <button class="btn btn-ghost" type="button" onclick="location.reload()">Reload</button>
    `;
  }

  function render() {
    try {
      renderStatus();
      if (state.view === 'piece' && byHandle(state.editing)) renderPiece();
      else renderGrid();
    } catch (error) {
      renderFailure(state.view === 'piece' ? 'a piece' : 'the catalog', error);
    }
  }

  function showTab(name) {
    state.tab = name;

    el.catalogPanel.hidden = name !== 'catalog';
    el.homepagePanel.hidden = name !== 'homepage';

    for (const button of document.querySelectorAll('[data-tab]')) {
      const on = button.dataset.tab === name;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
    }

    if (name === 'homepage') renderHomepage();
    else render();
  }

  // Placeholder until the homepage content model is designed. Says what it is
  // rather than showing an empty panel, which is the failure mode the catalog
  // already taught us.
  function renderHomepage() {
    el.homepagePanel.innerHTML = `
      <div class="admin-head"><div>
        <h1>The homepage</h1>
        <p class="admin-sub">Not wired up yet.</p>
      </div></div>
      <div class="gate__shell">
        <p>The homepage text lives inside <code>index.html</code> rather than in
           the catalog store, so there is nothing here to edit until it is
           pulled out into content the same way the pieces were.</p>
        <p>That is the next thing to build.</p>
      </div>
    `;
  }

  const showGrid = () => {
    state.view = 'grid';
    state.editing = null;
    render();
  };

  const openPiece = (handle) => {
    state.view = 'piece';
    state.editing = handle;
    render();
  };

  /* ---------------------------------------------------------- grid view */

  function matchesFilter(piece) {
    switch (state.filter) {
      case 'no-photo': return !piece.images?.length;
      case 'no-price': return piece.price == null;
      case 'hidden': return piece.hidden === true;
      default: return true;
    }
  }

  // Mirrors catalogHealth in lib/catalog.mjs. Duplicated deliberately: lib/
  // sits outside the static output directory, so the browser cannot import it,
  // and the numbers have to describe the draft you are editing rather than the
  // last saved state. Keep the two in step.
  function draftHealth() {
    const list = state.products;
    const used = new Set(list.flatMap((p) => p.images ?? []));

    return {
      total: list.length,
      hidden: list.filter((p) => p.hidden === true).length,
      noPhoto: list.filter((p) => !(p.images?.length > 0)).length,
      noPrice: list.filter((p) => p.price == null).length,
      unusedImages: state.assets.filter((path) => !used.has(path)),
    };
  }

  function cardHtml(piece, index) {
    const photo = piece.images?.[0];
    const media = photo
      ? `<div class="card__media"><img src="${escapeHtml(photo)}" alt="" loading="lazy">
           ${piece.images.length > 1 ? `<span class="card__count">${piece.images.length} photos</span>` : ''}
         </div>`
      : `<div class="card__media card__media--empty">No photograph</div>`;

    const flags = [
      piece.hidden ? '<span class="flag flag--hidden">Hidden</span>' : '',
      !piece.images?.length ? '<span class="flag">Needs a photo</span>' : '',
      piece.price == null ? '<span class="flag">Needs a price</span>' : '',
    ].join('');

    // Only draggable in the unfiltered view: in a filtered one the visible
    // positions do not correspond to positions in the catalog, so a drop would
    // land somewhere other than where it looked.
    const canDrag = state.filter === 'all';

    return `
      <div class="card admin-card${piece.hidden ? ' is-hidden' : ''}"
           ${canDrag ? 'draggable="true"' : ''}
           data-index="${index}" data-handle="${escapeHtml(piece.handle)}">
        <button class="admin-card__open" type="button" data-open="${escapeHtml(piece.handle)}">
          ${media}
          <div class="card__body">
            <h3 class="card__title">${escapeHtml(piece.title)}</h3>
            <p class="card__price">${escapeHtml(money(piece.price))}</p>
            ${flags ? `<div class="flags">${flags}</div>` : ''}
          </div>
        </button>
        ${canDrag ? '<span class="admin-card__grip" aria-hidden="true">drag to reorder</span>' : ''}
      </div>
    `;
  }

  /* ------------------------------------------------------------ reordering */

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // FLIP. The grid is rebuilt from scratch on every move, so cards would
  // otherwise teleport. Measure where each one was, let it be redrawn wherever
  // it now belongs, then start it back at the old place and let it travel.
  //
  // Keyed by handle rather than index: the indices are exactly what the move
  // changed, so they cannot identify anything across it.
  function cardRects() {
    const rects = new Map();
    for (const node of el.main.querySelectorAll('[data-handle]')) {
      rects.set(node.dataset.handle, node.getBoundingClientRect());
    }
    return rects;
  }

  function playFlip(before) {
    if (REDUCED) return;

    for (const node of el.main.querySelectorAll('[data-handle]')) {
      const was = before.get(node.dataset.handle);
      if (!was) continue;

      const now = node.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (!dx && !dy) continue;

      node.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 280, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }
      );
    }
  }

  // Positions are rewritten for the whole catalog on every move, so the order
  // is always fully explicit rather than half-alphabetical.
  function reorder(from, to) {
    if (from === to || from == null || to == null) return;

    const before = cardRects();

    const list = [...state.products];
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);

    state.products = list.map((piece, index) => ({ ...piece, position: index }));
    touch();
    renderGrid();

    playFlip(before);

    // A brief mark on the piece that moved, so it is obvious which one landed
    // when several slide at once.
    const landed = el.main.querySelector(`[data-handle="${CSS.escape(moved.handle)}"]`);
    landed?.classList.add('just-moved');
    landed?.addEventListener('animationend', () => landed.classList.remove('just-moved'), { once: true });
  }

  function cardIndex(node) {
    const card = node?.closest?.('[data-index]');
    return card ? Number(card.dataset.index) : null;
  }

  function onDragStart(event) {
    const index = cardIndex(event.target);
    if (index == null) return;

    state.dragFrom = index;
    event.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag unless something is set.
    event.dataTransfer.setData('text/plain', String(index));
    event.target.closest('[data-index]')?.classList.add('is-dragging');
  }

  function onDragOver(event) {
    if (state.dragFrom == null) return;
    event.preventDefault();

    const card = event.target.closest?.('[data-index]');
    for (const other of el.main.querySelectorAll('.is-over')) other.classList.remove('is-over');
    if (card && Number(card.dataset.index) !== state.dragFrom) card.classList.add('is-over');
  }

  function onDrop(event) {
    if (state.dragFrom == null) return;
    event.preventDefault();

    const to = cardIndex(event.target);
    const from = state.dragFrom;
    state.dragFrom = null;

    if (to != null) reorder(from, to);
  }

  function onDragEnd() {
    state.dragFrom = null;
    for (const node of el.main.querySelectorAll('.is-dragging, .is-over')) {
      node.classList.remove('is-dragging', 'is-over');
    }
  }

  function renderGrid() {
    const h = draftHealth();
    const filtering = state.filter !== 'all';

    // Indices are into state.products, not into the filtered view, so a drop
    // moves the piece you actually dragged.
    const cards = state.products
      .map((piece, index) => ({ piece, index }))
      .filter(({ piece }) => matchesFilter(piece))
      .map(({ piece, index }) => cardHtml(piece, index))
      .join('');

    el.main.innerHTML = `
      <div class="admin-head">
        <div>
          <h1>The catalog</h1>
          <p class="admin-sub">${state.products.length} pieces. Changes go live about ten seconds after you save.</p>
        </div>
        <dl class="stats">
          <div><dt>Pieces</dt><dd>${h.total}</dd></div>
          <div><dt>No photo</dt><dd>${h.noPhoto}</dd></div>
          <div><dt>No price</dt><dd>${h.noPrice}</dd></div>
          <div><dt>Hidden</dt><dd>${h.hidden}</dd></div>
          <div><dt>Unused images</dt><dd>${h.unusedImages.length}</dd></div>
        </dl>
      </div>

      <div class="filters" role="group" aria-label="Filter pieces">
        ${[['all', 'All'], ['no-photo', 'Needs a photo'], ['no-price', 'Needs a price'], ['hidden', 'Hidden']]
          .map(([key, label]) =>
            `<button class="chip${state.filter === key ? ' is-on' : ''}" type="button" data-filter="${key}">${label}</button>`)
          .join('')}
        ${filtering ? '<span class="filters__note">Showing all pieces lets you drag to reorder</span>' : ''}
      </div>

      <div class="grid" data-grid>
        <button class="card card--add" type="button" data-add>
          <span class="card--add__plus" aria-hidden="true">+</span>
          <span>Add a piece</span>
        </button>
        ${cards}
      </div>
    `;
  }

  /* --------------------------------------------------------- piece view */

  function galleryHtml(piece) {
    const photos = piece.images ?? [];

    const main = photos.length
      ? `<div class="detail__media"><img src="${escapeHtml(photos[0])}" alt=""></div>`
      : `<div class="detail__media card__media--empty">No photograph yet</div>`;

    const thumbs = photos
      .map(
        (src, i) => `
        <div class="edit-thumb${i === 0 ? ' is-primary' : ''}">
          <img src="${escapeHtml(src)}" alt="">
          <div class="edit-thumb__tools">
            ${i > 0 ? `<button type="button" data-primary="${i}" title="Make this the main photo">Main</button>` : '<span>Main</span>'}
            ${i > 0 ? `<button type="button" data-move="${i}" title="Move earlier">&larr;</button>` : ''}
            <button type="button" data-drop="${i}" title="Remove this photo">&times;</button>
          </div>
        </div>`
      )
      .join('');

    return `
      ${main}
      <div class="edit-thumbs">${thumbs}</div>
      <button class="btn btn-ghost" type="button" data-pick>Add photo</button>
    `;
  }

  function renderPiece() {
    const piece = byHandle(state.editing);

    el.main.innerHTML = `
      <button class="back" type="button" data-back>&larr; All pieces</button>

      <div class="detail">
        <div class="gallery">${galleryHtml(piece)}</div>

        <div class="edit-fields">
          <label class="label" for="f-title">Title</label>
          <input class="field field--title" id="f-title" value="${escapeHtml(piece.title)}" data-field="title">

          <label class="label" for="f-price">Price</label>
          <input class="field field--price" id="f-price" inputmode="decimal"
                 value="${piece.price == null ? '' : escapeHtml(piece.price)}"
                 placeholder="No price" data-field="price">

          <label class="label" for="f-desc">Description</label>
          <textarea class="field field--desc" id="f-desc" rows="9" data-field="description">${escapeHtml(piece.description)}</textarea>

          <label class="label" for="f-handle">Web address</label>
          <input class="field field--mono" id="f-handle" value="${escapeHtml(piece.handle)}" data-field="handle">
          <p class="hint">stitch-wishes.vercel.app/product?handle=<strong>${escapeHtml(piece.handle)}</strong></p>

          <div class="edit-actions">
            <label class="toggle">
              <input type="checkbox" data-field="hidden" ${piece.hidden ? 'checked' : ''}>
              <span>Hidden from the shop</span>
            </label>
            <button class="btn btn-ghost btn-danger" type="button" data-remove>Remove piece</button>
          </div>
        </div>
      </div>
    `;
  }

  /* -------------------------------------------------------- uploading */

  // 1600px matches the 60 photographs already in the catalog, which were
  // fetched at width=1600.
  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.82;

  // createImageBitmap handles far more than an <img> will, including HEIC on
  // iOS where the system can decode it. The <img> path is the fallback for
  // browsers without it.
  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file);
      } catch {
        // Some formats decode only through an <img>; fall through.
      }
    }

    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('This browser cannot read that image. Try a JPEG or PNG.'));
      };
      image.src = url;
    });
  }

  // Resizing here rather than on the server is what makes uploading from a
  // phone work at all: a raw photograph is 3-12 MB and Vercel caps a request
  // body at 4.5 MB. It also converts HEIC to JPEG on the way through, which is
  // why two photographs from the original catalog are missing.
  async function resizePhoto(file) {
    const source = await decodeImage(file);
    const width = source.width ?? source.naturalWidth;
    const height = source.height ?? source.naturalHeight;

    if (!width || !height) throw new Error('That image has no dimensions.');

    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not re-encode that image.'))),
        'image/jpeg',
        JPEG_QUALITY
      );
    });
  }

  async function uploadOne(file) {
    const resized = await resizePhoto(file);

    const response = await fetch('/api/admin-upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'image/jpeg' },
      body: resized,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The upload was refused.');

    return data.url;
  }

  async function onUploadChosen(event) {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    const status = $('[data-upload-status]', el.picker);
    const piece = byHandle(state.editing);
    let done = 0;

    const say = (text) => {
      if (!status) return;
      status.textContent = text;
      status.hidden = false;
    };

    for (const file of files) {
      say(`Adding photograph ${done + 1} of ${files.length}…`);

      try {
        const url = await uploadOne(file);
        // Attach as it arrives, so a failure part-way through still keeps
        // whatever already uploaded.
        state.assets = [url, ...state.assets];
        updatePiece(state.editing, { images: [...(piece.images ?? []), url] });
        done += 1;
      } catch (error) {
        say(error.message);
        renderPicker();
        return;
      }
    }

    input.value = '';   // so choosing the same file again still fires
    say(`Added ${done} photograph${done === 1 ? '' : 's'}.`);
    renderPicker();
  }

  /* -------------------------------------------------------- image picker */

  function renderPicker() {
    const piece = byHandle(state.editing);
    const used = new Set(piece.images ?? []);

    el.picker.innerHTML = `
      <div class="picker__panel" role="dialog" aria-modal="true" aria-label="Choose a photograph">
        <div class="picker__head">
          <h2>Choose a photograph</h2>
          <div class="picker__actions">
            <label class="btn btn-primary picker__upload">
              Upload photos
              <input type="file" accept="image/*" multiple data-upload>
            </label>
            <button class="btn btn-ghost" type="button" data-close-picker>Done</button>
          </div>
        </div>
        <p class="picker__status" data-upload-status hidden role="status"></p>
        <div class="picker__grid">
          ${state.assets
            .map(
              (src) => `
            <button class="picker__item${used.has(src) ? ' is-used' : ''}" type="button" data-use="${escapeHtml(src)}">
              <img src="${escapeHtml(src)}" alt="" loading="lazy">
              ${used.has(src) ? '<span class="picker__tick" aria-hidden="true">&check;</span>' : ''}
            </button>`
            )
            .join('')}
        </div>
      </div>
    `;
    el.picker.hidden = false;
  }

  const closePicker = () => {
    state.picking = false;
    el.picker.hidden = true;
    el.picker.innerHTML = '';
    renderPiece();
  };

  /* ------------------------------------------------------------- status */

  function renderStatus() {
    const dirty = isDirty();
    el.bar.hidden = !dirty;
    if (dirty) el.barText.textContent = 'Unsaved changes';
    el.save.disabled = state.busy;
  }

  const setBusy = (busy) => {
    state.busy = busy;
    document.body.classList.toggle('is-busy', busy);
    if (el.save) el.save.disabled = busy;
  };

  function toast(message) {
    el.message.textContent = message;
    el.message.className = 'admin-message is-good';
    el.message.hidden = false;
  }

  function fail(message) {
    el.message.textContent = message;
    el.message.className = 'admin-message is-bad';
    el.message.hidden = false;
  }

  const clearMessage = () => {
    el.message.hidden = true;
    el.message.textContent = '';
  };

  /* -------------------------------------------------------------- events */

  function onClick(event) {
    const hit = (attr) => event.target.closest(`[${attr}]`);
    const piece = byHandle(state.editing);

    const open = hit('data-open');
    if (open) return openPiece(open.dataset.open);

    if (hit('data-add')) return addPiece();
    if (hit('data-back')) return showGrid();

    const filter = hit('data-filter');
    if (filter) {
      state.filter = filter.dataset.filter;
      return renderGrid();
    }

    if (hit('data-remove')) return removePiece(state.editing);

    if (hit('data-pick')) {
      state.picking = true;
      return renderPicker();
    }
    if (hit('data-close-picker')) return closePicker();

    const use = hit('data-use');
    if (use) {
      const src = use.dataset.use;
      const images = piece.images ?? [];
      updatePiece(state.editing, {
        images: images.includes(src) ? images.filter((i) => i !== src) : [...images, src],
      });
      return renderPicker();
    }

    const primary = hit('data-primary');
    if (primary) {
      const i = Number(primary.dataset.primary);
      const images = [...piece.images];
      images.unshift(images.splice(i, 1)[0]);
      updatePiece(state.editing, { images });
      return renderPiece();
    }

    const move = hit('data-move');
    if (move) {
      const i = Number(move.dataset.move);
      const images = [...piece.images];
      [images[i - 1], images[i]] = [images[i], images[i - 1]];
      updatePiece(state.editing, { images });
      return renderPiece();
    }

    const drop = hit('data-drop');
    if (drop) {
      const images = piece.images.filter((_, i) => i !== Number(drop.dataset.drop));
      updatePiece(state.editing, { images });
      return renderPiece();
    }
  }

  // Typing updates the draft but never re-renders: rebuilding the form under
  // the cursor would move the caret to the end on every keystroke.
  function onInput(event) {
    const field = event.target.closest('[data-field]');
    if (!field || !state.editing) return;

    const name = field.dataset.field;
    const piece = byHandle(state.editing);
    if (!piece) return;

    if (name === 'hidden') piece.hidden = field.checked;
    else if (name === 'price') piece.price = field.value.trim() === '' ? null : Number(field.value);
    else if (name === 'handle') piece.handle = slugify(field.value) || piece.handle;
    else piece[name] = field.value;

    if (name === 'handle') state.editing = piece.handle;
    touch();
  }

  // The address line and card titles do need to follow the fields, but only
  // once typing stops.
  function onChange(event) {
    if (event.target.closest('[data-field="handle"]')) renderPiece();
  }

  /* ---------------------------------------------------------------- boot */

  function mount() {
    try {
      wire();
    } catch (error) {
      renderFailure('the editor shell', error);
    }
  }

  function wire() {
    el.main = $('[data-catalog]');
    el.catalogPanel = el.main;
    el.homepagePanel = $('[data-homepage]');

    for (const button of document.querySelectorAll('[data-tab]')) {
      button.addEventListener('click', () => showTab(button.dataset.tab));
    }

    el.bar = $('[data-savebar]');
    el.barText = $('[data-savebar-text]');
    el.save = $('[data-save]');
    el.message = $('[data-message]');
    el.picker = $('[data-picker]');

    el.main.addEventListener('click', onClick);
    el.main.addEventListener('input', onInput);
    el.main.addEventListener('change', onChange);
    el.main.addEventListener('dragstart', onDragStart);
    el.main.addEventListener('dragover', onDragOver);
    el.main.addEventListener('drop', onDrop);
    el.main.addEventListener('dragend', onDragEnd);
    el.picker.addEventListener('click', onClick);
    el.picker.addEventListener('change', (event) => {
      if (event.target.closest('[data-upload]')) onUploadChosen(event);
    });
    el.save.addEventListener('click', save);
    $('[data-discard]').addEventListener('click', () => {
      if (!window.confirm('Throw away every unsaved change?')) return;
      state.products = JSON.parse(state.saved);
      clearDraft();
      clearMessage();
      showGrid();
    });

    // Closing with unsaved work is almost always a mistake.
    window.addEventListener('beforeunload', (event) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.picking) closePicker();
    });

    load();
  }

  window.StitchAdminCatalog = { mount };
})();
