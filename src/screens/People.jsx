// src/screens/People.jsx — contacts: a list with saved views, selection and a preview pane, and the
// contact record page (summary left, composer + focus + history centre). Marketing status and its
// consent stay separate from lead status and lifecycle.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Search, Plus, User, Building2, ExternalLink } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { logActivity } from "../lib/activities.js";
import { LIFECYCLE, LIFECYCLE_LABEL, LIFECYCLE_TONE, LEAD_STATUS, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, CONSENT_SOURCES, CONSENT_LABEL, CAMPAIGN_KIND_LABEL, CAMPAIGN_KIND_TONE, DEAL_ROLE_LABEL, ago } from "../lib/status.js";
import { STAGE_LABEL, STAGE_TONE } from "../lib/deals.js";
import { listCampaigns } from "../lib/campaigns.js";
import { bulkPatch, bulkAddToCampaign } from "../lib/bulk.js";
import { usePersonalViews, within } from "../lib/views.js";
import { setRecord, clearRecord, baseActions } from "../lib/record.js";
import { ListTable, ViewTabs, BulkBar, barBtn, barSelect, Toast, PreviewPane, usePreview, useSelection, Facet } from "../components/ListTable.jsx";
import { RecordLayout, RecordHeader, Card, Prop, Empty } from "../components/RecordPage.jsx";
import InlineField from "../components/InlineField.jsx";
import Timeline from "../components/Timeline.jsx";
import CompanyPicker from "../components/CompanyPicker.jsx";

const MKT = ["unknown", "subscribed", "unsubscribed"];
const MKT_TONE = { subscribed: "evergreen", unsubscribed: "rust", unknown: "outline" };
const me = () => auth.user()?.email || "";
const day = d => (d ? String(d).slice(0, 10) : "—");
const opts = (keys, labels) => keys.map(k => ({ value: k, label: labels ? labels[k] : k }));
const label = { ...TT.label, marginBottom: 6, display: "block" };

const DEFAULT = { q: "", owner: "all", lead: "all", lifecycle: "all", mkt: "all", added: "all" };
const BUILTIN = [
  { id: "all", label: "All", state: {} },
  { id: "mine", label: "My contacts", state: { owner: "me" } },
  { id: "noowner", label: "No owner", state: { owner: "none" } },
  { id: "unsub", label: "Unsubscribed", state: { mkt: "unsubscribed" } },
  { id: "recent", label: "Recently added", state: { added: "30" } },
];
const SELECT = "id,name,title,email,phone,linkedin,company_id,lead_status,lifecycle_stage,marketing_status,owner,last_touch_at,source,source_detail,created_at,companies(id,name,lifecycle_stage)";

function matches(r, s) {
  const q = s.q.trim().toLowerCase();
  if (q && !["name", "email", "title"].some(k => (r[k] || "").toLowerCase().includes(q)) && !(r.companies?.name || "").toLowerCase().includes(q)) return false;
  if (s.owner === "me" ? r.owner !== me() : s.owner === "none" ? !!r.owner : s.owner !== "all" && r.owner !== s.owner) return false;
  if (s.lead !== "all" && (r.lead_status || "new") !== s.lead) return false;
  if (s.lifecycle !== "all" && (r.lifecycle_stage || "prospect") !== s.lifecycle) return false;
  if (s.mkt !== "all" && (r.marketing_status || "unknown") !== s.mkt) return false;
  if (s.added !== "all" && !within(r.created_at, Number(s.added))) return false;
  return true;
}

function useCampaignOptions() {
  const [rows, setRows] = useState([]);
  useEffect(() => { Promise.resolve().then(async () => { try { setRows(await listCampaigns({ status: "in.(planned,active)" })); } catch { setRows([]); } }); }, []);
  return rows;
}

export default function People({ initialContactId = null, initialNew = false, onNavigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [state, setState] = useState({ ...DEFAULT });
  const [openId, setOpenId] = useState(initialContactId);
  const [showNew, setShowNew] = useState(!!initialNew);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const personal = usePersonalViews("people");
  const campaigns = useCampaignOptions();

  async function load() {
    setLoading(true); setErr("");
    try { setRows((await db.selectAll("contacts", { select: SELECT, merged_into_id: "is.null", order: "name.asc.nullslast" })) || []); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, []);

  const visible = useMemo(() => rows.filter(r => matches(r, state)), [rows, state]);
  const counts = useMemo(() => Object.fromEntries(BUILTIN.map(v => [v.id, rows.filter(r => matches(r, { ...DEFAULT, ...v.state })).length])), [rows]);
  const owners = useMemo(() => [...new Set(rows.map(r => r.owner).filter(Boolean))].sort(), [rows]);
  const sel = useSelection(visible);
  const preview = usePreview(visible);
  const set = k => v => setState(s => ({ ...s, [k]: v }));

  async function act(msg, fn) {
    setBusy(true);
    try { const undo = await fn(); await load(); sel.clear(); setToast({ msg, undo: undo ? async () => { await undo(); await load(); } : null }); }
    catch (e) { setToast({ msg: `Failed: ${e.message}` }); }
    setBusy(false);
  }
  const n = sel.count;
  const addTo = async cid => {
    const cp = campaigns.find(c => c.id === cid); if (!cp) return;
    await act(`Added to ${cp.name}`, async () => { const r = await bulkAddToCampaign(cid, sel.selectedRows, "contact_id"); setToast(null); return r.undo; });
  };

  if (openId) return <ContactPage key={openId} id={openId} onBack={() => setOpenId(null)} onNavigate={onNavigate} onChanged={load} />;

  const cols = [
    { key: "name", label: "Name", width: 220, name: true, render: r => r.name || <span style={{ color: TC.muted }}>unnamed</span> },
    { key: "company", label: "Company", width: 180, render: r => r.companies ? <span onClick={e => { e.stopPropagation(); onNavigate?.("companies", { companyId: r.companies.id }); }} style={{ cursor: "pointer", color: TC.link }}>{r.companies.name}</span> : <span style={{ color: TC.faint }}>—</span> },
    { key: "title", label: "Title", width: 170 },
    { key: "email", label: "Email", width: 210 },
    { key: "lead_status", label: "Lead status", width: 120, render: r => <span style={pill(LEAD_STATUS_TONE[r.lead_status] || "sand")}>{LEAD_STATUS_LABEL[r.lead_status] || "New"}</span> },
    { key: "lifecycle_stage", label: "Lifecycle", width: 110, render: r => <span style={pill(LIFECYCLE_TONE[r.lifecycle_stage] || "ocean")}>{LIFECYCLE_LABEL[r.lifecycle_stage] || "Prospect"}</span> },
    { key: "marketing_status", label: "Marketing", width: 120, render: r => <span style={pill(MKT_TONE[r.marketing_status] || "outline")}>{r.marketing_status || "unknown"}</span> },
    { key: "owner", label: "Owner", width: 170, render: r => r.owner || <span style={{ color: TC.faint }}>unassigned</span> },
    { key: "last_touch_at", label: "Last touch", width: 100, render: r => <span style={{ color: r.last_touch_at ? TC.ink : TC.faint }}>{r.last_touch_at ? ago(r.last_touch_at) : "never"}</span> },
    { key: "created_at", label: "Added", width: 100, render: r => day(r.created_at) },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: "16px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div><div style={{ ...TT.h3, color: TC.ink }}>People</div><div style={{ ...TT.caption, color: TC.muted }}>{rows.length.toLocaleString()} contacts · {visible.length.toLocaleString()} in this view</div></div>
          <button onClick={() => setShowNew(s => !s)} style={{ ...btn("primary"), marginLeft: "auto" }}><Plus size={16} strokeWidth={1.5} /> Contact</button>
        </div>
        <div style={{ marginTop: 10 }}>
          <ViewTabs builtin={BUILTIN} personal={personal.views} state={state} counts={counts} onPick={v => setState({ ...DEFAULT, ...v.state })} onSave={name => personal.save(name, state)} onRemove={personal.remove} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 260 }}><Search size={16} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 8, color: TC.sub }} /><input value={state.q} onChange={e => set("q")(e.target.value)} placeholder="Search name, email, title, company" style={inputStyle({ paddingLeft: 32, padding: "4px 8px 4px 32px" })} /></div>
          <Facet value={state.owner} onChange={set("owner")} options={[["all", "Any owner"], ["me", "Mine"], ["none", "No owner"], ...owners.map(o => [o, o])]} />
          <Facet value={state.lead} onChange={set("lead")} options={[["all", "Any lead status"], ...LEAD_STATUS.map(k => [k, LEAD_STATUS_LABEL[k]])]} />
          <Facet value={state.lifecycle} onChange={set("lifecycle")} options={[["all", "Any lifecycle"], ...LIFECYCLE.map(k => [k, LIFECYCLE_LABEL[k]])]} />
          <Facet value={state.mkt} onChange={set("mkt")} options={[["all", "Any marketing"], ...MKT.map(k => [k, k])]} width={140} />
          <Facet value={state.added} onChange={set("added")} options={[["all", "Added any time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]]} width={140} />
          {JSON.stringify(state) !== JSON.stringify(DEFAULT) && <button onClick={() => setState({ ...DEFAULT })} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.sub }}>Reset</button>}
        </div>
        {err && <div style={{ ...pill("rust"), marginTop: 10 }}>{err}</div>}
        {showNew && <div style={{ marginTop: 12 }}><NewContactForm onDone={c => { setShowNew(false); load().then(() => c?.id && setOpenId(c.id)); }} onCancel={() => setShowNew(false)} /></div>}
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0, padding: "12px 24px 24px", gap: 0 }}>
        <ListTable rows={visible} columns={cols} sel={sel} activeId={preview.id} loading={loading} onRow={preview.show} onOpen={r => setOpenId(r.id)}
          empty={rows.length === 0 ? "No contacts yet. Add the first one, or capture one on a company page." : "No contact matches this view."} />
        {preview.row && (
          <PreviewPane index={preview.index} total={preview.total} onPrev={preview.prev} onNext={preview.next} onClose={preview.close} onOpen={() => setOpenId(preview.row.id)}
            title={preview.row.name || "Unnamed"} subtitle={[preview.row.title, preview.row.companies?.name].filter(Boolean).join(" · ")}
            pills={<><span style={pill(LEAD_STATUS_TONE[preview.row.lead_status] || "sand")}>{LEAD_STATUS_LABEL[preview.row.lead_status] || "New"}</span><span style={pill(LIFECYCLE_TONE[preview.row.lifecycle_stage] || "ocean")}>{LIFECYCLE_LABEL[preview.row.lifecycle_stage] || "Prospect"}</span><span style={pill(MKT_TONE[preview.row.marketing_status] || "outline")}>{preview.row.marketing_status || "unknown"}</span></>}>
            <Prop label="Email">{preview.row.email || "—"}</Prop>
            <Prop label="Phone">{preview.row.phone || "—"}</Prop>
            <Prop label="Owner">{preview.row.owner || "unassigned"}</Prop>
            <Prop label="Last touch">{preview.row.last_touch_at ? `${ago(preview.row.last_touch_at)} · ${day(preview.row.last_touch_at)}` : "never"}</Prop>
            <Prop label="Source">{[preview.row.source, preview.row.source_detail].filter(Boolean).join(" · ") || "—"}</Prop>
            <Prop label="Added" last>{day(preview.row.created_at)}</Prop>
          </PreviewPane>
        )}
      </div>
      <BulkBar count={n} onClear={sel.clear} busy={busy}>
        <button style={barBtn} onClick={() => act(`${n} assigned to you`, () => bulkPatch("contacts", sel.selectedRows, { owner: me() }))}>Assign to me</button>
        <button style={barBtn} onClick={() => act(`Owner cleared on ${n}`, () => bulkPatch("contacts", sel.selectedRows, { owner: null }))}>Clear owner</button>
        <select style={barSelect} value="" onChange={e => e.target.value && act(`${n} set to ${LEAD_STATUS_LABEL[e.target.value]}`, () => bulkPatch("contacts", sel.selectedRows, { lead_status: e.target.value }))}><option value="">Lead status…</option>{LEAD_STATUS.map(k => <option key={k} value={k}>{LEAD_STATUS_LABEL[k]}</option>)}</select>
        <button style={barBtn} title="Subscribing needs consent per person, so only unsubscribe is offered in bulk" onClick={() => act(`${n} marked unsubscribed`, () => bulkPatch("contacts", sel.selectedRows, { marketing_status: "unsubscribed" }))}>Mark unsubscribed</button>
        {campaigns.length > 0 && <select style={barSelect} value="" onChange={e => addTo(e.target.value)}><option value="">Add to campaign…</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </BulkBar>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function ContactPage({ id, onBack, onNavigate, onChanged }) {
  const [p, setP] = useState(null);
  const [deals, setDeals] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [moving, setMoving] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try {
      const [rows, dc, mems] = await Promise.all([
        db.select("contacts", { id: `eq.${id}`, select: "*,companies(id,name,lifecycle_stage,domain)" }),
        db.select("deal_contacts", { contact_id: `eq.${id}`, select: "id,role,is_primary,deals(id,name,stage,probability,amount_estimate,next_action_due,last_touch_at)" }),
        db.select("campaign_members", { contact_id: `eq.${id}`, select: "id,status,responded,added_at,campaigns(id,name,kind)", order: "added_at.desc" }),
      ]);
      setP(rows?.[0] || null); setDeals(dc || []); setMemberships(mems || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Publish this record for the command bar, the n / t / c keys and the right-click menu.
  useEffect(() => {
    if (!p) return;
    setRecord({ id, type: "contact", title: p.name || "Unnamed", actions: [...baseActions({ email: p.email }), ...(p.companies ? [{ id: "company", label: `Open ${p.companies.name}`, run: () => onNavigate?.("companies", { companyId: p.companies.id }) }] : [])] });
    return () => clearRecord(id);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(fields) {
    await db.update("contacts", id, { ...fields, updated_at: new Date().toISOString() });
    await load(); onChanged?.();
  }
  const setMarketing = v => patch(v === "subscribed" && !p.consent_at ? { marketing_status: v, consent_at: new Date().toISOString(), consent_source: p.consent_source || "other" } : { marketing_status: v });
  async function moveTo(co) { if (!co) return; await patch({ company_id: co.id }); setMoving(false); }

  if (err) return <div style={{ padding: 32 }}><span style={pill("rust")}>{err}</span></div>;
  if (!p) return <div style={{ padding: 32, color: TC.muted }}>Loading…</div>;
  const link = (href, text) => <a href={href} target="_blank" rel="noreferrer" style={{ color: TC.link, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>{text} <ExternalLink size={11} strokeWidth={1.5} /></a>;

  return (
    <RecordLayout
      header={<RecordHeader onBack={onBack} backLabel="People" icon={User}
        title={<InlineField value={p.name} onSave={v => patch({ name: v })} placeholder="Unnamed" render={v => <span style={{ ...TT.h2 }}>{v || "Unnamed"}</span>} style={{ padding: "2px 6px", margin: "-2px -6px" }} />}
        subtitle={<>{p.title && <span>{p.title}</span>}{p.title && p.companies && <span>·</span>}{p.companies && <span onClick={() => onNavigate?.("companies", { companyId: p.companies.id })} style={{ color: TC.link, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><Building2 size={13} strokeWidth={1.5} /> {p.companies.name}</span>}</>}
        pills={<>
          <InlineField compact value={p.lead_status || "new"} options={opts(LEAD_STATUS, LEAD_STATUS_LABEL)} onSave={v => patch({ lead_status: v })} render={v => <span style={pill(LEAD_STATUS_TONE[v] || "sand")}>{LEAD_STATUS_LABEL[v] || "New"}</span>} title="Lead status: where outreach stands. Click to change." />
          <InlineField compact value={p.lifecycle_stage || "prospect"} options={opts(LIFECYCLE, LIFECYCLE_LABEL)} onSave={v => patch({ lifecycle_stage: v })} render={v => <span style={pill(LIFECYCLE_TONE[v] || "ocean")}>{LIFECYCLE_LABEL[v] || "Prospect"}</span>} title="Lifecycle. Click to change." />
          <InlineField compact value={p.marketing_status || "unknown"} options={opts(MKT)} onSave={setMarketing} render={v => <span style={pill(MKT_TONE[v] || "outline")}>{v || "unknown"}</span>} title="Marketing subscription, separate from CRM status. Click to change." />
        </>}
        meta={<><span>Owner: <b style={{ fontWeight: 450, color: TC.sub }}>{p.owner || "unassigned"}</b></span><span>Last touch: <b style={{ fontWeight: 450, color: p.last_touch_at ? TC.sub : TC.faint }}>{p.last_touch_at ? `${ago(p.last_touch_at)} (${day(p.last_touch_at)})` : "never"}</b></span><span>Added {day(p.created_at)}</span></>}
      />}
      left={<>
        <Card title="Details">
          <Prop label="Email"><InlineField type="email" value={p.email} onSave={v => patch({ email: v ? v.trim().toLowerCase() : null })} /></Prop>
          <Prop label="Phone"><InlineField value={p.phone} onSave={v => patch({ phone: v })} /></Prop>
          <Prop label="Title"><InlineField value={p.title} onSave={v => patch({ title: v })} /></Prop>
          <Prop label="LinkedIn"><InlineField value={p.linkedin} onSave={v => patch({ linkedin: v })} render={v => v ? link(v, v.replace(/^https?:\/\/(www\.)?/, "")) : null} /></Prop>
          <Prop label="Company">
            {moving ? <div><CompanyPicker value={null} onChange={moveTo} defaultName="" source={p.source || "manual"} sourceDetail={p.source_detail || ""} /><button onClick={() => setMoving(false)} style={{ ...btn("tertiary"), padding: "2px 6px", fontSize: 12, color: TC.muted, marginTop: 4 }}>Cancel</button></div>
              : <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{p.companies ? <span onClick={() => onNavigate?.("companies", { companyId: p.companies.id })} style={{ ...TT.body2, color: TC.link, cursor: "pointer" }}>{p.companies.name}</span> : <span style={{ ...TT.body2, color: TC.faint }}>none</span>}<button onClick={() => setMoving(true)} style={{ ...btn("tertiary"), padding: "0 6px", fontSize: 12, color: TC.muted }}>{p.companies ? "change" : "set"}</button></div>}
          </Prop>
          <Prop label="Owner"><InlineField value={p.owner} onSave={v => patch({ owner: v })} placeholder="unassigned" /></Prop>
          <Prop label="Lead status" hint="Where outreach to this person stands"><InlineField value={p.lead_status || "new"} options={opts(LEAD_STATUS, LEAD_STATUS_LABEL)} onSave={v => patch({ lead_status: v })} /></Prop>
          <Prop label="Lifecycle"><InlineField value={p.lifecycle_stage || "prospect"} options={opts(LIFECYCLE, LIFECYCLE_LABEL)} onSave={v => patch({ lifecycle_stage: v })} /></Prop>
          <Prop label="Marketing" hint="Subscription status, kept apart from CRM status"><InlineField value={p.marketing_status || "unknown"} options={opts(MKT)} onSave={setMarketing} /></Prop>
          {p.marketing_status === "subscribed" && <Prop label="Consent"><InlineField value={p.consent_source || ""} options={[{ value: "", label: "—" }, ...opts(CONSENT_SOURCES, CONSENT_LABEL)]} onSave={v => patch({ consent_source: v })} />{p.consent_at && <div style={{ ...TT.caption, color: TC.muted, marginTop: 2 }}>recorded {day(p.consent_at)}</div>}</Prop>}
          <Prop label="Source" hint="Where this person came from; enrichment never overwrites it"><InlineField value={p.source} onSave={v => patch({ source: v })} /></Prop>
          <Prop label="Source detail"><InlineField value={p.source_detail} onSave={v => patch({ source_detail: v })} placeholder="which show, who referred" /></Prop>
          <Prop label="Notes" last><InlineField multiline value={p.notes} onSave={v => patch({ notes: v })} placeholder="Add notes" /></Prop>
        </Card>
        <Card title={`Deals · ${deals.length}`}>
          {deals.length === 0 && <Empty>Not on any deal yet. Add this person to a deal from the deal page.</Empty>}
          {deals.filter(x => x.deals).map(x => (
            <div key={x.id} onClick={() => onNavigate?.("deals", { dealId: x.deals.id })} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
              <span style={pill(STAGE_TONE[x.deals.stage])}>{STAGE_LABEL[x.deals.stage]}</span>
              <span style={{ ...TT.body2Med, color: TC.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.deals.name}</span>
              <span style={{ ...TT.caption, color: TC.muted }}>{DEAL_ROLE_LABEL[x.role] || x.role}{x.is_primary ? " · primary" : ""}</span>
            </div>
          ))}
        </Card>
        <Card title={`Campaigns · ${memberships.length}`}>
          {memberships.length === 0 && <Empty>Not in any campaign.</Empty>}
          {memberships.map(m => (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <span style={pill(CAMPAIGN_KIND_TONE[m.campaigns?.kind] || "sand")}>{CAMPAIGN_KIND_LABEL[m.campaigns?.kind] || m.campaigns?.kind}</span>
              <span style={{ ...TT.body2, color: TC.ink, flex: 1 }}>{m.campaigns?.name}</span>
              <span style={pill(m.responded ? "evergreen" : "outline")}>{m.status}</span>
            </div>
          ))}
        </Card>
      </>}>
      <Timeline contactId={id} companyId={p.company_id} contacts={[p]} onLogged={() => { load(); onChanged?.(); }} />
    </RecordLayout>
  );
}

// Capture a contact. With companyId the company is fixed; otherwise a picker chooses or creates one.
export function NewContactForm({ companyId = null, onDone, onCancel }) {
  const [company, setCompany] = useState(null);
  const [f, setF] = useState({ name: "", title: "", email: "", phone: "", linkedin: "", marketing_status: "unknown", consent_source: "", lead_status: "new", owner: me(), source: "manual", source_detail: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  const input = inputStyle();
  async function save(e) {
    e.preventDefault(); if (!f.name.trim() || busy) return; setBusy(true); setErr("");
    try {
      const cid = companyId || company?.id || null;
      const subscribed = f.marketing_status === "subscribed";
      const rows = await db.insert("contacts", { company_id: cid, name: f.name.trim(), title: f.title || null, email: f.email.trim().toLowerCase() || null, phone: f.phone.trim() || null, linkedin: f.linkedin || null, marketing_status: f.marketing_status, consent_source: subscribed ? (f.consent_source || "other") : null, consent_at: subscribed ? new Date().toISOString() : null, lead_status: f.lead_status, owner: f.owner.trim() || null, source: f.source || "manual", source_detail: f.source_detail || null, created_at: new Date().toISOString() });
      await logActivity({ type: "contact_created", company_id: cid, contact_id: rows?.[0]?.id || null, subject: f.name.trim(), body: [f.title, f.source, f.source_detail].filter(Boolean).join(" · ") || null });
      onDone(rows?.[0] || null);
    } catch (e2) { setErr(e2.message.includes("contacts_email_uniq") ? "A contact with that email already exists." : e2.message); }
    setBusy(false);
  }
  return (
    <form onSubmit={save} style={{ ...tile({ marginBottom: 12 }), display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      {!companyId && <div style={{ gridColumn: "1 / -1" }}><span style={label}>Company</span><CompanyPicker value={company} onChange={setCompany} source={f.source} sourceDetail={f.source_detail} /></div>}
      <div><span style={label}>Name</span><input style={input} value={f.name} onChange={set("name")} autoFocus required /></div>
      <div><span style={label}>Title</span><input style={input} value={f.title} onChange={set("title")} /></div>
      <div><span style={label}>Email</span><input style={input} type="email" value={f.email} onChange={set("email")} /></div>
      <div><span style={label}>Phone</span><input style={input} value={f.phone} onChange={set("phone")} /></div>
      <div><span style={label}>LinkedIn</span><input style={input} value={f.linkedin} onChange={set("linkedin")} /></div>
      <div><span style={label}>Owner</span><input style={input} value={f.owner} onChange={set("owner")} /></div>
      <div><span style={label}>Lead status</span><select style={input} value={f.lead_status} onChange={set("lead_status")}>{LEAD_STATUS.map(k => <option key={k} value={k}>{LEAD_STATUS_LABEL[k]}</option>)}</select></div>
      <div><span style={label}>Marketing status</span><select style={input} value={f.marketing_status} onChange={set("marketing_status")}>{MKT.map(k => <option key={k}>{k}</option>)}</select></div>
      {f.marketing_status === "subscribed" ? <div><span style={label}>Consent came from</span><select style={input} value={f.consent_source} onChange={set("consent_source")}><option value="">—</option>{CONSENT_SOURCES.map(k => <option key={k} value={k}>{CONSENT_LABEL[k]}</option>)}</select></div> : <div />}
      <div style={{ gridColumn: "1 / -1" }}><span style={label}>Source · detail</span><div style={{ display: "flex", gap: 6 }}><select style={{ ...input, width: 140 }} value={f.source} onChange={set("source")}>{["manual", "trade_show", "referral", "apollo", "inbound", "other"].map(k => <option key={k}>{k}</option>)}</select><input style={input} value={f.source_detail} onChange={set("source_detail")} placeholder="which show, who referred, booth 212" /></div></div>
      {err && <div style={{ gridColumn: "1 / -1", ...pill("rust") }}>{err}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={btn("primary")}>{busy ? "Saving…" : "Add contact"}</button>
        <button type="button" onClick={onCancel} style={btn("secondary")}>Cancel</button>
      </div>
    </form>
  );
}
