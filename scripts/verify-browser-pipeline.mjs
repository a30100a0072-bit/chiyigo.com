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

function runTsc(config) {
  // 用 node 直接執行 typescript/bin/tsc（node-executable JS），跨平台一致，
  // 避免 npx 解析、.cmd shim 在 Windows 上的 CVE-2024-27980 shell 限制、DEP0190 警告
  const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    execFileSync(process.execPath, [tscJs, '-p', config, '--pretty', 'false'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '')
    console.error(`tsc -p ${config} 失敗：`)
    console.error(out.split(/\r?\n/).slice(0, 30).map((l) => '  ' + l).join('\n'))
    process.exit(1)
  }
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

  const canaryClassicSrc = path.join(ROOT, manifest.canary.classic)
  const canaryModuleSrc = path.join(ROOT, manifest.canary.module)
  if (!fs.existsSync(canaryClassicSrc)) fail(`canary.classic 來源不存在：${manifest.canary.classic}`)
  if (!fs.existsSync(canaryModuleSrc)) fail(`canary.module 來源不存在：${manifest.canary.module}`)
  console.log(`✓ manifest 結構 OK（classic=${manifest.classic.length} module=${manifest.module.length} canary=2）`)

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

  // 7. 驗 classic emit（output 路徑由 manifest + tsconfig 推導）
  const classicOut = deriveOutputPath(classicCfg, manifest.canary.classic)
  if (!fs.existsSync(classicOut)) fail(`classic emit 缺檔：${classicOut}`)
  const classicContent = fs.readFileSync(classicOut, 'utf8')
  if (!classicContent.includes(MARKER_CLASSIC)) fail(`classic emit 缺 marker "${MARKER_CLASSIC}"`)
  // 關鍵：classic <script> 不能含 ESM 或 CommonJS 結構（會 SyntaxError 或 ReferenceError）
  // 註解內提到 `export {};` 等不算，scan 前先剝 // 與 /* */ 註解
  const classicCode = stripComments(classicContent)
  // ESM 結構
  if (/\bexport\s*\{/.test(classicCode)) fail('classic emit 含 `export {`（會讓 <script> SyntaxError）')
  if (/^\s*export\s+/m.test(classicCode)) fail('classic emit 含 top-level `export` 宣告（會讓 <script> SyntaxError）')
  if (/^\s*import\s+/m.test(classicCode)) fail('classic emit 含 top-level `import`（會讓 <script> SyntaxError）')
  // CommonJS 結構（瀏覽器 classic 環境 require/exports/module 未定義 → ReferenceError）
  if (/\brequire\s*\(/.test(classicCode)) fail('classic emit 含 `require(`（browser classic 無 CommonJS runtime）')
  if (/\bmodule\.exports\b/.test(classicCode)) fail('classic emit 含 `module.exports`（browser classic 無 CommonJS runtime）')
  if (/\bexports\.[A-Za-z_$]/.test(classicCode)) fail('classic emit 含 `exports.<name>`（browser classic 無 CommonJS runtime）')
  if (/\bObject\.defineProperty\s*\(\s*exports\b/.test(classicCode)) fail('classic emit 含 `Object.defineProperty(exports`（CommonJS shim）')
  console.log(`✓ classic emit OK（${classicContent.length} bytes，含 marker，無 ESM/CJS 結構）`)

  // 8. 驗 module emit（output 路徑由 manifest + tsconfig 推導）
  const moduleOut = deriveOutputPath(moduleCfg, manifest.canary.module)
  if (!fs.existsSync(moduleOut)) fail(`module emit 缺檔：${moduleOut}`)
  const moduleContent = fs.readFileSync(moduleOut, 'utf8')
  if (!moduleContent.includes(MARKER_MODULE)) fail(`module emit 缺 marker "${MARKER_MODULE}"`)
  const moduleCode = stripComments(moduleContent)
  if (!/\bexport\b/.test(moduleCode)) fail('module emit 缺 `export`（應為 ES module 形狀）')
  console.log(`✓ module emit OK（${moduleContent.length} bytes，含 marker 與 export）`)

  // 9. 清乾淨
  cleanTmp()

  console.log('=== browser pipeline canary OK ===')
}

main()
