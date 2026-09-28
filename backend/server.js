// ============================================================
// Anurag Online Official — Backend Server (PRODUCTION)
// Express + Cashfree PG v6 + Firebase Admin + JWT Auth
// ============================================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Cashfree, CFEnvironment } = require('cashfree-pg');
const admin = require('firebase-admin');

// ============================================================
// 1. FIREBASE ADMIN INIT
// ============================================================
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DB_URL,
  });
}
const db = admin.database();

// ============================================================
// 2. CASHFREE INIT (v6 API)
// ============================================================
const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === 'production'
    ? CFEnvironment.PRODUCTION
    : CFEnvironment.SANDBOX,
  process.env.CASHFREE_APP_ID,
  process.env.CASHFREE_SECRET_KEY
);

// ============================================================
// 3. EXPRESS SETUP
// ============================================================
const app = express();

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // Postman/server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  },
  credentials: true,
}));

// 🔥 WEBHOOK — RAW body (express.json se PEHLE)
app.use('/api/cashfree-webhook', express.raw({ type: 'application/json' }));

// Baaki sab ke liye JSON
app.use(express.json({ limit: '1mb' }));

// ============================================================
// 4. PRICE TABLE (server-side — client change nahi kar sakta)
// ============================================================
const PACKAGE_PRICES = {
  7: 2100,
  14: 4200,
  21: 6300,
  28: 8400,
  35: 10500,
  42: 12600,
  49: 14700,
};

// ============================================================
// 5. JWT AUTH MIDDLEWARE
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE-ME-NOW';

function auth(requiredRole = null) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (!token) return res.status(401).json({ error: 'No token' });

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// ============================================================
// 6. HELPERS
// ============================================================
async function generateNextKeyId() {
  const snap = await db.ref('DPMods_Security/Keys').once('value');
  const keys = snap.val() || {};
  let max = 0;
  Object.keys(keys).forEach((k) => {
    const m = k.match(/^AO-IND-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `AO-IND-${max + 1}`;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ============================================================
// 7. HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Anurag Online Official',
    contact: '9451228744',
    email: 'ahardoi30@gmail.com',
    time: new Date().toISOString(),
  });
});

// ============================================================
// 8. LOGIN (admin + operator)
// ============================================================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const uname = String(username).trim().toLowerCase();

    // ---------- ADMIN ----------
    if (uname === 'admin') {
      const snap = await db.ref('DPMods_Security/Admin').once('value');
      const adm = snap.val() || {};
      let hash = adm.PasswordHash;

      if (!hash) {
        // First run: create admin with env password
        const initPass = process.env.ADMIN_INIT_PASSWORD || 'change-me';
        hash = await bcrypt.hash(initPass, 10);
        await db.ref('DPMods_Security/Admin').set({
          Username: 'admin',
          PasswordHash: hash,
          CreatedAt: Date.now(),
        });
      }

      const ok = await bcrypt.compare(password, hash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign(
        { role: 'admin', username: 'admin' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({
        role: 'admin',
        username: 'admin',
        name: 'Admin',
        created: adm.CreatedAt ? new Date(adm.CreatedAt).toLocaleString() : 'N/A',
        token,
      });
    }

    // ---------- OPERATOR ----------
    const snap = await db.ref(`DPMods_Security/Operators/${uname}`).once('value');
    const op = snap.val();
    if (!op) return res.status(401).json({ error: 'Invalid credentials' });
    if (op.Active === false) return res.status(403).json({ error: 'Account disabled' });

    let ok = false;
    if (op.PasswordHash) {
      ok = await bcrypt.compare(password, op.PasswordHash);
    } else if (op.Password) {
      // Migration: plaintext → hash
      ok = op.Password === password;
      if (ok) {
        const newHash = await bcrypt.hash(password, 10);
        await db.ref(`DPMods_Security/Operators/${uname}`).update({
          PasswordHash: newHash,
          Password: null,
        });
      }
    }
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { role: 'operator', username: uname },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      role: 'operator',
      username: uname,
      name: op.DisplayName || uname,
      created: op.CreatedAt ? new Date(op.CreatedAt).toLocaleString() : 'N/A',
      token,
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================================
// 9. CREATE ORDER
// ============================================================
app.post('/api/create-order', auth(), async (req, res) => {
  try {
    const { keyId, days, customer_name, customer_phone, customer_email, deviceLimit } = req.body || {};

    const amount = PACKAGE_PRICES[days];
    if (!amount) return res.status(400).json({ success: false, error: 'Invalid package' });
    if (!keyId) return res.status(400).json({ success: false, error: 'Key ID required' });

    const safeKeyId = String(keyId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
    if (!safeKeyId) return res.status(400).json({ success: false, error: 'Invalid Key ID' });

    // Duplicate guard — same key pending/paid na ho
    const existing = await db.ref('DPMods_Security/Orders')
      .orderByChild('keyId')
      .equalTo(safeKeyId)
      .once('value');
    if (existing.exists()) {
      const found = Object.values(existing.val()).find(
        (o) => o.status === 'PAID' || o.status === 'PENDING'
      );
      if (found) {
        return res.status(409).json({
          success: false,
          error: 'This Key ID is already used or has pending payment',
        });
      }
    }

    const orderId = `AO_${safeKeyId}_${Date.now()}`.substring(0, 45);

    const cfReq = {
      order_amount: amount,
      order_currency: 'INR',
      order_id: orderId,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_name: customer_name || 'Anurag Online Customer',
        customer_phone: customer_phone || '9999999999',
        customer_email: customer_email || 'customer@anuragonlineofficial.com',
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || ''}/?order_id={order_id}`,
        notify_url: `${process.env.BACKEND_URL || ''}/api/cashfree-webhook`,
      },
      order_note: `Key ${safeKeyId} — ${days} days`,
    };

    const cfRes = await cashfree.PGCreateOrder('2023-08-01', cfReq);

    // Save order in Firebase
    await db.ref(`DPMods_Security/Orders/${orderId}`).set({
      orderId,
      keyId: safeKeyId,
      amount,
      days,
      deviceLimit: deviceLimit || 1,
      customer_name: customer_name || '',
      customer_phone: customer_phone || '',
      customer_email: customer_email || '',
      operatorUsername: req.user.username,
      status: 'PENDING',
      createdAt: Date.now(),
      cashfreeOrderId: cfRes.data.order_id,
    });

    return res.json({
      success: true,
      order_id: orderId,
      payment_session_id: cfRes.data.payment_session_id,
      keyId: safeKeyId,
      days,
      amount,
    });
  } catch (err) {
    console.error('❌ Order error:', err?.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'Order creation failed' });
  }
});

// ============================================================
// 10. 🔥 WEBHOOK — REAL PAYMENT → AUTO KEY GENERATION
// ============================================================
app.post('/api/cashfree-webhook', async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!signature || !timestamp) {
      return res.status(400).send('Missing signature headers');
    }

    const rawBody = req.body.toString('utf8');

    // 1. Verify signature (manual HMAC-SHA256)
    const expectedSig = crypto
      .createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
      .update(timestamp + rawBody)
      .digest('base64');

    if (expectedSig !== signature) {
      console.warn('❌ Invalid webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(rawBody);
    const eventType = event?.type;
    const data = event?.data || {};

    const orderId = data?.order?.order_id;
    const orderStatus = data?.order?.order_status;
    const paymentStatus = data?.payment?.payment_status;
    const cfPaymentId = data?.payment?.cf_payment_id;

    console.log(`📩 Webhook: ${eventType} | Order: ${orderId} | Order: ${orderStatus} | Payment: ${paymentStatus}`);

    if (!orderId) return res.status(400).send('No order id');

    // 2. Idempotency — already processed?
    const orderSnap = await db.ref(`DPMods_Security/Orders/${orderId}`).once('value');
    const order = orderSnap.val();
    if (!order) return res.status(404).send('Order not found');
    if (order.status === 'PAID') return res.status(200).send('Already processed');

    // 3. Only PAID proceeds
    if (orderStatus !== 'PAID' && paymentStatus !== 'SUCCESS') {
      await db.ref(`DPMods_Security/Orders/${orderId}`).update({
        status: orderStatus || 'FAILED',
        updatedAt: Date.now(),
      });
      return res.status(200).send('Not paid — ignored');
    }

    // 4. ✅ GENERATE KEY — AUTOMATIC
    const newKeyId = await generateNextKeyId();
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + order.days);
    const expiryStr = expiry.toISOString().split('T')[0];

    await db.ref(`DPMods_Security/Keys/${newKeyId}`).set({
      Username: order.customer_name || 'Customer',
      DeviceLimit: order.deviceLimit || 1,
      ExpiryDate: expiryStr,
      Banned: false,
      Devices: { dummy: 0 },
      Days: order.days,
      Amount: order.amount,
      Payment: `₹${order.amount}`,
      Owner: order.operatorUsername,
      CreatedBy: order.operatorUsername,
      CreatedByRole: 'operator',
      Status: 'active',
      Pending: false,
      Created: todayStr(),
      OrderId: orderId,
      CashfreePaymentId: cfPaymentId || null,
      PaymentVerified: true,
      Gateway: 'Cashfree',
    });

    // 5. Mark order PAID
    await db.ref(`DPMods_Security/Orders/${orderId}`).update({
      status: 'PAID',
      keyGenerated: newKeyId,
      paidAt: Date.now(),
      cashfreePaymentId: cfPaymentId || null,
    });

    console.log(`✅ Key generated: ${newKeyId} for order ${orderId}`);
    return res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    return res.status(500).send('Server error');
  }
});

// ============================================================
// 11. ADMIN — APPROVE PENDING PAYMENT
// ============================================================
app.post('/api/admin/approve-payment/:id', auth('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const snap = await db.ref(`DPMods_Security/PaymentRequests/${id}`).once('value');
    const request = snap.val();
    if (!request) return res.status(404).json({ error: 'Not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const newKeyId = await generateNextKeyId();
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + request.days);

    await db.ref(`DPMods_Security/Keys/${newKeyId}`).set({
      Username: request.customer_name || 'Customer',
      DeviceLimit: request.deviceLimit || 1,
      ExpiryDate: expiry.toISOString().split('T')[0],
      Banned: false,
      Devices: { dummy: 0 },
      Days: request.days,
      Amount: request.amount,
      Owner: request.requestedBy,
      CreatedBy: request.requestedBy,
      PaymentVerified: true,
      Gateway: 'Cashfree',
    });

    await db.ref(`DPMods_Security/PaymentRequests/${id}`).update({
      status: 'approved',
      keyGenerated: newKeyId,
      approvedAt: Date.now(),
      approvedBy: req.user.username,
    });

    res.json({ success: true, keyId: newKeyId });
  } catch (err) {
    console.error('Approve error:', err.message);
    res.status(500).json({ error: 'Approve failed' });
  }
});

// ============================================================
// 12. ADMIN — REJECT PAYMENT
// ============================================================
app.post('/api/admin/reject-payment/:id', auth('admin'), async (req, res) => {
  try {
    await db.ref(`DPMods_Security/PaymentRequests/${req.params.id}`).update({
      status: 'rejected',
      rejectedAt: Date.now(),
      rejectedBy: req.user.username,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Reject failed' });
  }
});

// ============================================================
// 13. KEY MANAGEMENT
// ============================================================
app.delete('/api/keys/:keyId', auth(), async (req, res) => {
  try {
    const keyId = req.params.keyId;
    const snap = await db.ref(`DPMods_Security/Keys/${keyId}`).once('value');
    const key = snap.val();
    if (!key) return res.status(404).json({ error: 'Not found' });

    if (req.user.role !== 'admin' && key.CreatedBy !== req.user.username) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.ref(`DPMods_Security/Keys/${keyId}`).remove();
    if (key.OrderId) {
      await db.ref(`DPMods_Security/Orders/${key.OrderId}`).remove();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.post('/api/keys/:keyId/ban', auth(), async (req, res) => {
  try {
    const keyId = req.params.keyId;
    const snap = await db.ref(`DPMods_Security/Keys/${keyId}`).once('value');
    const key = snap.val();
    if (!key) return res.status(404).json({ error: 'Not found' });

    if (req.user.role !== 'admin' && key.CreatedBy !== req.user.username) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const newBan = !key.Banned;
    await db.ref(`DPMods_Security/Keys/${keyId}/Banned`).set(newBan);
    res.json({ success: true, banned: newBan });
  } catch (err) {
    res.status(500).json({ error: 'Ban toggle failed' });
  }
});

app.delete('/api/keys/:keyId/devices/:hwid', auth(), async (req, res) => {
  try {
    const { keyId, hwid } = req.params;
    const snap = await db.ref(`DPMods_Security/Keys/${keyId}`).once('value');
    const key = snap.val();
    if (!key) return res.status(404).json({ error: 'Not found' });

    if (req.user.role !== 'admin' && key.CreatedBy !== req.user.username) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.ref(`DPMods_Security/Keys/${keyId}/Devices/${hwid}`).remove();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Device removal failed' });
  }
});

// ============================================================
// 14. OPERATOR MANAGEMENT (admin only)
// ============================================================
app.post('/api/admin/operators', auth('admin'), async (req, res) => {
  try {
    const { username, password, displayName, notes } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const uname = String(username).trim().toLowerCase();
    if (uname === 'admin') return res.status(400).json({ error: 'Reserved username' });

    const hash = await bcrypt.hash(password, 10);
    await db.ref(`DPMods_Security/Operators/${uname}`).set({
      PasswordHash: hash,
      DisplayName: displayName || '',
      Notes: notes || '',
      Active: true,
      CreatedAt: Date.now(),
      CreatedBy: req.user.username,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Create operator failed' });
  }
});

app.delete('/api/admin/operators/:username', auth('admin'), async (req, res) => {
  try {
    await db.ref(`DPMods_Security/Operators/${req.params.username}`).remove();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

app.post('/api/admin/operators/:username/toggle', auth('admin'), async (req, res) => {
  try {
    const ref = db.ref(`DPMods_Security/Operators/${req.params.username}/Active`);
    const snap = await ref.once('value');
    const current = snap.val();
    await ref.set(!(current === true));
    res.json({ success: true, active: !(current === true) });
  } catch (err) {
    res.status(500).json({ error: 'Toggle failed' });
  }
});

// ============================================================
// 15. START
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Anurag Online Official server running on port ${PORT}`);
  console.log(`   Cashfree ENV: ${process.env.CASHFREE_ENV || 'sandbox'}`);
  console.log(`   Frontend URL: ${process.env.FRONTEND_URL || 'not set'}`);
});