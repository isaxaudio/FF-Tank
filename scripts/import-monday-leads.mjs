// scripts/import-monday-leads.mjs — import a Monday.com "Leads" board export (Google Sheets values JSON)
// into contacts + companies. Dry run by default; `--apply` writes.
//   node scripts/import-monday-leads.mjs backups/imports/2026-10-27-monday-leads-crm.json [--apply]
// Rules: one contact per email (first row wins, every group it appeared in lands in source_detail);
// a row in an opt-out group makes the contact unsubscribed; rows without an email or with a
// fatfishmedia.com address are skipped; existing contacts (same email) are left untouched.
// Companies match by email domain, then by normalised name, otherwise are created as prospects.
// Nothing is deleted or overwritten. Re-runnable.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const APPLY = process.argv.includes('--apply');
const file = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node scripts/import-monday-leads.mjs <values.json> [--apply]'); process.exit(1); }

const SOURCE = 'monday';
const GROUP_DETAIL = {                        // Monday group → what shows under Source on the person
  'NAACO PRE SHOW.xlsx': 'NAACO 2026 pre-show list',
  'NACCO Dinner RSVP Results': 'NAACO 2026 dinner RSVP',
  'NAACO OPT OUT': 'NAACO 2026 opt-out',
  'New Leads - Apollo, AI, etc.': 'Apollo / AI lead',
};
const OPT_OUT_GROUPS = new Set(['NAACO OPT OUT']);
const COMPANY_DETAIL = 'NAACO 2026';
const SKIP_DOMAINS = new Set(['fatfishmedia.com']);
const GENERIC = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'aol.com', 'live.com', 'msn.com', 'comcast.net']);

const { values } = JSON.parse(fs.readFileSync(file, 'utf8'));
const header = values[0];
const col = name => { const i = header.indexOf(name); if (i < 0) throw new Error(`missing column ${name}`); return i; };
const C = { name: col('Name'), first: col('First Name'), last: col('Last Name'), company: col('Company'), title: col('Title'), email: col('Email'), phone: col('Phone'), group: col('Group'), touched: col('Last Activity'), owner: col('Owner'), notes: col('Notes'), link: col('Monday Link') };
const cell = (r, i) => (r[i] || '').toString().trim();

const norm = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|corp|corporation|company|co|the)\b/g, '').replace(/\s+/g, ' ').trim();
// registered domain: fsmail.bradley.edu → bradley.edu, mail.ubc.ca → ubc.ca (keeps second-level ccTLDs like co.uk)
const regDomain = d => { const p = d.split('.'); if (p.length <= 2) return d; const sld = p[p.length - 2]; return (p[p.length - 1].length === 2 && ['co', 'ac', 'edu', 'org', 'com', 'gov'].includes(sld)) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };
const phoneFmt = s => { const d = s.replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; return s || null; };
// Monday exported Denver local time; MDT (-06) from the 2nd Sunday of March to the 1st Sunday of November.
const denverIso = s => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/); if (!m) return null; const [y, mo, d] = [m[1], m[2], m[3]].map(Number); const nthSun = (mon, n) => { const first = new Date(Date.UTC(y, mon, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); }; const t = Date.UTC(y, mo - 1, d); const dst = t >= Date.UTC(y, 2, nthSun(2, 2)) && t < Date.UTC(y, 10, nthSun(10, 1)); return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:00${dst ? '-06:00' : '-07:00'}`; };
// only trust the email domain as the company's domain when it plainly belongs to the organisation
const domainFits = (domain, name) => { if (!domain) return false; if (/\.edu$|\.ac\.[a-z]{2}$/.test(domain)) return true; const sld = domain.split('.')[0]; const words = (name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !['of', 'the', 'and', 'at', 'in', 'for', 'inc', 'llc'].includes(w)); const squashed = words.join(''); const initials = words.map(w => w[0]).join(''); return sld === initials || squashed.includes(sld) || sld.includes(squashed) || words.some(w => w.length >= 4 && sld.includes(w)); };
const vertical = (name, domain) => (domain && domain.endsWith('.edu')) || /\b(university|college|institute|school|academy|campus)\b/i.test(name) ? 'higher_ed' : null;

// 1. fold rows into one record per email
const people = new Map(); const skipped = { no_email: [], staff: [] };
for (const r of values.slice(1)) {
  const email = cell(r, C.email).toLowerCase();
  const first = cell(r, C.first), last = cell(r, C.last);
  const name = (first || last) ? `${first} ${last}`.replace(/\s+/g, ' ').trim() : cell(r, C.name).replace(/\s+/g, ' ');
  const group = cell(r, C.group);
  if (!email) { skipped.no_email.push(name); continue; }
  const domain = email.split('@')[1] || '';
  if (SKIP_DOMAINS.has(domain)) { skipped.staff.push(email); continue; }
  const touched = denverIso(cell(r, C.touched));
  let p = people.get(email);
  if (!p) {
    p = { email, name, title: cell(r, C.title) || null, company: cell(r, C.company), phone: phoneFmt(cell(r, C.phone)), owner: cell(r, C.owner) || null, notes: cell(r, C.notes), links: [], groups: [], optOut: false, touched: null, domain: GENERIC.has(domain) ? null : regDomain(domain) };
    people.set(email, p);
  }
  if (!p.title && cell(r, C.title)) p.title = cell(r, C.title);
  if (!p.company && cell(r, C.company)) p.company = cell(r, C.company);
  if (!p.phone && cell(r, C.phone)) p.phone = phoneFmt(cell(r, C.phone));
  if (group && !p.groups.includes(group)) p.groups.push(group);
  if (OPT_OUT_GROUPS.has(group)) p.optOut = true;
  if (cell(r, C.link) && !p.links.includes(cell(r, C.link))) p.links.push(cell(r, C.link));
  if (touched && (!p.touched || touched > p.touched)) p.touched = touched;
}

// 2. database
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, args) => (await c.query(sql, args)).rows;
const stats = { rows: values.length - 1, unique_people: people.size, contacts_created: 0, contacts_existing: 0, names_fixed: 0, unsubscribed: 0, companies_matched_domain: 0, companies_matched_name: 0, companies_created: 0, no_company: 0 };

const existing = new Map((await q('select id, lower(email) e, name, source from contacts where email is not null')).map(r => [r.e, r]));
const byDomain = new Map(), byName = new Map();
for (const r of await q('select id, name, domain from companies where merged_into_id is null')) { if (r.domain) byDomain.set(r.domain.toLowerCase(), r); if (!byName.has(norm(r.name))) byName.set(norm(r.name), r); }
const created = [], matched = [], odd = [];

async function ensureCompany(p) {
  if (!p.company && !p.domain) return null;
  const n = norm(p.company);
  if (n && byName.has(n)) { stats.companies_matched_name++; matched.push(`${p.company} → ${byName.get(n).name} [name]`); return byName.get(n).id; }
  if (p.domain && byDomain.has(p.domain)) { stats.companies_matched_domain++; matched.push(`${p.company || '(no name)'} → ${byDomain.get(p.domain).name} [${p.domain}]`); return byDomain.get(p.domain).id; }
  if (p.domain && !domainFits(p.domain, p.company)) { odd.push(`${p.company}: ${p.domain} not used`); p.domain = null; }
  if (!p.company) return null;                                // a bare domain is not enough to make a company
  stats.companies_created++;
  let id = `dry-${stats.companies_created}`;
  if (APPLY) {
    const [row] = await q(`insert into companies (name, domain, kind, vertical, source, source_detail) values ($1,$2,'prospect',$3,$4,$5) returning id`,
      [p.company, p.domain, vertical(p.company, p.domain), SOURCE, COMPANY_DETAIL]);
    id = row.id;
  }
  created.push(`${p.company}${p.domain ? ` (${p.domain})` : ''}`);
  const rec = { id, name: p.company };
  if (p.domain) byDomain.set(p.domain, rec); if (n) byName.set(n, rec);
  return id;
}

for (const p of people.values()) {
  const have = existing.get(p.email);
  if (have) {                                                  // rows this importer made earlier: refresh the name only
    stats.contacts_existing++;
    if (have.source === SOURCE && have.name !== p.name) { stats.names_fixed++; if (APPLY) { await q('update contacts set name=$1, updated_at=now() where id=$2', [p.name, have.id]); await q(`update activities set subject=$1 where contact_id=$2 and type='contact_created' and source=$3`, [p.name, have.id, SOURCE]); } }
    continue;
  }
  const companyId = await ensureCompany(p);
  if (!companyId) stats.no_company++;
  const detail = p.groups.map(g => GROUP_DETAIL[g] || g).join(' + ');
  const notes = [p.notes, ...p.links.map(l => `Monday: ${l}`)].filter(Boolean).join('\n') || null;
  if (p.optOut) stats.unsubscribed++;
  stats.contacts_created++;
  if (!APPLY) continue;
  const cid = String(companyId || '').startsWith('dry-') ? null : companyId;
  const [row] = await q(
    `insert into contacts (company_id, name, title, email, phone, notes, owner, source, source_detail, marketing_status, lead_status, lifecycle_stage, last_touch_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new','prospect',$11,now()) returning id`,
    [cid, p.name, p.title, p.email, p.phone, notes, p.owner, SOURCE, detail, p.optOut ? 'unsubscribed' : 'unknown', p.touched]);
  await q(`insert into activities (type, company_id, contact_id, subject, body, actor, source, occurred_at) values ('contact_created',$1,$2,$3,$4,'import',$5,now())`,
    [cid, row.id, p.name, [p.title, SOURCE, detail].filter(Boolean).join(' · '), SOURCE]);
}
await c.end();

console.log(APPLY ? 'APPLIED' : 'DRY RUN', JSON.stringify(stats, null, 2));
console.log(`skipped: ${skipped.no_email.length} without email (${skipped.no_email.join(', ')}), ${skipped.staff.length} Fatfish addresses (${skipped.staff.join(', ')})`);
console.log(`companies matched (${matched.length}):\n  ` + matched.join('\n  '));
console.log(`email domains not used as company domain (${odd.length}):\n  ` + odd.join('\n  '));
console.log(`companies ${APPLY ? 'created' : 'to create'} (${created.length}):\n  ` + created.join('\n  '));
