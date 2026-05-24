import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // PR-39 (Stage 4 enabler)：副檔名用 .{js,ts} glob，rename 期不漏 .test.ts
    // 參考 vitest.config.js 同步註解。
    include: ['tests/integration/**/*.test.{js,ts}'],
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
          // Keep aligned with wrangler.toml; lint:compat-date enforces this.
          compatibilityDate: '2024-09-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['chiyigo_db'],
          kvNamespaces: ['CHIYIGO_KV'],
          // AUDIT_ARCHIVE_BUCKET_PREVIEW：F-3 Phase 2 PR 0.2c-pre-1b.1 TEMPORARY —
          // r2-binding-canary endpoint 整合測試需要 preview bucket binding。
          // commit 2 of PR 1b.1 一起 remove。
          r2Buckets: ['AUDIT_ARCHIVE_BUCKET', 'AUDIT_ARCHIVE_BUCKET_PREVIEW'],
          bindings: {
            ENVIRONMENT: 'test',
            IAM_BASE_URL: 'http://localhost:8788',
            MAIL_FROM_ADDRESS: 'noreply@test.local',
            RESEND_API_KEY: 'test-fake-key',
            // F-3 Phase 2：archive worker integration test 直接 import handler 並帶 bearer
            CRON_SECRET: 'test-cron-secret',
            ARCHIVE_ENV: 'test',
          },
        },
      },
    },
  },
})
