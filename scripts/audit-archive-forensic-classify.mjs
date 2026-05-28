#!/usr/bin/env node
// PR 0.2c full prod lock — forensic classify helper
//
// 用途：§4.3「formal-prefix object found」hard-stop SOP Step 2
//   給定一個 R2 found-key + audit_archive_chunks rows dump → 看是否 derive 自任一 chunk row
//   （raw audit_log / admin_audit_log / aggregate telemetry / aggregate debug 全覆蓋）
//   報出 matching row + 哪個 key kind（data / manifest legacy / manifest state-suffix）
//
// **inline-port** of:
//   - functions/utils/audit-archive.ts#deriveKeysFromChunk + archivePrefixes + manifestSuffix + archiveExtension
//   - functions/utils/audit-aggregate-archive.ts#deriveAggregateKeysFromChunk + aggregatePrefixes + aggregateManifestSuffix
//
// **drift 防護**：tests/audit-archive-forensic-classify-parity.test.ts 對齊 canonical TS function
//   多筆 fixture，任一公式 drift → CI 紅燈。本檔修改必同步更新該 parity test。
//
// CLI:
//   node scripts/audit-archive-forensic-classify.mjs \
//     --found-key="<full-key-path>" \
//     --chunks-json="<path-to-wrangler-d1-execute-dump.json>"
//
// 輸出（stdout JSON）：
//   { found_key, matches: [{ row, key_kind, derived_key }], no_match: bool }
//
// Exit code：0 = success（不論是否 match）；非 0 = arg / file parse error

import { readFileSync, realpathSync } from 'node:fs'
import { argv } from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ─── inline-port: constants (audit-archive.ts:139-150) ──────────────────────
const KEY_SCHEME_LEGACY = 1
const KEY_SCHEME_WRITE_ONCE = 2
const MANIFEST_STATE_FILES = Object.freeze([
  'planned',
  'uploaded',
  'verified',
  'marked_archived',
])

// ─── inline-port: archive prefixes (audit-archive.ts:271-276) ───────────────
function archivePrefixes(dryRun) {
  if (dryRun) return { data: 'audit-log-dryrun', manifest: 'manifest-dryrun' }
  return { data: 'audit-log', manifest: 'manifest' }
}

// ─── inline-port: aggregate prefixes (audit-aggregate-archive.ts:175-187) ───
function aggregatePrefixes(dryRun, coldClass) {
  const variant = coldClass === 'aggregate_telemetry' ? 'telemetry' : 'debug'
  if (dryRun) return { data: `audit-log-aggregate-${variant}-dryrun`, manifest: 'manifest-dryrun' }
  return { data: `audit-log-aggregate-${variant}`, manifest: 'manifest' }
}

// ─── inline-port: extension (audit-archive.ts:260-262) ──────────────────────
function archiveExtension(compression) {
  return compression === 'gzip' ? '.jsonl.gz' : '.jsonl'
}

// ─── inline-port: manifestSuffix (audit-archive.ts:155-166) ─────────────────
function manifestSuffix(manifestState, keyScheme) {
  if (Number(keyScheme) === KEY_SCHEME_WRITE_ONCE) {
    if (!manifestState) throw new Error(`forensic: manifestState required when keyScheme=${KEY_SCHEME_WRITE_ONCE}`)
    if (!MANIFEST_STATE_FILES.includes(manifestState)) throw new Error(`forensic: unknown manifestState '${manifestState}'`)
    return `.${manifestState}.json`
  }
  return '.json'
}

// ─── derive ALL candidate keys for a chunks row ─────────────────────────────
// 對 key_scheme=1：dataKey + 1 manifestKey (.json)
// 對 key_scheme=2：dataKey + 4 manifestKey (.{planned,uploaded,verified,marked_archived}.json)
function deriveAllKeysForRow(row) {
  const tableName = String(row.table_name)
  const isAggregate = tableName === 'audit_log_aggregate_telemetry' || tableName === 'audit_log_aggregate_debug'
  const dryRun = row.dry_run === 1 || row.dry_run === true
  const compression = row.compression ?? 'none'
  const keyScheme = Number(row.key_scheme ?? KEY_SCHEME_LEGACY)
  const [yyyy, mm, dd] = String(row.archive_date).split('-')
  const tail = `${row.min_id}-${row.max_id}-${row.chunk_sha256}`
  const ext = archiveExtension(compression)

  const candidates = []
  if (isAggregate) {
    const { data, manifest } = aggregatePrefixes(dryRun, row.cold_class)
    // aggregate dataKey 不嵌 table_name / cold_class（已在 prefix）
    candidates.push({ key_kind: 'aggregate_data', derived_key: `${data}/${row.env}/${yyyy}/${mm}/${dd}/${tail}${ext}` })
    if (keyScheme === KEY_SCHEME_WRITE_ONCE) {
      for (const state of MANIFEST_STATE_FILES) {
        candidates.push({
          key_kind: `aggregate_manifest_${state}`,
          derived_key: `${manifest}/${row.env}/${tableName}/${yyyy}/${mm}/${dd}/${tail}.${state}.json`,
        })
      }
    } else {
      candidates.push({
        key_kind: 'aggregate_manifest_legacy',
        derived_key: `${manifest}/${row.env}/${tableName}/${yyyy}/${mm}/${dd}/${tail}.json`,
      })
    }
  } else {
    const { data, manifest } = archivePrefixes(dryRun)
    candidates.push({
      key_kind: 'raw_data',
      derived_key: `${data}/${row.env}/${tableName}/${row.cold_class}/${yyyy}/${mm}/${dd}/${tail}${ext}`,
    })
    if (keyScheme === KEY_SCHEME_WRITE_ONCE) {
      for (const state of MANIFEST_STATE_FILES) {
        candidates.push({
          key_kind: `raw_manifest_${state}`,
          derived_key: `${manifest}/${row.env}/${tableName}/${row.cold_class}/${yyyy}/${mm}/${dd}/${tail}.${state}.json`,
        })
      }
    } else {
      candidates.push({
        key_kind: 'raw_manifest_legacy',
        derived_key: `${manifest}/${row.env}/${tableName}/${row.cold_class}/${yyyy}/${mm}/${dd}/${tail}.json`,
      })
    }
  }
  return candidates
}

// ─── argv parse ─────────────────────────────────────────────────────────────
function parseArgs(args) {
  const out = {}
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function loadChunksJson(path) {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw)
  // wrangler d1 execute --json 輸出 [{ results: [...rows] }] 或 { result: [{ results: [...] }] }
  // 我們接受兩種 shape + 直接 array
  if (Array.isArray(parsed)) {
    if (parsed.length === 1 && parsed[0]?.results) return parsed[0].results
    return parsed
  }
  if (parsed?.result?.[0]?.results) return parsed.result[0].results
  if (parsed?.results) return parsed.results
  throw new Error('forensic: chunks-json shape unrecognized; expected [{results:[...]}] or [{...row}, ...]')
}

// ─── main ───────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(argv.slice(2))
  if (!args['found-key'] || !args['chunks-json']) {
    console.error('Usage: node scripts/audit-archive-forensic-classify.mjs --found-key="<key>" --chunks-json="<path>"')
    process.exit(2)
  }
  const foundKey = args['found-key']
  const rows = loadChunksJson(args['chunks-json'])

  const matches = []
  for (const row of rows) {
    const candidates = deriveAllKeysForRow(row)
    for (const c of candidates) {
      if (c.derived_key === foundKey) {
        matches.push({ row, key_kind: c.key_kind, derived_key: c.derived_key })
      }
    }
  }

  const result = {
    found_key: foundKey,
    matches,
    no_match: matches.length === 0,
    chunks_scanned: rows.length,
  }
  console.log(JSON.stringify(result, null, 2))
}

// Only run main() when executed directly (not when imported for parity test)
function isExecutedAsMain() {
  if (!argv[1]) return false
  try {
    const selfPath = realpathSync(fileURLToPath(import.meta.url))
    const argvPath = realpathSync(path.resolve(argv[1]))
    return selfPath === argvPath
  } catch {
    return false
  }
}

if (isExecutedAsMain()) main()

// Exported for parity test（同檔 main + helpers 重用）
export { deriveAllKeysForRow, archivePrefixes, aggregatePrefixes, archiveExtension, manifestSuffix, MANIFEST_STATE_FILES, KEY_SCHEME_LEGACY, KEY_SCHEME_WRITE_ONCE }
