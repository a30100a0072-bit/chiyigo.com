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
import Handlebars from 'handlebars'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC_PAGES = path.join(ROOT, 'src/pages')
const SRC_PARTIALS = path.join(ROOT, 'src/partials')
const SRC_I18N = path.join(ROOT, 'src/i18n')
const SRC_JS = path.join(ROOT, 'src/js')
const OUT_DIR = path.join(ROOT, 'public')
const OUT_JS = path.join(OUT_DIR, 'js')

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
  const out = tpl({})
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
  const ts = new Date().toLocaleTimeString()
  console.log(`[${ts}] built ${pageCount} pages, ${jsCount} js files, ${partialCount} partials`)
}

// ── Watch mode ──────────────────────────────────────────
async function watch() {
  const { default: chokidar } = await import('chokidar')
  await buildAll()
  console.log('watching src/ for changes...')
  const watcher = chokidar.watch([SRC_PAGES, SRC_PARTIALS, SRC_I18N, SRC_JS], {
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
