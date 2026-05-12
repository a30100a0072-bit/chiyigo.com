#!/usr/bin/env node
/**
 * lint-archive-no-delete.js
 *
 * F-3 Phase 2 PR 2.0 / 2.2c — archive worker code discipline guard。
 *
 * 設計依據 docs/AUDIT_RETENTION_PLAN.md v11：
 *   R2 平台限制下，token PUT-only / Object Lock 強制 / Bucket Lock 擋 owner DELETE
 *   全部「不支援」。因此第 2 道防線是「archive worker code discipline」，由 lint +
 *   code review 強制：
 *     1. 禁用 .delete()（PR 2.0）
 *     2. R2 PUT 必走 archivePut wrapper（PR 2.2c，A）— 否則丟 retry + upload_failed audit
 *     3. 禁 DELETE FROM audit_log / audit_archive_chunks（PR 2.2c，B）— purge 走獨立 PR 2.3 endpoint
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
 *   AUDIT_ARCHIVE_BUCKET.put( / ['put']     ← 必走 archivePut wrapper（PR 2.2c）
 *   bucket.put(                             ← alias 後 put（PR 2.2c；utils putWithRetry 內唯一合法 site 用 ALLOW_TAG 同行豁免）
 *   DELETE FROM audit_log / audit_archive_chunks ← SQL row 刪除（PR 2.2c）
 *
 * 任一命中 → exit code 1，build / CI fail。
 * 例外註解："archive-no-delete-allow"（同行 comment）。歷史只給 .delete() 用，PR 2.2c
 * 起對「put 必走 archivePut」也共用同一 tag — 簡化 reviewer 認知（同一 tag = lint
 * 豁免），utils putWithRetry 是唯一合法 bare bucket.put 例外。
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
  // ── PR 2.0: R2 .delete() 全禁 ───────────────────────────────────
  { re: /AUDIT_ARCHIVE_BUCKET\s*\.\s*delete\s*\(/g,           desc: 'AUDIT_ARCHIVE_BUCKET.delete()' },
  { re: /AUDIT_ARCHIVE_BUCKET\s*\[\s*['"`]delete['"`]\s*\]/g, desc: "AUDIT_ARCHIVE_BUCKET['delete']" },
  // alias 化 R2 binding 後呼叫 .delete(
  // 例：const bucket = env.AUDIT_ARCHIVE_BUCKET; bucket.delete('...')
  { re: /\bbucket\s*\.\s*delete\s*\(/g,                       desc: 'bucket.delete() (alias of AUDIT_ARCHIVE_BUCKET)' },
  // alias 後用 bracket access：bucket['delete']('...') / bucket["delete"](...)
  { re: /\bbucket\s*\[\s*['"`]delete['"`]\s*\]/g,             desc: "bucket['delete'] (alias bracket access)" },
  // 解構 R2 binding 後拿 delete fn：const { delete: del } = env.AUDIT_ARCHIVE_BUCKET
  // 注意「delete」是 JS 保留字，rename 解構幾乎必然；抓 'delete' 在解構左側
  { re: /\{\s*[^}]*\bdelete\s*:\s*\w+[^}]*\}\s*=\s*[^;]*AUDIT_ARCHIVE_BUCKET/g,
    desc: 'destructured { delete: alias } = ...AUDIT_ARCHIVE_BUCKET' },

  // ── PR 2.2c (A): R2 .put() 必走 archivePut wrapper ──────────────
  // utils putWithRetry 內唯一合法 site 用同行 ALLOW_TAG 豁免。
  { re: /AUDIT_ARCHIVE_BUCKET\s*\.\s*put\s*\(/g,              desc: 'AUDIT_ARCHIVE_BUCKET.put() — must go through archivePut wrapper' },
  { re: /AUDIT_ARCHIVE_BUCKET\s*\[\s*['"`]put['"`]\s*\]/g,    desc: "AUDIT_ARCHIVE_BUCKET['put'] — must go through archivePut wrapper" },
  { re: /\bbucket\s*\.\s*put\s*\(/g,                          desc: 'bucket.put() — must go through archivePut wrapper (utils putWithRetry is the only allowed site)' },
  { re: /\bbucket\s*\[\s*['"`]put['"`]\s*\]/g,                desc: "bucket['put'] (alias bracket access) — must go through archivePut wrapper" },

  // ── PR 2.2c (B): SQL row 刪除全禁（purge 走 PR 2.3 獨立 endpoint） ──
  { re: /DELETE\s+FROM\s+audit_log\b/gi,                      desc: 'DELETE FROM audit_log — archive worker never deletes audit rows (purge: PR 2.3)' },
  { re: /DELETE\s+FROM\s+audit_archive_chunks\b/gi,           desc: 'DELETE FROM audit_archive_chunks — chunks row never deleted from archive worker (purge: PR 2.3)' },
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
