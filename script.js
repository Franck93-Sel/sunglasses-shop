// =========================================================================
// Mock Data: Products
// =========================================================================
const products = [
    {
        id: 1,
        name: "L'Ombre",
        brand: "AURA",
        price: 350,
        category: "homme",
        image: "img/product-1.png"
    },
    {
        id: 2,
        name: "Éclipse",
        brand: "AURA",
        price: 420,
        category: "femme",
        image: "img/product-2.png"
    },
    {
        id: 3,
        name: "Soleil Noir",
        brand: "AURA",
        price: 380,
        category: "homme",
        image: "img/product-3.png"
    },
    {
        id: 4,
        name: "Horizon",
        brand: "AURA",
        price: 290,
        category: "femme",
        image: "img/product-4.png"
    },
    {
        id: 5,
        name: "Mirage",
        brand: "AURA",
        price: 450,
        category: "homme",
        image: "img/product-6.png"
    },
    {
        id: 6,
        name: "Zénith",
        brand: "AURA",
        price: 520,
        category: "femme",
        image: "img/product-5.png"
    }
];

// =========================================================================
// State: Cart
// =========================================================================
let cart = [];

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
    }
    setupEventListeners();
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
function renderProducts(category = 'all') {
    productGrid.innerHTML = '';

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
                <img src="${product.image}" alt="${product.name}" class="product-image">
                <div class="product-overlay">
                    <button class="btn btn-primary" onclick="addToCart(${product.id})">Ajouter au panier</button>
                </div>
            </div>
            <div class="product-info">
                <p class="product-brand">${product.brand}</p>
                <h3 class="product-name">${product.name}</h3>
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

    cart.push(product);
    updateCartUI();
    
    // Open cart to show user they added it (if not already opened)
    if (!cartOverlay.classList.contains('active')) {
        toggleCart();
    }
}

window.removeFromCart = function(index) {
    cart.splice(index, 1);
    updateCartUI();
}

function updateCartUI() {
    // Update count indicator
    if (cartCount) cartCount.textContent = cart.length;
    
    // Render items in drawer
    if (!cartItemsContainer || !cartTotalPrice) return;
    
    cartItemsContainer.innerHTML = '';
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p class="empty-cart">Votre panier est vide.</p>';
        cartTotalPrice.textContent = '0 €';
        return;
    }
    
    let total = 0;
    
    cart.forEach((item, index) => {
        total += item.price;
        
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item';
        itemEl.innerHTML = `
            <img src="${item.image}" alt="${item.name}" class="cart-item-img">
            <div class="cart-item-info">
                <h4 class="cart-item-name">${item.name}</h4>
                <p class="cart-item-price">${item.price} €</p>
                <button class="remove-item" onclick="removeFromCart(${index})">Supprimer</button>
            </div>
        `;
        cartItemsContainer.appendChild(itemEl);
    });
    
// Update total price display
    cartTotalPrice.textContent = `${total} €`;
    
    // Make sure the checkout button links to checkout.html
    const checkoutBtn = document.querySelector('.cart-footer .btn-primary');
    if (checkoutBtn) {
        checkoutBtn.onclick = () => {
            window.location.href = 'checkout.html';
        };
    }
}
