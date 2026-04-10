module.exports = async (req, res) => {
  const webflowKey = process.env.WEBFLOW_API_TOKEN;

  if (!webflowKey) {
    console.error('[webflow-cms] missing WEBFLOW_API_TOKEN env var');
    return res.status(500).json({ error: 'Server misconfiguration: missing WEBFLOW_API_TOKEN' });
  }

  const path = (req.query.p || '').replace(/^\//, '');
  if (!path) {
    return res.status(400).json({ error: 'Missing ?p= path parameter' });
  }

  const fullPath   = '/' + path;
  const apiVersion = fullPath.startsWith('/v2') ? '2.0.0' : '1.0.0';
  const upstream   = `https://api.webflow.com${fullPath}`;
  console.log('[webflow-cms] upstream:', upstream, '| method:', req.method, '| version:', apiVersion);

  try {
    const response = await fetch(upstream, {
      method: req.method,
      headers: {
        'Authorization':  `Bearer ${webflowKey}`,
        'Content-Type':   'application/json',
        'accept-version': apiVersion,
      },
      body: req.method !== 'GET' && req.method !== 'DELETE'
        ? JSON.stringify(req.body)
        : undefined,
    });

    const data = await response.json();
    console.log('[webflow-cms] status:', response.status, JSON.stringify(data).slice(0, 300));
    return res.status(response.status).json(data);
  } catch (e) {
    console.error('[webflow-cms] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
