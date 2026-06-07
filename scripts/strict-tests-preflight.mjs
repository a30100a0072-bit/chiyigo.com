#!/usr/bin/env node
/**
 * strict-tests-preflight.mjs — PR-0 (Stage 7 strict zero-error gate)
 *
 * 開 tests leaf strict 前的硬性 gate。tests leaf（tsconfig.tests.json）include
 * functions/** + scripts/audit-archive-forensic-classify.mjs，所以它的 strict 數
 * 不是 standalone（含 functions 全量）。本 script 證明「functions/** 與 forensic 在
 * tests config 的 strict 下已為 0」才允許開 tests leaf strict（functions leaf 與
 * tests leaf 用相同 lib/types，functions 清零後理應為 0 — 但實證而非推論）。
 *
 * exit 0 僅當 functions===0 && forensic===0；否則 exit 1。
 * 刻意不用 `grep -c`（count 0 時 grep exit 1 會讓 shell gate 誤判，且 Windows
 * shell ergonomics 差）— 直接解析 tsc 輸出。
 *
 * 設計見 docs/plans/stage7-strict-zero-error.md §4。
 */
import { execSync } from 'node:child_process'

const CMD =
  'npx tsc -p tsconfig.tests.json --strict --noImplicitAny --composite false --incremental false --noEmit --pretty false'

let out = ''
try {
  out = execSync(CMD, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  // tsc 有 error 時 exit 非 0；診斷走 stdout
  out = (e.stdout || '') + (e.stderr || '')
}

const FILE_ERR_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:/gm
let total = 0
let functionsErr = 0
let forensicErr = 0
let testsErr = 0
let otherErr = 0
for (const m of out.matchAll(FILE_ERR_RE)) {
  total++
  const f = m[1].replace(/\\/g, '/')
  if (f.startsWith('functions/')) functionsErr++
  else if (f.startsWith('scripts/audit-archive-forensic-classify')) forensicErr++
  else if (f.startsWith('tests/')) testsErr++
  else otherErr++
}

console.log(
  `strict-tests-preflight: total=${total} functions=${functionsErr} forensic=${forensicErr} tests=${testsErr} other=${otherErr}`,
)

if (functionsErr === 0 && forensicErr === 0) {
  console.log('OK: functions/** + forensic 在 tests config strict 下為 0 — 可開 tests leaf strict')
  process.exit(0)
}
console.error('FAIL: 開 tests leaf strict 前，functions/** 與 forensic 在 tests config strict 下必須為 0')
console.error('  先讓 functions leaf strict 清零並 merge（functions 與 tests leaf 同 lib/types，理應為 0）')
process.exit(1)
