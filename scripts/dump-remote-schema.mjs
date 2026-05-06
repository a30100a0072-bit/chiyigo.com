#!/usr/bin/env node
// Read-only dump of prod D1 schema + _cf_d1_migrations state.
// Usage: node scripts/dump-remote-schema.mjs [--db chiyigo_db] [--out database/schema_iam_prod.sql]
//
// Output:
//   database/schema_iam_prod.sql      — CREATE TABLE / INDEX / TRIGGER / VIEW DDL (sorted, deterministic)
//   database/schema_iam_prod.meta.json — table row counts + _cf_d1_migrations rows + per-table column list
//
// Does NOT mutate anything. Safe to run anytime.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const DB = arg('--db', 'chiyigo_db');
const OUT_SQL = resolve(arg('--out', 'database/schema_iam_prod.sql'));
const OUT_META = OUT_SQL.replace(/\.sql$/, '.meta.json');

// Wrangler quirks we must work around:
// 1) `--file` path prints "Checking if file needs uploading" to stdout, polluting --json output.
// 2) On Windows with shell:true, spaces in --command split into separate argv entries.
// → Use --command, quote the whole SQL string; SQL must not contain a literal " (we use only ' inside).
// → Node 24+ requires shell:true to spawn .cmd / .bat on Windows.
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function d1(sql) {
  if (sql.includes('"')) throw new Error('SQL contains a double-quote; refactor to single-quotes only.');
  const cmdArg = process.platform === 'win32' ? `"${sql}"` : sql;
  const out = execFileSync(
    NPX,
    ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', cmdArg],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' },
  );
  // Wrangler sometimes prefixes with progress lines even on --json. Slice from first '['/'{'.
  const jsonStart = out.search(/[\[{]/);
  if (jsonStart < 0) throw new Error(`No JSON in wrangler output:\n${out}`);
  const parsed = JSON.parse(out.slice(jsonStart));
  const block = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!block?.success) throw new Error(`D1 query failed: ${sql}\n${out}`);
  return block.results ?? [];
}

console.log(`[dump] DB=${DB}`);
console.log(`[dump] querying sqlite_master ...`);

const masterRows = d1(
  `SELECT type, name, tbl_name, sql FROM sqlite_master ` +
  `WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' ` +
  `ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'view' THEN 3 WHEN 'trigger' THEN 4 ELSE 5 END, name`,
);

const tables   = masterRows.filter(r => r.type === 'table');
const indexes  = masterRows.filter(r => r.type === 'index' && r.sql); // skip auto-indexes (sql=null)
const views    = masterRows.filter(r => r.type === 'view');
const triggers = masterRows.filter(r => r.type === 'trigger');

console.log(`[dump] tables=${tables.length} indexes=${indexes.length} views=${views.length} triggers=${triggers.length}`);

// Per-table columns + row count.
// CF-internal tables (_cf_KV, _cf_METADATA, ...) deny SELECT/PRAGMA via SQLITE_AUTH; skip them gracefully.
const perTable = {};
for (const t of tables) {
  let cols = null;
  let count = null;
  try {
    const c = d1(`PRAGMA table_info(${quoteIdent(t.name)})`);
    cols = c.map(x => ({ name: x.name, type: x.type, notnull: !!x.notnull, dflt: x.dflt_value, pk: !!x.pk }));
  } catch (e) {
    cols = `ERR: ${shortErr(e)}`;
  }
  try {
    const r = d1(`SELECT COUNT(*) AS c FROM ${quoteIdent(t.name)}`);
    count = r[0]?.c ?? null;
  } catch (e) {
    count = `ERR: ${shortErr(e)}`;
  }
  perTable[t.name] = { columns: cols, row_count: count };
  const colsLabel = Array.isArray(cols) ? `cols=${cols.length}` : 'cols=ERR';
  console.log(`[dump]   ${t.name.padEnd(36)} ${colsLabel} rows=${count}`);
}

function shortErr(e) {
  const m = String(e.message || e).match(/SQLITE_AUTH|code:\s*\d+/);
  return m ? m[0] : String(e.message || e).slice(0, 80);
}

// CF migration ledger (may be empty — that's the whole point of this audit)
let cfMigrations = [];
try {
  cfMigrations = d1(`SELECT id, name, applied_at FROM _cf_d1_migrations ORDER BY id`);
} catch {
  cfMigrations = '__table_missing__';
}

// ---------- write SQL ----------
const lines = [];
lines.push(`-- prod D1 schema snapshot (read-only dump)`);
lines.push(`-- DB: ${DB}`);
lines.push(`-- Generated: ${new Date().toISOString()}`);
lines.push(`-- Source: sqlite_master ; tool: scripts/dump-remote-schema.mjs`);
lines.push(`-- DO NOT EDIT BY HAND. Re-run the script to refresh.`);
lines.push('');

lines.push(`-- =========================`);
lines.push(`-- Tables (${tables.length})`);
lines.push(`-- =========================`);
for (const t of tables) {
  lines.push(`${t.sql.trim()};`);
  lines.push('');
}

lines.push(`-- =========================`);
lines.push(`-- Indexes (${indexes.length})`);
lines.push(`-- =========================`);
for (const i of indexes) {
  lines.push(`${i.sql.trim()};`);
}
lines.push('');

if (views.length) {
  lines.push(`-- =========================`);
  lines.push(`-- Views (${views.length})`);
  lines.push(`-- =========================`);
  for (const v of views) lines.push(`${v.sql.trim()};\n`);
}

if (triggers.length) {
  lines.push(`-- =========================`);
  lines.push(`-- Triggers (${triggers.length})`);
  lines.push(`-- =========================`);
  for (const tg of triggers) lines.push(`${tg.sql.trim()};\n`);
}

mkdirSync(dirname(OUT_SQL), { recursive: true });
writeFileSync(OUT_SQL, lines.join('\n'), 'utf8');
console.log(`[dump] wrote ${OUT_SQL}`);

// ---------- write meta ----------
const meta = {
  db: DB,
  generated_at: new Date().toISOString(),
  counts: {
    tables: tables.length,
    indexes: indexes.length,
    views: views.length,
    triggers: triggers.length,
  },
  cf_d1_migrations: cfMigrations,
  tables: perTable,
};
writeFileSync(OUT_META, JSON.stringify(meta, null, 2), 'utf8');
console.log(`[dump] wrote ${OUT_META}`);

if (cfMigrations === '__table_missing__') {
  console.log(`[dump] note: _cf_d1_migrations table does not exist (no migrations apply has ever run)`);
} else {
  console.log(`[dump] _cf_d1_migrations rows: ${cfMigrations.length}`);
}

// SQLite accepts [identifier] (SQL Server compat) — avoids the " conflict with cmd quoting.
function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to quote unusual identifier: ${name}`);
  }
  return '[' + name + ']';
}
