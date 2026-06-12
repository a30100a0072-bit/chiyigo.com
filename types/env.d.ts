/**
 * Cloudflare Pages Functions runtime bindings.
 *
 * Source of truth: wrangler.toml (D1 / KV / R2 / AI) + dashboard secrets.
 * When adding a new binding to wrangler.toml or a new secret, update this file.
 *
 * Why a single `Env` interface:
 *   Pages Functions handlers receive `context.env` typed against this. Letting
 *   `env.X` resolve to `any` defeats the type system and masks the kind of
 *   "renamed binding still referenced" bugs we want strict mode to catch.
 *
 * Note on strictness:
 *   Optional secrets (preview-only, debug, telemetry) are marked `?:`. Required
 *   bindings (chiyigo_db, JWT keys, etc.) are not — a missing required binding
 *   in production is a deploy-time error we want surfaced loudly.
 */

export {};

declare global {
  interface Env {
    // ── D1 / KV / R2 / AI (wrangler.toml bindings) ─────────────────────
    chiyigo_db: D1Database;
    CHIYIGO_KV: KVNamespace;
    AUDIT_ARCHIVE_BUCKET: R2Bucket;
    AI: Ai;

    // ── Identity / JWT (required) ──────────────────────────────────────
    JWT_PRIVATE_KEY: string;
    JWT_PUBLIC_KEY: string;
    JWT_PUBLIC_KEYS?: string;

    // ── Auth misc ──────────────────────────────────────────────────────
    TOTP_ISSUER?: string;
    WEBAUTHN_ORIGINS?: string;
    TURNSTILE_SECRET_KEY?: string;
    WALLET_SIWE_DOMAIN?: string;
    WALLET_SIWE_URI?: string;

    // ── External services (email / SMS / chat / IAM) ───────────────────
    RESEND_API_KEY?: string;
    MAIL_FROM_ADDRESS?: string;
    RESEND_TIMEOUT_MS?: string;
    IAM_BASE_URL?: string;
    IAM_SERVICE?: Fetcher;
    LINE_OA_URL?: string;
    DISCORD_AUDIT_WEBHOOK?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    ALERT_WEBHOOK_URL?: string;

    // ── Payments ───────────────────────────────────────────────────────
    // PAY-002：prod 不需設（unset 即視為 prod）且禁 'sandbox'；非 prod 走 'sandbox' 才允許公開 creds。
    ECPAY_MODE?: 'prod' | 'sandbox';
    ECPAY_MERCHANT_ID?: string;
    ECPAY_HASH_KEY?: string;
    ECPAY_HASH_IV?: string;
    PAYMENT_MOCK_SECRET?: string;
    KYC_MOCK_SECRET?: string;
    PSP_DIRECT_INTENT_ENABLED?: string;

    // ── Audit archive pipeline ─────────────────────────────────────────
    ARCHIVE_ENV?: string;
    AUDIT_IP_SALT?: string;
    AUDIT_ARCHIVE_DRY_RUN?: string;
    AUDIT_ARCHIVE_PURGE_ENABLED?: string;
    AUDIT_AGGREGATE_PURGE_ENABLED?: string;
    AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS?: string;
    AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS?: string;

    // ── PR5 event outbox consumer (cron knobs; defaults in event-outbox.ts) ──
    EVENT_OUTBOX_MAX_ATTEMPTS?: string;
    EVENT_OUTBOX_LEASE_SECONDS?: string;
    EVENT_OUTBOX_CLAIM_LIMIT?: string;
    EVENT_OUTBOX_RETRY_BACKOFF_S?: string;

    // ── PR5 5d-2 large-N session-revoke anomaly alarm (strict default in session-revoke.ts) ──
    SESSION_REVOKE_LARGE_N_THRESHOLD?: string;

    // ── Ops / env meta ─────────────────────────────────────────────────
    ENVIRONMENT?: string;
    CRON_SECRET?: string;
    ALLOWED_ORIGINS?: string;
  }

  /**
   * Cloudflare 在 edge 為 inbound Request 注入的 `cf` metadata（geo/IP 等）。
   * lib `Request`（WebWorker）無 `.cf`；local / integration-test 環境亦無
   * （故 `cf?` optional）。窄到目前唯一讀取的 `country`；未來消費 colo/asn
   * 等欄位時再明確擴充（勿一次搬官方完整 shape）。
   *
   * opt-in alias（非 `interface Request` 全域 merge）：只有顯式標 `request: CfRequest`
   * 的參數才帶 `.cf`，不污染全 codebase 的 `request: Request`、不遮蔽錯誤。
   */
  type CfRequest = Request & {
    cf?: {
      country?: string
    }
  }
}

/**
 * Bridge `Env` into `@cloudflare/vitest-pool-workers`'s `ProvidedEnv` so
 * integration tests calling `import { env } from 'cloudflare:test'` get the
 * same typed bindings as Pages Functions handlers.
 */
declare module 'cloudflare:test' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface ProvidedEnv extends Env {}
}
