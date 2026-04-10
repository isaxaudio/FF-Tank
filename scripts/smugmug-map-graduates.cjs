#!/usr/bin/env node
/**
 * SmugMug Graduate Video Mapper (Phase 2)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Reads a CSV of graduates and maps each one to the correct SmugMug gallery
 * based on session, degree type, and last name (alphabetical bucket).
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────
 *
 * Step 1: Map CSV to gallery assignments (dry run, no uploads):
 *   node scripts/smugmug-map-graduates.js --csv /path/to/graduates.csv
 *
 * Step 2: Preview the mapping:
 *   node scripts/smugmug-map-graduates.js --csv /path/to/graduates.csv --preview
 *
 * ── CSV FORMAT ─────────────────────────────────────────────────────────────
 * The CSV must have a header row. Column names are flexible (see COLUMN_MAP below).
 *
 * Minimum required columns:
 *   last_name, first_name, session, degree, video_file
 *
 * Example CSV:
 *   last_name,first_name,session,degree,video_file
 *   Anderson,Maria,AM,Bachelor,anderson_maria.mp4
 *   Chen,David,PM,Master,chen_david.mp4
 *   Williams,Sarah,AM,Associate,williams_sarah.mp4
 *
 * ── OUTPUT ─────────────────────────────────────────────────────────────────
 * Outputs a mapping table showing each graduate's target gallery path + URL.
 * Also writes a JSON file (graduates-mapped.json) ready for upload automation.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CONFIG — must match smugmug-commencement-setup.js ───────────────────────
const CONFIG = {
  eventName:   'UOPX Spring 2026',
  sessions:    ['AM', 'PM'],
  degrees:     ['Associate', 'Bachelor', 'Master', 'Doctorate'],
  alphaRanges: ['A-C', 'D-F', 'G-I', 'J-L', 'M-O', 'P-R', 'S-U', 'V-Z'],
  smugmugUsername: process.env.SMUGMUG_USERNAME || 'fatfish',
};

// ─── Column name aliases (case-insensitive) ────────────────────────────────────
// Maps various CSV column names to internal field names.
const COLUMN_MAP = {
  last_name:  ['last_name', 'lastname', 'last', 'surname', 'family_name'],
  first_name: ['first_name', 'firstname', 'first', 'given_name'],
  session:    ['session', 'ceremony', 'time', 'ceremony_time'],
  degree:     ['degree', 'degree_type', 'program', 'credential', 'award_type'],
  video_file: ['video_file', 'filename', 'file_name', 'file', 'video', 'mp4', 'media_file'],
};

// ─── Alpha range lookup ────────────────────────────────────────────────────────
// Returns the gallery name (e.g. "A-C") for a given last name initial
function getAlphaRange(lastName) {
  if (!lastName) return null;
  const initial = lastName.trim().toUpperCase().replace(/^(MC|MAC|O'|DE|DEL|VAN|VON|LA |LE |ST\.?\s*)/i, '').charAt(0);
  if (!initial || !/[A-Z]/.test(initial)) return null;

  for (const range of CONFIG.alphaRanges) {
    const [start, end] = range.split('-');
    if (initial >= start && initial <= end) return range;
  }
  return null;
}

// ─── Session normalizer ────────────────────────────────────────────────────────
function normalizeSession(raw) {
  if (!raw) return null;
  const s = raw.toString().trim().toUpperCase();
  if (s === 'AM' || s.includes('MORNING') || s === '1' || s === 'A') return 'AM';
  if (s === 'PM' || s.includes('AFTERNOON') || s.includes('EVENING') || s === '2' || s === 'B') return 'PM';
  // Check if it's one of the configured sessions exactly
  const match = CONFIG.sessions.find(sess => sess.toUpperCase() === s);
  return match || null;
}

// ─── Degree normalizer ─────────────────────────────────────────────────────────
function normalizeDegree(raw) {
  if (!raw) return null;
  const d = raw.toString().trim().toLowerCase();

  if (d.includes('associate') || d === 'aa' || d === 'as' || d === 'aas' || d.includes("associate's")) return 'Associate';
  if (d.includes('bachelor') || d === 'bs' || d === 'ba' || d === 'bsn' || d.includes("bachelor's")) return 'Bachelor';
  if (d.includes('master') || d === 'ms' || d === 'ma' || d === 'mba' || d === 'mha' || d.includes("master's")) return 'Master';
  if (d.includes('doctor') || d.includes('phd') || d === 'edd' || d === 'dnp' || d.includes('doctorate') || d === 'dba') return 'Doctorate';

  // Check if it's one of the configured degrees exactly (case-insensitive)
  const exact = CONFIG.degrees.find(deg => deg.toLowerCase() === d);
  return exact || null;
}

// ─── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(csvText) {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  // Parse header
  const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  // Find column indices using COLUMN_MAP
  const cols = {};
  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    for (const alias of aliases) {
      const idx = rawHeaders.indexOf(alias);
      if (idx !== -1) { cols[field] = idx; break; }
    }
  }

  const missing = Object.keys(COLUMN_MAP).filter(f => cols[f] === undefined && f !== 'video_file');
  if (missing.length > 0) {
    console.warn(`\n⚠  Could not find columns for: ${missing.join(', ')}`);
    console.warn(`   Available columns: ${rawHeaders.join(', ')}`);
    console.warn('   Check COLUMN_MAP in the script if your column names differ.\n');
  }

  // Parse rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted fields with commas
    const fields = [];
    let inQuote = false, current = '';
    for (const ch of line + ',') {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { fields.push(current); current = ''; continue; }
      current += ch;
    }

    rows.push({
      last_name:  fields[cols.last_name]?.trim()  || '',
      first_name: fields[cols.first_name]?.trim() || '',
      session:    fields[cols.session]?.trim()    || '',
      degree:     fields[cols.degree]?.trim()     || '',
      video_file: cols.video_file !== undefined ? (fields[cols.video_file]?.trim() || '') : '',
      _row:       i + 1,
      _raw:       line,
    });
  }
  return rows;
}

// ─── Build gallery URL from path ───────────────────────────────────────────────
function galleryUrl(session, degree, range) {
  const slugify = s => s.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  const parts = [CONFIG.eventName, session, degree, range].map(slugify);
  return `https://${CONFIG.smugmugUsername}.smugmug.com/${parts.join('/')}`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const csvIdx = args.indexOf('--csv');
  const csvPath = csvIdx !== -1 ? args[csvIdx + 1] : null;
  const doPreview = args.includes('--preview');

  if (!csvPath) {
    console.error('\nUsage:');
    console.error('  node scripts/smugmug-map-graduates.js --csv /path/to/graduates.csv');
    console.error('  node scripts/smugmug-map-graduates.js --csv /path/to/graduates.csv --preview\n');
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`\n❌  File not found: ${csvPath}\n`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  let rows;
  try {
    rows = parseCSV(csvText);
  } catch (e) {
    console.error(`\n❌  CSV parse error: ${e.message}\n`);
    process.exit(1);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SmugMug Graduate Video Mapper');
  console.log(`  Event:  ${CONFIG.eventName}`);
  console.log(`  CSV:    ${path.basename(csvPath)} (${rows.length} rows)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const mapped   = [];
  const warnings = [];

  for (const row of rows) {
    const session  = normalizeSession(row.session);
    const degree   = normalizeDegree(row.degree);
    const range    = getAlphaRange(row.last_name);
    const lastName = row.last_name.trim();
    const name     = `${lastName}, ${row.first_name}`.trim().replace(/^,\s*/, '');

    if (!session || !degree || !range) {
      warnings.push({
        row:    row._row,
        name,
        issue:  [
          !session ? `unknown session "${row.session}"` : null,
          !degree  ? `unknown degree "${row.degree}"` : null,
          !range   ? `no alpha range for last name "${lastName}"` : null,
        ].filter(Boolean).join('; '),
        raw: row._raw,
      });
      continue;
    }

    const url = galleryUrl(session, degree, range);
    mapped.push({
      name,
      last_name:  lastName,
      first_name: row.first_name,
      session,
      degree,
      range,
      gallery_path: `${CONFIG.eventName} / ${session} / ${degree} / ${range}`,
      gallery_url:  url,
      video_file:   row.video_file,
    });
  }

  // ── Stats per gallery ────────────────────────────────────────────────────────
  const byGallery = {};
  for (const g of mapped) {
    const key = `${g.session}/${g.degree}/${g.range}`;
    if (!byGallery[key]) byGallery[key] = { session: g.session, degree: g.degree, range: g.range, count: 0, graduates: [], url: g.gallery_url };
    byGallery[key].count++;
    byGallery[key].graduates.push({ name: g.name, video: g.video_file });
  }

  // ── Output: stats per gallery ────────────────────────────────────────────────
  console.log('  Gallery assignments:\n');
  for (const [key, g] of Object.entries(byGallery).sort()) {
    console.log(`  📷  ${g.session} / ${g.degree} / ${g.range}  (${g.count} graduates)`);
    console.log(`       ${g.url}`);
    if (doPreview) {
      g.graduates.forEach(gr => console.log(`         • ${gr.name}${gr.video ? '  [' + gr.video + ']' : ''}`));
    }
  }

  // ── Warnings ─────────────────────────────────────────────────────────────────
  if (warnings.length > 0) {
    console.log(`\n  ⚠  ${warnings.length} rows could not be mapped (check these manually):\n`);
    warnings.forEach(w => {
      console.log(`  Row ${w.row}: ${w.name || '(unnamed)'} — ${w.issue}`);
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const galleriesUsed = Object.keys(byGallery).length;
  const totalGalleries = CONFIG.sessions.length * CONFIG.degrees.length * CONFIG.alphaRanges.length;

  console.log('\n  Summary:');
  console.log(`    ${mapped.length} graduates mapped successfully`);
  console.log(`    ${warnings.length} rows had mapping errors`);
  console.log(`    ${galleriesUsed} of ${totalGalleries} galleries will have content`);

  // ── Write output JSON ─────────────────────────────────────────────────────────
  const outPath = path.join(path.dirname(csvPath), 'graduates-mapped.json');
  const output  = {
    event:       CONFIG.eventName,
    generated:   new Date().toISOString(),
    total:       mapped.length,
    warnings:    warnings.length,
    mapped,
    unmapped:    warnings,
    by_gallery:  Object.values(byGallery),
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n  ✓  Full mapping written to: ${outPath}`);
  console.log('     Use this JSON with the upload script for Phase 2 uploads.\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main();
