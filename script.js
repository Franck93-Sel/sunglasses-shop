// =========================================================================
// Products (catalogue en base : table app.products, lue via la Data API Neon)
// =========================================================================
let products = [];
let productsStatus = 'loading'; // 'loading' | 'ready' | 'error'

// Un visiteur n'est pas connecté : Neon Auth délivre un jeton « anonymous »,
// qui ne donne le droit de lire que les produits actifs (RLS).
async function loadProducts() {
    const { NEON_AUTH_URL, NEON_DATA_API_URL } = await import('./js/config.js');
    const tokenRes = await fetch(`${NEON_AUTH_URL}/token/anonymous`);
    if (!tokenRes.ok) throw new Error(`token anonyme : HTTP ${tokenRes.status}`);
    const { token } = await tokenRes.json();
    const res = await fetch(
        `${NEON_DATA_API_URL}/products?select=id,name,brand,price,category,image&order=sort_order`,
        { headers: { 'Accept-Profile': 'app', Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`produits : HTTP ${res.status}`);
    return (await res.json()).map(p => ({ ...p, price: Number(p.price) }));
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// =========================================================================
// State: Cart
// =========================================================================
// Une ligne par produit : { id, name, price, image, quantity }. Même limite que le workflow
// n8n « Créer session Stripe » (Valider Panier), qui refuse toute quantité au-delà.
const MAX_QUANTITY = 10;

// L'ancien panier stockait un doublon par clic : on regroupe par produit au chargement.
function loadCart() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem('auraCart') || '[]'); } catch { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    const lines = [];
    for (const item of saved) {
        if (!item || item.id == null) continue;
        const quantity = Number.isInteger(item.quantity) ? item.quantity : 1;
        const line = lines.find(l => l.id === item.id);
        if (line) line.quantity += quantity;
        else lines.push({ id: item.id, name: item.name, price: Number(item.price), image: item.image, quantity });
    }
    lines.forEach(l => { l.quantity = Math.min(Math.max(l.quantity, 1), MAX_QUANTITY); });
    return lines;
}

let cart = loadCart();

const cartItemCount = () => cart.reduce((n, item) => n + item.quantity, 0);
const cartTotal = () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

function saveCart() {
    localStorage.setItem('auraCart', JSON.stringify(cart));
}

// =========================================================================
// DOM Elements
// =========================================================================
const navbar = document.getElementById('navbar');
const productGrid = document.getElementById('productGrid');
const cartBtn = document.getElementById('cartBtn');
const closeCartBtn = document.getElementById('closeCartBtn');
const cartOverlay = document.getElementById('cartOverlay');
const cartItemsContainer = document.getElementById('cartItems');
const cartCount = document.getElementById('cartCount');
const cartTotalPrice = document.getElementById('cartTotalPrice');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const navLinksContainer = document.querySelector('.nav-links');

// =========================================================================
// Initialization
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    if (productGrid) {
        const urlParams = new URLSearchParams(window.location.search);
        const initialCategory = urlParams.get('category') || 'all';
        renderProducts(initialCategory);
        setupFilterButtons(initialCategory);
        loadProducts()
            .then(list => { products = list; productsStatus = 'ready'; })
            .catch(err => { console.error('Chargement du catalogue échoué :', err); productsStatus = 'error'; })
            .finally(() => renderProducts(currentCategory));
    }
    setupEventListeners();
    setupCookieBanner();
    updateCartUI(); // compteur et bouton de paiement à jour dès le chargement
});

// =========================================================================
// Category Filters
// =========================================================================
const categoryLabels = {
    'all': 'Tout Voir',
    'homme': 'Homme',
    'femme': 'Femme',
    'accessoires': 'Accessoires'
};

function setupFilterButtons(initialCategory) {
    const filterButtons = document.querySelectorAll('.filter-btn');
    if (!filterButtons.length) return;

    filterButtons.forEach(btn => {
        const category = Object.keys(categoryLabels).find(
            key => categoryLabels[key] === btn.textContent.trim()
        ) || 'all';
        btn.dataset.category = category;

        btn.classList.toggle('active', category === initialCategory);

        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProducts(category);
        });
    });
}

// =========================================================================
// Event Listeners
// =========================================================================
function setupEventListeners() {
    // Navbar scroll effect
    if (navbar) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    }

    // Cart Drawer Toggle
    if (cartBtn && closeCartBtn && cartOverlay) {
        cartBtn.addEventListener('click', toggleCart);
        closeCartBtn.addEventListener('click', toggleCart);
        cartOverlay.addEventListener('click', (e) => {
            if (e.target === cartOverlay) {
                toggleCart();
            }
        });
    }

    // Mobile Menu Toggle (simple inline implementation)
    if (mobileMenuBtn && navLinksContainer) {
        mobileMenuBtn.addEventListener('click', () => {
            const display = navLinksContainer.style.display;
            if (display === 'flex') {
                navLinksContainer.style.display = 'none';
            } else {
                navLinksContainer.style.display = 'flex';
                navLinksContainer.style.flexDirection = 'column';
                navLinksContainer.style.position = 'absolute';
                navLinksContainer.style.top = '100%';
                navLinksContainer.style.left = '0';
                navLinksContainer.style.width = '100%';
                navLinksContainer.style.background = 'var(--color-bg-secondary)';
                navLinksContainer.style.padding = '20px';
                navLinksContainer.style.borderBottom = '1px solid var(--color-border)';
            }
        });
    }
}

// =========================================================================
// Product Rendering
// =========================================================================
let currentCategory = 'all';

function renderProducts(category = 'all') {
    currentCategory = category;
    productGrid.innerHTML = '';

    if (productsStatus === 'loading') {
        productGrid.innerHTML = '<p class="empty-state">Chargement de la collection…</p>';
        return;
    }
    if (productsStatus === 'error') {
        productGrid.innerHTML = '<p class="empty-state">Collection momentanément indisponible. Merci de réessayer dans un instant.</p>';
        return;
    }

    const visibleProducts = category === 'all'
        ? products
        : products.filter(product => product.category === category);

    if (visibleProducts.length === 0) {
        productGrid.innerHTML = '<p class="empty-state">Aucune monture dans cette catégorie pour le moment.</p>';
        return;
    }

    visibleProducts.forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-image-container">
                <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="product-image">
                <div class="product-overlay">
                    <button class="btn btn-primary" onclick="addToCart(${product.id})">Ajouter au panier</button>
                </div>
            </div>
            <div class="product-info">
                <p class="product-brand">${escapeHtml(product.brand)}</p>
                <h3 class="product-name">${escapeHtml(product.name)}</h3>
                <p class="product-price">${product.price} €</p>
            </div>
        `;
        productGrid.appendChild(card);
    });
}

// =========================================================================
// Cart Logic
// =========================================================================
function toggleCart() {
    cartOverlay.classList.toggle('active');
    // Prevent body scroll when cart is open
    if (cartOverlay.classList.contains('active')) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
}

// Add to global scope for inline onclick handler
window.addToCart = function(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const line = cart.find(item => item.id === productId);
    if (line && line.quantity >= MAX_QUANTITY) {
        updateCartUI();
        showCartNotice(`Maximum ${MAX_QUANTITY} exemplaires par article.`);
    } else {
        if (line) line.quantity += 1;
        else cart.push({ id: product.id, name: product.name, price: product.price, image: product.image, quantity: 1 });
        saveCart();
        updateCartUI();
    }

    // Open cart to show user they added it (if not already opened)
    if (!cartOverlay.classList.contains('active')) {
        toggleCart();
    }
}

window.removeFromCart = function(index) {
    cart.splice(index, 1);
    saveCart();
    updateCartUI();
}

window.changeCartQuantity = function(index, delta) {
    const line = cart[index];
    if (!line) return;
    line.quantity = Math.min(Math.max(line.quantity + delta, 1), MAX_QUANTITY);
    saveCart();
    updateCartUI();
}

// Message dans le tiroir (pas de window.alert : il bloque la page).
function showCartNotice(message) {
    const footer = document.querySelector('.cart-footer');
    if (!footer) return;
    let notice = footer.querySelector('.cart-notice');
    if (!notice) {
        notice = document.createElement('p');
        notice.className = 'cart-notice';
        notice.setAttribute('role', 'alert');
        footer.insertBefore(notice, footer.querySelector('.btn-primary'));
    }
    notice.textContent = message;
    notice.hidden = false;
}

function hideCartNotice() {
    const notice = document.querySelector('.cart-footer .cart-notice');
    if (notice) notice.hidden = true;
}

function updateCartUI() {
    hideCartNotice();

    // Update count indicator
    if (cartCount) cartCount.textContent = cartItemCount();

    // Bouton de paiement : refusé tant que le panier est vide.
    const checkoutBtn = document.querySelector('.cart-footer .btn-primary');
    if (checkoutBtn) {
        checkoutBtn.setAttribute('aria-disabled', String(cart.length === 0));
        checkoutBtn.onclick = () => {
            if (cart.length === 0) {
                showCartNotice('Votre panier est vide.');
                return;
            }
            window.location.href = 'checkout.html';
        };
    }

    // Render items in drawer
    if (!cartItemsContainer || !cartTotalPrice) return;

    cartItemsContainer.innerHTML = '';

    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p class="empty-cart">Votre panier est vide.</p>';
        cartTotalPrice.textContent = '0 €';
        return;
    }

    cart.forEach((item, index) => {
        const name = escapeHtml(item.name);
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item';
        itemEl.innerHTML = `
            <img src="${escapeHtml(item.image)}" alt="${name}" class="cart-item-img">
            <div class="cart-item-info">
                <h4 class="cart-item-name">${name}</h4>
                <p class="cart-item-price">${item.price} €</p>
                <div class="cart-qty" role="group" aria-label="Quantité de ${name}">
                    <button type="button" class="cart-qty-btn" onclick="changeCartQuantity(${index}, -1)"
                        aria-label="Retirer un exemplaire" ${item.quantity <= 1 ? 'disabled' : ''}>−</button>
                    <span class="cart-qty-value" aria-live="polite">${item.quantity}</span>
                    <button type="button" class="cart-qty-btn" onclick="changeCartQuantity(${index}, 1)"
                        aria-label="Ajouter un exemplaire" ${item.quantity >= MAX_QUANTITY ? 'disabled' : ''}>+</button>
                </div>
                <button class="remove-item" onclick="removeFromCart(${index})">Supprimer</button>
            </div>
        `;
        cartItemsContainer.appendChild(itemEl);
    });

    cartTotalPrice.textContent = `${cartTotal()} €`;
}

// =========================================================================
// Cookie Consent Banner
// =========================================================================
function setupCookieBanner() {
    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.id = 'cookieBanner';
    banner.innerHTML = `
        <div class="cookie-banner-inner">
            <p class="cookie-banner-text">
                <strong>Nous utilisons des cookies.</strong> AURA utilise uniquement des cookies essentiels au fonctionnement du site (panier, préférences). Consultez notre <a href="confidentialite.html">politique de confidentialité</a> pour en savoir plus.
            </p>
            <div class="cookie-banner-actions">
                <button type="button" class="btn cookie-btn-refuse" id="cookieRefuseBtn">Refuser</button>
                <button type="button" class="btn btn-primary" id="cookieAcceptBtn">Accepter</button>
            </div>
        </div>
    `;
    document.body.appendChild(banner);

    const hideBanner = () => banner.classList.remove('is-visible');

    document.getElementById('cookieAcceptBtn').addEventListener('click', () => {
        localStorage.setItem('auraCookieConsent', 'accepted');
        hideBanner();
    });

    document.getElementById('cookieRefuseBtn').addEventListener('click', () => {
        localStorage.setItem('auraCookieConsent', 'refused');
        hideBanner();
    });

    window.showCookieBanner = () => banner.classList.add('is-visible');

    if (!localStorage.getItem('auraCookieConsent')) {
        // Small delay so the banner slides in after the page has settled.
        setTimeout(() => banner.classList.add('is-visible'), 600);
    }
}
