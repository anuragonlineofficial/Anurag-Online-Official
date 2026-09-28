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

// ─── FIREBASE CREDENTIALS LOAD ───
// Render: FIREBASE_SERVICE_ACCOUNT env var se
// Local: serviceAccount.json file se
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log('🔥 Firebase loaded from ENV VAR');
} else {
  const filePath = join(__dirname, 'serviceAccount.json');
  if (!existsSync(filePath)) {
    console.error('❌ Neither FIREBASE_SERVICE_ACCOUNT env var nor serviceAccount.json found');
    process.exit(1);
  }
  serviceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
  console.log('🔥 Firebase loaded from FILE');
}

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL?.split(',') || '*' }));
app.use(express.json());

// ─── INIT FIREBASE ───
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

// ─── AUTH MIDDLEWARE ───
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

// ─── HEALTH CHECK ───
app.get('/', (_, res) => res.json({
  ok: true,
  service: 'anurag-backend',
  time: Date.now(),
  cashfreeEnv: process.env.CASHFREE_ENV,
  project: serviceAccount.project_id
}));

// ─── FIRST TIME ADMIN SETUP ───
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
      KeyPrice: 49,
      Maintenance: false,
      Update_Required: false,
      Admin_URL: '',
      Update_Link: '',
      Banned_Devices: ''
    });
    res.json({ ok: true, uid: user.uid, email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── CREATE PAYMENT ORDER ───
app.post('/api/payment/create-order', authMiddleware, async (req, res) => {
  try {
    const { keyId, username, limit, expiry } = req.body;
    if (!keyId || !username || !expiry) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const snap = await db.ref('DPMods_Security/App_Status/KeyPrice').once('value');
    const price = snap.val() || 49;

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
      order_note: `Key ${keyId} for ${username}`
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
      keyId, username, limit, expiry,
      uid: req.user.uid, amount: price,
      status: 'PENDING', createdAt: Date.now()
    });

    res.json({
      orderId,
      paymentSessionId: data.payment_session_id,
      amount: price
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── VERIFY PAYMENT + ISSUE KEY ───
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

    const keysSnap = await db.ref('DPMods_Security/Keys').once('value');
    let finalKey = pending.keyId;
    if (keysSnap.exists() && keysSnap.val()[finalKey]) {
      const next = ((await db.ref('DPMods_Security/NextKeyNumber').once('value')).val()) || 1;
      finalKey = `AV-IND-${next}`;
    }

    await db.ref(`DPMods_Security/Keys/${finalKey}`).set({
      Devices: { dummy: 0 },
      Banned: false,
      Username: pending.username,
      DeviceLimit: pending.limit || 1,
      ExpiryDate: pending.expiry,
      CreatedBy: pending.uid,
      CreatedAt: new Date().toISOString(),
      PaymentTxnId: data.cf_order_id || orderId,
      PaymentStatus: 'PAID',
      PaymentAmount: pending.amount
    });

    const m = finalKey.match(/^AV-IND-(\d+)$/);
    if (m) {
      const n = parseInt(m[1]);
      const cur = ((await db.ref('DPMods_Security/NextKeyNumber').once('value')).val()) || 1;
      if (n >= cur) await db.ref('DPMods_Security/NextKeyNumber').set(n + 1);
    }

    await pendingRef.update({ status: 'COMPLETED', completedAt: Date.now() });
    res.json({ keyId: finalKey, txnId: data.cf_order_id || orderId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: CREATE OPERATOR ───
app.post('/api/admin/create-operator', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { opId, name, pass, contact } = req.body;
    if (!opId || !pass) return res.status(400).json({ error: 'opId + pass required' });

    const email = `${opId}@anurag.local`;
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch {
      userRecord = await admin.auth().createUser({
        email,
        password: pass,
        displayName: name
      });
    }

    await db.ref(`DPMods_Security/Operators/${opId}`).set({
      Name: name || opId,
      Contact: contact || '',
      Banned: false,
      Uid: userRecord.uid,
      CreatedBy: req.user.uid,
      CreatedAt: new Date().toISOString()
    });

    res.json({ ok: true, uid: userRecord.uid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: DELETE OPERATOR ───
app.post('/api/admin/delete-operator', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { opId } = req.body;
    const snap = await db.ref(`DPMods_Security/Operators/${opId}`).once('value');
    const op = snap.val();
    if (op?.Uid) {
      try { await admin.auth().deleteUser(op.Uid); } catch (e) { console.error(e); }
    }
    await db.ref(`DPMods_Security/Operators/${opId}`).remove();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN: BAN / UNBAN OPERATOR ───
app.post('/api/admin/toggle-operator-ban', authMiddleware, async (req, res) => {
  try {
    if (!(await isAdmin(req.user.uid))) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { opId } = req.body;
    const ref = db.ref(`DPMods_Security/Operators/${opId}`);
    const cur = (await ref.once('value')).val();
    if (!cur) return res.status(404).json({ error: 'Operator not found' });

    const banned = !cur.Banned;
    await ref.update({ Banned: banned });
    if (cur.Uid) {
      try { await admin.auth().updateUser(cur.Uid, { disabled: banned }); }
      catch (e) { console.error(e); }
    }
    res.json({ ok: true, banned });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ─── START SERVER ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Backend running on :${PORT}`);
  console.log(`📛 Firebase project: ${serviceAccount.project_id}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'not set'}`);
  console.log(`💳 Cashfree env: ${process.env.CASHFREE_ENV || 'sandbox'}`);
  console.log('═══════════════════════════════════════════');
});