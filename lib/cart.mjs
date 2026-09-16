// Turning what a browser claims is in a cart into what may actually be sold.
//
// The incoming cart is untrusted. It comes from localStorage, which anyone can
// edit, so nothing in it is believed except which piece was meant and how many
// were wanted — and even the quantity is checked against stock.
//
// Prices and titles come from the catalog. If the browser were allowed to name
// a price, eventually it would name one cent.

function wantedQuantity(value) {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return 1;
  return Math.trunc(number);
}

export function resolveCart(cart, products) {
  const catalog = Array.isArray(products) ? products : [];
  const lines = Array.isArray(cart) ? cart : [];

  const byHandle = new Map(catalog.map((product) => [product?.handle, product]));

  // Merge first, so two entries for the same piece are checked against stock
  // once rather than each slipping under the limit on its own.
  const wanted = new Map();
  for (const line of lines) {
    const handle = line?.handle;
    if (typeof handle !== 'string' || !handle) continue;

    const quantity = wantedQuantity(line?.quantity);
    wanted.set(handle, (wanted.get(handle) ?? 0) + quantity);
  }

  const items = [];
  const problems = [];
  const reject = (handle, message) => problems.push({ handle, message });

  for (const [handle, quantity] of wanted) {
    if (quantity <= 0) continue;

    const product = byHandle.get(handle);
    if (!product) {
      reject(handle, 'That piece is no longer in the catalog.');
      continue;
    }

    if (product.hidden === true) {
      reject(handle, `"${product.title}" is not available right now.`);
      continue;
    }

    if (product.price == null) {
      reject(handle, `"${product.title}" has no price yet, so it cannot be bought.`);
      continue;
    }

    // null stock means made to order: there is no ceiling to hit.
    const stock = product.stock;
    if (stock === 0) {
      reject(handle, `"${product.title}" is sold out.`);
      continue;
    }

    let allowed = quantity;
    if (Number.isFinite(stock) && quantity > stock) {
      allowed = stock;
      reject(handle, `Only ${stock} of "${product.title}" left, so the rest were removed.`);
    }

    items.push({
      handle,
      title: product.title,
      price: product.price,
      quantity: allowed,
      image: product.images?.[0] ?? null,
    });
  }

  return { items, problems };
}
