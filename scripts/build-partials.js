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
import { execSync, execFileSync } from 'node:child_process'
import Handlebars from 'handlebars'
import { injectI18n } from './lib/inject-i18n.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// P2-8：build-time cache-bust 版號（git short hash），全站 <script src> / <link href> 統一蓋。
// 失敗（沒裝 git / 不在 repo）退回 timestamp，不擋 build。
// BUILD_VER env override：cache-bust commit 重跑 build 時鎖定目標 hash，保證 idempotent。
function resolveBuildVer() {
  const envVer = process.env.BUILD_VER && process.env.BUILD_VER.trim()
  if (envVer && /^[0-9a-zA-Z._-]{1,40}$/.test(envVer)) return envVer
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
  const out = injectCacheBust(rendered)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, out, 'utf8')
}

// ── JS build ────────────────────────────────────────────
// 兩段式：
//   1) Stage 4.5b-1 起 src/js/*.ts → 走 tsc -p tsconfig.browser-classic.prod.json → emit public/js/*.js
//   2) src/js/*.js → 注入 i18n sentinel 後 copy 到 public/js/
// 與 page 相同的字典（src/i18n/<name>.json）會被引用，例如
// src/js/login.js 對應 src/i18n/login.json。
async function buildJs() {
  let tsCount = 0
  // 1) tsc emit classic prod entries（manifest.classic 所列 src/js/*.ts）
  //    Stage 5 prep (2026-05-21)：tsc emit 之後對每個 emit 結果跑 injectI18n，
  //    讓 manifest.classic entries 也支援 /*@i18n@*\/{} sentinel
  //    （rename .js→.ts 後 i18n 在 prod 不再 silently 壞掉）。
  //    路徑用 rootDir-derived 推導，避免 nested entry 未來分叉（codex prep r1 拍板）。
  try {
    const manifestRaw = await fs.readFile(path.join(SRC_JS, 'browser-script-manifest.json'), 'utf8')
    const manifest = JSON.parse(manifestRaw)
    if (Array.isArray(manifest.classic) && manifest.classic.length > 0) {
      const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
      execFileSync(process.execPath, [tscJs, '-p', 'tsconfig.browser-classic.prod.json', '--pretty', 'false'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'],
        maxBuffer: 16 * 1024 * 1024,
      })
      // post-emit i18n inject（rootDir=src/js, outDir=public/js；同 tsconfig.browser-classic.prod.json）
      for (const entry of manifest.classic) {
        const rel = path.relative(SRC_JS, path.join(ROOT, entry))
        const emittedPath = path.join(OUT_JS, rel.replace(/\.ts$/, '.js'))
        const emittedBasename = path.basename(emittedPath)
        const emitted = await fs.readFile(emittedPath, 'utf8')
        const injected = await injectI18n(emittedBasename, emitted)
        if (injected !== emitted) {
          await fs.writeFile(emittedPath, injected, 'utf8')
        }
      }
      tsCount = manifest.classic.length
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }

  // 2) .js sources → injectI18n → public/js/
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
