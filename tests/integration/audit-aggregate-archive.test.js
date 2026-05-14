/**
 * F-3 Phase 2 PR 3.2 part 2 — Aggregate cold-archive worker 整合測試
 *
 * 覆蓋兩 worker（telemetry / debug）共用 runner 的關鍵路徑：
 *   1. happy path（telemetry / debug）：月度 cutoff 之前 row → planned → uploaded
 *      → verified → marked_archived（live mode）
 *   2. archived_at IS NULL filter：已 archive 的 row 不再撈
 *   3. month boundary：cutoff 同月 row 不撈，跨月 row 撈
 *   4. DRY_RUN：寫 R2 dryrun prefix；chunks 升到 verified 即止，aggregate row
 *      archived_at 保留 NULL
 *   5. idempotent re-run：第二輪 cron 無 row 可撈 → no_rows_eligible skip
 *   6. chunks row.cold_class 對齊 aggregate_*（PK 與 audit_log 既有 chunks 不撞）
 *   7. 401 / 缺 CRON_SECRET → 401 / 500
 *   8. no_rows_eligible → 200 + run_skipped event
 *
 * 直接 import handler + 帶 bearer call；R2 binding 走 miniflare 內建。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers.js'
import { onRequestPost as cronTelemetry } from '../../functions/api/admin/cron/audit-aggregate-archive-telemetry.js'
import { onRequestPost as cronDebug } from '../../functions/api/admin/cron/audit-aggregate-archive-debug.js'
import { cutoffMonthStartUTC } from '../../functions/utils/audit-aggregate-archive.js'

const CRON_SECRET = 'test-cron-secret'
const ARCHIVE_ENV = 'test'

function makeRequest(path) {
  return new Request(`http://test${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
}

function makeEnv(overrides = {}) {
  return {
    ...env,
    CRON_SECRET,
    ARCHIVE_ENV,
    AUDIT_ARCHIVE_DRY_RUN: 'false',
    AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS: '0,0,0',  // 整合測試免等 21s
    ...overrides,
  }
}

async function runTelemetry(over) {
  const r = await cronTelemetry({
    request: makeRequest('/api/admin/cron/audit-aggregate-archive-telemetry'),
    env: makeEnv(over),
  })
  return { status: r.status, body: await r.json() }
}

async function runDebug(over) {
  const r = await cronDebug({
    request: makeRequest('/api/admin/cron/audit-aggregate-archive-debug'),
    env: makeEnv(over),
  })
  return { status: r.status, body: await r.json() }
}

// 月度 cutoff 之前的 row：用 SQLite 月初 -1 day（上月底）保證 created_at < cutoff
const OLD = "datetime('now', 'start of month', '-1 day')"
// hot 內：本月 row
const HOT = "datetime('now')"

// hour_bucket 預設遞增（避 UNIQUE 索引撞）— caller 帶 over.hour_bucket 自蓋
let _bucketSeq = 0
function nextBucket() {
  _bucketSeq += 1
  const h = String(_bucketSeq % 24).padStart(2, '0')
  return `2025-01-15T${h}:00`
}

async function seedTelemetryRow(over = {}) {
  const o = {
    event_type:   'auth.login.rate_limited',
    user_id:      null,
    severity:     'info',
    hour_bucket:  nextBucket(),
    count:        5,
    ip_hash_top:  'h',
    archived_at:  null,
    created_at:   OLD,
    ...over,
  }
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_log_aggregate_telemetry
       (event_type, user_id, severity, hour_bucket, count, ip_hash_top,
        archived_at, created_at, cold_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${o.created_at}, 'aggregate_telemetry')`
  ).bind(o.event_type, o.user_id, o.severity, o.hour_bucket,
         o.count, o.ip_hash_top, o.archived_at).run()
}

async function seedDebugRow(over = {}) {
  const o = {
    event_type:   'payment.webhook.fail',
    reason_code:  'webhook_parse_failed',
    hour_bucket:  nextBucket(),
    total_count:  3,
    sample_count: 3,
    samples_json: '[{"id":1}]',
    sampled:      0,
    archived_at:  null,
    created_at:   OLD,
    ...over,
  }
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_log_aggregate_debug
       (event_type, reason_code, hour_bucket, total_count, sample_count,
        samples_json, sampled, archived_at, created_at, cold_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${o.created_at}, 'aggregate_debug')`
  ).bind(o.event_type, o.reason_code, o.hour_bucket,
         o.total_count, o.sample_count, o.samples_json, o.sampled,
         o.archived_at).run()
}

async function resetR2Bucket() {
  const list = await env.AUDIT_ARCHIVE_BUCKET.list({ limit: 1000 })
  for (const obj of list.objects ?? []) {
    await env.AUDIT_ARCHIVE_BUCKET.delete(obj.key)
  }
}

async function listChunks() {
  const r = await env.chiyigo_db.prepare(
    `SELECT * FROM audit_archive_chunks ORDER BY min_id ASC`
  ).all()
  return r.results ?? []
}

async function listAuditEvents(prefix) {
  const r = await env.chiyigo_db.prepare(
    `SELECT event_type, severity, event_data FROM audit_log
      WHERE event_type LIKE ?
      ORDER BY id ASC`
  ).bind(`${prefix}%`).all()
  return r.results ?? []
}

beforeEach(async () => {
  await resetDb()
  await resetR2Bucket()
})

describe('audit-aggregate-archive — telemetry happy path', () => {
  it('Step 1：cutoff 之前 row → planned → uploaded → verified → marked_archived', async () => {
    await seedTelemetryRow()
    await seedTelemetryRow()
    await seedTelemetryRow()

    const { status, body } = await runTelemetry()
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('live')
    expect(body.skipped_reason).toBeNull()
    expect(body.rows_scanned).toBe(3)
    expect(body.chunks_planned).toBe(1)
    expect(body.chunks_uploaded).toBe(1)
    expect(body.chunks_verified).toBe(1)
    expect(body.chunks_marked_archived).toBe(1)
    expect(body.rows_marked_archived).toBe(3)
    expect(body.cold_class).toBe('aggregate_telemetry')

    const chunks = await listChunks()
    expect(chunks).toHaveLength(1)
    expect(chunks[0].cold_class).toBe('aggregate_telemetry')
    expect(chunks[0].state).toBe('marked_archived')
    expect(chunks[0].compression).toBe('gzip')
    expect(chunks[0].dry_run).toBe(0)

    // aggregate row archived_at 已標
    const rows = await env.chiyigo_db.prepare(
      `SELECT id, archived_at FROM audit_log_aggregate_telemetry`
    ).all()
    expect(rows.results).toHaveLength(3)
    for (const r of rows.results) expect(r.archived_at).not.toBeNull()

    // R2 物件：data prefix 為 audit-log-aggregate-telemetry/
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log-aggregate-telemetry/' })
    expect(list.objects?.some(o => o.key.endsWith('.jsonl.gz'))).toBe(true)

    // manifest 走共用 manifest/{env}/audit_log_aggregate_telemetry/...
    const ml = await env.AUDIT_ARCHIVE_BUCKET.list({
      prefix: `manifest/${ARCHIVE_ENV}/audit_log_aggregate_telemetry/`,
    })
    expect(ml.objects?.length).toBeGreaterThan(0)

    // run_completed 已 emit
    const events = await listAuditEvents('audit.aggregate_archive.telemetry.')
    const completed = events.find(e => e.event_type === 'audit.aggregate_archive.telemetry.run_completed')
    expect(completed).toBeDefined()
    expect(completed.severity).toBe('info')
  })
})

describe('audit-aggregate-archive — debug happy path', () => {
  it('Step 1：debug 表 row → marked_archived（cold_class=aggregate_debug）', async () => {
    await seedDebugRow()
    await seedDebugRow({ reason_code: 'in_flight_conflict' })

    const { status, body } = await runDebug()
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.rows_scanned).toBe(2)
    expect(body.chunks_marked_archived).toBe(1)
    expect(body.cold_class).toBe('aggregate_debug')

    const chunks = await listChunks()
    expect(chunks).toHaveLength(1)
    expect(chunks[0].cold_class).toBe('aggregate_debug')

    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log-aggregate-debug/' })
    expect(list.objects?.some(o => o.key.endsWith('.jsonl.gz'))).toBe(true)
  })

  it('两 worker 共存：同步跑後 chunks PK 不撞（不同 cold_class）', async () => {
    await seedTelemetryRow()
    await seedDebugRow()

    await runTelemetry()
    await runDebug()

    const chunks = await listChunks()
    expect(chunks).toHaveLength(2)
    const classes = chunks.map(c => c.cold_class).sort()
    expect(classes).toEqual(['aggregate_debug', 'aggregate_telemetry'])
  })
})

describe('audit-aggregate-archive — filter / boundary', () => {
  it('archived_at IS NOT NULL → 不撈', async () => {
    await seedTelemetryRow({ archived_at: '2026-01-01T00:00:00Z' })
    const { body } = await runTelemetry()
    expect(body.rows_scanned).toBe(0)
    expect(body.skipped_reason).toBe('no_rows_eligible')
  })

  it('month boundary：本月 row 不撈，上月 row 撈', async () => {
    await seedTelemetryRow({ created_at: HOT })   // 本月 → 不撈
    await seedTelemetryRow({ created_at: OLD })   // 上月底 → 撈
    const { body } = await runTelemetry()
    expect(body.rows_scanned).toBe(1)
    expect(body.chunks_marked_archived).toBe(1)
  })

  it('cutoffMonthStartUTC 對齊 SQLite datetime("now","start of month")', () => {
    const c = cutoffMonthStartUTC()
    expect(c).toMatch(/^\d{4}-\d{2}-01 00:00:00$/)
  })
})

describe('audit-aggregate-archive — DRY_RUN', () => {
  it('dry-run：寫 dryrun prefix；aggregate row archived_at 保留 NULL', async () => {
    await seedTelemetryRow()
    await seedTelemetryRow()

    const { body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    expect(body.mode).toBe('dry_run')
    expect(body.chunks_verified).toBe(1)
    expect(body.chunks_marked_archived).toBe(0)
    expect(body.rows_marked_archived).toBe(0)

    // R2 在 dryrun prefix
    const liveList = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log-aggregate-telemetry/' })
    const dryList  = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log-aggregate-telemetry-dryrun/' })
    expect(liveList.objects?.length ?? 0).toBe(0)
    expect(dryList.objects?.some(o => o.key.endsWith('.jsonl.gz'))).toBe(true)

    // aggregate row archived_at 仍 NULL
    const rows = await env.chiyigo_db.prepare(
      `SELECT archived_at FROM audit_log_aggregate_telemetry`
    ).all()
    for (const r of rows.results) expect(r.archived_at).toBeNull()

    // chunks 停在 verified（dry-run 不 mark_archived）
    const chunks = await listChunks()
    expect(chunks[0].state).toBe('verified')
    expect(chunks[0].dry_run).toBe(1)
  })
})

describe('audit-aggregate-archive — idempotent / skip', () => {
  it('連跑兩次：第二輪 no_rows_eligible（已 archive 全部標好）', async () => {
    await seedTelemetryRow()

    const first = await runTelemetry()
    expect(first.body.chunks_marked_archived).toBe(1)

    const second = await runTelemetry()
    expect(second.body.rows_scanned).toBe(0)
    expect(second.body.skipped_reason).toBe('no_rows_eligible')

    const events = await listAuditEvents('audit.aggregate_archive.telemetry.run_skipped')
    expect(events.length).toBeGreaterThanOrEqual(1)
  })

  it('no_rows_eligible → 200 + run_skipped event', async () => {
    const { status, body } = await runTelemetry()
    expect(status).toBe(200)
    expect(body.skipped_reason).toBe('no_rows_eligible')

    const events = await listAuditEvents('audit.aggregate_archive.telemetry.run_skipped')
    expect(events).toHaveLength(1)
    const data = JSON.parse(events[0].event_data)
    expect(data.reason).toBe('no_rows_eligible')
  })
})

describe('audit-aggregate-archive — auth', () => {
  it('沒 Authorization → 401', async () => {
    const r = await cronTelemetry({
      request: new Request('http://test/api/admin/cron/audit-aggregate-archive-telemetry', { method: 'POST' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(401)
  })

  it('CRON_SECRET 沒設 → 500', async () => {
    const r = await cronTelemetry({
      request: makeRequest('/api/admin/cron/audit-aggregate-archive-telemetry'),
      env: { ...makeEnv(), CRON_SECRET: undefined },
    })
    expect(r.status).toBe(500)
    const body = await r.json()
    expect(body.code).toBe('CRON_SECRET_NOT_CONFIGURED')
  })
})
