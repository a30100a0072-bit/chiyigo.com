/**
 * POST /api/admin/cron/event-outbox
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * PR5 5b consumer (plan sections 5-6 / master 9.3). Drains event_outbox into the INTERNAL event_deny_state
 * projection. Order: STEP A max-attempt sweep -> STEP B claim -> STEP C deliver.
 *
 * Fencing invariant F-R3-1 (5a-spike-proven changes()/CAS semantics, local + remote D1):
 *   G1 every worker transition processing -> {done,pending,dead} carries OWNER-CAS
 *      `id=? AND status='processing' AND locked_by=<runToken>`. A stale worker (re-claimed by another run ->
 *      locked_by overwritten) 0-rows and is fenced out (counted in report.fenced).
 *   G2 mark-done is in ONE atomic batch with the projection upsert and gated on the upsert ACTUALLY applying
 *      (`AND changes()=1`). A stale/lost projection CAS -> not marked done -> re-delivered.
 *   G3 every DLQ write is db.batch([UPDATE outbox->dead (CAS), INSERT event_dlq SELECT ... WHERE changes()=1]),
 *      so overlapping runs/sweeps write exactly ONE dlq row.
 * The sweep (reaps ABANDONED rows) uses a status+lease+attempts CAS, not owner-CAS.
 *
 * Audit/redaction: every domain.event.* audit logs stream_key_hash (sha256), NEVER the raw stream_key/data_json.
 * Cron trigger: .github/workflows/cron-event-outbox.yml (every 5 min).
 */
import { res } from '../../../utils/auth'
import { safeUserAudit } from '../../../utils/user-audit'
import { hashToken } from '../../../utils/crypto'
import { buildDomainEvent, type DomainEvent, type DomainEventType } from '../../../utils/domain-events'
import { projectionDecision, type DenyBit } from '../../../utils/deny-state-projection'

type ChiyigoDb = Env['chiyigo_db']

interface OutboxRow {
  id: number; event_id: string; event_type: string; stream_key: string; stream_seq: number
  tenant_id: number | null; actor_sub: string | null; occurred_at: string; data_json: string
  attempts: number; last_error: string | null
}

interface RunReport {
  run_id: string
  swept: number; claimed: number; delivered: number; noop: number
  retried: number; dlq: number; gap: number; fenced: number
  errors: { event_id: string; message: string }[]
}

// ── env knobs (master 9.3 defaults) ─────────────────────────────────────────────
function posInt(v: unknown, dflt: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt
}
// retry backoff in SECONDS; env override (CSV) for tests (e.g. "0,0,0" = immediate retry).
function backoffSeconds(env: Env): number[] {
  const raw = String(env.EVENT_OUTBOX_RETRY_BACKOFF_S ?? '').trim()
  if (!raw) return [60, 300, 1800, 7200, 43200, 86400] // 1m,5m,30m,2h,12h,24h
  const parts = raw.split(',').map((s) => Number(s.trim()))
  return parts.some((n) => !Number.isFinite(n) || n < 0) ? [60] : parts
}

async function auditEvent(
  env: Env, eventType: string, severity: 'info' | 'warn' | 'critical', row: OutboxRow, extra: Record<string, unknown> = {},
): Promise<void> {
  // REDACTION: stream_key_hash + eventId/eventType/seq only -- NEVER raw stream_key or data_json.
  await safeUserAudit(env, {
    event_type: eventType,
    severity,
    data: { event_id: row.event_id, event_type: row.event_type, stream_key_hash: await hashToken(row.stream_key), stream_seq: row.stream_seq, ...extra },
  })
}

const OUTBOX_COLS = `id, event_id, event_type, stream_key, stream_seq, tenant_id, actor_sub, occurred_at, data_json, attempts, last_error`

// ── STEP A: max-attempt sweep (reaps abandoned rows; status+lease+attempts CAS; G3 gated dlq) ───────────────
async function sweepExhausted(db: ChiyigoDb, env: Env, max: number, report: RunReport): Promise<void> {
  const rows = ((await db.prepare(
    `SELECT ${OUTBOX_COLS} FROM event_outbox WHERE status='processing' AND lease_until < datetime('now') AND attempts >= ?`,
  ).bind(max).all<OutboxRow>()).results) ?? []
  for (const r of rows) {
    const b = await db.batch([
      db.prepare(`UPDATE event_outbox SET status='dead' WHERE id=? AND status='processing' AND lease_until < datetime('now') AND attempts >= ?`).bind(r.id, max),
      db.prepare(
        `INSERT INTO event_dlq (event_id,event_type,stream_key,stream_seq,tenant_id,actor_sub,occurred_at,data_json,dlq_reason,attempts,last_error)
         SELECT ?,?,?,?,?,?,?,?,'max_attempts',?,? WHERE changes()=1`,
      ).bind(r.event_id, r.event_type, r.stream_key, r.stream_seq, r.tenant_id, r.actor_sub, r.occurred_at, r.data_json, r.attempts, r.last_error),
    ])
    if (b[0].meta.changes === 1) { report.swept++; report.dlq++; await auditEvent(env, 'domain.event.dlq', 'critical', r, { dlq_reason: 'max_attempts', attempts: r.attempts }) }
  }
}

// ── STEP B: claim (attempts++ at claim ONLY; explicit predicate incl. EXPIRED processing < MAX; contiguity) ──
async function claim(db: ChiyigoDb, runToken: string, max: number, leaseSecs: number, limit: number): Promise<OutboxRow[]> {
  await db.prepare(
    `UPDATE event_outbox SET status='processing', locked_by=?, lease_until=datetime('now', ?), attempts=attempts+1
      WHERE id IN (
        SELECT o.id FROM event_outbox o
        WHERE ( (o.status='pending'    AND o.next_attempt_at <= datetime('now'))
             OR (o.status='processing' AND o.lease_until     <  datetime('now')) )
          AND o.attempts < ?
          AND NOT EXISTS (SELECT 1 FROM event_outbox e
                            WHERE e.stream_key = o.stream_key AND e.stream_seq < o.stream_seq AND e.status <> 'done')
        ORDER BY o.id ASC LIMIT ?)`,
  ).bind(runToken, `+${leaseSecs} seconds`, max, limit).run()
  return ((await db.prepare(
    `SELECT ${OUTBOX_COLS} FROM event_outbox WHERE locked_by=? AND status='processing' ORDER BY stream_key, stream_seq`,
  ).bind(runToken).all<OutboxRow>()).results) ?? []
}

// ── G3 DLQ transition (owner-CAS on outbox->dead, gated dlq insert) ─────────────────────────────────────────
async function dlqTransition(db: ChiyigoDb, env: Env, row: OutboxRow, runToken: string, reason: string, lastError: string | null, report: RunReport): Promise<void> {
  const b = await db.batch([
    db.prepare(`UPDATE event_outbox SET status='dead', lease_until=NULL, last_error=? WHERE id=? AND status='processing' AND locked_by=?`).bind(lastError, row.id, runToken),
    db.prepare(
      `INSERT INTO event_dlq (event_id,event_type,stream_key,stream_seq,tenant_id,actor_sub,occurred_at,data_json,dlq_reason,attempts,last_error)
       SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1`,
    ).bind(row.event_id, row.event_type, row.stream_key, row.stream_seq, row.tenant_id, row.actor_sub, row.occurred_at, row.data_json, reason, row.attempts, lastError),
  ])
  if (b[0].meta.changes === 1) {
    report.dlq++
    if (reason === 'gap_detected') report.gap++
    await auditEvent(env, reason === 'gap_detected' ? 'domain.event.gap_detected' : reason === 'validation_failed' ? 'domain.event.validation_failed' : 'domain.event.dlq', 'critical', row, { dlq_reason: reason, attempts: row.attempts })
  } else {
    report.fenced++ // owner-CAS lost (another run/sweep already moved it)
  }
}

// transient delivery failure: retry (owner-CAS) or DLQ if at MAX. attempts is the post-claim count.
async function failTransition(db: ChiyigoDb, env: Env, row: OutboxRow, runToken: string, max: number, backoff: number[], lastError: string, report: RunReport): Promise<void> {
  if (row.attempts >= max) { await dlqTransition(db, env, row, runToken, 'max_attempts', lastError, report); return }
  const secs = backoff[Math.min(row.attempts - 1, backoff.length - 1)] ?? backoff[backoff.length - 1]
  const r = await db.prepare(
    `UPDATE event_outbox SET status='pending', next_attempt_at=datetime('now', ?), last_error=?, lease_until=NULL, locked_by=NULL
      WHERE id=? AND status='processing' AND locked_by=?`,
  ).bind(`+${secs} seconds`, lastError.slice(0, 1000), row.id, runToken).run()
  if (r.meta.changes === 1) { report.retried++; await auditEvent(env, 'domain.event.retry', 'warn', row, { attempts: row.attempts, next_in_seconds: secs }) }
  else report.fenced++
}

// ── STEP C: deliver one claimed row (OWNER-CAS on every transition; G2 mark-done gating) ────────────────────
async function deliver(db: ChiyigoDb, env: Env, row: OutboxRow, runToken: string, max: number, backoff: number[], report: RunReport): Promise<void> {
  // reconstruct + re-validate via the FROZEN contract (defense in depth); a corrupt row is poison -> DLQ.
  let event: DomainEvent
  try {
    const data = JSON.parse(row.data_json) as Record<string, unknown>
    event = buildDomainEvent(row.event_type as DomainEventType, { tenantId: row.tenant_id, actorSub: row.actor_sub, data }, { eventId: row.event_id, streamSeq: row.stream_seq, occurredAt: row.occurred_at })
    if (event.streamKey !== row.stream_key) throw new Error('stream_key mismatch') // tamper/corruption guard
  } catch {
    await dlqTransition(db, env, row, runToken, 'validation_failed', 'reconstruct/validate failed', report)
    return
  }

  const prior = await db.prepare(`SELECT last_applied_seq, denied FROM event_deny_state WHERE stream_key=?`).bind(row.stream_key).first<{ last_applied_seq: number; denied: number }>()
  const priorSeq = prior ? prior.last_applied_seq : 0
  const priorDenied: DenyBit = prior && prior.denied === 1 ? 1 : 0
  const decision = projectionDecision(event, priorSeq, priorDenied)

  if (decision.kind === 'gap') { await dlqTransition(db, env, row, runToken, 'gap_detected', `gap: expected ${decision.expected}, got ${row.stream_seq}`, report); return }

  if (decision.kind === 'noop') { // already applied -> just finalize (owner-CAS)
    const r = await db.prepare(`UPDATE event_outbox SET status='done', processed_at=datetime('now'), lease_until=NULL WHERE id=? AND status='processing' AND locked_by=?`).bind(row.id, runToken).run()
    if (r.meta.changes === 1) { report.noop++; await auditEvent(env, 'domain.event.delivered', 'info', row, { idempotent: true }) }
    else report.fenced++
    return
  }

  // apply: ONE atomic batch -> projection upsert (CAS on last_applied_seq) + mark-done (owner-CAS AND changes()=1).
  try {
    const b = await db.batch([
      db.prepare(
        `INSERT INTO event_deny_state (stream_key, event_type, deny_effect, denied, tenant_id, last_applied_seq)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(stream_key) DO UPDATE SET
           event_type=excluded.event_type, deny_effect=excluded.deny_effect, denied=excluded.denied,
           tenant_id=excluded.tenant_id, last_applied_seq=excluded.last_applied_seq, updated_at=datetime('now')
         WHERE event_deny_state.last_applied_seq = ?`,
      ).bind(row.stream_key, event.eventType, decision.denyEffect, decision.denied, row.tenant_id, event.streamSeq, priorSeq),
      db.prepare(`UPDATE event_outbox SET status='done', processed_at=datetime('now'), lease_until=NULL WHERE id=? AND status='processing' AND locked_by=? AND changes()=1`).bind(row.id, runToken),
    ])
    if (b[1].meta.changes === 1) { report.delivered++; await auditEvent(env, 'domain.event.delivered', 'info', row, { denied: decision.denied }) }
    else report.fenced++ // owner-CAS lost (stale worker; projection may have advanced -> new owner converges via noop) OR projection CAS 0-row (G2)
  } catch (e) {
    await failTransition(db, env, row, runToken, max, backoff, String((e as { message?: unknown })?.message ?? e), report)
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? ''
  const expected = env.CRON_SECRET
  if (!expected) return res({ error: 'CRON_SECRET not configured', code: 'CRON_SECRET_NOT_CONFIGURED' }, 500)
  if (auth !== `Bearer ${expected}`) return res({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)
  const db = env.chiyigo_db
  if (!db) return res({ error: 'chiyigo_db binding missing', code: 'INTERNAL_ERROR' }, 500)

  const max = posInt(env.EVENT_OUTBOX_MAX_ATTEMPTS, 6)
  const leaseSecs = posInt(env.EVENT_OUTBOX_LEASE_SECONDS, 120)
  const limit = posInt(env.EVENT_OUTBOX_CLAIM_LIMIT, 50)
  const backoff = backoffSeconds(env)
  const runToken = crypto.randomUUID()
  const report: RunReport = { run_id: runToken, swept: 0, claimed: 0, delivered: 0, noop: 0, retried: 0, dlq: 0, gap: 0, fenced: 0, errors: [] }

  await sweepExhausted(db, env, max, report)
  const claimed = await claim(db, runToken, max, leaseSecs, limit)
  report.claimed = claimed.length
  for (const row of claimed) {
    try { await deliver(db, env, row, runToken, max, backoff, report) }
    catch (e) { report.errors.push({ event_id: row.event_id, message: String((e as { message?: unknown })?.message ?? e) }) }
  }

  // run report audit -- COUNTS ONLY, no streamKeys.
  await safeUserAudit(env, {
    event_type: 'domain.event.consumer_run',
    severity: report.dlq > 0 ? 'warn' : 'info',
    data: { run_id: report.run_id, swept: report.swept, claimed: report.claimed, delivered: report.delivered, noop: report.noop, retried: report.retried, dlq: report.dlq, gap: report.gap, fenced: report.fenced, errors: report.errors.length },
  })
  return res(report, report.errors.length ? 500 : 200)
}
