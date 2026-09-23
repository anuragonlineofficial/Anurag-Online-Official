const API_URL = 'https://anurag-online-backend.onrender.com';

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('pay-btn');
  const status = document.getElementById('status');

  btn.disabled = true;
  btn.textContent = 'Processing...';
  status.textContent = '';
  status.style.color = 'red';

  const formData = {
    amount: document.getElementById('amount').value,
    customer_name: document.getElementById('name').value,
    customer_phone: document.getElementById('phone').value,
    customer_email: document.getElementById('email').value
  };

  try {
    const res = await fetch(`${API_URL}/api/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Order create failed');
    }

    const cashfree = Cashfree({ mode: "production" });

    const result = await cashfree.checkout({
      paymentSessionId: data.payment_session_id,
      redirectTarget: "_modal"
    });

    if (result && result.paymentDetails) {
      status.style.color = 'green';
      status.textContent = '✅ Payment Successful! Order ID: ' + data.order_id;
      btn.textContent = 'Payment Done ✓';
      document.getElementById('payment-form').reset();
    } else if (result && result.error) {
      status.style.color = 'red';
      status.textContent = '❌ Payment Failed: ' + result.error.message;
      btn.disabled = false;
      btn.textContent = 'अभी भुगतान करें';
    } else {
      status.style.color = 'orange';
      status.textContent = '⚠️ Payment status check हो रहा है। कृपया थोड़ी देर बाद देखें।';
      btn.disabled = false;
      btn.textContent = 'अभी भुगतान करें';
    }

  } catch (error) {
    console.error(error);
    status.style.color = 'red';
    status.textContent = 'Error: ' + error.message;
    btn.disabled = false;
    btn.textContent = 'अभी भुगतान करें';
  }
});