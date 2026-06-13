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
    // PR-39 (Stage 4 tests/integration migration enabler)：副檔名用 .{js,ts} glob
    // 同 coverage exclude 的 [[feedback_coverage_exclude_ext_glob]] 教訓 — rename
    // 期間 vitest include 不能寫死 .js，否則 .test.ts 被靜默忽略從 CI 消失。
    // ESLint files block 已先鋪路（eslint.config.js line 215 + 230 + 253 + 264）。
    include: ['tests/**/*.test.{js,ts}'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include:  ['functions/utils/**'],
      // 排除分兩類，**新加 helper 預設不算 = 必須評估後決定**：
      //   (A) D1-dependent — 必須 cloudflare:test runtime + miniflare D1，由 tests/integration 把關
      //   (B) 外部 API call（Resend / Turnstile / Telegram / Discord）— 不接 mock 的話沒意義
      // 其餘純模組（jwt/auth/scopes/roles/crypto/cors/email-static-helpers/...）走 80% 門檻
      // 副檔名用 .{js,ts} glob：JS→TS 漸進遷移期 rename 不破 coverage exclude
      // （PR-C 2026-05-16 codex r1 high：原 .js 寫死 vs PR 1.1/PR-C rename 為 .ts
      //  → exclude 失效 → .ts 0% 拖總覆蓋率到 65%）
      exclude: [
        // (A) D1-dependent
        'functions/utils/audit-log.{js,ts}',          // hash-chain INSERT/SELECT
        'functions/utils/audit-aggregate-archive-runner.{js,ts}', // D1/R2 cron orchestration runner
        'functions/utils/rate-limit.{js,ts}',         // login_attempts CRUD
        'functions/utils/payments.{js,ts}',           // payment_intents lockForRefund 等
        'functions/utils/billing.{js,ts}',            // grant_plan_operations ledger + projection batch（D1-dependent，integration-tested）
        'functions/utils/credit.{js,ts}',             // credit_wallets/quota/ledger batch（D1-dependent，integration-tested）
        'functions/utils/members.{js,ts}',            // org_create_operations + organization_members CAS（D1-dependent，integration-tested）
        'functions/utils/invitations.{js,ts}',        // invitations one-time consume + join batch（D1-dependent，integration-tested）
        'functions/utils/kyc.{js,ts}',                // kyc_verifications schema + adapter
        'functions/utils/kyc-vendors/**',             // 同上
        'functions/utils/payment-vendors/**',         // ecpay/mock adapters 都吃 env+D1
        'functions/utils/oauth-clients.{js,ts}',      // D1 + KV cache
        'functions/utils/oauth-session.{js,ts}',      // D1 cookie session
        'functions/utils/revocation.{js,ts}',         // revoked_jti CRUD
        'functions/utils/role-change.{js,ts}',        // UPDATE + bumpTokenVersion + audit chain
        'functions/utils/elevation.{js,ts}',          // factor-add elevation grants/exchanges + second-factor verify（elevation_grants/backup_codes D1，integration-tested）
        'functions/utils/credential-disposition.{js,ts}', // PR-A4：classifyRisk + disposition runner（audit_log/credential tables D1，integration-tested：credential-disposition）
        'functions/utils/totp.{js,ts}',               // used_totp PK replay-safe
        'functions/utils/webauthn.{js,ts}',           // consumeChallenge atomic + D1
        'functions/utils/brute-force.{js,ts}',        // ip_blacklist CRUD
        'functions/utils/user-audit.{js,ts}',         // audit_log INSERT + Discord webhook
        'functions/utils/device-alerts.{js,ts}',      // D1 lookup + email send
        'functions/utils/backchannel.{js,ts}',        // D1 oauth_clients + fetch logout
        'functions/utils/session-revoke.{js,ts}',     // revokeSessionFamilies 批次撤銷（refresh_tokens D1，integration-tested：session-revoke-multi）
        'functions/utils/tenant-context.{js,ts}',     // tenant 解析 + membership 查詢（D1，integration-tested：tenant-foundation）
        'functions/utils/domain-event-emit.{js,ts}',  // event_outbox 寫入（D1 batch，integration-tested：event-outbox-emission/consumer）

        // (B) 外部 API call（要 mock fetch 才能單測，目前由 integration 真打測試環境）
        'functions/utils/email.{js,ts}',              // Resend API send paths
        'functions/utils/turnstile.{js,ts}',          // Cloudflare siteverify
        'functions/utils/tg-requisition.{js,ts}',     // Telegram bot API

        // 其他暫無單測但屬於可單測的純模組（TODO，新增單測後從 exclude 移除）
        'functions/utils/cookies.{js,ts}',
        'functions/utils/risk-score.{js,ts}',
        'functions/utils/siwe.{js,ts}',
      ],
      thresholds: {
        statements: 80,
        branches:   80,
        functions:  80,
        lines:      80,
      },
    },
  },
})
