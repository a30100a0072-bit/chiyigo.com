import { env } from 'cloudflare:test'
import setupSql from './_setup.sql?raw'
import {
  generateSalt,
  generateSecureToken,
  hashPassword,
  hashToken,
} from '../../functions/utils/crypto.js'
import { _resetCacheForTests, invalidateClientsCache } from '../../functions/utils/oauth-clients.js'

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
  ]) {
    try { await env.chiyigo_db.prepare(sql).run() } catch { /* already present */ }
  }
  await env.chiyigo_db.batch([
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
  const payload = { sub, aud, iss, iat: now, exp: now + expiresIn }
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
  const payload = { sub, aud, iss, iat: now, exp: now + expiresIn }
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
