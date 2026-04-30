#!/usr/bin/env node
// 一次性 helper：把 src/pages/<page>.html 最後一個 <script>...</script>（main page logic）
// 抽到 src/js/<page>.js，HTML 內容改成 <script src="/js/<page>.js" defer></script>。
// 用法: node scripts/_extract-inline-script.mjs <page1> <page2> ...
//   <page> 不含副檔名，如 bind-email
// 規則：
//   - 只動 body 內、最後一個（最末尾）<script>...</script>（不含 src 屬性）
//   - 保留 head 內 theme-init inline 不動
//   - 保留 cloudflareinsights / qrcode 等 ext src
//   - dry-run 模式：DRY=1 node ...

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\//, '').replace(/^([A-Za-z]:)/, '$1'), '..')
const DRY = process.env.DRY === '1'

const pages = process.argv.slice(2)
if (pages.length === 0) { console.error('usage: ... <page1> <page2> ...'); process.exit(1) }

for (const p of pages) {
  const htmlPath = path.join(ROOT, 'src/pages', `${p}.html`)
  const jsPath = path.join(ROOT, 'src/js', `${p}.js`)
  let html = fs.readFileSync(htmlPath, 'utf8')

  // find all <script>...</script> blocks WITHOUT src attribute, pick the LAST one
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
  const matches = [...html.matchAll(re)]
  if (matches.length === 0) { console.log(`[skip] ${p}: no inline script`); continue }
  const last = matches[matches.length - 1]
  const inner = last[1]
  // detect theme-init pattern (single line, getItem('theme'))
  if (/getItem\(['"]theme['"]\)/.test(inner) && inner.length < 200) {
    console.log(`[skip] ${p}: last inline is theme-init, only one inline block found`)
    continue
  }
  // strip leading/trailing single newline + leading 4-space indent
  let body = inner
  body = body.replace(/^\r?\n/, '').replace(/\r?\n\s*$/, '')
  // de-indent (find min leading whitespace)
  const lines = body.split(/\r?\n/)
  const indents = lines.filter(l => l.trim()).map(l => (l.match(/^[ \t]*/) || [''])[0].length)
  const minIndent = indents.length ? Math.min(...indents) : 0
  if (minIndent > 0) {
    body = lines.map(l => l.slice(minIndent)).join('\n')
  }

  const replacement = `<script src="/js/${p}.js" defer></script>`
  const before = html.slice(0, last.index)
  const after = html.slice(last.index + last[0].length)
  const newHtml = before + replacement + after

  console.log(`[ok] ${p}: extracted ${body.split('\n').length} lines -> src/js/${p}.js`)
  if (!DRY) {
    fs.writeFileSync(jsPath, body + '\n', 'utf8')
    fs.writeFileSync(htmlPath, newHtml, 'utf8')
  }
}
