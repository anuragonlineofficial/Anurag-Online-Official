const fetch = require('node-fetch');

// ⚠️ Vercel Dashboard → Settings → Environment Variables me ye daalo
const CF_APP_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CF_MODE = process.env.CASHFREE_MODE || 'production';

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const CF_BASE = CF_MODE === 'sandbox'
            ? 'https://sandbox.cashfree.com/pg'
            : 'https://api.cashfree.com/pg';

        const body = req.body;

        const response = await fetch(`${CF_BASE}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-version': '2023-08-01',
                'x-client-id': CF_APP_ID,
                'x-client-secret': CF_SECRET_KEY
            },
            body: JSON.stringify({
                order_id: body.order_id,
                order_amount: body.order_amount,
                order_currency: body.order_currency || 'INR',
                customer_details: body.customer_details,
                order_meta: body.order_meta,
                order_note: body.order_note
            })
        });

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (e) {
        console.error('Create order error:', e);
        return res.status(500).json({ error: e.message });
    }
};
