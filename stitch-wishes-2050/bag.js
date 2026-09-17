/* The bag page.

   Every number shown here comes from /api/quote. Nothing about money is
   worked out in the browser, so what is on screen is what the checkout will
   be built from. */

(function () {
  const el = {};
  let quote = null;

  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const money = (value) => `$${Number(value || 0).toFixed(2)}`;

  /* ------------------------------------------------------------- pricing */

  async function price() {
    const cart = window.StitchCart.read();

    if (!cart.length) {
      quote = null;
      renderEmpty();
      return;
    }

    el.body.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        renderProblem(body.error || 'The bag could not be priced just now.');
        return;
      }

      quote = await response.json();

      // The server may have dropped or reduced lines — a piece sold out, or a
      // quantity beyond what is left. Write that back so the bag on this
      // device matches what can actually be bought.
      reconcile(quote);
      render();
    } catch {
      renderProblem('Cannot reach the shop right now. Your bag is still here.');
    } finally {
      el.body.removeAttribute('aria-busy');
    }
  }

  function reconcile(result) {
    // Keyed by piece and design together, because two designs of the same
    // sign are two different lines.
    const key = (handle, design) => `${handle}|${design ?? ''}`;
    const allowed = new Map(result.items.map((item) => [key(item.handle, item.design), item.quantity]));

    for (const line of window.StitchCart.read()) {
      const permitted = allowed.get(key(line.handle, line.design)) ?? 0;
      if (permitted !== line.quantity) {
        window.StitchCart.setQuantity(line.handle, permitted, line.design ?? null);
      }
    }
  }

  /* ------------------------------------------------------------ rendering */

  function renderEmpty() {
    el.body.innerHTML = `
      <div class="bag-empty">
        <p class="label">Your bag</p>
        <h1>Nothing in here yet</h1>
        <p>Everything is made or hand-picked one at a time.</p>
        <a class="btn btn-primary" href="collection.html">Open the catalog</a>
      </div>
    `;
  }

  function renderProblem(message) {
    el.body.innerHTML = `
      <div class="bag-empty">
        <p class="label">Your bag</p>
        <h1>That did not work</h1>
        <p>${escapeHtml(message)}</p>
        <button class="btn btn-ghost" type="button" data-retry>Try again</button>
      </div>
    `;
  }

  function itemHtml(item) {
    const media = item.image
      ? `<div class="bag-item__media"><img src="${escapeHtml(item.image)}" alt="" loading="lazy"></div>`
      : `<div class="bag-item__media bag-item__media--empty"></div>`;

    // Which design, and any choices made — so the bag says exactly what is
    // being ordered rather than just which listing it came from.
    const variant = [
      item.designName ? escapeHtml(item.designName) : '',
      ...(item.choices ?? []).map((c) => `${escapeHtml(c.label)}: ${escapeHtml(c.value)}`),
    ]
      .filter(Boolean)
      .map((line) => `<p class="bag-item__variant">${line}</p>`)
      .join('');

    const design = escapeHtml(item.design ?? '');

    return `
      <li class="bag-item">
        ${media}
        <div class="bag-item__body">
          <a class="bag-item__title" href="product.html?handle=${encodeURIComponent(item.handle)}">
            ${escapeHtml(item.title)}
          </a>
          ${variant}
          <p class="bag-item__price">${money(item.price)} each</p>
        </div>

        <div class="stepper" role="group" aria-label="How many">
          <button type="button" data-less="${escapeHtml(item.handle)}" data-design="${design}" aria-label="One fewer">&minus;</button>
          <span>${item.quantity}</span>
          <button type="button" data-more="${escapeHtml(item.handle)}" data-design="${design}" aria-label="One more">+</button>
        </div>

        <p class="bag-item__line">${money(item.price * item.quantity)}</p>
        <button class="bag-item__drop" type="button" data-drop="${escapeHtml(item.handle)}" data-design="${design}"
                aria-label="Remove ${escapeHtml(item.title)}">&times;</button>
      </li>
    `;
  }

  function render() {
    if (!quote || !quote.items.length) return renderEmpty();

    // Anything the server removed or reduced is said out loud rather than the
    // bag quietly getting smaller.
    const problems = (quote.problems ?? [])
      .map((problem) => `<li>${escapeHtml(problem.message)}</li>`)
      .join('');

    el.body.innerHTML = `
      <div class="bag">
        <div>
          <p class="label">Your bag</p>
          <h1>Ready when you are</h1>

          ${problems ? `<ul class="bag-problems" role="status">${problems}</ul>` : ''}

          <ul class="bag-items">${quote.items.map(itemHtml).join('')}</ul>
        </div>

        <aside class="bag-total">
          <p class="label">The total</p>
          <dl>
            <div><dt>Pieces</dt><dd>${money(quote.subtotal)}</dd></div>
            ${quote.lines
              .map((line) => `<div><dt>${escapeHtml(line.label)}</dt><dd>${money(line.amount)}</dd></div>`)
              .join('')}
            <div class="bag-total__sum"><dt>Total</dt><dd>${money(quote.total)}</dd></div>
          </dl>

          <button class="btn btn-primary bag-total__pay" type="button" data-pay>Pay ${money(quote.total)}</button>
          <p class="bag-total__note" data-pay-note></p>

          <a class="bag-total__back" href="collection.html">Keep looking</a>
        </aside>
      </div>
    `;
  }

  /* --------------------------------------------------------------- events */

  async function onClick(event) {
    const hit = (attr) => event.target.closest(`[${attr}]`);

    // An empty data-design means the piece has no designs, which is a real
    // value rather than a missing one.
    const designOf = (node) => node.dataset.design || null;

    const more = hit('data-more');
    if (more) {
      const design = designOf(more);
      const line = window.StitchCart.read().find(
        (l) => l.handle === more.dataset.more && (l.design ?? null) === design
      );
      window.StitchCart.setQuantity(more.dataset.more, (line?.quantity ?? 0) + 1, design);
      return price();
    }

    const less = hit('data-less');
    if (less) {
      const design = designOf(less);
      const line = window.StitchCart.read().find(
        (l) => l.handle === less.dataset.less && (l.design ?? null) === design
      );
      window.StitchCart.setQuantity(less.dataset.less, (line?.quantity ?? 1) - 1, design);
      return price();
    }

    const drop = hit('data-drop');
    if (drop) {
      window.StitchCart.remove(drop.dataset.drop, designOf(drop));
      return price();
    }

    if (hit('data-retry')) return price();

    if (hit('data-pay')) return pay();
  }

  async function pay() {
    const note = $('[data-pay-note]');
    const button = $('[data-pay]');

    button.disabled = true;
    note.textContent = 'Opening checkout…';

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: window.StitchCart.read() }),
      });

      const body = await response.json().catch(() => ({}));

      if (response.ok && body.url) {
        window.location.href = body.url;
        return;
      }

      // 404 means the endpoint is not built yet, which is the state today.
      note.textContent =
        response.status === 404
          ? 'Card payment is not switched on yet. Message @stitch.wishess to buy this.'
          : body.error || 'Checkout could not be opened. Nothing has been charged.';
    } catch {
      note.textContent = 'Cannot reach the shop right now. Nothing has been charged.';
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    el.body = $('[data-bag]');
    if (!el.body) return;

    el.body.addEventListener('click', onClick);
    price();
  });
})();
