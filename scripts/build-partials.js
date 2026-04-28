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
const OUT_DIR = path.join(ROOT, 'public')

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
  const tpl = Handlebars.compile(raw, { noEscape: true })
  const out = tpl({})
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, out, 'utf8')
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
  const ts = new Date().toLocaleTimeString()
  console.log(`[${ts}] built ${pageCount} pages with ${partialCount} partials`)
}

// ── Watch mode ──────────────────────────────────────────
async function watch() {
  const { default: chokidar } = await import('chokidar')
  await buildAll()
  console.log('watching src/ for changes...')
  const watcher = chokidar.watch([SRC_PAGES, SRC_PARTIALS], {
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
