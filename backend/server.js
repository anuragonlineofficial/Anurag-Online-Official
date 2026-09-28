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

// ─── TELEGRAM ───
async function sendTelegram(message) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.log('📨 Telegram not configured, skipping');
      return;
    }
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    console.log('📨 Telegram sent');
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
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
  project: serviceAccount.project_id
}));

// ─── CONFIG INFO ───
app.get('/api/config', (_, res) => {
  res.json({ pricePerDay: PRICE_PER_DAY });
});

// ─── SETUP ADMIN ───
app.post('/api/setup-admin', async (req, res) => {
  try {
    const { email, pass, setupKey } = req.body;
    if (setupKey !== process.env.SETUP_KEY) {
      return res.status(403).json({ error: 'Wrong setup key' });
    }
    if (!email || !pass) {
      return res.status(400).json({ error: 'Email and password required' });
    }

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
      return res.status(400).json({ error: 'Days must be between 1 and 3650' });
    }

    const price = PRICE_PER_DAY * daysNum;

    const orderId = `ORDER_${Date.now()}_${req.user.uid}`;
    const body = {
      order_amount: price,
      order_currency: 'INR',
      order_id: orderId,
      customer_details: {
        customer_id: req.user.uid,
        customer_phone: '9999999999'
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/?order_id={order_id}`
      },
      order_note: `Key ${keyId} for ${username} (${daysNum} days × ₹${PRICE_PER_DAY})`
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

    res.json({
      orderId,
      paymentSessionId: data.payment_session_id,
      amount: price,
      days: daysNum,
      pricePerDay: PRICE_PER_DAY
    });
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
    if (data.order_status !== 'PAID') {
      return res.status(400).json({ error: `Status: ${data.order_status}` });
    }

    const pendingRef = db.ref(`DPMods_Security/PendingOrders/${orderId}`);
    const pending = (await pendingRef.once('value')).val();
    if (!pending) return res.status(404).json({ error: 'Order not found' });
    if (pending.uid !== req.user.uid) return res.status(403).json({ error: 'Not your order' });
    if (pending.status === 'COMPLETED') {
      return res.json({ keyId: pending.keyId, alreadyIssued: true });
    }

    // Allocate key
    const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
    let finalKey = pending.keyId;
    if (keysSnap.exists() && keysSnap.val()[finalKey]) {
      const next = ((await db.ref('DPMods_Security/NextKeyNumber').once('value')).val()) || 1;
      finalKey = `AV-IND-${next}`;
    }

    const now = new Date();
    await db.ref(`DPMods_Security/Keys/${finalKey}`).set({
      Devices: { dummy: 0 },
      Banned: false,
      Username: pending.username,
      DeviceLimit: pending.limit || 1,
      ExpiryDate: pending.expiry,
      Days: pending.days,
      CreatedBy: pending.uid,
      CreatedAt: now.toISOString(),
      PaymentTxnId: data.cf_order_id || orderId,
      PaymentStatus: 'PAID',
      PaymentAmount: pending.amount,
      PricePerDay: pending.pricePerDay
    });

    const m = finalKey.match(/^AV-IND-(\d+)$/);
    if (m) {
      const n = parseInt(m[1]);
      const cur = ((await db.ref('DPMods_Security/NextKeyNumber').once('value')).val()) || 1;
      if (n >= cur) await db.ref('DPMods_Security/NextKeyNumber').set(n + 1);
    }

    await pendingRef.update({ status: 'COMPLETED', completedAt: Date.now() });

    // Telegram notify
    sendTelegram(
      `🎉 <b>NEW KEY GENERATED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔑 Key: <code>${finalKey}</code>\n` +
      `👤 Username: ${pending.username}\n` +
      `📅 Days: ${pending.days}\n` +
      `💵 Rate: ₹${pending.pricePerDay}/day\n` +
      `💰 Total: ₹${pending.amount}\n` +
      `🧾 Txn: <code>${data.cf_order_id || orderId}</code>\n` +
      `📧 Operator: ${req.user.email || req.user.uid}\n` +
      `⏰ ${now.toLocaleString('en-IN')}`
    );

    res.json({ keyId: finalKey, txnId: data.cf_order_id || orderId });
  } catch (e) {
    console.error(e);
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
      Name: name || opId,
      Contact: contact || '',
      Banned: false,
      Uid: userRecord.uid,
      CreatedBy: req.user.uid,
      CreatedAt: new Date().toISOString()
    });

    sendTelegram(
      `👤 <b>NEW OPERATOR CREATED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 ID: <code>${opId}</code>\n` +
      `👤 Name: ${name || opId}\n` +
      `📞 Contact: ${contact || 'N/A'}\n` +
      `⏰ ${new Date().toLocaleString('en-IN')}`
    );

    res.json({ ok: true, uid: userRecord.uid });
  } catch (e) {
    console.error(e);
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

    sendTelegram(`❌ <b>OPERATOR DELETED</b>\n🆔 <code>${opId}</code>`);
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

    sendTelegram(`${banned ? '🚫' : '✅'} <b>OPERATOR ${banned ? 'BANNED' : 'UNBANNED'}</b>\n🆔 <code>${opId}</code>`);
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
    sendTelegram(`🗑️ <b>KEY DELETED</b>\n🔑 <code>${keyId}</code>`);
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
    sendTelegram(`${banned ? '🚫' : '✅'} <b>KEY ${banned ? 'BANNED' : 'UNBANNED'}</b>\n🔑 <code>${keyId}</code>`);
    res.json({ ok: true, banned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── OPERATOR: UPDATE OWN KEY (only username) ───
app.post('/api/operator/update-key', authMiddleware, async (req, res) => {
  try {
    const { keyId, username } = req.body;
    if (!keyId || !username) return res.status(400).json({ error: 'Missing fields' });
    const ref = db.ref(`DPMods_Security/Keys/${keyId}`);
    const key = (await ref.once('value')).val();
    if (!key) return res.status(404).json({ error: 'Key not found' });
    if (key.CreatedBy !== req.user.uid) return res.status(403).json({ error: 'Not your key' });

    await ref.update({ Username: username });
    sendTelegram(`✏️ <b>KEY UPDATED</b>\n🔑 <code>${keyId}</code>\n👤 New: ${username}`);
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
    sendTelegram(`🗑️ <b>OPERATOR DELETED OWN KEY</b>\n🔑 <code>${keyId}</code>`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: CONFIG NOTIFY ───
app.post('/api/admin/config-updated', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) return res.status(403).json({ error: 'Admin only' });
    const { title, subtitle, price } = req.body;
    sendTelegram(
      `⚙️ <b>SYSTEM CONFIG UPDATED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 Title: ${title || 'N/A'}\n` +
      `💬 Subtitle: ${subtitle || 'N/A'}\n` +
      `💰 Price/Day: ₹${price || 'N/A'}\n` +
      `⏰ ${new Date().toLocaleString('en-IN')}`
    );
    res.json({ ok: true });
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
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'not set'}`);
  console.log(`💳 Cashfree env: ${process.env.CASHFREE_ENV || 'sandbox'}`);
  console.log(`💰 Price per day: ₹${PRICE_PER_DAY}`);
  console.log(`📨 Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'ON' : 'OFF'}`);
  console.log('═══════════════════════════════════════════');
});