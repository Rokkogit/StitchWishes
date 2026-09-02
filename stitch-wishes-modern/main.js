function formatPrice(price) {
  return price == null ? '' : `$${price.toFixed(2)}`;
}

function cardImageHtml(product) {
  if (!product.image) {
    return `<div class="card-image placeholder">Image coming soon</div>`;
  }
  return `<div class="card-image"><img src="${product.image}" alt="${product.title}" loading="lazy"></div>`;
}

function productCardHtml(product) {
  return `
    <a class="card" href="product.html?handle=${encodeURIComponent(product.handle)}">
      ${cardImageHtml(product)}
      <h3 class="card-title">${product.title}</h3>
      <p class="card-price">${formatPrice(product.price)}</p>
    </a>
  `;
}

function renderGrid(el, products) {
  if (!el) return;
  el.innerHTML = products.map(productCardHtml).join('');
}

function pickRandom(products, count, exclude) {
  const pool = products.filter((p) => p.handle !== exclude);
  const picked = [];
  while (picked.length < count && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

document.addEventListener('DOMContentLoaded', () => {
  const products = window.STITCH_PRODUCTS || [];

  const featuredEl = document.querySelector('[data-featured]');
  if (featuredEl) {
    renderGrid(featuredEl, products.slice(0, 4));
  }

  const collectionEl = document.querySelector('[data-collection]');
  if (collectionEl) {
    renderGrid(collectionEl, products);
  }

  const detailEl = document.querySelector('[data-product-detail]');
  if (detailEl) {
    const handle = new URLSearchParams(window.location.search).get('handle');
    const product = products.find((p) => p.handle === handle);

    if (!product) {
      detailEl.innerHTML = `
        <div class="not-found">
          <h2>Product not found</h2>
          <p>We couldn't find that item.</p>
          <a class="btn btn-outline" href="collection.html">Back to Shop</a>
        </div>
      `;
      const relatedHead = document.querySelector('.related-head');
      if (relatedHead) relatedHead.style.display = 'none';
    } else {
      document.title = `${product.title} — Stitch Wishess`;
      detailEl.innerHTML = `
        ${cardImageHtml(product)}
        <div class="product-info">
          <p class="eyebrow">Stitch Wishess</p>
          <h1>${product.title}</h1>
          <p class="price">${formatPrice(product.price)}</p>
          <p class="description">${product.description}</p>
          <button class="btn btn-primary" type="button">Add to Cart</button>
        </div>
      `;

      const relatedEl = document.querySelector('[data-related]');
      if (relatedEl) {
        renderGrid(relatedEl, pickRandom(products, 3, product.handle));
      }
    }
  }
});
