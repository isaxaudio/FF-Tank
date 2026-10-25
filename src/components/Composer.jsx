// src/components/Composer.jsx — log what happened on a record: a note, a call with its outcome, a
// meeting, an email you sent yourself, or a reply you received. Every log offers a follow-up task
// inline so nothing leaves without a next step. Drafts and Slack handoffs are written by the server
// with their own types; this form never writes email_sent for anything but a confirmed send.
import React, { useEffect, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { StickyNote, Phone, Users, MailCheck, Reply } from "lucide-react";
import { logActivity } from "../lib/activities.js";
import { createTask, plusDays } from "../lib/tasks.js";
import { CALL_OUTCOMES, OUTCOME_LABEL } from "../lib/status.js";
import { onAction } from "../lib/record.js";

const TYPES = [["note", "Note", StickyNote], ["call", "Call", Phone], ["meeting", "Meeting", Users], ["email_sent", "Email I sent", MailCheck], ["email_reply", "Reply received", Reply]];
const PLACEHOLDER = { note: "Add a note…", call: "What happened on the call?", meeting: "What was discussed, what was agreed?", email_sent: "Subject or gist of the email you sent (confirms a real send)", email_reply: "What did they reply?" };

export default function Composer({ companyId = null, contactId = null, dealId = null, contacts = [], onLogged }) {
  const [type, setType] = useState("note");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState(contactId || "");
  const [outcome, setOutcome] = useState("connected");
  const [follow, setFollow] = useState(false);
  const [fuTitle, setFuTitle] = useState("");
  const [fuDue, setFuDue] = useState(plusDays(3));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bodyRef = useRef(null);

  // n / c keys, the command bar and the right-click menu land here: pick the type and focus the text.
  useEffect(() => onAction(({ action }) => {
    const map = { note: "note", call: "call", meeting: "meeting", email: "email_sent", reply: "email_reply" };
    if (!map[action]) return;
    setType(map[action]); setTimeout(() => bodyRef.current?.focus(), 0);
  }), []);

  const who = contacts.find(p => p.id === (contact || contactId));
  function toggleFollow() {
    setFollow(f => { if (!f && !fuTitle) setFuTitle(`Follow up${who?.name ? ` with ${who.name}` : ""}`); return !f; });
  }
  async function submit(e) {
    e.preventDefault(); if (!body.trim() || busy) return; setBusy(true); setErr("");
    try {
      const cid = contact || contactId || null;
      await logActivity({ type, company_id: companyId, contact_id: cid, deal_id: dealId, body: body.trim(), outcome: type === "call" ? outcome : null, direction: type === "email_reply" ? "in" : type === "email_sent" || type === "call" ? "out" : null });
      if (follow && fuTitle.trim()) await createTask({ title: fuTitle.trim(), due_date: fuDue || null, company_id: companyId, contact_id: cid, deal_id: dealId });
      setBody(""); setFollow(false); setFuTitle(""); setFuDue(plusDays(3));
      onLogged?.();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} style={tile({ padding: "12px 16px" })}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {TYPES.map(([id, l, Icon]) => (
          <button key={id} type="button" onClick={() => setType(id)} style={{ ...pill(type === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px" }}><Icon size={12} strokeWidth={1.5} /> {l}</button>
        ))}
        {type === "email_sent" && <span style={{ ...TT.caption, color: TC.warnInk, marginLeft: 6 }}>Only for an email you really sent. Drafts are logged by the drafting tool, not here.</span>}
      </div>
      <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder={PLACEHOLDER[type]} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e); }}
        style={inputStyle({ marginTop: 10, resize: "vertical", minHeight: 48 })} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        {contacts.length > 0 && !contactId && (
          <select value={contact} onChange={e => setContact(e.target.value)} style={inputStyle({ width: 170 })}><option value="">No contact</option>{contacts.map(p => <option key={p.id} value={p.id}>{p.name || p.email || "unnamed"}</option>)}</select>
        )}
        {type === "call" && <select value={outcome} onChange={e => setOutcome(e.target.value)} title="Call outcome" style={inputStyle({ width: 140 })}>{CALL_OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}</select>}
        <label style={{ ...TT.body2, color: TC.sub, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={follow} onChange={toggleFollow} /> Create follow-up task
        </label>
        {follow && <>
          <input value={fuTitle} onChange={e => setFuTitle(e.target.value)} placeholder="Task" style={inputStyle({ width: 220 })} />
          <input type="date" value={fuDue} onChange={e => setFuDue(e.target.value)} style={inputStyle({ width: 150 })} />
        </>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ ...TT.caption, color: TC.faint }}>⌘↩</span>
          <button type="submit" disabled={busy || !body.trim()} style={btn("primary")}>{busy ? "Saving…" : "Log"}</button>
        </div>
      </div>
      {err && <div style={{ ...pill("rust"), marginTop: 8 }}>{err}</div>}
    </form>
  );
}
