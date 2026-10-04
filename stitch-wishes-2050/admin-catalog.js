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
    settings: { shipping: { label: 'Shipping', amount: 0, enabled: false }, fees: [], tax: { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false } },
    saved: '',         // JSON of the last known server state, for dirty checks
    ordersFilter: 'toship',  // what still has to go out is the useful default
    content: null,     // the site's own words
    contentFields: [],  // how to draw the form, sent by the server
    themePresets: [],
    themeWarnings: [],
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

  // Settings count as unsaved work too: a changed fee with no catalog edit
  // must still light the save bar.
  // content included deliberately: without it, editing a headline would not
  // count as a change, the save bar would never appear, and the edit would be
  // silently lost on the next load.
  const snapshot = () =>
    JSON.stringify({ products: state.products, settings: state.settings, content: state.content });
  const isDirty = () => snapshot() !== state.saved;

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
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          products: state.products,
          settings: state.settings,
          content: state.content,
          digest: state.digest,
        })
      );
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
      state.settings = data.settings ?? state.settings;
      state.content = data.content ?? state.content;
      state.contentFields = data.contentFields ?? [];
      state.themePresets = data.themePresets ?? [];
      state.themeWarnings = data.themeWarnings ?? [];
      state.products = data.products ?? [];
      state.saved = snapshot();

      // A draft only belongs to the catalog it was taken from. If the store
      // has moved on since, the draft is stale and silently restoring it
      // would resurrect edits made against a different catalog.
      const draft = loadDraft();
      const draftSnapshot = draft
        ? JSON.stringify({
            products: draft.products,
            settings: draft.settings ?? state.settings,
            content: draft.content ?? state.content,
          })
        : null;

      if (draft && draft.digest === data.digest && draftSnapshot !== state.saved) {
        state.products = draft.products;
        if (draft.settings) state.settings = draft.settings;
        if (draft.content) state.content = draft.content;
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
        body: JSON.stringify({
          products: state.products,
          settings: state.settings,
          content: state.content,
          digest: state.digest,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (response.ok) {
        state.saved = snapshot();
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
      <button class="btn btn-ghost" type="button" data-reload>Reload</button>
    `;

    // Bound directly rather than written as an onclick attribute, which the
    // site's Content-Security-Policy blocks — and bound here rather than left to
    // the delegated handler, because the delegated handler is part of what may
    // just have crashed. This is the one button that has to work when nothing
    // else does.
    el.main
      .querySelector('[data-reload]')
      ?.addEventListener('click', () => location.reload());
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


  /* --------------------------------------------------------------- orders */
  /*
     Read from Stripe on demand rather than kept in state with the catalog.
     Orders are not something being edited, so there is nothing to hold, and a
     fresh read is the difference between seeing an order that arrived a minute
     ago and not.
  */

  function ordersHtml(body) {
    return `
      <div class="admin-head"><div>
        <h1>Orders</h1>
        <p class="admin-sub">What people have bought. Read live from Stripe.</p>
      </div>
      <button class="btn btn-ghost" type="button" data-orders-refresh>Refresh</button>
      </div>
      ${body}
    `;
  }

  function orderLineHtml(item) {
    const name = [item.title, item.designName].filter(Boolean).join(' — ');
    const choices = (item.choices ?? [])
      .map((choice) => `${escapeHtml(choice.label)}: ${escapeHtml(choice.value)}`)
      .join(', ');

    return `
      <li class="order__line">
        ${item.image ? `<img class="order__thumb" src="${escapeHtml(item.image)}" alt="">` : '<span class="order__thumb order__thumb--none"></span>'}
        <span class="order__what">
          <strong>${escapeHtml(name || 'Untitled piece')}</strong>
          ${choices ? `<span class="order__choices">${choices}</span>` : ''}
          ${item.handle ? `<span class="order__handle">${escapeHtml(item.handle)}</span>` : ''}
        </span>
        <span class="order__qty">&times;${item.quantity}</span>
        <span class="order__money">$${dollars(item.price * item.quantity)}</span>
      </li>
    `;
  }

  /* Whether the order reached a human being.

     Three states with three different fixes, and the one that matters most is
     the silent one: no marker at all means the webhook never ran, so Stripe is
     not calling the shop. That is invisible everywhere else - the order is
     here, the money is here, and nothing suggests anything is wrong. */
  function noticeFlag(order) {
    if (order.notifyError) return '<span class="flag flag--warn">email failed</span>';
    if (order.notifiedAt) return '<span class="flag flag--sent">emailed</span>';

    return '<span class="flag flag--warn">not emailed</span>';
  }

  function noticeNote(order) {
    if (order.notifiedAt && !order.notifyError) return '';

    if (order.notifyError) {
      return `<p class="hint hint--warn">This order was paid for but the email did not send:
              ${escapeHtml(order.notifyError)}. The order itself is safe &mdash; everything needed
              to make and post it is on this page.</p>`;
    }

    return `<p class="hint hint--warn">No email went out for this order, and nothing recorded why,
            which means Stripe never called the shop about it. Check Developers &rarr; Webhooks in
            Stripe: the endpoint must exist <strong>in the same mode as the payment</strong>, and
            STRIPE_WEBHOOK_SECRET must be that endpoint's secret. Test and live keep separate
            endpoints and separate secrets, so one set up before going live does not fire now.
            The order itself is safe &mdash; it is on this page either way.</p>`;
  }

  function orderHtml(order) {
    const when = order.placedAt
      ? new Date(order.placedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : 'date unknown';

    return `
      <article class="order">
        <header class="order__head">
          <div>
            <p class="order__ref">${escapeHtml(order.reference)}</p>
            <p class="order__when">${escapeHtml(when)}</p>
          </div>
          <div class="order__right">
            <p class="order__total">$${dollars(order.totals.total)}</p>
            ${order.live ? '' : '<span class="flag flag--test">test</span>'}
            ${noticeFlag(order)}
            ${order.shippedAt ? '<span class="flag flag--sent">sent</span>' : '<span class="flag flag--todo">to send</span>'}
          </div>
        </header>

        <ul class="order__lines">${order.items.map(orderLineHtml).join('')}</ul>

        ${noticeNote(order)}

        ${
          order.itemsFromStripe
            ? `<p class="hint hint--warn">The catalog could not name these, so they are
               shown as Stripe recorded them. Ordered: ${escapeHtml(
                 order.rawCart.map((line) => `${line.handle}${line.design ? ` (${line.design})` : ''} x${line.quantity}`).join(', ')
               )}</p>`
            : ''
        }

        <div class="order__foot">
          <div class="order__who">
            <p><strong>${escapeHtml(order.customer.name || 'No name given')}</strong></p>
            ${order.customer.email ? `<p><a href="mailto:${escapeHtml(order.customer.email)}">${escapeHtml(order.customer.email)}</a></p>` : ''}
            ${order.customer.phone ? `<p><a href="tel:${escapeHtml(order.customer.phone)}">${escapeHtml(order.customer.phone)}</a></p>` : ''}
            ${
              order.customer.address
                ? `<p class="order__address">${escapeHtml(order.customer.address)}</p>
                   <button class="btn btn-ghost order__copy" type="button"
                           data-copy-address="${escapeHtml(order.customer.address)}">Copy address</button>`
                : '<p class="hint hint--warn">No address recorded &mdash; ask before sending.</p>'
            }
          </div>

          <div class="order__sums">
            <div><span>Items</span><span>$${dollars(order.totals.subtotal)}</span></div>
            ${order.totals.shipping > 0 ? `<div><span>Shipping</span><span>$${dollars(order.totals.shipping)}</span></div>` : ''}
            ${order.totals.tax > 0 ? `<div><span>Tax</span><span>$${dollars(order.totals.tax)}</span></div>` : ''}
            <div class="order__sums-total"><span>Paid</span><span>$${dollars(order.totals.total)}</span></div>
            ${
              order.paymentIntent
                ? `<button class="btn ${order.shippedAt ? 'btn-ghost' : 'btn-primary'} order__ship"
                           type="button"
                           data-ship="${escapeHtml(order.paymentIntent)}"
                           data-ship-to="${order.shippedAt ? 'false' : 'true'}">
                     ${order.shippedAt ? 'Mark not sent' : 'Mark as sent'}
                   </button>`
                : ''
            }
            ${order.dashboard ? `<a class="order__stripe" href="${escapeHtml(order.dashboard)}" target="_blank" rel="noopener">Open in Stripe</a>` : ''}
          </div>
        </div>
      </article>
    `;
  }

  function renderOrders(data) {
    if (!data.configured) {
      el.ordersPanel.innerHTML = ordersHtml(`
        <p class="charges__empty">${escapeHtml(data.message || 'Payments are not switched on yet.')}</p>
      `);
      return;
    }

    if (!data.orders.length) {
      el.ordersPanel.innerHTML = ordersHtml(`
        <p class="charges__empty">Nothing yet. When someone buys something it appears here.</p>
      `);
      return;
    }

    const s = data.summary;

    el.ordersPanel.innerHTML = ordersHtml(`
      ${
        // Only while the shop is actually on a test key, and worded for a shop
        // that is open: this is not advice about setting up, it is a warning
        // that nothing on the page is money and nothing new can be. A single
        // old practice order among real ones is not this - that is marked on
        // the row itself, below, where it is precise and quiet.
        data.testMode
          ? `<p class="hint hint--warn">The Stripe key in use is a test key, so no order
             on this page is real money &mdash; and no new order can be.</p>`
          : ''
      }
      ${
        data.catalogOk
          ? ''
          : '<p class="hint hint--warn">The catalog store could not be reached, so pieces may be named as Stripe recorded them.</p>'
      }

      <p class="orders__summary">
        <strong>${s.count}</strong> order${s.count === 1 ? '' : 's'}
        &nbsp;&middot;&nbsp; <strong>$${dollars(s.total)}</strong> taken
        ${s.toShip ? `&nbsp;&middot;&nbsp; <strong class="orders__todo">${s.toShip} still to send</strong>` : '&nbsp;&middot;&nbsp; everything sent'}
      </p>

      <div class="filters">
        <button class="chip${state.ordersFilter === 'toship' ? ' is-on' : ''}" type="button" data-orders-filter="toship">
          To send <span class="chip__count">${s.toShip}</span>
        </button>
        <button class="chip${state.ordersFilter !== 'toship' ? ' is-on' : ''}" type="button" data-orders-filter="all">
          All <span class="chip__count">${s.count}</span>
        </button>
      </div>

      <div class="orders">${
        (state.ordersFilter === 'toship'
          ? data.orders.filter((order) => !order.shippedAt)
          : data.orders
        )
          .map(orderHtml)
          .join('') || '<p class="charges__empty">Nothing waiting to go out.</p>'
      }</div>

      ${data.hasMore ? '<button class="btn btn-ghost" type="button" data-orders-more>Show older orders</button>' : ''}
    `);
  }

  async function loadOrders(after = null) {
    if (!after) {
      el.ordersPanel.innerHTML = ordersHtml('<p class="charges__empty">Looking…</p>');
    }

    try {
      const response = await fetch(`/api/admin-orders${after ? `?after=${encodeURIComponent(after)}` : ''}`);
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        el.ordersPanel.innerHTML = ordersHtml(
          `<p class="hint hint--warn">${escapeHtml(body.error || 'Could not load orders.')}</p>`
        );
        return;
      }

      // Paging appends, so "show older" does not throw away what is on screen.
      if (after && state.orders) {
        body.orders = [...state.orders.orders, ...body.orders];
        body.summary = {
          ...body.summary,
          count: state.orders.summary.count + body.summary.count,
          total: Math.round((state.orders.summary.total + body.summary.total) * 100) / 100,
        };
      }

      state.orders = body;
      renderOrders(body);
    } catch {
      el.ordersPanel.innerHTML = ordersHtml(
        '<p class="hint hint--warn">Could not reach the shop to load orders.</p>'
      );
    }
  }

  async function setShipped(button) {
    const paymentIntent = button.dataset.ship;
    const shipped = button.dataset.shipTo === 'true';

    button.disabled = true;
    const was = button.textContent;
    button.textContent = shipped ? 'Marking\u2026' : 'Undoing\u2026';

    try {
      const response = await fetch('/api/admin-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntent, shipped }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        fail(body.error || 'Could not record that.');
        button.disabled = false;
        button.textContent = was;
        return;
      }

      // Re-read rather than patching the row by hand: the count in the header
      // and the filter both depend on it, and keeping three things in step
      // locally is how they drift.
      state.orders = null;
      await loadOrders();
      toast(shipped ? 'Marked as sent.' : 'Marked as not sent.');
    } catch {
      fail('Could not reach the shop.');
      button.disabled = false;
      button.textContent = was;
    }
  }

  async function copyAddress(button) {
    try {
      await navigator.clipboard.writeText(button.dataset.copyAddress);
      const was = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = was;
      }, 1200);
    } catch {
      // Clipboard access can be refused. The address is on screen and
      // selectable, so say that rather than failing silently.
      fail('Could not copy. Select the address and copy it by hand.');
    }
  }

  function onOrdersClick(event) {
    const filter = event.target.closest('[data-orders-filter]');
    if (filter) {
      state.ordersFilter = filter.dataset.ordersFilter;
      if (state.orders) renderOrders(state.orders);
      return;
    }

    const ship = event.target.closest('[data-ship]');
    if (ship) {
      setShipped(ship);
      return;
    }

    const copy = event.target.closest('[data-copy-address]');
    if (copy) {
      copyAddress(copy);
      return;
    }

    if (event.target.closest('[data-orders-refresh]')) {
      state.orders = null;
      loadOrders();
      return;
    }

    if (event.target.closest('[data-orders-more]')) {
      loadOrders(state.orders?.nextAfter ?? null);
    }
  }

  function showTab(name) {
    state.tab = name;

    el.catalogPanel.hidden = name !== 'catalog';
    el.ordersPanel.hidden = name !== 'orders';
    el.lookPanel.hidden = name !== 'look';
    el.checkoutPanel.hidden = name !== 'checkout';
    el.homepagePanel.hidden = name !== 'homepage';

    for (const button of document.querySelectorAll('[data-tab]')) {
      const on = button.dataset.tab === name;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
    }

    if (name === 'homepage') renderHomepage();
    else if (name === 'checkout') renderCheckout();
    else if (name === 'orders') loadOrders();
    else if (name === 'look') renderLook();
    else render();
  }

  // Placeholder until the homepage content model is designed. Says what it is
  // rather than showing an empty panel, which is the failure mode the catalog
  // already taught us.
  /* ------------------------------------------------------- the site's words */
  /*
     Every field the site shows outside a product: the homepage headline, the
     lede, Abi's story, the materials list, the lines under the buy button.
     They used to live inside the HTML, which is why this tab said "Not wired
     up yet" for as long as it did.

     The form draws itself from contentFields, which the server sends. The
     alternative - writing the fields out here - means two lists that must
     agree, and they stop agreeing the first time one is edited alone.
  */
  function contentFieldHtml(group, field) {
    const value = state.content?.[group]?.[field.key] ?? '';

    const input = field.long
      ? `<textarea class="field field--area" rows="3" maxlength="${field.max}"
             data-content="${escapeHtml(group)}" data-content-key="${escapeHtml(field.key)}"
             >${escapeHtml(value)}</textarea>`
      : `<input class="field" type="text" maxlength="${field.max}"
             value="${escapeHtml(value)}"
             data-content="${escapeHtml(group)}" data-content-key="${escapeHtml(field.key)}">`;

    return `
      <label class="content-row">
        <span class="label">${escapeHtml(field.label)}</span>
        ${input}
      </label>
    `;
  }

  function materialsHtml() {
    const list = state.content?.maker?.materials ?? [];

    const rows = list
      .map(
        (item, i) => `
        <div class="material" data-material-index="${i}">
          <input class="field" type="text" value="${escapeHtml(item)}" maxlength="120"
                 data-material="${i}">
          <button class="btn btn-ghost btn-danger" type="button" data-drop-material="${i}"
                  aria-label="Remove">&times;</button>
        </div>`
      )
      .join('');

    return `
      <section class="charges">
        <p class="label">What goes in</p>
        ${rows || '<p class="charges__empty">Nothing listed yet.</p>'}
        <button class="btn btn-ghost" type="button" data-add-material>Add a material</button>
        <p class="hint">Shown as a list on The Maker page.</p>
      </section>
    `;
  }

  /* ------------------------------------------------------------ categories */
  /*
     Labels are editable; ids are not. A product points at an id, so changing
     one would quietly unfile every piece in that category. Renaming is a word
     change and safe; the id is the identity.
  */
  function categoriesHtml() {
    const list = state.content?.categories ?? [];

    const rows = list
      .map(
        (category, i) => `
        <div class="material">
          <input class="field" type="text" value="${escapeHtml(category.label)}" maxlength="120"
                 data-category-label="${i}" aria-label="Name">
          <button class="btn btn-ghost btn-danger" type="button"
                  data-drop-category="${i}" aria-label="Remove">&times;</button>
        </div>`
      )
      .join('');

    return `
      <section class="charges">
        <p class="label">Kinds of thing</p>
        ${rows || '<p class="charges__empty">None yet.</p>'}
        <button class="btn btn-ghost" type="button" data-add-category>Add a kind</button>
        <p class="hint">
          These are the filter chips on the catalog page. Renaming one is safe.
          Removing one leaves any piece filed under it showing under no chip.
        </p>
      </section>
    `;
  }

  /* -------------------------------------------------------------- curation */
  function pickerHtml(name, chosen, limit) {
    const picked = new Set(chosen);

    const options = state.products
      .filter((piece) => !piece.hidden)
      .map(
        (piece) => `
        <label class="pickbox${picked.has(piece.handle) ? ' is-on' : ''}">
          <input type="checkbox" ${picked.has(piece.handle) ? 'checked' : ''}
                 data-curate="${escapeHtml(name)}" value="${escapeHtml(piece.handle)}">
          <span>${escapeHtml(piece.title)}</span>
        </label>`
      )
      .join('');

    return `
      <div class="pickboxes">${options}</div>
      <p class="hint">${chosen.length} chosen${limit ? ` of ${limit} shown` : ''}. Leave none selected to decide automatically.</p>
    `;
  }

  function curationHtml() {
    const curation = state.content?.curation ?? { featured: [], picks: [], picksMode: 'random' };

    return `
      <section class="charges">
        <p class="label">On the front page</p>
        ${pickerHtml('featured', curation.featured ?? [], 8)}
      </section>

      <section class="charges">
        <p class="label">Our picks, on the catalog page</p>

        <label class="toggle charges__sub">
          <input type="checkbox" data-picks-mode ${curation.picksMode === 'chosen' ? 'checked' : ''}>
          <span>Choose them myself</span>
        </label>

        ${
          curation.picksMode === 'chosen'
            ? pickerHtml('picks', curation.picks ?? [], 0)
            : '<p class="hint">A different handful of pieces every time someone looks.</p>'
        }
      </section>
    `;
  }

  /* =================================================================
     The Look tab - colour, shape and which sections appear.
     ================================================================= */
  /*
     The stylesheet reads every colour, corner and spacing step from a custom
     property, so this changes the entire site without touching a rule.

     Presets rather than a blank colour picker. A picker with nine swatches and
     no starting point produces something worse than the design it replaced;
     five palettes that were actually designed, each adjustable afterwards, is
     the version someone can use.
  */
  const THEME_COLOURS = [
    ['paper', 'Background'],
    ['ink', 'Text'],
    ['aurora', 'Accent one'],
    ['periwinkle', 'Accent two'],
    ['lilac', 'Accent three'],
    ['blossom', 'Accent four'],
    ['peach', 'Accent five'],
    ['mint', 'Accent six'],
  ];

  const THEME_SECTIONS = [
    ['hero', 'Big headline on the front page'],
    ['featured', 'Row of pieces on the front page'],
    ['maker', 'Abi’s section on the front page'],
    ['picks', 'Our picks on the catalog page'],
  ];

  function theme() {
    return state.content?.theme ?? null;
  }

  function setTheme(patch) {
    state.content = {
      ...state.content,
      theme: { ...state.content.theme, ...patch },
    };
    touch();
    renderLook();
  }

  function renderLook() {
    const t = theme();
    if (!t) {
      el.lookPanel.innerHTML = '<p class="charges__empty">Loading…</p>';
      return;
    }

    const presets = (state.themePresets ?? [])
      .map(
        (preset) => `
        <button class="preset${t.preset === preset.id ? ' is-on' : ''}" type="button"
                data-preset="${escapeHtml(preset.id)}">
          <span class="preset__swatches">
            ${['paper', 'aurora', 'lilac', 'blossom', 'ink']
              .map((key) => `<span style="background:${escapeHtml(preset.tokens[key])}"></span>`)
              .join('')}
          </span>
          <span class="preset__name">${escapeHtml(preset.label)}</span>
          <span class="preset__note">${escapeHtml(preset.note)}</span>
        </button>`
      )
      .join('');

    const base = (state.themePresets ?? []).find((p) => p.id === t.preset)?.tokens ?? {};

    const colours = THEME_COLOURS.map(([key, label]) => {
      const value = t.tokens?.[key] ?? base[key] ?? '#000000';
      const changed = Boolean(t.tokens?.[key]);

      return `
        <label class="swatchrow">
          <input type="color" value="${escapeHtml(value)}" data-theme-colour="${escapeHtml(key)}">
          <span>${escapeHtml(label)}</span>
          ${changed ? `<button class="btn btn-ghost swatchrow__reset" type="button" data-reset-colour="${escapeHtml(key)}">Reset</button>` : ''}
        </label>
      `;
    }).join('');

    const warnings = (state.themeWarnings ?? [])
      .map((warning) => `<p class="hint hint--warn">${escapeHtml(warning)}</p>`)
      .join('');

    el.lookPanel.innerHTML = `
      <div class="admin-head"><div>
        <h1>Look</h1>
        <p class="admin-sub">Colour, shape, and what appears where.</p>
      </div></div>

      <section class="charges">
        <p class="label">Start from</p>
        <div class="presets">${presets}</div>
        <p class="hint">Pick one, then change anything you like underneath.</p>
      </section>

      <section class="charges">
        <p class="label">Colours</p>
        <div class="swatches-grid">${colours}</div>
        ${warnings}
      </section>

      <section class="charges">
        <p class="label">Shape</p>

        <label class="content-row">
          <span class="label">Corner roundness &mdash; ${t.radius}px</span>
          <input type="range" min="0" max="40" value="${t.radius}" data-theme-radius>
        </label>

        <label class="content-row">
          <span class="label">Spacing</span>
          <select class="field" data-theme-density>
            ${['tight', 'normal', 'airy']
              .map((d) => `<option value="${d}"${t.density === d ? ' selected' : ''}>${d}</option>`)
              .join('')}
          </select>
        </label>
      </section>

      <section class="charges">
        <p class="label">Sections</p>
        ${THEME_SECTIONS.map(
          ([key, label]) => `
          <label class="toggle charges__sub">
            <input type="checkbox" data-theme-section="${key}" ${t.sections?.[key] !== false ? 'checked' : ''}>
            <span>${escapeHtml(label)}</span>
          </label>`
        ).join('')}
        <p class="hint">Switching one off hides it. Nothing is deleted.</p>
      </section>

      <p class="hint">
        Changes show on the shop after you press Save.
        <a href="index.html" target="_blank" rel="noopener">Open the shop &rarr;</a>
      </p>
    `;
  }

  function onLookInput(event) {
    const colour = event.target.closest('[data-theme-colour]');
    if (colour) {
      setTheme({ tokens: { ...theme().tokens, [colour.dataset.themeColour]: colour.value } });
      return;
    }

    const radius = event.target.closest('[data-theme-radius]');
    if (radius) {
      setTheme({ radius: Number(radius.value) });
      return;
    }

    const density = event.target.closest('[data-theme-density]');
    if (density) setTheme({ density: density.value });
  }

  function onLookClick(event) {
    state.pressing = false;

    const preset = event.target.closest('[data-preset]');
    if (preset) {
      // Switching preset clears the overrides. Keeping them would mean picking
      // a new palette and seeing most of the old one, which reads as broken.
      setTheme({ preset: preset.dataset.preset, tokens: {} });
      return;
    }

    const reset = event.target.closest('[data-reset-colour]');
    if (reset) {
      const tokens = { ...theme().tokens };
      delete tokens[reset.dataset.resetColour];
      setTheme({ tokens });
      return;
    }

    const section = event.target.closest('[data-theme-section]');
    if (section) {
      setTheme({
        sections: { ...theme().sections, [section.dataset.themeSection]: section.checked },
      });
    }
  }

  function renderHomepage() {
    if (!state.content) {
      el.homepagePanel.innerHTML = '<p class="charges__empty">Loading…</p>';
      return;
    }

    const groups = (state.contentFields ?? [])
      .map(
        (group) => `
        <section class="charges">
          <p class="label">${escapeHtml(group.label)}</p>
          ${group.fields.map((field) => contentFieldHtml(group.group, field)).join('')}
        </section>`
      )
      .join('');

    el.homepagePanel.innerHTML = `
      <div class="admin-head"><div>
        <h1>Words</h1>
        <p class="admin-sub">Everything the site says outside of a piece.</p>
      </div></div>

      ${groups}
      ${materialsHtml()}
      ${categoriesHtml()}
      ${curationHtml()}

      <p class="hint">
        Leave a field empty and it goes back to what it said before rather than
        publishing a blank heading.
      </p>
    `;
  }

  function onHomepageInput(event) {
    const field = event.target.closest('[data-content]');
    if (field) {
      const group = field.dataset.content;
      const key = field.dataset.contentKey;

      state.content = {
        ...state.content,
        [group]: { ...state.content[group], [key]: field.value },
      };

      touch();
      return;
    }

    const categoryLabel = event.target.closest('[data-category-label]');
    if (categoryLabel) {
      const index = Number(categoryLabel.dataset.categoryLabel);
      const list = [...(state.content.categories ?? [])];
      list[index] = { ...list[index], label: categoryLabel.value };

      state.content = { ...state.content, categories: list };
      touch();
      return;
    }

    const material = event.target.closest('[data-material]');
    if (material) {
      const index = Number(material.dataset.material);
      const list = [...(state.content.maker.materials ?? [])];
      list[index] = material.value;

      state.content = {
        ...state.content,
        maker: { ...state.content.maker, materials: list },
      };

      touch();
    }
  }

  function onHomepageClick(event) {
    state.pressing = false;

    if (event.target.closest('[data-add-material]')) {
      state.content = {
        ...state.content,
        maker: {
          ...state.content.maker,
          materials: [...(state.content.maker.materials ?? []), ''],
        },
      };

      touch();
      renderHomepage();

      // Land the cursor in the new row rather than making her hunt for it.
      const rows = el.homepagePanel.querySelectorAll('[data-material]');
      rows[rows.length - 1]?.focus();
      return;
    }

    const curate = event.target.closest('[data-curate]');
    if (curate) {
      const name = curate.dataset.curate;
      const current = state.content.curation?.[name] ?? [];

      const next = curate.checked
        ? [...current, curate.value]
        : current.filter((handle) => handle !== curate.value);

      state.content = {
        ...state.content,
        curation: { ...state.content.curation, [name]: next },
      };

      touch();
      renderHomepage();
      return;
    }

    const mode = event.target.closest('[data-picks-mode]');
    if (mode) {
      state.content = {
        ...state.content,
        curation: {
          ...state.content.curation,
          picksMode: mode.checked ? 'chosen' : 'random',
        },
      };

      touch();
      renderHomepage();
      return;
    }

    if (event.target.closest('[data-add-category]')) {
      const list = [...(state.content.categories ?? [])];

      // An id that cannot collide with an existing one, and that never changes
      // again - products will point at it.
      const id = `kind-${Date.now().toString(36)}`;
      list.push({ id, label: 'New kind' });

      state.content = { ...state.content, categories: list };
      touch();
      renderHomepage();

      const rows = el.homepagePanel.querySelectorAll('[data-category-label]');
      rows[rows.length - 1]?.select();
      return;
    }

    const dropCategory = event.target.closest('[data-drop-category]');
    if (dropCategory) {
      const index = Number(dropCategory.dataset.dropCategory);
      const category = state.content.categories[index];
      const filed = state.products.filter((piece) => piece.category === category.id).length;

      if (filed && !window.confirm(`${filed} piece${filed === 1 ? '' : 's'} are filed under "${category.label}". Remove it anyway? They will show under no chip.`)) {
        return;
      }

      state.content = {
        ...state.content,
        categories: state.content.categories.filter((_, i) => i !== index),
      };

      touch();
      renderHomepage();
      return;
    }

    const drop = event.target.closest('[data-drop-material]');
    if (drop) {
      const index = Number(drop.dataset.dropMaterial);
      const list = (state.content.maker.materials ?? []).filter((_, i) => i !== index);

      state.content = {
        ...state.content,
        maker: { ...state.content.maker, materials: list },
      };

      touch();
      renderHomepage();
    }
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
      piece.stock === 0 ? '<span class="flag flag--sold">Sold out</span>' : '',
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

      ${(() => {
        const { pieces, designs } = importableCount();
        return pieces
          ? `<div class="import-note">
               <p><strong>${designs} designs</strong> from the original catalog are not on
                  ${pieces} of your pieces yet — the versions each one comes in, with the
                  photograph for each.</p>
               <button class="btn btn-primary" type="button" data-import-designs>Add them</button>
             </div>`
          : '';
      })()}

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

  /* Why the price in this box is the whole price.

     Nothing is added to it at checkout - postage is already meant to be inside
     it. So this is the number a customer pays, and if it does not cover the
     stamp, nothing else will. */
  function shownPriceHint(price) {
    const s = state.settings ?? {};
    const free = s.shipping?.enabled === false || s.shipping?.includedInPrices !== false;

    if (!free) {
      const amount = Number(s.shipping?.amount) || 0;
      return amount > 0
        ? `<p class="hint">$${dollars(amount)} postage is added to this at checkout.</p>`
        : '';
    }

    return `<p class="hint">What the customer pays. Shipping is free, so nothing is added to
            this at checkout &mdash; make sure it covers the postage.</p>`;
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
          ${shownPriceHint(piece.price)}

          <label class="label" for="f-stock">How many are there</label>
          <input class="field field--mono" id="f-stock" inputmode="numeric"
                 value="${piece.stock == null ? '' : escapeHtml(piece.stock)}"
                 placeholder="Made to order" data-field="stock">
          <p class="hint">${
            piece.stock == null
              ? 'Leave empty for made to order — it never sells out.'
              : piece.stock === 0
                ? 'Sold out. It stays on the site but cannot be bought.'
                : `${piece.stock} left. The site stops selling it at zero.`
          }</p>

          <label class="label" for="f-desc">Description</label>
          <textarea class="field field--desc" id="f-desc" rows="9" data-field="description">${escapeHtml(piece.description)}</textarea>

          ${designsHtml(piece)}

          <label class="label" for="f-category">Kind</label>
          <select class="field" id="f-category" data-field="category">
            <option value="">Not filed anywhere</option>
            ${(state.content?.categories ?? [])
              .map(
                (category) => `<option value="${escapeHtml(category.id)}"${
                  piece.category === category.id ? ' selected' : ''
                }>${escapeHtml(category.label)}</option>`
              )
              .join('')}
          </select>
          <p class="hint">Decides which filter chip it appears under in the catalog.</p>

          <label class="label" for="f-handle">Web address</label>
          <input class="field field--mono" id="f-handle" value="${escapeHtml(piece.handle)}" data-field="handle">
          <p class="hint">${escapeHtml(location.host)}/p/<strong>${escapeHtml(piece.handle)}</strong></p>

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


  /* ------------------------------------------- importing designs -------- */

  /* The catalog that ships with the site carries designs built from the
     original Shopify data — the photograph each variant pointed at. The live
     catalog is edited separately, so those have to be brought across
     deliberately rather than appearing on their own. */

  const bundledByHandle = () =>
    new Map((window.STITCH_PRODUCTS ?? []).map((piece) => [piece.handle, piece]));

  // Only pieces that have none. Designs someone has already set up are never
  // replaced — an import that overwrote real work would be unforgivable.
  function importableCount() {
    const bundled = bundledByHandle();
    let pieces = 0;
    let designs = 0;

    for (const piece of state.products) {
      const source = bundled.get(piece.handle);
      if (!source?.designs?.options?.length) continue;
      if (piece.designs?.options?.length) continue;

      pieces += 1;
      designs += source.designs.options.length;
    }

    return { pieces, designs };
  }

  function importDesigns() {
    const bundled = bundledByHandle();
    let pieces = 0;
    let designs = 0;

    for (const piece of state.products) {
      const source = bundled.get(piece.handle);
      if (!source?.designs?.options?.length) continue;
      if (piece.designs?.options?.length) continue;

      piece.designs = structuredClone(source.designs);
      if (source.choices?.length && !piece.choices?.length) {
        piece.choices = structuredClone(source.choices);
      }

      pieces += 1;
      designs += piece.designs.options.length;
    }

    touch();
    renderGrid();
    toast(
      `Added ${designs} designs across ${pieces} pieces. They are named Design 1, 2, 3 — ` +
        `rename them to what they actually are. Nothing is saved until you press Save.`
    );
  }

  /* ------------------------------------------------------------- designs */

  /* A design is a photograph with a name, and optionally its own price and its
     own stock. That shape comes from the catalog itself: the source data calls
     these "Option 1" through "Option 10" while 55 of 61 carry their own
     picture, so the picture is what a customer actually chooses between. */

  const newDesignId = () =>
    `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const designsOf = (piece) => piece?.designs?.options ?? [];

  function designRowHtml(design, index, piece) {
    // Blank means "same as the piece", which is different from zero.
    const price = design.price == null ? '' : design.price;
    const stock = design.stock == null ? '' : design.stock;

    return `
      <div class="design-row" data-design-index="${index}">
        <div class="design-row__pic"><img src="${escapeHtml(design.image)}" alt=""></div>

        <input class="field design-row__name" value="${escapeHtml(design.name ?? '')}"
               placeholder="What is this one called?" aria-label="Name"
               data-design-field="name">

        <div class="design-row__num">
          <span aria-hidden="true">$</span>
          <input class="field field--mono" inputmode="decimal" value="${escapeHtml(price)}"
                 placeholder="${escapeHtml(piece.price ?? '—')}" aria-label="Price"
                 data-design-field="price">
        </div>

        <div class="design-row__num">
          <input class="field field--mono" inputmode="numeric" value="${escapeHtml(stock)}"
                 placeholder="&#8734;" aria-label="How many" data-design-field="stock">
        </div>

        <button class="design-row__drop" type="button" data-drop-design
                aria-label="Remove this design">&times;</button>
      </div>
    `;
  }

  function designsHtml(piece) {
    const designs = designsOf(piece);

    return `
      <div class="designs-edit">
        <p class="label">Designs</p>

        ${designs.length
          ? `<div class="design-head">
               <span></span><span>Name</span><span>Price</span><span>Stock</span><span></span>
             </div>
             ${designs.map((d, i) => designRowHtml(d, i, piece)).join('')}`
          : `<p class="hint">
               No designs. Add some if this piece comes in several versions and
               a customer needs to pick one by looking at it.
             </p>`}

        <button class="btn btn-ghost" type="button" data-add-designs>Add designs</button>

        ${designs.length
          ? `<p class="hint">
               Leave price empty to use the piece price. Leave stock empty for
               made to order. Zero means that one design is sold out while the
               others stay on sale.
             </p>`
          : ''}
      </div>
    `;
  }

  // Adding designs reuses the photo picker: they are photographs, and there is
  // no reason to invent a second way of choosing one.
  function addDesignsFrom(paths) {
    const piece = byHandle(state.editing);
    if (!piece) return;

    const existing = designsOf(piece);
    const already = new Set(existing.map((design) => design.image));

    const added = paths
      .filter((path) => !already.has(path))
      .map((path) => ({ id: newDesignId(), name: '', image: path, price: null, stock: null }));

    if (!added.length) return;

    piece.designs = {
      label: piece.designs?.label || 'Design',
      options: [...existing, ...added],
    };

    touch();
  }

  function onDesignInput(event) {
    const field = event.target.closest('[data-design-field]');
    if (!field) return;

    const index = Number(field.closest('[data-design-index]').dataset.designIndex);
    const design = designsOf(byHandle(state.editing))[index];
    if (!design) return;

    const name = field.dataset.designField;
    const blank = field.value.trim() === '';

    // Empty is a real value here: it means "inherit the piece" for price and
    // "made to order" for stock. Coercing it to zero would price something at
    // nothing, or take it off sale.
    if (name === 'price') design.price = blank ? null : Number(field.value);
    else if (name === 'stock') design.stock = blank ? null : Number(field.value);
    else design.name = field.value;

    touch();
  }

  function onDesignClick(event) {
    if (event.target.closest('[data-add-designs]')) {
      state.picking = 'designs';
      renderPicker();
      return true;
    }

    const drop = event.target.closest('[data-drop-design]');
    if (drop) {
      const index = Number(drop.closest('[data-design-index]').dataset.designIndex);
      const piece = byHandle(state.editing);
      const design = designsOf(piece)[index];

      if (design?.name && !window.confirm(`Remove the "${design.name}" design?`)) return true;

      const rest = designsOf(piece).filter((_, i) => i !== index);
      piece.designs = rest.length ? { ...piece.designs, options: rest } : null;

      touch();
      renderPiece();
      return true;
    }

    return false;
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
    const forDesigns = state.picking === 'designs';

    // A tick means "already on this piece", which is a different set depending
    // on what the picker was opened for.
    const used = new Set(
      forDesigns ? designsOf(piece).map((d) => d.image) : piece.images ?? []
    );

    el.picker.innerHTML = `
      <div class="picker__panel" role="dialog" aria-modal="true" aria-label="Choose a photograph">
        <div class="picker__head">
          <h2>${forDesigns ? 'Choose designs' : 'Choose a photograph'}</h2>
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

    if (onDesignClick(event)) return;

    const open = hit('data-open');
    if (open) return openPiece(open.dataset.open);

    if (hit('data-add')) return addPiece();
    if (hit('data-import-designs')) return importDesigns();
    if (hit('data-back')) return showGrid();

    const filter = hit('data-filter');
    if (filter) {
      state.filter = filter.dataset.filter;
      return renderGrid();
    }

    if (hit('data-remove')) return removePiece(state.editing);

    if (hit('data-pick')) {
      state.picking = 'images';
      return renderPicker();
    }
    if (hit('data-close-picker')) return closePicker();

    const use = hit('data-use');
    if (use) {
      const src = use.dataset.use;

      // The same picker serves two jobs: choosing the photographs shown in the
      // gallery, and choosing which photographs become designs.
      if (state.picking === 'designs') {
        addDesignsFrom([src]);
        return renderPicker();
      }

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
    if (event.target.closest('[data-design-field]')) return onDesignInput(event);

    const field = event.target.closest('[data-field]');
    if (!field || !state.editing) return;

    const name = field.dataset.field;
    const piece = byHandle(state.editing);
    if (!piece) return;

    // A new piece is born at /p/new-piece and only gets a decent address if
    // somebody thinks to edit the handle. So while the handle is still the
    // untouched default, it follows the title - the way every shop does it.
    // The moment it is edited by hand it stops following, because an address
    // somebody chose should not be rewritten under them.
    if (name === 'title' && /^new-piece(-\d+)?$/.test(piece.handle)) {
      const derived = slugify(field.value);
      if (derived) {
        piece.handle = uniqueHandle(derived);
        state.editing = piece.handle;
      }
    }

    if (name === 'hidden') piece.hidden = field.checked;
    // Empty means made to order, not zero. Zero means sold out, and treating
    // a cleared box as sold out would take the piece off sale by accident.
    else if (name === 'stock') piece.stock = field.value.trim() === '' ? null : Number(field.value);
    else if (name === 'price') piece.price = field.value.trim() === '' ? null : Number(field.value);
    else if (name === 'handle') {
      const next = uniqueHandle(slugify(field.value)) || piece.handle;

      if (next !== piece.handle) {
        // Keep the old address so links already shared keep working. Not kept
        // for a piece that has never been live: /p/new-piece-3 is not an
        // address anybody has.
        const old = piece.handle;
        if (!/^new-piece(-\d+)?$/.test(old)) {
          piece.previousHandles = [
            ...(piece.previousHandles ?? []).filter((h) => h !== old && h !== next),
            old,
          ].slice(-10);
        }

        piece.handle = next;
      }
    }
    else piece[name] = field.value;

    if (name === 'handle') state.editing = piece.handle;
    touch();
  }

  // The address line and card titles do need to follow the fields, but only
  // once typing stops.
  function onChange(event) {
    if (event.target.closest('[data-field="handle"]')) renderPiece();
  }


  /* ==================================================================
     The Checkout tab — what a customer is charged beyond the pieces.
     ================================================================== */

  const MAX_AMOUNT = 500;

  const dollars = (value) => (Number(value) || 0).toFixed(2);

  function newFee() {
    return {
      id: `fee-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: '',
      amount: 0,
      enabled: true,
    };
  }

  // Every charge here is applied to every order, so the preview is not
  // decoration: it is the only place she sees the effect of a change before
  // a customer does.
  // Mirrors orderTotal in lib/settings.mjs, in cents for the same reason: the
  // preview has to agree with what the server will charge, or it is worse than
  // no preview. The server remains the authority; this only shows its answer
  // before a save.
  function previewParts(example) {
    const s = state.settings;
    const c = (v) => Math.round((Number(v) || 0) * 100);

    // Nothing is charged for postage when it is already inside the price. Same
    // rule as shippingIncluded in lib/settings.mjs: absent means included.
    const absorbed = s.shipping?.enabled !== false && s.shipping?.includedInPrices !== false;
    const shipping = s.shipping?.enabled === false || absorbed ? 0 : c(s.shipping?.amount);
    const fees = (s.fees ?? []).reduce(
      (sum, fee) => sum + (fee.enabled === false ? 0 : c(fee.amount)),
      0
    );

    const t = s.tax ?? {};
    const base = c(example) + (t.includeShipping ? shipping : 0);
    const tax = t.enabled && Number(t.rate) > 0 ? Math.round((base * Number(t.rate)) / 100) : 0;

    const cents = c(example) + shipping + fees + tax;
    return { tax: tax / 100, total: cents / 100 };
  }

  const previewTotal = (example) => previewParts(example).total;

  function chargeRow(charge, kind, index) {
    const id = kind === 'shipping' ? 'shipping' : `fee-${index}`;
    const over = (Number(charge.amount) || 0) > MAX_AMOUNT;

    return `
      <div class="charge${charge.enabled === false ? ' is-off' : ''}" data-charge="${kind}" data-charge-index="${index}">
        <label class="toggle charge__on">
          <input type="checkbox" data-charge-field="enabled" ${charge.enabled === false ? '' : 'checked'}>
          <span class="sr-only">Charge this</span>
        </label>

        <input class="field charge__label" value="${escapeHtml(charge.label ?? '')}"
               placeholder="${kind === 'shipping' ? 'Shipping' : 'What is this for?'}"
               aria-label="Name" data-charge-field="label">

        <div class="charge__amount">
          <span aria-hidden="true">$</span>
          <input class="field field--mono" inputmode="decimal"
                 value="${escapeHtml(dollars(charge.amount))}"
                 aria-label="Amount" data-charge-field="amount">
        </div>

        ${kind === 'fee'
          ? '<button class="charge__drop" type="button" data-drop-fee title="Remove this fee">&times;</button>'
          : '<span class="charge__drop" aria-hidden="true"></span>'}

        ${over ? `<p class="charge__warn">The most you can charge here is ${MAX_AMOUNT}.</p>` : ''}
      </div>
    `;
  }

  function renderCheckout() {
    const s = state.settings;
    const t = s.tax ?? { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false };
    const example = 12.99;

    el.checkoutPanel.innerHTML = `
      <div class="admin-head"><div>
        <h1>Checkout</h1>
        <p class="admin-sub">What a customer pays on top of the piece itself.</p>
      </div></div>

      <section class="charges">
        <p class="label">Shipping</p>
        ${chargeRow(s.shipping ?? { label: 'Shipping', amount: 0, enabled: false }, 'shipping', 0)}

        <label class="toggle charges__sub">
          <input type="checkbox" data-charge="shipping" data-charge-field="includedInPrices"
                 ${s.shipping?.includedInPrices !== false ? 'checked' : ''}>
          <span>My prices already cover postage &mdash; show free shipping</span>
        </label>

        <p class="hint">
          ${s.shipping?.includedInPrices !== false
            ? `On. Nothing is charged for postage, because your prices already carry it. The site
               says shipping is free, in the bag and on every piece. Your prices are shown exactly
               as you typed them &mdash; nothing is added to them anywhere.`
            : `Off. $${dollars(s.shipping?.amount)} is charged once per order, on its own line in
               the bag, and the site stops saying shipping is free.`}
        </p>
        <p class="hint">
          The amount above is kept either way, so this switch turns the
          $${dollars(s.shipping?.amount)} charge straight back on.
        </p>
      </section>

      <section class="charges">
        <p class="label">Extra fees</p>
        ${(s.fees ?? []).length
          ? (s.fees ?? []).map((fee, i) => chargeRow(fee, 'fee', i)).join('')
          : '<p class="charges__empty">No extra fees. Handling, packaging, rush — whatever the shop needs.</p>'}
        <button class="btn btn-ghost" type="button" data-add-fee>Add a fee</button>
        <p class="hint">Each fee is its own line at checkout, so a customer sees what they are paying for.</p>
      </section>

      <section class="charges">
        <p class="label">Sales tax</p>

        <div class="charge${t.enabled ? '' : ' is-off'}" data-charge="tax" data-charge-index="0">
          <label class="toggle charge__on">
            <input type="checkbox" data-charge-field="enabled" ${t.enabled ? 'checked' : ''}>
            <span class="sr-only">Charge tax</span>
          </label>

          <input class="field charge__label" value="${escapeHtml(t.label ?? 'Sales tax')}"
                 aria-label="Name" data-charge-field="label">

          <div class="charge__amount">
            <input class="field field--mono" inputmode="decimal"
                   value="${escapeHtml(t.rate ?? 0)}"
                   aria-label="Rate" data-charge-field="rate">
            <span aria-hidden="true">%</span>
          </div>

          <span class="charge__drop" aria-hidden="true"></span>
        </div>

        <label class="toggle charges__sub">
          <input type="checkbox" data-charge="tax" data-charge-field="includeShipping"
                 ${t.includeShipping ? 'checked' : ''}>
          <span>Tax the shipping too</span>
        </label>

        <p class="hint">
          A percentage of the order, not a flat amount &mdash; so it scales with
          what someone buys. Whether shipping is taxable varies by state, which
          is why that is a switch rather than an assumption.
        </p>
        <p class="hint hint--warn">
          What you are required to collect, and from whom, is not something this
          panel can know. Confirm the rate with whoever does your taxes.
        </p>
      </section>

      <section class="charges preview">
        <p class="label">On a $${dollars(example)} piece</p>
        <dl class="preview__lines">
          <div><dt>The piece</dt><dd>$${dollars(example)}</dd></div>
          ${s.shipping?.enabled !== false
            && (Number(s.shipping?.amount) || 0) > 0
            && s.shipping?.includedInPrices !== false
            ? `<div><dt>${escapeHtml(s.shipping.label || 'Shipping')}</dt><dd>Free</dd></div>`
            : s.shipping?.enabled !== false && (Number(s.shipping?.amount) || 0) > 0
              ? `<div><dt>${escapeHtml(s.shipping.label || 'Shipping')}</dt><dd>$${dollars(s.shipping.amount)}</dd></div>`
              : ''}
          ${(s.fees ?? [])
            .filter((fee) => fee.enabled !== false && (Number(fee.amount) || 0) > 0)
            .map((fee) => `<div><dt>${escapeHtml(fee.label || 'Fee')}</dt><dd>$${dollars(fee.amount)}</dd></div>`)
            .join('')}
          ${previewParts(example).tax > 0
            ? `<div><dt>${escapeHtml(t.label || 'Sales tax')} (${Number(t.rate)}%)</dt><dd>$${dollars(previewParts(example).tax)}</dd></div>`
            : ''}
          <div class="preview__total"><dt>Customer pays</dt><dd>$${dollars(previewTotal(example))}</dd></div>
        </dl>
      </section>

      <section class="charges">
        <p class="label">Where orders go</p>

        <p class="hint">
          Every order is emailed to <strong>stitch.wishess@gmail.com</strong> the
          moment it is paid for &mdash; what to make, which design, and where to
          send it. Replying to that email answers the customer directly.
        </p>

        <button class="btn btn-ghost" type="button" data-test-email>
          Send me a test order
        </button>

        <p class="hint" data-test-email-note role="status"></p>

        <p class="hint">
          Worth pressing now, and again if anything about the shop's email ever
          changes. A notification that has quietly stopped working looks exactly
          like a quiet day.
        </p>
      </section>
    `;
  }

  function onCheckoutInput(event) {
    const field = event.target.closest('[data-charge-field]');
    if (!field) return;

    const row = field.closest('[data-charge]');
    const kind = row.dataset.charge;
    const index = Number(row.dataset.chargeIndex);
    const name = field.dataset.chargeField;

    const target =
      kind === 'shipping'
        ? (state.settings.shipping ??= { label: 'Shipping', amount: 0, enabled: false })
        : kind === 'tax'
          ? (state.settings.tax ??= { label: 'Sales tax', rate: 0, enabled: false, includeShipping: false })
          : state.settings.fees[index];

    if (!target) return;

    if (name === 'enabled' || name === 'includeShipping' || name === 'includedInPrices') {
      target[name] = field.checked;
    }
    else if (name === 'amount' || name === 'rate') {
      target[name] = field.value.trim() === '' ? 0 : Number(field.value);
    } else target[name] = field.value;

    touch();

    // Redrawing on every keystroke would move the caret. The preview is
    // refreshed on blur instead, and on the toggles, which cannot be typed in.
    if (name === 'enabled' || name === 'includeShipping' || name === 'includedInPrices') {
      renderCheckout();
    }
  }

  // Proving the notification pipe works, rather than assuming it does. The
  // result is written next to the button as well as in the usual banner,
  // because the question being asked is about this button specifically.
  async function sendTestEmail(button) {
    const note = el.checkoutPanel.querySelector('[data-test-email-note]');

    button.disabled = true;
    if (note) note.textContent = 'Sending…';

    try {
      const response = await fetch('/api/admin-test-email', { method: 'POST' });
      const body = await response.json().catch(() => ({}));

      if (response.ok) {
        const where = `Sent to ${body.to}. Give it a minute, and check spam the first time.`;
        if (note) note.textContent = where;
        toast(where);
        return;
      }

      const why = body.error || 'The test email could not be sent.';
      if (note) note.textContent = why;
      fail(why);
    } catch {
      const why = 'Could not reach the shop to send it. Nothing was sent.';
      if (note) note.textContent = why;
      fail(why);
    } finally {
      button.disabled = false;
    }
  }

  function onCheckoutClick(event) {
    state.pressing = false;

    const test = event.target.closest('[data-test-email]');
    if (test) {
      sendTestEmail(test);
      return;
    }

    if (event.target.closest('[data-add-fee]')) {
      state.settings.fees = [...(state.settings.fees ?? []), newFee()];
      touch();
      renderCheckout();
      // Land the cursor in the new row rather than making her hunt for it.
      const rows = el.checkoutPanel.querySelectorAll('[data-charge="fee"] .charge__label');
      rows[rows.length - 1]?.focus();
      return;
    }

    const drop = event.target.closest('[data-drop-fee]');
    if (drop) {
      const index = Number(drop.closest('[data-charge]').dataset.chargeIndex);
      const fee = state.settings.fees[index];
      if (fee.label && !window.confirm(`Remove the "${fee.label}" fee?`)) return;

      state.settings.fees = state.settings.fees.filter((_, i) => i !== index);
      touch();
      renderCheckout();
    }
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
    el.ordersPanel = $('[data-orders]');
    el.lookPanel = $('[data-look]');

    el.lookPanel.addEventListener('input', onLookInput);
    el.lookPanel.addEventListener('click', onLookClick);
    el.checkoutPanel = $('[data-checkout]');
    el.homepagePanel = $('[data-homepage]');

    el.ordersPanel.addEventListener('click', onOrdersClick);

    el.homepagePanel.addEventListener('input', onHomepageInput);
    el.homepagePanel.addEventListener('click', onHomepageClick);

    el.checkoutPanel.addEventListener('input', onCheckoutInput);
    el.checkoutPanel.addEventListener('click', onCheckoutClick);
    // Pressing a button in this panel blurs whichever field had focus, and the
    // blur below rebuilds the panel — which pulls the button out of the DOM
    // between the press and the click, so the click never lands. Noting the
    // press lets that one rebuild be skipped. Recorded on pointerdown rather
    // than from the blur's relatedTarget because Safari does not focus a button
    // when it is clicked, so there would be nothing to read.
    el.checkoutPanel.addEventListener('pointerdown', (event) => {
      state.pressing = Boolean(event.target.closest('button'));
    });

    // Redraw on blur rather than on input: rebuilding the form under the
    // cursor would send the caret to the end on every keystroke.
    el.checkoutPanel.addEventListener(
      'blur',
      () => {
        if (state.pressing) return;
        renderCheckout();
      },
      true
    );

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
