/* Stitch Wishess — the bag.

   The bag itself is just a list of handles and quantities in localStorage.
   It deliberately holds no prices: what anything costs is answered by the
   server every time the bag is priced, so a bag edited in devtools buys
   nothing at a discount, and a price change while something sits in a bag is
   picked up rather than remembered wrongly. */

(function () {
  const KEY = 'sw_cart';

  /* --------------------------------------------------------------- store */

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];   // a blocked or corrupted store means an empty bag, not a crash
    }
  }

  function write(lines) {
    try {
      localStorage.setItem(KEY, JSON.stringify(lines));
    } catch {
      // Private browsing, or a full store. The bag is lost on reload, which
      // is better than the page failing.
    }
    announce();
  }

  const count = () => read().reduce((total, line) => total + (line.quantity || 0), 0);

  // A piece, a design and a colour together identify a line: two designs of
  // the same sign are two different things to make and to ship, and so are two
  // colours of the same piece. The server works this out again for itself -
  // this copy exists so the two never disagree about what is one row.
  const same = (line, handle, design, colour) =>
    line.handle === handle &&
    (line.design ?? null) === (design ?? null) &&
    (line.colour ?? null) === (colour ?? null);

  function add(handle, quantity = 1, { design = null, choices = {}, colour = null } = {}) {
    const lines = read();
    const existing = lines.find((line) => same(line, handle, design, colour));

    if (existing) existing.quantity += quantity;
    else lines.push({ handle, design, choices, colour, quantity });

    write(lines);
  }

  function setQuantity(handle, quantity, design = null, colour = null) {
    const lines = read();
    const existing = lines.find((line) => same(line, handle, design, colour));
    const rest = lines.filter((line) => !same(line, handle, design, colour));

    if (quantity > 0) {
      rest.push({ ...(existing ?? { handle, design, choices: {}, colour }), quantity });
    }

    write(rest);
  }

  const remove = (handle, design = null, colour = null) =>
    setQuantity(handle, 0, design, colour);

  const clear = () => write([]);

  /* ------------------------------------------------------------- the nav */

  // Every page shows the count, so it is kept in one place rather than in
  // each page's own script.
  function announce() {
    const n = count();
    for (const node of document.querySelectorAll('[data-bag-count]')) {
      node.textContent = `Bag (${n})`;
    }
  }

  // Another tab adding something should be visible here too.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) announce();
  });

  window.StitchCart = { read, add, setQuantity, remove, clear, count, announce };

  document.addEventListener('DOMContentLoaded', announce);
})();
