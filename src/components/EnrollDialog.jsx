// src/components/EnrollDialog.jsx — put one person into a sequence from a record page: pick the
// sequence, see exactly what step 1 will say to them (tokens frozen now), and confirm. Opened by
// the "Enroll in a sequence" action (key s), the command bar and the right-click menu. A contact
// without an address, an unsubscribed one, or one already in a sequence is told why instead.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle, tile } from "../tokens.js";
import { X, ListOrdered } from "lucide-react";
import { db } from "../lib/db.js";
import { listSequences, previewFor, enroll, enrollBlocker, windowLabel } from "../lib/sequences.js";

export default function EnrollDialog({ open, onClose, contacts = [], contactId = null, companyId = null, dealId = null, onEnrolled }) {
  const [seen, setSeen] = useState(false);
  const [sequences, setSequences] = useState([]);
  const [seqId, setSeqId] = useState("");
  const [cid, setCid] = useState(contactId || contacts.find(c => c.email)?.id || "");
  const [company, setCompany] = useState(null);
  const [deal, setDeal] = useState(null);
  const [blocker, setBlocker] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (open && !seen) { setSeen(true); setCid(contactId || contacts.find(c => c.email)?.id || ""); setErr(""); setBlocker(""); }
  if (!open && seen) setSeen(false);

  useEffect(() => {
    if (!open) return;
    Promise.resolve().then(async () => {
      try {
        const [seqs, co, dl] = await Promise.all([
          listSequences(), companyId ? db.select("companies", { id: `eq.${companyId}`, select: "id,name" }) : [], dealId ? db.select("deals", { id: `eq.${dealId}`, select: "id,name" }) : [],
        ]);
        const live = seqs.filter(s => s.status === "active");
        setSequences(live); setSeqId(x => x || live[0]?.id || ""); setCompany(co?.[0] || null); setDeal(dl?.[0] || null);
      } catch (e) { setErr(e.message); }
    });
  }, [open, companyId, dealId]);
  const contact = useMemo(() => contacts.find(c => c.id === cid) || null, [contacts, cid]);
  useEffect(() => {
    if (!open || !contact) return;
    let alive = true;
    enrollBlocker(contact).then(b => { if (alive) setBlocker(b || ""); }).catch(() => {});
    return () => { alive = false; };
  }, [open, contact]);
  useEffect(() => { if (!open) return; const h = e => { if (e.key === "Escape") onClose?.(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [open, onClose]);

  if (!open) return null;
  const seq = sequences.find(s => s.id === seqId) || null;
  const seqWithSteps = seq ? { ...seq, steps: seq.sequence_steps } : null;
  const preview = seqWithSteps && contact ? previewFor(seqWithSteps, { contact, company, deal }) : null;
  const steps = seq?.sequence_steps || [];

  async function go(e) {
    e?.preventDefault(); if (!seq || !contact || blocker || busy) return; setBusy(true); setErr("");
    try { const en = await enroll(seq, { contact, company, deal }); onEnrolled?.({ ...en, sequences: seq }); onClose?.(); }
    catch (e2) { setErr(e2.status === 409 ? "Already in a sequence. Exit that one first." : e2.message); }
    setBusy(false);
  }
  const label = { ...TT.label, marginBottom: 4, display: "block" };
  return (
    <div data-enroll-dialog onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,28,24,0.32)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px" }}>
      <form onSubmit={go} onClick={e => e.stopPropagation()} style={{ ...tile({ padding: 0 }), width: 640, maxWidth: "100%", maxHeight: "88vh", overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${TC.line}` }}>
          <ListOrdered size={16} strokeWidth={1.5} style={{ color: TC.sub }} />
          <div style={{ ...TT.h4, color: TC.ink }}>Enroll in a sequence</div>
          <button type="button" onClick={onClose} style={{ ...btn("ghost"), marginLeft: "auto", padding: 4 }} title="Close (Esc)"><X size={16} strokeWidth={1.5} /></button>
        </div>
        <div style={{ padding: 18, display: "grid", gap: 12 }}>
          {contacts.length > 1 && (
            <div><span style={label}>Who</span><select value={cid} onChange={e => setCid(e.target.value)} style={inputStyle()}>{contacts.map(c => <option key={c.id} value={c.id}>{c.name || "Unnamed"}{c.email ? ` · ${c.email}` : " · no email"}</option>)}</select></div>
          )}
          {contacts.length === 1 && <div style={{ ...TT.body2, color: TC.sub }}>{contact?.name || "This contact"}{contact?.email ? ` · ${contact.email}` : ""}</div>}
          <div>
            <span style={label}>Sequence</span>
            {sequences.length === 0 ? <div style={{ ...TT.body2, color: TC.muted }}>No active sequence yet. Create one under Outreach → Sequences.</div>
              : <select value={seqId} onChange={e => setSeqId(e.target.value)} style={inputStyle()}>{sequences.map(s => <option key={s.id} value={s.id}>{s.name} · {s.sequence_steps.length} step{s.sequence_steps.length === 1 ? "" : "s"}</option>)}</select>}
            {seq && <div style={{ ...TT.caption, color: TC.muted, marginTop: 4 }}>Sends from {seq.sender_email || seq.owner} · {windowLabel(seq)} · up to {seq.daily_cap} a day</div>}
          </div>
          {blocker && <div data-enroll-blocked style={pill("rust")}>{blocker}</div>}
          {deal && <div style={{ ...TT.caption, color: TC.sub }}>Tied to deal <b style={{ fontWeight: 450 }}>{deal.name}</b>: the sequence stops if it books or is lost, and {"{{event}}"} reads "{deal.name}".</div>}
          {steps.length > 0 && (
            <div style={tile({ padding: 12, background: TC.bg })}>
              <div style={{ ...TT.caption, color: TC.muted, marginBottom: 6 }}>Plan for {contact?.name || "this person"}</div>
              {steps.map((s, i) => (
                <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0" }}>
                  <span style={pill(s.kind === "task" ? "sand" : "ocean")}>{s.kind === "task" ? "Task" : "Email"} {i + 1}</span>
                  <span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.kind === "task" ? s.task_title : (i > 0 && s.reply_in_thread ? "Re: (same thread)" : s.subject || "(no subject)")}</span>
                  <span style={{ ...TT.caption, color: TC.muted }}>{i === 0 ? "next run" : `+${s.delay_days} business day${s.delay_days === 1 ? "" : "s"}`}</span>
                </div>
              ))}
            </div>
          )}
          {preview && steps.some(s => s.kind === "email") && (
            <div data-enroll-preview style={tile({ padding: 12, background: TC.bg })}>
              <div style={{ ...TT.caption, color: TC.muted, marginBottom: 4 }}>First email, as they will read it</div>
              <div style={{ ...TT.body2, color: TC.ink, fontWeight: 450 }}>{preview.subject || "(no subject)"}</div>
              <div style={{ ...TT.body2, color: TC.sub, whiteSpace: "pre-wrap", marginTop: 4, maxHeight: 220, overflow: "auto" }}>{preview.body}</div>
              {preview.missing.length > 0 && <div style={{ ...pill("rust"), marginTop: 8 }}>Blank for this person: {preview.missing.map(m => `{{${m}}}`).join(", ")}. Fill the contact in, or pick another sequence.</div>}
            </div>
          )}
          {err && <div style={pill("rust")}>{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" data-enroll-confirm disabled={busy || !seq || !contact || !!blocker || (preview?.missing?.length > 0)} style={btn("primary")}>{busy ? "Enrolling…" : "Enroll"}</button>
            <button type="button" onClick={onClose} style={btn("ghost")}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}
