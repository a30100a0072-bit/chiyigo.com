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
 * r5 hardening（Stage 1 governance PR-1，2026-05-18，post-Stage-1 review）：
 *   F5 — getDiff fail-closed：name-status 與 unifiedDiff 共用 effectiveRange；
 *        兩條 range 候選任一階段失敗就 exit 3，不再靜默回空 collection 讓
 *        規則 C（suppression / any）/ D（新 .js 禁區）/ E（src/js *.ts 禁區）漏網
 *   F8 — getBaseRef fallback HEAD~1 印 console.warn，便於 force-push / shallow
 *        clone 場景追溯 baseRef 解析路徑；ratchet log 同步加 effectiveRange
 *
 * r7 hardening（PR-34 codex r1 non-blocking nit，2026-05-19）：
 *   F8-CI — CI 環境（GITHUB_ACTIONS=true / CI=true）禁止 fallback HEAD~1：
 *        RATCHET_BASE_REF / GITHUB_BASE_REF 缺失且 origin/main == HEAD 時，本機 dev
 *        印 WARN 並 fallback；CI 直接 exit 3，視為 workflow 設定錯誤。
 *        填補 F8 codex r5 留下的「CI 仍建議看 baseRef 行」procedural check，把
 *        審查者手動驗證的規範升級成 script 強 enforce。
 *
 * r6 hardening（Stage 1 governance PR-2，2026-05-18，post-Stage-1 review）：
 *   F3 — 規則 B' errorsByFile diff：current 新出現的 error 檔（baseline 無對應）→ exit 1
 *        例外：git mv X.js Y.ts 後 Y.ts 在 baseline.errorsByFile[X.js] 有 entry 視為合法轉移
 *        填補 §1.5g day-1 延後的「per-file errorsByFile 強制 enforce」
 *   F4 — tsconfigSnapshot invariant：baseline 多 tsconfigSnapshot 欄位（每個 tsconfig*.json
 *        的 include/exclude 陣列）；ratchet 比對若 include 縮小或 exclude 擴大 → exit 1
 *        填補 §1.5g day-1 延後的「完整 tsconfig invariant」；破例需走 governance review
 *        （人工流程；本 script 未實作 env gate）
 *   F3-BASE / F4-BASE — codex PR-治理-2 r1 高：原 F3/F4 只比 PR branch baseline，
 *        同 PR 改 baseline 就能繞過。擴 P1.1 BASE 守備：current 同時比對 base ref
 *        上的 baseline；base 缺欄位視為 bootstrap 跳過該層。errorsByFile 同 PR
 *        baseline 改動 attacker 必須同步改 base ref（不可能），rename 例外保留。
 *   F4-CO — codex PR-治理-2 r2 高：tsconfigSnapshot 原只 include/exclude，但
 *        compilerOptions.checkJs:false 可零成本歸零 errorCount 繞過所有 ratchet。
 *        擴 snapshot 多 compilerOptions 守備清單（allowJs/checkJs/noEmit/strict/
 *        noImplicitAny/strictNullChecks/skipLibCheck/moduleResolution/moduleDetection/
 *        isolatedModules/types/lib）；任一變更 → exit 1，走 governance review。
 *   F4-BASE-LIVE — codex PR-治理-2 r3 高：BASE 層 tsconfig 不依賴 baseBaseline cache，
 *        直接 git show baseRef:tsconfig*.json live read。原 r1 設計在「首次導入
 *        tsconfigSnapshot」情境下 base ref baseline 還沒 tsconfigSnapshot → bootstrap
 *        skip → 「弱化 tsconfig + 同 PR 跑 baseline:update」繞過所有 ratchet。改 live
 *        read 後 BASE-D-tsconfig 永遠 active，不再有 bootstrap window。
 *
 * PR-55 hardening（Stage 4.5a 治理收尾，2026-05-20，承接 PR-54 emit skeleton）：
 *   STRUCT — REQUIRED_FILES 不可刪 invariant：canary fixtures + manifest 三檔
 *        必須存在；所有 mode（含 --report / --update）missing 即 exit 1，
 *        避免 snapshot 壞狀態擴大
 *   SYNC  — manifest ↔ tsconfig.include 同步檢查：tsconfig.browser-classic/module
 *        的 include 必須 === [...manifest.<tier>, manifest.canary.<tier>]；
 *        與 scripts/verify-browser-pipeline.mjs 重複防禦（emit integration test +
 *        diff-time gate 雙層），防 hardcode drift
 *   F4-EXT — TSCONFIG_COMPILER_OPTIONS_GUARDED 擴 module/outDir/rootDir/
 *        resolveJsonModule：鎖 browser pipeline emit shape（module:"none" / "ESNext"、
 *        emit 路徑、resolveJsonModule 與 module:"none" 互斥約束）
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
// NEW_JS_ALLOWLIST：governance / pipeline verification infrastructure（非 application source）
//   - SELF_FILE：ratchet script 本身
//   - scripts/verify-browser-pipeline.mjs：Stage 4.5a browser pipeline canary verifier
//     （PR-54 加入；不改規則 A/B/C/D/E 判定語意，僅白名單新 verifier 與 ratchet 同類）
const NEW_JS_ALLOWLIST = new Set([SELF_FILE, 'scripts/verify-browser-pipeline.mjs'])

// PR-55（Stage 4.5a 治理收尾）：Stage 4.5a browser pipeline 結構不變式
//   - REQUIRED_FILES：canary fixtures + manifest 必須存在；刪 / rename-away → exit 1
//   - MANIFEST_PATH / BROWSER_TSCONFIGS：manifest ↔ tsconfig.include 同步檢查（與
//     scripts/verify-browser-pipeline.mjs 重複防禦；verify 是 emit integration test，
//     ratchet 是 diff-time gate；任一層擋住都防 hardcode drift）
const REQUIRED_FILES = [
  'src/js/browser-script-manifest.json',
  'scripts/fixtures/pipeline-canary-classic.ts',
  'scripts/fixtures/pipeline-canary-module.ts',
]
const MANIFEST_REL = 'src/js/browser-script-manifest.json'
const BROWSER_TSCONFIGS = [
  { file: 'tsconfig.browser-classic.json', tier: 'classic' },
  { file: 'tsconfig.browser-module.json', tier: 'module' },
]

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
  // F8-CI（r7，PR-34 codex r1 nit）：CI 環境禁止 fallback HEAD~1
  //   - workflow 必須注入 RATCHET_BASE_REF（pull_request.base.sha / push event.before）
  //     或 GITHUB_BASE_REF（PR base branch 名）
  //   - 兩者缺失且 origin/main == HEAD → 視為 CI 設定錯誤，exit 3 而非靜默 fallback
  if (process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true') {
    console.error('FAIL: CI 環境 fallback HEAD~1 被禁止（RATCHET_BASE_REF / GITHUB_BASE_REF 必須由 workflow 注入）')
    console.error('  檢查 .github/workflows/ci.yml env: RATCHET_BASE_REF=${{ github.event.pull_request.base.sha || github.event.before }}')
    console.error('  檢查 .github/workflows/ci.yml env: GITHUB_BASE_REF=${{ github.base_ref }}')
    process.exit(3)
  }
  // F8（PR-治理-1）：fallback HEAD~1 在 force-push / shallow clone 場景可能對到非預期 base。
  // main 是 protected + CI fetch-depth=0 已大幅降風險，但 explicit warn 便於事後追溯。
  // 本機 dev 場景才會走到這條（CI 已被 F8-CI 攔截）。
  console.warn('WARN: getBaseRef fell back to HEAD~1 (本機 dev；RATCHET_BASE_REF / GITHUB_BASE_REF 缺失且 origin/main == HEAD)')
  console.warn('  force-push / shallow clone 場景下 diff gate 可能比對到非預期 base — 檢視 ratchet baseRef 行確認')
  return 'HEAD~1'
}

function getDiff(baseRef) {
  // F5（PR-治理-1）：name-status 與 unifiedDiff 共用同一個成功解析的 range（effectiveRange）。
  // 原實作 unifiedDiff 寫死 baseRef，當 name-status fallback HEAD~1 時兩者 range 不一致；
  // 且兩處 catch 都 fail-open 回空 collection，讓規則 C/D/E（suppression / 禁區）靜默漏網。
  // 改為：兩條 range 候選依序嘗試 name-status；成功才繼續用同 range 抓 unifiedDiff；任一失敗 exit 3。
  const candidates = [`${baseRef}...HEAD`, 'HEAD~1...HEAD']
  let effectiveRange = null
  let nameStatus = ''
  for (const range of candidates) {
    try {
      nameStatus = git(['diff', '--name-status', '-M', range])
      effectiveRange = range
      break
    } catch { /* try next candidate */ }
  }
  if (!effectiveRange) {
    console.error(`FAIL: getDiff 無法解析任何 diff range（嘗試 ${candidates.join(', ')}）`)
    console.error('  suppression / new-source gates 在無 diff 下會靜默 no-op — 拒絕 fail-open')
    process.exit(3)
  }

  const added = []
  const modified = []
  // F3（PR-治理-2）：renameMap newPath→oldPath 供規則 B' 排除合法 rename 帶過來的 error
  const renameMap = new Map()
  for (const line of nameStatus.split(/\r?\n/)) {
    if (!line) continue
    // P2: rename = R<score>\told\tnew；其他 = X\tfile
    const parts = line.split('\t')
    const status = parts[0]
    if (status.startsWith('R') || status.startsWith('C')) {
      // rename / copy：用 new path，視為「新增」以擋 rename 偷渡進禁區
      const oldPath = parts[1]
      const newPath = parts[2]
      if (newPath) added.push(newPath)
      if (oldPath && newPath) renameMap.set(newPath.replace(/\\/g, '/'), oldPath.replace(/\\/g, '/'))
    } else if (status === 'A') {
      added.push(parts[1])
    } else if (status === 'M' || status === 'T') {
      modified.push(parts[1])
    }
  }

  let unifiedDiff = ''
  try {
    unifiedDiff = git(['diff', '-U0', '-M', effectiveRange])
  } catch {
    console.error(`FAIL: getDiff unifiedDiff 在已解析的 range ${effectiveRange} 失敗`)
    console.error('  name-status 成功但 unified diff 失敗 — 拒絕對 suppression check fail-open')
    process.exit(3)
  }
  return { added, modified, unifiedDiff, effectiveRange, renameMap }
}

// ─── 6.4 Stage 4.5a browser pipeline structural invariants（PR-55） ─────

function checkRequiredFiles() {
  const missing = []
  for (const rel of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(ROOT, rel))) missing.push(rel)
  }
  return missing
}

function arraysShallowEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// PR-55 r1（codex 拍板 2026-05-20）：manifest entry per-entry 驗證。
//   Why：TS 對 tsconfig.include 內不存在的 path 是 silent ignore；
//        manifest.classic=["src/js/typo.ts"] + 同步 tsconfig.include 兩 gate 都能通過
//        但 emit 什麼都沒有。Stage 5 加第一個 production 入口就會踩。
//   Rules：
//        - 必 string
//        - POSIX 正規（無反斜線、無 leading "/"、無 . / .. 區段）
//        - 跨 production+canary 全集合 unique
//        - 真檔案存在於 working tree
//        - production entry 必符 ^src/js/.+\.ts$（manifest 平面，Stage 5 加 src/js/*.ts）
//        - canary entry 必符 ^scripts/fixtures/.+\.ts$（fixture-specific allowance）
const MANIFEST_PROD_PATTERN = /^src\/js\/[^/].*\.ts$/
const MANIFEST_CANARY_PATTERN = /^scripts\/fixtures\/[^/].*\.ts$/

function validateManifestEntry(entry, label, pattern, seen, violations) {
  if (typeof entry !== 'string') {
    violations.push(`${label} 必須是 string（actual=${JSON.stringify(entry)}）`)
    return
  }
  if (entry.length === 0) { violations.push(`${label} 為空字串`); return }
  if (entry.includes('\\')) violations.push(`${label} 含反斜線（必須 POSIX 路徑）：${entry}`)
  if (entry.startsWith('/')) violations.push(`${label} 開頭 "/"（必須相對路徑）：${entry}`)
  if (/(^|\/)\.\.?(\/|$)/.test(entry)) violations.push(`${label} 含 "." 或 ".." 區段：${entry}`)
  if (!pattern.test(entry)) violations.push(`${label} 不符 pattern ${pattern}：${entry}`)
  if (seen.has(entry)) violations.push(`${label} 在 manifest 內重複（跨 classic/module/canary 不可重）：${entry}`)
  seen.add(entry)
  if (!fs.existsSync(path.join(ROOT, entry))) {
    violations.push(`${label} 檔案不存在（TS 對不存在 include 是 silent ignore，會偽綠）：${entry}`)
  }
}

function checkManifestSync() {
  const violations = []
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8'))
  } catch (e) {
    violations.push(`manifest parse 失敗 (${MANIFEST_REL})：${e.message}`)
    return violations
  }
  if (!manifest.canary || typeof manifest.canary !== 'object') {
    violations.push('manifest.canary 必須是 object（{classic, module}）')
    return violations
  }
  if (typeof manifest.canary.classic !== 'string') violations.push('manifest.canary.classic 必須是 string 路徑')
  if (typeof manifest.canary.module !== 'string') violations.push('manifest.canary.module 必須是 string 路徑')
  if (!Array.isArray(manifest.classic)) violations.push('manifest.classic 必須是 array')
  if (!Array.isArray(manifest.module)) violations.push('manifest.module 必須是 array')
  if (violations.length > 0) return violations

  // PR-55 r1：per-entry 驗證（跨 classic+module+canary 共用 seen set 強制 unique）
  const seen = new Set()
  for (let i = 0; i < manifest.classic.length; i++) {
    validateManifestEntry(manifest.classic[i], `manifest.classic[${i}]`, MANIFEST_PROD_PATTERN, seen, violations)
  }
  for (let i = 0; i < manifest.module.length; i++) {
    validateManifestEntry(manifest.module[i], `manifest.module[${i}]`, MANIFEST_PROD_PATTERN, seen, violations)
  }
  validateManifestEntry(manifest.canary.classic, 'manifest.canary.classic', MANIFEST_CANARY_PATTERN, seen, violations)
  validateManifestEntry(manifest.canary.module, 'manifest.canary.module', MANIFEST_CANARY_PATTERN, seen, violations)
  if (violations.length > 0) return violations

  for (const { file, tier } of BROWSER_TSCONFIGS) {
    let cfg
    try {
      cfg = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    } catch (e) {
      violations.push(`${file} parse 失敗：${e.message}`)
      continue
    }
    const expected = [...manifest[tier], manifest.canary[tier]]
    const actual = Array.isArray(cfg.include) ? cfg.include : []
    if (!arraysShallowEqual(actual, expected)) {
      violations.push(
        `${file} include 與 manifest 不同步\n` +
        `    expected: ${JSON.stringify(expected)}\n` +
        `    actual  : ${JSON.stringify(actual)}`
      )
    }
  }
  return violations
}

// ─── 6.5 tsconfig snapshot（F4 invariant） ──────────────────────────────

function listRootTsconfigs() {
  // root 層 tsconfig*.json；Stage 4.5a 後可能加 tsconfig.browser-classic.json 等
  return fs.readdirSync(ROOT)
    .filter((f) => /^tsconfig.*\.json$/.test(f))
    .sort()
}

// codex PR-治理-2 r2 高：除 include/exclude 外，這些 compilerOptions 直接影響 typecheck
// 強度，必須進 snapshot 才能擋「checkJs:false 把 errorCount 歸零」類 bypass。
// 任一欄位變更要走 governance review。Stage 4.5/6/7 升級時也是這個流程。
const TSCONFIG_COMPILER_OPTIONS_GUARDED = [
  'allowJs', 'checkJs', 'noEmit',
  'strict', 'noImplicitAny', 'strictNullChecks',
  'skipLibCheck', 'module', 'moduleResolution', 'moduleDetection',
  'isolatedModules', 'types', 'lib',
  // PR-55（Stage 4.5a 治理收尾）：browser pipeline emit shape 鎖
  //   `module` — classic 必須 "none"、module 必須 "ESNext"，無聲弱化會炸 <script>
  //   `outDir` / `rootDir` — 控制 emit 路徑；移動會讓 manifest ↔ output path 推導斷鏈
  //   `resolveJsonModule` — classic 必須 false（與 module:"none" 互斥；TS5071）
  'outDir', 'rootDir', 'resolveJsonModule',
]

function normalizeTsconfigParsed(parsed) {
  // 統一 normalize 給 loadTsconfigsSnapshot 與 loadTsconfigsSnapshotFromRef 用，
  // 確保 base ref live read 與 working tree read 用同一份 canonical 格式比對。
  const co = parsed.compilerOptions || {}
  const compilerOptions = Object.create(null)
  for (const key of TSCONFIG_COMPILER_OPTIONS_GUARDED) {
    if (key in co) {
      const v = co[key]
      compilerOptions[key] = Array.isArray(v) ? [...v].sort() : v
    }
  }
  return {
    include: Array.isArray(parsed.include) ? [...parsed.include].sort() : [],
    exclude: Array.isArray(parsed.exclude) ? [...parsed.exclude].sort() : [],
    compilerOptions,
  }
}

function loadTsconfigsSnapshot() {
  // 讀 working tree 上每個 root tsconfig*.json 的 include / exclude / 守備 compilerOptions
  const snapshot = Object.create(null)
  for (const f of listRootTsconfigs()) {
    try {
      const raw = fs.readFileSync(path.join(ROOT, f), 'utf8')
      snapshot[f] = normalizeTsconfigParsed(JSON.parse(raw))
    } catch (e) {
      console.error(`FAIL: loadTsconfigsSnapshot ${f} parse 失敗：${e.message}`)
      process.exit(3)
    }
  }
  return snapshot
}

function loadTsconfigsSnapshotFromRef(baseRef) {
  // F4-BASE r3 高（codex PR-治理-2 r3）：BASE 層 tsconfig 直接從 base ref live read，
  // 不依賴 baseBaseline.tsconfigSnapshot cache。
  // Why：首次導入 tsconfigSnapshot 的 PR（本 PR）若靠 baseBaseline cache，base ref
  // 還沒 tsconfigSnapshot → bootstrap skip → 「弱化 tsconfig + 同 PR 跑 baseline:update」
  // 攻擊可繞所有 ratchet（base ref 上 tsconfig 實際存在、可直接讀，不該靠 cache）。
  // 讀失敗 fail-closed exit 3，不靜默 bootstrap。
  let tree
  try {
    tree = git(['ls-tree', '--name-only', baseRef])
  } catch (e) {
    console.error(`FAIL: loadTsconfigsSnapshotFromRef ls-tree baseRef=${baseRef} 失敗：${e.message}`)
    process.exit(3)
  }
  const tsconfigFiles = tree.split(/\r?\n/)
    .map((s) => s.trim())
    .filter((f) => /^tsconfig.*\.json$/.test(f))
    .sort()

  const snapshot = Object.create(null)
  for (const f of tsconfigFiles) {
    let raw
    try {
      raw = git(['show', `${baseRef}:${f}`])
    } catch (e) {
      console.error(`FAIL: loadTsconfigsSnapshotFromRef git show ${baseRef}:${f} 失敗：${e.message}`)
      process.exit(3)
    }
    try {
      snapshot[f] = normalizeTsconfigParsed(JSON.parse(raw))
    } catch (e) {
      console.error(`FAIL: loadTsconfigsSnapshotFromRef parse ${baseRef}:${f} 失敗：${e.message}`)
      process.exit(3)
    }
  }
  return snapshot
}

function compareTsconfigSnapshot(baselineSnap, currentSnap, label = 'D-tsconfig') {
  // 規則 D（F4）：include 不得縮小、exclude 不得擴大；新增 tsconfig 視為擴展（允許）；
  // 刪除 baseline 已有的 tsconfig 視為縮小掃描面（不允許）。
  // label：違規 prefix（PR branch baseline = 'D-tsconfig'；base ref baseline = 'BASE-D-tsconfig'）
  const violations = []
  if (!baselineSnap || typeof baselineSnap !== 'object') return violations  // bootstrap：跳過
  for (const f of Object.keys(baselineSnap)) {
    if (!(f in currentSnap)) {
      violations.push(`[${label}] ${f} 在 current 被刪除（baseline 有此 tsconfig；刪除 = 縮小掃描面）`)
      continue
    }
    const bInc = new Set(baselineSnap[f].include || [])
    const cInc = new Set(currentSnap[f].include || [])
    for (const entry of bInc) {
      if (!cInc.has(entry)) violations.push(`[${label}] ${f} include 縮小：缺 "${entry}"`)
    }
    const bExc = new Set(baselineSnap[f].exclude || [])
    const cExc = new Set(currentSnap[f].exclude || [])
    for (const entry of cExc) {
      if (!bExc.has(entry)) violations.push(`[${label}] ${f} exclude 擴大：新增 "${entry}"`)
    }
    // codex r2 高：守備 compilerOptions 弱化（如 checkJs:false / allowJs:false / strict:false→...）
    // 任一欄位 value 不同（含 undefined ↔ value 的雙向）→ violation。
    // canonical 比對用 JSON.stringify（陣列 load 時已 sort）。
    const bCO = baselineSnap[f].compilerOptions || {}
    const cCO = currentSnap[f].compilerOptions || {}
    const coKeys = new Set([...Object.keys(bCO), ...Object.keys(cCO)])
    for (const key of coKeys) {
      const bv = JSON.stringify(bCO[key])
      const cv = JSON.stringify(cCO[key])
      if (bv !== cv) {
        violations.push(`[${label}] ${f} compilerOptions.${key} 變更：${bv} → ${cv}（影響 typecheck 強度；升級走 governance review）`)
      }
    }
  }
  return violations
}

function findNewErrorFiles(currentErrors, baselineErrors, renameMap) {
  // F3：current 中、baseline 沒有的 error 檔；rename 過來且原檔在 baseline 有 entry 視為合法轉移。
  // baseline 缺 errorsByFile（bootstrap）→ 回 null 讓 caller 跳過該層比對。
  if (!baselineErrors || typeof baselineErrors !== 'object') return null
  const result = []
  for (const f of Object.keys(currentErrors)) {
    if (f in baselineErrors) continue
    const oldPath = renameMap.get(f)
    if (oldPath && oldPath in baselineErrors) continue
    result.push(f)
  }
  return result
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
  // PR-55 structural pre-check（所有 mode 都跑，含 --report / --update）
  //   早退 exit 1 是刻意：missing canary / manifest drift = baseline state 已壞，
  //   繼續跑 tsc 或 snapshot baseline 都會擴大爛狀態
  const missingRequired = checkRequiredFiles()
  if (missingRequired.length > 0) {
    console.error('FAIL: Stage 4.5a 必要檔遺失（pipeline 不完整）：')
    for (const f of missingRequired) console.error('  - ' + f)
    console.error('\n參考：memory/project_js_to_ts_stage45a_plan.md / [[feedback_ts_ratchet_discipline]]')
    process.exit(1)
  }
  const manifestViolations = checkManifestSync()
  if (manifestViolations.length > 0) {
    console.error('FAIL: manifest / tsconfig.include 結構違反：')
    for (const v of manifestViolations) console.error('  - ' + v)
    console.error('\n參考：src/js/browser-script-manifest.json 是 single source of truth；改 include 必須同步動 manifest')
    process.exit(1)
  }

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
      tsconfigSnapshot: loadTsconfigsSnapshot(),  // F4（PR-治理-2）
      baselineSha: headSha,
      createdAt: new Date().toISOString().slice(0, 10),
      stage: 1,
    }
    writeBaseline(baseline)
    console.log(`baseline written → types/typecheck-baseline.json (errorCount=${baseline.errorCount}, cleanFiles=${baseline.cleanFiles}, tsconfigs=${Object.keys(baseline.tsconfigSnapshot).length})`)
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

  const { added, unifiedDiff, effectiveRange, renameMap } = getDiff(baseRef)
  const addedFiles = new Set(added.map((f) => f.replace(/\\/g, '/')))

  // 規則 B'（F3，PR-治理-2）：current 新出現的 error 檔 → fail；rename 例外。
  // 雙層比對防同 PR 改 baseline 偷渡（codex PR-治理-2 r1 高）：
  //   (1) PR branch baseline：擋一般 PR 新增 error 檔
  //   (2) base ref baseline：即使同 PR 把新檔加進 baseline.errorsByFile，base ref 上仍無
  const newVsBranch = findNewErrorFiles(current.errorsByFile, baseline.errorsByFile, renameMap)
  if (newVsBranch && newVsBranch.length > 0) {
    failures.push(`[B'] 新增 error 檔（PR branch baseline 無對應，亦無合法 rename）：${newVsBranch.join(', ')}`)
  }
  if (baseBaseline) {
    const newVsBase = findNewErrorFiles(current.errorsByFile, baseBaseline.errorsByFile, renameMap)
    if (newVsBase && newVsBase.length > 0) {
      failures.push(`[BASE-B'] 新增 error 檔（base ref baseline 無對應；同 PR 改 baseline 也擋）：${newVsBase.join(', ')}`)
    }
  }

  // 規則 D-tsconfig（F4 + F4-CO + F4-BASE r3）：tsconfig*.json include/exclude 不得縮小、
  // compilerOptions 守備欄位不得變更。雙層守備：
  //   (1) PR branch baseline.tsconfigSnapshot：擋一般 PR 弱化 tsconfig
  //   (2) base ref live tsconfig（r3）：直接 git show baseRef:tsconfig*.json，不依賴
  //       baseBaseline cache；擋「弱化 tsconfig + 同 PR 跑 baseline:update」攻擊
  const currentTsconfigSnap = loadTsconfigsSnapshot()
  for (const v of compareTsconfigSnapshot(baseline.tsconfigSnapshot, currentTsconfigSnap, 'D-tsconfig')) {
    failures.push(v)
  }
  const baseTsconfigSnap = loadTsconfigsSnapshotFromRef(baseRef)
  for (const v of compareTsconfigSnapshot(baseTsconfigSnap, currentTsconfigSnap, 'BASE-D-tsconfig')) {
    failures.push(v)
  }

  const supViolations = checkDiffSuppressions(unifiedDiff, addedFiles)
  for (const v of supViolations) {
    failures.push(`[C] ${v.file}:${v.line} 新增禁止 pattern「${v.pattern}」：${v.content}`)
  }

  const newSrcViolations = checkNewSourceFiles(added)
  for (const v of newSrcViolations) {
    failures.push(`[D/E] ${v.file}：${v.reason}`)
  }

  console.log(`baseline: errorCount=${baseline.errorCount} cleanFiles=${baseline.cleanFiles} (baseRef=${baseRef} effectiveRange=${effectiveRange})`)
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
