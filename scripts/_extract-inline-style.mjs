#!/usr/bin/env node
// 把 src/pages/<page>.html 內所有 <style>...</style> 串接到 src/css/<page>.css，
// HTML 中第一個 <style> 換成 <link rel="stylesheet" href="/css/<page>.css">，
// 其他 <style> 全部移除。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.env.DRY === '1'

const pages = process.argv.slice(2)
if (pages.length === 0) { console.error('usage: ... <page1> <page2> ...'); process.exit(1) }

for (const p of pages) {
  const htmlPath = path.join(ROOT, 'src/pages', `${p}.html`)
  const cssPath = path.join(ROOT, 'src/css', `${p}.css`)
  let html = fs.readFileSync(htmlPath, 'utf8')

  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  const matches = [...html.matchAll(re)]
  if (matches.length === 0) { console.log(`[skip] ${p}: no inline style`); continue }

  const dedent = (raw) => {
    let body = raw.replace(/^\r?\n/, '').replace(/\r?\n\s*$/, '')
    const lines = body.split(/\r?\n/)
    const indents = lines.filter(l => l.trim()).map(l => (l.match(/^[ \t]*/) || [''])[0].length)
    const minIndent = indents.length ? Math.min(...indents) : 0
    return minIndent > 0 ? lines.map(l => l.slice(minIndent)).join('\n') : body
  }

  const parts = matches.map((m, i) => {
    const dd = dedent(m[1])
    return matches.length > 1 ? `/* ── block ${i + 1}/${matches.length} ── */\n${dd}` : dd
  })
  const css = parts.join('\n\n')

  // 倒序刪 inline style；最後一個位置（最早出現的）塞 link
  let newHtml = html
  const linkTag = `<link rel="stylesheet" href="/css/${p}.css" />`
  const first = matches[0]
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    if (i === 0) {
      newHtml = newHtml.slice(0, m.index) + linkTag + newHtml.slice(m.index + m[0].length)
    } else {
      let start = m.index
      while (start > 0 && (newHtml[start - 1] === ' ' || newHtml[start - 1] === '\t')) start--
      let end = m.index + m[0].length
      if (newHtml[end] === '\r') end++
      if (newHtml[end] === '\n') end++
      newHtml = newHtml.slice(0, start) + newHtml.slice(end)
    }
  }

  console.log(`[ok] ${p}: ${matches.length} block(s), ${css.split('\n').length} lines -> src/css/${p}.css`)
  if (!DRY) {
    fs.writeFileSync(cssPath, css + '\n', 'utf8')
    fs.writeFileSync(htmlPath, newHtml, 'utf8')
  }
}
