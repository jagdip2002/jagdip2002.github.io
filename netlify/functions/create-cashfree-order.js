const https = require('https');

const CF_APP_ID     = process.env.CF_APP_ID;
const CF_SECRET_KEY = process.env.CF_SECRET_KEY;

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { orderId, amount, customerEmail, customerPhone, customerName } = body;
  if (!orderId || !amount || !customerEmail || !customerPhone) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const payload = JSON.stringify({
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
      return_url: `https://healyourrself.netlify.app/checkout.html?order_id={order_id}&order_status={order_status}`
    },
    order_note: 'Heal Yourr Self — Crystal Order'
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.cashfree.com',
      path:     '/pg/orders',
      method:   'POST',
      headers: {
        'x-client-id':     CF_APP_ID,
        'x-client-secret': CF_SECRET_KEY,
        'x-api-version':   '2023-08-01',
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200) {
            resolve({
              statusCode: 200,
              headers: { 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({
                payment_session_id: parsed.payment_session_id,
                order_id:           parsed.order_id
              })
            });
          } else {
            resolve({
              statusCode: res.statusCode,
              headers: { 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ error: parsed.message || 'Cashfree error', detail: parsed })
            });
          }
        } catch(e) {
          resolve({ statusCode: 500, body: JSON.stringify({ error: 'Parse error' }) });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: e.message }) });
    });

    req.write(payload);
    req.end();
  });
};
