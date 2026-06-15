#!/usr/bin/env node
/**
 * build-partials.js — 把 src/pages/*.html 用 src/partials/*.hbs 組裝後輸出到 public/
 *
 * 用法：
 *   node scripts/build-partials.js          # 一次性 build
 *   node scripts/build-partials.js --watch  # watch 模式（chokidar 監聽 src/）
 *
 * Handlebars 語法：
 *   {{> partial-name var="value"}}     ← 引用 partial
 *   {{varName}}                         ← 變數插值
 *   {{#if (eq active "portfolio")}}...{{/if}}  ← 條件
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import Handlebars from 'handlebars'
import { injectI18n } from './lib/inject-i18n.js'
import { assetVersion, resolveAssetPath, injectCacheBust } from './lib/asset-versioning.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cache-bust `?v=` is per-file content hash via scripts/lib/asset-versioning.mjs (that file
// explains why git-HEAD versioning was replaced). Tailwind is special-cased: tailwind.config.cjs
// scans the generated public HTML, so tailwind.css is built only AFTER pages render — PASS-1
// emits a sentinel for its ?v=, and patchTailwindVer (PASS-2) replaces it with the real hash.
const TAILWIND_PATH = '/css/tailwind.css'
const TAILWIND_SENTINEL = '__TAILWIND_VER_PENDING__'
const ROOT = path.resolve(__dirname, '..')
const SRC_PAGES = path.join(ROOT, 'src/pages')
const SRC_PARTIALS = path.join(ROOT, 'src/partials')
const SRC_I18N = path.join(ROOT, 'src/i18n')
const SRC_JS = path.join(ROOT, 'src/js')
const SRC_CSS = path.join(ROOT, 'src/css')
const OUT_DIR = path.join(ROOT, 'public')
const OUT_JS = path.join(OUT_DIR, 'js')
const OUT_CSS = path.join(OUT_DIR, 'css')

// Stage 5 prep (2026-05-21)：injectI18n 抽至 scripts/lib/inject-i18n.js（ESM helper），
// build-partials 與 verify-browser-pipeline 共用同一條 inject path。

// ── Helpers ─────────────────────────────────────────────
Handlebars.registerHelper('eq', (a, b) => a === b)
Handlebars.registerHelper('neq', (a, b) => a !== b)

// ── Partial loading ─────────────────────────────────────
async function loadPartials() {
  // 清掉舊註冊（watch 模式下重 build 用）
  for (const name of Object.keys(Handlebars.partials)) {
    Handlebars.unregisterPartial(name)
  }
  let count = 0
  try {
    const files = await fs.readdir(SRC_PARTIALS)
    for (const f of files) {
      if (!f.endsWith('.hbs')) continue
      const name = f.replace(/\.hbs$/, '')
      const src = await fs.readFile(path.join(SRC_PARTIALS, f), 'utf8')
      Handlebars.registerPartial(name, src)
      count++
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  return count
}

// ── Page build ──────────────────────────────────────────
async function buildPage(filename) {
  const srcPath = path.join(SRC_PAGES, filename)
  const outPath = path.join(OUT_DIR, filename)
  const raw = await fs.readFile(srcPath, 'utf8')
  const withI18n = await injectI18n(filename, raw)
  const tpl = Handlebars.compile(withI18n, { noEscape: true })
  const rendered = tpl({})
  // P2-8：HTML 出檔前統一注入 ?v=<git-hash>，蓋掉手寫的 ?v=
  // 並清掉「整行皆空白」的行（Handlebars 巢狀 partial 縮排會把 partial 內的空行渲染成
  // 純空白行 → git diff --check / PR hygiene 會抱怨）。只清整行空白、不動有內容行的尾隨
  // 空白，故不影響 <pre>/<textarea> 內容（站內 textarea 皆空 default、無多行內容）。
  const out = injectCacheBust(rendered, pass1Ver).replace(/^[ \t]+$/gm, '')
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, out, 'utf8')
}

// ── JS build ────────────────────────────────────────────
// 三段式：
//   1) Stage 4.5b-1 起 src/js/*.ts (manifest.classic) → tsc -p tsconfig.browser-classic.prod.json → emit public/js/*.js
//   2) PR-5v-a 起 src/js/*.ts (manifest.module) → tsc -p tsconfig.browser-module.prod.json → emit public/js/*.js (ES module)
//   3) src/js/*.js → 注入 i18n sentinel 後 copy 到 public/js/
// 與 page 相同的字典（src/i18n/<name>.json）會被引用，例如
// src/js/login.js 對應 src/i18n/login.json。
async function buildJs() {
  let tsCount = 0
  let manifest = null
  try {
    const manifestRaw = await fs.readFile(path.join(SRC_JS, 'browser-script-manifest.json'), 'utf8')
    manifest = JSON.parse(manifestRaw)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }

  const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

  async function postEmitI18nInject(entries) {
    // post-emit i18n inject（rootDir=src/js, outDir=public/js；classic/module prod tsconfig 同 emit 路徑語意）
    for (const entry of entries) {
      const rel = path.relative(SRC_JS, path.join(ROOT, entry))
      const emittedPath = path.join(OUT_JS, rel.replace(/\.ts$/, '.js'))
      const emittedBasename = path.basename(emittedPath)
      const emitted = await fs.readFile(emittedPath, 'utf8')
      const injected = await injectI18n(emittedBasename, emitted)
      if (injected !== emitted) {
        await fs.writeFile(emittedPath, injected, 'utf8')
      }
    }
  }

  // 1) tsc emit classic prod entries（manifest.classic）
  //    Stage 5 prep (2026-05-21)：tsc emit 之後對每個 emit 結果跑 injectI18n，
  //    讓 manifest.classic entries 也支援 /*@i18n@*\/{} sentinel
  //    （rename .js→.ts 後 i18n 在 prod 不再 silently 壞掉）。
  if (manifest && Array.isArray(manifest.classic) && manifest.classic.length > 0) {
    execFileSync(process.execPath, [tscJs, '-p', 'tsconfig.browser-classic.prod.json', '--pretty', 'false'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'],
      maxBuffer: 16 * 1024 * 1024,
    })
    await postEmitI18nInject(manifest.classic)
    tsCount += manifest.classic.length
  }

  // 2) tsc emit module prod entries（manifest.module）— PR-5v-a 起
  //    module lane 與 classic 同享 i18n inject pipeline；emit 為 ES module，需以
  //    <script type="module"> 載入（HTML 端責任，build 端不分流）。
  if (manifest && Array.isArray(manifest.module) && manifest.module.length > 0) {
    execFileSync(process.execPath, [tscJs, '-p', 'tsconfig.browser-module.prod.json', '--pretty', 'false'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'],
      maxBuffer: 16 * 1024 * 1024,
    })
    await postEmitI18nInject(manifest.module)
    tsCount += manifest.module.length
  }

  // 3) .js sources → injectI18n → public/js/
  let jsCount = 0
  try {
    const files = await fs.readdir(SRC_JS)
    await fs.mkdir(OUT_JS, { recursive: true })
    for (const f of files) {
      if (!f.endsWith('.js')) continue
      const src = await fs.readFile(path.join(SRC_JS, f), 'utf8')
      const out = await injectI18n(f, src)
      await fs.writeFile(path.join(OUT_JS, f), out, 'utf8')
      jsCount++
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  return tsCount + jsCount
}

// ── CSS copy ────────────────────────────────────────────
// 把 src/css/*.css 直接 copy 到 public/css/，排除 tailwind.css 入口
// (那個由 tailwind CLI 透過 npm run build:css 處理)
async function buildCss() {
  let count = 0
  try {
    const files = await fs.readdir(SRC_CSS)
    await fs.mkdir(OUT_CSS, { recursive: true })
    for (const f of files) {
      if (!f.endsWith('.css')) continue
      if (f === 'tailwind.css') continue
      const src = await fs.readFile(path.join(SRC_CSS, f), 'utf8')
      await fs.writeFile(path.join(OUT_CSS, f), src, 'utf8')
      count++
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  return count
}

// PASS-1 version resolver: content-hash every local asset EXCEPT /css/tailwind.css. Tailwind
// scans the rendered public HTML, so its file exists only after pages render; defer its ?v= to
// a sentinel that PASS-2 patches. (function decl → hoisted, so buildPage above can reference it.)
function pass1Ver(assetPath) {
  if (assetPath === TAILWIND_PATH) return TAILWIND_SENTINEL
  return assetVersion(resolveAssetPath(assetPath, OUT_DIR))
}

// Build final public/css/tailwind.css via the local Tailwind CLI (execFileSync, no shell string).
// MUST run after PASS-1 renders pages — Tailwind's content source is ./public/**/*.html + js.
function ensureTailwind() {
  const tailwindCli = path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js')
  execFileSync(
    process.execPath,
    [tailwindCli, '-c', 'tailwind.config.cjs', '-i', 'src/css/tailwind.css', '-o', 'public/css/tailwind.css', '--minify'],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 16 * 1024 * 1024 },
  )
}

// PASS-2: replace tailwind.css's deferred sentinel with its real content hash. Targeted literal
// substitution only; the reverse-check proves no other HTML byte changed (build-time guard for
// the "PASS-2 must not re-render / drift" invariant — owner hard gate).
async function patchTailwindVer() {
  const twVer = assetVersion(resolveAssetPath(TAILWIND_PATH, OUT_DIR))
  const needle = `${TAILWIND_PATH}?v=${TAILWIND_SENTINEL}`
  const replacement = `${TAILWIND_PATH}?v=${twVer}`
  let patched = 0
  const files = await fs.readdir(OUT_DIR)
  for (const f of files) {
    if (!f.endsWith('.html')) continue
    const p = path.join(OUT_DIR, f)
    const html = await fs.readFile(p, 'utf8')
    if (!html.includes(TAILWIND_SENTINEL)) continue
    const next = html.split(needle).join(replacement)
    if (next.includes(TAILWIND_SENTINEL)) {
      throw new Error(`PASS-2: ${f} still has tailwind sentinel after patch (unexpected reference shape)`)
    }
    if (next.split(replacement).join(needle) !== html) {
      throw new Error(`PASS-2: non-targeted change detected in ${f} — only tailwind.css ?v= may change`)
    }
    await fs.writeFile(p, next, 'utf8')
    patched++
  }
  return { patched, twVer }
}

async function buildAll() {
  const partialCount = await loadPartials()
  // assets-first / HTML-last (two-pass): JS + non-tailwind CSS must exist before pages render so
  // PASS-1 can content-hash them; tailwind.css is built after (it scans the pages) then patched.
  const jsCount = await buildJs()
  const cssCount = await buildCss()
  let pageCount = 0
  try {
    const files = await fs.readdir(SRC_PAGES)
    for (const f of files) {
      if (!f.endsWith('.html')) continue
      await buildPage(f)
      pageCount++
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  ensureTailwind()
  const { patched, twVer } = await patchTailwindVer()
  const ts = new Date().toLocaleTimeString()
  console.log(`[${ts}] built ${pageCount} pages, ${jsCount} js, ${cssCount} css, ${partialCount} partials; tailwind ?v=${twVer} (${patched} page(s))`)
}

// ── Watch mode ──────────────────────────────────────────
async function watch() {
  const { default: chokidar } = await import('chokidar')
  await buildAll()
  console.log('watching src/ for changes...')
  const watcher = chokidar.watch([SRC_PAGES, SRC_PARTIALS, SRC_I18N, SRC_JS, SRC_CSS], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 30 },
  })
  let pending = null
  const trigger = () => {
    clearTimeout(pending)
    pending = setTimeout(async () => {
      try { await buildAll() } catch (e) { console.error('build error:', e.message) }
    }, 50)
  }
  watcher.on('add', trigger).on('change', trigger).on('unlink', trigger)
}

// ── Main ────────────────────────────────────────────────
const isWatch = process.argv.includes('--watch')
if (isWatch) {
  watch().catch(err => { console.error(err); process.exit(1) })
} else {
  buildAll().catch(err => { console.error(err); process.exit(1) })
}
