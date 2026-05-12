/**
 * F-3 Phase 2 PR 3.0 — aggregate worker 整合測試
 *
 * 覆蓋：
 *   1. happy path：種 4 row → cutoff 內 → 2 buckets 各 2 count → run_completed
 *   2. idempotent：連跑兩次 → bucket count 不疊（UPSERT 重算）
 *   3. cutoff 過濾：cutoff 內外 row 混合 → 只 aggregate cutoff 內者
 *   4. archived_at IS NOT NULL → 不撈
 *   5. cold_class drift → fail-fast critical event + ok=false
 *   6. no_rows_eligible → 200 + skipped_reason='no_rows_eligible'
 *   7. hot_days_disabled (env=0) → 200 + skipped_reason='hot_days_disabled'
 *   8. rows_exceed_max_per_run → fail + critical event
 *   9. auth 401 / CRON_SECRET 缺 500
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers.js'
import { onRequestPost as cronAggregate } from '../../functions/api/admin/cron/audit-aggregate.js'

const CRON_SECRET = 'test-cron-secret'
const ARCHIVE_ENV = 'test'

function makeRequest(auth = `Bearer ${CRON_SECRET}`) {
  return new Request('http://test/api/admin/cron/audit-aggregate', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  })
}

function makeEnv(overrides = {}) {
  return {
    ...env,
    CRON_SECRET,
    ARCHIVE_ENV,
    // 預設：hot_days=30（telemetry design 預設）+ lead_hours=24 → cutoff = now-29d
    AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS: '30',
    AUDIT_AGGREGATE_LEAD_HOURS: '24',
    ...overrides,
  }
}

async function runCron(overrides) {
  const r = await cronAggregate({ request: makeRequest(), env: makeEnv(overrides) })
  return { status: r.status, body: await r.json() }
}

// 種 1 row at given ts，可指定 cold_class / event_type / user_id / ip_hash / archived
async function seed(over = {}) {
  const o = {
    event_type: 'auth.login.rate_limited',
    severity: 'info',
    user_id: null,
    ip_hash: 'h1',
    event_data: '{}',
    cold_class: 'telemetry',
    archived_at: null,
    created_at: "datetime('now','-29 days','-1 hours')", // cutoff 內預設值
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
    `SELECT event_type, user_id, severity, hour_bucket, count, ip_hash_top
       FROM audit_log_aggregate_telemetry
      ORDER BY hour_bucket ASC, event_type ASC`
  ).all()
  return r.results ?? []
}

async function listAuditEvents() {
  const r = await env.chiyigo_db.prepare(
    `SELECT event_type, severity, event_data FROM audit_log
      WHERE event_type LIKE 'audit.aggregate.%'
      ORDER BY id ASC`
  ).all()
  return r.results ?? []
}

beforeEach(async () => {
  await resetDb()
})

describe('audit-aggregate cron — happy path', () => {
  it('Step 1：種 4 row（2 event_types）→ 2 buckets 各 2 count', async () => {
    // bucket 用 event_type 分（不靠 wall-clock 分鐘數做 hour-bucket split，避免依
    // 跑測試當下分鐘 >=30 時 -2h vs -2h+30m 跨小時邊界產生 flaky）。
    // 全部 row 同時間（-29d -1h） → hour_bucket 統一；event_type 兩種 → 2 bucket。
    const t = "datetime('now','-29 days','-1 hours')"
    await seed({ event_type: 'auth.login.rate_limited', created_at: t })
    await seed({ event_type: 'auth.login.rate_limited', created_at: t })
    await seed({ event_type: 'auth.refresh.rate_limited', created_at: t })
    await seed({ event_type: 'auth.refresh.rate_limited', created_at: t })

    const { status, body } = await runCron()
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.rows_scanned).toBe(4)
    expect(body.buckets_upserted).toBe(2)
    expect(body.skipped_reason).toBeNull()
    expect(body.cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const rows = await listBuckets()
    expect(rows).toHaveLength(2)
    const byEvent = new Map(rows.map(r => [r.event_type, r]))
    expect(byEvent.get('auth.login.rate_limited').count).toBe(2)
    expect(byEvent.get('auth.refresh.rate_limited').count).toBe(2)
    for (const r of rows) {
      expect(r.severity).toBe('info')
      expect(r.user_id).toBeNull()
      expect(r.ip_hash_top).toBe('h1')
    }

    const events = await listAuditEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('audit.aggregate.run_completed')
    expect(events[0].severity).toBe('info')
    const data = JSON.parse(events[0].event_data)
    expect(data.rows_scanned).toBe(4)
    expect(data.buckets_upserted).toBe(2)
    expect(data.cold_class).toBe('telemetry')
  })

  it('Step 2：idempotent — 連跑兩次 count 不疊', async () => {
    await seed({ created_at: "datetime('now','-29 days','-1 hours')" })
    await seed({ created_at: "datetime('now','-29 days','-1 hours','+10 minutes')" })

    await runCron()
    const after1 = await listBuckets()
    expect(after1).toHaveLength(1)
    expect(after1[0].count).toBe(2)

    await runCron()
    const after2 = await listBuckets()
    expect(after2).toHaveLength(1)
    expect(after2[0].count).toBe(2)  // 重 reduce，不疊加
  })

  it('Step 3：cutoff 過濾 — 28 天前（cutoff 外）row 不撈，29 天前撈', async () => {
    await seed({ created_at: "datetime('now','-28 days')" })   // cutoff 外（hot 內）
    await seed({ created_at: "datetime('now','-29 days','-2 hours')" })  // cutoff 內

    const { body } = await runCron()
    expect(body.rows_scanned).toBe(1)
    expect(body.buckets_upserted).toBe(1)
  })

  it('Step 3b：boundary regression — cutoff 同日 +1h（hot 內）row 必排除', async () => {
    // 防 ISO 'T' vs SQLite space lex-compare bug：
    // JS-computed cutoff '2026-04-13T20:00:00.000Z' vs SQLite stored
    // '2026-04-13 21:00:00'（cutoff 後 1 小時）會因 position 10 space < T 被誤判為
    // < cutoff，把 hot 內的 row 偷渡進 aggregate。
    // hotDays=30 / leadHours=24 → cutoff = now - 29d。
    // 種 now - 29d + 1h（cutoff 後 1h，仍在 hot 內）→ 必排除
    await seed({ created_at: "datetime('now','-29 days','+1 hours')" })
    // 對照：now - 29d - 1h（cutoff 前 1h）→ 必納入
    await seed({ created_at: "datetime('now','-29 days','-1 hours')" })

    const { body } = await runCron()
    expect(body.ok).toBe(true)
    expect(body.rows_scanned).toBe(1)
    expect(body.buckets_upserted).toBe(1)
    const buckets = await listBuckets()
    expect(buckets).toHaveLength(1)
    expect(buckets[0].count).toBe(1)
  })

  it('Step 4：archived_at IS NOT NULL → 不撈', async () => {
    await seed({
      created_at: "datetime('now','-29 days','-1 hours')",
      archived_at: '2026-01-01T00:00:00Z',
    })
    const { body } = await runCron()
    expect(body.rows_scanned).toBe(0)
    expect(body.skipped_reason).toBe('no_rows_eligible')
  })
})

describe('audit-aggregate cron — drift / 失敗路徑', () => {
  it('cold_class drift → critical + ok=false + skipped_reason', async () => {
    // stored cold_class='telemetry' 但 event_type 不在 telemetry 分類
    // → classifier 判別不一致，fail-fast
    await seed({
      event_type: 'account.register',  // immutable category，不該歸 telemetry
      severity: 'info',
      cold_class: 'telemetry',
      created_at: "datetime('now','-29 days','-1 hours')",
    })

    const { status, body } = await runCron()
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.skipped_reason).toBe('cold_class_drift_detected')

    const events = await listAuditEvents()
    const failed = events.find(e => e.event_type === 'audit.aggregate.run_failed')
    expect(failed).toBeDefined()
    expect(failed.severity).toBe('critical')
    const data = JSON.parse(failed.event_data)
    expect(data.reason).toBe('cold_class_drift')
    expect(data.drift_count).toBe(1)
    expect(data.sample_event_types).toContain('account.register')

    // bucket 表沒被寫入
    expect(await listBuckets()).toHaveLength(0)
  })

  it('rows_exceed_max_per_run → critical + ok=false', async () => {
    await seed({ created_at: "datetime('now','-29 days','-1 hours')" })
    await seed({ created_at: "datetime('now','-29 days','-1 hours','+5 minutes')" })

    const { status, body } = await runCron({ AUDIT_AGGREGATE_MAX_ROWS_PER_RUN: '1' })
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.skipped_reason).toBe('rows_exceed_max_per_run')

    const events = await listAuditEvents()
    const failed = events.find(e => e.event_type === 'audit.aggregate.run_failed')
    expect(failed).toBeDefined()
    const data = JSON.parse(failed.event_data)
    expect(data.reason).toBe('rows_exceed_max_per_run')
    expect(data.rows_scanned).toBe(2)
    expect(data.max_rows_per_run).toBe(1)
  })
})

describe('audit-aggregate cron — skip / auth', () => {
  it('no_rows_eligible → 200 + run_skipped', async () => {
    const { status, body } = await runCron()
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.rows_scanned).toBe(0)
    expect(body.skipped_reason).toBe('no_rows_eligible')

    const events = await listAuditEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('audit.aggregate.run_skipped')
    expect(events[0].severity).toBe('info')
  })

  it('hot_days_disabled (env=0) → 200 + run_skipped', async () => {
    await seed({ created_at: "datetime('now','-29 days')" })
    const { status, body } = await runCron({ AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS: '0' })
    expect(status).toBe(200)
    expect(body.skipped_reason).toBe('hot_days_disabled')
    expect(body.cutoff).toBeNull()

    const events = await listAuditEvents()
    expect(events[0].event_type).toBe('audit.aggregate.run_skipped')
    const data = JSON.parse(events[0].event_data)
    expect(data.reason).toBe('hot_days_disabled')
  })

  it('沒 Authorization → 401', async () => {
    const r = await cronAggregate({
      request: new Request('http://test/api/admin/cron/audit-aggregate', { method: 'POST' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(401)
  })

  it('CRON_SECRET 沒設 → 500', async () => {
    const r = await cronAggregate({
      request: makeRequest(),
      env: { ...makeEnv(), CRON_SECRET: undefined },
    })
    expect(r.status).toBe(500)
    const body = await r.json()
    expect(body.code).toBe('CRON_SECRET_NOT_CONFIGURED')
  })
})
