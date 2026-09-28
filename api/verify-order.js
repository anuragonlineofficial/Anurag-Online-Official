const fetch = require('node-fetch');

const CF_APP_ID = process.env.CASHFREE_APP_ID;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CF_MODE = process.env.CASHFREE_MODE || 'production';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const orderId = req.query.order_id;
        if (!orderId) return res.status(400).json({ error: 'order_id required' });

        const CF_BASE = CF_MODE === 'sandbox'
            ? 'https://sandbox.cashfree.com/pg'
            : 'https://api.cashfree.com/pg';

        const response = await fetch(`${CF_BASE}/orders/${orderId}`, {
            method: 'GET',
            headers: {
                'x-api-version': '2023-08-01',
                'x-client-id': CF_APP_ID,
                'x-client-secret': CF_SECRET_KEY
            }
        });

        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (e) {
        console.error('Verify error:', e);
        return res.status(500).json({ error: e.message });
    }
};
