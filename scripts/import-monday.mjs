// scripts/import-monday.mjs — import the Monday.com CRM export (Google Sheet "Fatfish Monday CRM Contacts Export",
// one values-JSON file per board tab) into contacts + companies. Dry run by default; `--apply` writes.
//   node scripts/import-monday.mjs backups/imports/2026-10-27-monday-*.json [--apply]
// One contact per email across every tab. Tabs are read in the sheet's own precedence (Contacts (Old CRM),
// Other CRM Boards, Marketing Contacts, Leads (CRM), Leads (Old CRM)) and the first tab with a value fills
// name / title / phone / company; every list a person appears on lands in source_detail. Marketing status:
// unsubscribed anywhere wins, a bounced address stays unknown, otherwise the Marketing Contacts board's
// Subscribed becomes subscribed (consent imported_list, dated at the export). Lead status keeps the strongest
// signal (unqualified > connected > attempted > new); client lists make the person (and a new company) a customer.
// Rows without an email, Fatfish staff and test rows are skipped. Companies match by name, then by email domain,
// else are created. Rows this importer created earlier (source = monday) are refreshed on a rerun; nothing else
// is touched and nothing is deleted.
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
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!files.length) { console.error('usage: node scripts/import-monday.mjs <values.json...> [--apply]'); process.exit(1); }

const SOURCE = 'monday';
const EXPORTED_AT = '2026-10-27T22:55:00Z';                 // when the sheet was pulled from Monday
const STAFF = {                                             // Monday people → FF Tank owner (sign-in email)
  'chase cook': 'chase@fatfishmedia.com', 'bubba palmer': 'bubba@fatfishmedia.com', 'taylor miles': 'taylor@fatfishmedia.com',
  'isaac gonzalez': 'isaac@fatfishmedia.com', 'richard payson': 'richard@fatfishmedia.com', 'cynthia wainscott': 'cynthia@fatfishmedia.com',
  'benjamin bielefeld': 'ben@fatfishmedia.com', 'ben bielefeld': 'ben@fatfishmedia.com',
};
const SKIP_DOMAINS = new Set(['fatfishmedia.com', 'test.com']);
const SKIP_EMAILS = new Set(['isax.audio@gmail.com', 'cynthiawainscott@gmail.com', 'richardpayson@gmail.com']);
const SKIP_GROUPS = new Set(['2025 Test', 'Taylor - Test Pilot']);
const GENERIC = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'live.com', 'msn.com', 'comcast.net', 'protonmail.com']);
const LEAD_RANK = { new: 0, attempted: 1, connected: 2, unqualified: 3 };
const LIFE_RANK = { prospect: 0, former: 1, customer: 2 };

// ---- per-board rules -------------------------------------------------------------------------
// Each returns { detail, lead, life, marketing, bounced, noMass, kind, extraNotes[] } for one row.
const BOARD_ORDER = ['Contacts (FF/CL Old CRM)', 'Contacts (CRM)', 'Contacts (monday CRM - Enterprise)', 'New Leads (monday CRM - Enterprise)', 'Marketing Contacts', 'Leads (CRM)', 'Leads (FF/CL Old CRM)'];
const RULES = {
  'Contacts (FF/CL Old CRM)': (r, g) => {
    const group = { 'Client Christmas 2026': 'client Christmas 2026 list', 'Xmas Clients List & Gifts 2025.xlsx': 'client Christmas 2025 list', 'Freelancer Christmas 2026': 'freelancer Christmas 2026 list', 'Contacts': 'old CRM contacts', 'New Group': 'old CRM contacts' }[g.group] || g.group;
    const client = /client/i.test(group) || g.status === 'Customer';
    const freelancer = /freelancer/i.test(group);
    return { detail: group, life: client ? 'customer' : null, lead: freelancer ? 'unqualified' : null, kind: client ? 'client' : freelancer ? 'partner' : null, extraNotes: [freelancer ? 'Freelancer (crew), not a sales lead' : null, g.get('Account') && g.get('Account') !== 'New item' ? `Monday account: ${g.get('Account')}` : null, g.get('Opportunities') ? `Monday opportunities: ${g.get('Opportunities')}` : null] };
  },
  'Contacts (CRM)': (r, g) => ({ detail: 'CRM contacts', lead: /qualified/i.test(g.status) ? 'connected' : null, extraNotes: [] }),
  'Contacts (monday CRM - Enterprise)': (r, g) => ({ detail: 'web inquiry', swapNames: true, extraNotes: [] }),
  'New Leads (monday CRM - Enterprise)': (r, g) => ({ detail: `web inquiry${g.get('Lead Type') ? ` (${g.get('Lead Type').toLowerCase()})` : ''}`, lead: /qualified/i.test(g.status) ? 'connected' : null, orgIsName: true, extraNotes: [g.get('FF/CL') === 'CL' ? 'Brand: CL' : null] }),
  'Marketing Contacts': (r, g) => {
    const labels = { 'NAACO 2026 Attendees': 'NAACO 2026 attendees', 'Clients List 2025.xlsx': 'clients list 2025', 'Apollo Contacts': 'Apollo', 'Snow League Affliates.xlsx': 'Snow League affiliates list', 'NAACO - Dinner Attendees': 'NAACO 2026 dinner attendees', 'WGU Contacts': 'WGU contacts', 'LEADS - AI, RFP, etc.': 'AI / RFP lead', 'Unsubscribed': null, 'Ex-Friends (Unsubscribed and didn\'t even say goodbye)': null, 'Bounced': null, 'No Email': null, 'NAACO - DO NOT MASS EMAIL': 'NAACO 2026 attendees', 'FEEDBACK': 'client feedback' };
    let detail = g.group in labels ? labels[g.group] : g.group;
    if (detail === 'Apollo' && g.get('Event')) detail = `Apollo (${g.get('Event')})`;
    const how = g.get('How? (Source)'); if (how && how !== 'Apollo') detail = detail ? `${detail}, ${how.toLowerCase()}` : how.toLowerCase();
    const client = /clients list|WGU/i.test(g.group);
    const addr = g.get('Address/Email/Deliverer');
    return { detail, life: client ? 'customer' : null, kind: client ? 'client' : null, marketing: g.status === 'Unsubscribed' ? 'unsubscribed' : g.status === 'Subscribed' ? 'subscribed' : null, bounced: g.get('Marketing Contact / Bounced') === 'Bounced' || g.group === 'Bounced', noMass: /DO NOT MASS/i.test(g.group), extraNotes: [g.get('Campaign Status') && g.get('Campaign Status') !== 'NONE' ? `Monday newsletters: ${g.get('Campaign Status')}` : null, addr ? (/\d/.test(addr) ? `Gift address: ${addr}` : `Gift delivered by: ${addr}`) : null, g.get('Feedback Form') || null, g.get('Rating (1 to 5)') ? `Rating: ${g.get('Rating (1 to 5)')}/5` : null, g.get('Any Feedback?') ? `Feedback: ${g.get('Any Feedback?')}` : null] };
  },
  'Leads (CRM)': (r, g) => ({ detail: { 'NAACO PRE SHOW.xlsx': 'NAACO 2026 pre-show list', 'NACCO Dinner RSVP Results': 'NAACO 2026 dinner RSVP', 'NAACO OPT OUT': 'NAACO 2026 opt-out', 'New Leads - Apollo, AI, etc.': 'Apollo / AI lead' }[g.group] || g.group, marketing: g.group === 'NAACO OPT OUT' ? 'unsubscribed' : null, extraNotes: [] }),
  'Leads (FF/CL Old CRM)': (r, g) => {
    const src = { 'Cold Leads': 'cold list', 'Trade Show': 'trade show', 'Web Leads': 'web lead', 'Producer Direct Lead': 'producer direct lead', 'Phone Leads': 'phone lead', 'Past Clients': 'past client', 'Current Clients': 'current client', 'Junk': 'junk' }[g.get('Lead Source')] || (g.get('Lead Source') || '').toLowerCase();
    const grp = { 'New Leads': 'old CRM leads', 'NAACO Registrants': 'NAACO registrants', 'Disqualified': 'disqualified', 'NAACO Hot Leads': 'NAACO hot leads', 'Qualified leads': 'qualified leads' }[g.group] || g.group;
    const lead = { 'Attempted to contact': 'attempted', 'New Lead': 'new', 'Unqualified': 'unqualified', 'Qualified': 'connected', 'Contacted': 'connected' }[g.status] || (g.group === 'Disqualified' || src === 'junk' ? 'unqualified' : null);
    const life = src === 'current client' ? 'customer' : src === 'past client' ? 'former' : null;
    return { detail: [src, grp].filter(Boolean).join(' · '), lead, life, kind: life ? 'client' : null, marketing: g.status === 'Unsubscribed' ? 'unsubscribed' : null, extraNotes: [g.get('Event Dates') ? `Event dates: ${g.get('Event Dates')}` : null, g.get('Referral Source') ? `Referred by: ${g.get('Referral Source')}` : null, g.get('CL/FF') === 'CL' ? 'Brand: CL' : null], producer: g.get('Producer') };
  },
};

// ---- helpers ----------------------------------------------------------------------------------
const norm = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|corp|corporation|company|co|the)\b/g, '').replace(/\s+/g, ' ').trim();
const regDomain = d => { const p = d.split('.'); if (p.length <= 2) return d; const sld = p[p.length - 2]; return (p[p.length - 1].length === 2 && ['co', 'ac', 'edu', 'org', 'com', 'gov'].includes(sld)) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };
const phoneFmt = s => { const d = (s || '').replace(/\D/g, ''); if (!d) return null; if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; return `+${d}`; };
const denverIso = s => { const m = (s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/); if (!m) return null; const [y, mo, d] = [m[1], m[2], m[3]].map(Number); const nthSun = (mon, n) => { const first = new Date(Date.UTC(y, mon, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); }; const t = Date.UTC(y, mo - 1, d); const dst = t >= Date.UTC(y, 2, nthSun(2, 2)) && t < Date.UTC(y, 10, nthSun(10, 1)); return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:00${dst ? '-06:00' : '-07:00'}`; };
const domainFits = (domain, name) => { if (!domain) return false; if (/\.edu$|\.ac\.[a-z]{2}$/.test(domain)) return true; const sld = domain.split('.')[0]; const words = (name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !['of', 'the', 'and', 'at', 'in', 'for', 'inc', 'llc'].includes(w)); const squashed = words.join(''); const initials = words.map(w => w[0]).join(''); return sld === initials || squashed.includes(sld) || sld.includes(squashed) || words.some(w => w.length >= 4 && sld.includes(w)); };
const vertical = (name, domain) => (domain && domain.endsWith('.edu')) || /\b(university|college|institute|school|academy|campus)\b/i.test(name || '') ? 'higher_ed' : null;
const ownerOf = s => { const first = (s || '').split(',')[0].trim().toLowerCase(); return STAFF[first] || null; };
const tidy = s => (s || '').replace(/\s+/g, ' ').trim();
const stripCopy = s => tidy(s).replace(/\s*\(copy\)$/i, '');

// ---- read every tab into one record per email -------------------------------------------------
const people = new Map();
const skipped = { no_email: 0, staff_or_test: 0 };
const perBoard = {};
const rows = [];
for (const f of files) {
  const { values } = JSON.parse(fs.readFileSync(f, 'utf8'));
  const header = values[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const r of values.slice(1)) rows.push({ r, idx, board: tidy(r[idx['Source Board']]) });
}
rows.sort((a, b) => BOARD_ORDER.indexOf(a.board) - BOARD_ORDER.indexOf(b.board));
for (const { r, idx, board } of rows) {
  const get = k => (idx[k] == null ? '' : tidy(r[idx[k]]));
  const rule = RULES[board]; if (!rule) throw new Error(`no rule for board "${board}"`);
  perBoard[board] = (perBoard[board] || 0) + 1;
  const email = get('Email').toLowerCase();
  const group = get('Group'), status = get('Status / Type');
  if (!email || !email.includes('@')) { skipped.no_email++; continue; }
  const domain = email.split('@')[1];
  if (SKIP_DOMAINS.has(domain) || SKIP_EMAILS.has(email) || SKIP_GROUPS.has(group) || /^test\b/i.test(get('Name'))) { skipped.staff_or_test++; continue; }
  const x = rule(r, { get, group, status });
  let name = (get('First Name') || get('Last Name')) ? tidy(`${get('First Name')} ${get('Last Name')}`) : stripCopy(get('Name'));
  let company = get('Company');
  if (x.swapNames) [name, company] = [company, stripCopy(get('Name'))];
  if (x.orgIsName) { company = company || stripCopy(get('Name')); name = ''; }
  if (/^\d{4}-\d{2}-\d{2}/.test(name)) name = '';
  const title = get('Title') || get('Title Level') || '';
  let p = people.get(email);
  if (!p) { p = { email, name: '', title: '', company: '', phone: null, owner: null, location: '', domain: GENERIC.has(domain) ? null : regDomain(domain), notes: [], links: [], details: [], boards: [], touched: null, marketing: null, bounced: false, noMass: false, lead: 'new', life: 'prospect', kind: null }; people.set(email, p); }
  if (!p.name && name) p.name = name;
  if (!p.title && title) p.title = title;
  if (!p.company && company) p.company = company;
  if (!p.phone && get('Phone')) p.phone = phoneFmt(get('Phone'));
  if (!p.owner) p.owner = ownerOf(get('Owner')) || ownerOf(x.producer);
  if (!p.location && get('Location')) p.location = get('Location');
  if (x.detail && !p.details.includes(x.detail)) p.details.push(x.detail);
  if (!p.boards.includes(board)) p.boards.push(board);
  const note = get('Notes'); if (note && !p.notes.includes(note)) p.notes.push(note);
  for (const n of x.extraNotes || []) if (n && !p.notes.includes(n)) p.notes.push(n);
  const link = get('Monday Link'); if (link && !p.links.includes(link)) p.links.push(link);
  const touched = denverIso(get('Last Activity')); if (touched && (!p.touched || touched > p.touched)) p.touched = touched;
  if (x.marketing === 'unsubscribed' || p.marketing === 'unsubscribed') p.marketing = 'unsubscribed'; else if (x.marketing === 'subscribed') p.marketing = 'subscribed';
  if (x.bounced) p.bounced = true;
  if (x.noMass) p.noMass = true;
  if (x.lead && LEAD_RANK[x.lead] > LEAD_RANK[p.lead]) p.lead = x.lead;
  if (x.life && LIFE_RANK[x.life] > LIFE_RANK[p.life]) p.life = x.life;
  if (x.kind && (!p.kind || x.kind === 'client')) p.kind = x.kind;
}
for (const p of people.values()) {
  if (!p.name) p.name = p.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  if (p.bounced) { p.notes.unshift('Email bounced (Monday marketing list)'); if (p.marketing === 'subscribed') p.marketing = null; }
  if (p.noMass) { p.notes.unshift('Do not mass email (Monday)'); if (p.marketing === 'subscribed') p.marketing = null; }
  if (p.domain && !domainFits(p.domain, p.company)) p.domain = null;
}

// ---- database --------------------------------------------------------------------------------
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, args) => (await c.query(sql, args)).rows;
const stats = { rows: rows.length, unique_people: people.size, contacts_created: 0, contacts_refreshed: 0, contacts_left_alone: 0, subscribed: 0, unsubscribed: 0, bounced: 0, customers: 0, companies_matched_name: 0, companies_matched_domain: 0, companies_created: 0, no_company: 0, review_candidates: 0 };
const existing = new Map((await q('select id, lower(email) e, source, company_id from contacts where email is not null and merged_into_id is null')).map(r => [r.e, r]));
const byDomain = new Map(), byName = new Map();
for (const r of await q('select id, name, domain from companies where merged_into_id is null')) { if (r.domain) byDomain.set(r.domain.toLowerCase(), r); if (!byName.has(norm(r.name))) byName.set(norm(r.name), r); }
const created = [], review = [];
// a new company whose name sits inside an existing company's name (or the reverse) is probably the same
// organisation spelled differently; the contact still gets the new company, and a review candidate offers
// the existing one (Relationships → Review: Confirm moves the contact, Reject keeps them apart).
const STOP = new Set(['media', 'group', 'events', 'event', 'inc', 'llc', 'the', 'and', 'of', 'llc', 'company', 'co', 'utah', 'center', 'centre', 'foundation', 'university', 'college', 'school', 'state', 'city', 'county', 'national', 'american', 'international', 'services', 'solutions', 'productions', 'studio', 'studios', 'entertainment', 'marketing', 'health', 'care']);
const sig = n => n.split(' ').filter(w => w.length >= 3 && !STOP.has(w));
const existingList = [...byName.entries()].map(([n, r]) => ({ ...r, tokens: sig(n) })).filter(r => r.tokens.length);
const fuzzy = n => { const t = sig(n); if (!t.length) return []; return existingList.filter(r => r.id && !String(r.id).startsWith('dry-') && (t.every(w => r.tokens.includes(w)) || r.tokens.every(w => t.includes(w)))).slice(0, 3); };

async function ensureCompany(p) {
  const n = norm(p.company);
  if (n && byName.has(n)) { stats.companies_matched_name++; return byName.get(n).id; }
  if (p.domain && byDomain.has(p.domain)) { stats.companies_matched_domain++; return byDomain.get(p.domain).id; }
  if (!p.company) return null;
  stats.companies_created++;
  let id = `dry-${stats.companies_created}`;
  if (APPLY) {
    const [row] = await q(`insert into companies (name, domain, kind, lifecycle_stage, vertical, location, source, source_detail) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [p.company, p.domain, p.kind || 'prospect', p.life === 'customer' ? 'customer' : p.life === 'former' ? 'former' : 'prospect', vertical(p.company, p.domain), p.location || null, SOURCE, p.details[0] || null]);
    id = row.id;
  }
  created.push(`${p.company}${p.domain ? ` (${p.domain})` : ''}${p.kind ? ` [${p.kind}]` : ''}`);
  if (p.life === 'customer') { const near = fuzzy(n); if (near.length && near.length <= 2) p.near = near; }   // only client lists: that is where Flex clients already exist
  const rec = { id, name: p.company };
  if (p.domain) byDomain.set(p.domain, rec); if (n) byName.set(n, rec);
  return id;
}

for (const p of people.values()) {
  const have = existing.get(p.email);
  if (have && have.source !== SOURCE) { stats.contacts_left_alone++; continue; }
  const companyId = have?.company_id || await ensureCompany(p);
  if (p.near) for (const m of p.near) stats.review_candidates++, review.push({ email: p.email, name: p.name, company: p.company, match: m });
  if (!companyId) stats.no_company++;
  const marketing = p.marketing || 'unknown';
  if (marketing === 'subscribed') stats.subscribed++; if (marketing === 'unsubscribed') stats.unsubscribed++; if (p.bounced) stats.bounced++; if (p.life === 'customer') stats.customers++;
  const detail = p.details.join(' + ') || null;
  const notes = [...p.notes, ...p.links.map(l => `Monday: ${l}`)].join('\n') || null;
  const cid = String(companyId || '').startsWith('dry-') ? null : companyId;
  const fields = { company_id: cid, name: p.name, title: p.title || null, email: p.email, phone: p.phone, notes, owner: p.owner, source: SOURCE, source_detail: detail, marketing_status: marketing, consent_source: marketing === 'subscribed' ? 'imported_list' : null, consent_at: marketing === 'subscribed' ? EXPORTED_AT : null, lead_status: p.lead, lifecycle_stage: p.life, last_touch_at: p.touched };
  if (have) {
    stats.contacts_refreshed++;
    if (APPLY) { const keys = Object.keys(fields); await q(`update contacts set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1`, [have.id, ...keys.map(k => fields[k])]); await q(`update activities set subject=$1, body=$2 where contact_id=$3 and type='contact_created' and source=$4`, [p.name, [p.title, SOURCE, detail].filter(Boolean).join(' · '), have.id, SOURCE]); }
    continue;
  }
  stats.contacts_created++;
  if (!APPLY) continue;
  const keys = Object.keys(fields);
  const [row] = await q(`insert into contacts (${keys.join(', ')}, created_at) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}, now()) returning id`, keys.map(k => fields[k]));
  await q(`insert into activities (type, company_id, contact_id, subject, body, actor, source, occurred_at) values ('contact_created',$1,$2,$3,$4,'import',$5,now())`, [cid, row.id, p.name, [p.title, SOURCE, detail].filter(Boolean).join(' · '), SOURCE]);
  for (const m of p.near || []) await q(`insert into company_match_candidates (company_id, source_table, source_id, source_key, source_name, match_type, confidence, note) values ($1,'contacts',$2,$3,$4,'name_fuzzy',0.6,$5)`,
    [m.id, row.id, p.email, `${p.name} · ${p.company}`, `Monday import put ${p.name} under new company "${p.company}"; existing company "${m.name}" looks like the same organisation. Confirm moves the contact there.`]);
}
await c.end();

console.log(APPLY ? 'APPLIED' : 'DRY RUN', JSON.stringify({ ...stats, per_board: perBoard, skipped }, null, 2));
console.log(`review candidates (${review.length}):\n  ` + review.map(r => `${r.name} @ ${r.company} ~ ${r.match.name}`).join('\n  '));
console.log(`companies ${APPLY ? 'created' : 'to create'} (${created.length}):\n  ` + created.join('\n  '));
