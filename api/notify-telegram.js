const fetch = require('node-fetch');

const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const {
            order_id, key_id, username, days, amount,
            payment_status, operator, device_limit, expiry
        } = req.body;

        const message = `
🔔 *NEW PAYMENT RECEIVED*

🆔 *Order ID:* \`${order_id}\`
🔑 *Key:* \`${key_id}\`
👤 *Username:* ${username}
👥 *Device Limit:* ${device_limit}
📅 *Days:* ${days}
💰 *Amount:* ₹${amount}
✅ *Status:* ${payment_status}
📆 *Expiry:* ${expiry}
🧑‍💼 *By:* ${operator}
🕐 *Time:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⚡ _Anurag Online Official_
        `.trim();

        const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const tgData = await tgRes.json();
        return res.status(200).json({ ok: tgData.ok, result: tgData });
    } catch (e) {
        console.error('Telegram error:', e);
        return res.status(500).json({ error: e.message });
    }
};
