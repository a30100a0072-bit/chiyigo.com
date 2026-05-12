import globals from 'globals'

const browserGlobals = {
  ...globals.browser,
  // App-defined globals on window (auth-ui.js, dashboard, etc.)
  authShowMsg: 'readonly',
  authClearMsg: 'readonly',
  tailwind: 'readonly',
}

// ── archive-discipline plugin (PR 2.2c) ─────────────────────────────
// 鏡射 scripts/lint-archive-no-delete.js 的 grep 規則，讓 `npm run lint`
// 也能擋到 archive worker codepath 的 R2 .delete()/.put() / SQL DELETE FROM
// 違規。grep 版仍是 build/CI 的硬防線（process.exit(1)）；本 rule 是早期
// 警示（IDE / eslint --max-warnings）。
//
// 規則保持與 grep 同步：任何 pattern 改動兩邊都要動。utils putWithRetry 內
// 唯一合法 bare bucket.put 用同行 `archive-no-delete-allow` 豁免。
const ARCHIVE_FORBIDDEN_PATTERNS = [
  { re: /AUDIT_ARCHIVE_BUCKET\s*\.\s*delete\s*\(/,           desc: 'AUDIT_ARCHIVE_BUCKET.delete()' },
  { re: /AUDIT_ARCHIVE_BUCKET\s*\[\s*['"`]delete['"`]\s*\]/, desc: "AUDIT_ARCHIVE_BUCKET['delete']" },
  { re: /\bbucket\s*\.\s*delete\s*\(/,                       desc: 'bucket.delete() (alias of AUDIT_ARCHIVE_BUCKET)' },
  { re: /\bbucket\s*\[\s*['"`]delete['"`]\s*\]/,             desc: "bucket['delete'] (alias bracket access)" },
  { re: /\{\s*[^}]*\bdelete\s*:\s*\w+[^}]*\}\s*=\s*[^;]*AUDIT_ARCHIVE_BUCKET/,
    desc: 'destructured { delete: alias } = ...AUDIT_ARCHIVE_BUCKET' },
  { re: /AUDIT_ARCHIVE_BUCKET\s*\.\s*put\s*\(/,              desc: 'AUDIT_ARCHIVE_BUCKET.put() — must go through archivePut wrapper' },
  { re: /AUDIT_ARCHIVE_BUCKET\s*\[\s*['"`]put['"`]\s*\]/,    desc: "AUDIT_ARCHIVE_BUCKET['put'] — must go through archivePut wrapper" },
  { re: /\bbucket\s*\.\s*put\s*\(/,                          desc: 'bucket.put() — must go through archivePut wrapper (utils putWithRetry is the only allowed site)' },
  { re: /\bbucket\s*\[\s*['"`]put['"`]\s*\]/,                desc: "bucket['put'] — must go through archivePut wrapper" },
  { re: /DELETE\s+FROM\s+audit_log\b/i,                      desc: 'DELETE FROM audit_log — archive worker never deletes audit rows (purge: PR 2.3)' },
  { re: /DELETE\s+FROM\s+audit_archive_chunks\b/i,           desc: 'DELETE FROM audit_archive_chunks — chunks row never deleted from archive worker (purge: PR 2.3)' },
]
const ARCHIVE_ALLOW_TAG = 'archive-no-delete-allow'

const archiveDisciplinePlugin = {
  rules: {
    'no-forbidden-r2-or-sql': {
      meta: {
        type: 'problem',
        docs: { description: 'Forbid R2 .delete()/.put() bypass and SQL DELETE on audit tables in archive worker codepath.' },
        schema: [],
        messages: { forbidden: 'archive-discipline: forbidden {{desc}}. 詳見 scripts/lint-archive-no-delete.js / docs/AUDIT_RETENTION_PLAN.md。同行加 `// archive-no-delete-allow` 才能豁免（utils putWithRetry 是唯一合法 bare put site）。' },
      },
      create(context) {
        return {
          Program(node) {
            const src = context.sourceCode ?? context.getSourceCode()
            const lines = src.lines
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              if (line.includes(ARCHIVE_ALLOW_TAG)) continue
              const trimmed = line.trim()
              if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
              for (const { re, desc } of ARCHIVE_FORBIDDEN_PATTERNS) {
                if (re.test(line)) {
                  context.report({
                    node,
                    loc: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: line.length } },
                    messageId: 'forbidden',
                    data: { desc },
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

  // Cloudflare Pages Functions (server) — Workers runtime, ES modules
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
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
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },

  // Archive worker codepath — PR 2.2c lint hardening
  {
    files: [
      'functions/api/admin/cron/audit-archive*.js',
      'functions/utils/audit-archive*.js',
    ],
    plugins: { 'archive-discipline': archiveDisciplinePlugin },
    rules: { 'archive-discipline/no-forbidden-r2-or-sql': 'error' },
  },

  // Vitest unit tests
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Integration tests run inside workerd via @cloudflare/vitest-pool-workers
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
]
