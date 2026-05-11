import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
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
          },
        },
      },
    },
  },
})
