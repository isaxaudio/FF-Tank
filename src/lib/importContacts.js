// src/lib/importContacts.js — bulk contact import for People → Import (CSV file or rows pasted from a spreadsheet).
// Three steps, all testable under node with an injected db:
//   parseTable(text)              → { headers, rows }   (comma, tab or semicolon; quoted cells; header row first)
//   guessMapping(headers)         → { columnIndex: field }   the user can change every column in the dialog
//   planImport(table, mapping, lookups, opts) → one entry per row: create | update | skip, with the company it lands on
//   runImport(db, plan, opts)     → writes it: new companies, new contacts, blank-only fills on existing contacts
// Rules: one contact per email (the first row with an address wins); a row without a valid email is skipped;
// an existing contact only gets fields that are blank today, nothing is overwritten; anyone on the unsubscribe
// list or already unsubscribed stays unsubscribed; people are subscribed to marketing only when the importer ticks
// "these people opted in", and then with consent_source imported_list dated now. Nothing is deleted except by Undo,
// which removes only the contacts and companies this import created and clears only the fields it filled.

export const FIELDS = [
  ["email", "Email"], ["name", "Full name"], ["first_name", "First name"], ["last_name", "Last name"], ["title", "Title"],
  ["company", "Company"], ["website", "Company website"], ["phone", "Phone"], ["linkedin", "LinkedIn"], ["", "Don't import"],
];
export const FIELD_LABEL = Object.fromEntries(FIELDS);

// Personal mailboxes say nothing about the company.
export const GENERIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "comcast.net", "protonmail.com", "proton.me", "att.net", "verizon.net", "ymail.com", "gmx.com"]);
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export const MAX_ROWS = 5000;

export function parseTable(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const count = ch => firstLine.split(ch).length - 1;
  const delim = count("\t") > 0 ? "\t" : count(";") > count(",") ? ";" : ",";
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  const rows = out.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ""));
  const headers = (rows.shift() || []).map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows, delimiter: delim };
}

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HEADER_HINTS = [
  ["email", /^(e ?mail|email address|work email|business email|primary email|e mail address)$/],
  ["first_name", /^(first|first name|firstname|given name|fname)$/],
  ["last_name", /^(last|last name|lastname|surname|family name|lname)$/],
  ["name", /^(name|full name|contact|contact name|person)$/],
  ["title", /^(title|job title|position|role|job)$/],
  ["company", /^(company|company name|organization|organisation|org|account|account name|employer|institution|school|university)$/],
  ["website", /^(website|company website|domain|company domain|url|web|site)$/],
  ["phone", /^(phone|phone number|mobile|cell|work phone|direct phone|telephone|mobile phone|corporate phone)$/],
  ["linkedin", /^(linkedin|linkedin url|person linkedin url|linkedin profile)$/],
];
export function guessMapping(headers) {
  const used = new Set(), map = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    const hit = HEADER_HINTS.find(([f, re]) => !used.has(f) && re.test(n));
    if (hit) { map[i] = hit[0]; used.add(hit[0]); }
    else map[i] = "";
  });
  return map;
}

export function domainOf(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  const host = s.includes("@") ? s.split("@").pop() : s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
  const d = host.replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}
export const companyKey = s => norm(s).replace(/\b(inc|llc|ltd|corp|corporation|co|company|the)\b/g, "").replace(/\s+/g, " ").trim();

// One record per row, before anything is looked up.
export function readRows(table, mapping) {
  const cols = Object.entries(mapping).filter(([, f]) => f);
  return table.rows.map((r, i) => {
    const v = {}; for (const [ci, f] of cols) { const x = (r[ci] || "").trim(); if (x && !v[f]) v[f] = x; }
    const email = (v.email || "").replace(/^mailto:/i, "").toLowerCase();
    const name = v.name || [v.first_name, v.last_name].filter(Boolean).join(" ") || null;
    const emailDomain = domainOf(email);
    const domain = domainOf(v.website) || (emailDomain && !GENERIC_DOMAINS.has(emailDomain) ? emailDomain : null);
    return { line: i + 2, email, name, title: v.title || null, company: v.company || null, domain, phone: v.phone || null, linkedin: v.linkedin || null };
  });
}

// lookups: { contacts: [{id,email,name,title,phone,linkedin,company_id,marketing_status}], companies: [{id,name,domain}], unsubscribed: [email] }
// opts: { createCompanies = true }
export function planImport(table, mapping, lookups, { createCompanies = true } = {}) {
  const byEmail = new Map((lookups.contacts || []).filter(c => c.email).map(c => [c.email.toLowerCase(), c]));
  const byName = new Map(), byDomain = new Map();
  for (const c of lookups.companies || []) { const k = companyKey(c.name); if (k && !byName.has(k)) byName.set(k, c); if (c.domain) byDomain.set(c.domain.toLowerCase(), c); }
  const unsub = new Set((lookups.unsubscribed || []).map(e => String(e).toLowerCase()));
  const toCreate = new Map();   // companyKey → { key, name, domain }
  const seen = new Set();
  const items = readRows(table, mapping).map(r => {
    if (!r.email) return { ...r, action: "skip", reason: "No email" };
    if (!EMAIL_RE.test(r.email)) return { ...r, action: "skip", reason: "Email doesn't look valid" };
    if (seen.has(r.email)) return { ...r, action: "skip", reason: "Same email earlier in the file" };
    seen.add(r.email);
    const existing = byEmail.get(r.email) || null;
    let company = null;
    if (existing?.company_id) company = { id: existing.company_id, how: "kept" };
    else {
      const k = companyKey(r.company);
      const hit = (k && byName.get(k)) || (r.domain && byDomain.get(r.domain));
      if (hit) company = { id: hit.id, name: hit.name, how: k && byName.get(k) ? "name" : "domain" };
      else if (k && createCompanies) {
        if (!toCreate.has(k)) toCreate.set(k, { key: k, name: r.company, domain: r.domain && !byDomain.has(r.domain) ? r.domain : null });
        company = { key: k, name: toCreate.get(k).name, how: "new" };
      }
    }
    const unsubscribed = unsub.has(r.email) || existing?.marketing_status === "unsubscribed";
    if (!existing) return { ...r, action: "create", company, unsubscribed };
    const fill = {};
    for (const f of ["name", "title", "phone", "linkedin"]) if (r[f] && !existing[f]) fill[f] = r[f];
    if (!existing.company_id && company) fill.company = true;
    return { ...r, action: Object.keys(fill).length ? "update" : "same", existing, company, unsubscribed, fill };
  });
  const count = a => items.filter(x => x.action === a).length;
  return {
    items, newCompanies: [...toCreate.values()],
    totals: { rows: items.length, create: count("create"), update: count("update"), same: count("same"), skip: count("skip"), unsubscribed: items.filter(x => x.unsubscribed && x.action !== "skip").length, newCompanies: toCreate.size },
  };
}

const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

// Everything planImport needs, read for the emails and the companies in the file only.
export async function loadLookups(db, emails) {
  const list = [...new Set(emails.filter(Boolean).map(e => e.toLowerCase()))].filter(e => EMAIL_RE.test(e));
  const contacts = [], unsubscribed = [];
  for (const part of chunk(list, 100)) {
    const inList = `in.(${part.map(e => `"${e.replace(/"/g, "")}"`).join(",")})`;
    contacts.push(...(await db.select("contacts", { select: "id,email,name,title,phone,linkedin,company_id,marketing_status", email: inList, merged_into_id: "is.null" }) || []));
    unsubscribed.push(...((await db.select("unsubscribes", { select: "email", email: inList })) || []).map(u => u.email));
  }
  const companies = await db.selectAll("companies", { select: "id,name,domain", merged_into_id: "is.null" });
  return { contacts, companies, unsubscribed };
}

// opts: { owner, leadStatus = "new", optedIn = false, label, actor, now }
// Returns { created: [contact], updated: [{id, cleared}], companies: [id], failed: [{line,email,reason}], undo }
export async function runImport(db, plan, { owner = null, leadStatus = "new", optedIn = false, label = "", actor = "user", now = new Date(), onProgress } = {}) {
  const at = now.toISOString();
  const companyIds = new Map(), createdCompanies = [];
  for (const part of chunk(plan.newCompanies, 100)) {
    const rows = await db.insert("companies", part.map(c => ({ name: c.name, domain: c.domain, kind: "prospect", source: "import", source_detail: label || null })));
    (rows || []).forEach((r, i) => { companyIds.set(part[i].key, r.id); createdCompanies.push(r.id); });
  }
  const activityIds = [];
  const logAll = async rows => { try { activityIds.push(...((await db.insert("activities", rows)) || []).map(a => a.id)); } catch { /* the timeline entry is a nicety */ } };
  if (createdCompanies.length) await logAll(createdCompanies.map((id, i) => ({ type: "company_created", company_id: id, subject: plan.newCompanies[i].name, body: ["import", label].filter(Boolean).join(" · "), actor, source: "ui", occurred_at: at, metadata: {} })));
  const companyId = c => (c ? c.id || companyIds.get(c.key) || null : null);

  const created = [], updated = [], failed = [];
  const creates = plan.items.filter(x => x.action === "create");
  const record = x => {
    const subscribed = optedIn && !x.unsubscribed;
    return { email: x.email, name: x.name || x.email.split("@")[0], title: x.title, phone: x.phone, linkedin: x.linkedin, company_id: companyId(x.company),
      owner: owner || null, lead_status: leadStatus, marketing_status: x.unsubscribed ? "unsubscribed" : subscribed ? "subscribed" : "unknown",
      consent_source: subscribed ? "imported_list" : null, consent_at: subscribed ? at : null, source: "import", source_detail: label || null, created_at: at };
  };
  let done = 0;
  for (const part of chunk(creates, 200)) {
    try { created.push(...(await db.insert("contacts", part.map(record)) || [])); }
    catch {
      // One bad row (an address that exists with different capitals, a constraint) fails the batch; go row by row.
      for (const x of part) {
        try { created.push(...(await db.insert("contacts", record(x)) || [])); }
        catch (e) { failed.push({ line: x.line, email: x.email, reason: /contacts_email_uniq/.test(e.message || "") || e.status === 409 ? "Already in FF Tank" : e.message }); }
      }
    }
    done += part.length; onProgress?.(done, creates.length);
  }
  if (created.length) {
    for (const part of chunk(created, 200)) await logAll(part.map(c => ({ type: "contact_created", contact_id: c.id, company_id: c.company_id, subject: c.name, body: ["import", label].filter(Boolean).join(" · "), actor, source: "ui", occurred_at: at, metadata: {} })));
  }
  for (const x of plan.items.filter(i => i.action === "update")) {
    const patch = {};
    for (const f of ["name", "title", "phone", "linkedin"]) if (x.fill[f]) patch[f] = x.fill[f];
    if (x.fill.company) { const id = companyId(x.company); if (id) patch.company_id = id; }
    if (!Object.keys(patch).length) continue;
    try { await db.update("contacts", x.existing.id, patch); updated.push({ id: x.existing.id, cleared: Object.fromEntries(Object.keys(patch).map(k => [k, null])) }); }
    catch (e) { failed.push({ line: x.line, email: x.email, reason: e.message }); }
  }
  const undo = async () => {
    for (const id of activityIds) await db.delete("activities", id).catch(() => null);
    for (const c of created) await db.delete("contacts", c.id).catch(() => null);
    for (const u of updated) await db.update("contacts", u.id, u.cleared);
    for (const id of createdCompanies) { try { await db.delete("companies", id); } catch { /* now in use elsewhere: keep it */ } }
  };
  return { created, updated, companies: createdCompanies, failed, undo };
}
