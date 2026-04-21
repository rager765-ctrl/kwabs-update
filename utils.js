/**
 * Kwabz Store Online — Utility Functions
 */

const KwabzUtils = {
  /**
   * Format a number as USD currency.
   */
  formatPrice(amount) {
    return 'GH₵' + parseFloat(amount).toFixed(2);
  },

  /**
   * Calculate discounted price.
   */
  calcDiscountedPrice(price, discountPercent) {
    if (!discountPercent || discountPercent <= 0) return price;
    return price * (1 - discountPercent / 100);
  },

  /**
   * Format ISO date string to readable format.
   */
  formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  },

  /**
   * Relative time (e.g., "2 mins ago").
   */
  timeAgo(isoString) {
    if (!isoString) return '';
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diff = Math.floor((now - then) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    return KwabzUtils.formatDate(isoString);
  },

  /**
   * Get URL query parameter.
   */
  getParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  },

  /**
   * Show a toast notification.
   */
  toast(message, type = 'success') {
    const existing = document.getElementById('kwabz-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'kwabz-toast';
    toast.className = `kwabz-toast kwabz-toast--${type}`;
    toast.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:18px;">
        ${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}
      </span>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('kwabz-toast--visible'));
    setTimeout(() => {
      toast.classList.remove('kwabz-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  },

  /**
   * Debounce function.
   */
  debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  /**
   * Convert a file to a data URL (for local image preview/storage).
   */
  fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Check if admin is logged in, redirect if not.
   */
  requireAdmin() {
    if (!KwabzStore.isAdminLoggedIn()) {
      window.location.href = 'admin-login.html';
      return false;
    }
    return true;
  },

  /**
   * Render the cart badge count in a nav element.
   */
  updateCartBadge() {
    const badges = document.querySelectorAll('[data-cart-badge]');
    if (typeof KwabzStore === 'undefined') return;
    const count = KwabzStore.getCartItemCount();
    badges.forEach(badge => {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    });
  },

  /**
   * Enforce Google Chrome (Specifically block Samsung Internet)
   */
  enforceChrome() {
    const ua = navigator.userAgent;
    const isSamsung = ua.includes('SamsungBrowser');

    if (isSamsung) {
      const currentUrl = window.location.href;
      const chromeIntent = `intent://${currentUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;
      
      document.body.innerHTML = `
        <div style="position:fixed;inset:0;z-index:99999;background:white;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;font-family:sans-serif;">
          <div style="width:80px;height:80px;background:#F2F2F2;border-radius:24px;display:flex;align-items:center;justify-content:center;margin-bottom:2rem;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          </div>
          <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:0.75rem;letter-spacing:-0.02em;">Browser Not Supported</h1>
          <p style="color:#666;line-height:1.6;margin-bottom:2.5rem;max-width:20rem;">
            Samsung Internet is currently not supported for <strong>Kwabz Store</strong>. Please use Google Chrome for the best experience.
          </p>
          <a href="${chromeIntent}" style="background:black;color:white;padding:1rem 2rem;border-radius:100px;text-decoration:none;font-weight:700;font-size:0.875rem;display:flex;align-items:center;gap:0.75rem;">
            Open in Google Chrome
            <span class="material-symbols-outlined" style="font-size:1.25rem;">open_in_new</span>
          </a>
          <p style="margin-top:2rem;font-size:0.75rem;color:#999;max-width:18rem;">
            Switching to Chrome will ensure all features work correctly.
          </p>
        </div>
      `;
      document.body.style.overflow = 'hidden';
      return false;
    }
    return true;
  },

  /**
   * Initialize Auth-responsive navigation across all pages.
   */
  initAuthNavigation() {
    if (typeof KwabzStore === 'undefined') return;
    
    const updateUI = (user) => {
      // 1. Bottom Nav Elements
      const navLink = document.getElementById('authNavLink');
      const navText = document.getElementById('authNavText');
      const navIcon = navLink ? navLink.querySelector('.material-symbols-outlined') : null;

      // 2. Header Action Icons (Universal Selector)
      const headerBtns = document.querySelectorAll('header .icon-btn');
      
      if (user) {
        if (navLink) navLink.href = 'account.html';
        if (navText) navText.textContent = 'Account';
        if (navIcon) navIcon.classList.add('filled');
        
        headerBtns.forEach(btn => {
          if (btn.href && (btn.href.includes('login') || btn.href.includes('account'))) {
            btn.href = 'account.html';
          }
        });
      } else {
        if (navLink) navLink.href = 'login.html';
        if (navText) navText.textContent = 'Sign In';
        if (navIcon) navIcon.classList.remove('filled');

        headerBtns.forEach(btn => {
          if (btn.href && (btn.href.includes('login') || btn.href.includes('account'))) {
            btn.href = 'login.html';
          }
        });
      }
    };

    // Listen for state changes
    KwabzStore.on('user_changed', updateUI);
    
    // Initial check (if already loaded)
    const currentUser = KwabzStore.getCurrentUser();
    if (currentUser) {
      updateUI(currentUser);
    } else {
      // If we are currently "syncing", we wait for the first user_changed
      // Otherwise we can safely update empty UI
      if (KwabzStore.getSyncStatus() !== 'syncing') {
        updateUI(null);
      }
    }
  },

  /**
   * Require user to be logged in. Handles Firebase initialization delay seamlessly.
   */
  requireLogin() {
    // If no active user right now AND no cached optimistic auth, we know they are not logged in.
    if (!KwabzStore.getCurrentUser() && !localStorage.getItem('kwabz_auth_cache')) {
      document.documentElement.style.display = 'none'; // prevent html flash
      window.location.replace('login.html');
      return false;
    }

    if (KwabzStore.getSyncStatus() === 'syncing') {
      // If we are syncing but they HAVE a cached auth, we assume they are logged in.
      // This allows the page UI to render seamlessly without waiting.
      
      KwabzStore.on('user_changed', (user) => {
        if (!user) {
          // If Firebase finishes syncing and they actually AREN'T logged in (session expired)
          localStorage.removeItem('kwabz_auth_cache');
          window.location.replace('login.html');
        }
      });
      return true; // Assume okay for now to prevent flash
    }

    return true; // Already verified!
  },

  /**
   * Alias for requireLogin, used by newer pages.
   */
  requireAuth() {
    return this.requireLogin();
  },

  /**
   * Redirect to admin login if administrator is not authenticated.
   * Handles the delay during Firebase Auth initialization.
   */
  requireAdmin() {
    const check = () => {
      if (!KwabzStore.isAdminLoggedIn()) {
        KwabzUtils.toast('Administrator access required', 'error');
        setTimeout(() => {
          window.location.href = 'admin-login.html';
        }, 1000);
        return false;
      }
      return true;
    };

    // If Firebase is still initializing, wait for the state
    if (KwabzStore.getSyncStatus() === 'syncing') {
      KwabzStore.on('user_changed', () => {
        // After auth settles, if still not admin, redirect
        if (!KwabzStore.isAdminLoggedIn()) {
          check();
        }
      });
      return true; // Assume okay for now to prevent flash-redirect
    }

    return check();
  },

  /**
   * Smart Branding: Update page headers based on session context.
   */
  applySmartBranding() {
    const sellerName = sessionStorage.getItem('kwabz_active_seller_name');
    const sellerId = sessionStorage.getItem('kwabz_active_seller_id');
    const titleEl = document.querySelector('.top-app-bar__title');
    const backBtn = document.querySelector('.top-app-bar .icon-btn'); // Usually back btn is first

    if (sellerName && titleEl) {
      titleEl.textContent = sellerName;
      if (backBtn && backBtn.href.includes('shop.html')) {
        backBtn.href = `seller-store.html?id=${sellerId}`;
      }
    }
  },

  /**
   * Check if cart belongs to a single seller for contextual branding.
   */
  getCartBranding() {
    const cart = KwabzStore.getCart();
    if (cart.length === 0) return null;
    
    // Check if all items in product list have same seller_id
    const products = KwabzStore.getAllProducts();
    const itemSellers = cart.map(item => {
      const p = products.find(prod => prod.id === item.product_id);
      return p ? p.seller_id : null;
    });

    const firstSeller = itemSellers[0];
    const isPure = itemSellers.every(s => s === firstSeller && s !== null && s !== 'main');
    
    if (isPure) {
      const seller = KwabzStore.getSellers().find(s => s.id === firstSeller);
      return seller ? seller.name : null;
    }
    return null;
  },

  clearSmartBranding() {
    sessionStorage.removeItem('kwabz_active_seller_id');
    sessionStorage.removeItem('kwabz_active_seller_name');
  }
};

// Auto-run browser enforcement
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => KwabzUtils.enforceChrome());
} else {
  KwabzUtils.enforceChrome();
}
