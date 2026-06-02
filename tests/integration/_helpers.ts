import { env } from 'cloudflare:test'
import setupSql from './_setup.sql?raw'
import {
  generateSalt,
  generateSecureToken,
  hashPassword,
  hashToken,
} from '../../functions/utils/crypto'
import { _resetCacheForTests, invalidateClientsCache } from '../../functions/utils/oauth-clients'

/** Apply schema (idempotent via IF NOT EXISTS) and truncate tables. */
export async function resetDb() {
  // pkce_sessions / auth_codes 在 _base.sql（migrations test 用）schema 與
  // _setup.sql（authoritative）有 column rename + 新增（pkce_key→session_key、
  // state、redirect_uri 都沒對應 migration），CREATE IF NOT EXISTS 跳過會吃舊 schema。
  // 直接 drop 重建，內容反正都是 ephemeral test data。
  await env.chiyigo_db.prepare('DROP TABLE IF EXISTS pkce_sessions').run()
  await env.chiyigo_db.prepare('DROP TABLE IF EXISTS auth_codes').run()

  const stmts = setupSql.split(';').map(s => s.trim()).filter(Boolean)
  for (const s of stmts) {
    await env.chiyigo_db.prepare(s).run()
  }
  // Idempotent column patches: tests may share D1 with migrations.test.js
  // which builds from _base.sql (older schema). Add columns introduced after _base.
  try {
    await env.chiyigo_db.prepare(
      `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`
    ).run()
  } catch { /* column already present */ }
  try {
    await env.chiyigo_db.prepare(
      `ALTER TABLE oauth_states ADD COLUMN nonce TEXT`
    ).run()
  } catch { /* column already present */ }
  try {
    await env.chiyigo_db.prepare(
      `ALTER TABLE oauth_states ADD COLUMN aud TEXT`
    ).run()
  } catch { /* column already present */ }
  try {
    await env.chiyigo_db.prepare(
      `ALTER TABLE login_attempts ADD COLUMN kind TEXT NOT NULL DEFAULT 'login'`
    ).run()
  } catch { /* column already present */ }
  try {
    await env.chiyigo_db.prepare(
      `ALTER TABLE login_attempts ADD COLUMN user_id INTEGER`
    ).run()
  } catch { /* column already present */ }
  try {
    await env.chiyigo_db.prepare(
      `ALTER TABLE admin_audit_log ADD COLUMN prev_hash TEXT`
    ).run()
  } catch { /* column already present */ }
  try {
    await env.chiyigo_db.prepare(
      `ALTER TABLE admin_audit_log ADD COLUMN row_hash TEXT`
    ).run()
  } catch { /* column already present */ }
  // pkce_sessions / auth_codes OIDC columns (migration 0014)
  for (const sql of [
    `ALTER TABLE pkce_sessions ADD COLUMN scope TEXT`,
    `ALTER TABLE pkce_sessions ADD COLUMN nonce TEXT`,
    `ALTER TABLE auth_codes ADD COLUMN scope TEXT`,
    `ALTER TABLE auth_codes ADD COLUMN nonce TEXT`,
    `ALTER TABLE refresh_tokens ADD COLUMN auth_time TEXT`, // migration 0019
    `ALTER TABLE auth_codes ADD COLUMN auth_time TEXT`,     // migration 0019
    `ALTER TABLE refresh_tokens ADD COLUMN scope TEXT`,     // migration 0035
    `ALTER TABLE refresh_tokens ADD COLUMN issued_aud TEXT`, // migration 0037（Codex r9-5）
    `ALTER TABLE audit_log ADD COLUMN archived_at TEXT`,                                  // migration 0038
    `ALTER TABLE audit_log ADD COLUMN cold_class TEXT NOT NULL DEFAULT 'immutable'`,     // migration 0038
  ]) {
    try { await env.chiyigo_db.prepare(sql).run() } catch { /* already present */ }
  }
  // requisition columns from migrations 0001 + 0006 (post _base)
  for (const sql of [
    `ALTER TABLE requisition ADD COLUMN user_id INTEGER`,
    `ALTER TABLE requisition ADD COLUMN name TEXT`,
    `ALTER TABLE requisition ADD COLUMN company TEXT`,
    `ALTER TABLE requisition ADD COLUMN contact TEXT`,
    `ALTER TABLE requisition ADD COLUMN service_type TEXT`,
    `ALTER TABLE requisition ADD COLUMN budget TEXT`,
    `ALTER TABLE requisition ADD COLUMN timeline TEXT`,
    `ALTER TABLE requisition ADD COLUMN message TEXT`,
    `ALTER TABLE requisition ADD COLUMN source_ip TEXT`,
    `ALTER TABLE requisition ADD COLUMN tg_message_id INTEGER`,
    `ALTER TABLE requisition ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE requisition ADD COLUMN deleted_at TEXT`,
    // migration 0036（owner_guest_id / owner_user_id）；_base.sql 移除這兩欄後
    // 共用 D1 worker 跑 migrations.test.js 後 requisition 不會有 owner_*
    `ALTER TABLE requisition ADD COLUMN owner_guest_id TEXT`,
    `ALTER TABLE requisition ADD COLUMN owner_user_id INTEGER`,
  ]) {
    try { await env.chiyigo_db.prepare(sql).run() } catch { /* already present */ }
  }
  await env.chiyigo_db.batch([
    // migration 0051 event tables（append/transition-only；唯一 FK = event_dlq.replayed_by→users ON DELETE SET NULL，故先刪 event_dlq 早於 users）
    env.chiyigo_db.prepare('DELETE FROM event_deny_state'),
    env.chiyigo_db.prepare('DELETE FROM event_dlq'),
    env.chiyigo_db.prepare('DELETE FROM event_outbox'),
    env.chiyigo_db.prepare('DELETE FROM event_stream_sequences'),
    // migration 0050 member lifecycle 表先刪（FK → tenants/users，須早於它們清空；app-layer append-only，plain DELETE 即可）
    env.chiyigo_db.prepare('DELETE FROM org_create_operations'),
    env.chiyigo_db.prepare('DELETE FROM invitations'),
    // migration 0049 credit wallet 表先刪（FK → tenants/products；append-only 走應用層紀律，plain DELETE 即可）
    env.chiyigo_db.prepare('DELETE FROM credit_ledger'),
    env.chiyigo_db.prepare('DELETE FROM quota_config_ledger'),
    env.chiyigo_db.prepare('DELETE FROM product_usage_quota'),
    env.chiyigo_db.prepare('DELETE FROM credit_wallets'),
    // migration 0048 billing/entitlement 表先刪（FK → tenants/products/plans/payment_intents，須早於它們）
    // grant_plan_operations append-only 走應用層紀律（無 DB trigger）→ 測試 reset 用 plain DELETE 即可
    env.chiyigo_db.prepare('DELETE FROM grant_plan_operations'),
    env.chiyigo_db.prepare('DELETE FROM tenant_product_access'),
    env.chiyigo_db.prepare('DELETE FROM plans'),
    env.chiyigo_db.prepare('DELETE FROM products'),
    // migration 0047 tenant 表先刪（FK 指向 users / tenants，須早於 users 清空）
    env.chiyigo_db.prepare('DELETE FROM organization_members'),
    env.chiyigo_db.prepare('DELETE FROM tenants'),
    env.chiyigo_db.prepare('DELETE FROM refresh_tokens'),
    env.chiyigo_db.prepare('DELETE FROM email_verifications'),
    env.chiyigo_db.prepare('DELETE FROM backup_codes'),
    env.chiyigo_db.prepare('DELETE FROM local_accounts'),
    env.chiyigo_db.prepare('DELETE FROM users'),
    env.chiyigo_db.prepare('DELETE FROM login_attempts'),
    env.chiyigo_db.prepare('DELETE FROM requisition'),
    env.chiyigo_db.prepare('DELETE FROM user_identities'),
    env.chiyigo_db.prepare('DELETE FROM oauth_states'),
    env.chiyigo_db.prepare('DELETE FROM admin_audit_log'),
    env.chiyigo_db.prepare('DELETE FROM ai_audit'),
    env.chiyigo_db.prepare('DELETE FROM pkce_sessions'),
    env.chiyigo_db.prepare('DELETE FROM auth_codes'),
    env.chiyigo_db.prepare('DELETE FROM revoked_jti'),
    env.chiyigo_db.prepare('DELETE FROM audit_log'),
    env.chiyigo_db.prepare('DELETE FROM oauth_clients'),
    env.chiyigo_db.prepare('DELETE FROM user_webauthn_credentials'),
    env.chiyigo_db.prepare('DELETE FROM webauthn_challenges'),
    env.chiyigo_db.prepare('DELETE FROM ip_blacklist'),
    env.chiyigo_db.prepare('DELETE FROM user_wallets'),
    env.chiyigo_db.prepare('DELETE FROM wallet_nonces'),
    env.chiyigo_db.prepare('DELETE FROM user_kyc'),
    env.chiyigo_db.prepare('DELETE FROM kyc_webhook_events'),
    env.chiyigo_db.prepare('DELETE FROM payment_webhook_events'),
    env.chiyigo_db.prepare('DELETE FROM payment_intents'),
    env.chiyigo_db.prepare('DELETE FROM audit_archive_chunks'),  // F-3 Phase 2 PR 2.1a
    env.chiyigo_db.prepare('DELETE FROM audit_log_aggregate_telemetry'),  // F-3 Phase 2 PR 3.0
    env.chiyigo_db.prepare('DELETE FROM audit_log_aggregate_debug'),       // F-3 Phase 2 PR 3.1
    env.chiyigo_db.prepare('DELETE FROM deals'),                            // Stage 3 PR-17b
  ])

  // oauth-clients 模組級 cache 也歸零（避免跨 test file 撞資料）
  _resetCacheForTests()
  await invalidateClientsCache(env)
}

/** Generate ES256 test keypair and inject into env (idempotent module-cached). */
let _keysReady = false
export async function ensureJwtKeys() {
  if (_keysReady) return
  const { generateKeyPair, exportJWK } = await import('jose')
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const priv = await exportJWK(privateKey)
  const pub  = await exportJWK(publicKey)
  priv.kid = pub.kid = 'test-key'
  priv.alg = pub.alg = 'ES256'
  pub.use  = 'sig'
  env.JWT_PRIVATE_KEY = JSON.stringify(priv)
  env.JWT_PUBLIC_KEY  = JSON.stringify(pub)
  _keysReady = true
}

// ── Google id_token 測試簽章工具（P0-3）──────────────────────────
// callback.js 改成驗 Google id_token 簽章，測試需要：
//   1. 一把穩定的「Google」測試金鑰
//   2. JWKS endpoint mock 回傳對應公鑰
let _googleTestKeys = null
export async function ensureGoogleTestKeys() {
  if (_googleTestKeys) return _googleTestKeys
  const { generateKeyPair, exportJWK } = await import('jose')
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const priv = await exportJWK(privateKey)
  const pub  = await exportJWK(publicKey)
  priv.kid = pub.kid = 'google-test-key'
  priv.alg = pub.alg = 'ES256'
  pub.use  = 'sig'
  _googleTestKeys = { privateKey, publicJwk: pub, privateJwk: priv }
  return _googleTestKeys
}

export async function googleSignIdToken({
  sub      = 'g-test',
  email    = null,
  email_verified = true,
  aud      = 'goog-cid',
  iss      = 'https://accounts.google.com',
  nonce    = null,
  expiresIn = 600,
} = {}) {
  const { SignJWT } = await import('jose')
  const { privateKey, privateJwk } = await ensureGoogleTestKeys()
  const now = Math.floor(Date.now() / 1000)
  const payload: {
    sub: string; aud: string; iss: string; iat: number; exp: number;
    email?: string; email_verified?: boolean; nonce?: string;
  } = { sub, aud, iss, iat: now, exp: now + expiresIn }
  if (email != null) payload.email = email
  payload.email_verified = email_verified
  if (nonce) payload.nonce = nonce
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: privateJwk.kid })
    .sign(privateKey)
}

export async function googleJwksBody() {
  const { publicJwk } = await ensureGoogleTestKeys()
  return { keys: [publicJwk] }
}

// Apple test keys + signed id_token + JWKS body（與 Google helper 對稱）
let _appleTestKeys = null
export async function ensureAppleTestKeys() {
  if (_appleTestKeys) return _appleTestKeys
  const { generateKeyPair, exportJWK } = await import('jose')
  // Apple 用 RS256；jose JWKS verify 會依 alg 自動匹配
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 })
  const priv = await exportJWK(privateKey)
  const pub  = await exportJWK(publicKey)
  priv.kid = pub.kid = 'apple-test-key'
  priv.alg = pub.alg = 'RS256'
  pub.use  = 'sig'
  _appleTestKeys = { privateKey, publicJwk: pub, privateJwk: priv }
  return _appleTestKeys
}

export async function appleSignIdToken({
  sub      = 'apple-test',
  email    = null,
  email_verified = 'true',
  aud      = 'apple-cid',
  iss      = 'https://appleid.apple.com',
  nonce    = null,
  expiresIn = 600,
} = {}) {
  const { SignJWT } = await import('jose')
  const { privateKey, privateJwk } = await ensureAppleTestKeys()
  const now = Math.floor(Date.now() / 1000)
  const payload: {
    sub: string; aud: string; iss: string; iat: number; exp: number;
    email?: string; email_verified?: string; nonce?: string;
  } = { sub, aud, iss, iat: now, exp: now + expiresIn }
  if (email != null) payload.email = email
  payload.email_verified = email_verified
  if (nonce) payload.nonce = nonce
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: privateJwk.kid })
    .sign(privateKey)
}

export async function appleJwksBody() {
  const { publicJwk } = await ensureAppleTestKeys()
  return { keys: [publicJwk] }
}

/**
 * Insert a user + local_accounts row (password set).
 * Returns { id, email, password, salt, hash }.
 */
export async function seedUser({
  email = 'user@example.com',
  password = 'OldPass#1234',
  emailVerified = 1,
  deletedAt = null,
  role = null,
} = {}) {
  const salt = generateSalt()
  const hash = await hashPassword(password, salt)
  const r = await env.chiyigo_db
    .prepare('INSERT INTO users (email, email_verified, deleted_at) VALUES (?, ?, ?)')
    .bind(email, emailVerified, deletedAt)
    .run()
  const id = r.meta.last_row_id
  if (role) {
    await env.chiyigo_db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run()
  }
  await env.chiyigo_db
    .prepare('INSERT INTO local_accounts (user_id, password_hash, password_salt) VALUES (?, ?, ?)')
    .bind(id, hash, salt)
    .run()
  return { id, email, password, salt, hash }
}

/**
 * Insert a reset-password token row.
 * Returns the plaintext token (the DB only stores hashToken(token)).
 */
export async function seedResetToken(userId, {
  ttlMinutes = 30,
  used = false,
  tokenType = 'reset_password',
} = {}) {
  const token = generateSecureToken()
  const tokenHash = await hashToken(token)
  const exp = new Date(Date.now() + ttlMinutes * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const usedAt = used
    ? new Date().toISOString().replace('T', ' ').slice(0, 19)
    : null
  await env.chiyigo_db
    .prepare(
      `INSERT INTO email_verifications
         (user_id, token_hash, token_type, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(userId, tokenHash, tokenType, exp, usedAt)
    .run()
  return token
}

/** Call a Pages Function handler with a fake context. */
export async function callFunction(handler, request) {
  return handler({
    request,
    env,
    waitUntil: () => {},
    params: {},
    next: async () => new Response('next'),
    data: {},
  })
}

/** Build a JSON POST Request to a fake URL. */
export function jsonPost(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** Insert a user with NO local_accounts row (OAuth-only). */
export async function seedOauthOnlyUser({
  email = 'oauth@example.com',
  emailVerified = 1,
} = {}) {
  const r = await env.chiyigo_db
    .prepare('INSERT INTO users (email, email_verified) VALUES (?, ?)')
    .bind(email, emailVerified)
    .run()
  return { id: r.meta.last_row_id, email }
}

/**
 * Enable TOTP on a user's local_accounts (creates row if missing).
 * Returns the base32 secret so tests can generate live OTPs via otpauth.
 */
export async function enableTotp(userId, base32Secret) {
  const exists = await env.chiyigo_db
    .prepare('SELECT user_id FROM local_accounts WHERE user_id = ?')
    .bind(userId).first()
  if (exists) {
    await env.chiyigo_db
      .prepare('UPDATE local_accounts SET totp_secret = ?, totp_enabled = 1 WHERE user_id = ?')
      .bind(base32Secret, userId).run()
  } else {
    await env.chiyigo_db
      .prepare(
        `INSERT INTO local_accounts (user_id, password_hash, password_salt, totp_secret, totp_enabled)
         VALUES (?, '', '', ?, 1)`,
      )
      .bind(userId, base32Secret).run()
  }
}

/**
 * Insert a backup code for user. Returns plaintext code (20 hex chars, no dashes).
 */
export async function seedBackupCode(userId, { used = false } = {}) {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const codeHash = await hashToken(hex)
  const usedAt = used ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
  await env.chiyigo_db
    .prepare('INSERT INTO backup_codes (user_id, code_hash, used_at) VALUES (?, ?, ?)')
    .bind(userId, codeHash, usedAt).run()
  return hex
}

/**
 * Insert a tenant row (migration 0047).
 * - type='personal' → ownerUserId 必填（寫入 personal_owner_user_id；schema CHECK 強制）。
 * - type='organization' → ownerUserId 須為 null（schema CHECK 強制）。
 * Returns { id }.
 */
export async function seedTenant(
  opts: { type?: 'personal' | 'organization'; name?: string; status?: string; ownerUserId?: number | null } = {},
) {
  const { type = 'organization', name = 'Acme', status = 'active', ownerUserId = null } = opts
  const r = await env.chiyigo_db
    .prepare('INSERT INTO tenants (type, name, status, personal_owner_user_id) VALUES (?, ?, ?, ?)')
    .bind(type, name, status, ownerUserId)
    .run()
  return { id: r.meta.last_row_id }
}

/**
 * Insert an organization_members row（low-level）。
 * 刻意允許建出「錯誤 row」（如非 owner 的 member 指向他人 personal tenant），
 * 以驗證 tenant resolver / GET tenants 的 personal-tenant owner guard（codex r1 Finding 1）。
 */
export async function seedMembership(
  opts: { tenantId: number; userId: number; role?: string; status?: string },
) {
  const { tenantId, userId, role = 'member', status = 'active' } = opts
  await env.chiyigo_db
    .prepare(`INSERT INTO organization_members (tenant_id, user_id, platform_role, status)
              VALUES (?, ?, ?, ?)`)
    .bind(tenantId, userId, role, status)
    .run()
}

/**
 * Insert a product (catalog, migration 0048). Idempotent via INSERT OR IGNORE on the TEXT id.
 * Returns { id }.
 */
export async function seedProduct(
  opts: { id?: string; name?: string; tenantScope?: 'organization' | 'personal' | 'any'; isActive?: number } = {},
) {
  const { id = 'erp', name = 'ERP', tenantScope = 'organization', isActive = 1 } = opts
  await env.chiyigo_db
    .prepare(`INSERT OR IGNORE INTO products (id, name, tenant_scope, is_active) VALUES (?, ?, ?, ?)`)
    .bind(id, name, tenantScope, isActive)
    .run()
  return { id }
}

/**
 * Insert a plan (migration 0048). Returns { id } (INTEGER surrogate).
 */
export async function seedPlan(
  opts: {
    productId?: string; code?: string; name?: string;
    includedCredits?: number; priceSubunit?: number | null; currency?: string | null; isActive?: number;
  } = {},
) {
  const {
    productId = 'erp', code = 'erp_basic', name = 'ERP Basic',
    includedCredits = 0, priceSubunit = null, currency = null, isActive = 1,
  } = opts
  const r = await env.chiyigo_db
    .prepare(
      `INSERT INTO plans (product_id, code, name, included_credits, price_subunit, currency, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(productId, code, name, includedCredits, priceSubunit, currency, isActive)
    .run()
  return { id: r.meta.last_row_id }
}

/**
 * Insert a tenant_product_access projection row (low-level, migration 0048).
 * Deliberately allows constructing reserved states (pending / expired / revoked)
 * so later guard tests can exercise transitions out of those states.
 */
export async function seedEntitlement(
  opts: {
    tenantId: number; productId: string; planId: number;
    status?: 'pending' | 'active' | 'expired' | 'revoked';
    grantedVia?: 'payment' | 'manual';
    version?: number; lastOpOccurredAt?: string;
  },
) {
  const {
    tenantId, productId, planId,
    status = 'active', grantedVia = 'manual', version = 1,
    lastOpOccurredAt = '2026-05-30T00:00:00.000Z',
  } = opts
  await env.chiyigo_db
    .prepare(
      `INSERT INTO tenant_product_access
         (tenant_id, product_id, plan_id, status, granted_via, version, last_op_occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(tenantId, productId, planId, status, grantedVia, version, lastOpOccurredAt)
    .run()
}

/**
 * Insert a credit_wallets row (migration 0049). Provisions a tenant's single credit wallet.
 */
export async function seedWallet(
  opts: { tenantId: number; balance?: number; version?: number },
) {
  const { tenantId, balance = 0, version = 0 } = opts
  await env.chiyigo_db
    .prepare(`INSERT INTO credit_wallets (tenant_id, balance, version) VALUES (?, ?, ?)`)
    .bind(tenantId, balance, version)
    .run()
}

/**
 * Insert a product_usage_quota row (migration 0049). PR3 uses period='lifetime'.
 */
export async function seedQuota(
  opts: { tenantId: number; productId: string; period?: string; quotaLimit: number; quotaUsed?: number; version?: number },
) {
  const { tenantId, productId, period = 'lifetime', quotaLimit, quotaUsed = 0, version = 0 } = opts
  await env.chiyigo_db
    .prepare(
      `INSERT INTO product_usage_quota (tenant_id, product_id, period, quota_limit, quota_used, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(tenantId, productId, period, quotaLimit, quotaUsed, version)
    .run()
}

/**
 * Low-level credit_ledger insert (migration 0049) for reconstruction / constraint tests.
 * Deliberately raw so a test can probe DB CHECK / UNIQUE behaviour. amount is signed
 * (the caller chooses sign to match entry_type).
 */
export async function seedCreditLedger(
  opts: {
    tenantId: number; productId?: string | null; entryType: 'topup' | 'deduct' | 'refund' | 'adjust';
    amount: number; balanceAfter: number;
    quotaUsedAfter?: number | null; quotaLimitAfter?: number | null; quotaPeriod?: string | null;
    idempotencyScope: string; idempotencyKey: string; requestHash?: string; ref?: string | null;
    source?: 'manual' | 'product' | 'payment';
    actorId?: number | null; actorEmail?: string | null; actorRole?: string | null;
    occurredAt?: string;
  },
) {
  const {
    tenantId, productId = null, entryType, amount, balanceAfter,
    quotaUsedAfter = null, quotaLimitAfter = null, quotaPeriod = null,
    idempotencyScope, idempotencyKey, requestHash = 'h', ref = null,
    source = 'manual', actorId = null, actorEmail = null, actorRole = null,
    occurredAt = '2026-06-01T00:00:00.000Z',
  } = opts
  await env.chiyigo_db
    .prepare(
      `INSERT INTO credit_ledger
         (tenant_id, product_id, entry_type, amount, balance_after, quota_used_after, quota_limit_after,
          quota_period, idempotency_scope, idempotency_key, request_hash, ref, source,
          actor_id, actor_email, actor_role, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tenantId, productId, entryType, amount, balanceAfter, quotaUsedAfter, quotaLimitAfter,
      quotaPeriod, idempotencyScope, idempotencyKey, requestHash, ref, source,
      actorId, actorEmail, actorRole, occurredAt,
    )
    .run()
}

/**
 * Low-level quota_config_ledger insert (migration 0049) for constraint / history tests.
 */
export async function seedQuotaConfigLedger(
  opts: {
    tenantId: number; productId: string; period?: string; oldLimit?: number | null; newLimit: number;
    idempotencyScope?: string; idempotencyKey: string; requestHash?: string;
    actorId: number; actorEmail: string; actorRole: string; reason?: string | null; occurredAt?: string;
  },
) {
  const {
    tenantId, productId, period = 'lifetime', oldLimit = null, newLimit,
    idempotencyScope = `manual:quota_set:${opts.productId}:lifetime`, idempotencyKey, requestHash = 'h',
    actorId, actorEmail, actorRole, reason = null, occurredAt = '2026-06-01T00:00:00.000Z',
  } = opts
  await env.chiyigo_db
    .prepare(
      `INSERT INTO quota_config_ledger
         (tenant_id, product_id, period, old_limit, new_limit, idempotency_scope, idempotency_key,
          request_hash, actor_id, actor_email, actor_role, reason, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tenantId, productId, period, oldLimit, newLimit, idempotencyScope, idempotencyKey,
      requestHash, actorId, actorEmail, actorRole, reason, occurredAt,
    )
    .run()
}

/**
 * Insert an invitations row (migration 0050). Defaults to a live pending invite.
 * Pass `token` (raw) to store its SHA-256 (so a test can later accept with the same raw),
 * or `tokenHash` directly. `expiresAt` is a SQLite-format datetime string (default far future).
 * For `status='accepted'`, the caller MUST pass acceptedUserId + acceptedAt (ck_inv_accept_fields).
 */
export async function seedInvitation(
  opts: {
    tenantId: number; email: string;
    platformRole?: 'tenant_admin' | 'billing_admin' | 'member';
    token?: string; tokenHash?: string;
    status?: 'pending' | 'accepted' | 'revoked' | 'expired';
    expiresAt?: string; invitedBy: number;
    acceptedUserId?: number | null; acceptedAt?: string | null;
  },
) {
  const {
    tenantId, email, platformRole = 'member', status = 'pending',
    expiresAt = '2099-12-31 23:59:59', invitedBy,
    acceptedUserId = null, acceptedAt = null,
  } = opts
  const tokenHash = opts.tokenHash ?? (opts.token ? await hashToken(opts.token) : `th-${tenantId}-${email}`)
  const r = await env.chiyigo_db
    .prepare(
      `INSERT INTO invitations
         (tenant_id, email, platform_role, token_hash, status, expires_at, invited_by, accepted_user_id, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(tenantId, email, platformRole, tokenHash, status, expiresAt, invitedBy, acceptedUserId, acceptedAt)
    .run()
  return { id: r.meta.last_row_id, tokenHash }
}

/**
 * Insert an org_create_operations row (migration 0050) for idempotency / constraint tests.
 */
export async function seedOrgCreateOp(
  opts: { creatorUserId: number; idempotencyKey: string; requestHash?: string; tenantId: number },
) {
  const { creatorUserId, idempotencyKey, requestHash = 'h', tenantId } = opts
  const r = await env.chiyigo_db
    .prepare(
      `INSERT INTO org_create_operations (creator_user_id, idempotency_key, request_hash, tenant_id)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(creatorUserId, idempotencyKey, requestHash, tenantId)
    .run()
  return { id: r.meta.last_row_id }
}
