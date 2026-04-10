#!/usr/bin/env node
/**
 * SmugMug OAuth 1.0a Token Setup — Run ONCE to get your access token + secret.
 *
 * Usage:
 *   SMUGMUG_CONSUMER_KEY=xxx SMUGMUG_CONSUMER_SECRET=xxx node scripts/smugmug-auth.js
 *
 * What it does:
 *   1. Gets a request token from SmugMug
 *   2. Prints an authorization URL — open it in your browser
 *   3. You approve access and SmugMug gives you a 6-digit PIN
 *   4. Paste the PIN here, get your access token + secret
 *   5. Save those two values — you'll use them for every API write operation
 *
 * These tokens never expire. Store them as:
 *   SMUGMUG_ACCESS_TOKEN=...
 *   SMUGMUG_ACCESS_SECRET=...
 */

'use strict';

const https   = require('https');
const crypto  = require('crypto');
const readline = require('readline');
const qs      = require('querystring');

// ─── Credentials ──────────────────────────────────────────────────────────────
const CONSUMER_KEY    = process.env.SMUGMUG_CONSUMER_KEY    || '';
const CONSUMER_SECRET = process.env.SMUGMUG_CONSUMER_SECRET || '';

if (!CONSUMER_KEY || !CONSUMER_SECRET) {
  console.error('\n❌  Missing credentials. Run as:');
  console.error('    SMUGMUG_CONSUMER_KEY=xxx SMUGMUG_CONSUMER_SECRET=xxx node scripts/smugmug-auth.js\n');
  process.exit(1);
}

// ─── OAuth helpers ─────────────────────────────────────────────────────────────
function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g,  '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function oauthHeader(method, url, consumerKey, consumerSecret, token = '', tokenSecret = '', extra = {}) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const ts    = String(Math.floor(Date.now() / 1000));

  const oauthParams = {
    oauth_callback:         extra.oauth_callback || undefined,
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        ts,
    oauth_version:          '1.0',
    ...( token ? { oauth_token: token } : {} ),
    ...( extra.oauth_verifier ? { oauth_verifier: extra.oauth_verifier } : {} ),
  };
  // Remove undefined keys
  Object.keys(oauthParams).forEach(k => oauthParams[k] === undefined && delete oauthParams[k]);

  // Parse query params from URL for signature
  const [baseUrl, urlQs] = url.split('?');
  const sigParams = { ...oauthParams };
  if (urlQs) {
    for (const [k, v] of new URLSearchParams(urlQs)) sigParams[k] = v;
  }

  // Build signature base string
  const sortedPairs = Object.entries(sigParams)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join('&');

  const baseString   = `${method.toUpperCase()}&${pct(baseUrl)}&${pct(sortedPairs)}`;
  const signingKey   = `${pct(consumerSecret)}&${pct(tokenSecret)}`;
  const signature    = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  return 'OAuth realm="https://api.smugmug.com/", ' +
    Object.entries(oauthParams)
      .map(([k, v]) => `${k}="${pct(v)}"`)
      .join(', ');
}

// ─── Raw HTTP POST (form-encoded, for OAuth endpoints) ─────────────────────────
function postForm(url, authHeader) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname,
      method:   'POST',
      headers:  {
        'Authorization':  authHeader,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': 0,
        'User-Agent':     'FF-Tank/1.0',
      },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ─── Main auth flow ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SmugMug OAuth Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Step 1: Get request token
  const REQUEST_TOKEN_URL = 'https://secure.smugmug.com/services/oauth/1.0a/getRequestToken';
  const authHdr1 = oauthHeader('POST', REQUEST_TOKEN_URL, CONSUMER_KEY, CONSUMER_SECRET, '', '', { oauth_callback: 'oob' });
  console.log('Step 1: Requesting temporary token from SmugMug...');
  const r1 = await postForm(REQUEST_TOKEN_URL, authHdr1);

  if (r1.status !== 200) {
    console.error(`❌  Request token failed (${r1.status}): ${r1.body}`);
    process.exit(1);
  }
  const parsed1     = qs.parse(r1.body);
  const reqToken    = parsed1.oauth_token;
  const reqSecret   = parsed1.oauth_token_secret;

  if (!reqToken) {
    console.error('❌  Could not parse request token from:', r1.body);
    process.exit(1);
  }
  console.log('✓  Got temporary token.\n');

  // Step 2: Authorize
  const authUrl = `https://api.smugmug.com/services/oauth/1.0a/authorize?oauth_token=${reqToken}&Access=Full&Permissions=Modify`;
  console.log('Step 2: Open this URL in your browser and approve access:\n');
  console.log(`  ${authUrl}\n`);
  console.log('After approving, SmugMug will show you a 6-digit PIN.\n');

  const verifier = await prompt('Paste the PIN here: ');
  if (!verifier) { console.error('❌  No PIN entered.'); process.exit(1); }

  // Step 3: Exchange for access token
  const ACCESS_TOKEN_URL = 'https://secure.smugmug.com/services/oauth/1.0a/getAccessToken';
  const authHdr2 = oauthHeader('POST', ACCESS_TOKEN_URL, CONSUMER_KEY, CONSUMER_SECRET, reqToken, reqSecret, { oauth_verifier: verifier });
  console.log('\nStep 3: Exchanging PIN for access token...');
  const r2 = await postForm(ACCESS_TOKEN_URL, authHdr2);

  if (r2.status !== 200) {
    console.error(`❌  Access token failed (${r2.status}): ${r2.body}`);
    process.exit(1);
  }
  const parsed2       = qs.parse(r2.body);
  const accessToken   = parsed2.oauth_token;
  const accessSecret  = parsed2.oauth_token_secret;
  const displayName   = parsed2.Account_DisplayName || '';

  if (!accessToken || !accessSecret) {
    console.error('❌  Could not parse access token from:', r2.body);
    process.exit(1);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅  SUCCESS — save these tokens (they never expire):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  if (displayName) console.log(`  Account:              ${displayName}`);
  console.log(`  SMUGMUG_ACCESS_TOKEN=${accessToken}`);
  console.log(`  SMUGMUG_ACCESS_SECRET=${accessSecret}`);
  console.log('\nUse these with smugmug-commencement-setup.js like:');
  console.log('  SMUGMUG_CONSUMER_KEY=xxx \\');
  console.log('  SMUGMUG_CONSUMER_SECRET=xxx \\');
  console.log(`  SMUGMUG_ACCESS_TOKEN=${accessToken} \\`);
  console.log(`  SMUGMUG_ACCESS_SECRET=${accessSecret} \\`);
  console.log('  SMUGMUG_USERNAME=yourSmugMugNickname \\');
  console.log('  node scripts/smugmug-commencement-setup.js\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
