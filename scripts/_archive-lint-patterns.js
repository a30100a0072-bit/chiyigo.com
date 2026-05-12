/**
 * _archive-lint-patterns.js
 *
 * F-3 Phase 2 PR 2.2c codex r1 — shared archive-worker discipline patterns。
 *
 * Imported by:
 *   - scripts/lint-archive-no-delete.js     (build/CI grep guard, process.exit(1))
 *   - eslint.config.js                       (npm run lint, IDE early-warn)
 *
 * codex r1 收尾三件事（PR 2.2c r1）：
 *   M-1  補繞道變體：optional chaining (?.) / destructure / .bind|.call|.apply /
 *        archiveBucket alias 名。put + delete 雙方鏡射。
 *   L-1  ALLOW_TAG 從 1 個拆 3 個，per-kind 豁免：
 *          archive-put-allow / archive-delete-allow / archive-sql-allow
 *        utils putWithRetry 那行只能用 archive-put-allow 豁免，不再串豁免 delete/sql。
 *   L-2  把 patterns 抽出共用 ESM，雙份同步負擔歸零。
 *
 * 🔴 best-effort regex guard（明說承諾邊界）：
 *   - 涵蓋已知 R2 binding 名：AUDIT_ARCHIVE_BUCKET / bucket / archiveBucket
 *   - 涵蓋常見繞道：.X / ?.X / ['X'] / ?.['X'] / .X.bind|call|apply / destructure
 *   - 仍會漏：binding rename 到非標準名（const r2 = env.AUDIT_ARCHIVE_BUCKET;
 *     r2.put(...) — `r2` 不在 alias 白名單）/ 透過 Reflect.get / 透過 function
 *     parameter 傳遞後在他處呼叫。
 *   - 完整 alias-flow 追蹤交由 code review；AST 版 ESLint rule 留未來 PR。
 *
 * 任何 pattern / tag 改動兩處 import 端會自動同步 — 這正是 L-2 的目的。
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
    // direct call: bucket.put( / bucket?.put( / AUDIT_ARCHIVE_BUCKET.put(
    { kind, desc: `${label} direct .${method}() / ?.${method}()`,
      re: new RegExp(`\\b${R2_BINDING}(?:\\?\\.|\\.)\\s*${method}\\s*\\(`) },
    // bracket access: bucket['put']( / bucket?.['put'](
    { kind, desc: `${label} bracket ['${method}'] / ?.['${method}']`,
      re: new RegExp(`\\b${R2_BINDING}(?:\\?\\.)?\\s*\\[\\s*['"\`]${method}['"\`]\\s*\\]`) },
    // method extraction: bucket.put.bind(bucket) / .call / .apply
    { kind, desc: `${label} method extraction .${method}.{bind|call|apply}()`,
      re: new RegExp(`\\b${R2_BINDING}(?:\\?\\.|\\.)\\s*${method}\\s*\\.\\s*(?:bind|call|apply)\\s*\\(`) },
    // destructure: const { put } = env.AUDIT_ARCHIVE_BUCKET / { put: alias }
    // 注意：delete 是保留字實務 rename 必然（{ delete: del } = ...），put 不需 rename；
    // 同一 regex 兩者都涵蓋（\b${method}\b 匹配 token，後續 [^}]* 允許 : alias）。
    { kind, desc: `${label} destructured { ${method} } = ...R2_binding`,
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
  { kind: 'sql',
    desc: 'DELETE FROM audit_log — archive worker never deletes audit rows (purge: PR 2.3)',
    re: /DELETE\s+FROM\s+audit_log\b/i },
  { kind: 'sql',
    desc: 'DELETE FROM audit_archive_chunks — chunks row never deleted from archive worker (purge: PR 2.3)',
    re: /DELETE\s+FROM\s+audit_archive_chunks\b/i },
]

export const SCAN_GLOBS = [
  'functions/api/admin/cron',
  'functions/utils',
]
export const FILE_PATTERN = /^audit-archive.*\.js$/

// Helper: 給定 line + pattern，判斷是否被同行 ALLOW_TAG 豁免（per-kind）
export function isWaived(line, pattern) {
  const tag = ALLOW_TAGS[pattern.kind]
  return tag != null && line.includes(tag)
}

// Helper: 判斷一行是否為純註解（lint script 與 ESLint plugin 共用 skip 規則）
export function isCommentLine(line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}
