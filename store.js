/**
 * Kwabz Store Online — Global State Manager (v2)
 * Features: Real-time listeners, Firebase Auth, User-specific Cart
 */

const KwabzStore = (() => {
  // ─── Storage Keys ──────────────────────────────────────────
  const KEYS = {
    CART: 'kwabz_cart',
    ADMIN_AUTH: 'kwabz_admin_auth',
    LOCAL_DATA_MIGRATED: 'kwabz_data_migrated_to_firestore',
    CACHE_PRODUCTS: 'kwabz_cache_products',
    CACHE_CATEGORIES: 'kwabz_cache_categories',
    CACHE_ORDERS: 'kwabz_cache_orders',
    CACHE_TIMESTAMP: 'kwabz_cache_ts',
    SETTINGS: 'kwabz_settings',
    CACHE_SELLERS: 'kwabz_cache_sellers',
  };

  const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in ms

  // ─── State ────────────────────────────────────────────────
  let localProducts = [];
  let localCategories = [];
  let localOrders = [];
  let localCart = [];
  let currentUser = null;
  let isFirestoreInitialized = false;
  let syncStatus = 'syncing'; // 'syncing', 'online', 'offline'
  let localSellers = [];
  let localSettings = { newTagDuration: 7 };
  
  // Real-time listener unsubscribers
  const unsubscribers = {
    products: null,
    categories: null,
    orders: null,
    cart: null,
    settings: null,
    sellers: null,
    sync: {
      products: false,
      categories: false,
      sellers: false
    }
  };

  // ─── Event System ──────────────────────────────────────────
  const listeners = {};

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function emit(event, data) {
    if (listeners[event]) {
      listeners[event].forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[KwabzStore] Error in listener for "${event}":`, err);
        }
      });
    }
  }

  // ─── ID Generator ──────────────────────────────────────────
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // ─── Firebase Auth ────────────────────────────────────────
  function setupAuthListener() {
    if (!firebase.auth) {
      console.warn('[KwabzStore] Firebase Auth not loaded.');
      return;
    }
    
    firebase.auth().onAuthStateChanged(user => {
      currentUser = user;
      if (user) {
        localStorage.setItem('kwabz_auth_cache', user.uid);
        console.log('[KwabzStore] User logged in:', user.email);
        emit('user_changed', user);
        _setupCartListener();
      } else {
        localStorage.removeItem('kwabz_auth_cache');
        console.log('[KwabzStore] User logged out');
        currentUser = null;
        emit('user_changed', null);
        if (unsubscribers.cart) {
          unsubscribers.cart();
          unsubscribers.cart = null;
        }
        if (unsubscribers.orders) {
          unsubscribers.orders();
          unsubscribers.orders = null;
        }
        localCart = [];
        localOrders = [];
        emit('cart_changed', localCart);
        emit('orders_changed', localOrders);
      }
      
      // Admin specific listeners
      if (user && user.email === 'admin@kwabzstore.com') {
        _setupOrdersListener();
      }
    });
  }

  async function emailSignUp(email, password) {
    try {
      const res = await firebase.auth().createUserWithEmailAndPassword(email, password);
      return res.user;
    } catch (err) {
      console.error('[KwabzStore] Sign up error:', err.message);
      throw err;
    }
  }

  async function emailLogin(email, password) {
    try {
      const res = await firebase.auth().signInWithEmailAndPassword(email, password);
      return res.user;
    } catch (err) {
      console.error('[KwabzStore] Login error:', err.message);
      throw err;
    }
  }

  async function logout() {
    try {
      await firebase.auth().signOut();
    } catch (err) {
      console.error('[KwabzStore] Logout error:', err);
      throw err;
    }
  }

  function getCurrentUser() {
    return currentUser;
  }

  // ─── Firestore Initialization ──────────────────────────────
  async function init() {
    if (isFirestoreInitialized) return;

    console.log('[KwabzStore] Initializing Offline-First Store v2...');
    
    // 1. Populate from Local Cache IMMEDIATELY (Zero-Latency UI)
    _loadFromDiskCache();
    emit('products_changed', localProducts);
    emit('categories_changed', localCategories);
    emit('orders_changed', localOrders);
    emit('sellers_changed', localSellers);
    emit('sync_status', syncStatus);

    // 2. Check if Firebase SDK is ready
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      console.warn('[KwabzStore] Firebase SDK not found... Waiting or staying offline.');
      syncStatus = 'offline';
      emit('sync_status', syncStatus);
      return;
    }

    try {
      const db = firebase.firestore();

      // Enable Offline Persistence
      try {
        await db.enablePersistence({ synchronizeTabs: true });
        console.log('[KwabzStore] Persistence Enabled');
      } catch (err) {
        if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
          console.warn('[KwabzStore] Persistence Warning:', err.code);
        }
      }

      // Add a sync timeout
      const syncTimeout = setTimeout(() => {
        if (syncStatus === 'syncing') {
          syncStatus = 'offline';
          emit('sync_status', syncStatus);
          console.warn('[KwabzStore] Network slow. Running in Offline Mode.');
        }
      }, 3500);

      // 3. Setup public real-time listeners
      _setupProductsListener();
      _setupCategoriesListener();
      _setupSellersListener();
      _setupSettingsListener();

      // 4. Setup Auth listener
      setupAuthListener();

      syncStatus = 'online';
      emit('sync_status', syncStatus);

      clearTimeout(syncTimeout);
      isFirestoreInitialized = true;
      console.log('[KwabzStore] READY with Real-time Listeners');

      await _migrateLocalStorageToFirestore();
    } catch (err) {
      console.error('[KwabzStore] Init Error:', err);
      syncStatus = 'offline';
      emit('sync_status', syncStatus);
    }
  }

  // ─── Real-time Listeners ──────────────────────────────────
  function _setupProductsListener() {
    const db = firebase.firestore();
    if (unsubscribers.products) unsubscribers.products();
    
    unsubscribers.products = db.collection('products')
      .orderBy('created_at', 'desc')
      .onSnapshot(
        snapshot => {
          try {
            localProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _saveToDiskCache();
            emit('products_changed', localProducts);
          } catch (err) {
            console.error('[KwabzStore] Products listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Products listener failed:', err);
          syncStatus = 'offline';
          emit('sync_status', syncStatus);
        }
      );
  }

  function _setupCategoriesListener() {
    const db = firebase.firestore();
    if (unsubscribers.categories) unsubscribers.categories();
    
    unsubscribers.categories = db.collection('categories')
      .onSnapshot(
        snapshot => {
          try {
            localCategories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _saveToDiskCache();
            emit('categories_changed', localCategories);
          } catch (err) {
            console.error('[KwabzStore] Categories listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Categories listener failed:', err);
        }
      );
  }

  function _setupOrdersListener() {
    const db = firebase.firestore();
    if (unsubscribers.orders) unsubscribers.orders();
    
    unsubscribers.orders = db.collection('orders')
      .orderBy('created_at', 'desc')
      .onSnapshot(
        snapshot => {
          try {
            localOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _saveToDiskCache();
            emit('orders_changed', localOrders);
          } catch (err) {
            console.error('[KwabzStore] Orders listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Orders listener failed:', err);
        }
      );
  }
  
  function _setupSellersListener() {
    const db = firebase.firestore();
    if (unsubscribers.sellers) unsubscribers.sellers();
    
    unsubscribers.sellers = db.collection('sellers')
      .onSnapshot(
        snapshot => {
          try {
            localSellers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _saveToDiskCache();
            emit('sellers_changed', localSellers);
          } catch (err) {
            console.error('[KwabzStore] Sellers listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Sellers listener failed:', err);
        }
      );
  }

  function _setupCartListener() {
    const db = firebase.firestore();
    if (!currentUser) return;
    if (unsubscribers.cart) unsubscribers.cart();
    
    unsubscribers.cart = db.collection('users').doc(currentUser.uid)
      .collection('cart').doc('items')
      .onSnapshot(
        doc => {
          try {
            localCart = doc.exists ? (doc.data().items || []) : [];
            emit('cart_changed', localCart);
          } catch (err) {
            console.error('[KwabzStore] Cart listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Cart listener failed:', err);
        }
      );
  }

  function _setupSettingsListener() {
    const db = firebase.firestore();
    if (unsubscribers.settings) unsubscribers.settings();
    
    unsubscribers.settings = db.collection('settings').doc('global')
      .onSnapshot(
        doc => {
          try {
            if (doc.exists) {
              localSettings = { ...localSettings, ...doc.data() };
              localStorage.setItem(KEYS.SETTINGS, JSON.stringify(localSettings));
              emit('settings_changed', localSettings);
            } else if (isAdminLoggedIn()) {
              // Create default settings ONLY if doc doesn't exist and user is Admin
              db.collection('settings').doc('global').set(localSettings);
            }
          } catch (err) {
            console.error('[KwabzStore] Settings listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Settings listener failed:', err);
        }
      );
  }

  function _loadFromDiskCache() {
    try {
      localProducts = JSON.parse(localStorage.getItem(KEYS.CACHE_PRODUCTS) || '[]');
      localCategories = JSON.parse(localStorage.getItem(KEYS.CACHE_CATEGORIES) || '[]');
      localOrders = JSON.parse(localStorage.getItem(KEYS.CACHE_ORDERS) || '[]');
      localSellers = JSON.parse(localStorage.getItem(KEYS.CACHE_SELLERS) || '[]');
      localSettings = JSON.parse(localStorage.getItem(KEYS.SETTINGS) || JSON.stringify(localSettings));
    } catch (e) {
      console.error('[KwabzStore] Cache Load Error:', e);
    }
  }

  async function refreshAll() {
    const db = firebase.firestore();
    try {
      syncStatus = 'syncing';
      emit('sync_status', syncStatus);

      // 1. Products Real-time
      if (unsubscribers.products) unsubscribers.products();
      unsubscribers.products = db.collection('products')
        .orderBy('created_at', 'desc')
        .onSnapshot(snap => {
          localProducts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          unsubscribers.sync.products = true;
          _checkSyncFinished();
          emit('products_changed', localProducts);
        }, err => console.error('[Store] Products Sync Error:', err));

      // 2. Categories Real-time
      if (unsubscribers.categories) unsubscribers.categories();
      unsubscribers.categories = db.collection('categories')
        .onSnapshot(snap => {
          localCategories = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          unsubscribers.sync.categories = true;
          _checkSyncFinished();
          emit('categories_changed', localCategories);
        }, err => console.error('[Store] Categories Sync Error:', err));

      // 3. Sellers Real-time
      if (unsubscribers.sellers) unsubscribers.sellers();
      unsubscribers.sellers = db.collection('sellers')
        .onSnapshot(snap => {
          localSellers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          unsubscribers.sync.sellers = true;
          _checkSyncFinished();
          emit('sellers_changed', localSellers);
        }, err => console.error('[Store] Sellers Sync Error:', err));

      // 4. Orders Real-time (If Admin)
      _setupOrdersListener();

      _setupSettingsListener();
    } catch (err) {
      console.error('[KwabzStore] Sync Setup Failed:', err);
      syncStatus = 'offline';
      emit('sync_status', syncStatus);
    }
  }

  function _setupOrdersListener() {
    if (!isAdminLoggedIn()) return;
    const db = firebase.firestore();
    if (unsubscribers.orders) unsubscribers.orders();
    unsubscribers.orders = db.collection('orders')
      .orderBy('created_at', 'desc')
      .onSnapshot(snap => {
        localOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        emit('orders_changed', localOrders);
      }, err => console.warn('[Store] Orders Listener Refused:', err.message));
  }

  function _checkSyncFinished() {
    if (unsubscribers.sync.products && unsubscribers.sync.categories && unsubscribers.sync.sellers) {
      if (syncStatus !== 'online') {
        syncStatus = 'online';
        emit('sync_status', syncStatus);
        _saveToDiskCache();
      }
    }
  }

  function getSyncStatus() { return syncStatus; }

  // Helper to handle both string dates and Firestore Timestamps
  function _convertToDate(val) {
    if (!val) return new Date(0);
    if (val.toDate && typeof val.toDate === 'function') return val.toDate();
    if (val.seconds) return new Date(val.seconds * 1000);
    return new Date(val);
  }

  async function _migrateLocalStorageToFirestore() {
    if (localStorage.getItem(KEYS.LOCAL_DATA_MIGRATED)) return;
    const db = firebase.firestore();
    const oldProducts = JSON.parse(localStorage.getItem('kwabz_products') || '[]');
    const oldCategories = JSON.parse(localStorage.getItem('kwabz_categories') || '[]');

    if ((oldProducts.length > 0 || oldCategories.length > 0) && isAdminLoggedIn()) {
      try {
        for (const cat of oldCategories) await db.collection('categories').doc(cat.id).set(cat);
        for (const prod of oldProducts) await db.collection('products').doc(prod.id).set(prod);
        localStorage.setItem(KEYS.LOCAL_DATA_MIGRATED, 'true');
        await refreshAll();
      } catch (err) {
        console.error('[KwabzStore] Migration error:', err);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC METHODS
  // ═══════════════════════════════════════════════════════════════

  function getProducts() { 
    return localProducts.filter(p => !p.seller_id || p.seller_id === 'main'); 
  }
  
  function getAllProducts() { return localProducts; }
  function getCategories() { return localCategories; }
  function getSellers() { return localSellers; }
  function getOrders() { return localOrders; }
  
  function getProductById(id) { return localProducts.find(p => p.id === id) || null; }
  function getCategoryById(id) { return localCategories.find(c => c.id === id) || null; }
  function getSellerById(id) { return localSellers.find(s => s.id === id) || null; }
  
  function getProductsByCategory(categoryId) {
    const products = (!categoryId || categoryId === 'all') ? localProducts : localProducts.filter(p => p.category_id === categoryId);
    return products.filter(p => !p.seller_id || p.seller_id === 'main');
  }
  
  function getAllProductsByCategory(categoryId) {
    if (!categoryId || categoryId === 'all') return localProducts;
    return localProducts.filter(p => p.category_id === categoryId);
  }
  
  function getProductsBySeller(sellerId) {
    if (!sellerId) return localProducts.filter(p => !p.seller_id || p.seller_id === 'main');
    return localProducts.filter(p => p.seller_id === sellerId);
  }

  async function addProduct(data) {
    try {
      const db = firebase.firestore();
      const newDoc = {
        ...data,
        created_at: new Date().toISOString(),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      };
      const docRef = await db.collection('products').add(newDoc);
      const productWithId = { id: docRef.id, ...newDoc };
      localProducts.unshift(productWithId);
      _saveToDiskCache();
      emit('products_changed', localProducts);
      return productWithId;
    } catch (err) {
      console.error('[KwabzStore] Add product error:', err);
      throw err;
    }
  }

  async function updateProduct(id, updates) {
    try {
      await firebase.firestore().collection('products').doc(id).update(updates);
      const idx = localProducts.findIndex(p => p.id === id);
      if (idx !== -1) {
        localProducts[idx] = { ...localProducts[idx], ...updates };
        _saveToDiskCache();
        emit('products_changed', localProducts);
      }
      return { id, ...updates };
    } catch (err) {
      console.error('[KwabzStore] Update product error:', err);
      throw err;
    }
  }

  async function deleteProduct(id) {
    try {
      await firebase.firestore().collection('products').doc(id).delete();
      localProducts = localProducts.filter(p => p.id !== id);
      _saveToDiskCache();
      emit('products_changed', localProducts);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete product error:', err);
      throw err;
    }
  }

  async function toggleProductStock(id) {
    try {
      const p = getProductById(id);
      if (!p) return null;
      return await updateProduct(id, { in_stock: !p.in_stock });
    } catch (err) {
      console.error('[KwabzStore] Toggle stock error:', err);
      throw err;
    }
  }

  async function addCategory(data) {
    try {
      const newDoc = { ...data, created_at: new Date().toISOString() };
      const docRef = await firebase.firestore().collection('categories').add(newDoc);
      const categoryWithId = { id: docRef.id, ...newDoc };
      localCategories.push(categoryWithId);
      _saveToDiskCache();
      emit('categories_changed', localCategories);
      return categoryWithId;
    } catch (err) {
      console.error('[KwabzStore] Add category error:', err);
      throw err;
    }
  }

  async function deleteCategory(id) {
    try {
      await firebase.firestore().collection('categories').doc(id).delete();
      localCategories = localCategories.filter(c => c.id !== id);
      _saveToDiskCache();
      emit('categories_changed', localCategories);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete category error:', err);
      throw err;
    }
  }
  
  // ─── Seller Management ───
  async function addSeller(data) {
    try {
      const newDoc = { ...data, created_at: new Date().toISOString() };
      const docRef = await firebase.firestore().collection('sellers').add(newDoc);
      const sellerWithId = { id: docRef.id, ...newDoc };
      localSellers.push(sellerWithId);
      _saveToDiskCache();
      emit('sellers_changed', localSellers);
      return sellerWithId;
    } catch (err) {
      console.error('[KwabzStore] Add seller error:', err);
      throw err;
    }
  }

  async function updateSeller(id, updates) {
    try {
      await firebase.firestore().collection('sellers').doc(id).update(updates);
      const idx = localSellers.findIndex(s => s.id === id);
      if (idx !== -1) {
        localSellers[idx] = { ...localSellers[idx], ...updates };
        _saveToDiskCache();
        emit('sellers_changed', localSellers);
      }
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update seller error:', err);
      throw err;
    }
  }

  async function deleteSeller(id) {
    try {
      await firebase.firestore().collection('sellers').doc(id).delete();
      localSellers = localSellers.filter(s => s.id !== id);
      _saveToDiskCache();
      emit('sellers_changed', localSellers);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete seller error:', err);
      throw err;
    }
  }

  // ─── Cart (Firestore-backed when logged in) ───────────
  async function _syncCartToFirestore() {
    if (!currentUser) return; // Only sync if user is logged in
    
    try {
      const db = firebase.firestore();
      await db.collection('users').doc(currentUser.uid)
        .collection('cart').doc('items')
        .set({ items: localCart, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[KwabzStore] Cart sync error:', err);
    }
  }

  function _getCart() { 
    return currentUser ? localCart : JSON.parse(localStorage.getItem(KEYS.CART) || '[]');
  }
  
  function _setCart(cart) {
    if (currentUser) {
      localCart = cart;
      _syncCartToFirestore();
    } else {
      localStorage.setItem(KEYS.CART, JSON.stringify(cart));
    }
  }
  
  function getCart() { return _getCart(); }
  
  function clearCart() {
    _setCart([]);
    emit('cart_changed', []);
  }
  
  function getCartTotal() { 
    return _getCart().reduce((s, i) => s + (i.price * i.quantity), 0);
  }
  
  function getCartItemCount() {
    return _getCart().reduce((s, i) => s + i.quantity, 0);
  }

  function addToCart(product, quantity = 1) {
    const cart = _getCart();
    const existing = cart.find(i => i.product_id === product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({
        product_id: product.id,
        name: product.name,
        price: product.discount > 0 ? (product.price * (1 - product.discount/100)) : product.price,
        quantity,
        image_url: product.image_url || '',
        seller_id: product.seller_id || 'main'
      });
    }
    _setCart(cart);
    emit('cart_changed', cart);
    return cart;
  }

  function removeFromCart(id) {
    const cart = _getCart().filter(i => i.product_id !== id);
    _setCart(cart);
    emit('cart_changed', cart);
    return cart;
  }

  function updateCartQuantity(id, qty) {
    const cart = _getCart();
    const item = cart.find(i => i.product_id === id);
    if (!item) return cart;
    if (qty <= 0) return removeFromCart(id);
    item.quantity = qty;
    _setCart(cart);
    emit('cart_changed', cart);
    return cart;
  }

  // ─── Orders ────────────────
  async function createOrder(customerInfo) {
    try {
      const cart = _getCart();
      if (cart.length === 0) return null;
      const user = firebase.auth().currentUser;
      const rawOrder = {
        order_number: '#' + (1000 + localOrders.length + 1),
        customer: customerInfo,
        customer_uid: user ? user.uid : null, // Link to user account
        items: cart,
        total_price: getCartTotal(),
        status: 'pending',
        created_at: new Date().toISOString()
      };
      const order = JSON.parse(JSON.stringify(rawOrder));
      const docRef = await firebase.firestore().collection('orders').add(order);
      const orderWithId = { id: docRef.id, ...order };
      localOrders.unshift(orderWithId);
      _saveToDiskCache();
      emit('orders_changed', localOrders);
      clearCart();
      return orderWithId;
    } catch (err) {
      console.error('[KwabzStore] Create order error:', err);
      throw err;
    }
  }

  async function updateOrderStatus(id, status) {
    try {
      await firebase.firestore().collection('orders').doc(id).update({ status });
      const idx = localOrders.findIndex(o => o.id === id);
      if (idx !== -1) {
        localOrders[idx].status = status;
        _saveToDiskCache();
        emit('orders_changed', localOrders);
      }
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update order status error:', err);
      throw err;
    }
  }

  async function getOrderById(id) {
    try {
      // Check local cache first
      const local = localOrders.find(o => o.id === id);
      if (local) return local;

      // Fetch from Firestore
      const doc = await firebase.firestore().collection('orders').doc(id).get();
      if (!doc.exists) return null;

      const data = { id: doc.id, ...doc.data() };
      return data;
    } catch (err) {
      console.error('[KwabzStore] Get order error:', err);
      return null;
    }
  }

  // ─── Admin Auth (Secure Firebase Auth) ──────────────────────────
  async function adminLogin(email, pw) {
    try {
      // 1. Authenticate via Firebase
      const userCredential = await firebase.auth().signInWithEmailAndPassword(email, pw);
      const user = userCredential.user;

      // 2. Verify specifically for Admin Identity
      if (user && user.email === 'admin@kwabzstore.com') {
        return true;
      } else {
        // Logged in but not admin? Sign out immediately.
        await firebase.auth().signOut();
        return false;
      }
    } catch (err) {
      console.error('[KwabzStore] Admin login secure error:', err);
      throw err;
    }
  }
  
  async function adminLogout() { 
    try {
      await firebase.auth().signOut();
      localStorage.removeItem(KEYS.ADMIN_AUTH); 
    } catch (err) {
      console.error('[KwabzStore] Admin logout error:', err);
    }
  }
  
  function isAdminLoggedIn() {
    const user = firebase.auth().currentUser;
    // Strictly verify via Firebase Auth context only
    return (user && user.email === 'admin@kwabzstore.com');
  }

  // ─── WhatsApp ──────────────
  function sendOrderViaWhatsApp(order, phone = '233553866329') {
    let msg = `🛍️ *NEW ORDER — KWABZ STORE*\n\nOrder: ${order.order_number}\nCustomer: ${order.customer.name}\nTotal: GH₵${order.total_price.toFixed(2)}\n\nStatus: Pending Confirmation`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function sendStatusUpdateViaWhatsApp(order) {
    const status = order.status || 'pending';
    const name = order.customer.name.split(' ')[0];
    const orderNum = order.order_number;
    const phone = order.customer.phone.replace(/\D/g, '');
    let msg = `Hi ${name}, your order *${orderNum}* status has been updated to: *${status}*.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function getSettings() { return localSettings; }
  
  async function updateSettings(updates) {
    try {
      const db = firebase.firestore();
      await db.collection('settings').doc('global').update(updates);
      // localSettings will be updated by the listener
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update settings error:', err);
      // If doc doesn't exist, try set
      try {
        await firebase.firestore().collection('settings').doc('global').set(updates, { merge: true });
        return true;
      } catch (err2) {
        console.error('[KwabzStore] Update settings emergency set error:', err2);
        throw err2;
      }
    }
  }

  function searchProducts(query) {
    if (!query) return localProducts;
    const q = query.toLowerCase();
    const results = localProducts.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const descMatch = (p.description || '').toLowerCase().includes(q);
      const cat = getCategoryById(p.category_id);
      return nameMatch || descMatch || (cat && cat.name.toLowerCase().includes(q));
    });
    return results.filter(p => !p.seller_id || p.seller_id === 'main');
  }

  function _saveToDiskCache() {
    localStorage.setItem(KEYS.CACHE_PRODUCTS, JSON.stringify(localProducts));
    localStorage.setItem(KEYS.CACHE_CATEGORIES, JSON.stringify(localCategories));
    localStorage.setItem(KEYS.CACHE_ORDERS, JSON.stringify(localOrders));
    localStorage.setItem(KEYS.CACHE_SELLERS, JSON.stringify(localSellers));
  }

  return {
    // Core
    init, on, emit, refreshAll, getSyncStatus, generateId,
    
    // Real-time Data
    getProducts, getAllProducts, getCategories, getOrders, 
    getProductById, getCategoryById, getSellerById, getProductsByCategory,
    getAllProductsByCategory,
    
    // Product Management
    addProduct, updateProduct, deleteProduct, toggleProductStock,
    
    // Category Management
    addCategory, deleteCategory,

    // Seller Management
    getSellers, getSellerById, addSeller, updateSeller, deleteSeller,
    getProductsBySeller,
    
    // Cart (Firestore-backed when logged in)
    getCart, addToCart, removeFromCart, updateCartQuantity,
    clearCart, getCartTotal, getCartItemCount,
    
    // Orders
    createOrder, updateOrderStatus, getOrderById,
    
    // Firebase Auth (NEW)
    emailSignUp, emailLogin, logout, getCurrentUser,
    
    // Legacy Admin Auth
    adminLogin, adminLogout, isAdminLoggedIn,
    
    // Social
    sendOrderViaWhatsApp, sendStatusUpdateViaWhatsApp,
    searchProducts,
    
    // Settings
    getSettings, updateSettings
  };
})();
