// src/components/CampaignEmail.jsx — the email send on a campaign: who gets it (a segment of subscribed
// contacts, counted live), what they get (a campaign template, HTML or text, with the subject and sender),
// a test to your own addresses, then schedule or send now through Resend, and the results per recipient
// as the webhooks arrive. Lives on the campaign panel for every campaign kind, so a trade show can have
// its follow-up newsletter under the same roof as its badge scans and deals.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Send, Clock, FlaskConical, Users, RefreshCw } from "lucide-react";
import { auth } from "../lib/auth.js";
import { listTemplates, SAMPLE, render, previewHtml } from "../lib/email.js";
import { updateCampaign, audienceFor, sendTest, sendNow, scheduleCampaign, unschedule, listSends, cleanSegment, EMPTY_SEGMENT, SEND_STATUS_LABEL, SEND_STATUS_TONE, RECIPIENT_TONE, listCampaigns } from "../lib/campaigns.js";
import { LIFECYCLE, LIFECYCLE_LABEL, LEAD_STATUS, LEAD_STATUS_LABEL } from "../lib/status.js";

const label = { ...TT.label, marginBottom: 4, display: "block" };
const SOURCES = ["manual", "trade_show", "referral", "apollo", "inbound", "other"];
const COMPANY_KINDS = ["prospect", "client", "partner", "venue", "other"];
const when = ts => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const localInput = ts => { const d = ts ? new Date(ts) : new Date(Date.now() + 3600e3); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export default function CampaignEmail({ campaign: c, onChanged }) {
  const [templates, setTemplates] = useState([]);
  const [others, setOthers] = useState([]);
  const [f, setF] = useState({ email_template_id: c.email_template_id || "", subject: c.subject || "", from_name: c.from_name || "", from_email: c.from_email || "", reply_to: c.reply_to || "" });
  const [seg, setSeg] = useState({ ...EMPTY_SEGMENT, ...(c.segment || {}), added_days: c.segment?.added_days || "" });
  const [audience, setAudience] = useState(null);
  const [testTo, setTestTo] = useState(auth.user()?.email || "");
  const [at, setAt] = useState(localInput(c.scheduled_at));
  const [sends, setSends] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const live = ["sending", "sent"].includes(c.send_status);

  useEffect(() => { Promise.resolve().then(async () => { try { const [t, all] = await Promise.all([listTemplates({ kind: "campaign" }), listCampaigns()]); setTemplates(t || []); setOthers(all.filter(x => x.id !== c.id)); } catch (e) { setErr(e.message); } }); }, [c.id]);
  async function loadSends() { try { setSends((await listSends(c.id)) || []); } catch (e) { setErr(e.message); } }
  useEffect(() => { if (live || c.sent_at) Promise.resolve().then(loadSends); }, [c.id, c.send_status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Audience count follows the segment with a short debounce; a stale count shows as "counting…".
  const segKey = JSON.stringify(cleanSegment(seg));
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => audienceFor(seg).then(a => alive && setAudience({ ...a, key: segKey })).catch(e => alive && setErr(e.message)), 350);
    return () => { alive = false; clearTimeout(t); };
  }, [segKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const audienceReady = audience && audience.key === segKey;

  const tpl = templates.find(t => t.id === f.email_template_id) || null;
  const sample = useMemo(() => ({ ...SAMPLE, event: c.name, sender_first_name: (f.from_name || "Isaac").split(" ")[0], sender_name: f.from_name || "Isaac Gonzalez" }), [c.name, f.from_name]);
  const subjectPreview = render(f.subject || tpl?.subject || "", sample);
  const dirty = JSON.stringify({ ...f, segment: cleanSegment(seg) }) !== JSON.stringify({ email_template_id: c.email_template_id || "", subject: c.subject || "", from_name: c.from_name || "", from_email: c.from_email || "", reply_to: c.reply_to || "", segment: c.segment || {} });
  const toggle = (k, v) => setSeg(s => ({ ...s, [k]: s[k].includes(v) ? s[k].filter(x => x !== v) : [...s[k], v] }));
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function save() {
    setBusy("save"); setErr("");
    try { await updateCampaign(c.id, { email_template_id: f.email_template_id || null, subject: f.subject || null, from_name: f.from_name || null, from_email: f.from_email || null, reply_to: f.reply_to || null, segment: cleanSegment(seg) }); setMsg("Saved."); onChanged?.(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  }
  async function act(kind, fn) {
    setBusy(kind); setErr(""); setMsg("");
    try { if (dirty) await save(); const r = await fn(); setMsg(r); onChanged?.(); await loadSends(); }
    catch (e) { setErr(e.code === "no_resend" ? e.message : `${e.message}${e.summary ? ` (${e.summary.sent} sent before the error)` : ""}`); onChanged?.(); }
    setBusy(""); setConfirm(false);
  }
  const canSend = !!f.email_template_id && !!(f.subject || tpl?.subject) && !live;
  const counts = useMemo(() => { const n = {}; for (const s of sends) if (!s.is_test) n[s.status] = (n[s.status] || 0) + 1; return n; }, [sends]);
  const stats = c.stats || {};

  return (
    <div data-campaign-email style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={label}>Email send</div>
        <span style={pill(SEND_STATUS_TONE[c.send_status] || "sand")}>{SEND_STATUS_LABEL[c.send_status] || c.send_status}</span>
        {c.send_status === "scheduled" && c.scheduled_at && <span style={{ ...TT.caption, color: TC.sub }}>for {when(c.scheduled_at)}</span>}
        {c.sent_at && <span style={{ ...TT.caption, color: TC.sub }}>sent {when(c.sent_at)}</span>}
        {c.send_error && <span style={{ ...pill("rust"), maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.send_error}>{c.send_error}</span>}
      </div>

      {live ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {[["Sent", stats.sent], ["Delivered", stats.delivered], ["Opened", stats.opened], ["Clicked", stats.clicked], ["Bounced", stats.bounced], ["Complaints", stats.complained], ["Unsubscribed", stats.unsubscribed], ["Failed", stats.failed]].map(([l, v]) => (
            <div key={l} style={tile({ padding: "8px 10px" })}><div style={TT.label}>{l}</div><div style={{ ...TT.h4, color: TC.ink, marginTop: 2 }}>{v ?? 0}</div></div>
          ))}
        </div>
      ) : (
        <>
          <div style={tile({ padding: 12, background: TC.bg })}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Users size={14} strokeWidth={1.5} style={{ color: TC.sub }} />
              <span style={{ ...TT.body2Med, color: TC.ink }}>Who gets it</span>
              <span data-audience style={{ ...TT.caption, color: TC.sub, marginLeft: "auto" }}>{audienceReady ? `${audience.count.toLocaleString()} subscribed contact${audience.count === 1 ? "" : "s"}` : "counting…"}</span>
            </div>
            <div style={{ ...TT.caption, color: TC.muted, marginBottom: 8 }}>Only people whose marketing status is subscribed, with an address, not on the suppression list. Leave every filter empty for all of them.</div>
            <div style={{ display: "grid", gap: 8 }}>
              <Chips title="Lifecycle" options={LIFECYCLE.map(k => [k, LIFECYCLE_LABEL[k]])} value={seg.lifecycle} onToggle={v => toggle("lifecycle", v)} />
              <Chips title="Lead status" options={LEAD_STATUS.map(k => [k, LEAD_STATUS_LABEL[k]])} value={seg.lead_status} onToggle={v => toggle("lead_status", v)} />
              <Chips title="Source" options={SOURCES.map(k => [k, k])} value={seg.source} onToggle={v => toggle("source", v)} />
              <Chips title="Company kind" options={COMPANY_KINDS.map(k => [k, k])} value={seg.company_kind} onToggle={v => toggle("company_kind", v)} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div><span style={label}>Owner</span><input value={seg.owner} onChange={e => setSeg(s => ({ ...s, owner: e.target.value }))} placeholder="anyone" style={inputStyle()} /></div>
                <div><span style={label}>In campaign</span><select value={seg.in_campaign} onChange={e => setSeg(s => ({ ...s, in_campaign: e.target.value }))} style={inputStyle()}><option value="">any</option>{others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                <div><span style={label}>Added within</span><select value={seg.added_days} onChange={e => setSeg(s => ({ ...s, added_days: e.target.value }))} style={inputStyle()}><option value="">any time</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">a year</option></select></div>
              </div>
            </div>
            {audienceReady && audience.sample?.length > 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>e.g. {audience.sample.slice(0, 4).map(s => s.name || s.email).join(", ")}{audience.count > 4 ? "…" : ""}</div>}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div><span style={label}>Template (campaign kind)</span>
              <select data-campaign-template value={f.email_template_id} onChange={set("email_template_id")} style={inputStyle()}><option value="">Pick a template…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · {t.format === "html" ? "HTML" : "text"}</option>)}</select>
              {templates.length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 2 }}>No campaign templates yet: Outreach → Templates → New template, kind "Campaign".</div>}
            </div>
            <div><span style={label}>Subject</span><input value={f.subject} onChange={set("subject")} placeholder={tpl?.subject || "Subject"} style={inputStyle()} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><span style={label}>From name</span><input value={f.from_name} onChange={set("from_name")} placeholder="Fatfish" style={inputStyle()} /></div>
              <div><span style={label}>From address</span><input value={f.from_email} onChange={set("from_email")} placeholder="default sending domain" style={inputStyle()} /></div>
              <div><span style={label}>Reply-to</span><input value={f.reply_to} onChange={set("reply_to")} placeholder="isaac@fatfishmedia.com" style={inputStyle()} /></div>
            </div>
          </div>
          {tpl && (
            <div style={tile({ padding: 12, background: TC.bg })}>
              <div style={{ ...TT.caption, color: TC.muted, marginBottom: 4 }}>Preview with sample values</div>
              <div style={{ ...TT.body2, color: TC.ink, fontWeight: 450 }}>{subjectPreview || "(no subject)"}</div>
              <iframe data-campaign-preview title="Preview" sandbox="" srcDoc={previewHtml(tpl.body, tpl.format, sample)} style={{ width: "100%", height: tpl.format === "html" ? 320 : 160, border: `1px solid ${TC.line}`, borderRadius: 8, background: "#fff", marginTop: 6 }} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={save} disabled={busy !== "" || !dirty} style={btn(dirty ? "primary" : "secondary")}>{busy === "save" ? "Saving…" : "Save"}</button>
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@fatfishmedia.com, taylor@…" style={inputStyle({ width: 240 })} />
            <button data-send-test onClick={() => act("test", async () => { const r = await sendTest(c.id, testTo.split(/[,\s]+/).filter(Boolean)); return `Test sent to ${r.sent} address${r.sent === 1 ? "" : "es"}.`; })} disabled={busy !== "" || !canSend || !testTo.trim()} style={btn("secondary")} title="Sends the real email to these addresses only, rendered for the first person in the segment"><FlaskConical size={13} strokeWidth={1.5} /> {busy === "test" ? "Sending…" : "Send test"}</button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${TC.lineSoft}`, paddingTop: 10 }}>
            {c.send_status === "scheduled" ? (
              <button onClick={() => act("unschedule", async () => { await unschedule(c.id); return "Schedule cleared."; })} disabled={busy !== ""} style={btn("secondary")}><Clock size={13} strokeWidth={1.5} /> Cancel schedule</button>
            ) : (
              <>
                <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} style={inputStyle({ width: 210 })} />
                <button data-schedule onClick={() => act("schedule", async () => { const iso = new Date(at).toISOString(); if (new Date(at) < new Date()) throw new Error("Pick a time in the future"); await scheduleCampaign(c.id, iso); return `Scheduled for ${when(iso)}. The scheduler sends it within 15 minutes of then.`; })} disabled={busy !== "" || !canSend} style={btn("secondary")}><Clock size={13} strokeWidth={1.5} /> Schedule</button>
              </>
            )}
            {!confirm ? (
              <button data-send-now onClick={() => setConfirm(true)} disabled={busy !== "" || !canSend || !audienceReady || !audience.count} style={{ ...btn("primary"), marginLeft: "auto" }}><Send size={13} strokeWidth={1.5} /> Send now</button>
            ) : (
              <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ ...TT.body2, color: TC.ink }}>Send to {audience?.count?.toLocaleString()} people now?</span>
                <button data-send-confirm onClick={() => act("send", async () => { const r = await sendNow(c.id); return `Sent to ${r.sent}${r.skipped ? `, ${r.skipped} already had it` : ""}.`; })} disabled={busy !== ""} style={btn("primary")}>{busy === "send" ? "Sending…" : "Yes, send"}</button>
                <button onClick={() => setConfirm(false)} style={btn("ghost")}>No</button>
              </span>
            )}
          </div>
        </>
      )}
      {msg && <div data-campaign-msg style={pill("evergreen")}>{msg}</div>}
      {err && <div data-campaign-err style={pill("rust")}>{err}</div>}

      {sends.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={label}>Recipients · {sends.filter(s => !s.is_test).length}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{Object.entries(counts).map(([k, n]) => <span key={k} style={pill(RECIPIENT_TONE[k] || "sand")}>{k} {n}</span>)}</div>
            <button onClick={loadSends} style={{ ...btn("ghost"), padding: "2px 6px", marginLeft: "auto" }} title="Refresh"><RefreshCw size={13} strokeWidth={1.5} /></button>
          </div>
          {sends.slice(0, 300).map(s => (
            <div key={s.id} data-recipient={s.email} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <span style={pill(RECIPIENT_TONE[s.status] || "sand")}>{s.is_test ? "test" : s.status}</span>
              <span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.contacts?.name || s.email}{s.contacts?.companies?.name ? <span style={{ color: TC.muted }}> · {s.contacts.companies.name}</span> : null}</span>
              <span style={{ ...TT.caption, color: TC.muted, whiteSpace: "nowrap" }}>{s.error ? s.error.slice(0, 60) : [s.clicked_at && "clicked", s.opened_at && "opened", s.delivered_at && "delivered"].filter(Boolean)[0] || when(s.sent_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chips({ title, options, value, onToggle }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ ...TT.caption, color: TC.muted, width: 92, flexShrink: 0 }}>{title}</span>
      {options.map(([k, l]) => <button key={k} type="button" onClick={() => onToggle(k)} style={{ ...pill(value.includes(k) ? "ink" : "outline"), cursor: "pointer", padding: "2px 8px" }}>{l}</button>)}
    </div>
  );
}
