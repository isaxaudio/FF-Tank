module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, devToken, customerId, managerId, query } = req.body || {};

  if (!accessToken || !devToken || !customerId) {
    return res.status(400).json({ error: 'Missing accessToken, devToken, or customerId' });
  }

  const cid = customerId.replace(/-/g, '');
  const url = `https://googleads.googleapis.com/v20/customers/${cid}/googleAds:search`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': devToken,
  };
  if (managerId) headers['login-customer-id'] = managerId.replace(/-/g, '');

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });
    const text = await upstream.text();
    console.log('[google-ads-search] status:', upstream.status);
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
