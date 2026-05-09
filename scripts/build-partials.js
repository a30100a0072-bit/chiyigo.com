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
import { execSync } from 'node:child_process'
import Handlebars from 'handlebars'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// P2-8：build-time cache-bust 版號（git short hash），全站 <script src> / <link href> 統一蓋。
// 失敗（沒裝 git / 不在 repo）退回 timestamp，不擋 build。
function resolveBuildVer() {
  try {
    const h = execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
    if (/^[0-9a-f]{6,12}$/.test(h)) return h
  } catch { /* fall through */ }
  return 'b' + Date.now().toString(36)
}
const BUILD_VER = resolveBuildVer()

// 規則：只蓋 src 開頭是 / 的本地資源（避開 CDN / 跨網域）。
//   - 已有 ?v=... → 取代為 build hash（可手動 bump 但被自動覆蓋為一致）
//   - 已有其他 ?query → 後綴 &v=hash
//   - 沒 query → 加 ?v=hash
const ASSET_RE = /\b(src|href)="(\/[^"#?]+\.(?:js|css|mjs))(\?[^"#]*)?(#[^"]*)?"/g
function injectCacheBust(html) {
  return html.replace(ASSET_RE, (_, attr, p, query, hash) => {
    let q
    if (!query) q = `?v=${BUILD_VER}`
    else if (/[?&]v=/.test(query)) q = query.replace(/([?&])v=[^&]*/, `$1v=${BUILD_VER}`)
    else q = `${query}&v=${BUILD_VER}`
    return `${attr}="${p}${q}${hash || ''}"`
  })
}
const ROOT = path.resolve(__dirname, '..')
const SRC_PAGES = path.join(ROOT, 'src/pages')
const SRC_PARTIALS = path.join(ROOT, 'src/partials')
const SRC_I18N = path.join(ROOT, 'src/i18n')
const SRC_JS = path.join(ROOT, 'src/js')
const SRC_CSS = path.join(ROOT, 'src/css')
const OUT_DIR = path.join(ROOT, 'public')
const OUT_JS = path.join(OUT_DIR, 'js')
const OUT_CSS = path.join(OUT_DIR, 'css')

// 支援任意變數名（LANGS_I18N / LANGS_D / LANGS / ...），sentinel 統一為 /*@i18n@*/{}
const I18N_SENTINEL = /const (\w+) = \/\*@i18n@\*\/\{\};/g

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

// ── i18n inject ─────────────────────────────────────────
// 頁面內以 `const LANGS_I18N = /*@i18n@*/{};` 標記注入點，
// build 時讀 src/i18n/<page>.json 替換為實際字典。
async function injectI18n(filename, html) {
  // 收集所有 sentinel 出現（一頁可能有多個字典，例如 LANGS_I18N + LANGS_D）
  const matches = [...html.matchAll(I18N_SENTINEL)]
  const jsonPath = path.join(SRC_I18N, filename.replace(/\.(html|js)$/, '.json'))
  let dict
  try { dict = JSON.parse(await fs.readFile(jsonPath, 'utf8')) }
  catch (e) { if (e.code !== 'ENOENT') throw e }

  if (matches.length && !dict)
    throw new Error(`${filename} has @i18n@ sentinel but ${path.relative(ROOT, jsonPath)} not found`)
  if (!matches.length && dict)
    console.warn(`[warn] ${path.relative(ROOT, jsonPath)} exists but ${filename} has no @i18n@ sentinel`)
  if (!matches.length) return html

  // 多 sentinel 情境：JSON 頂層用變數名分組 { LANGS_I18N: {...}, LANGS_D: {...} }
  // 單 sentinel 情境：JSON 頂層直接是字典 { 'zh-TW': {...}, ... }
  const isMulti = matches.length > 1
  if (isMulti) {
    for (const [, varName] of matches) {
      if (!dict[varName])
        throw new Error(`${filename}: sentinel '${varName}' but ${jsonPath} missing key '${varName}'`)
    }
  }

  return html.replace(I18N_SENTINEL, (_, varName) => {
    const data = isMulti ? dict[varName] : dict
    return `const ${varName} = ${JSON.stringify(data)};`
  })
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
  const out = injectCacheBust(rendered)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, out, 'utf8')
}

// ── JS build ────────────────────────────────────────────
// 把 src/js/*.js 注入 i18n sentinel 後 copy 到 public/js/。
// 與 page 相同的字典（src/i18n/<name>.json）會被引用，例如
// src/js/login.js 對應 src/i18n/login.json。
async function buildJs() {
  let count = 0
  try {
    const files = await fs.readdir(SRC_JS)
    await fs.mkdir(OUT_JS, { recursive: true })
    for (const f of files) {
      if (!f.endsWith('.js')) continue
      const src = await fs.readFile(path.join(SRC_JS, f), 'utf8')
      const out = await injectI18n(f, src)
      await fs.writeFile(path.join(OUT_JS, f), out, 'utf8')
      count++
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  return count
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

async function buildAll() {
  const partialCount = await loadPartials()
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
  const jsCount = await buildJs()
  const cssCount = await buildCss()
  const ts = new Date().toLocaleTimeString()
  console.log(`[${ts}] built ${pageCount} pages, ${jsCount} js, ${cssCount} css, ${partialCount} partials`)
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
