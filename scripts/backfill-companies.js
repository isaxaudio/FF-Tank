// scripts/backfill-companies.js — populate public.companies and link satellites.
// Dry run by default (prints what it would do). `--apply` writes.
// Rules (CRM-PLAN.md): a domain match links automatically; a name-only match between two
// different systems (target_accounts vs flex_clients) goes to company_match_candidates for
// review; rows inside one system link to the company created from their own name.
// Never deletes, never rewrites names. Re-runnable: skips rows that already have company_id.
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
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, args) => (await c.query(sql, args)).rows;

const norm = s => (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|llc|ltd|corp|corporation|company|co|the)\b/g, '').replace(/\s+/g, ' ').trim();
const domainOf = s => { if (!s) return null; let d = s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]; return d.includes('.') ? d : null; };

const stats = { companies_created: 0, linked_by_domain: 0, linked_same_system: 0, candidates: 0, skipped: 0 };
const byDomain = new Map(), byName = new Map(), flexOwned = new Set(); // companies created from flex_clients in this run
const existing = await q('select id, name, domain from companies where merged_into_id is null');
for (const r of existing) { if (r.domain) byDomain.set(r.domain.toLowerCase(), r.id); byName.set(norm(r.name), r.id); }

async function ensureCompany({ name, domain, kind, tier, vertical, source, source_detail, industry, location, website }) {
  const d = domainOf(domain) || domainOf(website);
  if (d && byDomain.has(d)) return { id: byDomain.get(d), how: 'domain' };
  const n = norm(name);
  if (n && byName.has(n)) return { id: byName.get(n), how: 'name' };
  stats.companies_created++;
  let id = `dry-${stats.companies_created}`;
  if (APPLY) {
    const [row] = await q(
      `insert into companies (name, domain, kind, tier, vertical, source, source_detail, industry, location, website) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [name.trim(), d, kind || 'prospect', tier || null, vertical || null, source || null, source_detail || null, industry || null, location || null, website || null]);
    id = row.id;
  }
  if (d) byDomain.set(d, id); if (n) byName.set(n, id);
  return { id, how: 'created' };
}
async function link(table, rowId, companyId) {
  if (APPLY && !String(companyId).startsWith('dry-')) await q(`update ${table} set company_id=$1 where id=$2 and company_id is null`, [companyId, rowId]);
}
async function candidate(companyId, source_table, source_id, source_key, source_name, match_type, confidence, note) {
  stats.candidates++;
  if (APPLY && !String(companyId).startsWith('dry-')) await q(
    `insert into company_match_candidates (company_id, source_table, source_id, source_key, source_name, match_type, confidence, note) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [companyId, source_table, source_id, source_key, source_name, match_type, confidence, note]);
}

// 1. target_accounts → companies (same system: each account becomes/links its own company)
const tas = await q(`select id, name, company_name, domain, company_domain, website, tier, vertical, industry, city, state, source, metadata from target_accounts where company_id is null order by created_at`);
for (const t of tas) {
  const name = t.company_name || t.name; if (!name) { stats.skipped++; continue; }
  const r = await ensureCompany({ name, domain: t.company_domain || t.domain, website: t.website, kind: t.tier === 'existing_client' ? 'client' : t.tier === 'watchlist' ? 'competitor' : 'prospect', tier: t.tier, vertical: t.vertical, industry: t.industry, location: [t.city, t.state].filter(Boolean).join(', ') || null, source: t.source, source_detail: t.metadata?.trade_show || t.metadata?.event || null });
  await link('target_accounts', t.id, r.id); if (r.how === 'domain') stats.linked_by_domain++; else stats.linked_same_system++;
}

// 2. flex_clients → companies. Different system: domain match auto-links; name match is a candidate;
//    no match creates a client company owned by that Flex client.
const fcs = await q(`select id, flex_id, name, industry, location, contact_email, total_revenue from flex_clients where company_id is null order by total_revenue desc nulls last`);
for (const f of fcs) {
  if (!f.name) { stats.skipped++; continue; }
  const emailDomain = f.contact_email && !/gmail|yahoo|hotmail|outlook|icloud/.test(f.contact_email) ? domainOf(f.contact_email.split('@')[1]) : null;
  if (emailDomain && byDomain.has(emailDomain)) { await link('flex_clients', f.id, byDomain.get(emailDomain)); stats.linked_by_domain++; continue; }
  const n = norm(f.name);
  if (n && byName.has(n) && flexOwned.has(byName.get(n))) { // duplicate Flex client name inside Flex itself: same system, link directly
    await link('flex_clients', f.id, byName.get(n)); stats.linked_same_system++; continue;
  }
  if (n && byName.has(n)) {
    await candidate(byName.get(n), 'flex_clients', f.id, f.flex_id, f.name, 'name_exact', 0.9, `Flex client "${f.name}" matches company by normalised name; revenue ${f.total_revenue ?? 'n/a'}`);
    continue;
  }
  const r = await ensureCompany({ name: f.name, domain: emailDomain, kind: 'client', tier: 'existing_client', industry: f.industry, location: f.location, source: 'flex' });
  flexOwned.add(r.id);
  await link('flex_clients', f.id, r.id); stats.linked_same_system++;
}

// 3. opportunities, outreach_drafts, contacts: link by normalised company name to an existing company only.
//    No company is created from a scouted signal; unmatched rows stay unlinked (they are research, not accounts).
for (const [table, col] of [['opportunities', 'company'], ['outreach_drafts', 'company'], ['contacts', 'notes']]) {
  const rows = await q(`select id, ${col} as name from ${table} where company_id is null and ${col} is not null`);
  let linked = 0;
  for (const r of rows) { const n = norm(r.name); if (n && byName.has(n)) { await link(table, r.id, byName.get(n)); linked++; } }
  stats[`${table}_linked_by_name`] = linked; stats[`${table}_unlinked`] = rows.length - linked;
}

console.log(APPLY ? 'APPLIED' : 'DRY RUN', JSON.stringify(stats, null, 2));
await c.end();
