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

  // 抽出 BODY 內所有 inline <script>，依出現順序串接到單一 .js 檔。
  // HEAD 內的 inline (theme-init / auth gate / pre-load redirect) 全部保留，
  // 因為它們需要 parser-blocking / document.write / 早期同步執行。
  const headEnd = html.indexOf('</head>')
  if (headEnd < 0) { console.log(`[skip] ${p}: no </head> found`); continue }

  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
  const matches = [...html.matchAll(re)]
  if (matches.length === 0) { console.log(`[skip] ${p}: no inline script`); continue }

  const targets = matches.filter(m => m.index > headEnd)
  if (targets.length === 0) { console.log(`[skip] ${p}: all inline scripts in <head>`); continue }

  const dedent = (raw) => {
    let body = raw.replace(/^\r?\n/, '').replace(/\r?\n\s*$/, '')
    const lines = body.split(/\r?\n/)
    const indents = lines.filter(l => l.trim()).map(l => (l.match(/^[ \t]*/) || [''])[0].length)
    const minIndent = indents.length ? Math.min(...indents) : 0
    return minIndent > 0 ? lines.map(l => l.slice(minIndent)).join('\n') : body
  }

  // 串接內容（多 block 之間用空行分隔，並標註原 block 順序）
  const bodyParts = targets.map((m, i) => {
    const dd = dedent(m[1])
    return targets.length > 1 ? `// ── block ${i + 1}/${targets.length} ──\n${dd}` : dd
  })
  const body = bodyParts.join('\n\n')

  // 在 HTML 中：移除每個 target inline block，最後一個位置塞入 <script src="/js/<page>.js" defer>
  // 由後往前 splice 才不會錯位
  let newHtml = html
  const lastTarget = targets[targets.length - 1]
  const replacement = `<script src="/js/${p}.js" defer></script>`
  // 倒序刪
  for (let i = targets.length - 1; i >= 0; i--) {
    const m = targets[i]
    if (i === targets.length - 1) {
      newHtml = newHtml.slice(0, m.index) + replacement + newHtml.slice(m.index + m[0].length)
    } else {
      // 移除 + 同時清掉前面緊鄰的空白行（避免留空行垃圾）
      let start = m.index
      // 往前吃同行的縮排空白
      while (start > 0 && (newHtml[start - 1] === ' ' || newHtml[start - 1] === '\t')) start--
      let end = m.index + m[0].length
      // 往後吃換行
      if (newHtml[end] === '\r') end++
      if (newHtml[end] === '\n') end++
      newHtml = newHtml.slice(0, start) + newHtml.slice(end)
    }
  }

  console.log(`[ok] ${p}: ${targets.length} block(s), ${body.split('\n').length} lines -> src/js/${p}.js`)
  if (!DRY) {
    fs.writeFileSync(jsPath, body + '\n', 'utf8')
    fs.writeFileSync(htmlPath, newHtml, 'utf8')
  }
}
