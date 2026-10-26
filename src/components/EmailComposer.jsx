// src/components/EmailComposer.jsx — compose a one-to-one email from a record and send it through
// the signed-in user's Gmail. Templates fill subject and body with the record's tokens; unresolved
// tokens are called out before sending. An unsubscribed address cannot be sent to. "Save as Gmail
// draft" is offered as well and is logged as a draft, never as sent. With no Gmail token in
// Settings the only way out is the mail app, after which the email is logged by hand.
import React, { useEffect, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { X, Send, FileText, ExternalLink } from "lucide-react";
import { db } from "../lib/db.js";
import { listTemplates, contextFor, render, unresolved, sendEmail, saveDraft, gmailToken, isUnsubscribed } from "../lib/email.js";

const label = { ...TT.label, marginBottom: 4, display: "block" };

export default function EmailComposer({ open, onClose, contacts = [], contactId = null, companyId = null, dealId = null, toEmail = null, onSent }) {
  const [to, setTo] = useState("");
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ctx, setCtx] = useState({});
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [seen, setSeen] = useState(false);
  const bodyRef = useRef(null);
  const token = gmailToken();

  // Reset when opened: pick the recipient, load templates and the token context.
  if (open && !seen) {
    setSeen(true);
    const first = contacts.find(p => p.id === contactId) || contacts.find(p => toEmail && p.email === toEmail) || contacts.find(p => p.email) || null;
    setTo(toEmail || first?.email || ""); setTemplateId(""); setSubject(""); setBody(""); setErr(""); setBusy(""); setBlocked(false);
  }
  if (!open && seen) setSeen(false);

  useEffect(() => {
    if (!open) return;
    let on = true;
    (async () => {
      const contact = contacts.find(p => p.email && p.email === to) || contacts.find(p => p.id === contactId) || null;
      const [tpls, company, deal] = await Promise.all([
        listTemplates().catch(() => []),
        companyId ? db.select("companies", { id: `eq.${companyId}`, select: "id,name" }).then(r => r?.[0] || null).catch(() => null) : null,
        dealId ? db.select("deals", { id: `eq.${dealId}`, select: "id,name" }).then(r => r?.[0] || null).catch(() => null) : null,
      ]);
      if (!on) return;
      setTemplates(tpls || []); setCtx(contextFor({ contact, company, deal }));
    })();
    return () => { on = false; };
  }, [open, to, contactId, companyId, dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  // blocked is the address the suppression check answered for; it is reset by the reset-on-open path above.
  useEffect(() => {
    if (!open || !to) return;
    let on = true; isUnsubscribed(to).then(b => { if (on) setBlocked(b); }).catch(() => {});
    return () => { on = false; };
  }, [open, to]);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const recipient = contacts.find(p => p.email && p.email === to) || null;
  const missing = unresolved(subject + "\n" + body);
  const canSend = !!to && !!subject.trim() && !!body.trim() && !blocked && !busy;

  function applyTemplate(id) {
    setTemplateId(id);
    const t = templates.find(x => x.id === id); if (!t) return;
    setSubject(render(t.subject, ctx)); setBody(render(t.body, ctx)); setTimeout(() => bodyRef.current?.focus(), 0);
  }
  async function send() {
    if (!canSend) return; setBusy("send"); setErr("");
    try {
      const m = await sendEmail({ to, subject: subject.trim(), body, contactId: recipient?.id || contactId, companyId: companyId || recipient?.company_id || null, dealId, templateId: templateId || null });
      onSent?.({ kind: "sent", message: m }); onClose?.();
    } catch (e) { setErr(e.code === "unsubscribed" ? "This address is unsubscribed; FF Tank will not send to it." : e.message); }
    setBusy("");
  }
  async function draft() {
    if (!to || busy) return; setBusy("draft"); setErr("");
    try {
      await saveDraft({ to, subject: subject.trim(), body, contactId: recipient?.id || contactId, companyId: companyId || recipient?.company_id || null });
      onSent?.({ kind: "draft" }); onClose?.();
    } catch (e) { setErr(e.message); }
    setBusy("");
  }
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }} style={{ position: "fixed", inset: 0, background: "rgba(28,28,24,0.32)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px" }}>
      <div data-email-composer role="dialog" aria-label="Email" style={{ background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12, width: "min(720px, 100%)", maxHeight: "88vh", overflow: "auto", boxShadow: "0 24px 64px rgba(28,28,24,0.24)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${TC.line}` }}>
          <div style={{ ...TT.h4, color: TC.ink, flex: 1 }}>Email{recipient?.name ? ` to ${recipient.name}` : ""}</div>
          <span style={{ ...TT.caption, color: TC.faint }}>Esc</span>
          <button onClick={onClose} aria-label="Close" style={{ ...btn("ghost"), padding: 4 }}><X size={16} strokeWidth={1.5} /></button>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          {!token && (
            <div style={{ ...pill("ember"), display: "block", whiteSpace: "normal", padding: "8px 12px" }}>
              No Gmail token in Settings, so FF Tank cannot send for you yet. Add the OAuth refresh token under Settings → Gmail, or open this in your mail app and log it as "Email I sent" afterwards.
            </div>
          )}
          {blocked && <div data-unsubscribed style={{ ...pill("rust"), display: "block", whiteSpace: "normal", padding: "8px 12px" }}>{to} is unsubscribed. One-to-one email to this address is blocked; a phone call is still fine.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={label}>To</span>
              {contacts.filter(p => p.email).length > 1
                ? <select value={to} onChange={e => { setTo(e.target.value); setBlocked(false); }} style={inputStyle()}>{contacts.filter(p => p.email).map(p => <option key={p.id} value={p.email}>{p.name || p.email} · {p.email}</option>)}</select>
                : <input value={to} onChange={e => { setTo(e.target.value); setBlocked(false); }} placeholder="name@company.com" style={inputStyle()} />}
            </div>
            <div>
              <span style={label}>Template</span>
              <select value={templateId} onChange={e => applyTemplate(e.target.value)} style={inputStyle()}>
                <option value="">Start blank</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <span style={label}>Subject</span>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={inputStyle()} autoFocus />
          </div>
          <div>
            <span style={label}>Message</span>
            <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={10} placeholder="Write it as you would in Gmail. Plain text; your Gmail signature is not added." style={inputStyle({ resize: "vertical", minHeight: 160, fontFamily: "inherit" })}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
          </div>
          {missing.length > 0 && <div style={{ ...pill("ember"), display: "block", whiteSpace: "normal", padding: "6px 10px" }}>Fill in before sending: {missing.map(m => `{{${m}}}`).join(", ")}. {missing.includes("event") && !dealId ? "Compose from the deal to fill {{event}} automatically." : ""}</div>}
          {err && <div style={{ ...pill("rust"), display: "block", whiteSpace: "normal", padding: "6px 10px" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={send} disabled={!canSend || !token} style={btn("primary")} title={token ? "Sends from your Gmail and logs it as sent" : "Needs the Gmail token in Settings"}><Send size={13} strokeWidth={1.5} /> {busy === "send" ? "Sending…" : "Send via Gmail"}</button>
            <button onClick={draft} disabled={!to || !!busy || !token || blocked} style={btn("secondary")} title="Saves a draft in your Gmail; logged as a draft, not as sent"><FileText size={13} strokeWidth={1.5} /> {busy === "draft" ? "Saving…" : "Save as Gmail draft"}</button>
            <a href={blocked ? undefined : mailto} aria-disabled={blocked} style={{ ...btn("ghost"), textDecoration: "none", opacity: blocked ? 0.4 : 1, pointerEvents: blocked ? "none" : "auto" }} title="Opens your mail app; log it as 'Email I sent' afterwards"><ExternalLink size={13} strokeWidth={1.5} /> Open in mail app</a>
            <span style={{ ...TT.caption, color: TC.faint, marginLeft: "auto" }}>⌘↩ sends</span>
          </div>
        </div>
      </div>
    </div>
  );
}
