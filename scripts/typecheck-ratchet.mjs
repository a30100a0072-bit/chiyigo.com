#!/usr/bin/env node
/**
 * typecheck-ratchet.mjs — JS→TS 遷移 ratchet gate（codex r3 day-1 薄版 + r4 hardening）
 *
 * 模式：
 *   node scripts/typecheck-ratchet.mjs            CI enforce（與 baseline 比對，違規 exit 1）
 *   node scripts/typecheck-ratchet.mjs --update   重新產 baseline 寫進 types/typecheck-baseline.json
 *   node scripts/typecheck-ratchet.mjs --report   只跑量化，不 enforce、不寫檔
 *
 * day-1 規則（依 project_js_to_ts_migration.md §1.5a + §1.5g）：
 *   A. 總 error count <= baseline.errorCount
 *   B. cleanFiles >= baseline.cleanFiles（防新增 error 檔）
 *   C. diff 中所有 .js/.ts source 不得新增 suppression / any 變形 / JSDoc any
 *   D. 新增 source .js 必須在白名單 public/js/** 內
 *   E. 不得新增 src/js 下的 .ts（4.5a pipeline ready 前禁）
 *
 * r4 hardening：
 *   P1.1 BASE — current baseline 不得比 base ref 的 baseline 更弱（防同 PR 削弱 baseline）
 *   P1.2 fail-safe — tsc exit != 0 但 parser 0 errors / 只 global errors / tsconfig errors → exit 3
 *   P1.3 push base — push 時 origin/main == HEAD 自動 fallback HEAD~1
 *   P2 — git 全改 execFileSync 防注入；rename status 視為 added 擋 rename 偷渡進禁區
 *
 * 延後（依 §1.5g 不在 day-1）：per-file errorsByFile 強制 enforce、完整 tsconfig invariant、
 * Stage 4.5a classic/module 分流檢查。errorsByFile 仍會寫進 baseline，但不 enforce 個別檔。
 */

import { execSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const BASELINE_PATH = path.join(ROOT, 'types', 'typecheck-baseline.json')

const args = new Set(process.argv.slice(2))
const MODE_UPDATE = args.has('--update')
const MODE_REPORT = args.has('--report')
const SELF_FILE = 'scripts/typecheck-ratchet.mjs'
const NEW_JS_ALLOWLIST = new Set([SELF_FILE])

// ─── git helper（全 execFileSync 防 shell 注入；預設 silence stderr） ──

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...opts,
  })
}

function refResolve(ref) {
  try { return git(['rev-parse', '--verify', ref]).trim() } catch { return null }
}

// ─── 1. 跑 tsc 並 parse error 行 ────────────────────────────────────────

function runTypecheck() {
  // tsc 有錯回 exit 1 — try/catch 吃 exit code，並記下來供 fail-safe 判斷
  try {
    const out = execSync('npx tsc --noEmit --pretty false', {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { output: out, exitCode: 0 }
  } catch (e) {
    return { output: (e.stdout || '') + (e.stderr || ''), exitCode: e.status ?? 1 }
  }
}

// 例: "tests/jwt.test.js(185,20): error TS2339: ..." — 檔位置 error
const TS_FILE_ERROR_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:/gm
// 例: "error TS5023: Unknown compiler option 'foo'." — global / tsconfig-level
const TS_GLOBAL_ERROR_RE = /^error\s+TS\d+:/gm

function parseTscOutput(output) {
  const errorsByFile = Object.create(null)
  let fileErrors = 0
  for (const match of output.matchAll(TS_FILE_ERROR_RE)) {
    const file = match[1].replace(/\\/g, '/')
    errorsByFile[file] = (errorsByFile[file] || 0) + 1
    fileErrors++
  }
  const globalErrors = (output.match(TS_GLOBAL_ERROR_RE) || []).length
  return {
    totalErrors: fileErrors + globalErrors,
    fileErrors,
    globalErrors,
    errorFiles: Object.keys(errorsByFile).length,
    errorsByFile,
  }
}

// ─── 2. 統計 source 檔總數 / cleanFiles ─────────────────────────────────

function listTrackedSourceFiles() {
  const out = git(['ls-files'])
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => /\.(js|mjs|cjs|ts|mts|cts)$/.test(f))
    .filter((f) => !f.startsWith('public/'))
    .filter((f) => !f.startsWith('node_modules/'))
    .filter((f) => !f.endsWith('.d.ts'))
}

// ─── 3. canonical sorted JSON output ────────────────────────────────────

function canonicalStringify(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = v[k]; return acc }, {})
    }
    return v
  }, 2) + '\n'
}

// ─── 4. baseline 讀寫 ────────────────────────────────────────────────────

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
}

function readBaseBaseline(baseRef) {
  // P1.1：讀 base ref 上的 baseline，用來偵測「同 PR 削弱 baseline」攻擊
  try {
    const blob = git(['show', `${baseRef}:types/typecheck-baseline.json`])
    return JSON.parse(blob)
  } catch {
    return null  // base ref 沒這個檔（baseline 本身是新增 PR），P1.1 跳過
  }
}

function writeBaseline(data) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, canonicalStringify(data), 'utf8')
}

// ─── 5. suppression / any 變形 patterns（套 diff 增量行） ───────────────

const BAN_PATTERNS = [
  { name: '@ts-nocheck',     re: /@ts-nocheck\b/ },
  { name: '@ts-ignore',      re: /@ts-ignore\b/ },
  {
    name: '@ts-expect-error 無 reason',
    re: /@ts-expect-error\b/,
    pass: (line) => {
      const m = line.match(/@ts-expect-error\b(.*)$/)
      if (!m) return false
      const tail = m[1].trim()
      const r = tail.match(/^--\s+(\S.*)$/)
      if (!r) return false
      return r[1].trim().length >= 15
    },
  },
  { name: '顯式 any (: any)',          re: /:\s*any\b/ },
  { name: '顯式 any (as any)',         re: /\bas\s+any\b/ },
  { name: '顯式 any (<any>)',          re: /<any>/ },
  { name: '泛型預設 any (<T = any>)',  re: /<\s*\w+\s*=\s*any\s*>/ },
  { name: '容器 any (Array<any>)',     re: /\bArray<any>/ },
  { name: '容器 any (Record<,any>)',   re: /\bRecord<[^>]*,\s*any\s*>/ },
  { name: '容器 any (Promise<any>)',   re: /\bPromise<any>/ },
  { name: '容器 any (Map<,any>)',      re: /\bMap<[^>]*,\s*any\s*>/ },
  { name: '容器 any (Set<any>)',       re: /\bSet<any>/ },
  { name: 'JSDoc {any}',               re: /\*\s+@(?:type|param|returns?|typedef)\s+\{[^}]*\bany\b[^}]*\}/ },
  { name: 'JSDoc inline {any}',        re: /\/\*\*?\s*\{[^}]*\bany\b[^}]*\}\s*\*?\//  },
]

// ─── 6. diff 分析（CI enforce 用） ──────────────────────────────────────

function getBaseRef() {
  // 優先序：RATCHET_BASE_REF（CI 顯式注入；PR base sha 或 push before sha）
  //       → GITHUB_BASE_REF（PR base branch 名）
  //       → origin/main → HEAD~1（push 場景 fallback）
  if (process.env.RATCHET_BASE_REF) return process.env.RATCHET_BASE_REF
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`
  const originMain = refResolve('origin/main')
  const head = refResolve('HEAD')
  if (originMain && originMain !== head) return 'origin/main'
  return 'HEAD~1'
}

function getDiff(baseRef) {
  let nameStatus = ''
  try {
    nameStatus = git(['diff', '--name-status', '-M', `${baseRef}...HEAD`])
  } catch {
    try { nameStatus = git(['diff', '--name-status', '-M', 'HEAD~1...HEAD']) } catch { return { added: [], modified: [], unifiedDiff: '' } }
  }
  const added = []
  const modified = []
  for (const line of nameStatus.split(/\r?\n/)) {
    if (!line) continue
    // P2: rename = R<score>\told\tnew；其他 = X\tfile
    const parts = line.split('\t')
    const status = parts[0]
    if (status.startsWith('R') || status.startsWith('C')) {
      // rename / copy：用 new path，視為「新增」以擋 rename 偷渡進禁區
      const newPath = parts[2]
      if (newPath) added.push(newPath)
    } else if (status === 'A') {
      added.push(parts[1])
    } else if (status === 'M' || status === 'T') {
      modified.push(parts[1])
    }
  }

  let unifiedDiff = ''
  try {
    unifiedDiff = git(['diff', '-U0', '-M', `${baseRef}...HEAD`])
  } catch { /* ignore */ }
  return { added, modified, unifiedDiff }
}

function checkDiffSuppressions(unifiedDiff, addedFiles = new Set()) {
  const violations = []
  let currentFile = null
  let currentLine = 0
  for (const line of unifiedDiff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) { currentFile = line.slice(6); currentLine = 0; continue }
    if (line.startsWith('--- ')) continue
    if (line.startsWith('@@')) {
      const m = line.match(/\+(\d+)/)
      if (m) currentLine = parseInt(m[1], 10) - 1
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentLine++
      const content = line.slice(1)
      if (!currentFile || !/\.(js|mjs|cjs|ts|mts|cts)$/.test(currentFile)) continue
      if (currentFile === SELF_FILE && addedFiles.has(SELF_FILE)) continue
      if (currentFile.endsWith('.d.ts')) continue
      for (const pat of BAN_PATTERNS) {
        if (pat.re.test(content)) {
          if (pat.pass && pat.pass(content)) continue
          violations.push({ file: currentFile, line: currentLine, pattern: pat.name, content: content.trim().slice(0, 120) })
        }
      }
    }
  }
  return violations
}

function checkNewSourceFiles(added) {
  const violations = []
  for (const f of added) {
    const norm = f.replace(/\\/g, '/')
    if (/\.(js|mjs|cjs)$/.test(norm) && !norm.endsWith('.d.ts')) {
      if (NEW_JS_ALLOWLIST.has(norm)) continue
      if (!norm.startsWith('public/js/')) {
        violations.push({ file: norm, reason: '新增 .js source 違反規則 D：只能放 public/js/** 白名單，其他位置應建 .ts' })
      }
    }
    if (/^src\/js\/.*\.ts$/.test(norm)) {
      violations.push({ file: norm, reason: '新增 src/js/*.ts 違反規則 E：Stage 4.5a pipeline 未上線，classic <script> 接 ESM emit 會 SyntaxError' })
    }
  }
  return violations
}

// ─── 7. 主流程 ─────────────────────────────────────────────────────────

function dumpTscOutput(tscOutput) {
  console.error('tsc output (first 40 lines):')
  console.error(tscOutput.split(/\r?\n/).slice(0, 40).map((l) => '  ' + l).join('\n'))
}

function main() {
  const { output: tscOutput, exitCode: tscExit } = runTypecheck()
  const parsed = parseTscOutput(tscOutput)

  // P1.2 fail-safe（三層）：
  //   (a) tsc 失敗但 totalErrors 0：parse miss
  //   (b) tsc 失敗、fileErrors 0、globalErrors > 0：tsconfig 級失敗，tsc 沒進 file scan
  //   (c) errorsByFile 含 tsconfig.json：壞 tsconfig fallback 預設 config，errorCount 偽性飆低
  if (tscExit !== 0 && parsed.totalErrors === 0) {
    console.error('FAIL: tsc exited with non-zero but parser found 0 errors — possible parse miss')
    dumpTscOutput(tscOutput)
    process.exit(3)
  }
  if (tscExit !== 0 && parsed.fileErrors === 0 && parsed.globalErrors > 0) {
    console.error(`FAIL: tsc exited non-zero with only ${parsed.globalErrors} global errors and 0 file errors — tsconfig/global failure prevents file scan; cleanFiles unreliable`)
    dumpTscOutput(tscOutput)
    process.exit(3)
  }
  const tsconfigErrorFiles = Object.keys(parsed.errorsByFile).filter((f) => /^tsconfig.*\.json$/i.test(f))
  if (tsconfigErrorFiles.length > 0) {
    console.error(`FAIL: tsc reported errors in tsconfig files (${tsconfigErrorFiles.join(', ')}) — broken tsconfig causes file-scan fallback; cleanFiles unreliable`)
    dumpTscOutput(tscOutput)
    process.exit(3)
  }

  const trackedSources = listTrackedSourceFiles()
  const cleanFiles = trackedSources.filter((f) => !(f in parsed.errorsByFile)).length

  const current = {
    errorCount: parsed.totalErrors,
    fileErrors: parsed.fileErrors,
    globalErrors: parsed.globalErrors,
    errorFiles: parsed.errorFiles,
    cleanFiles,
    sourceFilesTotal: trackedSources.length,
    errorsByFile: parsed.errorsByFile,
  }

  if (MODE_REPORT) {
    console.log('=== typecheck-ratchet --report ===')
    console.log(`errorCount      : ${current.errorCount}`)
    console.log(`  fileErrors    : ${current.fileErrors}`)
    console.log(`  globalErrors  : ${current.globalErrors}`)
    console.log(`errorFiles      : ${current.errorFiles}`)
    console.log(`cleanFiles      : ${current.cleanFiles}`)
    console.log(`sourceFilesTotal: ${current.sourceFilesTotal}`)
    return
  }

  if (MODE_UPDATE) {
    let headSha = 'unknown'
    try { headSha = git(['rev-parse', '--short', 'HEAD']).trim() } catch {}
    const baseline = {
      errorCount: current.errorCount,
      fileErrors: current.fileErrors,
      globalErrors: current.globalErrors,
      errorFiles: current.errorFiles,
      cleanFiles: current.cleanFiles,
      sourceFilesTotal: current.sourceFilesTotal,
      errorsByFile: current.errorsByFile,
      baselineSha: headSha,
      createdAt: new Date().toISOString().slice(0, 10),
      stage: 1,
    }
    writeBaseline(baseline)
    console.log(`baseline written → types/typecheck-baseline.json (errorCount=${baseline.errorCount}, cleanFiles=${baseline.cleanFiles})`)
    return
  }

  const baseline = readBaseline()
  if (!baseline) {
    console.error('FAIL: types/typecheck-baseline.json 不存在；先跑 `npm run typecheck:baseline:update` 產 baseline')
    process.exit(2)
  }

  const baseRef = getBaseRef()
  const baseBaseline = readBaseBaseline(baseRef)

  const failures = []

  // P1.1：current baseline 不得比 base ref 上的 baseline 更弱
  if (baseBaseline) {
    if (baseline.errorCount > baseBaseline.errorCount) {
      failures.push(`[BASE] baseline.errorCount 被同 PR 削弱：${baseBaseline.errorCount} → ${baseline.errorCount}（baseline 只能由 error-reducing PR 降低；如需提高，走 governance review）`)
    }
    if (baseline.cleanFiles < baseBaseline.cleanFiles) {
      failures.push(`[BASE] baseline.cleanFiles 被同 PR 削弱：${baseBaseline.cleanFiles} → ${baseline.cleanFiles}`)
    }
  }

  if (current.errorCount > baseline.errorCount) {
    failures.push(`[A] errorCount 上升：${baseline.errorCount} → ${current.errorCount}（+${current.errorCount - baseline.errorCount}）`)
  }
  if (current.cleanFiles < baseline.cleanFiles) {
    failures.push(`[B] cleanFiles 倒退：${baseline.cleanFiles} → ${current.cleanFiles}（-${baseline.cleanFiles - current.cleanFiles}；可能新增 error 檔）`)
  }

  const { added, unifiedDiff } = getDiff(baseRef)
  const addedFiles = new Set(added.map((f) => f.replace(/\\/g, '/')))

  const supViolations = checkDiffSuppressions(unifiedDiff, addedFiles)
  for (const v of supViolations) {
    failures.push(`[C] ${v.file}:${v.line} 新增禁止 pattern「${v.pattern}」：${v.content}`)
  }

  const newSrcViolations = checkNewSourceFiles(added)
  for (const v of newSrcViolations) {
    failures.push(`[D/E] ${v.file}：${v.reason}`)
  }

  console.log(`baseline: errorCount=${baseline.errorCount} cleanFiles=${baseline.cleanFiles} (baseRef=${baseRef})`)
  console.log(`current : errorCount=${current.errorCount} cleanFiles=${current.cleanFiles}`)

  if (failures.length === 0) {
    console.log('ratchet OK')
    return
  }

  console.error('\nFAIL — typecheck ratchet 違反以下規則：')
  for (const f of failures) console.error('  - ' + f)
  console.error('\n參考：memory/project_js_to_ts_migration.md §1.5a / §1.5g')
  process.exit(1)
}

main()
