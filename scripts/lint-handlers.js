#!/usr/bin/env node
/**
 * lint-handlers.js — 偵測「函式 / 按鈕 handler 漏綁」常見錯誤
 *
 * 起因：2026-04-30 修地球儀按鈕 bug 時發現 src/js/login.js 與 admin-requisitions.js
 *       都有定義 toggleLangDrop / toggleTopLangDrop 但漏掉 addEventListener，
 *       導致按鈕完全無反應且不會報錯。
 *
 * 兩道檢查：
 *  (A) Unused function：src/js/*.js 中有 named function 定義但全檔僅出現 1 次（即定義），
 *      代表沒人呼叫。常見原因是漏綁 addEventListener。
 *  (B) Unwired interactive button：public/*.html 中有 `id="xxx-btn"`，但對應 .js 完全沒
 *      mention 此 id（不在引號字串內），可能該按鈕沒人接 click handler。
 *
 * 都是 warn-only，不 fail build。給 npm run lint:handlers 跑。
 */

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT      = path.join(__dirname, '..')
const SRC_JS    = path.join(ROOT, 'src', 'js')
const PUB_HTML  = path.join(ROOT, 'public')
const PUB_JS    = path.join(ROOT, 'public', 'js')

// 已知會被外部呼叫（HTML 載入即跑 / 全域導出 / window onload）的入口名單
const ENTRY_FN_ALLOWLIST = new Set([
  'init', 'main', 'onload', 'ready',
  // CSP 零 inline 設計下，HTML 並無 onclick="..."，理論上沒有跨檔 implicit caller，
  // 但有些 legacy module 仍會把函式掛 window；如有需要可在這裡 allowlist。
])

// 已知不需要 click handler 的按鈕 id pattern（純表單 submit / 視覺元素 / Tailwind 顯示用）
const BTN_IGNORE_PATTERNS = [
  /^submit-/i,                  // form submit button
  /^cancel-/i,                  // form cancel button
  /^close-modal-/i,             // bootstrap-style close button
  /-skeleton-btn$/i,            // skeleton loader 假按鈕
  /^passkey-login-btn$/,        // handler 在 auth-ui.js（非 login.js）
]

const warnings = []

// ── (A) Unused named function ──────────────────────────────────────

for (const file of fs.readdirSync(SRC_JS).filter(f => f.endsWith('.js'))) {
  const code  = fs.readFileSync(path.join(SRC_JS, file), 'utf8')
  // 抓 `function NAME(` 開頭的命名宣告
  const defs  = [...code.matchAll(/(?:^|\n)\s*function\s+([a-zA-Z_$][\w$]*)\s*\(/g)]

  for (const [, name] of defs) {
    if (ENTRY_FN_ALLOWLIST.has(name)) continue
    // 計算這個 token 在全檔出現幾次
    const refs = code.match(new RegExp(`\\b${name}\\b`, 'g')) || []
    // 1 = 只剩定義本身；0 不會發生（既然定義抓到）
    if (refs.length <= 1) {
      warnings.push({
        file:    `src/js/${file}`,
        kind:    'unused-fn',
        message: `函式 "${name}" 已定義但全檔僅出現 1 次（疑漏綁 addEventListener / 死碼）`,
      })
    }
  }
}

// ── (B) Unwired interactive button ─────────────────────────────────

if (fs.existsSync(PUB_HTML) && fs.existsSync(PUB_JS)) {
  for (const html of fs.readdirSync(PUB_HTML).filter(f => f.endsWith('.html'))) {
    const htmlPath = path.join(PUB_HTML, html)
    const jsName   = html.replace(/\.html$/, '.js')
    const jsPath   = path.join(PUB_JS, jsName)
    if (!fs.existsSync(jsPath)) continue

    const htmlSrc = fs.readFileSync(htmlPath, 'utf8')
    const jsSrc   = fs.readFileSync(jsPath, 'utf8')

    // 抓所有 <button id="xxx-btn" ...> 完整 tag，過濾 type="submit"（表單按鈕，由 form submit 處理）
    const btnTags = [...htmlSrc.matchAll(/<button[^>]*\bid="([a-z][a-z0-9-]*-btn)"[^>]*>/gi)]
    const ids = new Set()
    for (const [tag, id] of btnTags) {
      if (/\btype="submit"/i.test(tag)) continue   // form submit button — 不需 click handler
      ids.add(id)
    }

    for (const id of ids) {
      if (BTN_IGNORE_PATTERNS.some(re => re.test(id))) continue

      // JS 引用這個 id（雙引號 / 單引號 / template literal）
      const mentioned =
        jsSrc.includes(`'${id}'`) ||
        jsSrc.includes(`"${id}"`) ||
        jsSrc.includes(`\`${id}\``)
      if (!mentioned) {
        warnings.push({
          file:    `public/${html}`,
          kind:    'unwired-btn',
          message: `#${id} 在 HTML 上存在，但 ${jsName} 完全未引用此 id（疑無 click handler）`,
        })
      }
    }
  }
}

// ── 輸出 ───────────────────────────────────────────────────────────

if (warnings.length === 0) {
  console.log('[lint:handlers] OK ✅ 沒發現未綁 handler 的函式 / 按鈕')
  process.exit(0)
}

console.warn(`[lint:handlers] 發現 ${warnings.length} 個警告：\n`)
const grouped = warnings.reduce((acc, w) => {
  ;(acc[w.file] ||= []).push(w); return acc
}, {})
for (const [file, ws] of Object.entries(grouped)) {
  console.warn(`  ${file}`)
  for (const w of ws) console.warn(`    - [${w.kind}] ${w.message}`)
}
console.warn('\n警告即可（不 fail build）。若是預期行為，可在 ENTRY_FN_ALLOWLIST 或 BTN_IGNORE_PATTERNS 加白名單。')
process.exit(0)
