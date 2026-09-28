import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── FIREBASE LOAD ───
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log('🔥 Firebase loaded from ENV VAR');
} else {
  const filePath = join(__dirname, 'serviceAccount.json');
  if (!existsSync(filePath)) {
    console.error('❌ serviceAccount.json not found');
    process.exit(1);
  }
  serviceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
  console.log('🔥 Firebase loaded from FILE');
}

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL?.split(',') || '*' }));
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

// ─── CASHFREE ───
const CF_BASE = process.env.CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';
const CF_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET = process.env.CASHFREE_SECRET;

// ─── PRICE ───
const PRICE_PER_DAY = parseInt(process.env.KEY_PRICE_PER_DAY || '200');
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

// ─── TELEGRAM HELPERS ───
async function sendTelegram(message, chatId = null) {
  try {
    if (!TG_TOKEN) return;
    const target = chatId || TG_CHAT;
    if (!target) return;
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target,
        text: message,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

async function replyTelegram(chatId, message) {
  await sendTelegram(message, chatId);
}

// ─── AUTH ───
async function authMiddleware(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function isAdmin(uid) {
  const snap = await db.ref(`DPMods_Security/Admins/${uid}`).once('value');
  return snap.exists() && snap.val() === true;
}

// ─── HEALTH ───
app.get('/', (_, res) => res.json({
  ok: true,
  service: 'anurag-backend',
  time: Date.now(),
  pricePerDay: PRICE_PER_DAY,
  project: serviceAccount.project_id,
  telegram: !!TG_TOKEN
}));

app.get('/api/config', (_, res) => {
  res.json({ pricePerDay: PRICE_PER_DAY });
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM BOT WEBHOOK & COMMANDS
// ═══════════════════════════════════════════════════════════

// Webhook handler
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.json({ ok: true });
    
    const chatId = update.message.chat.id;
    const text = (update.message.text || '').trim();
    const from = update.message.from.username || update.message.from.first_name || 'unknown';

    console.log(`📨 Telegram command from ${from} (${chatId}): ${text}`);

    // Security: only owner chat can send commands
    if (String(chatId) !== String(TG_CHAT)) {
      replyTelegram(chatId, '⛔ <b>Unauthorized</b>\nYe bot sirf owner ke liye hai.');
      return res.json({ ok: true });
    }

    const [cmd, ...args] = text.split(/\s+/);
    const command = cmd.toLowerCase();

    // /start or /help
    if (command === '/start' || command === '/help') {
      replyTelegram(chatId,
        `🤖 <b>Anurag Online Bot</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<b>📊 INFO COMMANDS</b>\n` +
        `/stats — Overall statistics\n` +
        `/keys — All keys list\n` +
        `/keys_active — Active keys only\n` +
        `/keys_expired — Expired keys only\n` +
        `/keys_paused — Paused keys only\n` +
        `/operators — All operators\n\n` +
        `<b>🔍 SEARCH</b>\n` +
        `/find_name <username> — Find key by username\n\n` +
        `<b>⚙️ KEY ACTIONS</b>\n` +
        `/ban_key AV-IND-1 — Ban a key\n` +
        `/unban_key AV-IND-1 — Unban a key\n` +
        `/pause_key AV-IND-1 — Pause a key\n` +
        `/resume_key AV-IND-1 — Resume a key\n` +
        `/del_key AV-IND-1 — Delete a key\n\n` +
        `<b>👤 OPERATOR ACTIONS</b>\n` +
        `/ban_op op1 — Ban operator\n` +
        `/unban_op op1 — Unban operator\n` +
        `/del_op op1 — Delete operator\n\n` +
        `<b>💰 PRICING</b>\n` +
        `/price — Show current price per day`
      );
      return res.json({ ok: true });
    }

    // /price
    if (command === '/price') {
      replyTelegram(chatId, `💰 <b>Current Price</b>\n\n₹${PRICE_PER_DAY} per day\n\nExample: 30 days = ₹${PRICE_PER_DAY * 30}`);
      return res.json({ ok: true });
    }

    // /stats
    if (command === '/stats') {
      const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
      const opsSnap = await db.ref('DPMods_Security/Operators').once('value');
      const keys = keysSnap.val() || {};
      const ops = opsSnap.val() || {};

      let active = 0, expired = 0, banned = 0, paused = 0, totalRevenue = 0;
      const now = new Date();
      Object.values(keys).forEach(k => {
        if (k.Banned) banned++;
        else if (k.Paused) paused++;
        else if (k.ExpiryDate) {
          const e = new Date(k.ExpiryDate);
          e.setHours(23,59,59,999);
          if (e < now) expired++;
          else active++;
        } else active++;
        totalRevenue += parseInt(k.PaymentAmount || 0);
      });

      replyTelegram(chatId,
        `📊 <b>STATISTICS</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔑 Total Keys: <b>${Object.keys(keys).length}</b>\n` +
        `✅ Active: ${active}\n` +
        `⏰ Expired: ${expired}\n` +
        `🚫 Banned: ${banned}\n` +
        `⏸ Paused: ${paused}\n` +
        `👤 Operators: <b>${Object.keys(ops).length}</b>\n` +
        `💰 Total Revenue: ₹${totalRevenue.toLocaleString('en-IN')}`
      );
      return res.json({ ok: true });
    }

    // /keys
    if (command === '/keys') {
      const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
      const keys = keysSnap.val() || {};
      const list = Object.entries(keys).slice(0, 30);
      
      if (!list.length) {
        replyTelegram(chatId, '📭 No keys found.');
        return res.json({ ok: true });
      }

      let msg = `🔑 <b>ALL KEYS (${Object.keys(keys).length})</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
      list.forEach(([kid, k]) => {
        const status = k.Banned ? '🚫' : (k.Paused ? '⏸' : '✅');
        msg += `${status} <code>${kid}</code> — ${k.Username || 'N/A'}\n`;
      });
      if (Object.keys(keys).length > 30) msg += `\n...and ${Object.keys(keys).length - 30} more`;
      replyTelegram(chatId, msg);
      return res.json({ ok: true });
    }

    // /keys_active
    if (command === '/keys_active') {
      const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
      const keys = keysSnap.val() || {};
      const now = new Date();
      const active = Object.entries(keys).filter(([_, k]) => {
        if (k.Banned || k.Paused) return false;
        if (!k.ExpiryDate) return true;
        const e = new Date(k.ExpiryDate); e.setHours(23,59,59,999);
        return e >= now;
      });

      let msg = `✅ <b>ACTIVE KEYS (${active.length})</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
      active.slice(0, 30).forEach(([kid, k]) => {
        msg += `🔑 <code>${kid}</code> — ${k.Username || 'N/A'}\n`;
      });
      if (!active.length) msg = '📭 No active keys.';
      replyTelegram(chatId, msg);
      return res.json({ ok: true });
    }

    // /keys_expired
    if (command === '/keys_expired') {
      const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
      const keys = keysSnap.val() || {};
      const now = new Date();
      const expired = Object.entries(keys).filter(([_, k]) => {
        if (k.Banned || k.Paused) return false;
        if (!k.ExpiryDate) return false;
        const e = new Date(k.ExpiryDate); e.setHours(23,59,59,999);
        return e < now;
      });

      let msg = `⏰ <b>EXPIRED KEYS (${expired.length})</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
      expired.slice(0, 30).forEach(([kid, k]) => {
        msg += `🔑 <code>${kid}</code> — ${k.Username || 'N/A'} (${k.ExpiryDate})\n`;
      });
      if (!expired.length) msg = '📭 No expired keys.';
      replyTelegram(chatId, msg);
      return res.json({ ok: true });
    }

    // /keys_paused
    if (command === '/keys_paused') {
      const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
      const keys = keysSnap.val() || {};
      const paused = Object.entries(keys).filter(([_, k]) => k.Paused);

      let msg = `⏸ <b>PAUSED KEYS (${paused.length})</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
      paused.slice(0, 30).forEach(([kid, k]) => {
        msg += `🔑 <code>${kid}</code> — ${k.Username || 'N/A'}\n`;
      });
      if (!paused.length) msg = '📭 No paused keys.';
      replyTelegram(chatId, msg);
      return res.json({ ok: true });
    }

    // /operators
    if (command === '/operators') {
      const opsSnap = await db.ref('DPMods_Security/Operators').once('value');
      const ops = opsSnap.val() || {};
      const list = Object.entries(ops);

      if (!list.length) {
        replyTelegram(chatId, '📭 No operators.');
        return res.json({ ok: true });
      }

      let msg = `👥 <b>OPERATORS (${list.length})</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
      list.forEach(([opId, o]) => {
        const status = o.Banned ? '🚫' : '✅';
        msg += `${status} <code>${opId}</code> — ${o.Name || 'N/A'}\n`;
      });
      replyTelegram(chatId, msg);
      return res.json({ ok: true });
    }

    // /find_name
    if (command === '/find_name') {
      const name = args.join(' ').toLowerCase();
      if (!name) {
        replyTelegram(chatId, '❌ Usage: /find_name TestUser');
        return res.json({ ok: true });
      }

      const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
      const keys = keysSnap.val() || {};
      const found = Object.entries(keys).filter(([_, k]) => (k.Username || '').toLowerCase().includes(name));

      let msg = `🔍 <b>Found ${found.length} key(s)</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
      found.slice(0, 20).forEach(([kid, k]) => {
        msg += `🔑 <code>${kid}</code> — ${k.Username}\nExpiry: ${k.ExpiryDate}\n\n`;
      });
      if (!found.length) msg = `📭 No keys found for "${name}"`;
      replyTelegram(chatId, msg);
      return res.json({ ok: true });
    }

    // /ban_key
    if (command === '/ban_key') {
      const keyId = args[0];
      if (!keyId) { replyTelegram(chatId, '❌ Usage: /ban_key AV-IND-1'); return res.json({ ok: true }); }
      const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
      const cur = (await ref.once('value')).val();
      if (!cur) { replyTelegram(chatId, `❌ Key not found: ${keyId}`); return res.json({ ok: true }); }
      await ref.update({ Banned: true });
      replyTelegram(chatId, `🚫 <b>Key Banned</b>\n<code>${keyId}</code>`);
      return res.json({ ok: true });
    }

    // /unban_key
    if (command === '/unban_key') {
      const keyId = args[0];
      if (!keyId) { replyTelegram(chatId, '❌ Usage: /unban_key AV-IND-1'); return res.json({ ok: true }); }
      const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
      const cur = (await ref.once('value')).val();
      if (!cur) { replyTelegram(chatId, `❌ Key not found: ${keyId}`); return res.json({ ok: true }); }
      await ref.update({ Banned: false });
      replyTelegram(chatId, `✅ <b>Key Unbanned</b>\n<code>${keyId}</code>`);
      return res.json({ ok: true });
    }

    // /pause_key
    if (command === '/pause_key') {
      const keyId = args[0];
      if (!keyId) { replyTelegram(chatId, '❌ Usage: /pause_key AV-IND-1'); return res.json({ ok: true }); }
      const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
      const cur = (await ref.once('value')).val();
      if (!cur) { replyTelegram(chatId, `❌ Key not found: ${keyId}`); return res.json({ ok: true }); }
      await ref.update({ Paused: true });
      replyTelegram(chatId, `⏸ <b>Key Paused</b>\n<code>${keyId}</code>`);
      return res.json({ ok: true });
    }

    // /resume_key
    if (command === '/resume_key') {
      const keyId = args[0];
      if (!keyId) { replyTelegram(chatId, '❌ Usage: /resume_key AV-IND-1'); return res.json({ ok: true }); }
      const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
      const cur = (await ref.once('value')).val();
      if (!cur) { replyTelegram(chatId, `❌ Key not found: ${keyId}`); return res.json({ ok: true }); }
      await ref.update({ Paused: false });
      replyTelegram(chatId, `▶️ <b>Key Resumed</b>\n<code>${keyId}</code>`);
      return res.json({ ok: true });
    }

    // /del_key
    if (command === '/del_key') {
      const keyId = args[0];
      if (!keyId) { replyTelegram(chatId, '❌ Usage: /del_key AV-IND-1'); return res.json({ ok: true }); }
      await db.ref(`DPMods_Security/Keys/${keyId}`).remove();
      replyTelegram(chatId, `🗑️ <b>Key Deleted</b>\n<code>${keyId}</code>`);
      return res.json({ ok: true });
    }

    // /ban_op
    if (command === '/ban_op') {
      const opId = args[0];
      if (!opId) { replyTelegram(chatId, '❌ Usage: /ban_op op1'); return res.json({ ok: true }); }
      const ref = db.ref(`DPMods_Security/Operators/${opId}`);
      const cur = (await ref.once('value')).val();
      if (!cur) { replyTelegram(chatId, `❌ Operator not found: ${opId}`); return res.json({ ok: true }); }
      await ref.update({ Banned: true });
      if (cur.Uid) { try { await admin.auth().updateUser(cur.Uid, { disabled: true }); } catch {} }
      replyTelegram(chatId, `🚫 <b>Operator Banned</b>\n<code>${opId}</code>`);
      return res.json({ ok: true });
    }

    // /unban_op
    if (command === '/unban_op') {
      const opId = args[0];
      if (!opId) { replyTelegram(chatId, '❌ Usage: /unban_op op1'); return res.json({ ok: true }); }
      const ref = db.ref(`DPMods_Security/Operators/${opId}`);
      const cur = (await ref.once('value')).val();
      if (!cur) { replyTelegram(chatId, `❌ Operator not found: ${opId}`); return res.json({ ok: true }); }
      await ref.update({ Banned: false });
      if (cur.Uid) { try { await admin.auth().updateUser(cur.Uid, { disabled: false }); } catch {} }
      replyTelegram(chatId, `✅ <b>Operator Unbanned</b>\n<code>${opId}</code>`);
      return res.json({ ok: true });
    }

    // /del_op
    if (command === '/del_op') {
      const opId = args[0];
      if (!opId) { replyTelegram(chatId, '❌ Usage: /del_op op1'); return res.json({ ok: true }); }
      const ref = db.ref(`DPMods_Security/Operators/${opId}`);
      const cur = (await ref.once('value')).val();
      if (!cur) { replyTelegram(chatId, `❌ Operator not found: ${opId}`); return res.json({ ok: true }); }
      if (cur.Uid) { try { await admin.auth().deleteUser(cur.Uid); } catch {} }
      await ref.remove();
      replyTelegram(chatId, `🗑️ <b>Operator Deleted</b>\n<code>${opId}</code>`);
      return res.json({ ok: true });
    }

    // Unknown
    replyTelegram(chatId, `❓ Unknown command: ${command}\n\nUse /help for commands.`);
    res.json({ ok: true });
  } catch (e) {
    console.error('Telegram webhook error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── SETUP ADMIN ───
app.post('/api/setup-admin', async (req, res) => {
  try {
    const { email, pass, setupKey } = req.body;
    if (setupKey !== process.env.SETUP_KEY) return res.status(403).json({ error: 'Wrong setup key' });
    if (!email || !pass) return res.status(400).json({ error: 'Email and password required' });

    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch {
      user = await admin.auth().createUser({ email, password: pass });
    }

    await db.ref(`DPMods_Security/Admins/${user.uid}`).set(true);
    await db.ref(`DPMods_Security/App_Status`).update({
      Dialog_Title: 'SYSTEM ACCESS',
      Dialog_Subtitle: 'Secure authentication required',
      KeyPrice: PRICE_PER_DAY,
      Maintenance: false,
      Update_Required: false,
      Admin_URL: '',
      Update_Link: '',
      Banned_Devices: ''
    });
    res.json({ ok: true, uid: user.uid, email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CREATE ORDER ───
app.post('/api/payment/create-order', authMiddleware, async (req, res) => {
  try {
    const { keyId, username, limit, expiry, days } = req.body;
    if (!keyId || !username || !expiry || !days) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const daysNum = parseInt(days);
    if (daysNum < 1 || daysNum > 3650) {
      return res.status(400).json({ error: 'Days must be 1-3650' });
    }

    const price = PRICE_PER_DAY * daysNum;
    const orderId = `ORDER_${Date.now()}_${req.user.uid}`;
    const body = {
      order_amount: price,
      order_currency: 'INR',
      order_id: orderId,
      customer_details: { customer_id: req.user.uid, customer_phone: '9999999999' },
      order_meta: { return_url: `${process.env.FRONTEND_URL}/?order_id={order_id}` },
      order_note: `Key ${keyId} for ${username} (${daysNum} days)`
    };

    const r = await fetch(`${CF_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': CF_ID,
        'x-client-secret': CF_SECRET,
        'x-api-version': '2023-08-01'
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return res.status(400).json({ error: data.message || 'Order failed' });

    await db.ref(`DPMods_Security/PendingOrders/${orderId}`).set({
      keyId, username, limit, expiry, days: daysNum,
      uid: req.user.uid, amount: price,
      pricePerDay: PRICE_PER_DAY,
      status: 'PENDING', createdAt: Date.now()
    });

    res.json({ orderId, paymentSessionId: data.payment_session_id, amount: price, days: daysNum, pricePerDay: PRICE_PER_DAY });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── VERIFY PAYMENT ───
app.post('/api/payment/verify', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    const r = await fetch(`${CF_BASE}/orders/${orderId}`, {
      headers: {
        'x-client-id': CF_ID,
        'x-client-secret': CF_SECRET,
        'x-api-version': '2023-08-01'
      }
    });
    const data = await r.json();
    if (data.order_status !== 'PAID') return res.status(400).json({ error: `Status: ${data.order_status}` });

    const pendingRef = db.ref(`DPMods_Security/PendingOrders/${orderId}`);
    const pending = (await pendingRef.once('value')).val();
    if (!pending) return res.status(404).json({ error: 'Order not found' });
    if (pending.uid !== req.user.uid) return res.status(403).json({ error: 'Not your order' });
    if (pending.status === 'COMPLETED') return res.json({ keyId: pending.keyId, alreadyIssued: true });

    const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
    let finalKey = pending.keyId;
    if (keysSnap.exists() && keysSnap.val()[finalKey]) {
      const next = ((await db.ref('DPMods_Security/NextKeyNumber').once('value')).val()) || 1;
      finalKey = `AV-IND-${next}`;
    }

    const now = new Date();
    await db.ref(`DPMods_Security/Keys/${finalKey}`).set({
      Devices: { dummy: 0 }, Banned: false, Paused: false,
      Username: pending.username, DeviceLimit: pending.limit || 1,
      ExpiryDate: pending.expiry, Days: pending.days,
      CreatedBy: pending.uid, CreatedAt: now.toISOString(),
      PaymentTxnId: data.cf_order_id || orderId,
      PaymentStatus: 'PAID', PaymentAmount: pending.amount,
      PricePerDay: pending.pricePerDay
    });

    const m = finalKey.match(/^AV-IND-(\d+)$/);
    if (m) {
      const n = parseInt(m[1]);
      const cur = ((await db.ref('DPMods_Security/NextKeyNumber').once('value')).val()) || 1;
      if (n >= cur) await db.ref('DPMods_Security/NextKeyNumber').set(n + 1);
    }

    await pendingRef.update({ status: 'COMPLETED', completedAt: Date.now() });

    sendTelegram(
      `🎉 <b>NEW KEY GENERATED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔑 Key: <code>${finalKey}</code>\n` +
      `👤 Username: ${pending.username}\n` +
      `📅 Days: ${pending.days}\n` +
      `💰 Amount: ₹${pending.amount}\n` +
      `🧾 Txn: <code>${data.cf_order_id || orderId}</code>\n` +
      `⏰ ${now.toLocaleString('en-IN')}`
    );

    res.json({ keyId: finalKey, txnId: data.cf_order_id || orderId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── OPERATOR: PAUSE OWN KEY ───
app.post('/api/operator/pause-key', authMiddleware, async (req, res) => {
  try {
    const { keyId, paused } = req.body;
    const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
    const key = (await ref.once('value')).val();
    if (!key) return res.status(404).json({ error: 'Key not found' });
    if (key.CreatedBy !== req.user.uid) return res.status(403).json({ error: 'Not your key' });

    await ref.update({ Paused: paused === true });
    sendTelegram(`${paused ? '⏸' : '▶️'} <b>Key ${paused ? 'Paused' : 'Resumed'}</b>\n🔑 <code>${keyId}</code>`);
    res.json({ ok: true, paused });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: PAUSE ANY KEY ───
app.post('/api/admin/pause-key', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { keyId, paused } = req.body;
    await db.ref(`DPMods_Security/Keys/${keyId}`).update({ Paused: paused === true });
    sendTelegram(`${paused ? '⏸' : '▶️'} <b>Key ${paused ? 'Paused' : 'Resumed'} (by Admin)</b>\n🔑 <code>${keyId}</code>`);
    res.json({ ok: true, paused });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── OPERATOR: UPDATE OWN KEY ───
app.post('/api/operator/update-key', authMiddleware, async (req, res) => {
  try {
    const { keyId, username } = req.body;
    const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
    const key = (await ref.once('value')).val();
    if (!key) return res.status(404).json({ error: 'Key not found' });
    if (key.CreatedBy !== req.user.uid) return res.status(403).json({ error: 'Not your key' });

    await ref.update({ Username: username });
    sendTelegram(`✏️ <b>Key Updated</b>\n🔑 <code>${keyId}</code>\n👤 ${username}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── OPERATOR: DELETE OWN KEY ───
app.post('/api/operator/delete-key', authMiddleware, async (req, res) => {
  try {
    const { keyId } = req.body;
    const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
    const key = (await ref.once('value')).val();
    if (!key) return res.status(404).json({ error: 'Key not found' });
    if (key.CreatedBy !== req.user.uid) return res.status(403).json({ error: 'Not your key' });

    await ref.remove();
    sendTelegram(`🗑️ <b>Operator Deleted Own Key</b>\n🔑 <code>${keyId}</code>`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: CREATE OPERATOR ───
app.post('/api/admin/create-operator', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { opId, name, pass, contact } = req.body;
    if (!opId || !pass) return res.status(400).json({ error: 'opId + pass required' });

    const email = `${opId}@anurag.local`;
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch {
      userRecord = await admin.auth().createUser({ email, password: pass, displayName: name });
    }

    await db.ref(`DPMods_Security/Operators/${opId}`).set({
      Name: name || opId, Contact: contact || '',
      Banned: false, Uid: userRecord.uid,
      CreatedBy: req.user.uid, CreatedAt: new Date().toISOString()
    });

    sendTelegram(`👤 <b>New Operator Created</b>\n🆔 <code>${opId}</code>\n👤 ${name}\n📞 ${contact || 'N/A'}`);
    res.json({ ok: true, uid: userRecord.uid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: DELETE OPERATOR ───
app.post('/api/admin/delete-operator', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { opId } = req.body;
    const snap = await db.ref(`DPMods_Security/Operators/${opId}`).once('value');
    const op = snap.val();
    if (op?.Uid) { try { await admin.auth().deleteUser(op.Uid); } catch {} }
    await db.ref(`DPMods_Security/Operators/${opId}`).remove();
    sendTelegram(`❌ <b>Operator Deleted</b>\n🆔 <code>${opId}</code>`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: BAN/UNBAN OPERATOR ───
app.post('/api/admin/toggle-operator-ban', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { opId } = req.body;
    const ref = db.ref(`DPMods_Security/Operators/${opId}`);
    const cur = (await ref.once('value')).val();
    if (!cur) return res.status(404).json({ error: 'Operator not found' });
    const banned = !cur.Banned;
    await ref.update({ Banned: banned });
    if (cur.Uid) { try { await admin.auth().updateUser(cur.Uid, { disabled: banned }); } catch {} }
    sendTelegram(`${banned ? '🚫' : '✅'} <b>Operator ${banned ? 'Banned' : 'Unbanned'}</b>\n🆔 <code>${opId}</code>`);
    res.json({ ok: true, banned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: DELETE KEY ───
app.post('/api/admin/delete-key', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { keyId } = req.body;
    await db.ref(`DPMods_Security/Keys/${keyId}`).remove();
    sendTelegram(`🗑️ <b>Key Deleted (by Admin)</b>\n🔑 <code>${keyId}</code>`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: BAN/UNBAN KEY ───
app.post('/api/admin/toggle-key-ban', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { keyId } = req.body;
    const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
    const cur = (await ref.once('value')).val();
    if (!cur) return res.status(404).json({ error: 'Key not found' });
    const banned = !cur.Banned;
    await ref.update({ Banned: banned });
    sendTelegram(`${banned ? '🚫' : '✅'} <b>Key ${banned ? 'Banned' : 'Unbanned'}</b>\n🔑 <code>${keyId}</code>`);
    res.json({ ok: true, banned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: CONFIG NOTIFY ───
app.post('/api/admin/config-updated', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { title, subtitle, price } = req.body;
    sendTelegram(`⚙️ <b>Config Updated</b>\n📝 ${title}\n💬 ${subtitle}\n💰 ₹${price}/day`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── TELEGRAM: SET WEBHOOK ───
app.get('/api/telegram/set-webhook', async (req, res) => {
  try {
    const webhookUrl = `https://${req.get('host')}/api/telegram/webhook`;
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook?url=${webhookUrl}`);
    const data = await r.json();
    res.json({ ok: true, webhookUrl, telegram: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── START ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Backend running on :${PORT}`);
  console.log(`📛 Firebase project: ${serviceAccount.project_id}`);
  console.log(`💰 Price/day: ₹${PRICE_PER_DAY}`);
  console.log(`📨 Telegram: ${TG_TOKEN ? 'ON' : 'OFF'}`);
  console.log('═══════════════════════════════════════════');
  console.log(`🤖 Telegram webhook set: /api/telegram/set-webhook`);
});