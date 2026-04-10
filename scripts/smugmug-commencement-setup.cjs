#!/usr/bin/env node
/**
 * SmugMug Commencement Gallery Structure Builder
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Creates a clean folder/album hierarchy for graduation video delivery.
 * Non-destructive: only creates new nodes, never touches existing structure.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *
 * Step 1 (first time only): Get OAuth tokens
 *   node scripts/smugmug-auth.js
 *
 * Step 2: Dry run — see exactly what will be created (default mode):
 *   SMUGMUG_CONSUMER_KEY=xxx \
 *   SMUGMUG_CONSUMER_SECRET=xxx \
 *   SMUGMUG_ACCESS_TOKEN=xxx \
 *   SMUGMUG_ACCESS_SECRET=xxx \
 *   SMUGMUG_USERNAME=yourNickname \
 *   node scripts/smugmug-commencement-setup.js
 *
 * Step 3: Actually create (add --create flag):
 *   ... same env vars ... node scripts/smugmug-commencement-setup.js --create
 *
 * ── CUSTOMIZE ─────────────────────────────────────────────────────────────
 * Edit the CONFIG block below to change event name, sessions, degrees, etc.
 * For subsequent events, just copy this script and change CONFIG.
 *
 * ── WHAT IT CREATES ───────────────────────────────────────────────────────
 *
 *   [Folder] UOPX Spring 2026              (top-level, at your account root)
 *     [Folder] AM
 *       [Folder] Associate
 *         [Album] A-C
 *         [Album] D-F
 *         [Album] G-I
 *         [Album] J-L
 *         [Album] M-O
 *         [Album] P-R
 *         [Album] S-U
 *         [Album] V-Z
 *       [Folder] Bachelor  (same albums)
 *       [Folder] Master    (same albums)
 *       [Folder] Doctorate (same albums)
 *     [Folder] PM          (same degree folders + albums)
 *
 * ── PRIVACY ───────────────────────────────────────────────────────────────
 * All created nodes default to "Unlisted" — accessible by direct link only,
 * not searchable or publicly listed. Change CONFIG.privacy to "Public" or
 * "Private" if needed.
 */

'use strict';

const https  = require('https');
const crypto = require('crypto');

// ─── CONFIG — edit this for each event ────────────────────────────────────────
const CONFIG = {
  // The top-level folder name. This appears at your SmugMug account root.
  // Use something clear: school, term, year.
  eventName: 'UOPX Spring 2026',

  // Sessions (will become sub-folders under eventName)
  sessions: ['AM', 'PM'],

  // Degree types (will become sub-folders under each session)
  degrees: ['Associate', 'Bachelor', 'Master', 'Doctorate'],

  // Alphabetical ranges (each becomes a Gallery/Album under each degree)
  alphaRanges: ['A-C', 'D-F', 'G-I', 'J-L', 'M-O', 'P-R', 'S-U', 'V-Z'],

  // Privacy for all created folders and albums.
  // Options: "Public" | "Unlisted" | "Private"
  // "Unlisted" = accessible by direct link only (recommended for client delivery)
  privacy: 'Unlisted',

  // Milliseconds to wait between API calls (respect SmugMug rate limits)
  delayMs: 150,
};

// ─── Credentials (from environment) ───────────────────────────────────────────
const CREDS = {
  consumerKey:    process.env.SMUGMUG_CONSUMER_KEY    || '',
  consumerSecret: process.env.SMUGMUG_CONSUMER_SECRET || '',
  accessToken:    process.env.SMUGMUG_ACCESS_TOKEN    || '',
  accessSecret:   process.env.SMUGMUG_ACCESS_SECRET   || '',
  username:       process.env.SMUGMUG_USERNAME        || '',
};

const DRY_RUN = !process.argv.includes('--create');
const API_BASE = 'https://api.smugmug.com';

// ─── Logging ───────────────────────────────────────────────────────────────────
const log = [];
function record(action, url, status, note = '') {
  const entry = { ts: new Date().toISOString(), action, url, status, note };
  log.push(entry);
  const icon = status >= 200 && status < 300 ? '✓' : status === 0 ? '○' : '✗';
  console.log(`  ${icon}  [${status || 'DRY'}] ${action}: ${note || url}`);
}

// ─── OAuth 1.0a signing ────────────────────────────────────────────────────────
function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g,  '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function buildOAuthHeader(method, url, body = null) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const ts    = String(Math.floor(Date.now() / 1000));

  const oauthParams = {
    oauth_consumer_key:     CREDS.consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        ts,
    oauth_token:            CREDS.accessToken,
    oauth_version:          '1.0',
  };

  // Parse URL query params into sig calculation
  const [baseUrl, urlQs] = url.split('?');
  const sigParams = { ...oauthParams };
  if (urlQs) {
    for (const [k, v] of new URLSearchParams(urlQs)) sigParams[k] = v;
  }
  // NOTE: JSON body params are NOT included in OAuth sig (only form-encoded bodies are)

  const sortedPairs = Object.entries(sigParams)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join('&');

  const baseString = `${method.toUpperCase()}&${pct(baseUrl)}&${pct(sortedPairs)}`;
  const signingKey = `${pct(CREDS.consumerSecret)}&${pct(CREDS.accessSecret)}`;
  oauthParams.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  return 'OAuth realm="https://api.smugmug.com/", ' +
    Object.entries(oauthParams).map(([k, v]) => `${k}="${pct(v)}"`).join(', ');
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
function httpRequest(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const fullUrl   = url.startsWith('http') ? url : `${API_BASE}${url}`;
    const authHdr   = buildOAuthHeader(method, fullUrl, body);
    const parsed    = new URL(fullUrl);
    const bodyStr   = body ? JSON.stringify(body) : null;

    const headers = {
      'Authorization': authHdr,
      'Accept':        'application/json',
      'User-Agent':    'FF-Tank/1.0',
    };
    if (bodyStr) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method,
      headers,
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data), raw: data });
        } catch {
          resolve({ status: res.statusCode, json: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── SmugMug API helpers ───────────────────────────────────────────────────────

// Get the authenticated user's root node ID
async function getRootNodeId() {
  const url = '/api/v2!authuser?_expand=Node';
  const r = await httpRequest('GET', url);
  if (r.status !== 200) throw new Error(`authuser failed (${r.status}): ${r.raw.slice(0, 300)}`);
  const nodeUri = r.json?.Response?.User?.Uris?.Node?.Uri || '';
  // nodeUri looks like /api/v2/node/AbCdEf
  const nodeId = nodeUri.split('/').pop();
  if (!nodeId) throw new Error('Could not find root node URI in authuser response');
  return { nodeId, user: r.json?.Response?.User };
}

// List children of a node (returns array of {Name, UrlName, NodeID, Type, WebUri, Uri})
async function listChildren(nodeId) {
  let allChildren = [];
  let start = 1;
  const count = 100;

  while (true) {
    const url = `/api/v2/node/${nodeId}!children?count=${count}&start=${start}&_expand=Node`;
    const r = await httpRequest('GET', url);
    if (r.status !== 200) {
      if (r.status === 404) return []; // no children yet
      throw new Error(`listChildren(${nodeId}) failed (${r.status}): ${r.raw.slice(0, 300)}`);
    }
    const nodes = r.json?.Response?.Node || [];
    const arr = Array.isArray(nodes) ? nodes : [nodes];
    allChildren = allChildren.concat(arr.map(n => ({
      name:    n.Name,
      urlName: n.UrlName,
      nodeId:  n.NodeID,
      type:    n.Type,
      webUri:  n.WebUri,
      uri:     n.Uri,
    })));

    const pages = r.json?.Response?.Pages;
    if (!pages || start + count - 1 >= pages.Total) break;
    start += count;
    await sleep(CONFIG.delayMs);
  }
  return allChildren;
}

// Find a child node by UrlName under parentNodeId (case-insensitive)
async function findChild(parentNodeId, urlName) {
  const children = await listChildren(parentNodeId);
  return children.find(c => c.urlName?.toLowerCase() === urlName.toLowerCase()) || null;
}

// Create a node (folder or album) under parentNodeId
// Returns { nodeId, webUri, name, type, urlName }
async function createNode(parentNodeId, name, type, urlName) {
  const url  = `/api/v2/node/${parentNodeId}!children`;
  const body = {
    Type:        type,   // "Folder" or "Album"
    Name:        name,
    UrlName:     urlName,
    Privacy:     CONFIG.privacy,
    SortMethod:  'Name',
    SortDirection: 'Ascending',
    ...(type === 'Folder' ? { SecurityType: 'None' } : {}),
  };

  const r = await httpRequest('POST', url, body);
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`createNode "${name}" (${r.status}): ${r.raw.slice(0, 400)}`);
  }
  const node = r.json?.Response?.Node;
  return {
    nodeId:  node?.NodeID,
    webUri:  node?.WebUri,
    name:    node?.Name,
    type:    node?.Type,
    urlName: node?.UrlName,
  };
}

// Find existing or create new — safe idempotent create
async function findOrCreate(parentNodeId, name, type, urlName) {
  const existing = await findChild(parentNodeId, urlName);
  if (existing) {
    record('SKIP (exists)', existing.uri, 200, `${type} "${name}" already exists`);
    return existing;
  }
  await sleep(CONFIG.delayMs);
  const created = await createNode(parentNodeId, name, type, urlName);
  record('CREATE', `/api/v2/node/${parentNodeId}!children`, 201, `${type} "${name}" → ${created.webUri}`);
  return created;
}

// ─── URL slug helpers ──────────────────────────────────────────────────────────
function slugify(str) {
  return str
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// ─── Generate plan (for dry run display and actual creation) ───────────────────
function buildPlan(eventName, sessions, degrees, alphaRanges) {
  const plan = [];
  const eventSlug = slugify(eventName);

  plan.push({ depth: 0, type: 'Folder', name: eventName, slug: eventSlug });

  for (const session of sessions) {
    const sessionSlug = slugify(session);
    plan.push({ depth: 1, type: 'Folder', name: session, slug: sessionSlug, parent: eventSlug });

    for (const degree of degrees) {
      const degreeSlug = slugify(degree);
      plan.push({ depth: 2, type: 'Folder', name: degree, slug: degreeSlug, parent: sessionSlug });

      for (const range of alphaRanges) {
        const rangeSlug = slugify(range);
        plan.push({ depth: 3, type: 'Album', name: range, slug: rangeSlug, parent: degreeSlug });
      }
    }
  }
  return plan;
}

function printDryRun(plan, username) {
  const indent = d => '  '.repeat(d);
  const icon   = t => t === 'Album' ? '📷' : '📁';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  DRY RUN — nothing will be created');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  Location: https://${username}.smugmug.com (account root)\n`);
  console.log('  Proposed structure:\n');

  let albums = 0, folders = 0;
  for (const node of plan) {
    const url = node.depth === 3
      ? `  → https://${username}.smugmug.com/[path]/${node.slug}`
      : '';
    console.log(`${indent(node.depth + 1)}${icon(node.type)} [${node.type}] ${node.name}${url}`);
    node.type === 'Album' ? albums++ : folders++;
  }

  const totalAlbums  = CONFIG.sessions.length * CONFIG.degrees.length * CONFIG.alphaRanges.length;
  const totalFolders = 1 + CONFIG.sessions.length + CONFIG.sessions.length * CONFIG.degrees.length;

  console.log(`\n  Summary:`);
  console.log(`    ${totalFolders} folders (1 event + ${CONFIG.sessions.length} sessions + ${CONFIG.sessions.length * CONFIG.degrees.length} degree)`);
  console.log(`    ${totalAlbums} albums (${CONFIG.sessions.length} sessions × ${CONFIG.degrees.length} degrees × ${CONFIG.alphaRanges.length} alpha ranges)`);
  console.log(`    ${totalFolders + totalAlbums} total nodes to create`);
  console.log(`    Privacy: ${CONFIG.privacy}`);
  console.log('\n  To actually create this, run:');
  console.log('    node scripts/smugmug-commencement-setup.js --create\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ─── Validate credentials ──────────────────────────────────────────────────────
function checkCredentials() {
  const missing = Object.entries(CREDS)
    .filter(([, v]) => !v)
    .map(([k]) => `SMUGMUG_${k.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '')}`);
  if (missing.length) {
    console.error('\n❌  Missing required environment variables:');
    missing.forEach(k => console.error(`    ${k}`));
    console.error('\nRun: SMUGMUG_CONSUMER_KEY=xxx ... node scripts/smugmug-commencement-setup.js');
    console.error('(Run smugmug-auth.js first if you need access tokens)\n');
    process.exit(1);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  checkCredentials();

  const plan = buildPlan(CONFIG.eventName, CONFIG.sessions, CONFIG.degrees, CONFIG.alphaRanges);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SmugMug Commencement Structure Builder');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (read-only)' : '⚡ LIVE CREATE'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (DRY_RUN) {
    // In dry-run mode, just connect to verify auth and show plan (no creates)
    console.log('\nVerifying SmugMug connection...');
    const { nodeId: rootId, user } = await getRootNodeId();
    const nickname = user?.NickName || CREDS.username;
    console.log(`✓  Connected as: ${user?.DisplayName || nickname} (${nickname})`);
    console.log(`✓  Root node: ${rootId}`);

    console.log('\nReading existing top-level folders (to confirm your FF gallery is untouched)...');
    const topLevel = await listChildren(rootId);
    if (topLevel.length > 0) {
      console.log(`  Found ${topLevel.length} existing top-level items:`);
      topLevel.forEach(n => console.log(`    ${n.type === 'Album' ? '📷' : '📁'} ${n.name} (${n.type}) — ${n.webUri || n.urlName}`));
    } else {
      console.log('  (account root appears empty)');
    }

    printDryRun(plan, nickname);
    return;
  }

  // ── LIVE CREATE ──────────────────────────────────────────────────────────────
  console.log('\nConnecting to SmugMug...');
  const { nodeId: rootId, user } = await getRootNodeId();
  const nickname = user?.NickName || CREDS.username;
  console.log(`✓  Connected as: ${user?.DisplayName || nickname}`);
  console.log(`✓  Root node: ${rootId}\n`);

  console.log('Scanning existing top-level structure (safety check)...');
  const topLevel = await listChildren(rootId);
  console.log(`  ${topLevel.length} existing top-level items found. Only creating NEW nodes.`);
  console.log('\nCreating structure:\n');

  const createdUrls = [];

  // 1. Event folder (top-level)
  const eventSlug   = slugify(CONFIG.eventName);
  const eventNode   = await findOrCreate(rootId, CONFIG.eventName, 'Folder', eventSlug);
  await sleep(CONFIG.delayMs);

  for (const session of CONFIG.sessions) {
    const sessionSlug  = slugify(session);
    const sessionNode  = await findOrCreate(eventNode.nodeId, session, 'Folder', sessionSlug);
    await sleep(CONFIG.delayMs);

    for (const degree of CONFIG.degrees) {
      const degreeSlug  = slugify(degree);
      const degreeNode  = await findOrCreate(sessionNode.nodeId, degree, 'Folder', degreeSlug);
      await sleep(CONFIG.delayMs);

      for (const range of CONFIG.alphaRanges) {
        const rangeSlug = slugify(range);
        const album     = await findOrCreate(degreeNode.nodeId, range, 'Album', rangeSlug);
        await sleep(CONFIG.delayMs);

        if (album.webUri) {
          createdUrls.push({
            path: `${CONFIG.eventName} / ${session} / ${degree} / ${range}`,
            url:  album.webUri,
          });
        }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const created = log.filter(l => l.action === 'CREATE').length;
  const skipped = log.filter(l => l.action.startsWith('SKIP')).length;
  const errors  = log.filter(l => l.status >= 400 || l.status < 0).length;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅  Done');
  console.log(`  Created: ${created}  |  Skipped (already existed): ${skipped}  |  Errors: ${errors}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (createdUrls.length > 0) {
    console.log('\n  Gallery URLs (direct links for sharing):\n');
    createdUrls.forEach(({ path, url }) => {
      console.log(`  ${path}`);
      console.log(`    ${url}\n`);
    });
  }

  console.log('\n  Full action log:');
  log.forEach(l => console.log(`    [${l.ts.slice(11, 19)}] ${l.action} — ${l.note || l.url}`));
  console.log('');
}

main().catch(e => {
  console.error('\n❌  Fatal error:', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
