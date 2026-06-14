/**
 * POST /api/auth/credential/reverify
 * Header: Authorization: Bearer <regular access token>
 * Body:   { type: 'passkey'|'identity', credential_id: number, otp_code?, backup_code?, password? }
 *
 * OD-3 credential requires_reverification enforcement — SELF-service reverify (owner-vouch).
 * Plan: docs/audit/cred-reverify-enforcement-plan.md §6.1 (Arch C2 tier-gate / Codex Plan P1·P2).
 *
 * Clears a flagged credential's flag by proving an INDEPENDENT owner-held factor (TOTP/backup, or password
 * when the account has no TOTP) — NOT by re-asserting the credential itself (a planted credential is
 * attacker-controlled, so self-vouching via it is useless). Only `unknown_context` credentials may
 * self-reverify; high-risk / null / malformed deny (delete or admin-clear). Wallet is not self-reverifiable.
 *
 * Fail-closed gates (in order):
 *   1. requireRegularAccessToken — rejects temp_bind / elevated:* step-up / pre_auth / bad-sub; validated userId.
 *   2. live banned/deleted re-check.
 *   3. credential SELECT by type/id/user_id + requires_reverification=1 (user-scoped: other-user / not-flagged
 *      -> CREDENTIAL_NOT_FLAGGED, no tier leak).
 *   4. tier-gate: isSelfReverifyAllowed (SSOT, only 'unknown_context'; no inline string match).
 *   5. anti-downgrade: TOTP-enabled accounts MUST use TOTP/backup (password rejected).
 *   6. clearReverificationFlag (CAS; loser -> cleared:false, no success audit).
 */

import { requireRegularAccessToken, res } from '../../../utils/auth'
import { verifyPassword } from '../../../utils/crypto'
import { verifySecondFactor } from '../../../utils/elevation'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../../utils/rate-limit'
import { isSelfReverifyAllowed } from '../../../utils/credential-disposition'
import { clearReverificationFlag, CREDENTIAL_TABLE, type ClearMethod } from '../../../utils/credential-reverification'

const RL_WINDOW_SEC = 300
const RL_MAX        = 5

// self may only reverify possession/knowledge-backed LOGIN factors. wallet has no live login-use enforcement
// (informational-only — admin-clear / delete only), so wallet is NOT a self-reverify type.
const SELF_TYPES = new Set(['passkey', 'identity'])

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // 1. token-class gate: reject temp_bind / elevated:* / pre_auth / bad-sub; userId is validated.
  const { userId, error } = await requireRegularAccessToken(request, env)
  if (error) return error

  // 2. strict schema (reject unknown keys / wrong types; no coercion).
  let raw: unknown
  try { raw = await request.json() } catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return res({ error: 'Body must be a JSON object', code: 'ERR_VALIDATION' }, 400)
  const body = raw as Record<string, unknown>
  for (const k of Object.keys(body)) {
    if (k !== 'type' && k !== 'credential_id' && k !== 'otp_code' && k !== 'backup_code' && k !== 'password')
      return res({ error: `Unknown field: ${k}`, code: 'ERR_VALIDATION' }, 400)
  }
  const type = body.type
  if (typeof type !== 'string' || !SELF_TYPES.has(type))
    return res({ error: 'type must be passkey | identity', code: 'ERR_VALIDATION' }, 400)   // wallet self-reverify denied
  const credType: 'passkey' | 'identity' = type === 'passkey' ? 'passkey' : 'identity'
  const credentialId = body.credential_id
  if (typeof credentialId !== 'number' || !Number.isInteger(credentialId) || credentialId <= 0)
    return res({ error: 'credential_id must be a positive integer', code: 'ERR_VALIDATION' }, 400)
  if ('otp_code'    in body && typeof body.otp_code    !== 'string') return res({ error: 'otp_code must be a string', code: 'ERR_VALIDATION' }, 400)
  if ('backup_code' in body && typeof body.backup_code !== 'string') return res({ error: 'backup_code must be a string', code: 'ERR_VALIDATION' }, 400)
  if ('password'    in body && typeof body.password    !== 'string') return res({ error: 'password must be a string', code: 'ERR_VALIDATION' }, 400)
  const otpCode    = typeof body.otp_code    === 'string' ? body.otp_code    : null
  const backupCode = typeof body.backup_code === 'string' ? body.backup_code : null
  const password   = typeof body.password    === 'string' ? body.password    : null

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  // rate limit (per-user) — proof brute-force guard.
  const { blocked } = await checkRateLimit(db, { kind: 'credential_reverification', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) return res({ error: 'Too many reverification attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)

  // 3. live banned/deleted re-check + load local_accounts proof material (one query).
  const acct = await db
    .prepare(`SELECT u.status, la.totp_secret, la.totp_enabled, la.password_hash, la.password_salt
              FROM users u LEFT JOIN local_accounts la ON la.user_id = u.id
              WHERE u.id = ? AND u.deleted_at IS NULL`)
    .bind(userId).first()
  if (!acct) return res({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404)
  if (acct.status === 'banned') return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)

  // 4. credential must belong to this user AND be flagged (user-scoped: other-user / unflagged -> NOT_FLAGGED, no tier leak).
  const table = CREDENTIAL_TABLE[credType]
  const credRow = await db
    .prepare(`SELECT disposition_reason FROM ${table} WHERE id = ? AND user_id = ? AND requires_reverification = 1`)
    .bind(credentialId, userId).first()
  if (!credRow) return res({ error: 'Credential is not flagged for reverification', code: 'CREDENTIAL_NOT_FLAGGED' }, 403)

  // 5. tier-gate (SSOT fail-closed whitelist): only unknown_context self-reverifies; high:/null/malformed deny.
  if (!isSelfReverifyAllowed(credRow.disposition_reason ?? null))
    return res({ error: 'This credential requires admin review or removal; self-reverification is not available', code: 'CREDENTIAL_REVERIFICATION_HIGH_RISK' }, 403)

  // 6. anti-downgrade + owner-vouch proof (account-state-driven, NOT body-field-driven).
  let clearMethod: ClearMethod
  if (acct.totp_enabled === 1) {
    // 2FA account: MUST prove via TOTP/backup; password is NOT an accepted factor (anti-downgrade hard lock).
    const code = otpCode ?? backupCode
    if (!code)
      return res({ error: 'This account has 2FA; provide a TOTP or backup code', code: 'CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL' }, 403)
    const v = await verifySecondFactor(env, { userId, secret: acct.totp_secret, code })
    if (!v.ok) {
      await recordRateLimit(db, { kind: 'credential_reverification', userId, ip })
      return res({ error: 'Invalid OTP or backup code', code: 'CREDENTIAL_REVERIFICATION_PROOF_FAILED' }, 401)
    }
    clearMethod = v.method === 'backup_code' ? 'backup_code' : 'totp'
  } else {
    // no TOTP: password fallback (documented residual R1). OAuth-only (no local password) -> no trusted channel.
    if (!acct.password_hash || !acct.password_salt)
      return res({ error: 'No trusted channel to reverify; set a password (forgot-password) or contact support', code: 'CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL' }, 403)
    if (!password)
      return res({ error: 'password is required to reverify this account', code: 'CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL' }, 403)
    const valid = await verifyPassword(password, acct.password_salt, acct.password_hash)
    if (!valid) {
      await recordRateLimit(db, { kind: 'credential_reverification', userId, ip })
      return res({ error: 'Invalid password', code: 'CREDENTIAL_REVERIFICATION_PROOF_FAILED' }, 401)
    }
    clearMethod = 'password'
  }

  // 7. clear (CAS; loser -> cleared:false, no success audit). Only through the shared clear-core.
  await clearRateLimit(db, { kind: 'credential_reverification', userId })
  const { cleared } = await clearReverificationFlag(env, {
    type: credType, id: credentialId, userId, actorType: 'self', clearMethod, request,
  })
  return res({ ok: true, cleared })
}
