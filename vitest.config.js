import { defineConfig } from 'vitest/config'

// Default config: unit tests only.
// Integration tests live under tests/integration/ and run via vitest.workers.config.js
// (uses @cloudflare/vitest-pool-workers / workerd runtime + miniflare D1).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
})
