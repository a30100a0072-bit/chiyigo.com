/**
 * F-3 Phase 2 PR 3.1 — debug aggregate worker 整合測試
 *
 * 覆蓋（與 PR 3.0 telemetry 對齊 + reservoir/采樣專屬 case）：
 *   1. happy path：4 row 2 (event_type, reason_code) 分群 → 2 bucket 各 2 count
 *   2. idempotent：連跑兩次 → bucket total_count 不疊 + samples_json 完全一致
 *   3. cutoff 過濾（89 天 inside hot vs 89-1h outside cutoff）
 *   4. cutoff 同日 +1h 在 hot 內必排除（boundary regression）
 *   5. archived_at IS NOT NULL → 不撈
 *   6. cold_class drift → fail-fast critical
 *   7. no_rows_eligible → 200 + run_skipped
 *   8. hot_days_disabled (env=0) → 200 + run_skipped
 *   9. cutoff_hours_collapsed → 200 + run_skipped 不同 reason
 *  10. rows_exceed_max → fail + critical
 *  11. auth 401 / CRON_SECRET 缺 500
 *  12. reservoir sample_count=10 + sampled=1 + samples_json id 是 candidate 子集
 *  13. reason_code NULL bucket + reason_code 不同分 bucket
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers.js'
import { onRequestPost as cronAggregateDebug } from '../../functions/api/admin/cron/audit-aggregate-debug'

const CRON_SECRET = 'test-cron-secret'
const ARCHIVE_ENV = 'test'

function makeRequest(auth = `Bearer ${CRON_SECRET}`) {
  return new Request('http://test/api/admin/cron/audit-aggregate-debug', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  })
}

function makeEnv(overrides = {}) {
  return {
    ...env,
    CRON_SECRET,
    ARCHIVE_ENV,
    // debug_failure default hotDays=90、leadHours=24 → cutoff = now-89d
    ...overrides,
  }
}

// PR-41 inline TS: 同 audit-aggregate.test.ts runCron pattern。
async function runCron(overrides?: Record<string, unknown>) {
  const r = await cronAggregateDebug({ request: makeRequest(), env: makeEnv(overrides) })
  return { status: r.status, body: (await r.json()) as Record<string, unknown> }
}

async function seed(over = {}) {
  const o = {
    event_type: 'payment.webhook.fail',
    severity:   'critical',
    user_id:    null,
    ip_hash:    null,
    event_data: JSON.stringify({ reason_code: 'webhook_parse_failed' }),
    cold_class: 'debug_failure',
    archived_at: null,
    created_at: "datetime('now','-89 days','-1 hours')",
    ...over,
  }
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data,
                            cold_class, archived_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${o.created_at})`
  ).bind(o.event_type, o.severity, o.user_id, o.ip_hash, o.event_data,
         o.cold_class, o.archived_at).run()
}

async function listBuckets() {
  const r = await env.chiyigo_db.prepare(
    `SELECT event_type, reason_code, hour_bucket, total_count, sample_count,
            samples_json, sampled
       FROM audit_log_aggregate_debug
      ORDER BY hour_bucket ASC, event_type ASC, COALESCE(reason_code,'') ASC`
  ).all()
  // PR-41 inline TS: 同 audit-aggregate.test.ts listBuckets pattern。
  return (r.results ?? []) as Record<string, unknown>[]
}

async function listAuditEvents() {
  const r = await env.chiyigo_db.prepare(
    `SELECT event_type, severity, event_data FROM audit_log
      WHERE event_type LIKE 'audit.aggregate.debug.%'
      ORDER BY id ASC`
  ).all()
  return r.results ?? []
}

beforeEach(async () => {
  await resetDb()
})

describe('audit-aggregate-debug cron — happy path', () => {
  it('Step 1：4 row 2 reason_code → 2 bucket 各 2 count', async () => {
    const t = "datetime('now','-89 days','-1 hours')"
    await seed({ event_data: JSON.stringify({ reason_code: 'webhook_parse_failed' }),  created_at: t })
    await seed({ event_data: JSON.stringify({ reason_code: 'webhook_parse_failed' }),  created_at: t })
    await seed({ event_data: JSON.stringify({ reason_code: 'in_flight_conflict' }), created_at: t })
    await seed({ event_data: JSON.stringify({ reason_code: 'in_flight_conflict' }), created_at: t })

    const { status, body } = await runCron()
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.rows_scanned).toBe(4)
    expect(body.buckets_upserted).toBe(2)
    expect(body.samples_total).toBe(4)
    expect(body.skipped_reason).toBeNull()
    expect(body.cold_class).toBe('debug_failure')

    const rows = await listBuckets()
    expect(rows).toHaveLength(2)
    const byReason = new Map(rows.map(r => [r.reason_code, r]))
    expect(byReason.get('webhook_parse_failed').total_count).toBe(2)
    expect(byReason.get('webhook_parse_failed').sample_count).toBe(2)
    expect(byReason.get('webhook_parse_failed').sampled).toBe(0)
    expect(byReason.get('in_flight_conflict').total_count).toBe(2)

    const events = await listAuditEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('audit.aggregate.debug.run_completed')
    const data = JSON.parse(events[0].event_data)
    expect(data.rows_scanned).toBe(4)
    expect(data.buckets_upserted).toBe(2)
    expect(data.samples_total).toBe(4)
  })

  it('Step 2：idempotent — 連跑兩次 total_count + samples_json 完全一致', async () => {
    // literal 時戳保證 hour_bucket / samples priority 完全 deterministic
    const t = "'2025-02-15 12:00:00'"
    await seed({ created_at: t })
    await seed({ created_at: t })
    await seed({ created_at: t })

    await runCron()
    const after1 = await listBuckets()
    expect(after1).toHaveLength(1)
    expect(after1[0].total_count).toBe(3)
    const samples1 = after1[0].samples_json

    await runCron()
    const after2 = await listBuckets()
    expect(after2).toHaveLength(1)
    expect(after2[0].total_count).toBe(3)
    expect(after2[0].samples_json).toBe(samples1)  // deterministic reservoir
  })

  it('Step 3：cutoff 過濾 — 88 天 (hot 內) 不撈，89 天前撈', async () => {
    await seed({ created_at: "datetime('now','-88 days')" })  // cutoff 外（hot 內）
    await seed({ created_at: "datetime('now','-89 days','-2 hours')" })  // cutoff 內

    const { body } = await runCron()
    expect(body.rows_scanned).toBe(1)
    expect(body.buckets_upserted).toBe(1)
  })

  it('Step 3b：boundary — cutoff 同日 +1h（hot 內）必排除', async () => {
    // 防 ISO 'T' vs SQLite space lex-compare bug，與 PR 3.0 同 case
    await seed({ created_at: "datetime('now','-89 days','+1 hours')" })  // 應排除
    await seed({ created_at: "datetime('now','-89 days','-1 hours')" })  // 應納入

    const { body } = await runCron()
    expect(body.ok).toBe(true)
    expect(body.rows_scanned).toBe(1)
  })

  it('Step 4：archived_at IS NOT NULL → 不撈', async () => {
    await seed({
      created_at: "datetime('now','-89 days','-1 hours')",
      archived_at: '2026-01-01T00:00:00Z',
    })
    const { body } = await runCron()
    expect(body.rows_scanned).toBe(0)
    expect(body.skipped_reason).toBe('no_rows_eligible')
  })

  it('reservoir：seed 15 row 同 bucket → sample_count=10 + sampled=1', async () => {
    // 用 literal 時戳避 wall-clock 跨小時邊界 + 確保 id 不同
    const base = "'2025-02-15 12:00:00'"
    for (let i = 0; i < 15; i++) {
      await seed({ created_at: base })
    }
    const { body } = await runCron()
    expect(body.rows_scanned).toBe(15)
    expect(body.buckets_upserted).toBe(1)

    const rows = await listBuckets()
    expect(rows).toHaveLength(1)
    expect(rows[0].total_count).toBe(15)
    expect(rows[0].sample_count).toBe(10)
    expect(rows[0].sampled).toBe(1)
    const samples = JSON.parse(rows[0].samples_json as string)
    expect(samples).toHaveLength(10)
    // samples id 應是 audit_log 中 cold_class='debug_failure' 的 row id 子集
    const candIds = (await env.chiyigo_db.prepare(
      `SELECT id FROM audit_log WHERE cold_class='debug_failure'`
    ).all()).results.map(r => r.id)
    for (const s of samples) expect(candIds).toContain(s.id)
  })

  it('reason_code 缺 → null bucket（UNIQUE COALESCE("") sentinel）', async () => {
    const t = "'2025-02-15 12:00:00'"
    await seed({ event_data: '{}', created_at: t })
    await seed({ event_data: '{}', created_at: t })

    const { body } = await runCron()
    expect(body.buckets_upserted).toBe(1)
    const rows = await listBuckets()
    expect(rows[0].reason_code).toBeNull()
    expect(rows[0].total_count).toBe(2)
  })
})

describe('audit-aggregate-debug cron — drift / 失敗路徑', () => {
  it('cold_class drift → critical + ok=false + skipped_reason', async () => {
    // event_type 不在 DEBUG_FAILURE list 但被誤標 cold_class='debug_failure'
    await seed({
      event_type: 'account.register',
      severity:   'info',
      cold_class: 'debug_failure',
      created_at: "datetime('now','-89 days','-1 hours')",
    })

    const { status, body } = await runCron()
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.skipped_reason).toBe('cold_class_drift_detected')

    const events = await listAuditEvents()
    const failed = events.find(e => e.event_type === 'audit.aggregate.debug.run_failed')
    expect(failed).toBeDefined()
    expect(failed.severity).toBe('critical')
    const data = JSON.parse(failed.event_data)
    expect(data.reason).toBe('cold_class_drift')
    expect(data.drift_count).toBe(1)
    expect(data.sample_event_types).toContain('account.register')

    expect(await listBuckets()).toHaveLength(0)
  })

  it('rows_exceed_max_per_run → critical + ok=false', async () => {
    await seed({ created_at: "datetime('now','-89 days','-1 hours')" })
    await seed({ created_at: "datetime('now','-89 days','-1 hours','+5 minutes')" })

    const { status, body } = await runCron({ AUDIT_AGGREGATE_DEBUG_MAX_ROWS_PER_RUN: '1' })
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.skipped_reason).toBe('rows_exceed_max_per_run')

    const events = await listAuditEvents()
    const failed = events.find(e => e.event_type === 'audit.aggregate.debug.run_failed')
    expect(failed).toBeDefined()
    const data = JSON.parse(failed.event_data)
    expect(data.reason).toBe('rows_exceed_max_per_run')
    expect(data.rows_scanned).toBe(2)
    expect(data.max_rows_per_run).toBe(1)
  })
})

describe('audit-aggregate-debug cron — skip / auth', () => {
  it('no_rows_eligible → 200 + run_skipped', async () => {
    const { status, body } = await runCron()
    expect(status).toBe(200)
    expect(body.skipped_reason).toBe('no_rows_eligible')

    const events = await listAuditEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('audit.aggregate.debug.run_skipped')
  })

  it('hot_days_disabled (env=0) → 200 + run_skipped', async () => {
    await seed({ created_at: "datetime('now','-89 days')" })
    const { status, body } = await runCron({ AUDIT_ARCHIVE_HOT_DAYS_DEBUG_FAILURE: '0' })
    expect(status).toBe(200)
    expect(body.skipped_reason).toBe('hot_days_disabled')
    expect(body.cutoff).toBeNull()
    expect(body.effective_cutoff_hours).toBe(0)

    const events = await listAuditEvents()
    const data = JSON.parse(events[0].event_data)
    expect(data.reason).toBe('hot_days_disabled')
  })

  it('cutoff_hours_collapsed (leadHours >= hotDays*24) → 200 + 不同 reason', async () => {
    await seed({ created_at: "datetime('now','-89 days')" })
    const { status, body } = await runCron({
      AUDIT_ARCHIVE_HOT_DAYS_DEBUG_FAILURE: '90',
      AUDIT_AGGREGATE_DEBUG_LEAD_HOURS:     `${90 * 24}`,
    })
    expect(status).toBe(200)
    expect(body.skipped_reason).toBe('cutoff_hours_collapsed')
    expect(body.cutoff).toBeNull()
    expect(body.hot_days).toBe(90)
    expect(body.lead_hours).toBe(90 * 24)
  })

  it('沒 Authorization → 401', async () => {
    const r = await cronAggregateDebug({
      request: new Request('http://test/api/admin/cron/audit-aggregate-debug', { method: 'POST' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(401)
  })

  it('CRON_SECRET 沒設 → 500', async () => {
    const r = await cronAggregateDebug({
      request: makeRequest(),
      env: { ...makeEnv(), CRON_SECRET: undefined },
    })
    expect(r.status).toBe(500)
    const body = await r.json()
    expect(body.code).toBe('CRON_SECRET_NOT_CONFIGURED')
  })
})
