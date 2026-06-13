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
const MAX_PER_RUN_CAP = 1000                      // strict upper bound on the per-call batch size
const ALL_TYPES: CredentialType[] = ['passkey', 'wallet', 'identity']

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // ── double-gate: security step-up + admin write scope ────────────────────
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'credential_disposition')
  if (stepCheck.error) return stepCheck.error
  const actorId = Number(stepCheck.user.sub)

  if (!effectiveScopesFromJwt(stepCheck.user).has(SCOPES.ADMIN_USERS_WRITE)) {
    return res({ error: 'admin:users:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:users:write' }, 403)
  }

  // ── input: STRICT runtime schema (Codex Code Gate r1 — high-sensitivity admin runner; reject, never coerce) ──
  // allowlist { dryRun?: boolean, types?: non-empty (passkey|wallet|identity)[], maxPerRun?: 1..MAX_PER_RUN_CAP int }.
  // invalid JSON → 400; non-object / array / null body → 400; unknown key → 400; wrong type/value → 400.
  let raw: unknown
  try { raw = await request.json() } catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return res({ error: 'Body must be a JSON object', code: 'ERR_VALIDATION' }, 400)
  }
  const body = raw as Record<string, unknown>
  for (const k of Object.keys(body)) {
    if (k !== 'dryRun' && k !== 'types' && k !== 'maxPerRun') return res({ error: `Unknown field: ${k}`, code: 'ERR_VALIDATION' }, 400)
  }
  // dryRun: optional, default TRUE (conservative, per plan section 2); if present MUST be a boolean (no coercion).
  if ('dryRun' in body && typeof body.dryRun !== 'boolean') return res({ error: 'dryRun must be a boolean', code: 'ERR_VALIDATION' }, 400)
  const dryRun = body.dryRun === undefined ? true : body.dryRun as boolean
  // types: optional; if present MUST be a non-empty array, every element in the allowlist (no silent filtering).
  let types: CredentialType[] = ALL_TYPES.slice()
  if ('types' in body) {
    const t = body.types
    if (!Array.isArray(t) || t.length === 0 || !t.every((x): x is CredentialType => ALL_TYPES.includes(x as CredentialType))) {
      return res({ error: 'types must be a non-empty array of passkey|wallet|identity', code: 'ERR_VALIDATION' }, 400)
    }
    types = t as CredentialType[]
  }
  // maxPerRun: optional, default 200; if present MUST be a positive integer within the cap (no truncation/fallback).
  let maxPerRun = 200
  if ('maxPerRun' in body) {
    const m = body.maxPerRun
    if (typeof m !== 'number' || !Number.isInteger(m) || m <= 0 || m > MAX_PER_RUN_CAP) {
      return res({ error: `maxPerRun must be a positive integer <= ${MAX_PER_RUN_CAP}`, code: 'ERR_VALIDATION' }, 400)
    }
    maxPerRun = m
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
