#!/usr/bin/env node
// 掃 public/*.html 抽出所有 inline <script> (HEAD + BODY 殘留) 算 SHA-256，
// 列出 CSP script-src 需要加的 'sha256-XXX' 清單。
// CSP hash 規則：對 <script>...</script> 標籤內的「精確內容」(含前後空白) 算 SHA-256，
// 結果用 base64 編碼。
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(__dirname, '../public')

const files = (await fs.readdir(PUBLIC_DIR)).filter(f => f.endsWith('.html'))

const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g
const seen = new Map()  // hash -> { content, files: [] }

for (const f of files) {
  const html = await fs.readFile(path.join(PUBLIC_DIR, f), 'utf8')
  const matches = [...html.matchAll(re)]
  for (const m of matches) {
    const content = m[1]
    const hash = crypto.createHash('sha256').update(content).digest('base64')
    if (!seen.has(hash)) seen.set(hash, { content, files: [] })
    seen.get(hash).files.push(f)
  }
}

console.log(`Found ${seen.size} unique inline script(s) across ${files.length} pages\n`)
const hashes = []
for (const [hash, info] of seen) {
  const preview = info.content.replace(/\s+/g, ' ').trim().slice(0, 80)
  console.log(`'sha256-${hash}'`)
  console.log(`  files: ${info.files.length} (${info.files.slice(0, 3).join(', ')}${info.files.length > 3 ? '…' : ''})`)
  console.log(`  preview: ${preview}\n`)
  hashes.push(`'sha256-${hash}'`)
}

console.log('\n── CSP script-src additions ──')
console.log(hashes.join(' '))
