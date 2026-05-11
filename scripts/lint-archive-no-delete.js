#!/usr/bin/env node
/**
 * lint-archive-no-delete.js
 *
 * F-3 Phase 2 PR 2.0 — archive worker code discipline guard。
 *
 * 設計依據 docs/AUDIT_RETENTION_PLAN.md v11：
 *   R2 平台限制下，token PUT-only / Object Lock 強制 / Bucket Lock 擋 owner DELETE
 *   全部「不支援」。因此第 2 道防線是「archive worker code 禁用 .delete()」，
 *   由 lint + code review 強制。任何需要刪 R2 物件的場景走 admin 獨立 endpoint，
 *   不在 archive worker codepath。
 *
 * 掃描範圍（archive worker code path）：
 *   functions/api/admin/cron/audit-archive*.js
 *   functions/utils/audit-archive*.js
 *
 * 偵測 pattern（粗 grep，故意 over-trigger 安全勝過 under）：
 *   AUDIT_ARCHIVE_BUCKET.delete(            ← 直接呼叫
 *   AUDIT_ARCHIVE_BUCKET['delete']          ← bracket access
 *   AUDIT_ARCHIVE_BUCKET["delete"]
 *   const { delete... = ...AUDIT_ARCHIVE_BUCKET → 解構（粗篩）
 *   bucket.delete(                          ← 取了 alias 後呼叫
 *
 * 任一命中 → exit code 1，build / CI fail。
 * 例外註解："archive-no-delete-allow"（同行 comment）— 但 PR 2.0 階段不該有任何例外。
 */

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SCAN_GLOBS = [
  'functions/api/admin/cron',
  'functions/utils',
]
const FILE_PATTERN = /^audit-archive.*\.js$/

const FORBIDDEN_PATTERNS = [
  { re: /AUDIT_ARCHIVE_BUCKET\s*\.\s*delete\s*\(/g,           desc: 'AUDIT_ARCHIVE_BUCKET.delete()' },
  { re: /AUDIT_ARCHIVE_BUCKET\s*\[\s*['"]delete['"]\s*\]/g,   desc: "AUDIT_ARCHIVE_BUCKET['delete']" },
  // alias 化 R2 binding 後呼叫 .delete(
  // 例：const bucket = env.AUDIT_ARCHIVE_BUCKET; bucket.delete('...')
  { re: /\bbucket\s*\.\s*delete\s*\(/g,                       desc: 'bucket.delete() (alias of AUDIT_ARCHIVE_BUCKET)' },
]

const ALLOW_TAG = 'archive-no-delete-allow'

let violations = 0
let scanned    = 0

function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.isFile() && FILE_PATTERN.test(entry.name)) scan(p)
  }
}

function scan(file) {
  scanned++
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes(ALLOW_TAG)) continue
    // Skip comment lines: //... or block-comment continuation (* / *... )
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    for (const { re, desc } of FORBIDDEN_PATTERNS) {
      re.lastIndex = 0
      if (re.test(line)) {
        violations++
        const rel = path.relative(ROOT, file)
        console.error(`[archive-no-delete] ${rel}:${i + 1}: forbidden ${desc}`)
        console.error(`    > ${line.trim()}`)
      }
    }
  }
}

for (const g of SCAN_GLOBS) walk(path.join(ROOT, g))

if (scanned === 0) {
  console.error('[archive-no-delete] no archive files matched; check paths or rename pattern')
  process.exit(2)
}

if (violations > 0) {
  console.error(`[archive-no-delete] ${violations} violation(s) across ${scanned} file(s) — build aborted.`)
  console.error('  Archive worker codepath 禁用 R2 .delete()。詳見 docs/AUDIT_RETENTION_PLAN.md v11 §「PR 2 archive worker 必須加的 code discipline」。')
  process.exit(1)
}

console.log(`[archive-no-delete] ok — ${scanned} file(s) clean.`)
