module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { contact, title, company, email, signal } = req.body || {};
  if (!contact || !company || !signal) {
    return res.status(400).json({ error: 'Missing required fields: contact, company, signal' });
  }

  // ── Dedup: skip if a draft already exists for this contact email ──────────
  if (email) {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_ANON_KEY;
    if (sbUrl && sbKey) {
      try {
        const base = sbUrl.replace(/\/$/, '');
        const sbH  = { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };
        const r = await fetch(
          `${base}/rest/v1/outreach_drafts?contact_email=eq.${encodeURIComponent(email)}&select=id,subject,body&limit=1`,
          { headers: sbH }
        );
        const existing = await r.json();
        if (Array.isArray(existing) && existing.length > 0) {
          const d = existing[0];
          return res.status(200).json({ subject: d.subject, body: d.body, existing: true });
        }
      } catch {
        // dedup check failed — fall through and generate new draft
      }
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const system = `You are writing cold outreach emails on behalf of Isaac Gonzalez at Fatfish, a full-service event production company in Salt Lake City, Utah. Fatfish handles AV, lighting, staging, décor, video, and experiential events for clients like WGU, Huntsman Cancer Institute, TEDx, and the Utah Jazz.

Rules:
- 3–4 sentences max for the body (not counting sign-off)
- Tone: direct, confident, specific — no generic agency language or buzzwords
- Open with a specific reference to the signal provided (treat it as context you "came across")
- Include one clear CTA: either request a 15-minute call or ask if they have an upcoming event needing production support
- Sign off as: Isaac Gonzalez | Fatfish | Salt Lake City
- Return ONLY valid JSON with two fields: "subject" (email subject line, concise, no clickbait) and "body" (the full email text, plain text, no markdown). No other text.`;

  const userMessage = `Write a cold outreach email with these details:
Contact name: ${contact}
Title: ${title || 'not provided'}
Company: ${company}
Email: ${email || 'not provided'}
Signal / reason for outreach: ${signal}`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(500).json({ error: data.error?.message || `Anthropic error ${upstream.status}` });
    }

    const text = data.content?.find(b => b.type === 'text')?.text || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!parsed.subject || !parsed.body) throw new Error('Invalid response shape from Claude');

    return res.status(200).json({ subject: parsed.subject, body: parsed.body });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
