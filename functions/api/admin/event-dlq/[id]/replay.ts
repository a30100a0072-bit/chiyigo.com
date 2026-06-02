/**
 * POST /api/admin/event-dlq/:id/replay — re-enqueue ONE dead-lettered domain event (PR5 5b, plan §6 / L4 / C2).
 *
 * Double-gate (mirror PR3 admin endpoints): step-up elevated:events + for_action='event_dlq_replay' (one-time
 * jti) AND effective admin:events:replay scope. Server actor; per-user rate limit. Audit + response log
 * stream_key_hash ONLY -- NEVER the raw stream_key / data_json.
 *
 * Transition (C2): ONE atomic CAS-gated db.batch. S1 resets the outbox to 'pending' ONLY when it is 'dead' AND
 * the target DLQ row is unreplayed (subquery); S2 stamps the DLQ row gated on S1's changes()=1. Success requires
 * BOTH changes()===1 (strict, per code-gate reminder); 0-row -> 409 idempotent no-op. This prevents a stale DLQ
 * row from resetting an already-'done' outbox AND double-replay.
 */
import { res, requireStepUp } from '../../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../../utils/scopes'
import { safeUserAudit } from '../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../utils/rate-limit'
import { hashToken } from '../../../../utils/crypto'

const RL_WINDOW_SEC = 60
const RL_MAX = 30

async function auditReplay(env, request, userId, severity, data) {
  await safeUserAudit(env, { event_type: 'domain.event.replay', severity, user_id: userId, request, data })
}

export async function onRequestPost({ request, env, params }) {
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_EVENTS, 'event_dlq_replay')
  if (stepCheck.error) return stepCheck.error
  const userId = Number(stepCheck.user.sub)

  if (!effectiveScopesFromJwt(stepCheck.user).has(SCOPES.ADMIN_EVENTS_REPLAY)) {
    await auditReplay(env, request, userId, 'warn', { outcome: 'denied', reason: 'insufficient_scope', required: 'admin:events:replay' })
    return res({ error: 'admin:events:replay scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:events:replay' }, 403)
  }

  const dlqId = Number(params?.id)
  if (!Number.isInteger(dlqId) || dlqId <= 0) return res({ error: 'Invalid dlq id', code: 'ERR_VALIDATION' }, 400)

  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'event_replay', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (rl.blocked) {
    await auditReplay(env, request, userId, 'warn', { outcome: 'denied', reason: 'rate_limited', dlq_id: dlqId })
    return res({ error: 'Too many replays; slow down', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'event_replay', userId })

  // Read the DLQ row for AUDIT CONTEXT ONLY (the CAS gating below uses a subquery, not this read).
  const dlqRow = await env.chiyigo_db
    .prepare(`SELECT event_id, stream_key, dlq_reason FROM event_dlq WHERE id = ?`)
    .bind(dlqId)
    .first()
  if (!dlqRow) {
    await auditReplay(env, request, userId, 'warn', { outcome: 'not_found', dlq_id: dlqId })
    return res({ error: 'DLQ row not found', code: 'NOT_FOUND' }, 404)
  }
  const skHash = await hashToken(String(dlqRow.stream_key))

  // C2: ONE atomic CAS-gated batch. Reset fires only when outbox is 'dead' AND the DLQ row is unreplayed; stamp
  // is gated on the reset's changes()=1. Both-or-neither.
  const b = await env.chiyigo_db.batch([
    env.chiyigo_db.prepare(
      `UPDATE event_outbox
          SET status='pending', attempts=0, next_attempt_at=datetime('now'), lease_until=NULL, locked_by=NULL, last_error=NULL
        WHERE status='dead'
          AND event_id = (SELECT event_id FROM event_dlq WHERE id = ? AND replayed_at IS NULL)`,
    ).bind(dlqId),
    env.chiyigo_db.prepare(
      `UPDATE event_dlq SET replayed_at = datetime('now'), replayed_by = ?
        WHERE id = ? AND replayed_at IS NULL AND changes() = 1`,
    ).bind(userId, dlqId),
  ])
  const resetOk = b[0].meta.changes === 1
  const stampOk = b[1].meta.changes === 1

  // STRICT: success requires BOTH transitions to have changed exactly one row.
  if (resetOk && stampOk) {
    await auditReplay(env, request, userId, 'info', { outcome: 'replayed', dlq_id: dlqId, event_id: dlqRow.event_id, stream_key_hash: skHash, dlq_reason: dlqRow.dlq_reason })
    return res({ ok: true, dlq_id: dlqId, event_id: dlqRow.event_id }, 200)
  }
  await auditReplay(env, request, userId, 'warn', { outcome: 'noop', dlq_id: dlqId, event_id: dlqRow.event_id, stream_key_hash: skHash, reset: resetOk, stamped: stampOk })
  return res({ error: 'Already replayed, or the outbox event is not dead', code: 'ALREADY_REPLAYED_OR_NOT_DEAD' }, 409)
}
