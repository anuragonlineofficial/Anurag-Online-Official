 
const API_URL = 'http://localhost:10000';

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('pay-btn');
  const status = document.getElementById('status');

  btn.disabled = true;
  btn.textContent = 'Processing...';
  status.textContent = '';

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

    const cashfree = Cashfree({ mode: "sandbox" });

    await cashfree.checkout({
      paymentSessionId: data.payment_session_id,
      redirectTarget: "_modal"
    });
  } catch (error) {
    console.error(error);
    status.textContent = 'Error: ' + error.message;
    btn.disabled = false;
    btn.textContent = 'अभी भुगतान करें';
  }
});