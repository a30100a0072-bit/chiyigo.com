/**
 * POST /api/admin/credential-reverification/clear
 * Header: Authorization: Bearer <step-up token: elevated:account, for_action=credential_reverification_clear>
 * Body:   { type: 'passkey'|'identity'|'wallet', credential_id: number, reason: string }
 *
 * OD-3 — admin / support fallback clear of a credential's requires_reverification flag (lockout backstop).
 * Plan §6.2. Double-gate (mirror credential-disposition runner): security step-up + admin:users:write.
 * Cross-user by design (support). Wallet may be cleared but is informational-only (audit dormant=true).
 * Output is count/bool only — never raw provider_id / wallet address / credential detail.
 *
 * 回傳:
 *   200 -> { ok:true, cleared:boolean }   (already-clear -> cleared:false, idempotent no-op)
 *   400 -> ERR_VALIDATION / INVALID_JSON
 *   403 -> step-up failure / INSUFFICIENT_SCOPE
 *   404 -> CREDENTIAL_NOT_FOUND
 *   429 -> RATE_LIMITED
 */

import { res, requireStepUp } from '../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit'
import { clearReverificationFlag, CREDENTIAL_TABLE } from '../../../utils/credential-reverification'

const RL_WINDOW_SEC = 300
const RL_MAX        = 5
const REASON_MAX    = 200
const ALL_TYPES = new Set(['passkey', 'identity', 'wallet'])

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // ── double-gate: security step-up (elevated:account + for_action) + admin:users:write scope ──
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'credential_reverification_clear')
  if (stepCheck.error) return stepCheck.error
  const actorId = Number(stepCheck.user.sub)
  if (!effectiveScopesFromJwt(stepCheck.user).has(SCOPES.ADMIN_USERS_WRITE))
    return res({ error: 'admin:users:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:users:write' }, 403)

  // ── strict schema (reject unknown / wrong types; no coercion) ──
  let raw: unknown
  try { raw = await request.json() } catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return res({ error: 'Body must be a JSON object', code: 'ERR_VALIDATION' }, 400)
  const body = raw as Record<string, unknown>
  for (const k of Object.keys(body)) {
    if (k !== 'type' && k !== 'credential_id' && k !== 'reason') return res({ error: `Unknown field: ${k}`, code: 'ERR_VALIDATION' }, 400)
  }
  const type = body.type
  if (typeof type !== 'string' || !ALL_TYPES.has(type))
    return res({ error: 'type must be passkey | identity | wallet', code: 'ERR_VALIDATION' }, 400)
  const credType: 'passkey' | 'identity' | 'wallet' =
    type === 'passkey' ? 'passkey' : type === 'identity' ? 'identity' : 'wallet'
  const credentialId = body.credential_id
  if (typeof credentialId !== 'number' || !Number.isInteger(credentialId) || credentialId <= 0)
    return res({ error: 'credential_id must be a positive integer', code: 'ERR_VALIDATION' }, 400)
  const reason = body.reason
  if (typeof reason !== 'string' || reason.length === 0 || reason.length > REASON_MAX)
    return res({ error: `reason must be a non-empty string <= ${REASON_MAX} chars`, code: 'ERR_VALIDATION' }, 400)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  // ── anti-reentry rate limit (per-admin) ──
  const rl = await checkRateLimit(db, { kind: 'credential_reverification_clear', userId: actorId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (rl.blocked) return res({ error: 'Too many clear requests; slow down', code: 'RATE_LIMITED' }, 429)
  await recordRateLimit(db, { kind: 'credential_reverification_clear', userId: actorId, ip })

  // ── pre-SELECT the row's user_id as SSOT (NEVER trust a body-supplied user_id). No row -> 404. ──
  const table = CREDENTIAL_TABLE[credType]
  const row = await db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).bind(credentialId).first()
  if (!row) return res({ error: 'Credential not found', code: 'CREDENTIAL_NOT_FOUND' }, 404)
  const rowUserId = Number(row.user_id)

  // ── clear (CAS; already-clear -> cleared:false idempotent). Wallet flag is informational-only -> dormant audit. ──
  // A clear-path D1 failure is a SystemError -> 500 (the clear-core emits the structured log); no success audit.
  let cleared = false
  try {
    cleared = (await clearReverificationFlag(env, {
      type: credType, id: credentialId, userId: rowUserId,
      actorType: 'admin', clearMethod: 'admin_clear', actorId, reason,
      dormant: credType === 'wallet', request,
    })).cleared
  } catch {
    return res({ error: 'Failed to clear reverification flag', code: 'CREDENTIAL_REVERIFICATION_CLEAR_FAILED' }, 500)
  }
  return res({ ok: true, cleared })   // count/bool only — no credential detail
}
