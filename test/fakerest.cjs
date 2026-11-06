// test/fakerest.cjs — an in-memory PostgREST for the delivery tests. Supports the subset the server code
// uses: GET with select (columns, `*`, one-level embeds by <table>_id), filters eq/neq/lt/lte/gt/gte/is/not.is/
// in/ilike plus or=(...), order, limit, offset; POST with return=representation / return=minimal and
// resolution=ignore-duplicates / merge-duplicates (on_conflict); PATCH with the same filters; RPC stubs.
// Conditional PATCHes are applied row by row and synchronously, so two "workers" interleaving on the same
// row see exactly what Postgres would make them see: one wins, the other gets zero rows back.
const crypto = require('node:crypto');

function parseQuery(qs) {
  const out = { filters: [], select: '*', order: null, limit: null, offset: 0, onConflict: null };
  for (const [k, v] of new URLSearchParams(qs)) {
    if (k === 'select') out.select = v;
    else if (k === 'order') out.order = v;
    else if (k === 'limit') out.limit = Number(v);
    else if (k === 'offset') out.offset = Number(v);
    else if (k === 'on_conflict') out.onConflict = v;
    else if (k === 'or') out.filters.push({ or: splitOr(v) });
    else out.filters.push({ col: k, expr: v });
  }
  return out;
}
function splitOr(v) { return v.replace(/^\(|\)$/g, '').split(',').map(p => { const i = p.indexOf('.'); return { col: p.slice(0, i), expr: p.slice(i + 1) }; }); }
function test(row, { col, expr }) {
  const val = col.includes('.') ? col.split('.').reduce((o, k) => o?.[k], row) : row[col];
  const [op, ...rest] = expr.split('.'); const arg = rest.join('.');
  switch (op) {
    case 'eq': return String(val) === arg;
    case 'neq': return String(val) !== arg;
    case 'lt': return val != null && String(val) < arg;
    case 'lte': return val != null && String(val) <= arg;
    case 'gt': return val != null && String(val) > arg;
    case 'gte': return val != null && String(val) >= arg;
    case 'is': return arg === 'null' ? val == null : String(val) === arg;
    case 'not': { const [op2, ...r2] = rest; return !test(row, { col, expr: `${op2}.${r2.join('.')}` }); }
    case 'in': return arg.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(val));
    case 'ilike': { const a = arg.toLowerCase(); const v = String(val || '').toLowerCase(); return a.includes('%') ? v.includes(a.replace(/%/g, '')) : v === a; }
    default: throw new Error(`fakerest: unsupported op ${op}`);
  }
}
const matches = (row, filters) => filters.every(f => f.or ? f.or.some(x => test(row, x)) : test(row, f));

class FakeRest {
  constructor(tables = {}) { this.tables = {}; for (const [t, rows] of Object.entries(tables)) this.tables[t] = rows.map(r => ({ ...r })); this.log = []; this.rpc = {}; }
  table(t) { return (this.tables[t] ||= []); }
  insert(t, row) { const r = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row }; this.table(t).push(r); return r; }
  project(t, row, select) {
    if (!select || select === '*') return { ...row };
    const out = {}; let i = 0; const s = select;
    while (i < s.length) {
      let j = i; let depth = 0;
      while (j < s.length && (s[j] !== ',' || depth > 0)) { if (s[j] === '(') depth++; if (s[j] === ')') depth--; j++; }
      const part = s.slice(i, j).trim(); i = j + 1;
      const m = part.match(/^([a-z_]+)(?::([a-z_]+))?\((.*)\)$/);
      if (m) {
        const rel = m[1]; const inner = m[3];
        const fk = ({ sequence_enrollments: 'enrollment_id', contact_lists: 'list_id' })[rel] || `${rel.replace(/ies$/, 'y').replace(/s$/, '')}_id`;
        const target = this.table(rel).find(x => x.id === row[fk]);
        out[rel] = target ? this.project(rel, target, inner) : null;
      } else if (part === '*') Object.assign(out, row);
      else if (part) out[part] = row[part];
    }
    return out;
  }
  // Returns { status, json } like fetch would.
  handle(method, url, init = {}) {
    const u = new URL(url); const t = u.pathname.replace(/^.*\/rest\/v1\//, ''); const q = parseQuery(u.search.slice(1));
    const prefer = String(init.headers?.Prefer || init.headers?.prefer || '');
    this.log.push({ method, table: t, query: u.search, prefer, body: init.body ? JSON.parse(init.body) : undefined });
    if (t.startsWith('rpc/')) { const fn = this.rpc[t.slice(4)]; return { status: 200, json: fn ? fn(JSON.parse(init.body || '{}')) : null }; }
    if (method === 'GET') {
      let rows = this.table(t).filter(r => matches(r, q.filters));
      if (q.order) { const [col, dir, nulls] = q.order.split('.'); rows.sort((a, b) => { const x = a[col], y = b[col]; if (x == null && y == null) return 0; if (x == null) return nulls === 'nullsfirst' ? -1 : 1; if (y == null) return nulls === 'nullsfirst' ? 1 : -1; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); }); }
      rows = rows.slice(q.offset, q.limit != null ? q.offset + q.limit : undefined);
      return { status: 200, json: rows.map(r => this.project(t, r, q.select)) };
    }
    if (method === 'POST') {
      const bodies = Array.isArray(init.body ? JSON.parse(init.body) : {}) ? JSON.parse(init.body) : [JSON.parse(init.body || '{}')];
      const out = [];
      for (const b of bodies) {
        const key = q.onConflict || (t === 'activities' && b.external_id ? 'source,external_id' : t === 'unsubscribes' ? 'email' : t === 'email_events' ? 'provider,event_id' : t === 'sequence_step_runs' ? 'enrollment_id,position' : t === 'job_state' ? 'job' : t === 'gmail_accounts' ? 'email' : t === 'campaign_email_versions' ? 'campaign_email_id,version' : t === 'contact_list_members' ? 'list_id,contact_id' : t === 'contact_lists' ? 'name' : null);
        const dup = key ? this.table(t).find(r => key.split(',').every(k => String(r[k]).toLowerCase() === String(b[k]).toLowerCase())) : null;
        if (dup && /ignore-duplicates/.test(prefer)) continue;
        if (dup && /merge-duplicates/.test(prefer)) { Object.assign(dup, b); out.push(dup); continue; }
        if (dup) return { status: 409, json: { message: `duplicate key value violates unique constraint (${key})` } };
        out.push(this.insert(t, b));
      }
      return { status: /return=minimal/.test(prefer) ? 201 : 201, json: /return=minimal/.test(prefer) ? null : out.map(r => this.project(t, r, q.select)) };
    }
    if (method === 'PATCH') {
      const b = JSON.parse(init.body || '{}'); const hit = this.table(t).filter(r => matches(r, q.filters));
      for (const r of hit) Object.assign(r, b);
      return { status: 200, json: /return=minimal/.test(prefer) ? null : hit.map(r => this.project(t, r, q.select)) };
    }
    if (method === 'DELETE') { const hit = this.table(t).filter(r => matches(r, q.filters)); this.tables[t] = this.table(t).filter(r => !hit.includes(r)); return { status: 204, json: null }; }
    throw new Error(`fakerest: ${method} not supported`);
  }
}

// A route for test/helpers.cjs stubFetch: [matcher, responder].
function restRoute(db) {
  return [u => u.includes('/rest/v1/'), (url, init) => { const r = db.handle((init.method || 'GET').toUpperCase(), url, init); return r.json === null ? { status: r.status, text: '' } : { status: r.status, json: r.json }; }];
}

module.exports = { FakeRest, restRoute };
