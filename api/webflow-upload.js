const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webflowKey = process.env.WEBFLOW_API_TOKEN;
  const siteId     = process.env.WEBFLOW_SITE_ID;

  if (!webflowKey || !siteId) {
    console.error('[webflow-upload] missing server env vars — WEBFLOW_API_TOKEN:', !!webflowKey, 'WEBFLOW_SITE_ID:', !!siteId);
    return res.status(500).json({ error: 'Server misconfiguration: missing Webflow credentials' });
  }

  const { imageUrl, fileName } = req.body || {};
  console.log('[webflow-upload] imageUrl:', imageUrl?.slice(0, 80), '| fileName:', fileName);

  if (!imageUrl || !fileName) {
    return res.status(400).json({ error: 'Missing required fields: imageUrl, fileName', received: Object.keys(req.body || {}) });
  }

  try {
    // ── Step 1: Fetch binary image ──────────────────────────────────────────
    console.log('[webflow-upload] step1: fetching image from:', imageUrl.slice(0, 120));
    const imgRes = await fetch(imageUrl);
    console.log('[webflow-upload] step1: status:', imgRes.status, imgRes.statusText);
    if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status} ${imgRes.statusText}`);
    const buffer      = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    console.log('[webflow-upload] step1: fetched', buffer.length, 'bytes, type:', contentType);

    // ── Step 2: Request Webflow presigned upload URL ────────────────────────
    const fileHash   = crypto.createHash('md5').update(buffer).digest('base64');
    const wfReqBody  = JSON.stringify({ fileName, fileHash });
    console.log('[webflow-upload] step2: requesting presigned URL — fileHash:', fileHash);

    const wfRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}/assets`, {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${webflowKey}`,
        'Content-Type':   'application/json',
        'accept-version': '2.0.0',
      },
      body: wfReqBody,
    });

    const wfText = await wfRes.text();
    console.log('[webflow-upload] step2: Webflow status:', wfRes.status, '| body:', wfText.slice(0, 800));
    if (!wfRes.ok) throw new Error(`Webflow asset init failed (${wfRes.status}): ${wfText.slice(0, 300)}`);

    const { uploadUrl, uploadDetails, id: fileId, hostedUrl } = JSON.parse(wfText);
    if (!uploadUrl || !uploadDetails) {
      throw new Error(`Webflow did not return uploadUrl/uploadDetails. Response: ${wfText.slice(0, 300)}`);
    }
    console.log('[webflow-upload] step2: uploadUrl:', uploadUrl?.slice(0, 80), '| fileId:', fileId);

    // ── Step 3: POST binary to S3 presigned URL ─────────────────────────────
    const s3Form = new FormData();
    for (const [key, val] of Object.entries(uploadDetails)) {
      s3Form.append(key, val);
    }
    s3Form.append('file', new Blob([buffer], { type: contentType }), fileName);
    console.log('[webflow-upload] step3: posting', buffer.length, 'bytes to S3');

    const s3Res  = await fetch(uploadUrl, { method: 'POST', body: s3Form });
    const s3Body = await s3Res.text();
    console.log('[webflow-upload] step3: S3 status:', s3Res.status, '| body:', s3Body.slice(0, 300));
    if (s3Res.status !== 200 && s3Res.status !== 201 && s3Res.status !== 204) {
      throw new Error(`S3 upload failed (${s3Res.status}): ${s3Body.slice(0, 300)}`);
    }

    console.log('[webflow-upload] done — fileId:', fileId, '| hostedUrl:', hostedUrl?.slice(0, 80));
    return res.json({ fileId, hostedUrl });

  } catch (e) {
    console.error('[webflow-upload] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
