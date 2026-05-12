#!/usr/bin/env node
/**
 * lint-archive-no-delete.js
 *
 * F-3 Phase 2 PR 2.0 / 2.2c (codex r1) — archive worker code discipline guard。
 *
 * 設計依據 docs/AUDIT_RETENTION_PLAN.md v11：
 *   R2 平台限制下，token PUT-only / Object Lock 強制 / Bucket Lock 擋 owner DELETE
 *   全部「不支援」。第 2 道防線是「archive worker code discipline」，由 lint +
 *   code review 強制：
 *     1. 禁用 .delete()（PR 2.0）
 *     2. R2 PUT 必走 archivePut wrapper（PR 2.2c A）— 否則丟 retry + upload_failed audit
 *     3. 禁 DELETE FROM audit_log / audit_archive_chunks（PR 2.2c B）— purge 走 PR 2.3
 *
 * Patterns、ALLOW_TAGS、scan globs 都在 scripts/_archive-lint-patterns.js（PR 2.2c
 * codex r1 L-2 抽出共用，eslint.config.js 同 import — 雙份同步負擔歸零）。
 *
 * 任一命中 → exit code 1，build / CI fail。
 * Per-kind 同行豁免 tag：archive-put-allow / archive-delete-allow / archive-sql-allow。
 * utils putWithRetry line 317 用 archive-put-allow（唯一合法 bare bucket.put site）。
 */

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import {
  FORBIDDEN_PATTERNS,
  ALLOW_TAGS,
  SCAN_GLOBS,
  FILE_PATTERN,
  isWaived,
  isCommentLine,
} from './_archive-lint-patterns.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

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
    if (isCommentLine(line)) continue
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (isWaived(line, pattern)) continue   // per-kind tag 豁免
      pattern.re.lastIndex = 0
      if (pattern.re.test(line)) {
        violations++
        const rel = path.relative(ROOT, file)
        console.error(`[archive-no-delete] ${rel}:${i + 1}: [${pattern.kind}] forbidden ${pattern.desc}`)
        console.error(`    > ${line.trim()}`)
        console.error(`    同行豁免 tag: // ${ALLOW_TAGS[pattern.kind]}（僅限合法例外，目前只給 utils#putWithRetry 用）`)
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
  console.error(`\n[archive-no-delete] ${violations} violation(s) across ${scanned} file(s) — build aborted.`)
  console.error('  詳見 docs/AUDIT_RETENTION_PLAN.md v11 §「PR 2 archive worker 必須加的 code discipline」 + scripts/_archive-lint-patterns.js。')
  process.exit(1)
}

console.log(`[archive-no-delete] ok — ${scanned} file(s) clean.`)
