#!/usr/bin/env node
/**
 * verify-browser-pipeline.mjs — Stage 4.5a browser pipeline canary CI gate
 *
 * 跑兩條 browser tsconfig 對 canary fixture，驗：
 *   manifest 真為 single source of truth：
 *     - tsconfig.browser-classic/module.json 的 include 陣列必須 === [manifest.canary.classic/module]
 *     - expected output 路徑由 manifest + tsconfig.outDir/rootDir 推導，不 hardcode
 *     - tsconfig.browser-classic.json 必須鎖 module:"none" + moduleDetection:"auto"（classic invariant）
 *     - tsconfig.browser-module.json 必須鎖 module:"ESNext"（module invariant）
 *   classic：emit 含 marker、不含 ESM 結構（import/export）、不含 CommonJS 結構（require/exports）
 *   module ：emit 含 marker、含 export
 *
 * Why：Stage 4.5a 不動 build-partials.js（4.5b 才整合），但仍需 CI 守門 emit pipeline 不退化。
 *      future Stage 5+ 加進真 src/js/*.ts 入口前，這個 canary 是唯一證明 emit 真會 round-trip 的機制。
 *      manifest ↔ tsconfig.include 同步 enforce 是 codex PR-54 r1 medium 拍板（避免 hardcode drift）。
 *
 * 紀律：本 script 屬 ratchet / pipeline verification infrastructure，與 typecheck-ratchet.mjs 同類；
 *      不是新 browser source。NEW_JS_ALLOWLIST 已加白名單（PR-54 ratchet 唯一 1-line touch；非政策變更）。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const TMP_DIR = path.join(ROOT, '.tmp-pipeline-canary')
const MANIFEST_PATH = path.join(ROOT, 'src', 'js', 'browser-script-manifest.json')
const CONFIG_CLASSIC = 'tsconfig.browser-classic.json'
const CONFIG_MODULE = 'tsconfig.browser-module.json'
// PR-56 (Stage 4.5b-1)：prod tsconfig 把 manifest.classic emit 進 public/js/；
// verify 走獨立 temp outDir 比對 committed bytes，避免寫穿 public/js 自我修復。
const CONFIG_CLASSIC_PROD = 'tsconfig.browser-classic.prod.json'
const PROD_TEMP_OUTDIR = '.tmp-pipeline-canary/classic-prod'

const MARKER_CLASSIC = 'PIPELINE_CANARY_CLASSIC_OK'
const MARKER_MODULE = 'PIPELINE_CANARY_MODULE_OK'

function fail(msg) {
  console.error('FAIL: ' + msg)
  process.exit(1)
}

function readJson(p, label) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    fail(`${label} parse 失敗 ${p}: ${e.message}`)
  }
}

function runTsc(config, extraArgs = []) {
  // 用 node 直接執行 typescript/bin/tsc（node-executable JS），跨平台一致，
  // 避免 npx 解析、.cmd shim 在 Windows 上的 CVE-2024-27980 shell 限制、DEP0190 警告
  const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  const args = [tscJs, '-p', config, '--pretty', 'false', ...extraArgs]
  try {
    execFileSync(process.execPath, args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '')
    console.error(`tsc -p ${config}${extraArgs.length ? ' ' + extraArgs.join(' ') : ''} 失敗：`)
    console.error(out.split(/\r?\n/).slice(0, 30).map((l) => '  ' + l).join('\n'))
    process.exit(1)
  }
}

// PR-56 (Stage 4.5b-1)：抽出 classic <script> shape scan，給 canary fixture 與
// 每個 manifest.classic production entry 的 temp emit 共用。
//   classic <script> 不能含 ESM 或 CommonJS 結構：
//     - ESM：top-level export { } / export 宣告 / top-level import → SyntaxError
//     - CJS：require( / module.exports / exports.<name> / Object.defineProperty(exports →
//            browser classic 環境無 CommonJS runtime → ReferenceError
//   註解內字面字串需先剝（stripComments）以免 false-positive。
function assertClassicShape(content, label) {
  const code = stripComments(content)
  if (/\bexport\s*\{/.test(code)) fail(`${label} 含 \`export {\`（會讓 <script> SyntaxError）`)
  if (/^\s*export\s+/m.test(code)) fail(`${label} 含 top-level \`export\` 宣告（會讓 <script> SyntaxError）`)
  if (/^\s*import\s+/m.test(code)) fail(`${label} 含 top-level \`import\`（會讓 <script> SyntaxError）`)
  if (/\brequire\s*\(/.test(code)) fail(`${label} 含 \`require(\`（browser classic 無 CommonJS runtime）`)
  if (/\bmodule\.exports\b/.test(code)) fail(`${label} 含 \`module.exports\`（browser classic 無 CommonJS runtime）`)
  if (/\bexports\.[A-Za-z_$]/.test(code)) fail(`${label} 含 \`exports.<name>\`（browser classic 無 CommonJS runtime）`)
  if (/\bObject\.defineProperty\s*\(\s*exports\b/.test(code)) fail(`${label} 含 \`Object.defineProperty(exports\`（CommonJS shim）`)
}

function cleanTmp() {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true })
}

function stripComments(src) {
  // 剝 // line comment 與 /* */ block comment，避免註解內字面字串騙過 shape 檢查。
  // 不處理字串 literal 內的 `//` `/*`（canary 內容不會有），夠用即可。
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

function normalizePosix(p) {
  return p.replace(/\\/g, '/')
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// PR-55 r1（codex 拍板 2026-05-20）：manifest entry per-entry 驗證
//   TS 對 tsconfig.include 不存在路徑 silent ignore；["src/js/typo.ts"] 同步進
//   tsconfig.include 仍可通過 emit（因 canary 存在，tsc 不抱怨整體無檔），
//   bogus entry 悄悄被吞。Stage 5 加 production 入口首發就會踩。
const MANIFEST_PROD_PATTERN = /^src\/js\/[^/].*\.ts$/
const MANIFEST_CANARY_PATTERN = /^scripts\/fixtures\/[^/].*\.ts$/

function validateManifestEntry(entry, label, pattern, seen) {
  if (typeof entry !== 'string') fail(`${label} 必須是 string（actual=${JSON.stringify(entry)}）`)
  if (entry.length === 0) fail(`${label} 為空字串`)
  if (entry.includes('\\')) fail(`${label} 含反斜線（必須 POSIX 路徑）：${entry}`)
  if (entry.startsWith('/')) fail(`${label} 開頭 "/"（必須相對路徑）：${entry}`)
  // PR-55 r2（codex 拍板 2026-05-20）：canonical POSIX 字串檢查
  if (path.posix.normalize(entry) !== entry) {
    fail(`${label} 非 canonical POSIX 路徑（含 "./" "../" 或重複斜線等變體）：${entry}`)
  }
  if (!pattern.test(entry)) fail(`${label} 不符 pattern ${pattern}：${entry}`)
  if (seen.has(entry)) fail(`${label} 在 manifest 內重複（跨 classic/module/canary 不可重）：${entry}`)
  seen.add(entry)
  // PR-55 r2（codex 拍板 2026-05-20）：existsSync 對 directory 也 true → statSync().isFile()
  let stat
  try {
    stat = fs.statSync(path.join(ROOT, entry))
  } catch {
    fail(`${label} 檔案不存在（TS 對不存在 include 是 silent ignore）：${entry}`)
  }
  if (!stat.isFile()) {
    fail(`${label} 不是 regular file（是 directory / special / broken symlink；TS 對 directory include 是 silent ignore）：${entry}`)
  }
}

function deriveOutputPath(tsconfig, sourceRelative) {
  // 從 tsconfig 的 outDir + rootDir 推導 source.ts → output.js 的相對路徑
  const co = tsconfig.compilerOptions || {}
  const outDir = co.outDir
  if (typeof outDir !== 'string') fail(`tsconfig 缺 compilerOptions.outDir`)
  const rootDir = typeof co.rootDir === 'string' ? co.rootDir : '.'
  // 把 source 路徑相對於 rootDir 算（rootDir:"." 時即 source 本身）
  const srcPosix = normalizePosix(sourceRelative)
  const rootPosix = normalizePosix(rootDir).replace(/\/+$/, '')
  let rel = srcPosix
  if (rootPosix && rootPosix !== '.') {
    const prefix = rootPosix + '/'
    if (!srcPosix.startsWith(prefix)) fail(`source ${srcPosix} 不在 rootDir ${rootDir} 之下`)
    rel = srcPosix.slice(prefix.length)
  }
  const jsRel = rel.replace(/\.ts$/, '.js')
  return path.join(ROOT, outDir, jsRel)
}

function main() {
  console.log('=== Stage 4.5a browser pipeline canary verify ===')

  // 1. manifest 結構檢查
  const manifest = readJson(MANIFEST_PATH, 'manifest')
  if (!manifest.canary || typeof manifest.canary !== 'object') fail('manifest.canary 不是 object')
  if (typeof manifest.canary.classic !== 'string') fail('manifest.canary.classic 必須是 string 路徑')
  if (typeof manifest.canary.module !== 'string') fail('manifest.canary.module 必須是 string 路徑')
  if (!Array.isArray(manifest.classic)) fail('manifest.classic 必須是 array')
  if (!Array.isArray(manifest.module)) fail('manifest.module 必須是 array')

  // PR-55 r1：per-entry 驗證（型別/POSIX/unique/檔案存在/pattern；防 TS silent ignore 偽綠）
  const seen = new Set()
  manifest.classic.forEach((e, i) => validateManifestEntry(e, `manifest.classic[${i}]`, MANIFEST_PROD_PATTERN, seen))
  manifest.module.forEach((e, i) => validateManifestEntry(e, `manifest.module[${i}]`, MANIFEST_PROD_PATTERN, seen))
  validateManifestEntry(manifest.canary.classic, 'manifest.canary.classic', MANIFEST_CANARY_PATTERN, seen)
  validateManifestEntry(manifest.canary.module, 'manifest.canary.module', MANIFEST_CANARY_PATTERN, seen)
  console.log(`✓ manifest 結構 OK（classic=${manifest.classic.length} module=${manifest.module.length} canary=2，全 entry 驗 type/POSIX/unique/存在/pattern）`)

  // PR-56 (Stage 4.5b-1)：module lane 未開 prod pipeline；ratchet 規則 E 對應只放行 manifest.classic 新增 src/js/*.ts。
  // 此 gate 防止未來 PR「悄悄」push 進 manifest.module 拿到 ratchet bypass 但 build 不會 emit / verify 不會比對 committed artifact。
  // 解除條件：新增 tsconfig.browser-module.prod.json + build-partials module prod emit + 此檔 module temp/committed compare loop。
  if (manifest.module.length > 0) {
    fail(`manifest.module production entries 未支援（Stage 4.5b-1 僅收編 classic lane；module prod build / verify 待 future PR 補 tsconfig.browser-module.prod.json + build emit + temp/committed artifact compare；ratchet 規則 E 也對應 enforce）：${JSON.stringify(manifest.module)}`)
  }

  // 2. manifest ↔ tsconfig.include 同步檢查（codex PR-54 r1 medium）
  //    PR-54 內 manifest.classic/module 兩條 production 陣列都空，tsconfig.include 只含 canary；
  //    Stage 5+ 加 production 入口時 include 必須 == [...production, canary]（單一 source of truth）。
  const classicCfg = readJson(path.join(ROOT, CONFIG_CLASSIC), CONFIG_CLASSIC)
  const moduleCfg = readJson(path.join(ROOT, CONFIG_MODULE), CONFIG_MODULE)
  const expectClassicInclude = [...manifest.classic, manifest.canary.classic]
  const expectModuleInclude = [...manifest.module, manifest.canary.module]
  if (!arraysEqual(classicCfg.include, expectClassicInclude)) {
    fail(`${CONFIG_CLASSIC} include 與 manifest 不同步\n  expected: ${JSON.stringify(expectClassicInclude)}\n  actual  : ${JSON.stringify(classicCfg.include)}`)
  }
  if (!arraysEqual(moduleCfg.include, expectModuleInclude)) {
    fail(`${CONFIG_MODULE} include 與 manifest 不同步\n  expected: ${JSON.stringify(expectModuleInclude)}\n  actual  : ${JSON.stringify(moduleCfg.include)}`)
  }

  // 3. tsconfig 關鍵 compilerOptions invariant（codex PR-54 r1 low — 鎖死 classic shape 假設）
  const classicCO = classicCfg.compilerOptions || {}
  if (classicCO.module !== 'none') fail(`${CONFIG_CLASSIC} compilerOptions.module 必須 === "none"（actual=${JSON.stringify(classicCO.module)}）`)
  if (classicCO.moduleDetection !== 'auto') fail(`${CONFIG_CLASSIC} compilerOptions.moduleDetection 必須 === "auto"（actual=${JSON.stringify(classicCO.moduleDetection)}）`)
  const moduleCO = moduleCfg.compilerOptions || {}
  if (moduleCO.module !== 'ESNext') fail(`${CONFIG_MODULE} compilerOptions.module 必須 === "ESNext"（actual=${JSON.stringify(moduleCO.module)}）`)
  console.log('✓ tsconfig invariant OK（classic=none+auto / module=ESNext / include 與 manifest 同步）')

  // 4. 清舊 emit
  cleanTmp()

  // 5. emit classic
  console.log(`→ tsc -p ${CONFIG_CLASSIC}`)
  runTsc(CONFIG_CLASSIC)

  // 6. emit module
  console.log(`→ tsc -p ${CONFIG_MODULE}`)
  runTsc(CONFIG_MODULE)

  // 7. 驗 classic canary emit（output 路徑由 manifest + tsconfig 推導）
  const classicOut = deriveOutputPath(classicCfg, manifest.canary.classic)
  if (!fs.existsSync(classicOut)) fail(`classic canary emit 缺檔：${classicOut}`)
  const classicContent = fs.readFileSync(classicOut, 'utf8')
  if (!classicContent.includes(MARKER_CLASSIC)) fail(`classic canary emit 缺 marker "${MARKER_CLASSIC}"`)
  assertClassicShape(classicContent, 'classic canary emit')
  console.log(`✓ classic canary emit OK（${classicContent.length} bytes，含 marker，無 ESM/CJS 結構）`)

  // 8. 驗 module canary emit（output 路徑由 manifest + tsconfig 推導）
  const moduleOut = deriveOutputPath(moduleCfg, manifest.canary.module)
  if (!fs.existsSync(moduleOut)) fail(`module canary emit 缺檔：${moduleOut}`)
  const moduleContent = fs.readFileSync(moduleOut, 'utf8')
  if (!moduleContent.includes(MARKER_MODULE)) fail(`module canary emit 缺 marker "${MARKER_MODULE}"`)
  const moduleCode = stripComments(moduleContent)
  if (!/\bexport\b/.test(moduleCode)) fail('module canary emit 缺 `export`（應為 ES module 形狀）')
  console.log(`✓ module canary emit OK（${moduleContent.length} bytes，含 marker 與 export）`)

  // 9. PR-56 (Stage 4.5b-1)：prod classic entries pipeline 驗證
  //    對 manifest.classic 每個 entry：
  //      a. tsc emit 到 .tmp-pipeline-canary/classic-prod/（避免寫穿 public/js 自我修復）
  //      b. assertClassicShape on temp emit（防 ESM/CJS 結構偷渡）
  //      c. byte-compare temp vs committed public/js artifact
  //         （committed 不存在 / 不同步 → fail；證 build artifact 已 commit）
  //    cloned config 算 tempOut 路徑，避免用回原 prodCfg outDir 比對到 committed 本身。
  const prodCfg = readJson(path.join(ROOT, CONFIG_CLASSIC_PROD), CONFIG_CLASSIC_PROD)
  if (!arraysEqual(prodCfg.include, [...manifest.classic])) {
    fail(`${CONFIG_CLASSIC_PROD} include 與 manifest.classic 不同步\n  expected: ${JSON.stringify([...manifest.classic])}\n  actual  : ${JSON.stringify(prodCfg.include)}`)
  }
  const prodCO = prodCfg.compilerOptions || {}
  if (prodCO.module !== 'none') fail(`${CONFIG_CLASSIC_PROD} compilerOptions.module 必須 === "none"（actual=${JSON.stringify(prodCO.module)}）`)
  if (prodCO.outDir !== 'public/js') fail(`${CONFIG_CLASSIC_PROD} compilerOptions.outDir 必須 === "public/js"（actual=${JSON.stringify(prodCO.outDir)}）`)
  if (prodCO.rootDir !== 'src/js') fail(`${CONFIG_CLASSIC_PROD} compilerOptions.rootDir 必須 === "src/js"（actual=${JSON.stringify(prodCO.rootDir)}）`)

  if (manifest.classic.length === 0) {
    console.log(`✓ ${CONFIG_CLASSIC_PROD} invariant OK（manifest.classic 為空，跳過 prod emit）`)
  } else {
    console.log(`→ tsc -p ${CONFIG_CLASSIC_PROD} --outDir ${PROD_TEMP_OUTDIR}`)
    runTsc(CONFIG_CLASSIC_PROD, ['--outDir', PROD_TEMP_OUTDIR])

    // cloned config 推 tempOut；committedOut 用原 prodCfg outDir（public/js）
    const prodTempCfg = {
      ...prodCfg,
      compilerOptions: { ...prodCfg.compilerOptions, outDir: PROD_TEMP_OUTDIR },
    }

    for (const entry of manifest.classic) {
      const tempOut = deriveOutputPath(prodTempCfg, entry)
      const committedOut = deriveOutputPath(prodCfg, entry)
      if (!fs.existsSync(tempOut)) fail(`prod temp emit 缺檔（${entry} → ${tempOut}）`)
      const tempContent = fs.readFileSync(tempOut, 'utf8')
      assertClassicShape(tempContent, `prod emit ${entry}`)
      if (!fs.existsSync(committedOut)) fail(`prod committed artifact 缺檔（${committedOut}）；請跑 npm run build 後 commit`)
      const committedContent = fs.readFileSync(committedOut, 'utf8')
      // Windows checkout 可能把 LF 轉成 CRLF（autocrlf），tsc 直接 emit LF；
      // line-ending 差異不算 source drift，比對前統一 normalize \r\n → \n。
      // 其餘任何差異（內容 / 漏 import / 空白以外字元）都視為真實 drift。
      const normalize = (s) => s.replace(/\r\n/g, '\n')
      const tempNorm = normalize(tempContent)
      const committedNorm = normalize(committedContent)
      if (tempNorm !== committedNorm) {
        fail(
          `prod committed artifact 與 fresh tsc emit 不同步（${entry}）\n` +
          `  temp     : ${tempOut} (${tempContent.length} bytes raw / ${tempNorm.length} LF-normalized)\n` +
          `  committed: ${committedOut} (${committedContent.length} bytes raw / ${committedNorm.length} LF-normalized)\n` +
          `  請跑 npm run build 後 commit；或檢查 src/js source 與 build artifact 是否同 PR`
        )
      }
    }
    console.log(`✓ prod emit OK（${manifest.classic.length} entries：classic shape + temp/committed byte-equal）`)
  }

  // 10. 清乾淨
  cleanTmp()

  console.log('=== browser pipeline canary OK ===')
}

main()
