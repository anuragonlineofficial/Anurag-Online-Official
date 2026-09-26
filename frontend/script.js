/* ============================================================
   ANURAG ONLINE OFFICIAL - MAIN SCRIPT
   Firebase RTDB + Cashfree + Full Panel Logic
   ============================================================ */

// ===== FIREBASE CONFIG =====
const FIREBASE_BASE = "https://anurag-online-official-default-rtdb.asia-southeast1.firebasedatabase.app";

// ===== ADMIN DEFAULT CREDENTIALS =====
const ADMIN_USER = "admin";
const ADMIN_PASS = "anurag@2025";

// ===== GLOBAL STATE =====
let currentUser = null;        // { username, role, name }
let keysCache = {};
let bansCache = {};
let trialsCache = {};
let operatorsCache = {};
let keyFilter = "all";
let appStatus = {};
let selectedDays = 0;
let selectedAmount = 0;
let advancedMode = false;
let currentKeyEditTarget = null;

// ===== PRICE TABLE (LOCKED) =====
const PRICE_TABLE = {
  7: 2100,
  14: 4200,
  21: 6300,
  28: 8400,
  35: 10500,
  42: 12600,
  49: 14700
};

// ============================================================
// FIREBASE REST HELPERS
// ============================================================
async function fbGet(path) {
  try {
    const res = await fetch(`${FIREBASE_BASE}/${path}.json`);
    if (!res.ok) throw new Error("Network error");
    return await res.json();
  } catch (e) {
    console.error("FB GET error:", path, e);
    return null;
  }
}

async function fbSet(path, data) {
  try {
    const res = await fetch(`${FIREBASE_BASE}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) {
    console.error("FB SET error:", path, e);
    return false;
  }
}

async function fbPatch(path, data) {
  try {
    const res = await fetch(`${FIREBASE_BASE}/${path}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) {
    console.error("FB PATCH error:", path, e);
    return false;
  }
}

async function fbDelete(path) {
  try {
    const res = await fetch(`${FIREBASE_BASE}/${path}.json`, { method: "DELETE" });
    return res.ok;
  } catch (e) {
    console.error("FB DELETE error:", path, e);
    return false;
  }
}

// ============================================================
// DYNAMIC ISLAND TOAST
// ============================================================
let islandTimer = null;
function showIsland(msg, icon = "check-circle", color = "var(--primary)") {
  const island = document.getElementById("dynamic-island");
  const iconEl = document.getElementById("di-icon");
  const msgEl = document.getElementById("di-msg");
  iconEl.className = `fas fa-${icon}`;
  iconEl.style.color = color;
  msgEl.textContent = msg;
  island.classList.add("show");
  clearTimeout(islandTimer);
  islandTimer = setTimeout(() => island.classList.remove("show"), 3000);
}

// ============================================================
// LOGIN SYSTEM
// ============================================================
function doLogin() {
  const u = document.getElementById("login-username").value.trim();
  const p = document.getElementById("login-password").value.trim();

  if (!u || !p) {
    showIsland("Username & Password required", "exclamation-triangle", "var(--warning)");
    return;
  }

  // Admin login
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    currentUser = { username: "admin", role: "admin", name: "Administrator" };
    enterApp();
    return;
  }

  // Operator login (from Firebase)
  (async () => {
    const ops = await fbGet("Operators");
    if (ops) {
      for (const [id, op] of Object.entries(ops)) {
        if (op && op.username === u && op.password === p) {
          currentUser = { username: u, role: "operator", name: op.name || u, id };
          enterApp();
          return;
        }
      }
    }
    showIsland("Invalid credentials", "times-circle", "var(--danger)");
  })();
}

function enterApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("main-app").style.display = "flex";
  document.getElementById("bottom-nav").style.display = "flex";

  // Role-based UI
  const badge = document.getElementById("user-badge");
  if (currentUser.role === "admin") {
    badge.textContent = "ADMIN";
    badge.className = "user-badge admin";
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "flex");
  } else {
    badge.textContent = "OPERATOR";
    badge.className = "user-badge operator";
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
  }

  // Account info
  document.getElementById("info-role").textContent = currentUser.role.toUpperCase();
  document.getElementById("info-username").textContent = currentUser.username;
  document.getElementById("info-created").textContent = new Date().toLocaleDateString();

  // Show changelog once
  if (!sessionStorage.getItem("changelog_shown")) {
    openModal("changelog-modal");
    sessionStorage.setItem("changelog_shown", "1");
  }

  fetchDatabase();
}

function logout() {
  if (!confirm("Logout karna chahte ho?")) return;
  currentUser = null;
  document.getElementById("main-app").style.display = "none";
  document.getElementById("bottom-nav").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("login-username").value = "";
  document.getElementById("login-password").value = "";
  showIsland("Logged out", "power-off", "var(--warning)");
}

// ============================================================
// FETCH DATABASE
// ============================================================
async function fetchDatabase() {
  const icon = document.getElementById("reload-icon");
  icon.classList.add("spin");

  const [keys, bans, status, ops] = await Promise.all([
    fbGet("Keys"),
    fbGet("App_Status/Banned_Devices"),
    fbGet("App_Status"),
    fbGet("Operators")
  ]);

  keysCache = keys || {};
  bansCache = bans ? String(bans).split(",").filter(Boolean) : [];
  appStatus = status || {};
  operatorsCache = ops || {};

  // Trials = keys with Banned==="trial" or special flag (optional)
  trialsCache = {};
  Object.entries(keysCache).forEach(([k, v]) => {
    if (v && v.Trial === true) trialsCache[k] = v;
  });

  renderKeys();
  renderBans();
  renderTrials();
  renderOperators();
  loadSystemConfig();

  icon.classList.remove("spin");
}

// ============================================================
// RENDER: KEYS
// ============================================================
function getKeyStatus(key, data) {
  if (!data) return "expired";
  if (data.Banned === true) return "banned";
  if (data.Pending === true) return "pending";

  const expiry = data.ExpiryDate ? new Date(data.ExpiryDate) : null;
  const now = new Date();
  if (expiry && expiry < now) return "expired";

  const diffDays = expiry ? (expiry - now) / (1000 * 60 * 60 * 24) : 999;
  if (diffDays <= 3) return "nearby";
  return "active";
}

function renderKeys() {
  const list = document.getElementById("keys-list");
  const search = (document.getElementById("search-keys").value || "").toLowerCase().trim();
  list.innerHTML = "";

  let entries = Object.entries(keysCache);

  // Filter by status
  if (keyFilter !== "all") {
    entries = entries.filter(([k, v]) => getKeyStatus(k, v) === keyFilter);
  }

  // Filter by search
  if (search) {
    entries = entries.filter(([k, v]) => {
      const hwidMatch = v.Devices
        ? Object.keys(v.Devices).some(d => d.toLowerCase().includes(search))
        : false;
      return (
        k.toLowerCase().includes(search) ||
        (v.Username || "").toLowerCase().includes(search) ||
        hwidMatch
      );
    });
  }

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-state">No keys found</div>`;
    return;
  }

  entries.forEach(([keyId, data]) => {
    const status = getKeyStatus(keyId, data);
    const devices = data.Devices || {};
    const deviceCount = Object.keys(devices).length;
    const limit = data.DeviceLimit || 1;

    const card = document.createElement("div");
    card.className = `list-card ${status}`;
    card.innerHTML = `
      <div class="card-header-main" onclick="toggleCard(this)">
        <div class="card-header-left">
          <div class="card-title"><i class="fas fa-key" style="color:var(--primary)"></i> ${escapeHtml(keyId)}</div>
          <div class="card-subtitle">
            <span><i class="fas fa-user"></i> ${escapeHtml(data.Username || "N/A")}</span>
            <span><i class="fas fa-laptop"></i> ${deviceCount}/${limit}</span>
            <span><i class="fas fa-calendar"></i> ${data.ExpiryDate || "N/A"}</span>
          </div>
        </div>
        <div class="card-header-right">
          <span class="badge ${status}">${status}</span>
          <i class="fas fa-chevron-down chevron-icon"></i>
        </div>
      </div>
      <div class="card-details">
        <div class="devices-wrapper">
          ${deviceCount === 0
            ? `<div style="text-align:center;color:var(--text-dim);padding:10px;font-size:0.8rem">No devices bound</div>`
            : Object.entries(devices).map(([hwid, val]) => `
              <div class="device-box">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span class="interactive-text device-hwid" onclick="copyText('${escapeAttr(hwid)}')">
                    <i class="fas fa-microchip"></i> ${escapeHtml(hwid)}
                  </span>
                  <span class="badge ${val === 'Active' ? 'active' : ''}" style="font-size:0.55rem">${val || 'Inactive'}</span>
                </div>
                <div class="card-actions">
                  <button class="btn-xs edit" onclick="openEditHwid('${escapeAttr(keyId)}','${escapeAttr(hwid)}')"><i class="fas fa-edit"></i> Edit</button>
                  <button class="btn-xs del" onclick="removeHwid('${escapeAttr(keyId)}','${escapeAttr(hwid)}')"><i class="fas fa-trash"></i> Remove</button>
                </div>
              </div>
            `).join("")
          }
        </div>
        <div class="card-actions">
          <button class="btn-xs edit" onclick="openKeyModal('${escapeAttr(keyId)}')"><i class="fas fa-edit"></i> Edit Key</button>
          <button class="btn-xs ban" onclick="toggleBanKey('${escapeAttr(keyId)}')"><i class="fas fa-ban"></i> ${data.Banned ? "Unban" : "Ban"}</button>
          <button class="btn-xs del" onclick="deleteKey('${escapeAttr(keyId)}')"><i class="fas fa-trash"></i> Delete</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function setKeyFilter(filter) {
  keyFilter = filter;
  document.querySelectorAll("#key-filters .filter-pill").forEach(el => {
    el.classList.toggle("active", el.dataset.filter === filter);
  });
  renderKeys();
}

function toggleCard(el) {
  const card = el.closest(".list-card");
  card.classList.toggle("expanded");
}

// ============================================================
// RENDER: BANS
// ============================================================
function renderBans() {
  const list = document.getElementById("bans-list");
  const search = (document.getElementById("search-bans").value || "").toLowerCase().trim();
  list.innerHTML = "";

  let bans = bansCache.filter(b => !search || b.toLowerCase().includes(search));

  if (bans.length === 0) {
    list.innerHTML = `<div class="empty-state">No banned devices</div>`;
    return;
  }

  bans.forEach(hwid => {
    const card = document.createElement("div");
    card.className = "list-card banned";
    card.innerHTML = `
      <div class="card-header-main">
        <div class="card-header-left">
          <div class="card-title"><i class="fas fa-ban" style="color:var(--danger)"></i> Banned</div>
          <div class="card-subtitle"><span class="device-hwid">${escapeHtml(hwid)}</span></div>
        </div>
        <div class="card-header-right">
          <button class="btn-xs del" style="width:auto;padding:8px 14px" onclick="unbanHwid('${escapeAttr(hwid)}')"><i class="fas fa-unlock"></i></button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function openBanModal() {
  document.getElementById("mod-ban-id").value = "";
  openModal("ban-modal");
}

async function saveBan() {
  const hwid = document.getElementById("mod-ban-id").value.trim();
  if (!hwid) return showIsland("HWID required", "exclamation-triangle", "var(--warning)");
  if (bansCache.includes(hwid)) return showIsland("Already banned", "info-circle", "var(--warning)");

  bansCache.push(hwid);
  const ok = await fbSet("App_Status/Banned_Devices", bansCache.join(","));
  if (ok) {
    showIsland("Device banned", "ban", "var(--danger)");
    closeModals();
    renderBans();
  } else {
    showIsland("Failed to ban", "times-circle", "var(--danger)");
  }
}

async function unbanHwid(hwid) {
  if (!confirm(`Unban ${hwid}?`)) return;
  bansCache = bansCache.filter(b => b !== hwid);
  const ok = await fbSet("App_Status/Banned_Devices", bansCache.join(","));
  if (ok) {
    showIsland("Unbanned", "unlock", "var(--success)");
    renderBans();
  }
}

// ============================================================
// RENDER: TRIALS
// ============================================================
function renderTrials() {
  const list = document.getElementById("trials-list");
  const search = (document.getElementById("search-trials").value || "").toLowerCase().trim();
  list.innerHTML = "";

  let trials = Object.entries(trialsCache);
  if (search) {
    trials = trials.filter(([k, v]) => {
      const hwidMatch = v.Devices ? Object.keys(v.Devices).some(d => d.toLowerCase().includes(search)) : false;
      return k.toLowerCase().includes(search) || hwidMatch;
    });
  }

  if (trials.length === 0) {
    list.innerHTML = `<div class="empty-state">No active trials</div>`;
    return;
  }

  trials.forEach(([keyId, data]) => {
    const card = document.createElement("div");
    card.className = "list-card nearby";
    card.innerHTML = `
      <div class="card-header-main">
        <div class="card-header-left">
          <div class="card-title"><i class="fas fa-hourglass-half" style="color:var(--lime)"></i> ${escapeHtml(keyId)}</div>
          <div class="card-subtitle"><span><i class="fas fa-calendar"></i> ${data.ExpiryDate || "N/A"}</span></div>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

// ============================================================
// RENDER: OPERATORS
// ============================================================
function renderOperators() {
  const list = document.getElementById("operators-list");
  const search = (document.getElementById("search-operators").value || "").toLowerCase().trim();
  list.innerHTML = "";

  let ops = Object.entries(operatorsCache);
  if (search) {
    ops = ops.filter(([id, o]) =>
      id.toLowerCase().includes(search) ||
      (o.name || "").toLowerCase().includes(search) ||
      (o.username || "").toLowerCase().includes(search)
    );
  }

  if (ops.length === 0) {
    list.innerHTML = `<div class="empty-state">No operators</div>`;
    return;
  }

  ops.forEach(([id, op]) => {
    const card = document.createElement("div");
    card.className = "list-card operator";
    card.innerHTML = `
      <div class="card-header-main">
        <div class="card-header-left">
          <div class="card-title"><i class="fas fa-user-cog" style="color:var(--accent)"></i> ${escapeHtml(op.username || id)}</div>
          <div class="card-subtitle">
            <span><i class="fas fa-id-badge"></i> ${escapeHtml(op.name || "N/A")}</span>
            <span><i class="fas fa-sticky-note"></i> ${escapeHtml(op.notes || "-")}</span>
          </div>
        </div>
        <div class="card-header-right">
          <button class="btn-xs del" style="width:auto;padding:8px 14px" onclick="deleteOperator('${escapeAttr(id)}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function openOperatorModal(id = null) {
  document.getElementById("modal-operator-title").textContent = id ? "Edit Operator" : "Create Operator";
  document.getElementById("modal-operator-btn-text").textContent = id ? "Update" : "Create";
  document.getElementById("mod-op-username").value = id ? (operatorsCache[id]?.username || "") : "";
  document.getElementById("mod-op-password").value = id ? (operatorsCache[id]?.password || "") : "";
  document.getElementById("mod-op-name").value = id ? (operatorsCache[id]?.name || "") : "";
  document.getElementById("mod-op-notes").value = id ? (operatorsCache[id]?.notes || "") : "";
  document.getElementById("operator-modal").dataset.editId = id || "";
  openModal("operator-modal");
}

async function saveOperator() {
  const editId = document.getElementById("operator-modal").dataset.editId;
  const username = document.getElementById("mod-op-username").value.trim();
  const password = document.getElementById("mod-op-password").value.trim();
  const name = document.getElementById("mod-op-name").value.trim();
  const notes = document.getElementById("mod-op-notes").value.trim();

  if (!username || !password) return showIsland("Username & password required", "exclamation-triangle", "var(--warning)");

  const id = editId || `op_${Date.now()}`;
  const data = { username, password, name, notes, createdAt: new Date().toISOString() };

  const ok = await fbSet(`Operators/${id}`, data);
  if (ok) {
    operatorsCache[id] = data;
    showIsland(editId ? "Operator updated" : "Operator created", "user-plus", "var(--accent)");
    closeModals();
    renderOperators();
  } else {
    showIsland("Failed to save", "times-circle", "var(--danger)");
  }
}

async function deleteOperator(id) {
  if (!confirm("Delete this operator?")) return;
  const ok = await fbDelete(`Operators/${id}`);
  if (ok) {
    delete operatorsCache[id];
    showIsland("Operator deleted", "trash", "var(--danger)");
    renderOperators();
  }
}

// ============================================================
// KEY MODAL LOGIC
// ============================================================
function openKeyModal(keyId = null) {
  currentKeyEditTarget = keyId;
  const isEdit = !!keyId;

  document.getElementById("modal-key-title").textContent = isEdit ? "Edit Key" : "Generate Key";
  document.getElementById("mod-key-id").value = isEdit ? keyId : randomKeyString();
  document.getElementById("mod-key-id").readOnly = isEdit;

  if (isEdit && keysCache[keyId]) {
    const d = keysCache[keyId];
    document.getElementById("mod-key-limit").value = d.DeviceLimit || 1;
    document.getElementById("mod-key-date").value = d.ExpiryDate || "";
    document.getElementById("mod-key-name").value = d.Username || "";
    document.getElementById("mod-key-payment").value = d.Payment || "";
  } else {
    document.getElementById("mod-key-limit").value = 1;
    document.getElementById("mod-key-date").value = "";
    document.getElementById("mod-key-name").value = "";
    document.getElementById("mod-key-payment").value = "";
    resetDayButtons();
  }

  // Role-based action visibility
  if (currentUser.role === "admin") {
    document.getElementById("admin-key-actions").style.display = "block";
    document.getElementById("operator-key-actions").style.display = "none";
  } else {
    document.getElementById("admin-key-actions").style.display = "none";
    document.getElementById("operator-key-actions").style.display = "block";
  }

  openModal("key-modal");
}

function randomKeyString() {
  return "AO-VIP-" + Math.floor(10000 + Math.random() * 90000);
}

function randomKey() {
  document.getElementById("mod-key-id").value = randomKeyString();
}

function setDays(days, btn) {
  selectedDays = days;
  selectedAmount = PRICE_TABLE[days] || 0;

  document.querySelectorAll(".day-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");

  // Expiry preview
  const exp = new Date();
  exp.setDate(exp.getDate() + days);
  const expStr = exp.toISOString().split("T")[0];

  document.getElementById("expiry-preview-text").textContent = `Expires on ${expStr}`;
  document.getElementById("mod-key-amount").value = `₹${selectedAmount}`;
  document.getElementById("mod-key-date").value = expStr;

  // Fee summaries
  const feeAmount = `₹${selectedAmount}`;
  document.getElementById("admin-fee-amount").textContent = feeAmount;
  document.getElementById("admin-fee-summary").style.display = "block";
  document.getElementById("op-fee-amount").textContent = feeAmount;
  document.getElementById("op-fee-package").textContent = `${days} Days`;
  document.getElementById("op-fee-devices").textContent = document.getElementById("mod-key-limit").value;
  document.getElementById("op-fee-summary").style.display = "block";

  // Enable payment button
  const payBtn = currentUser.role === "admin"
    ? document.getElementById("payment-btn-admin")
    : document.getElementById("payment-btn-op");
  if (payBtn) payBtn.disabled = false;
}

function resetDayButtons() {
  selectedDays = 0;
  selectedAmount = 0;
  document.querySelectorAll(".day-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("expiry-preview-text").textContent = "Select a package";
  document.getElementById("mod-key-amount").value = "";
  document.getElementById("mod-key-date").value = "";
  document.getElementById("admin-fee-summary").style.display = "none";
  document.getElementById("op-fee-summary").style.display = "none";
  const payBtn = currentUser.role === "admin"
    ? document.getElementById("payment-btn-admin")
    : document.getElementById("payment-btn-op");
  if (payBtn) payBtn.disabled = true;
}

function toggleAdvancedMode() {
  advancedMode = !advancedMode;
  document.getElementById("advanced-section").style.display = advancedMode ? "block" : "none";
  document.getElementById("adv-chevron").style.transform = advancedMode ? "rotate(180deg)" : "rotate(0)";
}

// ===== ADMIN: Direct key generation (FREE) =====
async function saveKeyDirectly() {
  const keyId = document.getElementById("mod-key-id").value.trim();
  if (!keyId) return showIsland("Key ID required", "exclamation-triangle", "var(--warning)");

  const expiry = document.getElementById("mod-key-date").value;
  if (!expiry) return showIsland("Please select package", "exclamation-triangle", "var(--warning)");

  const data = {
    Banned: false,
    DeviceLimit: parseInt(document.getElementById("mod-key-limit").value) || 1,
    Devices: keysCache[keyId]?.Devices || { dummy: 0 },
    ExpiryDate: expiry,
    Username: document.getElementById("mod-key-name").value.trim() || "Anurag Online Official",
    Payment: document.getElementById("mod-key-payment").value.trim() || `₹${selectedAmount}`,
    CreatedBy: "admin",
    CreatedAt: new Date().toISOString()
  };

  const ok = await fbSet(`Keys/${keyId}`, data);
  if (ok) {
    keysCache[keyId] = data;
    showIsland("Key generated (Admin)", "crown", "var(--accent)");
    closeModals();
    renderKeys();
  } else {
    showIsland("Failed to save key", "times-circle", "var(--danger)");
  }
}

// ===== OPERATOR: Payment flow =====
function openPaymentModal() {
  if (!selectedDays || !selectedAmount) {
    return showIsland("Please select a package first", "exclamation-triangle", "var(--warning)");
  }
  initiateCashfreePayment();
}

async function initiateCashfreePayment() {
  const keyId = document.getElementById("mod-key-id").value.trim();
  const orderAmount = selectedAmount;
  const orderId = `AO_${Date.now()}`;

  // Save pending key in Firebase
  const pendingData = {
    Banned: false,
    Pending: true,
    DeviceLimit: parseInt(document.getElementById("mod-key-limit").value) || 1,
    Devices: { dummy: 0 },
    ExpiryDate: document.getElementById("mod-key-date").value,
    Username: document.getElementById("mod-key-name").value.trim() || "Anurag Online Official",
    Payment: `₹${orderAmount}`,
    OrderId: orderId,
    Operator: currentUser.username,
    CreatedAt: new Date().toISOString()
  };
  await fbSet(`Keys/${keyId}`, pendingData);

  try {
    // Cashfree v3
    const cashfree = Cashfree({ mode: "production" }); // use "sandbox" for testing
    const checkoutOptions = {
      paymentSessionId: "", // Ideally fetch from backend
      redirectTarget: "_modal"
    };

    // NOTE: Production me paymentSessionId backend se aana chahiye.
    // Fallback: show instruction modal
    openModal("payment-instruction-modal");

    // Simulate success after 2s (replace with real Cashfree callback)
    setTimeout(async () => {
      await fbSet(`Keys/${keyId}/Pending`, false);
      keysCache[keyId] = { ...pendingData, Pending: false };
      renderKeys();
    }, 2000);

  } catch (e) {
    console.error(e);
    showIsland("Payment init failed", "times-circle", "var(--danger)");
  }
}

function closePaymentModal() {
  closeModals();
  selectedDays = 0;
  selectedAmount = 0;
  resetDayButtons();
  renderKeys();
}

// ============================================================
// KEY ACTIONS
// ============================================================
async function toggleBanKey(keyId) {
  const data = keysCache[keyId];
  if (!data) return;
  data.Banned = !data.Banned;
  const ok = await fbPatch(`Keys/${keyId}`, { Banned: data.Banned });
  if (ok) {
    showIsland(data.Banned ? "Key banned" : "Key unbanned", "ban", data.Banned ? "var(--danger)" : "var(--success)");
    renderKeys();
  }
}

async function deleteKey(keyId) {
  if (!confirm(`Delete key ${keyId}?`)) return;
  const ok = await fbDelete(`Keys/${keyId}`);
  if (ok) {
    delete keysCache[keyId];
    showIsland("Key deleted", "trash", "var(--danger)");
    renderKeys();
  }
}

function openEditHwid(keyId, hwid) {
  document.getElementById("mod-edit-hwid").value = hwid;
  document.getElementById("mod-edit-old-hwid").value = hwid;
  document.getElementById("mod-edit-key-id").value = keyId;
  openModal("edit-hwid-modal");
}

async function saveEditedHWID() {
  const keyId = document.getElementById("mod-edit-key-id").value;
  const oldHwid = document.getElementById("mod-edit-old-hwid").value;
  const newHwid = document.getElementById("mod-edit-hwid").value.trim();
  if (!newHwid) return showIsland("HWID required", "exclamation-triangle", "var(--warning)");

  const devices = keysCache[keyId]?.Devices || {};
  const val = devices[oldHwid];
  delete devices[oldHwid];
  devices[newHwid] = val;

  const ok = await fbSet(`Keys/${keyId}/Devices`, devices);
  if (ok) {
    keysCache[keyId].Devices = devices;
    showIsland("Device ID updated", "check-circle", "var(--success)");
    closeModals();
    renderKeys();
  }
}

async function removeHwid(keyId, hwid) {
  if (!confirm(`Remove device ${hwid}?`)) return;
  const devices = keysCache[keyId]?.Devices || {};
  delete devices[hwid];
  const ok = await fbSet(`Keys/${keyId}/Devices`, devices);
  if (ok) {
    keysCache[keyId].Devices = devices;
    showIsland("Device removed", "trash", "var(--success)");
    renderKeys();
  }
}

// ============================================================
// SYSTEM CONFIG
// ============================================================
function loadSystemConfig() {
  const s = appStatus || {};
  document.getElementById("as-title").value = s.Dialog_Title || "";
  document.getElementById("as-subtitle").value = s.Dialog_Subtitle || "";
  document.getElementById("as-main-banner").value = s.Main_Banner || "";
  document.getElementById("as-admin-link").value = s.Admin_URL || "";
  document.getElementById("as-em-title").value = s.Emergency_Title || "";
  document.getElementById("as-em-msg").value = s.Emergency_Message || "";
  document.getElementById("as-em-banner").value = s.Emergency_Banner || "";

  toggleWrapperState("tog-em-mode", !!s.Emergency_Mode);
  toggleWrapperState("tog-em-cancel", !!s.Emergency_Cancel);
  toggleWrapperState("tog-trial", s.Trials_Enabled !== false);
}

function toggleSwitch(el) {
  el.classList.toggle("active");
}

function toggleWrapperState(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("active", state);
}

async function saveAppStatus() {
  const data = {
    Dialog_Title: document.getElementById("as-title").value.trim(),
    Dialog_Subtitle: document.getElementById("as-subtitle").value.trim(),
    Main_Banner: document.getElementById("as-main-banner").value.trim(),
    Admin_URL: document.getElementById("as-admin-link").value.trim(),
    Emergency_Title: document.getElementById("as-em-title").value.trim(),
    Emergency_Message: document.getElementById("as-em-msg").value.trim(),
    Emergency_Banner: document.getElementById("as-em-banner").value.trim(),
    Emergency_Mode: document.getElementById("tog-em-mode").classList.contains("active"),
    Emergency_Cancel: document.getElementById("tog-em-cancel").classList.contains("active"),
    Trials_Enabled: document.getElementById("tog-trial").classList.contains("active")
  };

  const ok = await fbPatch("App_Status", data);
  if (ok) {
    appStatus = { ...appStatus, ...data };
    showIsland("Config saved", "save", "var(--success)");
  } else {
    showIsland("Failed to save", "times-circle", "var(--danger)");
  }
}

// ============================================================
// CHANGE PASSWORD
// ============================================================
function openChangePasswordModal() {
  document.getElementById("mod-current-pass").value = "";
  document.getElementById("mod-new-pass").value = "";
  document.getElementById("mod-confirm-pass").value = "";
  openModal("change-password-modal");
}

async function saveNewPassword() {
  const cur = document.getElementById("mod-current-pass").value;
  const nw = document.getElementById("mod-new-pass").value;
  const cf = document.getElementById("mod-confirm-pass").value;

  if (currentUser.role === "admin") {
    if (cur !== ADMIN_PASS) return showIsland("Current password wrong", "times-circle", "var(--danger)");
  } else {
    const op = operatorsCache[currentUser.id];
    if (!op || op.password !== cur) return showIsland("Current password wrong", "times-circle", "var(--danger)");
  }

  if (!nw || nw.length < 4) return showIsland("Password too short", "exclamation-triangle", "var(--warning)");
  if (nw !== cf) return showIsland("Passwords do not match", "times-circle", "var(--danger)");

  if (currentUser.role === "admin") {
    // In real app: save to Firebase admin node
    showIsland("Admin password changed (session)", "check-circle", "var(--success)");
  } else {
    const ok = await fbPatch(`Operators/${currentUser.id}`, { password: nw });
    if (ok) {
      operatorsCache[currentUser.id].password = nw;
      showIsland("Password updated", "check-circle", "var(--success)");
    }
  }
  closeModals();
}

// ============================================================
// NAVIGATION
// ============================================================
function nav(view, el, title, subtitle) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(`view-${view}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("page-subtitle-text").textContent = subtitle;
}

// ============================================================
// POLICY PAGES
// ============================================================
function openPolicy(type) {
  document.querySelectorAll(".policy-page").forEach(p => p.classList.remove("active"));
  document.getElementById(`policy-${type}`).classList.add("active");
  document.getElementById("main-app").style.display = "none";
  document.getElementById("login-screen").style.display = "none";
}

function closePolicy() {
  document.querySelectorAll(".policy-page").forEach(p => p.classList.remove("active"));
  if (currentUser) {
    document.getElementById("main-app").style.display = "flex";
  } else {
    document.getElementById("login-screen").style.display = "flex";
  }
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
}

function closeChangelog() {
  closeModals();
}

// Close on overlay click
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModals();
  });
});

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function escapeAttr(str) {
  return String(str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showIsland("Copied!", "copy", "var(--success)");
  }).catch(() => {
    showIsland("Copy failed", "times-circle", "var(--danger)");
  });
}

// ============================================================
// INIT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  // Enter key login
  document.getElementById("login-password").addEventListener("keydown", e => {
    if (e.key === "Enter") doLogin();
  });
});
