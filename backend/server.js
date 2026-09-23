 
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Cashfree } = require('cashfree-pg');

const app = express();
app.use(cors());
app.use(express.json());

const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === 'production'
    ? Cashfree.PRODUCTION
    : Cashfree.SANDBOX,
  process.env.CASHFREE_APP_ID,
  process.env.CASHFREE_SECRET_KEY
);

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
    const { amount, customer_name, customer_phone, customer_email } = req.body;
    const orderId = `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const request = {
      order_amount: amount,
      order_currency: "INR",
      order_id: orderId,
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_name: customer_name,
        customer_phone: customer_phone,
        customer_email: customer_email
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/payment-status?order_id=${orderId}`
      }
    };

    const response = await cashfree.PGCreateOrder(request);

    res.json({
      success: true,
      order_id: orderId,
      payment_session_id: response.data.payment_session_id
    });
  } catch (error) {
    console.error('Order creation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/cashfree-webhook', async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    Cashfree.PGVerifyWebhookSignature(
      signature,
      JSON.stringify(req.body),
      timestamp
    );

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