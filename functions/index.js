const functions = require('firebase-functions');
const axios = require('axios');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Keys stored in Firebase Functions config — never hardcoded
// Set via: firebase functions:config:set cashfree.app_id="..." cashfree.secret_key="..."
const CF_APP_ID     = functions.config().cashfree?.app_id     || process.env.CF_APP_ID;
const CF_SECRET_KEY = functions.config().cashfree?.secret_key || process.env.CF_SECRET_KEY;
const CF_API_URL    = 'https://api.cashfree.com/pg/orders';
const CF_API_VER    = '2023-08-01';

exports.createCashfreeOrder = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')   { res.status(405).send('Method Not Allowed'); return; }

  const { orderId, amount, customerEmail, customerPhone, customerName, orderData } = req.body;

  if (!orderId || !amount || !customerEmail || !customerPhone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Create order in Cashfree
    const cfResp = await axios.post(CF_API_URL, {
      order_id:       orderId,
      order_amount:   amount,
      order_currency: 'INR',
      customer_details: {
        customer_id:    orderId,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        customer_name:  customerName || 'Customer'
      },
      order_meta: {
        return_url: `https://healyourrself.netlify.app/checkout.html?order_id={order_id}&order_status={order_status}`,
        notify_url: `https://us-central1-heal-yourr-self.cloudfunctions.net/cashfreeWebhook`
      },
      order_note: 'Heal Yourr Self — Crystal Order'
    }, {
      headers: {
        'x-client-id':     CF_APP_ID,
        'x-client-secret': CF_SECRET_KEY,
        'x-api-version':   CF_API_VER,
        'Content-Type':    'application/json'
      }
    });

    // Save pending order to Firestore
    if (orderData) {
      await db.collection('orders').doc(orderId).set({ ...orderData, status: 'pending' });
    }

    res.json({
      payment_session_id: cfResp.data.payment_session_id,
      order_id:           cfResp.data.order_id
    });

  } catch (err) {
    console.error('Cashfree error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment order', detail: err.response?.data });
  }
});

// Webhook — Cashfree calls this after payment
exports.cashfreeWebhook = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') { res.status(405).send(''); return; }

  try {
    const event = req.body;
    const orderId = event?.data?.order?.order_id;
    const status  = event?.data?.payment?.payment_status;

    if (orderId && status === 'SUCCESS') {
      await db.collection('orders').doc(orderId).update({
        status: 'paid',
        paidAt: new Date().toISOString(),
        paymentId: event?.data?.payment?.cf_payment_id || ''
      });
      // Update user orders too
      const orderSnap = await db.collection('orders').doc(orderId).get();
      if (orderSnap.exists) {
        const ord = orderSnap.data();
        if (ord.userId && ord.userId !== 'guest') {
          const userRef = db.collection('users').doc(ord.userId);
          const userSnap = await userRef.get();
          const userData = userSnap.data() || {};
          const userOrders = (userData.orders || []).map(o => o.id === orderId ? { ...o, status: 'paid' } : o);
          await userRef.set({ orders: userOrders, cart: [] }, { merge: true });
        }
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
