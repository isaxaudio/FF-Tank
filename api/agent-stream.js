/**
 * FF Tank — Agent Event Stream (SSE proxy)
 *
 * GET /api/agent-stream?id={sessionId}&runId={runId}
 *
 * Proxies the Anthropic managed agent SSE event stream to the browser.
 * Also updates the agent_runs row in Supabase on completion.
 *
 * Events forwarded to UI:
 *   tool_use    — agent called a tool (name + input)
 *   tool_result — tool returned (name + truncated result)
 *   message     — agent text output
 *   status      — session lifecycle (running | idle | completed | failed)
 *   error       — stream error
 */

module.exports = async function handler(req, res) {
  const { id: sessionId, runId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'session id required' });

  const anthKey = process.env.ANTHROPIC_API_KEY;
  if (!anthKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // SSE response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  // Keep-alive ping every 20s to prevent proxy timeouts
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
  }, 20000);

  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey  = process.env.SUPABASE_ANON_KEY;

  function updateRun(status, extras = {}) {
    if (!runId || !sbBase || !sbKey) return;
    fetch(`${sbBase}/rest/v1/agent_runs?id=eq.${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ status, ...extras }),
    }).catch(() => {});
  }

  try {
    // Fetch the Anthropic SSE event stream
    const upstream = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/events`, {
      headers: {
        'x-api-key': anthKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'managed-agents-2026-04-01',
        'Accept': 'text/event-stream',
      },
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      send('error', { message: `Upstream error ${upstream.status}: ${err}` });
      clearInterval(ping);
      res.end();
      return;
    }

    // Parse and forward SSE events line-by-line
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const rawData = line.slice(5).trim();
          if (!rawData || rawData === '[DONE]') continue;

          let parsed;
          try { parsed = JSON.parse(rawData); } catch { continue; }

          switch (parsed.type || currentEvent) {
            case 'agent.message':
            case 'agent.text':
              send('message', {
                role: 'assistant',
                content: typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content),
              });
              break;

            case 'agent.custom_tool_use':
              send('tool_use', {
                id:    parsed.id,
                tool:  parsed.custom_tool_name || parsed.name,
                input: parsed.input,
              });
              break;

            case 'agent.custom_tool_result':
            case 'agent.tool_result':
              send('tool_result', {
                tool:   parsed.custom_tool_name || parsed.name,
                result: JSON.stringify(parsed.result || parsed.content || {}).slice(0, 500),
              });
              break;

            case 'session.status_running':
              send('status', { status: 'running', session_id: sessionId });
              break;

            case 'session.status_idle':
              send('status', {
                status:      'idle',
                stop_reason: parsed.stop_reason?.type,
                session_id:  sessionId,
              });
              if (parsed.stop_reason?.type === 'end_turn') {
                updateRun('completed', { completed_at: new Date().toISOString() });
                clearInterval(ping);
                res.end();
                return;
              }
              break;

            case 'session.completed':
              send('status', { status: 'completed', session_id: sessionId });
              updateRun('completed', { completed_at: new Date().toISOString() });
              clearInterval(ping);
              res.end();
              return;

            case 'session.failed':
            case 'error':
              send('error', { message: parsed.error?.message || 'Session failed', session_id: sessionId });
              updateRun('failed', { completed_at: new Date().toISOString() });
              clearInterval(ping);
              res.end();
              return;
          }
          currentEvent = null;
        }
      }
    }

    // Stream ended naturally
    send('status', { status: 'completed', session_id: sessionId });
    updateRun('completed', { completed_at: new Date().toISOString() });
  } catch (e) {
    console.error('[agent-stream] error:', e.message);
    send('error', { message: e.message });
    updateRun('failed', { completed_at: new Date().toISOString() });
  } finally {
    clearInterval(ping);
    res.end();
  }
};
