// src/screens/Templates.jsx — email templates: a name, a subject and a body with tokens that the
// composer fills from the record ({{first_name}}, {{company}}, {{event}}, {{sender_first_name}}…).
// One-to-one templates are picked in the composer; sequence and campaign kinds wait for steps 6 and 7.
// Archiving hides a template from the picker without losing the messages that used it.
import React, { useEffect, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Plus, Archive, ArchiveRestore } from "lucide-react";
import { listTemplates, createTemplate, updateTemplate, archiveTemplate, TOKENS, SAMPLE, render, senderNames } from "../lib/email.js";
import { ago } from "../lib/status.js";

const KIND = { one_to_one: "One-to-one", sequence: "Sequence step", campaign: "Campaign" };
const KIND_TONE = { one_to_one: "ocean", sequence: "iris", campaign: "tropic" };
const label = { ...TT.label, marginBottom: 4, display: "block" };
const th = { ...TT.tableHead, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${TC.line}`, background: TC.bg };
const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "9px 10px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "top" };

export default function Templates() {
  const [rows, setRows] = useState([]);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | template row
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try { setRows((await listTemplates({ archived })) || []); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, [archived]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ ...TT.h4, color: TC.ink }}>Templates</div>
          <span style={{ ...TT.caption, color: TC.muted }}>Picked in the email composer on any record. Tokens fill from the record.</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => setArchived(a => !a)} style={btn("ghost")}>{archived ? "Show active" : "Show archived"}</button>
            <button data-new-template onClick={() => setEditing("new")} style={btn("primary")}><Plus size={13} strokeWidth={1.5} /> New template</button>
          </div>
        </div>
        {err && <div style={{ ...pill("rust"), marginBottom: 10 }}>{err}</div>}
        {loading ? <div style={{ ...TT.body2, color: TC.muted }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ ...TT.body2, color: TC.muted }}>{archived ? "Nothing archived." : "No templates yet. The first one you write shows up in the composer's Template menu."}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Subject</th><th style={th}>Kind</th><th style={th}>Owner</th><th style={th}>Updated</th><th style={th}></th></tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id} className="ff-row" data-template={t.name} onClick={() => setEditing(t)} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 450 }}>{t.name}</td>
                  <td style={{ ...td, color: TC.sub, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</td>
                  <td style={td}><span style={pill(KIND_TONE[t.kind] || "sand")}>{KIND[t.kind] || t.kind}</span></td>
                  <td style={{ ...td, color: TC.sub }}>{t.owner || "—"}</td>
                  <td style={{ ...td, color: TC.muted }}>{ago(t.updated_at || t.created_at)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button onClick={async e => { e.stopPropagation(); await archiveTemplate(t.id, !archived); load(); }} style={{ ...btn("ghost"), padding: "2px 6px" }} title={archived ? "Restore" : "Archive"}>{archived ? <ArchiveRestore size={14} strokeWidth={1.5} /> : <Archive size={14} strokeWidth={1.5} />}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <Editor template={editing === "new" ? null : editing} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function Editor({ template, onDone, onCancel }) {
  const [name, setName] = useState(template?.name || "");
  const [kind, setKind] = useState(template?.kind || "one_to_one");
  const [subject, setSubject] = useState(template?.subject || "");
  const [body, setBody] = useState(template?.body || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bodyRef = useRef(null);
  const sample = { ...SAMPLE, ...senderNames() };

  function insert(token) {
    const el = bodyRef.current; const tag = `{{${token}}}`;
    if (!el) { setBody(b => b + tag); return; }
    const s = el.selectionStart ?? body.length, e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + tag + body.slice(e));
    setTimeout(() => { el.focus(); el.setSelectionRange(s + tag.length, s + tag.length); }, 0);
  }
  async function save(e) {
    e.preventDefault(); if (!name.trim() || busy) return; setBusy(true); setErr("");
    try {
      if (template) await updateTemplate(template.id, { name: name.trim(), kind, subject, body }); else await createTemplate({ name, kind, subject, body });
      onDone?.();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  return (
    <form data-template-editor onSubmit={save} style={{ width: 460, flexShrink: 0, borderLeft: `1px solid ${TC.line}`, background: TC.card, overflow: "auto", padding: 20, display: "grid", gap: 12, alignContent: "start" }}>
      <div style={{ ...TT.h4, color: TC.ink }}>{template ? "Edit template" : "New template"}</div>
      <div><span style={label}>Name</span><input value={name} onChange={e => setName(e.target.value)} placeholder="Intro after a show" style={inputStyle()} autoFocus /></div>
      <div><span style={label}>Kind</span><select value={kind} onChange={e => setKind(e.target.value)} style={inputStyle()}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div><span style={label}>Subject</span><input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Good to meet you at {{event}}" style={inputStyle()} /></div>
      <div>
        <span style={label}>Body</span>
        <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={10} style={inputStyle({ resize: "vertical", minHeight: 160, fontFamily: "inherit" })} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
          {TOKENS.map(([k, d]) => <button key={k} type="button" onClick={() => insert(k)} title={d} style={{ ...pill("outline"), cursor: "pointer" }}>{`{{${k}}}`}</button>)}
        </div>
      </div>
      <div style={tile({ padding: 12, background: TC.bg })}>
        <div style={{ ...TT.caption, color: TC.muted, marginBottom: 4 }}>Preview with sample values</div>
        <div style={{ ...TT.body2, color: TC.ink, fontWeight: 450 }}>{render(subject, sample) || "(no subject)"}</div>
        <div style={{ ...TT.body2, color: TC.sub, whiteSpace: "pre-wrap", marginTop: 4 }}>{render(body, sample)}</div>
      </div>
      {err && <div style={pill("rust")}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy || !name.trim()} style={btn("primary")}>{busy ? "Saving…" : template ? "Save" : "Create"}</button>
        <button type="button" onClick={onCancel} style={btn("ghost")}>Cancel</button>
      </div>
    </form>
  );
}
