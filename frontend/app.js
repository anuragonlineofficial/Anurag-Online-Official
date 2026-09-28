import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const CFG = window.APP_CONFIG;
const fbApp = initializeApp(CFG.FIREBASE);
const auth = getAuth(fbApp);
const DB_URL = CFG.FIREBASE.databaseURL + '/DPMods_Security';

let DB = { App_Status:{}, Keys:{}, Operators:{}, Admins:{}, NextKeyNumber:1 };
let CURRENT_ROLE='', CURRENT_USER_ID='', CURRENT_OP_ID='';
let EDITING_KEY_ID=null, EDITING_USER_ID=null;
let PENDING_KEY_DATA=null, PENDING_TXN_ID=null;
let CURRENT_FILTER='all', ID_TOKEN='';

const $ = id => document.getElementById(id);

window.showToast = function(msg, type='success') {
  const t = $('toast'), icon = $('toast-icon');
  t.style.borderColor = type==='danger' ? 'var(--danger)' : 'var(--accent-secondary)';
  icon.className = type==='danger' ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
  icon.style.color = type==='danger' ? 'var(--danger)' : 'var(--success)';
  $('toast-msg').innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
};

window.switchScreen = id => {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
};

window.openModal = id => $(id).classList.add('active');
window.closeModal = id => $(id).classList.remove('active');

window.nav = function(tabId, e) {
  if (e) e.preventDefault();
  document.querySelectorAll('.tab-pane').forEach(v => v.classList.remove('active'));
  $('tab-'+tabId)?.classList.add('active');
  document.querySelectorAll('.nav-item,.bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(n => n.classList.add('active'));
  $('content-scroll')?.scrollTo(0,0);
  if (tabId==='users') renderUsers();
  if (tabId==='keys') renderKeys();
  if (tabId==='config') populateConfig();
};

window.copyToClipboard = (text, msg='Copied') => {
  navigator.clipboard.writeText(text).then(()=>showToast(msg)).catch(()=>{
    const el=document.createElement('textarea'); el.value=text;
    document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
    showToast(msg);
  });
};

function dbURL(path='') {
  return `${DB_URL}${path ? '/'+path : ''}.json?auth=${ID_TOKEN}`;
}

async function fetchDB() {
  const r = await fetch(dbURL(''));
  if (!r.ok) throw new Error('DB read failed');
  const data = await r.json() || {};
  DB = Object.assign({ App_Status:{}, Keys:{}, Operators:{}, Admins:{}, NextKeyNumber:1 }, data);
  if (!DB.Keys) DB.Keys = {};
  if (!DB.Operators) DB.Operators = {};
  recalcNext();
}

async function pushDB(silent=false) {
  try {
    const r = await fetch(dbURL(''), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DB)
    });
    if (!r.ok) throw new Error();
  } catch (e) { if (!silent) showToast('Write error','danger'); }
}

function recalcNext() {
  let highest = 0;
  Object.keys(DB.Keys||{}).forEach(k => {
    const m = k.match(/^AV-IND-(\d+)$/);
    if (m) { const n = parseInt(m[1]); if (n > highest) highest = n; }
  });
  DB.NextKeyNumber = highest + 1;
}

window.login = async function() {
  const btn = $('btn-login');
  btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> AUTHENTICATING...`;
  btn.disabled = true;

  const id = $('auth-id').value.trim();
  const pass = $('auth-pass').value.trim();
  if (!id || !pass) { showToast('Enter ID and Password','danger'); resetLoginBtn(); return; }

  try {
    let email = id;
    if (!id.includes('@')) {
      email = (id.toLowerCase() === 'admin') ? 'admin@anurag.online' : `${id}@anurag.local`;
    }

    const cred = await signInWithEmailAndPassword(auth, email, pass);
    ID_TOKEN = await cred.user.getIdToken();
    CURRENT_USER_ID = cred.user.uid;
    CURRENT_ROLE = (id.toLowerCase() === 'admin') ? 'admin' : 'operator';
    CURRENT_OP_ID = (CURRENT_ROLE === 'operator') ? id : '';

    await fetchDB();

    if (CURRENT_ROLE === 'admin') {
      $('nav-users').style.display = 'flex';
      $('nav-config').style.display = 'flex';
      $('bottom-nav-users').style.display = 'flex';
      $('bottom-nav-config').style.display = 'flex';
    } else {
      $('nav-users').style.display = 'none';
      $('nav-config').style.display = 'none';
      $('bottom-nav-users').style.display = 'none';
      $('bottom-nav-config').style.display = 'none';
    }

    switchScreen('screen-dashboard');
    nav('keys');
    showToast('Welcome ' + CURRENT_ROLE);
  } catch (e) {
    console.error(e);
    showToast('Invalid credentials','danger');
  }
  resetLoginBtn();
};

function resetLoginBtn() {
  const btn = $('btn-login');
  btn.innerHTML = `AUTHENTICATE <i class="fas fa-arrow-right"></i>`;
  btn.disabled = false;
}

window.logout = async function() {
  try { await signOut(auth); } catch {}
  location.reload();
};

window.syncDB = async function() {
  try {
    if (auth.currentUser) ID_TOKEN = await auth.currentUser.getIdToken(true);
    await fetchDB();
    refreshUI();
    showToast('System Synced');
  } catch (e) { showToast('Sync error','danger'); }
};

window.setFilter = function(f) {
  CURRENT_FILTER = f;
  document.querySelectorAll('.date-chip[data-filter]').forEach(c => c.classList.toggle('active', c.dataset.filter === f));
  renderKeys();
};

window.renderKeys = function() {
  const list = $('list-keys'); if (!list) return;
  const search = ($('search-input')?.value || '').toLowerCase();
  list.innerHTML = '';
  let vis = 0;
  Object.keys(DB.Keys || {}).forEach(kid => {
    const d = DB.Keys[kid];
    const user = d.Username || 'Unknown';
    if (CURRENT_ROLE === 'operator' && d.CreatedBy !== CURRENT_USER_ID) return;
    if (search && !user.toLowerCase().includes(search) && !kid.toLowerCase().includes(search)) return;

    const isBanned = d.Banned === true;
    let isExpired = false;
    if (d.ExpiryDate) {
      const p = d.ExpiryDate.split('-');
      if (p.length === 3) {
        const e = new Date(p[0], p[1]-1, p[2]); e.setHours(23,59,59,999);
        isExpired = e < new Date();
      }
    }
    if (CURRENT_FILTER === 'banned' && !isBanned) return;
    if (CURRENT_FILTER === 'active' && (isBanned || isExpired)) return;
    if (CURRENT_FILTER === 'expired' && (!isExpired || isBanned)) return;

    vis++;
    const cc = isBanned ? 'card banned' : 'card';
    const bc = isBanned ? 'card-badge banned' : (isExpired ? 'card-badge banned' : 'card-badge active');
    const bt = isBanned ? 'BANNED' : (isExpired ? 'EXPIRED' : 'ACTIVE');

    let dc = 0, dh = '';
    if (d.Devices) {
      Object.keys(d.Devices).forEach(hw => {
        if (hw !== 'dummy') { dc++; dh += `<div class="device-chip"><i class="fas fa-microchip"></i> ${hw.substring(0,8)}</div>`; }
      });
    }

    list.innerHTML += `<div class="${cc}">
      <div class="card-header"><div class="card-title"><i class="fas fa-fingerprint"></i><span>${kid}</span><i class="fas fa-copy copy-btn" onclick="copyToClipboard('${kid}','Copied')"></i></div><div class="${bc}">${bt}</div></div>
      <div class="sleek-row"><div class="sleek-item"><i class="fas fa-user"></i> <strong>${user}</strong></div><div class="sleek-item"><i class="fas fa-calendar-alt"></i> <strong>${d.ExpiryDate||'Never'}</strong></div><div class="sleek-item"><i class="fas fa-mobile-alt"></i> <strong>${dc} / ${d.DeviceLimit||1}</strong></div></div>
      ${dc>0?`<div class="device-chips">${dh}</div>`:''}
      <div class="card-actions">
        <button class="btn-card btn-card-edit" onclick="editKey('${kid}')"><i class="fas fa-pen"></i> Edit</button>
        <button class="btn-card ${isBanned?'btn-card-edit':'btn-card-ban'}" onclick="toggleBan('${kid}')"><i class="fas ${isBanned?'fa-check-circle':'fa-ban'}"></i> ${isBanned?'Unban':'Ban'}</button>
        <button class="btn-card btn-card-delete" onclick="deleteKey('${kid}')"><i class="fas fa-trash"></i> Delete</button>
      </div>
    </div>`;
  });
  if (vis === 0) list.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:40px;font-weight:600;"><i class="fas fa-inbox" style="font-size:2rem;margin-bottom:16px;opacity:0.5;display:block;"></i> No keys found</div>`;
};

window.addDays = function(d) {
  const dt = new Date(); dt.setDate(dt.getDate() + d);
  $('md-date').value = dt.toISOString().split('T')[0];
};

function generateNextKey() {
  recalcNext();
  return `AV-IND-${DB.NextKeyNumber || 1}`;
}

window.openAddKeyModal = function() {
  EDITING_KEY_ID = null;
  $('md-title').innerText = 'Create License Key';
  $('md-key').value = generateNextKey();
  $('md-user').value = '';
  $('md-limit').value = '1';
  addDays(30);
  const price = DB.App_Status?.KeyPrice || 49;
  if (CURRENT_ROLE === 'operator') {
    $('operator-payment-info').style.display = 'block';
    $('payment-amount-display').innerText = price;
    $('btn-save-key').innerHTML = `<i class="fas fa-credit-card"></i> PAY ₹${price} & GENERATE`;
  } else {
    $('operator-payment-info').style.display = 'none';
    $('btn-save-key').innerHTML = `<i class="fas fa-check"></i> SAVE KEY`;
  }
  openModal('modal-key');
};

window.editKey = function(kid) {
  EDITING_KEY_ID = kid;
  const d = DB.Keys[kid];
  $('md-title').innerText = 'Edit License Key';
  $('md-key').value = kid;
  $('md-user').value = d.Username || '';
  $('md-limit').value = d.DeviceLimit || 1;
  $('md-date').value = d.ExpiryDate || '';
  $('operator-payment-info').style.display = 'none';
  $('btn-save-key').innerHTML = `<i class="fas fa-check"></i> SAVE KEY`;
  openModal('modal-key');
};

window.handleSaveKeyClick = function() {
  const keyId = $('md-key').value.trim();
  const user = $('md-user').value.trim();
  const limit = parseInt($('md-limit').value) || 1;
  const expiry = $('md-date').value;
  if (!keyId || !user) { showToast('Key and Username required','danger'); return; }
  if (!expiry) { showToast('Expiry required','danger'); return; }

  if (CURRENT_ROLE === 'admin') { saveKeyDirectly(keyId, user, limit, expiry); return; }
  if (CURRENT_ROLE === 'operator') {
    PENDING_KEY_DATA = { keyId, username: user, limit, expiry };
    closeModal('modal-key');
    openPaymentScreen();
  }
};

function saveKeyDirectly(keyId, user, limit, expiry) {
  if (EDITING_KEY_ID === null) {
    if (DB.Keys[keyId]) { showToast('Key exists','danger'); return; }
    DB.Keys[keyId] = {
      Devices: { dummy: 0 }, Banned: false, Username: user,
      DeviceLimit: limit, ExpiryDate: expiry,
      CreatedBy: CURRENT_USER_ID, CreatedAt: new Date().toISOString(),
      PaymentStatus: 'FREE_ADMIN'
    };
    recalcNext();
  } else {
    const t = DB.Keys[EDITING_KEY_ID];
    if (!t) return showToast('Not found','danger');
    t.Username = user; t.DeviceLimit = limit; t.ExpiryDate = expiry;
  }
  pushDB(); closeModal('modal-key'); refreshUI(); showToast('Key Saved');
}

window.toggleBan = function(kid) {
  const t = DB.Keys[kid]; t.Banned = !t.Banned;
  pushDB(true); refreshUI();
  showToast(t.Banned ? `${kid} Banned` : `${kid} Unbanned`, t.Banned ? 'danger' : 'success');
};

window.deleteKey = function(kid) {
  if (!confirm(`Delete ${kid}?`)) return;
  delete DB.Keys[kid]; recalcNext();
  pushDB(); refreshUI(); showToast('Key Deleted','danger');
};

window.renderUsers = function() {
  const list = $('list-users'); if (!list) return;
  const search = ($('user-search-input')?.value || '').toLowerCase();
  list.innerHTML = '';
  let vis = 0;
  Object.keys(DB.Operators || {}).forEach(opId => {
    const data = DB.Operators[opId];
    const name = data.Name || opId;
    if (search && !opId.toLowerCase().includes(search) && !name.toLowerCase().includes(search)) return;
    vis++;
    const isBanned = data.Banned === true;
    const cc = isBanned ? 'card banned' : 'card';
    const bc = isBanned ? 'card-badge banned' : 'card-badge active';
    const bt = isBanned ? 'BANNED' : 'ACTIVE';
    let kc = 0;
    Object.keys(DB.Keys||{}).forEach(k => { if (DB.Keys[k].CreatedBy === data.Uid) kc++; });

    list.innerHTML += `<div class="${cc}">
      <div class="card-header"><div class="card-title"><i class="fas fa-user-shield"></i><span>${opId}</span><i class="fas fa-copy copy-btn" onclick="copyToClipboard('${opId}','Copied')"></i></div><div class="${bc}">${bt}</div></div>
      <div class="sleek-row"><div class="sleek-item"><i class="fas fa-user"></i> <strong>${name}</strong></div><div class="sleek-item"><i class="fas fa-key"></i> <strong>${kc} Keys</strong></div></div>
      <div class="card-actions">
        <button class="btn-card ${isBanned?'btn-card-edit':'btn-card-ban'}" onclick="toggleUserBan('${opId}')"><i class="fas ${isBanned?'fa-check-circle':'fa-ban'}"></i> ${isBanned?'Unban':'Ban'}</button>
        <button class="btn-card btn-card-delete" onclick="deleteUser('${opId}')"><i class="fas fa-trash"></i> Delete</button>
      </div>
    </div>`;
  });
  if (vis === 0) list.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-secondary);padding:40px;font-weight:600;"><i class="fas fa-users" style="font-size:2rem;margin-bottom:16px;opacity:0.5;display:block;"></i> No operators yet</div>`;
};

window.openAddUserModal = function() {
  if (CURRENT_ROLE !== 'admin') { showToast('Admin only','danger'); return; }
  EDITING_USER_ID = null;
  $('mu-title').innerText = 'Create Operator User';
  $('mu-id').value = ''; $('mu-id').disabled = false;
  $('mu-name').value = ''; $('mu-pass').value = ''; $('mu-contact').value = '';
  openModal('modal-user');
};

window.saveUser = async function() {
  if (CURRENT_ROLE !== 'admin') { showToast('Admin only','danger'); return; }
  const opId = $('mu-id').value.trim();
  const name = $('mu-name').value.trim();
  const pass = $('mu-pass').value.trim();
  const contact = $('mu-contact').value.trim();
  if (!opId || !pass) { showToast('ID and Password required','danger'); return; }
  if (opId.toLowerCase() === 'admin') { showToast("Cannot use 'admin'",'danger'); return; }

  try {
    const r = await fetch(`${CFG.BACKEND_URL}/api/admin/create-operator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ID_TOKEN },
      body: JSON.stringify({ opId, name, pass, contact })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    closeModal('modal-user');
    await fetchDB();
    refreshUI();
    showToast('Operator created');
  } catch (e) { showToast(e.message, 'danger'); }
};

window.toggleUserBan = async function(opId) {
  if (CURRENT_ROLE !== 'admin') { showToast('Admin only','danger'); return; }
  try {
    const r = await fetch(`${CFG.BACKEND_URL}/api/admin/toggle-operator-ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ID_TOKEN },
      body: JSON.stringify({ opId })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    await fetchDB(); refreshUI();
    showToast(`${opId} ${d.banned ? 'Banned' : 'Unbanned'}`, d.banned ? 'danger' : 'success');
  } catch (e) { showToast(e.message, 'danger'); }
};

window.deleteUser = async function(opId) {
  if (CURRENT_ROLE !== 'admin') { showToast('Admin only','danger'); return; }
  if (!confirm(`Delete ${opId}?`)) return;
  try {
    const r = await fetch(`${CFG.BACKEND_URL}/api/admin/delete-operator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ID_TOKEN },
      body: JSON.stringify({ opId })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    await fetchDB(); refreshUI();
    showToast('Deleted','danger');
  } catch (e) { showToast(e.message, 'danger'); }
};

window.populateConfig = function() {
  const a = DB.App_Status || {};
  $('cfg-maintenance').checked = a.Maintenance === true;
  $('cfg-update').checked = a.Update_Required === true;
  $('cfg-title').value = a.Dialog_Title || '';
  $('cfg-subtitle').value = a.Dialog_Subtitle || '';
  $('cfg-admin').value = a.Admin_URL || '';
  $('cfg-updatelink').value = a.Update_Link || '';
  $('cfg-bans').value = a.Banned_Devices || '';
  $('cfg-price').value = a.KeyPrice || 49;
};

window.saveConfig = function() {
  if (CURRENT_ROLE !== 'admin') { showToast('Admin only','danger'); return; }
  if (!DB.App_Status) DB.App_Status = {};
  const a = DB.App_Status;
  a.Maintenance = $('cfg-maintenance').checked;
  a.Update_Required = $('cfg-update').checked;
  a.Dialog_Title = $('cfg-title').value.trim();
  a.Dialog_Subtitle = $('cfg-subtitle').value.trim();
  a.Admin_URL = $('cfg-admin').value.trim();
  a.Update_Link = $('cfg-updatelink').value.trim();
  a.Banned_Devices = $('cfg-bans').value.trim();
  a.KeyPrice = parseInt($('cfg-price').value) || 49;
  pushDB();
  showToast('Config Saved');
};

function openPaymentScreen() {
  const price = DB.App_Status?.KeyPrice || 49;
  $('payment-view-main').style.display = 'block';
  $('payment-view-processing').classList.remove('active');
  $('payment-view-success').classList.remove('active');
  $('payment-view-fail').classList.remove('active');
  $('payment-view-amount').innerText = '₹' + price;
  $('payment-view-amount-btn').innerText = price;
  $('payment-view-key').innerText = PENDING_KEY_DATA.keyId;
  $('payment-view-user').innerText = PENDING_KEY_DATA.username;
  $('payment-view-expiry').innerText = PENDING_KEY_DATA.expiry;
  $('payment-screen').classList.add('active');
}

window.closePaymentScreen = function() {
  $('payment-screen').classList.remove('active');
  PENDING_KEY_DATA = null; PENDING_TXN_ID = null;
};
window.cancelPayment = () => { closePaymentScreen(); showToast('Payment cancelled','danger'); };
window.retryPayment = () => {
  $('payment-view-main').style.display = 'block';
  $('payment-view-processing').classList.remove('active');
  $('payment-view-fail').classList.remove('active');
};

window.startPaymentProcessing = async function() {
  $('payment-view-main').style.display = 'none';
  $('payment-view-processing').classList.add('active');
  const st = $('payment-status-text');
  st.innerText = 'Creating secure order...';
  try {
    const r = await fetch(`${CFG.BACKEND_URL}/api/payment/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ID_TOKEN },
      body: JSON.stringify(PENDING_KEY_DATA)
    });
    const data = await r.json();
    if (!r.ok) return showPaymentFailure(data.error || 'Order failed');

    PENDING_TXN_ID = data.orderId;
    st.innerText = 'Opening Cashfree checkout...';

    const cashfree = Cashfree({ mode: CFG.CASHFREE_MODE || 'sandbox' });
    const result = await cashfree.checkout({
      paymentSessionId: data.paymentSessionId,
      redirectTarget: '_modal'
    });
    if (result.error) return showPaymentFailure(result.error.message || 'Checkout error');

    st.innerText = 'Verifying payment...';
    setTimeout(() => verifyPaymentBackend(data.orderId), 3000);
  } catch (e) {
    showPaymentFailure(e.message);
  }
};

async function verifyPaymentBackend(orderId) {
  try {
    const r = await fetch(`${CFG.BACKEND_URL}/api/payment/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ID_TOKEN },
      body: JSON.stringify({ orderId })
    });
    const d = await r.json();
    if (r.ok) {
      $('payment-success-key').innerText = d.keyId;
      $('payment-success-txn').innerText = d.txnId;
      $('payment-view-processing').classList.remove('active');
      $('payment-view-success').classList.add('active');
      await fetchDB(); refreshUI();
      showToast('Payment verified — Key generated!');
    } else {
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        try {
          const r2 = await fetch(`${CFG.BACKEND_URL}/api/payment/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ID_TOKEN },
            body: JSON.stringify({ orderId })
          });
          const d2 = await r2.json();
          if (r2.ok) {
            clearInterval(iv);
            $('payment-success-key').innerText = d2.keyId;
            $('payment-success-txn').innerText = d2.txnId;
            $('payment-view-processing').classList.remove('active');
            $('payment-view-success').classList.add('active');
            await fetchDB(); refreshUI();
            showToast('Payment verified!');
          } else if (tries >= 5) {
            clearInterval(iv);
            showPaymentFailure(d2.error || 'Not paid');
          }
        } catch (e) { if (tries >= 5) { clearInterval(iv); showPaymentFailure('Verify failed'); } }
      }, 3000);
    }
  } catch (e) { showPaymentFailure('Verification failed'); }
}

function showPaymentFailure(reason) {
  $('payment-view-processing').classList.remove('active');
  $('payment-view-main').style.display = 'none';
  $('payment-fail-reason').innerText = reason;
  $('payment-view-fail').classList.add('active');
  showToast('Payment failed — no key generated','danger');
}

function refreshUI() { renderKeys(); renderUsers(); populateConfig(); }

document.addEventListener('keydown', e => {
  if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C'))) {
    e.preventDefault();
  }
});
document.addEventListener('contextmenu', e => e.preventDefault());

window.onload = () => {
  const c = $('particles');
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const s = Math.random() * 2 + 1;
    p.style.width = s + 'px'; p.style.height = s + 'px';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.top = Math.random() * 100 + 'vh';
    p.style.animationDuration = (Math.random() * 3 + 2) + 's';
    p.style.animationDelay = (Math.random() * 5) + 's';
    c.appendChild(p);
  }

  auth.onAuthStateChanged(async user => {
    if (user) {
      ID_TOKEN = await user.getIdToken();
      CURRENT_USER_ID = user.uid;
      CURRENT_ROLE = user.email === 'admin@anurag.online' ? 'admin' : 'operator';
      try {
        await fetchDB();
        switchScreen('screen-dashboard');
        nav('keys');
      } catch (e) { console.error(e); }
    }
  });
};