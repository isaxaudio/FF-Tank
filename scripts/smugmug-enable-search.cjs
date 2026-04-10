#!/usr/bin/env node
/**
 * Enables Searchable + WorldSearchable on every album under UOPX Spring 2026.
 * Traverses the folder tree, finds all 64 albums, patches each one.
 */
'use strict';

const https  = require('https');
const crypto = require('crypto');

const CREDS = {
  consumerKey:    process.env.SMUGMUG_CONSUMER_KEY    || '',
  consumerSecret: process.env.SMUGMUG_CONSUMER_SECRET || '',
  accessToken:    process.env.SMUGMUG_ACCESS_TOKEN    || '',
  accessSecret:   process.env.SMUGMUG_ACCESS_SECRET   || '',
};

const EVENT_FOLDER_URL_NAME = 'UOPX-Spring-2026';
const API_BASE = 'https://api.smugmug.com';

function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');
}

function buildOAuthHeader(method, url) {
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
  const [baseUrl, urlQs] = url.split('?');
  const sigParams = { ...oauthParams };
  if (urlQs) for (const [k, v] of new URLSearchParams(urlQs)) sigParams[k] = v;
  const sortedPairs = Object.entries(sigParams).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${pct(k)}=${pct(v)}`).join('&');
  const baseString = `${method.toUpperCase()}&${pct(baseUrl)}&${pct(sortedPairs)}`;
  const signingKey = `${pct(CREDS.consumerSecret)}&${pct(CREDS.accessSecret)}`;
  oauthParams.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  return 'OAuth realm="https://api.smugmug.com/", ' + Object.entries(oauthParams).map(([k,v])=>`${k}="${pct(v)}"`).join(', ');
}

function httpRequest(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    const authHdr = buildOAuthHeader(method, fullUrl);
    const parsed  = new URL(fullUrl);
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Authorization': authHdr, 'Accept': 'application/json', 'User-Agent': 'FF-Tank/1.0' };
    if (bodyStr) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(bodyStr); }
    const req = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method, headers }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, json: null, raw: data }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function listChildren(nodeId) {
  const r = await httpRequest('GET', `/api/v2/node/${nodeId}!children?count=100`);
  if (r.status !== 200) return [];
  const nodes = r.json?.Response?.Node || [];
  return (Array.isArray(nodes) ? nodes : [nodes]).map(n => ({
    name: n.Name, urlName: n.UrlName, nodeId: n.NodeID, type: n.Type
  }));
}

// Recursively collect all Album nodes under a given nodeId
async function collectAlbums(nodeId, path) {
  const children = await listChildren(nodeId);
  await sleep(120);
  let albums = [];
  for (const child of children) {
    if (child.type === 'Album') {
      albums.push({ ...child, path });
    } else if (child.type === 'Folder') {
      const sub = await collectAlbums(child.nodeId, `${path}/${child.name}`);
      albums = albums.concat(sub);
    }
  }
  return albums;
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Enable Search on UOPX Spring 2026 galleries');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get root node
  const r = await httpRequest('GET', '/api/v2!authuser');
  const nodeUri = r.json?.Response?.User?.Uris?.Node?.Uri || '';
  const rootId  = nodeUri.split('/').pop();
  console.log(`✓  Root node: ${rootId}`);

  // Find the event folder
  const topLevel = await listChildren(rootId);
  const eventFolder = topLevel.find(c => c.urlName === EVENT_FOLDER_URL_NAME);
  if (!eventFolder) { console.error(`❌  Could not find folder: ${EVENT_FOLDER_URL_NAME}`); process.exit(1); }
  console.log(`✓  Found: ${eventFolder.name} (node ${eventFolder.nodeId})\n`);

  // Collect all albums under it
  console.log('Scanning structure for albums...');
  const albums = await collectAlbums(eventFolder.nodeId, eventFolder.name);
  console.log(`✓  Found ${albums.length} albums\n`);
  console.log('Enabling search on each album:\n');

  let ok = 0, failed = 0;
  for (const album of albums) {
    // Get the album URI from the node
    const nodeR = await httpRequest('GET', `/api/v2/node/${album.nodeId}?_expand=Album`);
    await sleep(120);
    const albumUri = nodeR.json?.Response?.Node?.Uris?.Album?.Uri;
    if (!albumUri) {
      console.log(`  ✗  ${album.path}/${album.name} — could not find album URI`);
      failed++;
      continue;
    }

    // PATCH the album
    const patchR = await httpRequest('PATCH', albumUri, {
      Searchable:      true,
      WorldSearchable: true,
    });
    await sleep(120);

    if (patchR.status === 200) {
      console.log(`  ✓  ${album.path}/${album.name}`);
      ok++;
    } else {
      console.log(`  ✗  ${album.path}/${album.name} — ${patchR.status}`);
      failed++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Done — ${ok} enabled, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
