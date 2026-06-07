// PR-0 (Stage 7 strict zero-error gate): ratchet locked override 的 pure 決策邏輯。
// 從 typecheck-ratchet.mjs 抽出，供 ratchet 本體 import + vitest unit test import。
// Why 抽出：ratchet.mjs 本體含 node:child_process import + import.meta main-guard 等
// top-level 結構，vitest/vite 的 SSR transform pipeline 對其會失敗（node 直接跑 /
// esbuild bundle 皆正常，僅 vite SSR 出錯）；pure helper 無這些，可被 vitest import。
// 本 module 純函式：只吃 plain object，無 node: 依賴、無檔案 / git 副作用。
// 設計與證明見 docs/plans/stage7-strict-zero-error.md §3。

export const STRICT_FAMILY_FLAGS = new Set(['strict', 'noImplicitAny', 'strictNullChecks'])

// solution graph 4 leaf：override 僅允許這些 leaf 開 strict（root / prod / browser-build /
// solution tsconfig 不是 strict 階梯對象）。tsconfig 檔名 → leaf 名 + errorsByFile path 前綴。
export const LEAF_PREFIXES = {
  'tsconfig.functions.json':         { leaf: 'functions',         prefixes: ['functions/'] },
  'tsconfig.scripts.json':           { leaf: 'scripts',           prefixes: ['scripts/'] },
  'tsconfig.tests.json':             { leaf: 'tests',             prefixes: ['tests/'] },
  'tsconfig.browser-typecheck.json': { leaf: 'browser-typecheck', prefixes: ['src/js/'] },
}

// P1 白名單：override PR 只准動這些非 source 檔（+ 單一 leaf tsconfig，P2 另驗剛好一個）。
const OVERRIDE_ALLOWED_PATHS = new Set(['types/typecheck-baseline.json', 'docs/governance-exceptions.md'])
const OVERRIDE_ALLOWED_PREFIXES = ['docs/plans/']
const SOURCE_EXT_RE = /\.(ts|js|mjs|cjs)$/  // .d.ts 以 .ts 結尾，亦被涵蓋（types 變更影響 typecheck）

export function isOverrideAllowedPath(file) {
  const n = file.replace(/\\/g, '/')
  if (OVERRIDE_ALLOWED_PATHS.has(n)) return true
  if (OVERRIDE_ALLOWED_PREFIXES.some((p) => n.startsWith(p))) return true
  if (/^tsconfig\..*\.json$/.test(n)) return true  // 單一 leaf 由 P2 驗
  return false
}

// P4 用：errorsByFile（{path: count}）深度相等比對（order-independent）。
function shallowCountMapEqual(a, b) {
  const oa = a || {}
  const ob = b || {}
  const ka = Object.keys(oa)
  if (ka.length !== Object.keys(ob).length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(ob, k)) return false
    if (oa[k] !== ob[k]) return false
  }
  return true
}

// P2：diff(baseSnap, currentSnap) 必須剛好單一 leaf tsconfig 的 strict-family flag
// falsy→true，無其他 leaf / compilerOptions key / include / exclude / references 變更。
export function analyzeStrictFlagDelta(baseSnap, currentSnap) {
  const violations = []
  const changedLeaves = []
  const allFiles = new Set([...Object.keys(baseSnap || {}), ...Object.keys(currentSnap || {})])
  for (const f of allFiles) {
    const b = (baseSnap || {})[f]
    const c = (currentSnap || {})[f]
    if (!b || !c) {
      violations.push(`P2: tsconfig ${f} 在 base/current 之一缺失（新增或刪除 tsconfig 非 strict-flag-only 變更）`)
      continue
    }
    if (JSON.stringify(b.include) !== JSON.stringify(c.include)) violations.push(`P2: ${f} include 變更（override 僅允許 strict-family flag）`)
    if (JSON.stringify(b.exclude) !== JSON.stringify(c.exclude)) violations.push(`P2: ${f} exclude 變更`)
    if (JSON.stringify(b.references) !== JSON.stringify(c.references)) violations.push(`P2: ${f} references 變更`)
    const bCO = b.compilerOptions || {}
    const cCO = c.compilerOptions || {}
    const keys = new Set([...Object.keys(bCO), ...Object.keys(cCO)])
    const flags = []
    for (const key of keys) {
      if (JSON.stringify(bCO[key]) === JSON.stringify(cCO[key])) continue
      if (!STRICT_FAMILY_FLAGS.has(key)) {
        violations.push(`P2: ${f} compilerOptions.${key} 變更（override 僅允許 strict-family）`)
      } else if (cCO[key] !== true) {
        violations.push(`P2: ${f} ${key}=${JSON.stringify(cCO[key])} 非開啟 true（override 僅允許開 strict，不允許弱化）`)
      } else if (bCO[key] === true) {
        violations.push(`P2: ${f} ${key} base 已是 true（無實質開啟變更）`)
      } else {
        flags.push(key)
      }
    }
    if (flags.length > 0) changedLeaves.push({ file: f, flags })
  }
  if (changedLeaves.length === 0) violations.push('P2: 無 strict-family flag 開啟變更（override 須恰開一個 leaf 的 strict flag）')
  else if (changedLeaves.length > 1) violations.push(`P2: 多個 tsconfig 同時開 strict：${changedLeaves.map((l) => l.file).join(', ')}（override 限單一 leaf）`)
  else if (!(changedLeaves[0].file in LEAF_PREFIXES)) violations.push(`P2: ${changedLeaves[0].file} 非 solution leaf（override 僅限 ${Object.keys(LEAF_PREFIXES).join(' / ')}）`)
  if (violations.length > 0) return { ok: false, violations }
  const only = changedLeaves[0]
  return { ok: true, leafTsconfig: only.file, leaf: LEAF_PREFIXES[only.file].leaf, flags: only.flags.slice().sort() }
}

// P1-P5 全 AND；任一不過回 { ok:false, violations }。
export function evaluateOverridePreconditions(ctx) {
  const { baseBaseline, baseline, current, added, modified, deleted, renameMap, currentSnap, baseSnap } = ctx
  const violations = []

  // P3：base ref baseline 須存在且 errorCount===0（前一 strict surface 已清零並 merge）
  if (!baseBaseline) violations.push('P3: base ref baseline 不存在（無法證明前一 strict surface 已清零）')
  else if (baseBaseline.errorCount !== 0) violations.push(`P3: base baseline.errorCount=${baseBaseline.errorCount} ≠ 0（前一 leaf/flag 階梯未清零；override 限一次一 leaf）`)

  // P4：baseline 全 derived field 必須等於 current（防 pre-allocate budget；不只 errorCount —
  //     cleanFiles 等被預先放寬，override 豁免 [BASE] cleanFiles 後會留 budget slack）。
  for (const f of ['errorCount', 'fileErrors', 'globalErrors', 'errorFiles', 'cleanFiles', 'sourceFilesTotal']) {
    if (baseline[f] !== current[f]) violations.push(`P4: baseline.${f}=${baseline[f]} ≠ current.${f}=${current[f]}（baseline 必須等於實測，防 budget slack）`)
  }
  if (!shallowCountMapEqual(baseline.errorsByFile, current.errorsByFile)) violations.push('P4: baseline.errorsByFile ≠ current.errorsByFile（防 per-file budget slack）')

  // P2：剛好單一 leaf strict-family flag 開啟
  const p2 = analyzeStrictFlagDelta(baseSnap, currentSnap)
  if (!p2.ok) for (const v of p2.violations) violations.push(v)

  // P1：無 source 變更（含 added / modified / deleted / rename 來源；只准 baseline /
  //     單一 leaf tsconfig / docs/plans / governance-exceptions）。deleted 必收 — 否則可刪
  //     clean source 降 cleanFiles，再被 [BASE] cleanFiles 豁免，破壞「純翻 flag」保證。
  const changed = new Set()
  for (const f of [...(added || []), ...(modified || []), ...(deleted || [])]) changed.add(f.replace(/\\/g, '/'))
  if (renameMap) for (const oldPath of renameMap.values()) changed.add(oldPath.replace(/\\/g, '/'))
  const sourceChanged = [...changed].filter((f) => SOURCE_EXT_RE.test(f) && !isOverrideAllowedPath(f))
  if (sourceChanged.length > 0) violations.push(`P1: override PR 含 source 變更（禁；override 限純翻 flag + baseline + 治理文件）：${sourceChanged.slice(0, 8).join(', ')}`)
  const strayNonAllowed = [...changed].filter((f) => !SOURCE_EXT_RE.test(f) && !isOverrideAllowedPath(f))
  if (strayNonAllowed.length > 0) violations.push(`P1: override PR 含非白名單檔：${strayNonAllowed.slice(0, 8).join(', ')}`)
  // P1 補：diff 的 tsconfig 變更必須剛好是 p2.leafTsconfig（防改其他 tsconfig、或改 leaf 以外
  //     tsconfig 落在 snapshot 未涵蓋欄位繞過 P2）。
  if (p2.ok) {
    const changedTsconfigs = [...changed].filter((f) => /^tsconfig\..*\.json$/.test(f))
    if (changedTsconfigs.length !== 1 || changedTsconfigs[0] !== p2.leafTsconfig) {
      violations.push(`P1: diff 的 tsconfig 變更必須剛好是 ${p2.leafTsconfig}（實際：${changedTsconfigs.join(', ') || '無'}）`)
    }
  }

  // P5：current.errorsByFile 所有 path 屬於 changed leaf 的 include 範圍
  if (p2.ok) {
    const prefixes = LEAF_PREFIXES[p2.leafTsconfig].prefixes
    const stray = Object.keys(current.errorsByFile || {}).filter((f) => !prefixes.some((p) => f.startsWith(p)))
    if (stray.length > 0) violations.push(`P5: errorsByFile 含非 ${p2.leaf} leaf path（限 ${prefixes.join(',')}）：${stray.slice(0, 8).join(', ')}`)
  }

  if (violations.length > 0) return { ok: false, violations }
  return { ok: true, leaf: p2.leaf, leafTsconfig: p2.leafTsconfig, flags: p2.flags }
}

// override 啟用時，判斷某條 failure 是否屬「該 leaf strict flag 歸因」的豁免集。
export function isExemptableFailure(failure, ctx) {
  if (failure.startsWith('[BASE] baseline.errorCount')) return true
  if (failure.startsWith('[BASE] baseline.cleanFiles')) return true
  if (failure.startsWith("[BASE-B']")) return true
  if (failure.startsWith('[BASE-EBF]')) return true
  if (failure.startsWith('[BASE-D-tsconfig]')) {
    // defense-in-depth：只豁免「該 leaf tsconfig + strict-family key」變更；其他 BASE-D 不豁免
    const m = failure.match(/^\[BASE-D-tsconfig\]\s+(\S+)\s+compilerOptions\.(\w+)\b/)
    return Boolean(m && m[1] === ctx.leafTsconfig && STRICT_FAMILY_FLAGS.has(m[2]))
  }
  return false
}
