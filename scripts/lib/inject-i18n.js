/**
 * inject-i18n.js — i18n sentinel replacement helper (ESM)
 *
 * 抽自 scripts/build-partials.js，給 build pipeline 與 verify-browser-pipeline
 * 共用同一條 inject path（Stage 5 prep PR，2026-05-21）。
 *
 * Sentinel 寫法：
 *   `const LANGS_I18N = /\*@i18n@*\/{};`            ← default：用檔名推 src/i18n/<name>.json
 *   `const LANGS_D    = /\*@i18n:other-name@*\/{};` ← named：指向 src/i18n/other-name.json
 *
 * Regex 紀律：
 *   - I18N_SENTINEL：寬版（吃 TS emit 在 `*\/` 與 `{}` 中間補空白的情況），caller 用 .replace()
 *   - I18N_RESIDUAL：寬版的「殘留」偵測，verify 用 .test() 抓「該替換沒替換」
 *   - I18N_SENTINEL 帶 /g flag → stateful；不要拿來 .test()（用 I18N_RESIDUAL）
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// scripts/lib/ → repo root
const ROOT = path.resolve(__dirname, '..', '..')
const SRC_I18N = path.join(ROOT, 'src', 'i18n')

// 寬版 replacement regex（codex Stage 5 prep r1 拍板 2026-05-21）：
//   TS emit 在 `*\/` 與 `{}` 中間補空白，例：`const D = /*@i18n:x@*\/ {};`
//   原嚴格版 `\*\/\{\};` 抓不到 TS-emitted sentinel；放寬為 `\*\/\s*\{\s*\};`
//   同時仍吃既有 .js 緊湊形式。
export const I18N_SENTINEL =
  /const\s+(\w+)\s*=\s*\/\*@i18n(?::([a-zA-Z0-9_-]+))?@\*\/\s*\{\s*\};/g

// 殘留偵測（verify 用）：寬鬆只認 `@i18n[:NAME]@` token；不限 const-binding 形狀
//   非 /g，可安全 .test()
export const I18N_RESIDUAL = /@i18n(?::[a-zA-Z0-9_-]+)?@/

/**
 * Replace i18n sentinels in `content` with dictionary content loaded from src/i18n/.
 *
 * @param {string} filename - e.g. "404.js" / "index.html"；用來推 default JSON path
 * @param {string} content
 * @returns {Promise<string>}
 */
export async function injectI18n(filename, content) {
  // 收集所有 sentinel 出現（一頁可能有多個字典，例如 LANGS_I18N + LANGS_D）
  const matches = [...content.matchAll(I18N_SENTINEL)]
  if (!matches.length) {
    const defaultJson = path.join(SRC_I18N, filename.replace(/\.(html|js)$/, '.json'))
    try { await fs.access(defaultJson); console.warn(`[warn] ${path.relative(ROOT, defaultJson)} exists but ${filename} has no @i18n@ sentinel`) }
    catch {}
    return content
  }

  const dictCache = new Map() // jsonName -> parsed dict
  async function loadDict(jsonName) {
    if (dictCache.has(jsonName)) return dictCache.get(jsonName)
    const p = path.join(SRC_I18N, jsonName + '.json')
    let d
    try { d = JSON.parse(await fs.readFile(p, 'utf8')) }
    catch (e) {
      if (e.code === 'ENOENT') throw new Error(`${filename} references i18n '${jsonName}' but ${path.relative(ROOT, p)} not found`)
      throw e
    }
    dictCache.set(jsonName, d)
    return d
  }

  const defaultName = filename.replace(/\.(html|js)$/, '')
  const sentinelMeta = matches.map(m => ({ varName: m[1], jsonName: m[2] || defaultName }))
  const countPerSource = sentinelMeta.reduce((acc, s) => { acc[s.jsonName] = (acc[s.jsonName] || 0) + 1; return acc }, {})

  for (const s of sentinelMeta) {
    const dict = await loadDict(s.jsonName)
    if (countPerSource[s.jsonName] > 1 && !dict[s.varName]) {
      throw new Error(`${filename}: sentinel '${s.varName}' for ${s.jsonName}.json but missing key '${s.varName}'`)
    }
  }

  let idx = 0
  return content.replace(I18N_SENTINEL, () => {
    const { varName, jsonName } = sentinelMeta[idx++]
    const dict = dictCache.get(jsonName)
    const data = countPerSource[jsonName] > 1 ? dict[varName] : dict
    return `const ${varName} = ${JSON.stringify(data)};`
  })
}
