require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Cashfree, CFEnvironment } = require('cashfree-pg');

const app = express();
app.use(cors());
app.use(express.json());

const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === 'production'
    ? CFEnvironment.PRODUCTION
    : CFEnvironment.SANDBOX,
  process.env.CASHFREE_APP_ID,
  process.env.CASHFREE_SECRET_KEY
);

// 🔒 SERVER-SIDE FIXED PRICES (कोई edit नहीं कर सकता)
const PACKAGE_PRICES = {
  7: 2100,
  14: 4200,
  21: 6300,
  28: 8400,
  35: 10500,
  42: 12600,
  49: 14700
};

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Anurag Online Official',
    contact: '9451228744',
    email: 'ahardoi30@gmail.com'
  });
});

app.post('/api/create-order', async (req, res) => {
  try {
    const { keyId, days, customer_name, customer_phone, customer_email } = req.body;

    // 🔒 Amount server पर तय होगा — client से नहीं लेगा
    const amount = PACKAGE_PRICES[days];

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: 'Invalid package selected'
      });
    }

    if (!keyId) {
      return res.status(400).json({
        success: false,
        error: 'Key ID is required'
      });
    }

    const safeKeyId = keyId.replace(/[^a-zA-Z0-9_-]/g, '');
    const orderId = `AO_${safeKeyId}_${Date.now()}`.substring(0, 45);

    const request = {
      order_amount: amount,
      order_currency: "INR",
      order_id: orderId,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_name: customer_name || 'Anurag Online Customer',
        customer_phone: customer_phone || '9999999999',
        customer_email: customer_email || 'customer@anuragonlineofficial.com'
      }
    };

    const response = await cashfree.PGCreateOrder(request);

    res.json({
      success: true,
      order_id: orderId,
      payment_session_id: response.data.payment_session_id,
      keyId: keyId,
      days: days,
      amount: amount
    });
  } catch (error) {
    console.error('Order creation error:', error.message);
    if (error.response) {
      console.error('Cashfree response:', JSON.stringify(error.response.data));
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/cashfree-webhook', async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody = JSON.stringify(req.body);

    cashfree.PGVerifyWebhookSignature(signature, rawBody, timestamp);

    console.log('Webhook received:', req.body.type);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook failed:', error.message);
    res.status(401).send('Invalid signature');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Anurag Online Official server running on port ${PORT}`);
});