import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Integration tests share one workerd isolate (singleWorker) + D1-local storage;
    // cumulative load pushes later cases past vitest's 5s default testTimeout
    // (credential-disposition's heaviest case ~3.5s isolated, >5s under the full suite).
    // 20s = ample headroom under load without masking a genuine hang.
    testTimeout: 20_000,
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
          r2Buckets: ['AUDIT_ARCHIVE_BUCKET'],
          bindings: {
            ENVIRONMENT: 'test',
            IAM_BASE_URL: 'http://localhost:8788',
            MAIL_FROM_ADDRESS: 'noreply@test.local',
            RESEND_API_KEY: 'test-fake-key',
            // F-3 Phase 2：archive worker integration test 直接 import handler 並帶 bearer
            CRON_SECRET: 'test-cron-secret',
            ARCHIVE_ENV: 'test',
            // PAY-002：test 為 non-production；明確 ECPAY_MODE=sandbox 才允許 ECPay 公開 sandbox creds
            // fallback（新 getCreds fail-closed 規則）。否則既有 payment-ecpay 整合測試會 reject。
            ECPAY_MODE: 'sandbox',
          },
        },
      },
    },
  },
})
