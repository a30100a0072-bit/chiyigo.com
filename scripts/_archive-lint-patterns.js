/**
 * _archive-lint-patterns.js
 *
 * F-3 Phase 2 PR 2.2c (codex r1 + r2) — shared archive-worker discipline patterns。
 *
 * Imported by:
 *   - scripts/lint-archive-no-delete.js     (build/CI grep guard, process.exit(1))
 *   - eslint.config.js                       (npm run lint, IDE early-warn)
 *
 * codex r1 + r2 累計收：
 *   M-1  (r1) 補繞道變體：optional chaining / destructure / .bind|.call|.apply /
 *        archiveBucket alias。
 *   L-1  (r1) ALLOW_TAG 拆 per-kind 三個（archive-put-allow / archive-delete-allow
 *        / archive-sql-allow）。
 *   L-2  (r1) 抽 shared ESM 共用，雙份同步負擔歸零。
 *   M-1' (r2) SQL kind 改 whole-source scan，跨行 DELETE FROM 也抓。
 *   M-2  (r2) 補 (bucket).put paren-wrap + const p = bucket.put plain property ref。
 *
 * 🔴 best-effort regex guard（明說承諾邊界）：
 *   - 涵蓋已知 R2 binding 名：AUDIT_ARCHIVE_BUCKET / bucket / archiveBucket
 *   - 涵蓋形狀：.X / ?.X / (X).Y / ['X'] / ?.['X'] / .X.bind|call|apply /
 *     destructure / plain property ref（無呼叫）
 *   - SQL kind 對 multiline template string 內含 DELETE 跨行也抓
 *   - 仍會漏：binding rename 到非標準名（const r2 = env.X; r2.put）/
 *     (bucket)?.['put'] 等更複雜 paren+optional 組合 / Reflect.get /
 *     function parameter 傳遞後在他處呼叫
 *   - 完整 alias-flow 追蹤交由 code review；AST 版 ESLint rule 留未來 PR。
 *
 * Pattern 結構：每條帶 `kind` ∈ {'put', 'delete', 'sql'} 與 `scope` ∈
 * {'line', 'source'}。lint script 與 ESLint plugin 都會依 scope 分派：
 *   - scope='line'   逐行掃，per-line ALLOW_TAG 同行豁免
 *   - scope='source' 整個 source 掃，match 起/止行任一含 ALLOW_TAG 才豁免
 */

export const ALLOW_TAGS = {
  put:    'archive-put-allow',
  delete: 'archive-delete-allow',
  sql:    'archive-sql-allow',
}

// 已知 R2 binding alias 名。新 alias 名必須加進這份白名單才會被掃。
const R2_BINDING = '(?:AUDIT_ARCHIVE_BUCKET|bucket|archiveBucket)'

function r2MethodPatterns(method, kind, label) {
  return [
    // direct access: bucket.put( / bucket.put / bucket?.put / bucket.put.bind
    //   尾巴改 \b（codex r2 M-2：plain property ref `const p = bucket.put` 也抓；
    //   bind/call/apply 變成此 pattern 的子集，不再另出 method-extraction）
    { kind, scope: 'line',
      desc: `${label} access .${method} / ?.${method} (call / reference / .bind|call|apply)`,
      re: new RegExp(`\\b${R2_BINDING}(?:\\?\\.|\\.)\\s*${method}\\b`) },
    // paren-wrap direct: (bucket).put / (env.AUDIT_ARCHIVE_BUCKET).put /
    //                    (bucket)?.put — codex r2 M-2 新增
    //   `[^)]*?` 允許 paren 內帶 prefix（env. / getter call 等），end-of-paren 後接 .X / ?.X
    { kind, scope: 'line',
      desc: `${label} paren-wrapped (expr).${method} / (expr)?.${method}`,
      re: new RegExp(`\\(\\s*[^)]*?\\b${R2_BINDING}\\s*\\)(?:\\?\\.|\\.)\\s*${method}\\b`) },
    // bracket access: bucket['put'] / bucket?.['put']
    { kind, scope: 'line',
      desc: `${label} bracket ['${method}'] / ?.['${method}']`,
      re: new RegExp(`\\b${R2_BINDING}(?:\\?\\.)?\\s*\\[\\s*['"\`]${method}['"\`]\\s*\\]`) },
    // destructure: const { put } = env.AUDIT_ARCHIVE_BUCKET / { put: alias }
    //   delete 是保留字實務 rename 必然（{ delete: del }），put 不需 rename；
    //   同一 regex 兩者都涵蓋（\b${method}\b 匹配 token，後續 [^}]* 允許 : alias）
    { kind, scope: 'line',
      desc: `${label} destructured { ${method} } = ...R2_binding`,
      re: new RegExp(`\\{\\s*[^}]*\\b${method}\\b[^}]*\\}\\s*=\\s*[^;]*${R2_BINDING}`) },
  ]
}

export const FORBIDDEN_PATTERNS = [
  // ── kind=delete: PR 2.0 — R2 .delete() 全禁 ─────────────────────
  ...r2MethodPatterns('delete', 'delete', 'R2 .delete()'),

  // ── kind=put: PR 2.2c — R2 .put() 必走 archivePut wrapper ───────
  //    唯一合法 bare site: functions/utils/audit-archive.js#putWithRetry
  //    用同行 `// archive-put-allow` 豁免。
  ...r2MethodPatterns('put', 'put', 'R2 .put() (must go through archivePut wrapper)'),

  // ── kind=sql: PR 2.2c — DELETE FROM audit_log / audit_archive_chunks ──
  //    archive worker codepath 不該砍 D1 row，purge 走 PR 2.3 獨立 endpoint。
  //    scope='source'：whole-source 掃（codex r2 M-1'），\s 已含 \n，跨行
  //    template string `DELETE \n FROM audit_log` 也會抓。
  { kind: 'sql', scope: 'source',
    desc: 'DELETE FROM audit_log — archive worker never deletes audit rows (purge: PR 2.3)',
    re: /DELETE\s+FROM\s+audit_log\b/i },
  { kind: 'sql', scope: 'source',
    desc: 'DELETE FROM audit_archive_chunks — chunks row never deleted from archive worker (purge: PR 2.3)',
    re: /DELETE\s+FROM\s+audit_archive_chunks\b/i },
]

export const SCAN_GLOBS = [
  'functions/api/admin/cron',
  'functions/utils',
]
// 0044 (codex P2b)：擴 aggregate-archive — audit-aggregate-archive*.js（PR 3.2 helpers + 兩 handler）
// 既有 'audit-archive*'   涵蓋 audit_log archive worker（PR 2.x）；
// 新增  'audit-aggregate-archive*' 涵蓋 aggregate→R2 worker（PR 3.2+）。
export const FILE_PATTERN = /^audit-(aggregate-)?archive.*\.js$/

// Helper: 給定 line + pattern，判斷是否被同行 ALLOW_TAG 豁免（per-kind）。
//   line-scope pattern 用此 helper；source-scope pattern 由 caller 自行決定
//   要查 match 起/止行任一是否含 tag（見 lint script / ESLint plugin）。
export function isWaived(line, pattern) {
  const tag = ALLOW_TAGS[pattern.kind]
  return tag != null && line.includes(tag)
}

// Helper: 判斷一行是否為純註解（lint script 與 ESLint plugin 共用 skip 規則）
export function isCommentLine(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

// Helper: 從整個 source 找 source-scope pattern 的 **所有** match 並算出
// 起/止行號 + waiver 狀態（codex r3 M-3：原 findSourceMatch 只回第一個 match，
// 若第一個被 waive 則後續 unwaived 漏抓）。回空陣列表示無 match。
//
// 用法：caller 拿到陣列後逐個處理；waived=true 的 entry caller 自行 skip。
export function findSourceMatches(src, lines, pattern) {
  // re.matchAll 需要 g flag；pattern.re 不一定有，in-flight 補
  const reG = pattern.re.global
    ? pattern.re
    : new RegExp(pattern.re.source, pattern.re.flags + 'g')
  const tag = ALLOW_TAGS[pattern.kind]
  const out = []
  for (const m of src.matchAll(reG)) {
    const startIdx = m.index
    const endIdx   = m.index + m[0].length
    const startLine = src.slice(0, startIdx).split('\n').length         // 1-based
    const endLine   = src.slice(0, endIdx).split('\n').length           // 1-based
    let waived = false
    if (tag) {
      for (let i = startLine - 1; i <= endLine - 1 && i < lines.length; i++) {
        if (lines[i].includes(tag)) { waived = true; break }
      }
    }
    out.push({ startLine, endLine, waived, snippet: lines[startLine - 1] })
  }
  return out
}
