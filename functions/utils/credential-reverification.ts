/**
 * Credential reverification clear-core (OD-3 credential requires_reverification enforcement).
 *
 * Plan: docs/audit/cred-reverify-enforcement-plan.md (Dimension-A x4 + ChatGPT Arch C1/C2/C3 + Codex Plan APPROVED).
 *
 * THE single credential-flag CLEAR write-point, shared byte-identical by self-service reverify
 * (/api/auth/credential/reverify, actor_type='self') and admin clear
 * (/api/admin/credential-reverification/clear, actor_type='admin').
 *
 * Semantics (OD-CLEAR=A): clears ONLY requires_reverification (1->0) via CAS; does NOT overwrite
 * disposition_reason / disposition_at / disposition_by — those stay the A4 disposition forensic facts
 * ("why it was flagged"). The clear fact (who/how/result + pre-clear snapshot) lives in the audit event,
 * which is the only place that records "how it was cleared".
 *
 * Audit (Arch C3): emits the single merged `account.credential.reverification_cleared` event ONLY when the
 * CAS wins (changes()=1). Dynamic severity by (actor_type, tier): admin+high -> critical / admin -> warn /
 * self -> info. A CAS loser (flag already cleared by a concurrent path) returns { cleared:false } and emits
 * NO success audit (Codex Plan P2).
 *
 * D1-dependent -> excluded from unit coverage gate (vitest.config.js category-A).
 */

import { safeUserAudit, hashIdentifierForAudit } from './user-audit'
import { dispositionTierFromReason, type CredentialType } from './credential-disposition'

export type ClearActorType = 'self' | 'admin'
export type ClearMethod = 'totp' | 'backup_code' | 'password' | 'admin_clear'

// type -> table SSOT. Keys are a fixed allowlist (callers validate `type` before calling), so the
// table-name interpolation below is injection-safe.
const TABLE_BY_TYPE: Record<CredentialType, string> = {
  passkey:  'user_webauthn_credentials',
  wallet:   'user_wallets',
  identity: 'user_identities',
}

interface ClearReverificationOpts {
  type: CredentialType
  id: number
  userId: number
  actorType: ClearActorType
  clearMethod: ClearMethod
  request: Request
  actorId?: number   // admin actor id (actor_type='admin')
  reason?: string    // admin-supplied reason, bounded (actor_type='admin')
  dormant?: boolean  // wallet: flag is informational-only (no live enforcement read-point)
}

/**
 * Atomic CAS clear of a credential's requires_reverification flag. Returns { cleared } — true iff this call
 * won the CAS (changes()=1) and emitted the success audit; false on CAS race-loser / already-cleared / no row.
 */
export async function clearReverificationFlag(
  env: Env,
  opts: ClearReverificationOpts,
): Promise<{ cleared: boolean }> {
  const { type, id, userId, actorType, clearMethod, request, actorId, reason, dormant } = opts
  const table = TABLE_BY_TYPE[type]
  const db = env.chiyigo_db

  // pre-clear snapshot (user-scoped): read disposition_* BEFORE the CAS for the audit forensic record +
  // the tier that drives dynamic severity. Reading by id+userId never touches another user's row.
  const pre = await db
    .prepare(`SELECT disposition_reason, disposition_by, disposition_at FROM ${table} WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first()
  const preReason: string | null = pre?.disposition_reason ?? null

  // CAS: flip 1->0 only; do NOT overwrite disposition_* (OD-CLEAR=A). The user_id predicate is the ownership
  // gate for self (token.sub) and a no-op uniformity bind for admin (row.user_id read by the caller).
  const upd = await db
    .prepare(`UPDATE ${table} SET requires_reverification = 0 WHERE id = ? AND user_id = ? AND requires_reverification = 1`)
    .bind(id, userId)
    .run()
  if ((upd?.meta?.changes ?? 0) !== 1) return { cleared: false }   // CAS loser / already cleared -> no success audit

  // success audit (CAS winner only). Dynamic severity (Arch C3): admin+high=critical / admin=warn / self=info.
  const credentialTier = dispositionTierFromReason(preReason)
  const severity = actorType === 'admin'
    ? (credentialTier === 'high' ? 'critical' : 'warn')
    : 'info'
  const sig = await hashIdentifierForAudit(env, 'credential-disposition', `${type}:${id}`)
  await safeUserAudit(env, {
    event_type: 'account.credential.reverification_cleared',
    severity,
    user_id: userId,
    request,
    data: {
      credential_type:  type,
      actor_type:       actorType,
      clear_method:     clearMethod,
      credential_tier:  credentialTier,
      result:           'cleared',
      id_hmac16:        sig.hex.slice(0, 16),
      salted:           sig.salted,
      pre_clear_reason: preReason,
      pre_clear_by:     pre?.disposition_by ?? null,
      pre_clear_at:     pre?.disposition_at ?? null,
      ...(actorType === 'admin' ? { admin_actor: actorId ?? null, reason: reason ?? null } : {}),
      ...(dormant ? { dormant: true } : {}),
    },
  })

  return { cleared: true }
}
