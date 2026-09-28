// ============================================================
// Anurag Online Official — Frontend (SECURE)
// No secrets. Backend-based auth. Real Cashfree.
// ============================================================

// ---------- CONFIG (public-safe only) ----------
const BACKEND_URL = 'https://anurag-online-backend.onrender.com';
const FIREBASE_URL = 'https://anuragonline-43a15-default-rtdb.asia-southeast1.firebasedatabase.app';
const PACKAGE_PRICES = { 7:2100, 14:4200, 21:6300, 28:8400, 35:10500, 42:12600, 49:14700 };

// ---------- STATE ----------
let currentUser = null;
let DB = { Keys:{}, Banned_HWIDs:{}, App_Status:{}, Orders:{} };
let cashfree = null;
let syncInterval = null;
let selectedDays = 0;
let currentEditKey = null;
let currentKeyFilter = 'all';

// ---------- HELPERS ----------
const $ = id => document.getElementById(id);
const qsa = (s, p=document) => [...p.querySelectorAll(s)];

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------- TOAST ----------
let islandTimer;
function showIsland(msg, type = 'success', icon = null) {
  const isl = $('dynamic-island');
  const ic = $('di-icon');
  const m = $('di-msg');
  if (!isl) return;

  ic.className = `fas ${icon || (type === 'success' ? 'fa-check-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-times-circle')}`;
  ic.style.color = type === 'success' ? 'var(--success)' : type === 'warning' ? 'var(--warning)' : 'var(--danger)';
  m.textContent = msg;

  if (navigator.vibrate) try { navigator.vibrate(type === 'success' ? 50 : [50,50,50]); } catch(e){}

  isl.classList.add('show');
  clearTimeout(islandTimer);
  islandTimer = setTimeout(() => isl.classList.remove('show'), 3000);
}

// ---------- API ----------
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (currentUser?.token) headers['Authorization'] = `Bearer ${currentUser.token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- FIREBASE (read-only) ----------
async function fetchDB() {
  const res = await fetch(`${FIREBASE_URL}/DPMods_Security.json`);
  if (!res.ok) throw new Error('DB read failed');
  const data = await res.json();
  return data || { Keys:{}, Banned_HWIDs:{}, App_Status:{}, Orders:{} };
}

// ---------- CASHFREE ----------
async function initCashfree() {
  if (typeof Cashfree === 'undefined') {
    console.warn('Cashfree SDK not loaded');
    return;
  }
  cashfree = Cashfree({ mode: 'production' });
}

// ---------- LOGIN ----------
async function doLogin() {
  const btn = $('login-btn');
  const username = $('login-username').value.trim().toLowerCase();
  const password = $('login-password').value.trim();

  if (!username || !password) {
    return showIsland('Fill all fields', 'error');
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> CHECKING...`;

  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    currentUser = {
      role: data.role,
      username: data.username,
      name: data.name || data.username,
      created: data.created || 'N/A',
      token: data.token,
    };

    DB = await fetchDB();
    completeLogin();
  } catch (e) {
    console.error(e);
    showIsland(e.message || 'Login failed', 'error');
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-fingerprint" style="margin-right:8px"></i> <span>LOGIN</span>`;
  }
}

function completeLogin() {
  $('login-screen').style.display = 'none';
  $('main-app').style.display = 'flex';

  const badge = $('user-badge');
  badge.textContent = currentUser.role.toUpperCase();
  badge.className = `user-badge ${currentUser.role}`;

  const roleEl = $('info-role');
  if (roleEl) roleEl.textContent = currentUser.role.toUpperCase();
  const userEl = $('info-username');
  if (userEl) userEl.textContent = currentUser.username;
  const createdEl = $('info-created');
  if (createdEl) createdEl.textContent = currentUser.created;

  // Show/hide admin-only nav
  const adminOnly = document.querySelectorAll('.admin-only');
  adminOnly.forEach(el => {
    el.style.display = currentUser.role === 'admin' ? 'flex' : 'none';
  });

  renderKeys();
  showIsland(`Welcome ${currentUser.username}!`, 'success', 'fa-unlock-alt');

  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(backgroundSync, 15000);
}

function logout() {
  if (!confirm('Logout from panel?')) return;
  if (syncInterval) clearInterval(syncInterval);
  currentUser = null;
  location.reload();
}

// ---------- SYNC ----------
async function syncNow() {
  const icon = $('reload-icon');
  if (icon) icon.classList.add('spin');
  try {
    DB = await fetchDB();
    renderKeys();
    showIsland('Synced', 'success', 'fa-sync-alt');
  } catch (e) {
    showIsland('Sync failed', 'error');
  } finally {
    if (icon) setTimeout(() => icon.classList.remove('spin'), 500);
  }
}

async function backgroundSync() {
  if (!currentUser) return;
  try {
    DB = await fetchDB();
    renderKeys();
  } catch (e) { /* silent */ }
}

// ---------- KEY MODAL ----------
function openKeyModal() {
  currentEditKey = null;
  $('modal-key-title').textContent = 'Generate Key';
  $('mod-key-id').value = '';
  $('mod-key-id').readOnly = true;
  $('mod-key-limit').value = 1;
  $('mod-key-date').value = '';
  $('mod-key-amount').value = '';
  $('mod-key-name').value = '';
  selectedDays = 0;
  qsa('.day-btn').forEach(b => b.classList.remove('selected'));
  $('expiry-preview-text').textContent = 'Select a package';
  $('payment-btn').disabled = true;

  randomKey();
  $('key-modal').classList.add('active');
}

function randomKey() {
  const keys = Object.keys(DB.Keys || {});
  let maxNum = 0;
  keys.forEach(k => {
    const m = k.match(/^AO-IND-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  $('mod-key-id').value = `AO-IND-${maxNum + 1}`;
}

function setDays(days, btnEl) {
  selectedDays = days;
  qsa('.day-btn').forEach(b => b.classList.remove('selected'));
  btnEl.classList.add('selected');

  const amount = PACKAGE_PRICES[days] || 0;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  const dd = String(expiry.getDate()).padStart(2, '0');
  const mm = String(expiry.getMonth() + 1).padStart(2, '0');
  const yyyy = expiry.getFullYear();

  $('mod-key-amount').value = `₹${amount.toLocaleString('en-IN')}`;
  $('mod-key-date').value = `${yyyy}-${mm}-${dd}`;
  $('expiry-preview-text').textContent = `Expiry: ${dd}/${mm}/${yyyy} • Price: ₹${amount.toLocaleString('en-IN')}`;
  $('payment-btn').disabled = false;
}

// ---------- PAYMENT ----------
async function openPaymentModal() {
  const keyId = $('mod-key-id').value.trim();
  const days = selectedDays;
  const limit = parseInt($('mod-key-limit').value) || 1;
  const name = $('mod-key-name').value.trim();

  if (!keyId) return showIsland('Key ID missing', 'error');
  if (!days) return showIsland('Select a package', 'error');
  if (!name) return showIsland('Enter username', 'error');

  try {
    showIsland('Creating order...', 'warning', 'fa-spinner');

    const data = await api('/api/create-order', {
      method: 'POST',
      body: JSON.stringify({
        keyId,
        days,
        deviceLimit: limit,
        customer_name: name,
        customer_phone: '9999999999',
        customer_email: 'customer@anuragonlineofficial.com',
      }),
    });

    if (!cashfree) await initCashfree();
    if (!cashfree) return showIsland('Cashfree SDK not loaded', 'error');

    // Real Cashfree checkout
    cashfree.checkout({
      paymentSessionId: data.payment_session_id,
      redirectTarget: '_self',
    });
  } catch (e) {
    console.error(e);
    showIsland(e.message || 'Payment error', 'error');
  }
}

// ---------- RENDER KEYS ----------
function renderKeys() {
  if (!currentUser) return;
  const list = $('keys-list');
  if (!list) return;

  const search = ($('search-keys')?.value || '').toLowerCase();
  const today = new Date();
  today.setHours(0,0,0,0);

  let html = '';
  let count = 0;

  const keys = Object.entries(DB.Keys || {})
    .sort((a, b) => (b[1].CreatedAt || 0) - (a[1].CreatedAt || 0));

  keys.forEach(([keyId, data]) => {
    // Operator sees only own keys
    if (currentUser.role === 'operator' && data.CreatedBy !== currentUser.username) return;

    // Search
    if (search && !keyId.toLowerCase().includes(search) && !(data.Username || '').toLowerCase().includes(search)) return;

    const exp = data.ExpiryDate ? new Date(data.ExpiryDate) : null;
    exp && exp.setHours(0,0,0,0);
    const diffDays = exp ? Math.ceil((exp - today) / 86400000) : 9999;
    const devices = (data.Devices && typeof data.Devices === 'object')
      ? Object.keys(data.Devices).filter(k => k !== 'dummy')
      : [];
    const banned = data.Banned === true;

    let state = 'active';
    if (banned) state = 'banned';
    else if (exp && diffDays < 0) state = 'expired';
    else if (devices.length === 0) state = 'pending';
    else if (diffDays <= 3) state = 'nearby';

    if (currentKeyFilter !== 'all' && state !== currentKeyFilter) return;

    count++;

    let badgeClass = `badge ${state}`;
    let badgeText = state.toUpperCase();

    let ownerBadge = '';
    if (data.CreatedBy) {
      const isAdmin = data.CreatedByRole === 'admin' || data.CreatedBy === 'admin';
      ownerBadge = `<span class="badge owner-${isAdmin ? 'admin' : 'operator'}">
        <i class="fas fa-${isAdmin ? 'crown' : 'user'}"></i> ${esc(data.CreatedBy)}
      </span>`;
    }

    let paymentBadge = '';
    if (data.PaymentVerified) {
      paymentBadge = `<span class="badge active"><i class="fas fa-credit-card"></i> PAID ₹${esc(data.Amount || 0)}</span>`;
    }

    html += `
    <div class="list-card ${state}" id="list-card-${esc(keyId)}">
      <div class="card-header-main" onclick="toggleCard('${esc(keyId)}')">
        <div class="card-header-left">
          <div class="card-title">
            <i class="fas fa-key" style="color:var(--primary)"></i> ${esc(keyId)}
          </div>
          <div class="card-subtitle">
            <span><i class="fas fa-user"></i> ${esc(data.Username || 'N/A')}</span>
            <span><i class="far fa-calendar-alt"></i> ${esc(data.ExpiryDate || 'N/A')}</span>
            <span><i class="fas fa-desktop"></i> ${devices.length}/${esc(data.DeviceLimit || 1)}</span>
            ${ownerBadge}
            ${paymentBadge}
          </div>
        </div>
        <div class="card-header-right">
          <span class="${badgeClass}">${badgeText}</span>
          <i class="fas fa-chevron-down chevron-icon"></i>
        </div>
      </div>
      <div class="card-details">
        ${devices.length ? `
          <div style="font-size:0.75rem;color:var(--text-dim);font-weight:700;margin-bottom:8px">
            <i class="fas fa-hdd"></i> Devices (${devices.length}):
          </div>
          <div class="devices-wrapper">
            ${devices.map(h => `
              <div class="device-box">
                <div class="device-hwid">${esc(h)}</div>
                <button class="btn-xs del" style="width:auto;padding:6px 12px;font-size:0.65rem;margin-top:6px" onclick="removeDevice('${esc(keyId)}','${esc(h)}');event.stopPropagation()">
                  <i class="fas fa-trash"></i> Remove
                </button>
              </div>
            `).join('')}
          </div>
        ` : '<div style="color:var(--text-dim);text-align:center;padding:10px;font-size:0.8rem">No Devices Linked</div>'}

        <div class="card-actions">
          <button class="btn-xs ban" onclick="toggleBan('${esc(keyId)}');event.stopPropagation()">
            <i class="fas ${banned ? 'fa-check' : 'fa-ban'}"></i> ${banned ? 'Unban' : 'Ban'}
          </button>
          <button class="btn-xs del" onclick="deleteKey('${esc(keyId)}');event.stopPropagation()">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    </div>`;
  });

  if (count === 0) {
    html = currentUser.role === 'operator'
      ? `<div class="empty-state">Aapne koi key nahi banayi<br><span style="font-size:0.75rem">Payment karke key generate karein</span></div>`
      : `<div class="empty-state">No Keys Found</div>`;
  }

  list.innerHTML = html;
}

function toggleCard(keyId) {
  const el = $(`list-card-${keyId}`);
  if (el) el.classList.toggle('expanded');
}

function setKeyFilter(filter) {
  currentKeyFilter = filter;
  qsa('#key-filters .filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderKeys();
}

// ---------- ACTIONS ----------
async function toggleBan(keyId) {
  try {
    await api(`/api/keys/${encodeURIComponent(keyId)}/ban`, { method: 'POST' });
    await syncNow();
    showIsland('Updated', 'success');
  } catch (e) {
    showIsland(e.message, 'error');
  }
}

async function deleteKey(keyId) {
  if (!confirm(`Delete key "${keyId}"?`)) return;
  try {
    await api(`/api/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
    await syncNow();
    showIsland('Key deleted', 'success');
  } catch (e) {
    showIsland(e.message, 'error');
  }
}

async function removeDevice(keyId, hwid) {
  if (!confirm('Remove this device?')) return;
  try {
    await api(`/api/keys/${encodeURIComponent(keyId)}/devices/${encodeURIComponent(hwid)}`, {
      method: 'DELETE',
    });
    await syncNow();
    showIsland('Device removed', 'success');
  } catch (e) {
    showIsland(e.message, 'error');
  }
}

// ---------- CHANGE PASSWORD ----------
function openChangePasswordModal() {
  $('mod-current-pass').value = '';
  $('mod-new-pass').value = '';
  $('mod-confirm-pass').value = '';
  $('change-password-modal').classList.add('active');
}

async function saveNewPassword() {
  const cur = $('mod-current-pass').value.trim();
  const nw = $('mod-new-pass').value.trim();
  const cf = $('mod-confirm-pass').value.trim();

  if (!cur || !nw || !cf) return showIsland('Fill all fields', 'error');
  if (nw !== cf) return showIsland('Passwords do not match', 'error');
  if (nw.length < 6) return showIsland('Password too short (min 6)', 'error');

  // Backend change-password endpoint (add karna hoga separately)
  showIsland('Password change coming soon', 'warning');
  closeModals();
}

// ---------- MODALS ----------
function closeModals() {
  qsa('.modal-overlay').forEach(m => m.classList.remove('active'));
}

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', () => {
  $('login-username')?.addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });
  $('login-password')?.addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });

  qsa('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeModals(); });
  });

  setTimeout(initCashfree, 800);

  // 🔥 RETURN URL — payment ke baad auto key check
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order_id');
  if (orderId && currentUser) {
    setTimeout(async () => {
      await syncNow();
      $('payment-success-modal').classList.add('active');
      window.history.replaceState({}, '', '/');
    }, 2500);
  }
});