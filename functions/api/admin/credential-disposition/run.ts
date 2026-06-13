/**
 * POST /api/admin/credential-disposition/run — SEC-FACTOR-ADD ADD-A PR-A4.
 *
 * Runs the existing-credential disposition over window credentials (passkey / wallet / OAuth identity added
 * before the #78 factor-add gate). Classifies each into high / unknown_context / low and records the
 * disposition on the credential row. Idempotent (re-invokable until remaining === 0). dry-run default.
 *
 * Double-gate (mirror admin event-dlq replay): security step-up (elevated:account + for_action=
 * 'credential_disposition') AND effective admin:users:write scope. NOT a plain admin-read endpoint.
 * POST-only, anti-reentry rate-limit, run-lifecycle audit (start / dry_run / complete / failed), and
 * COUNT-ONLY output (never raw credential detail).
 */
import { res, requireStepUp } from '../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
import { safeUserAudit } from '../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit'
import { runDisposition, type CredentialType } from '../../../utils/credential-disposition'

const RL_WINDOW_SEC = 300
const RL_MAX = 3                                  // anti-reentry: only a few runs per 5 min
const ALL_TYPES: CredentialType[] = ['passkey', 'wallet', 'identity']

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // ── double-gate: security step-up + admin write scope ────────────────────
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'credential_disposition')
  if (stepCheck.error) return stepCheck.error
  const actorId = Number(stepCheck.user.sub)

  if (!effectiveScopesFromJwt(stepCheck.user).has(SCOPES.ADMIN_USERS_WRITE)) {
    return res({ error: 'admin:users:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:users:write' }, 403)
  }

  // ── input (validate-once allowlist) ──────────────────────────────────────
  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch { body = {} }
  const dryRun = body.dryRun !== false           // default TRUE (conservative; explicit false to write)
  const maxPerRun = Number.isFinite(body.maxPerRun) ? Math.trunc(body.maxPerRun as number) : 200
  let types: CredentialType[] = ALL_TYPES.slice()
  if (Array.isArray(body.types)) {
    types = (body.types as unknown[]).filter((t): t is CredentialType => ALL_TYPES.includes(t as CredentialType))
    if (types.length === 0) return res({ error: 'types must be a non-empty subset of passkey|wallet|identity', code: 'ERR_VALIDATION' }, 400)
  }

  // ── anti-reentry rate-limit (per-row CAS is the real concurrency guarantee) ──
  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'credential_disposition_run', userId: actorId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (rl.blocked) return res({ error: 'Too many disposition runs; slow down', code: 'RATE_LIMITED' }, 429)
  await recordRateLimit(env.chiyigo_db, { kind: 'credential_disposition_run', userId: actorId })

  await safeUserAudit(env, {
    event_type: 'account.credential.disposition.run', severity: 'info', user_id: actorId, request,
    data: { phase: dryRun ? 'dry_run' : 'start', types },
  })

  try {
    const counts = await runDisposition(env, { dryRun, types, maxPerRun, actorId, request })
    await safeUserAudit(env, {
      event_type: 'account.credential.disposition.run', severity: counts.failed > 0 ? 'warn' : 'info', user_id: actorId, request,
      data: { phase: 'complete', dryRun, ...counts },
    })
    return res({ ok: true, dryRun, ...counts }, 200)   // count-only
  } catch (e) {
    await safeUserAudit(env, {
      event_type: 'account.credential.disposition.run', severity: 'critical', user_id: actorId, request,
      data: { phase: 'failed', error: String((e as Error)?.message ?? e).slice(0, 120) },
    })
    return res({ error: 'Disposition run failed', code: 'DISPOSITION_RUN_FAILED' }, 500)
  }
}
