// Exchanges a Google OAuth refresh token for a fresh access token.
// Keeps client_secret server-side so it's never exposed to the browser.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const { refreshToken } = req.body || {};

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET env vars' });
  }
  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing refreshToken in request body' });
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      console.error('[google-ads-token] token exchange failed:', data);
      return res.status(401).json({ error: data.error_description || 'Token exchange failed', detail: data });
    }
    return res.status(200).json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
