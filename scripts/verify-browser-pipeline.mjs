#!/usr/bin/env node
/**
 * verify-browser-pipeline.mjs — Stage 4.5a browser pipeline canary CI gate
 *
 * 跑兩條 browser tsconfig 對 canary fixture，驗：
 *   classic：emit 含 marker、不含 `export {};`、不含 import/require shim
 *   module ：emit 含 marker、含 export
 *   manifest 結構（canary.classic / canary.module 指向實際存在的 fixture 檔）
 *
 * Why：Stage 4.5a 不動 build-partials.js（4.5b 才整合），但仍需 CI 守門 emit pipeline 不退化。
 *      future Stage 5+ 加進真 src/js/*.ts 入口前，這個 canary 是唯一證明 emit 真會 round-trip 的機制。
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
  // 剝 // line comment 與 /* */ block comment，避免註解內字面字串騙過 ESM-shape 檢查。
  // 不處理字串 literal 內的 `//` `/*`（canary 內容不會有），夠用即可。
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
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

  // 2. 清舊 emit
  cleanTmp()

  // 3. emit classic
  console.log(`→ tsc -p ${CONFIG_CLASSIC}`)
  runTsc(CONFIG_CLASSIC)

  // 4. emit module
  console.log(`→ tsc -p ${CONFIG_MODULE}`)
  runTsc(CONFIG_MODULE)

  // 5. 驗 classic emit
  const classicOut = path.join(TMP_DIR, 'classic', 'scripts', 'fixtures', 'pipeline-canary-classic.js')
  if (!fs.existsSync(classicOut)) fail(`classic emit 缺檔：${classicOut}`)
  const classicContent = fs.readFileSync(classicOut, 'utf8')
  if (!classicContent.includes(MARKER_CLASSIC)) fail(`classic emit 缺 marker "${MARKER_CLASSIC}"`)
  // 關鍵：classic <script> 不能含 ESM 結構（會 SyntaxError）
  // 註解內提到 `export {};` 不算，scan 前先剝 // 與 /* */ 註解
  const classicCode = stripComments(classicContent)
  if (/\bexport\s*\{/.test(classicCode)) fail('classic emit 含 `export {`（會讓 <script> SyntaxError）')
  if (/^\s*export\s+/m.test(classicCode)) fail('classic emit 含 top-level `export` 宣告（會讓 <script> SyntaxError）')
  if (/^\s*import\s+/m.test(classicCode)) fail('classic emit 含 top-level `import`（會讓 <script> SyntaxError）')
  console.log(`✓ classic emit OK（${classicContent.length} bytes，含 marker，無 ESM 結構）`)

  // 6. 驗 module emit
  const moduleOut = path.join(TMP_DIR, 'module', 'scripts', 'fixtures', 'pipeline-canary-module.js')
  if (!fs.existsSync(moduleOut)) fail(`module emit 缺檔：${moduleOut}`)
  const moduleContent = fs.readFileSync(moduleOut, 'utf8')
  if (!moduleContent.includes(MARKER_MODULE)) fail(`module emit 缺 marker "${MARKER_MODULE}"`)
  const moduleCode = stripComments(moduleContent)
  if (!/\bexport\b/.test(moduleCode)) fail('module emit 缺 `export`（應為 ES module 形狀）')
  console.log(`✓ module emit OK（${moduleContent.length} bytes，含 marker 與 export）`)

  // 7. 清乾淨
  cleanTmp()

  console.log('=== browser pipeline canary OK ===')
}

main()
