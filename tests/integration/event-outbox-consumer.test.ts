/**
 * PR5 5b consumer (functions/api/admin/cron/event-outbox.ts). Drives the cron handler directly with a Bearer
 * header (like the audit-archive cron tests) against seeded event_outbox rows, and asserts the outbox / projection
 * / DLQ state machine: contiguous delivery, gap -> DLQ, idempotent noop, poison -> DLQ, crash recovery (expired
 * 'processing' with attempts<MAX reclaimed), max-attempt sweep, and G3 (overlapping sweeps -> exactly one DLQ).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers'
import { onRequestPost } from '../../functions/api/admin/cron/event-outbox'

const db = env.chiyigo_db
beforeEach(async () => {
  await resetDb()
  env.EVENT_OUTBOX_MAX_ATTEMPTS = '2'      // small MAX so the sweep is easy to hit
  env.EVENT_OUTBOX_RETRY_BACKOFF_S = '0'   // immediate retry in tests
  env.EVENT_OUTBOX_LEASE_SECONDS = '120'
})
afterEach(() => { vi.restoreAllMocks() })

let _e = 0
const PAST = '2020-01-01 00:00:00'
async function seedOutbox(o: {
  streamKey: string; seq: number; eventType?: string; data?: Record<string, unknown>; tenantId?: number | null
  status?: string; attempts?: number; lockedBy?: string | null; leaseUntil?: string | null; nextAttemptAt?: string
}): Promise<void> {
  await db.prepare(
    `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, tenant_id, actor_sub, occurred_at, data_json, status, attempts, next_attempt_at, lease_until, locked_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    `ev-${_e++}`, o.eventType ?? 'member.suspended', o.streamKey, o.seq, o.tenantId ?? 1, 'actor', '2026-06-02T00:00:00Z',
    JSON.stringify(o.data ?? { sub: '42', previousRole: 'member' }), o.status ?? 'pending', o.attempts ?? 0,
    o.nextAttemptAt ?? PAST, o.leaseUntil ?? null, o.lockedBy ?? null,
  ).run()
}
async function seedProjection(streamKey: string, lastAppliedSeq: number, denied = 0): Promise<void> {
  await db.prepare(`INSERT INTO event_deny_state (stream_key, event_type, deny_effect, denied, tenant_id, last_applied_seq) VALUES (?, 'member.suspended', 'deny', ?, 1, ?)`).bind(streamKey, denied, lastAppliedSeq).run()
}
interface ConsumerReport { swept: number; claimed: number; delivered: number; noop: number; retried: number; dlq: number; gap: number; fenced: number; blocked_backlog: number; oldest_blocked_age_s: number; dlq_unreplayed: number; errors: unknown[] }
async function runConsumer(): Promise<{ status: number; report: ConsumerReport }> {
  const req = new Request('http://x/api/admin/cron/event-outbox', { method: 'POST', headers: { Authorization: 'Bearer test-cron-secret', 'Content-Type': 'application/json' } })
  const resp = await onRequestPost({ request: req, env })
  return { status: resp.status, report: (await resp.json()) as ConsumerReport }
}
// EVT-001: read the latest consumer_run audit (severity + parsed data) to assert the standing-state warn signal.
async function consumerRunAudit(): Promise<{ severity: string; data: Record<string, unknown> } | null> {
  const r = await db.prepare(`SELECT severity, event_data FROM audit_log WHERE event_type='domain.event.consumer_run' ORDER BY id DESC LIMIT 1`).first<{ severity: string; event_data: string }>()
  return r ? { severity: r.severity, data: JSON.parse(r.event_data) } : null
}
async function proj(streamKey: string) { return db.prepare(`SELECT denied, last_applied_seq FROM event_deny_state WHERE stream_key=?`).bind(streamKey).first<{ denied: number; last_applied_seq: number }>() }
async function outbox(streamKey: string, seq: number) { return db.prepare(`SELECT status, attempts FROM event_outbox WHERE stream_key=? AND stream_seq=?`).bind(streamKey, seq).first<{ status: string; attempts: number }>() }
async function dlqCount(reason?: string): Promise<number> {
  const q = reason ? db.prepare(`SELECT COUNT(*) AS c FROM event_dlq WHERE dlq_reason=?`).bind(reason) : db.prepare(`SELECT COUNT(*) AS c FROM event_dlq`)
  return Number((await q.first<{ c: number }>())!.c)
}

const K = 'tenant:1:member:42'

describe('[PR5-5b] event outbox consumer', () => {
  it('rejects without the CRON_SECRET bearer (401)', async () => {
    const req = new Request('http://x/api/admin/cron/event-outbox', { method: 'POST' })
    expect((await onRequestPost({ request: req, env })).status).toBe(401)
  })

  it('happy: delivers a pending event -> done + projection applied (deny -> denied=1, seq+1); attempts==1', async () => {
    await seedOutbox({ streamKey: K, seq: 1 })
    const { status, report } = await runConsumer()
    expect(status).toBe(200)
    expect(report.delivered).toBe(1)
    expect(await outbox(K, 1)).toEqual({ status: 'done', attempts: 1 }) // claim incremented once
    expect(await proj(K)).toEqual({ denied: 1, last_applied_seq: 1 })
  })

  it('CONTIGUITY: with seq 1 + seq 2 pending, run 1 delivers only seq 1 (seq 2 head-of-line blocked); run 2 delivers seq 2', async () => {
    await seedOutbox({ streamKey: K, seq: 1 })
    await seedOutbox({ streamKey: K, seq: 2, eventType: 'member.reactivated', data: { sub: '42', platformRole: 'member' } })
    const r1 = await runConsumer()
    expect(r1.report.claimed).toBe(1)
    expect((await outbox(K, 2))!.status).toBe('pending')   // blocked while seq 1 not done
    const r2 = await runConsumer()
    expect(r2.report.delivered).toBe(1)
    expect((await outbox(K, 2))!.status).toBe('done')
    expect(await proj(K)).toEqual({ denied: 0, last_applied_seq: 2 }) // reactivated -> undeny
  })

  it('GAP: a seq > last_applied+1 (no predecessor in outbox) -> DLQ(gap_detected), projection unchanged', async () => {
    await seedProjection(K, 1, 1)             // projection at seq 1, denied
    await seedOutbox({ streamKey: K, seq: 3 }) // seq 3, no seq 2 -> claimable, but a gap at delivery
    const { report } = await runConsumer()
    expect(report.gap).toBe(1)
    expect(await dlqCount('gap_detected')).toBe(1)
    expect((await outbox(K, 3))!.status).toBe('dead')
    expect(await proj(K)).toEqual({ denied: 1, last_applied_seq: 1 }) // untouched
  })

  it('IDEMPOTENT: a seq <= last_applied -> noop, marked done, projection unchanged', async () => {
    await seedProjection(K, 2, 1)
    await seedOutbox({ streamKey: K, seq: 2 })
    const { report } = await runConsumer()
    expect(report.noop).toBe(1)
    expect((await outbox(K, 2))!.status).toBe('done')
    expect(await proj(K)).toEqual({ denied: 1, last_applied_seq: 2 })
  })

  it('POISON: an invalid data_json -> DLQ(validation_failed), not retried', async () => {
    await seedOutbox({ streamKey: K, seq: 1, data: { sub: '42' } }) // missing required previousRole -> reconstruct fails
    const { report } = await runConsumer()
    expect(report.dlq).toBe(1)
    expect(await dlqCount('validation_failed')).toBe(1)
    expect((await outbox(K, 1))!.status).toBe('dead')
  })

  it('CRASH RECOVERY (C1): an expired processing row with attempts<MAX is RE-CLAIMED and completes', async () => {
    await seedOutbox({ streamKey: K, seq: 1, status: 'processing', lockedBy: 'crashed-run', leaseUntil: PAST, attempts: 1 })
    const { report } = await runConsumer()
    expect(report.claimed).toBe(1)
    expect(report.delivered).toBe(1)
    expect(await outbox(K, 1)).toEqual({ status: 'done', attempts: 2 }) // reclaim incremented once (1 -> 2)
  })

  it('MAX-ATTEMPT SWEEP: an expired processing row with attempts>=MAX -> swept to DLQ(max_attempts)', async () => {
    await seedOutbox({ streamKey: K, seq: 1, status: 'processing', lockedBy: 'dead-run', leaseUntil: PAST, attempts: 2 })
    const { report } = await runConsumer()
    expect(report.swept).toBe(1)
    expect(await dlqCount('max_attempts')).toBe(1)
    expect((await outbox(K, 1))!.status).toBe('dead')
  })

  it('G3: two overlapping sweeps of one exhausted row -> exactly ONE DLQ row', async () => {
    await seedOutbox({ streamKey: K, seq: 1, status: 'processing', lockedBy: 'dead-run', leaseUntil: PAST, attempts: 2 })
    await runConsumer()
    await runConsumer() // second sweep finds it already 'dead' -> no second DLQ
    expect(await dlqCount()).toBe(1)
  })

  // F-R3-1 fencing (G1/G2) + transient retry. A real owner-CAS / projection-CAS loss is a TOCTOU only a SECOND
  // overlapping consumer can create; here we inject ONE concurrent write immediately before this run's apply batch
  // (mockImplementationOnce on the real binding's .batch, then call through) to force that exact race deterministically.
  it('G1 FENCING: a worker that lost its lock (owner-CAS 0-row) cannot mark its row done -> fenced++, no stomp', async () => {
    await seedOutbox({ streamKey: K, seq: 1 })
    const realBatch = db.batch.bind(db)
    vi.spyOn(db, 'batch').mockImplementationOnce(async (stmts) => {
      // another run steals the lock between this run's prior-read and its apply batch
      await db.prepare(`UPDATE event_outbox SET locked_by='intruder-run' WHERE stream_key=? AND stream_seq=1`).bind(K).run()
      return realBatch(stmts)
    })
    const { report } = await runConsumer()
    expect(report.fenced).toBe(1)
    expect(report.delivered).toBe(0)
    const row = await db.prepare(`SELECT status, locked_by FROM event_outbox WHERE stream_key=? AND stream_seq=1`).bind(K).first<{ status: string; locked_by: string }>()
    expect(row).toEqual({ status: 'processing', locked_by: 'intruder-run' }) // the fenced worker did NOT stomp the row to done
  })

  it('G2 FENCING: projection CAS 0-row -> gated mark-done suppressed -> fenced++, no double-apply', async () => {
    await seedOutbox({ streamKey: K, seq: 1 })
    const realBatch = db.batch.bind(db)
    vi.spyOn(db, 'batch').mockImplementationOnce(async (stmts) => {
      // a concurrent consumer applies seq 1 to the projection between this run's prior-read (priorSeq=0) and its
      // apply batch, so the projection upsert CAS (WHERE last_applied_seq=0) loses and its changes()=0 gates mark-done off
      await db.prepare(`INSERT INTO event_deny_state (stream_key, event_type, deny_effect, denied, tenant_id, last_applied_seq) VALUES (?, 'member.suspended', 'deny', 1, 1, 1)`).bind(K).run()
      return realBatch(stmts)
    })
    const { report } = await runConsumer()
    expect(report.fenced).toBe(1)
    expect(report.delivered).toBe(0)
    expect((await outbox(K, 1))!.status).toBe('processing')      // gated mark-done suppressed -> re-delivered later as noop
    expect(await proj(K)).toEqual({ denied: 1, last_applied_seq: 1 }) // applied exactly once (the concurrent winner), not doubled
  })

  it('TRANSIENT retry: a delivery fault -> pending+backoff (retried; attempts intact), then eventual done', async () => {
    await seedOutbox({ streamKey: K, seq: 1 })
    vi.spyOn(db, 'batch').mockImplementationOnce(async () => { throw new Error('transient db fault') })
    const r1 = await runConsumer()
    expect(r1.report.retried).toBe(1)
    expect(r1.report.delivered).toBe(0)
    expect(await outbox(K, 1)).toEqual({ status: 'pending', attempts: 1 }) // re-enqueued; attempts unchanged (claim-time only, B3)
    vi.restoreAllMocks()
    const r2 = await runConsumer() // backoff=0 -> immediately reclaimable
    expect(r2.report.delivered).toBe(1)
    expect(await outbox(K, 1)).toEqual({ status: 'done', attempts: 2 })
    expect(await proj(K)).toEqual({ denied: 1, last_applied_seq: 1 })
  })

  // EVT-002: a transient fault on the PRIOR-READ (outside the old apply try/catch) must go to failTransition
  // (retry+backoff), NOT escape to the per-row catch as an orphaned 'processing' row that burns the retry budget.
  it('EVT-002: prior-read transient fault -> failTransition retry (pending), NOT orphaned processing', async () => {
    await seedOutbox({ streamKey: K, seq: 1 })
    const realPrepare = db.prepare.bind(db)
    // Throw ONLY for the deliver() prior-read; pass every other prepare through to the real DB.
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT last_applied_seq, denied FROM event_deny_state')) {
        throw new Error('transient d1 fault on prior-read')
      }
      return realPrepare(sql)
    })
    const r1 = await runConsumer()
    vi.restoreAllMocks()
    // post-fix: routed through failTransition -> retried, re-enqueued pending, NO orphan error.
    // pre-fix RED: report.retried===0, errors.length===1, the row stuck in 'processing'.
    expect(r1.report.retried).toBe(1)
    expect(r1.report.errors.length).toBe(0)
    expect(await outbox(K, 1)).toEqual({ status: 'pending', attempts: 1 })
    // and it remains deliverable (never mis-DLQ'd): next run delivers it cleanly.
    const r2 = await runConsumer()
    expect(r2.report.delivered).toBe(1)
    expect(await dlqCount('max_attempts')).toBe(0)
    expect(await proj(K)).toEqual({ denied: 1, last_applied_seq: 1 })
  })

  // EVT-001: a stream blocked behind a dead (poison) predecessor is surfaced on EVERY run via blocked_backlog +
  // a warn consumer_run audit, not just the run that first DLQ'd it.
  it('EVT-001: blocked-behind-dead backlog surfaces a standing warn signal every run', async () => {
    await seedOutbox({ streamKey: K, seq: 1, data: {} })          // poison: missing required fields -> validation_failed
    await seedOutbox({ streamKey: K, seq: 2 })                    // valid successor, head-of-line blocked behind seq 1
    const r1 = await runConsumer()
    expect(r1.report.dlq).toBe(1)
    expect((await outbox(K, 1))!.status).toBe('dead')
    expect(r1.report.blocked_backlog).toBe(1)
    expect(r1.report.oldest_blocked_age_s).toBeGreaterThanOrEqual(0)
    expect(r1.report.dlq_unreplayed).toBe(1)
    const a1 = await consumerRunAudit()
    expect(a1?.severity).toBe('warn')
    expect(a1?.data.blocked_backlog).toBe(1)

    // a LATER run that DLQs nothing new still reports the blocked stream as a standing warn (the EVT-001 point).
    const r2 = await runConsumer()
    expect(r2.report.dlq).toBe(0)
    expect(r2.report.claimed).toBe(0)            // seq 2 stays head-of-line blocked
    expect(r2.report.blocked_backlog).toBe(1)
    const a2 = await consumerRunAudit()
    expect(a2?.severity).toBe('warn')            // still warn, not back to info
  })

  // EVT-001: a clean run with no DLQ and no blocked stream stays info (no false alarm).
  it('EVT-001: clean run -> info severity, blocked_backlog 0', async () => {
    await seedOutbox({ streamKey: K, seq: 1 })
    const r = await runConsumer()
    expect(r.report.delivered).toBe(1)
    expect(r.report.blocked_backlog).toBe(0)
    expect(r.report.dlq_unreplayed).toBe(0)
    const a = await consumerRunAudit()
    expect(a?.severity).toBe('info')
  })
})
