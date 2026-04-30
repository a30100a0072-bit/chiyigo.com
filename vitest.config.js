import { defineConfig } from 'vitest/config'

// Default config: unit tests only.
// Integration tests live under tests/integration/ and run via vitest.workers.config.js
// (uses @cloudflare/vitest-pool-workers / workerd runtime + miniflare D1).
//
// Coverage 限定 functions/utils/* — 純模組可單元測試，不依賴 runtime / D1 / 網路。
// auth endpoint（functions/api/auth/*）由整合測試把關，因為 workerd pool 不支援
// v8 coverage（node:inspector 模組缺，見 2026-04-30 探勘）。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include:  ['functions/utils/**'],
      thresholds: {
        statements: 80,
        branches:   80,
        functions:  80,
        lines:      80,
      },
    },
  },
})
