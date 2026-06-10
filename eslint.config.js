import globals from 'globals'
import tseslint from 'typescript-eslint'
import {
  FORBIDDEN_PATTERNS as ARCHIVE_FORBIDDEN_PATTERNS,
  ALLOW_TAGS as ARCHIVE_ALLOW_TAGS,
  isWaived as archiveIsWaived,
  isCommentLine as archiveIsCommentLine,
  findSourceMatches as archiveFindSourceMatches,
} from './scripts/_archive-lint-patterns.js'

const browserGlobals = {
  ...globals.browser,
  // App-defined globals on window (auth-ui.js, dashboard, etc.)
  authShowMsg: 'readonly',
  authClearMsg: 'readonly',
  tailwind: 'readonly',
}

// Cloudflare Pages Functions (Workers runtime) 共用 globals — JS / TS block 共享。
const functionsServerGlobals = {
  ...globals.serviceworker,
  crypto: 'readonly',
  btoa: 'readonly',
  atob: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  // Ambient types from types/env.d.ts (TS-only; ESLint only needs to know
  // the names exist as globals so type-position references don't trip no-undef)
  Env: 'readonly',
  CfRequest: 'readonly',
}

// Functions JS / TS 共用 rules（no-unused-vars 在 TS block 會被換成 @typescript-eslint 版）。
const functionsServerRules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-const-assign': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'smart'],
}

// ── archive-discipline plugin (PR 2.2c / codex r1) ──────────────────
// 鏡射 scripts/lint-archive-no-delete.js 的 grep 規則，讓 `npm run lint`
// 也能擋到 archive worker codepath 的 R2 .delete()/.put() / SQL DELETE FROM
// 違規。grep 版仍是 build/CI 的硬防線（process.exit(1)）；本 rule 是早期
// 警示（IDE / eslint --max-warnings）。
//
// L-2：patterns / ALLOW_TAGS 都從 scripts/_archive-lint-patterns.js import，
// 兩處 lint 共一份來源，pattern 改動不會漏同步。
// L-1：per-kind 豁免 tag（archive-put-allow / archive-delete-allow /
// archive-sql-allow）— ALLOW_TAGS map 由 shared module 定義。
const archiveDisciplinePlugin = {
  rules: {
    'no-forbidden-r2-or-sql': {
      meta: {
        type: 'problem',
        docs: { description: 'Forbid R2 .delete()/.put() bypass and SQL DELETE on audit tables in archive worker codepath.' },
        schema: [],
        messages: {
          // codex r4 nit：exception 字樣按 kind 拆，sql/delete 不再硬塞 put-specific 字
          forbidden: 'archive-discipline [{{kind}}]: forbidden {{desc}}. 豁免 tag `// {{tag}}`（{{exception}}）。詳見 scripts/_archive-lint-patterns.js / docs/AUDIT_RETENTION_PLAN.md。',
        },
      },
      create(context) {
        return {
          Program(node) {
            const src = context.sourceCode ?? context.getSourceCode()
            const text  = src.text
            const lines = src.lines

            // source-scope（SQL multiline DELETE — codex r2 M-1' / r3 M-3 取
            // 所有 match，第一個被 waive 不會讓後續 unwaived 漏抓）
            for (const pattern of ARCHIVE_FORBIDDEN_PATTERNS) {
              if (pattern.scope !== 'source') continue
              for (const m of archiveFindSourceMatches(text, lines, pattern)) {
                if (m.waived) continue
                context.report({
                  node,
                  loc: {
                    start: { line: m.startLine, column: 0 },
                    end:   { line: m.endLine,   column: (lines[m.endLine - 1] || '').length },
                  },
                  messageId: 'forbidden',
                  data: {
                    kind: pattern.kind,
                    desc: pattern.desc,
                    tag: ARCHIVE_ALLOW_TAGS[pattern.kind],
                    exception: pattern.kind === 'put'
                      ? '目前唯一合法 bare put site：functions/utils/audit-archive.js#putWithRetry'
                      : '目前 0 合法例外；若新增請同 PR 補 design rationale',
                  },
                })
              }
            }

            // line-scope（R2 method 等）
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              if (archiveIsCommentLine(line)) continue
              for (const pattern of ARCHIVE_FORBIDDEN_PATTERNS) {
                if (pattern.scope !== 'line') continue
                if (archiveIsWaived(line, pattern)) continue
                if (pattern.re.test(line)) {
                  context.report({
                    node,
                    loc: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: line.length } },
                    messageId: 'forbidden',
                    data: {
                      kind: pattern.kind,
                      desc: pattern.desc,
                      tag: ARCHIVE_ALLOW_TAGS[pattern.kind],
                      exception: pattern.kind === 'put'
                        ? '目前唯一合法 bare put site：functions/utils/audit-archive.js#putWithRetry'
                        : '目前 0 合法例外；若新增請同 PR 補 design rationale',
                    },
                  })
                }
              }
            }
          },
        }
      },
    },
  },
}

export default [
  {
    ignores: [
      'node_modules/**',
      '.wrangler/**',
      'public/**',
      'database/**',
      'migrations/**',
      'scripts/**',
    ],
  },

  // ── Cloudflare Pages Functions: JS ───────────────────────────────
  // 純 JS，用 ESLint 預設 parser（espree）。codex r3 F3：與 TS block 拆開，
  // 避免 .js 被 typescript-eslint parser 強制當 TS 解析；同時讓 TS-only
  // rules / 型別感知 rules 不會誤套到 .js。
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: functionsServerGlobals,
    },
    rules: functionsServerRules,
  },

  // ── Cloudflare Pages Functions: TS ───────────────────────────────
  // typescript-eslint parser + plugin；parserOptions.projectService 啟用
  // 型別資訊（型別感知 rule 例如 no-floating-promises 需要它）。tsconfig
  // 根在 repo 根目錄。codex r3 F3：TS-only rule 集中在這個 block。
  {
    files: ['functions/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: functionsServerGlobals,
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...functionsServerRules,
      // base no-unused-vars 換 TS 版（避免 interface/type 誤報 + 支援 TS 語法）
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // feedback_ts_ratchet_discipline：禁 `:any`
      '@typescript-eslint/no-explicit-any': 'error',
      // 型別感知 rule（demonstrates projectService 真的有掛上）
      '@typescript-eslint/no-floating-promises': 'warn',
    },
  },

  // ── Archive worker codepath — PR 2.2c lint hardening ──────────────
  // 純 source-text grep rule，不需要 parser；JS / TS 各自的 parser 由前面
  // 的 functions block 決定（codex r3 F3：移除 parser override）。
  {
    files: [
      'functions/api/admin/cron/audit-archive*.{js,ts}',
      'functions/utils/audit-archive*.{js,ts}',
      // PR 3.2 codex r2 P3：aggregate→R2 worker 也要進 ESLint archive-discipline
      // scope；build guard scripts/lint-archive-no-delete.js 已透過共用 FILE_PATTERN
      // 掃到，IDE early warning / npm run lint 同步擴齊。
      'functions/api/admin/cron/audit-aggregate-archive*.{js,ts}',
      'functions/utils/audit-aggregate-archive*.{js,ts}',
    ],
    plugins: { 'archive-discipline': archiveDisciplinePlugin },
    rules: { 'archive-discipline/no-forbidden-r2-or-sql': 'error' },
  },

  // ── Vitest unit tests: JS ─────────────────────────────────────────
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ── Vitest unit tests: TS ─────────────────────────────────────────
  // 為 Stage 7 test TS 化預先鋪路；現在 tests/ 下沒 .ts 檔，block 仍掛著
  // 確保未來新增 .ts test 不會踩 parser 問題。
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ── Integration tests (workerd via @cloudflare/vitest-pool-workers) ──
  // 與 unit tests 同 glob 重疊；flat config 會 merge globals，這裡只加
  // workerd / serviceworker globals。
  {
    files: ['tests/integration/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.serviceworker,
        crypto: 'readonly',
      },
    },
  },
  {
    files: ['tests/integration/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.serviceworker,
        crypto: 'readonly',
      },
    },
  },
]
