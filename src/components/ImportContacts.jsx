// src/components/ImportContacts.jsx — People → Import. Upload a CSV or paste rows from a spreadsheet, check how each
// column maps, see what will happen to every row (new, fill blanks on an existing contact, already there, skipped),
// then import. Afterwards the batch can go straight into a campaign or sequence, or be undone. Rules live in
// src/lib/importContacts.js (test/import-contacts.test.mjs).
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Upload, X } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { LEAD_STATUS, LEAD_STATUS_LABEL } from "../lib/status.js";
import { FIELDS, MAX_ROWS, parseTable, guessMapping, planImport, loadLookups, readRows, runImport } from "../lib/importContacts.js";

const label = { ...TT.label, marginBottom: 6, display: "block" };
const ACTION = { create: ["New contact", "evergreen"], update: ["Fills blanks", "ocean"], same: ["Already there", "outline"], skip: ["Skipped", "rust"] };
const HOW = { name: "matched by name", domain: "matched by email domain", new: "new company", kept: "keeps current company" };
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

export default function ImportContacts({ owners = [], campaigns = [], sequences = [], onClose, onImported, onAddToCampaign, onEnroll }) {
  const me = auth.user()?.email || "";
  const [table, setTable] = useState(null);
  const [paste, setPaste] = useState("");
  const [batch, setBatch] = useState("");
  const [mapping, setMapping] = useState({});
  const [owner, setOwner] = useState(me);
  const [leadStatus, setLeadStatus] = useState("new");
  const [optedIn, setOptedIn] = useState(false);
  const [createCompanies, setCreateCompanies] = useState(true);
  const [lookups, setLookups] = useState(null);
  const [lookupKey, setLookupKey] = useState("");
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState("all");

  function load(text, name) {
    setErr(""); setResult(null);
    const t = parseTable(text);
    if (!t.headers.length || !t.rows.length) { setErr("No rows found. The first row should be the column names, with one person per row below it."); return; }
    if (t.rows.length > MAX_ROWS) { setErr(`That's ${t.rows.length.toLocaleString()} rows; import up to ${MAX_ROWS.toLocaleString()} at a time.`); return; }
    setTable(t); setMapping(guessMapping(t.headers)); setLookups(null); setLookupKey("");
    setBatch(name || `Pasted list ${new Date().toISOString().slice(0, 10)}`);
  }
  function onFile(e) {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { setErr("Excel files can't be read directly. In Excel or Google Sheets use File → Download/Save as → CSV, or copy the cells and paste them below."); return; }
    f.text().then(text => load(text, f.name)).catch(() => setErr("Couldn't read that file."));
  }

  // Existing contacts, unsubscribes and companies are read for the emails in the file whenever the email column changes.
  const emailCol = Object.keys(mapping).find(k => mapping[k] === "email");
  const emails = useMemo(() => (table && emailCol != null ? readRows(table, mapping).map(r => r.email) : []), [table, mapping, emailCol]);
  const key = table && emailCol != null ? `${emailCol}:${emails.length}:${emails[0] || ""}` : "";
  useEffect(() => {
    if (!key || key === lookupKey) return;
    let live = true;
    Promise.resolve().then(() => { if (live) { setBusy("Checking against FF Tank…"); setErr(""); } });
    loadLookups(db, emails).then(l => { if (live) { setLookups(l); setLookupKey(key); } }).catch(e => live && setErr(e.message)).finally(() => live && setBusy(""));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => (table && lookups && key === lookupKey ? planImport(table, mapping, lookups, { createCompanies }) : null), [table, mapping, lookups, key, lookupKey, createCompanies]);
  const writes = plan ? plan.totals.create + plan.totals.update : 0;

  async function go() {
    if (!plan || !writes || busy) return;
    setBusy("Importing…"); setErr("");
    try {
      const r = await runImport(db, plan, { owner: owner || null, leadStatus, optedIn, label: batch.trim(), actor: me || "user", onProgress: (d, n) => setBusy(`Importing… ${d.toLocaleString()} of ${n.toLocaleString()}`) });
      const touchedIds = [...r.created.map(c => c.id), ...r.updated.map(u => u.id)];
      const rows = touchedIds.length ? (await db.selectAll("contacts", { id: `in.(${touchedIds.join(",")})`, select: "id,name,email,company_id,owner,lead_status,marketing_status,companies(id,name,domain)" }).catch(() => [])) : [];
      setResult({ ...r, rows }); onImported?.();
    } catch (e) { setErr(`Import stopped: ${e.message}. Anything already saved is listed under Recently added.`); }
    setBusy("");
  }
  async function undo() {
    setBusy("Undoing…");
    try { await result.undo(); setResult(null); onImported?.(); setErr(""); setTable(null); }
    catch (e) { setErr(`Undo failed: ${e.message}`); }
    setBusy("");
  }

  const input = inputStyle();
  const shown = plan ? plan.items.filter(i => filter === "all" || i.action === filter).slice(0, 200) : [];

  return (
    <div data-import-contacts style={{ ...tile({ marginBottom: 12 }), display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...TT.titleSm, color: TC.ink }}>Import contacts</div>
        <div style={{ ...TT.caption, color: TC.muted }}>CSV file, or copy cells from Google Sheets or Excel and paste them</div>
        <button type="button" onClick={onClose} aria-label="Close import" style={{ ...btn("tertiary"), marginLeft: "auto", padding: 4 }}><X size={16} strokeWidth={1.5} /></button>
      </div>

      {result ? (
        <div data-import-result style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...TT.body1Med, color: TC.ink }}>
            {plural(result.created.length, "contact")} added{result.updated.length ? `, ${result.updated.length.toLocaleString()} existing filled in` : ""}{result.companies.length ? `, ${plural(result.companies.length, "company")} created` : ""}.
          </div>
          {result.failed.length > 0 && <div style={{ ...TT.caption, color: TC.critical }}>{plural(result.failed.length, "row")} not saved: {result.failed.slice(0, 5).map(f => `line ${f.line} ${f.email} (${f.reason})`).join("; ")}{result.failed.length > 5 ? "…" : ""}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {campaigns.length > 0 && result.rows.length > 0 && <select data-import-campaign style={inputStyle({ width: 220, padding: "4px 8px" })} value="" onChange={e => e.target.value && onAddToCampaign?.(e.target.value, result.rows)} aria-label="Add these to a campaign"><option value="">Add these to a campaign…</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            {sequences.length > 0 && result.rows.length > 0 && <select data-import-sequence style={inputStyle({ width: 220, padding: "4px 8px" })} value="" onChange={e => e.target.value && onEnroll?.(e.target.value, result.rows)} aria-label="Enroll these in a sequence"><option value="">Enroll these in a sequence…</option>{sequences.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
            <button type="button" data-import-undo disabled={!!busy} onClick={undo} style={btn("secondary")} title="Removes the contacts and companies this import created and clears the fields it filled">{busy === "Undoing…" ? busy : "Undo import"}</button>
            <button type="button" onClick={onClose} style={btn("primary")}>Done</button>
          </div>
          <div style={{ ...TT.caption, color: TC.muted }}>They're tagged with source "import · {batch.trim() || "no batch name"}" and show under Recently added.</div>
        </div>
      ) : !table ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ ...btn("secondary"), alignSelf: "flex-start" }}><Upload size={16} strokeWidth={1.5} /> Choose CSV file<input data-import-file type="file" accept=".csv,.tsv,.txt,text/csv,text/plain,.xlsx,.xls" onChange={onFile} style={{ display: "none" }} /></label>
          <div><span style={label}>Or paste rows (first row = column names)</span>
            <textarea data-import-paste value={paste} onChange={e => setPaste(e.target.value)} rows={6} placeholder={"Name\tEmail\tCompany\tTitle\nJane Doe\tjane@school.edu\tState University\tEvents Director"} style={{ ...input, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, resize: "vertical" }} /></div>
          <button type="button" data-import-read disabled={!paste.trim()} onClick={() => load(paste)} style={{ ...btn("primary"), alignSelf: "flex-start" }}>Read rows</button>
        </div>
      ) : (
        <>
          <div>
            <span style={label}>{plural(table.rows.length, "row")} · match each column</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {table.headers.map((h, i) => (
                <div key={i} style={{ border: `1px solid ${TC.line}`, borderRadius: 8, padding: 8 }}>
                  <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h}>{h}</div>
                  <div style={{ ...TT.caption, color: TC.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 6 }}>{table.rows.find(r => r[i])?.[i] || "empty"}</div>
                  <select data-import-map={i} value={mapping[i] || ""} onChange={e => setMapping(m => ({ ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === e.target.value && e.target.value ? "" : v])), [i]: e.target.value }))} style={inputStyle({ padding: "2px 6px", fontSize: 13 })}>
                    {FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {emailCol == null && <div style={{ ...pill("warn"), marginTop: 8 }}>Pick the Email column: people are matched and de-duplicated by email.</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            <div><span style={label}>Batch name</span><input data-import-batch style={input} value={batch} onChange={e => setBatch(e.target.value)} placeholder="e.g. NACA 2026 booth scans" /></div>
            <div><span style={label}>Owner of new contacts</span><select data-import-owner style={input} value={owner} onChange={e => setOwner(e.target.value)}><option value="">No owner</option>{[...new Set([me, ...owners].filter(Boolean))].map(o => <option key={o} value={o}>{o.split("@")[0]}</option>)}</select></div>
            <div><span style={label}>Lead status</span><select style={input} value={leadStatus} onChange={e => setLeadStatus(e.target.value)}>{LEAD_STATUS.map(k => <option key={k} value={k}>{LEAD_STATUS_LABEL[k]}</option>)}</select></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ ...TT.body2, color: TC.ink, display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={createCompanies} onChange={e => setCreateCompanies(e.target.checked)} /> Create companies that aren't in FF Tank yet</label>
            <label style={{ ...TT.body2, color: TC.ink, display: "flex", gap: 8, alignItems: "flex-start" }}><input data-import-optin type="checkbox" checked={optedIn} onChange={e => setOptedIn(e.target.checked)} style={{ marginTop: 3 }} />
              <span>These people opted in to marketing email<span style={{ ...TT.caption, color: TC.muted, display: "block" }}>Tick only for a sign-up list or booth scans where they agreed. Bought or scraped lists stay unchecked: they can still get one-to-one emails and sequences, but not newsletters. Anyone who unsubscribed stays unsubscribed.</span></span></label>
          </div>

          {plan && (
            <div data-import-preview style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {[["all", `All ${plan.totals.rows.toLocaleString()}`, "outline"], ["create", `${plan.totals.create.toLocaleString()} new`, "evergreen"], ["update", `${plan.totals.update.toLocaleString()} fill blanks`, "ocean"], ["same", `${plan.totals.same.toLocaleString()} already there`, "outline"], ["skip", `${plan.totals.skip.toLocaleString()} skipped`, "rust"]].map(([k, l, tone]) => (
                  <button key={k} type="button" data-import-filter={k} onClick={() => setFilter(k)} style={{ ...pill(tone), cursor: "pointer", outline: filter === k ? `2px solid ${TC.ink}` : "none", border: "none" }}>{l}</button>
                ))}
                {plan.totals.newCompanies > 0 && <span style={{ ...TT.caption, color: TC.muted }}>{plural(plan.totals.newCompanies, "new company")}</span>}
                {plan.totals.unsubscribed > 0 && <span style={{ ...TT.caption, color: TC.muted }}>· {plan.totals.unsubscribed.toLocaleString()} unsubscribed, kept that way</span>}
              </div>
              <div style={{ maxHeight: 320, overflow: "auto", border: `1px solid ${TC.line}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", ...TT.body2 }}>
                  <thead><tr style={{ position: "sticky", top: 0, background: TC.card }}>{["Line", "Email", "Name", "Title", "Company", "Result"].map(h => <th key={h} style={{ ...TT.label, textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${TC.line}` }}>{h}</th>)}</tr></thead>
                  <tbody>{shown.map(it => (
                    <tr key={it.line} data-import-row={it.action}>
                      <td style={{ padding: "4px 8px", color: TC.muted }}>{it.line}</td>
                      <td style={{ padding: "4px 8px", color: TC.ink }}>{it.email || <span style={{ color: TC.faint }}>—</span>}</td>
                      <td style={{ padding: "4px 8px" }}>{it.name || <span style={{ color: TC.faint }}>—</span>}</td>
                      <td style={{ padding: "4px 8px" }}>{it.title || ""}</td>
                      <td style={{ padding: "4px 8px" }}>{it.company ? <>{it.company.name || it.company.how === "kept" && "(current)"} <span style={{ ...TT.caption, color: TC.muted }}>{HOW[it.company.how]}</span></> : <span style={{ color: TC.faint }}>{it.action === "skip" ? "" : "none"}</span>}</td>
                      <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}><span style={pill(ACTION[it.action][1])}>{ACTION[it.action][0]}</span>{it.reason && <span style={{ ...TT.caption, color: TC.muted, marginLeft: 6 }}>{it.reason}</span>}{it.action === "update" && <span style={{ ...TT.caption, color: TC.muted, marginLeft: 6 }}>{Object.keys(it.fill).join(", ")}</span>}{it.unsubscribed && it.action !== "skip" && <span style={{ ...TT.caption, color: TC.critical, marginLeft: 6 }}>unsubscribed</span>}</td>
                    </tr>))}</tbody>
                </table>
                {plan.items.filter(i => filter === "all" || i.action === filter).length > shown.length && <div style={{ ...TT.caption, color: TC.muted, padding: 8 }}>Showing the first {shown.length}.</div>}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" data-import-go disabled={!plan || !writes || !!busy} onClick={go} style={btn("primary")}>{busy || (plan ? (writes ? `Import ${plural(writes, "contact")}` : "Nothing new to import") : "Import")}</button>
            <button type="button" disabled={!!busy} onClick={() => { setTable(null); setLookups(null); setErr(""); }} style={btn("secondary")}>Start over</button>
          </div>
        </>
      )}
      {busy && !result && !table && <div style={{ ...TT.caption, color: TC.muted }}>{busy}</div>}
      {err && <div style={pill("rust")}>{err}</div>}
    </div>
  );
}
