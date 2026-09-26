// ============================================
// ANURAG ONLINE OFFICIAL - script.js
// Firebase + Cashfree Integration
// ============================================

// ---------- FIREBASE CONFIG ----------
const FIREBASE_URL = "https://anurag-online-official-default-rtdb.asia-southeast1.firebasedatabase.app";

// ---------- GLOBAL STATE ----------
let currentUser = null;        // { role, username, displayName, created }
let allKeys = {};              // Keys from Firebase
let allOperators = {};         // Operators (localStorage ya Firebase)
let appStatus = {};            // App_Status from Firebase
let currentKeyFilter = 'all';
let selectedDays = 0;
let selectedPrice = 0;
let isAdmin = false;

// ---------- PACKAGE PRICES ----------
const PACKAGE_PRICES = {
    7: 2100, 14: 4200, 21: 6300, 28: 8400,
    35: 10500, 42: 12600, 49: 14700
};

// ---------- DEFAULT ADMIN CREDENTIALS ----------
const DEFAULT_ADMIN = {
    username: 'admin',
    password: 'admin123',
    displayName: 'Administrator'
};

// ============================================
// UTILITIES
// ============================================
function showToast(msg, type = 'success') {
    const island = document.getElementById('dynamic-island');
    const icon = document.getElementById('di-icon');
    const msgEl = document.getElementById('di-msg');
    
    msgEl.textContent = msg;
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    const colors = {
        success: 'var(--success)',
        error: 'var(--danger)',
        warning: 'var(--warning)',
        info: 'var(--primary)'
    };
    icon.className = `fas ${icons[type] || icons.success}`;
    icon.style.color = colors[type] || colors.success;
    
    island.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => island.classList.remove('show'), 3000);
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return isoStr; }
}

function daysLeft(expiryStr) {
    if (!expiryStr) return 0;
    const expiry = new Date(expiryStr);
    const now = new Date();
    return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

// ============================================
// LOGIN / AUTH
// ============================================
function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    
    if (!username || !password) {
        return showToast('Username aur Password dono daalein', 'error');
    }
    
    // Admin login
    if (username === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
        currentUser = {
            role: 'admin',
            username: username,
            displayName: DEFAULT_ADMIN.displayName,
            created: new Date().toISOString()
        };
        isAdmin = true;
        sessionStorage.setItem('ao_user', JSON.stringify(currentUser));
        showToast('Admin login successful!', 'success');
        startApp();
        return;
    }
    
    // Operator login (localStorage se check)
    const operators = JSON.parse(localStorage.getItem('ao_operators') || '{}');
    if (operators[username] && operators[username].password === password) {
        currentUser = {
            role: 'operator',
            username: username,
            displayName: operators[username].displayName || username,
            created: operators[username].created || new Date().toISOString()
        };
        isAdmin = false;
        sessionStorage.setItem('ao_user', JSON.stringify(currentUser));
        showToast(`Welcome, ${currentUser.displayName}!`, 'success');
        startApp();
        return;
    }
    
    showToast('Invalid credentials!', 'error');
}

function logout() {
    if (!confirm('Logout karna chahte hain?')) return;
    sessionStorage.removeItem('ao_user');
    currentUser = null;
    isAdmin = false;
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    showToast('Logged out', 'info');
}

function checkSession() {
    const saved = sessionStorage.getItem('ao_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            isAdmin = currentUser.role === 'admin';
            startApp();
        } catch { sessionStorage.removeItem('ao_user'); }
    }
}

// ============================================
// APP START
// ============================================
async function startApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'flex';
    
    // Set user badge
    const badge = document.getElementById('user-badge');
    badge.textContent = currentUser.role.toUpperCase();
    badge.className = `user-badge ${currentUser.role}`;
    
    // Show admin-only nav
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdmin ? 'flex' : 'none';
    });
    
    // Account info
    document.getElementById('info-role').textContent = currentUser.role;
    document.getElementById('info-username').textContent = currentUser.username;
    document.getElementById('info-created').textContent = formatDate(currentUser.created);
    
    // Role-based modal actions
    document.getElementById('admin-key-actions').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('operator-key-actions').style.display = isAdmin ? 'none' : 'block';
    
    // Load data
    await fetchDatabase();
    await loadAppStatus();
    
    // Show changelog once
    if (!sessionStorage.getItem('ao_seen_changelog')) {
        document.getElementById('changelog-modal').classList.add('active');
        sessionStorage.setItem('ao_seen_changelog', '1');
    }
}

// ============================================
// FETCH DATABASE
// ============================================
async function fetchDatabase() {
    const icon = document.getElementById('reload-icon');
    if (icon) icon.classList.add('spin');
    
    try {
        const res = await fetch(`${FIREBASE_URL}/Keys.json`);
        if (!res.ok) throw new Error('Fetch failed');
        allKeys = (await res.json()) || {};
        
        renderKeys();
        renderBans();
        renderTrials();
        renderOperators();
        
        showToast('Data refreshed', 'success');
    } catch (err) {
        console.error('fetchDatabase error:', err);
        showToast('Failed to load data', 'error');
    } finally {
        if (icon) icon.classList.remove('spin');
    }
}

// ============================================
// FETCH APP STATUS
// ============================================
async function loadAppStatus() {
    try {
        const res = await fetch(`${FIREBASE_URL}/App_Status.json`);
        if (!res.ok) throw new Error('App status fetch failed');
        appStatus = (await res.json()) || {};
        
        // Populate system form
        document.getElementById('as-title').value = appStatus.Dialog_Title || '';
        document.getElementById('as-subtitle').value = appStatus.Dialog_Subtitle || '';
        document.getElementById('as-admin-link').value = appStatus.Admin_URL || '';
        document.getElementById('as-em-title').value = appStatus.Update_Required ? 'Update Required' : '';
        
        // Toggles
        const maint = document.getElementById('tog-em-mode');
        if (appStatus.Maintenance) maint.classList.add('active');
        else maint.classList.remove('active');
        
    } catch (err) {
        console.error('loadAppStatus error:', err);
    }
}

// ============================================
// RENDER KEYS
// ============================================
function getKeyStatus(keyId, data) {
    if (data.Banned) return 'banned';
    const expiry = new Date(data.ExpiryDate);
    const now = new Date();
    if (expiry < now) return 'expired';
    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (diffDays <= 3) return 'nearby';
    return 'active';
}

function setKeyFilter(filter) {
    currentKeyFilter = filter;
    document.querySelectorAll('#key-filters .filter-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.filter === filter);
    });
    renderKeys();
}

function renderKeys() {
    const container = document.getElementById('keys-list');
    const search = (document.getElementById('search-keys')?.value || '').toLowerCase().trim();
    
    if (!allKeys || Object.keys(allKeys).length === 0) {
        container.innerHTML = '<div class="empty-state">Koi key nahi mili</div>';
        return;
    }
    
    let html = '';
    let count = 0;
    
    Object.entries(allKeys).forEach(([keyId, data]) => {
        const status = getKeyStatus(keyId, data);
        
        // Filter
        if (currentKeyFilter !== 'all' && status !== currentKeyFilter) return;
        
        // Search
        const devices = data.Devices || {};
        const deviceStr = Object.keys(devices).join(' ').toLowerCase();
        const searchable = `${keyId} ${data.Username || ''} ${deviceStr}`.toLowerCase();
        if (search && !searchable.includes(search)) return;
        
        count++;
        const deviceCount = Object.keys(devices).filter(k => k !== 'dummy').length;
        const limit = data.DeviceLimit || 1;
        const expiryFormatted = formatDate(data.ExpiryDate);
        const dLeft = daysLeft(data.ExpiryDate);
        
        // Device boxes
        let deviceHtml = '';
        Object.entries(devices).forEach(([hwid, val]) => {
            if (hwid === 'dummy') return;
            deviceHtml += `
                <div class="device-box">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                        <div class="device-hwid interactive-text" onclick="copyText('${escapeHtml(hwid)}')">
                            <i class="fas fa-microchip" style="color:var(--primary)"></i>
                            ${escapeHtml(hwid)}
                        </div>
                        <span class="badge ${val === 'Active' ? 'active' : 'banned'}">${escapeHtml(val)}</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn-xs edit" onclick="editDevice('${escapeHtml(keyId)}','${escapeHtml(hwid)}')"><i class="fas fa-edit"></i> Edit</button>
                        <button class="btn-xs del" onclick="deleteDevice('${escapeHtml(keyId)}','${escapeHtml(hwid)}')"><i class="fas fa-trash"></i> Remove</button>
                    </div>
                </div>
            `;
        });
        
        html += `
            <div class="list-card ${status}" data-key="${escapeHtml(keyId)}">
                <div class="card-header-main" onclick="toggleCard(this)">
                    <div class="card-header-left">
                        <div class="card-title">
                            <i class="fas fa-key" style="color:var(--primary)"></i>
                            ${escapeHtml(keyId)}
                        </div>
                        <div class="card-subtitle">
                            <span><i class="fas fa-user"></i> ${escapeHtml(data.Username || '-')}</span>
                            <span><i class="fas fa-microchip"></i> ${deviceCount}/${limit}</span>
                            <span><i class="fas fa-calendar"></i> ${expiryFormatted}</span>
                        </div>
                    </div>
                    <div class="card-header-right">
                        <span class="badge ${status}">${status}</span>
                        <i class="fas fa-chevron-down chevron-icon"></i>
                    </div>
                </div>
                <div class="card-details">
                    <div style="font-size:0.75rem;color:var(--text-dim);font-weight:700;margin-bottom:6px">
                        <i class="fas fa-clock"></i> ${dLeft > 0 ? dLeft + ' days left' : 'Expired'}
                    </div>
                    <div class="devices-wrapper">
                        ${deviceHtml || '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:14px">No devices registered</div>'}
                    </div>
                    ${isAdmin ? `
                    <div class="card-actions">
                        <button class="btn-xs ${data.Banned ? 'approve' : 'ban'}" onclick="toggleBanKey('${escapeHtml(keyId)}', ${!data.Banned})">
                            <i class="fas ${data.Banned ? 'fa-unlock' : 'fa-ban'}"></i> ${data.Banned ? 'Unban' : 'Ban'}
                        </button>
                        <button class="btn-xs del" onclick="deleteKey('${escapeHtml(keyId)}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    });
    
    if (count === 0) {
        container.innerHTML = '<div class="empty-state">Koi key match nahi hui</div>';
    } else {
        container.innerHTML = html;
    }
}

function toggleCard(el) {
    const card = el.closest('.list-card');
    card.classList.toggle('expanded');
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied: ' + text.slice(0, 20) + '...', 'info');
    }).catch(() => showToast('Copy failed', 'error'));
}

// ============================================
// RENDER BANS
// ============================================
function renderBans() {
    const container = document.getElementById('bans-list');
    const banned = (appStatus.Banned_Devices || '').split(',').map(s => s.trim()).filter(Boolean);
    const search = (document.getElementById('search-bans')?.value || '').toLowerCase().trim();
    
    const filtered = banned.filter(h => !search || h.toLowerCase().includes(search));
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">Koi banned device nahi</div>';
        return;
    }
    
    container.innerHTML = filtered.map(hwid => `
        <div class="list-card banned">
            <div class="card-header-main">
                <div class="card-header-left">
                    <div class="card-title"><i class="fas fa-ban" style="color:var(--danger)"></i> ${escapeHtml(hwid)}</div>
                </div>
                <button class="btn-xs approve" onclick="unbanHwid('${escapeHtml(hwid)}')">
                    <i class="fas fa-unlock"></i> Unban
                </button>
            </div>
        </div>
    `).join('');
}

// ============================================
// RENDER TRIALS
// ============================================
function renderTrials() {
    const container = document.getElementById('trials-list');
    // Trials = keys with Username containing "trial" OR expiry < 7 days
    const trials = Object.entries(allKeys).filter(([id, d]) => {
        return (d.Username || '').toLowerCase().includes('trial');
    });
    
    if (trials.length === 0) {
        container.innerHTML = '<div class="empty-state">Koi trial nahi</div>';
        return;
    }
    
    container.innerHTML = trials.map(([id, d]) => `
        <div class="list-card nearby">
            <div class="card-header-main">
                <div class="card-header-left">
                    <div class="card-title"><i class="fas fa-hourglass-half" style="color:var(--lime)"></i> ${escapeHtml(id)}</div>
                    <div class="card-subtitle"><span>${escapeHtml(d.Username)}</span></div>
                </div>
                <span class="badge nearby">${daysLeft(d.ExpiryDate)}d left</span>
            </div>
        </div>
    `).join('');
}

// ============================================
// RENDER OPERATORS
// ============================================
function renderOperators() {
    const container = document.getElementById('operators-list');
    const operators = JSON.parse(localStorage.getItem('ao_operators') || '{}');
    const search = (document.getElementById('search-operators')?.value || '').toLowerCase().trim();
    
    const entries = Object.entries(operators).filter(([u, o]) => 
        !search || u.toLowerCase().includes(search) || (o.displayName || '').toLowerCase().includes(search)
    );
    
    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state">Koi operator nahi</div>';
        return;
    }
    
    container.innerHTML = entries.map(([username, op]) => `
        <div class="list-card operator">
            <div class="card-header-main">
                <div class="card-header-left">
                    <div class="card-title"><i class="fas fa-user-cog" style="color:var(--accent)"></i> ${escapeHtml(username)}</div>
                    <div class="card-subtitle">
                        <span>${escapeHtml(op.displayName || '-')}</span>
                        <span>${formatDate(op.created)}</span>
                    </div>
                </div>
                <button class="btn-xs del" onclick="deleteOperator('${escapeHtml(username)}')">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        </div>
    `).join('');
}

// ============================================
// KEY MODAL
// ============================================
function openKeyModal() {
    document.getElementById('key-modal').classList.add('active');
    document.getElementById('mod-key-id').value = '';
    document.getElementById('mod-key-username').value = 'Anurag Online Official';
    document.getElementById('mod-key-limit').value = 1;
    document.getElementById('mod-key-amount').value = '';
    document.getElementById('mod-key-date').value = '';
    document.getElementById('expiry-preview-text').textContent = 'Select a package';
    selectedDays = 0;
    selectedPrice = 0;
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('op-fee-summary').style.display = 'none';
    document.getElementById('admin-fee-summary').style.display = 'none';
    document.getElementById('payment-btn-op').disabled = true;
    document.getElementById('payment-btn-admin').disabled = true;
    randomKey();
}

// ---------- KEY ID GENERATOR (AOO-IND-X) ----------
async function randomKey() {
    try {
        const res = await fetch(`${FIREBASE_URL}/Keys.json`);
        const keys = (await res.json()) || {};
        
        let maxSerial = 0;
        Object.keys(keys).forEach(keyId => {
            const match = keyId.match(/^AOO-IND-(\d+)$/);
            if (match) {
                const n = parseInt(match[1], 10);
                if (n > maxSerial) maxSerial = n;
            }
        });
        
        const newKeyId = `AOO-IND-${maxSerial + 1}`;
        document.getElementById('mod-key-id').value = newKeyId;
    } catch (err) {
        const fallback = `AOO-IND-${Date.now().toString().slice(-4)}`;
        document.getElementById('mod-key-id').value = fallback;
    }
}

// ---------- PACKAGE SELECTION ----------
function setDays(days, btn) {
    selectedDays = days;
    selectedPrice = PACKAGE_PRICES[days] || 0;
    
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    
    document.getElementById('mod-key-amount').value = `₹${selectedPrice}`;
    
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    const expiryStr = expiry.toISOString().split('T')[0];
    document.getElementById('mod-key-date').value = expiryStr;
    
    document.getElementById('expiry-preview-text').textContent = 
        `${days} days → ${expiry.toLocaleDateString('en-IN')}`;
    
    // Fee summaries
    const limit = document.getElementById('mod-key-limit').value || 1;
    document.getElementById('op-fee-package').textContent = `${days} Days`;
    document.getElementById('op-fee-devices').textContent = limit;
    document.getElementById('op-fee-amount').textContent = `₹${selectedPrice}`;
    document.getElementById('op-fee-summary').style.display = 'block';
    document.getElementById('admin-fee-amount').textContent = `₹${selectedPrice}`;
    document.getElementById('admin-fee-summary').style.display = 'block';
    
    document.getElementById('payment-btn-op').disabled = false;
    document.getElementById('payment-btn-admin').disabled = false;
}

// ---------- SAVE KEY DIRECTLY (ADMIN) ----------
async function saveKeyDirectly() {
    const keyId = document.getElementById('mod-key-id').value.trim();
    const username = document.getElementById('mod-key-username').value.trim() || 'Anurag Online Official';
    const limit = parseInt(document.getElementById('mod-key-limit').value) || 1;
    const expiry = document.getElementById('mod-key-date').value;
    
    if (!keyId) return showToast('Key ID required', 'error');
    if (!/^AOO-IND-\d+$/.test(keyId)) return showToast('Invalid format. Use: AOO-IND-1', 'error');
    if (!expiry) return showToast('Package select karein', 'error');
    
    const keyData = {
        Banned: false,
        DeviceLimit: limit,
        Devices: { dummy: 0 },
        ExpiryDate: expiry,
        Username: username
    };
    
    try {
        const res = await fetch(`${FIREBASE_URL}/Keys/${keyId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keyData)
        });
        if (!res.ok) throw new Error('Save failed');
        
        showToast(`Key ${keyId} created!`, 'success');
        closeModals();
        fetchDatabase();
    } catch (err) {
        console.error(err);
        showToast('Failed to save key', 'error');
    }
}

// ---------- PAYMENT (OPERATOR) ----------
function openPaymentModal() {
    const keyId = document.getElementById('mod-key-id').value.trim();
    const username = document.getElementById('mod-key-username').value.trim() || 'Anurag Online Official';
    const limit = parseInt(document.getElementById('mod-key-limit').value) || 1;
    
    if (!selectedDays || !selectedPrice) return showToast('Package select karein', 'error');
    if (!keyId) return showToast('Key ID generate karein', 'error');
    
    // CASHFREE INTEGRATION
    // NOTE: Real Cashfree ke liye session ID backend se aani chahiye.
    // Yahan demo flow diya gaya hai.
    
    // Demo: Directly save key after "payment"
    (async () => {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + selectedDays);
        
        const keyData = {
            Banned: false,
            DeviceLimit: limit,
            Devices: { dummy: 0 },
            ExpiryDate: expiry.toISOString().split('T')[0],
            Username: username
        };
        
        try {
            const res = await fetch(`${FIREBASE_URL}/Keys/${keyId}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(keyData)
            });
            if (!res.ok) throw new Error('Save failed');
            
            closeModals();
            document.getElementById('payment-instruction-modal').classList.add('active');
            fetchDatabase();
        } catch (err) {
            console.error(err);
            showToast('Payment failed', 'error');
        }
    })();
}

function closePaymentModal() {
    document.getElementById('payment-instruction-modal').classList.remove('active');
}

// ============================================
// DEVICE MANAGEMENT
// ============================================
function editDevice(keyId, hwid) {
    document.getElementById('mod-edit-hwid').value = hwid;
    document.getElementById('mod-edit-old-hwid').value = hwid;
    document.getElementById('mod-edit-key-id').value = keyId;
    document.getElementById('edit-hwid-modal').classList.add('active');
}

async function saveEditedHWID() {
    const keyId = document.getElementById('mod-edit-key-id').value;
    const oldHwid = document.getElementById('mod-edit-old-hwid').value;
    const newHwid = document.getElementById('mod-edit-hwid').value.trim();
    
    if (!newHwid) return showToast('HWID required', 'error');
    
    try {
        const res = await fetch(`${FIREBASE_URL}/Keys/${keyId}/Devices.json`);
        const devices = (await res.json()) || {};
        const oldVal = devices[oldHwid];
        delete devices[oldHwid];
        devices[newHwid] = oldVal;
        
        await fetch(`${FIREBASE_URL}/Keys/${keyId}/Devices.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(devices)
        });
        
        showToast('Device updated', 'success');
        closeModals();
        fetchDatabase();
    } catch (err) {
        console.error(err);
        showToast('Update failed', 'error');
    }
}

async function deleteDevice(keyId, hwid) {
    if (!confirm(`Remove device ${hwid}?`)) return;
    try {
        await fetch(`${FIREBASE_URL}/Keys/${keyId}/Devices/${hwid}.json`, { method: 'DELETE' });
        showToast('Device removed', 'success');
        fetchDatabase();
    } catch (err) {
        showToast('Failed', 'error');
    }
}

async function toggleBanKey(keyId, ban) {
    try {
        await fetch(`${FIREBASE_URL}/Keys/${keyId}/Banned.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ban)
        });
        showToast(ban ? 'Key banned' : 'Key unbanned', 'success');
        fetchDatabase();
    } catch (err) {
        showToast('Failed', 'error');
    }
}

async function deleteKey(keyId) {
    if (!confirm(`Delete key ${keyId}? Ye undo nahi hoga!`)) return;
    try {
        await fetch(`${FIREBASE_URL}/Keys/${keyId}.json`, { method: 'DELETE' });
        showToast('Key deleted', 'success');
        fetchDatabase();
    } catch (err) {
        showToast('Failed', 'error');
    }
}

// ============================================
// BANS
// ============================================
function openBanModal() {
    document.getElementById('mod-ban-id').value = '';
    document.getElementById('ban-modal').classList.add('active');
}

async function saveBan() {
    const hwid = document.getElementById('mod-ban-id').value.trim();
    if (!hwid) return showToast('HWID required', 'error');
    
    const current = (appStatus.Banned_Devices || '').split(',').map(s => s.trim()).filter(Boolean);
    if (current.includes(hwid)) return showToast('Already banned', 'warning');
    current.push(hwid);
    
    try {
        await fetch(`${FIREBASE_URL}/App_Status/Banned_Devices.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current.join(','))
        });
        appStatus.Banned_Devices = current.join(',');
        showToast('HWID banned', 'success');
        closeModals();
        renderBans();
    } catch (err) {
        showToast('Failed', 'error');
    }
}

async function unbanHwid(hwid) {
    const current = (appStatus.Banned_Devices || '').split(',').map(s => s.trim()).filter(Boolean);
    const updated = current.filter(h => h !== hwid);
    
    try {
        await fetch(`${FIREBASE_URL}/App_Status/Banned_Devices.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated.join(','))
        });
        appStatus.Banned_Devices = updated.join(',');
        showToast('Unbanned', 'success');
        renderBans();
    } catch (err) {
        showToast('Failed', 'error');
    }
}

// ============================================
// OPERATORS
// ============================================
function openOperatorModal() {
    document.getElementById('mod-op-username').value = '';
    document.getElementById('mod-op-password').value = '';
    document.getElementById('mod-op-name').value = '';
    document.getElementById('mod-op-notes').value = '';
    document.getElementById('operator-modal').classList.add('active');
}

function saveOperator() {
    const username = document.getElementById('mod-op-username').value.trim();
    const password = document.getElementById('mod-op-password').value.trim();
    const name = document.getElementById('mod-op-name').value.trim();
    const notes = document.getElementById('mod-op-notes').value.trim();
    
    if (!username || !password) return showToast('Username & Password required', 'error');
    
    const operators = JSON.parse(localStorage.getItem('ao_operators') || '{}');
    if (operators[username]) return showToast('Operator already exists', 'error');
    
    operators[username] = {
        password,
        displayName: name || username,
        notes,
        created: new Date().toISOString()
    };
    localStorage.setItem('ao_operators', JSON.stringify(operators));
    
    showToast(`Operator ${username} created`, 'success');
    closeModals();
    renderOperators();
}

function deleteOperator(username) {
    if (!confirm(`Delete operator ${username}?`)) return;
    const operators = JSON.parse(localStorage.getItem('ao_operators') || '{}');
    delete operators[username];
    localStorage.setItem('ao_operators', JSON.stringify(operators));
    showToast('Operator deleted', 'success');
    renderOperators();
}

// ============================================
// CHANGE PASSWORD
// ============================================
function openChangePasswordModal() {
    document.getElementById('mod-current-pass').value = '';
    document.getElementById('mod-new-pass').value = '';
    document.getElementById('mod-confirm-pass').value = '';
    document.getElementById('change-password-modal').classList.add('active');
}

function saveNewPassword() {
    const curr = document.getElementById('mod-current-pass').value;
    const newP = document.getElementById('mod-new-pass').value;
    const conf = document.getElementById('mod-confirm-pass').value;
    
    if (!curr || !newP || !conf) return showToast('All fields required', 'error');
    if (newP !== conf) return showToast('Passwords do not match', 'error');
    if (newP.length < 4) return showToast('Password too short', 'error');
    
    if (isAdmin) {
        if (curr !== DEFAULT_ADMIN.password) return showToast('Current password wrong', 'error');
        DEFAULT_ADMIN.password = newP;
        showToast('Admin password updated (session only)', 'success');
    } else {
        const operators = JSON.parse(localStorage.getItem('ao_operators') || '{}');
        const op = operators[currentUser.username];
        if (!op || op.password !== curr) return showToast('Current password wrong', 'error');
        op.password = newP;
        localStorage.setItem('ao_operators', JSON.stringify(operators));
        showToast('Password updated', 'success');
    }
    
    closeModals();
}

// ============================================
// APP STATUS / SYSTEM
// ============================================
function toggleSwitch(el) {
    el.classList.toggle('active');
}

async function saveAppStatus() {
    if (!isAdmin) return showToast('Admin only', 'error');
    
    const data = {
        Dialog_Title: document.getElementById('as-title').value.trim(),
        Dialog_Subtitle: document.getElementById('as-subtitle').value.trim(),
        Admin_URL: document.getElementById('as-admin-link').value.trim(),
        Maintenance: document.getElementById('tog-em-mode').classList.contains('active'),
        Update_Required: document.getElementById('tog-em-cancel').classList.contains('active'),
        Banned_Devices: appStatus.Banned_Devices || '',
        Update_Link: appStatus.Update_Link || ''
    };
    
    try {
        await fetch(`${FIREBASE_URL}/App_Status.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        appStatus = data;
        showToast('Config saved', 'success');
    } catch (err) {
        showToast('Failed to save', 'error');
    }
}

// ============================================
// NAVIGATION
// ============================================
function nav(view, el, title, subtitle) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const target = document.getElementById('view-' + view);
    if (target) target.classList.add('active');
    if (el) el.classList.add('active');
    
    document.getElementById('page-subtitle-text').textContent = subtitle || '';
    document.querySelector('.app-main-title').textContent = title || 'Anurag Online Official';
}

// ============================================
// POLICIES
// ============================================
function openPolicy(type) {
    document.querySelectorAll('.policy-page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('policy-' + type);
    if (page) page.classList.add('active');
    window.scrollTo(0, 0);
}

function closePolicy() {
    document.querySelectorAll('.policy-page').forEach(p => p.classList.remove('active'));
}

// ============================================
// MODALS
// ============================================
function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function closeChangelog() {
    document.getElementById('changelog-modal').classList.remove('active');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ============================================
// INIT
// ============================================
window.addEventListener('DOMContentLoaded', () => {
    checkSession();
});
