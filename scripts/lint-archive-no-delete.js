#!/usr/bin/env node
/**
 * lint-archive-no-delete.js
 *
 * F-3 Phase 2 PR 2.0 / 2.2c (codex r1 + r2) — archive worker code discipline guard。
 *
 * 設計依據 docs/AUDIT_RETENTION_PLAN.md v11：
 *   R2 平台限制下，token PUT-only / Object Lock 強制 / Bucket Lock 擋 owner DELETE
 *   全部「不支援」。第 2 道防線是「archive worker code discipline」，由 lint +
 *   code review 強制：
 *     1. 禁用 .delete()（PR 2.0）
 *     2. R2 PUT 必走 archivePut wrapper（PR 2.2c A）— 否則丟 retry + upload_failed audit
 *     3. 禁 DELETE FROM audit_log / audit_archive_chunks（PR 2.2c B）— purge 走 PR 2.3
 *
 * Patterns、ALLOW_TAGS、scan globs、helpers 都在 scripts/_archive-lint-patterns.js
 * （PR 2.2c r1 L-2 抽出共用）；eslint.config.js 同 import。
 *
 * Pattern dispatch by scope：
 *   scope='line'   逐行掃，per-line ALLOW_TAG 同行豁免
 *   scope='source' 整個 source 掃（codex r2 M-1' 跨行 SQL），match span 任一行
 *                  含 ALLOW_TAG 才豁免
 *
 * 任一命中 → exit code 1。
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
  findSourceMatch,
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

function reportViolation(file, lineNum, lineText, pattern, extraNote) {
  violations++
  const rel = path.relative(ROOT, file)
  console.error(`[archive-no-delete] ${rel}:${lineNum}: [${pattern.kind}] forbidden ${pattern.desc}`)
  if (lineText) console.error(`    > ${lineText.trim()}`)
  if (extraNote) console.error(`    ${extraNote}`)
  console.error(`    同行豁免 tag: // ${ALLOW_TAGS[pattern.kind]}（僅限合法例外，目前只給 utils#putWithRetry 用 archive-put-allow）`)
}

function scan(file) {
  scanned++
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split(/\r?\n/)

  // ── source-scope patterns（如 SQL multiline DELETE） ────────────
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.scope !== 'source') continue
    const m = findSourceMatch(src, lines, pattern)
    if (!m || m.waived) continue
    const extraNote = m.startLine !== m.endLine
      ? `(spans lines ${m.startLine}-${m.endLine}; 任一行加 tag 即豁免)`
      : null
    reportViolation(file, m.startLine, m.snippet, pattern, extraNote)
  }

  // ── line-scope patterns（R2 method 等） ──────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentLine(line)) continue
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.scope !== 'line') continue
      if (isWaived(line, pattern)) continue
      pattern.re.lastIndex = 0
      if (pattern.re.test(line)) {
        reportViolation(file, i + 1, line, pattern, null)
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
