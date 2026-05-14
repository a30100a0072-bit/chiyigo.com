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

  // codex r1 H-1 regression：OLD/HOT/OLD 邊界
  it('codex H-1：BETWEEN min..max 內夾 HOT row 必不被誤標 archived_at', async () => {
    await seedTelemetryRow({ created_at: OLD })   // id=1
    await seedTelemetryRow({ created_at: HOT })   // id=2（夾在中間，未進 SELECT）
    await seedTelemetryRow({ created_at: OLD })   // id=3

    const { body } = await runTelemetry()
    expect(body.ok).toBe(true)
    expect(body.rows_scanned).toBe(2)
    expect(body.chunks_marked_archived).toBe(1)
    expect(body.rows_marked_archived).toBe(2)

    // HOT row（id=2）archived_at 必仍 NULL — UPDATE 加 cutoff guard 後守住
    const rows = await env.chiyigo_db.prepare(
      `SELECT id, archived_at FROM audit_log_aggregate_telemetry ORDER BY id ASC`
    ).all()
    expect(rows.results).toHaveLength(3)
    expect(rows.results[0].archived_at).not.toBeNull()  // id=1 OLD
    expect(rows.results[1].archived_at).toBeNull()      // id=2 HOT — 必須 NULL
    expect(rows.results[2].archived_at).not.toBeNull()  // id=3 OLD
  })
})

// codex r1 H-2 + M-2：verified blocker resume 升 marked_archived + purge_after = +7d
describe('audit-aggregate-archive — verified blocker resume (codex H-2 / M-2)', () => {
  it('verified chunk + rows 已 archived_at NOT NULL → 下輪 resume 升 marked_archived', async () => {
    // 模擬「上輪 worker UPDATE aggregate row archived_at 完成、UPDATE chunks→marked_archived
    // 前 crash」狀態：rows archived_at NOT NULL，chunks state='verified'
    await seedTelemetryRow()
    await seedTelemetryRow()
    const { body: first } = await runTelemetry()
    expect(first.chunks_marked_archived).toBe(1)

    // 手動把 chunks 從 marked_archived 退回 verified + 清 marked_archived_at + purge_after
    await env.chiyigo_db.prepare(
      `UPDATE audit_archive_chunks
          SET state='verified', marked_archived_at=NULL, purge_after=NULL`
    ).run()

    const { body: second } = await runTelemetry()
    expect(second.ok).toBe(true)
    expect(second.chunks_marked_archived).toBe(1)
    expect(second.rows_marked_archived).toBe(2)
    expect(second.skipped_reason).toBeNull()  // resume 做了事不算 skip

    const chunks = await listChunks()
    expect(chunks).toHaveLength(1)
    expect(chunks[0].state).toBe('marked_archived')
    expect(chunks[0].marked_archived_at).not.toBeNull()
    expect(chunks[0].purge_after).not.toBeNull()    // M-2 fix
  })

  it('M-2：fresh happy path 也必設 purge_after = +7d', async () => {
    await seedTelemetryRow()
    await runTelemetry()
    const chunks = await listChunks()
    expect(chunks[0].state).toBe('marked_archived')
    expect(chunks[0].purge_after).not.toBeNull()
    // SQLite 文字格式 datetime；確認解析後落在 6-8 天後（避時鐘飄移誤判）
    const purgeMs = new Date(chunks[0].purge_after.replace(' ', 'T') + 'Z').getTime()
    const now     = Date.now()
    const diffDays = (purgeMs - now) / 86400_000
    expect(diffDays).toBeGreaterThan(6)
    expect(diffDays).toBeLessThan(8)
  })

  // codex r2 H-1：dry-run 跑完同日 live rerun 必 fail-fast，禁「借殼」改 chunks row
  it('codex r2 H-1：dry-run 後同日 live rerun → dry_run_collision fail-fast', async () => {
    await seedTelemetryRow()
    await seedTelemetryRow()

    // 1) dry-run：寫 dry_run=1 chunks row + verified
    const { body: dr } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    expect(dr.chunks_verified).toBe(1)
    const drChunks = await listChunks()
    expect(drChunks[0].dry_run).toBe(1)
    expect(drChunks[0].state).toBe('verified')

    // 2) 同日 live rerun（同 rows、同 sha、同 archive_date）→ 必 fail-fast
    const { status, body } = await runTelemetry()  // makeEnv 預設 AUDIT_ARCHIVE_DRY_RUN='false'
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
    const err = body.errors.find(e => e.event === 'dry_run_collision')
    expect(err).toBeDefined()
    expect(err.expected_dry_run).toBe(0)
    expect(err.actual_dry_run).toBe(1)
    expect(err.chunks_state).toBe('verified')

    // chunks row 必須仍是 dry_run=1（沒被「借殼」改）
    const after = await listChunks()
    expect(after[0].dry_run).toBe(1)
    expect(after[0].state).toBe('verified')

    // aggregate row archived_at 必須仍 NULL（live UPDATE 沒跑到）
    const rows = await env.chiyigo_db.prepare(
      `SELECT archived_at FROM audit_log_aggregate_telemetry`
    ).all()
    for (const r of rows.results) expect(r.archived_at).toBeNull()

    // run_failed event 已 emit，reason 必須是 dry_run_collision（codex r3：把主因
    // 從 errors[] 推到 event_data.reason，alerting 可直接 grep 取）
    const events = await listAuditEvents('audit.aggregate_archive.telemetry.run_failed')
    expect(events.length).toBeGreaterThanOrEqual(1)
    const failedData = JSON.parse(events[0].event_data)
    expect(failedData.reason).toBe('dry_run_collision')
    expect(failedData.errors?.[0]?.event).toBe('dry_run_collision')
    expect(failedData.errors?.[0]?.actual_dry_run).toBe(1)
    expect(failedData.errors?.[0]?.expected_dry_run).toBe(0)
  })

  it('dry-run verified 不被 resume 動到（PR 3.2 part 2 dry-run 終態）', async () => {
    await seedTelemetryRow()
    await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    const before = await listChunks()
    expect(before[0].state).toBe('verified')
    expect(before[0].dry_run).toBe(1)

    // 再跑一次（仍 dry-run）— verified dry-run chunk 不被 resume 升 marked_archived，
    // 也不被 fresh pipeline 再處理（INSERT OR IGNORE skip → processChunk 看到 existing
    // state='verified' → emit chunk_skipped info + report.chunks_skipped++ → 早退）
    // PR 3.3 r1 codex P2-1：必驗 status 200 / ok=true，避 race_with_admin 500 偽通過
    const { status, body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.chunks_marked_archived).toBe(0)
    expect(body.chunks_uploaded ?? 0).toBe(0)         // 不該重 PUT
    expect(body.chunks_verified ?? 0).toBe(0)         // 不該重 verify
    expect(body.chunks_skipped ?? 0).toBe(1)          // PR 3.3 r1 新增：idempotent skip 計數

    const after = await listChunks()
    expect(after[0].state).toBe('verified')
    expect(after[0].dry_run).toBe(1)

    // emit chunk_skipped info（terminal_state_for_mode_already_present）
    const skipped = await listAuditEvents('audit.aggregate_archive.telemetry.chunk_skipped')
    expect(skipped.length).toBe(1)
    expect(skipped[0].severity).toBe('info')
    expect(JSON.parse(skipped[0].event_data).reason).toMatch(/terminal_state_for_mode_already_present/)
  })

  it('PR 3.3 r2 codex P1 regression：admin re_verify 後 chunk 在 uploaded → 下輪 cron 必須 resume verify 推進到終態（不是 chunk_skipped）', async () => {
    // Step 1：dry-run 跑一次得到 state='verified' chunk + R2 物件
    await seedTelemetryRow()
    await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    const after1 = await listChunks()
    expect(after1[0].state).toBe('verified')

    // Step 2：模擬 admin re_verify 後狀態 — UPDATE state='uploaded'
    //   （等同於：state='failed' chunk 被 retry.js re_verify 推到 'uploaded'）
    //   R2 物件本就存在（前次 dry-run PUT），符合 re_verify 後的真實狀態
    await env.chiyigo_db.prepare(
      `UPDATE audit_archive_chunks SET state = 'uploaded' WHERE state = 'verified'`
    ).run()

    // Step 3：下輪 cron 必須走 resume-from-uploaded 路徑接續到 verified（而非 r1 早退 skip）
    // r3 後流程：Step 0 掃 uploaded → resumeUploadedBlocker → verified
    //   → Step 3 SELECT 仍撈到 aggregate row（dry-run archived_at NULL）
    //   → processChunk 看 existing state='verified' AND dryRun → idempotent info skip
    const { status, body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.chunks_resumed_uploaded ?? 0).toBe(1)   // r2 計數（r3 由 Step 0 寫）
    expect(body.chunks_verified ?? 0).toBe(1)           // Step 0 verify 成功

    const after2 = await listChunks()
    expect(after2[0].state).toBe('verified')            // dry-run 終態

    // 確認 Step 3 idempotent skip 走 info（不是 warn）— admin-terminal 才會 warn
    const skipped = await listAuditEvents('audit.aggregate_archive.telemetry.chunk_skipped')
    const warnSkip = skipped.find(e => e.severity === 'warn')
    expect(warnSkip).toBeUndefined()

    // chunk_uploaded emit 仍會 fire（資料 verify ok）
    const uploaded = await listAuditEvents('audit.aggregate_archive.telemetry.chunk_uploaded')
    expect(uploaded.length).toBeGreaterThanOrEqual(2)   // step 1 + step 3 各一次
  })

  it('PR 3.3 r2 P1 同場景 live 模式：uploaded resume → marked_archived 全推完', async () => {
    await seedTelemetryRow()
    // live 第一輪跑到 marked_archived（aggregate row archived_at 已標）
    await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    const after1 = await listChunks()
    expect(after1[0].state).toBe('marked_archived')

    // 模擬：chunk 被 admin re_verify 推回 'uploaded'，aggregate row archived_at 也清掉
    // （re_verify 不會自己清 aggregate row；這裡同步清是為了讓 SELECT 重撈）
    await env.chiyigo_db.prepare(
      `UPDATE audit_archive_chunks SET state = 'uploaded' WHERE state = 'marked_archived'`
    ).run()
    await env.chiyigo_db.prepare(
      `UPDATE audit_log_aggregate_telemetry SET archived_at = NULL`
    ).run()

    // 下輪 cron：resume verify → live archived_at + marked_archived
    const { status, body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    expect(status).toBe(200)
    expect(body.chunks_resumed_uploaded ?? 0).toBe(1)
    expect(body.chunks_verified ?? 0).toBe(1)
    expect(body.chunks_marked_archived ?? 0).toBe(1)
    expect(body.chunks_skipped ?? 0).toBe(0)

    const after2 = await listChunks()
    expect(after2[0].state).toBe('marked_archived')
  })

  it('PR 3.3 r3 codex P1 regression：跨日 uploaded chunk（archive_date=yesterday）必須被 Step 0 resume，不被新一輪 SELECT 漏接（live 模式：resume 後 archived_at 標完不重新建 chunk）', async () => {
    // 用 live 模式 — Step 0 chain 到 marked_archived 把 archived_at 標完，
    // Step 3 SELECT 就不會再撈到 aggregate row、不會建第二個 chunks row。
    // dry-run 模式下因為 archived_at 永遠 NULL，跨日 resume 後 Step 3 仍會建新 chunk
    // （重複處理但不影響資料正確性；PR 3.3 範圍不另外去重）。
    await seedTelemetryRow()
    await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    const before = await listChunks()
    expect(before[0].state).toBe('marked_archived')

    // 搬 R2 物件 + manifest 到昨天 prefix（archive_date 決定 R2 key path）
    const yyyy = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const [yy, mm, dd] = yyyy.split('-')
    async function moveR2Date(prefix) {
      const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix })
      for (const o of list.objects ?? []) {
        const obj = await env.AUDIT_ARCHIVE_BUCKET.get(o.key)
        if (!obj) continue
        const data = await obj.arrayBuffer()
        const newKey = o.key.replace(/\/\d{4}\/\d{2}\/\d{2}\//, `/${yy}/${mm}/${dd}/`)
        await env.AUDIT_ARCHIVE_BUCKET.put(newKey, data, { httpMetadata: obj.httpMetadata })
        await env.AUDIT_ARCHIVE_BUCKET.delete(o.key)
      }
    }
    await moveR2Date('audit-log-aggregate-telemetry/')
    await moveR2Date('manifest/')

    // 把 chunk 拉回 uploaded + archive_date=yesterday + aggregate row archived_at 也清掉
    await env.chiyigo_db.prepare(
      `UPDATE audit_archive_chunks
          SET state = 'uploaded',
              archive_date = date('now', '-1 day')
        WHERE state = 'marked_archived'`
    ).run()
    await env.chiyigo_db.prepare(
      `UPDATE audit_log_aggregate_telemetry SET archived_at = NULL`
    ).run()

    // Step 0 必須掃到跨日 uploaded blocker → resume verify + chain 到 marked_archived
    const { status, body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.chunks_resumed_uploaded ?? 0).toBe(1)
    expect(body.chunks_verified ?? 0).toBe(1)
    expect(body.chunks_marked_archived ?? 0).toBe(1)
    expect(body.chunks_planned ?? 0).toBe(0)   // Step 3 沒新建 chunk

    const after = await listChunks()
    expect(after.length).toBe(1)               // 沒有重複 row
    expect(after[0].state).toBe('marked_archived')
    expect(after[0].archive_date).not.toBe(new Date().toISOString().slice(0, 10))  // 仍是昨天

    // chunk_uploaded resume emit 帶 resumed='uploaded_to_verified'
    const ev = await listAuditEvents('audit.aggregate_archive.telemetry.chunk_uploaded')
    const resumed = ev.find(e => {
      try { return JSON.parse(e.event_data).resumed === 'uploaded_to_verified' }
      catch { return false }
    })
    expect(resumed).toBeTruthy()
  })

  // 共用 helper：seed 1 aggregate row + 1 terminal-blocker chunk（覆蓋該 row id）
  async function seedTerminalBlockerScenario(blockerState, sha) {
    await seedTelemetryRow()
    const row = await env.chiyigo_db.prepare(
      `SELECT id FROM audit_log_aggregate_telemetry ORDER BY id DESC LIMIT 1`
    ).first()
    const id = row.id
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
        (env, table_name, cold_class, cold_class_version, archive_date,
         min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run, compression,
         last_failure, last_failure_at)
       VALUES ('test', 'audit_log_aggregate_telemetry', 'aggregate_telemetry', 1, date('now','-1 day'),
               ?, ?, ?, ?, 1, 1, 'run-seed', 0, 'gzip',
               'admin_mark_resolved', datetime('now'))`
    ).bind(id, id, sha, blockerState).run()
    if (blockerState === 'blacklisted') {
      await env.chiyigo_db.prepare(
        `UPDATE audit_archive_chunks SET blacklisted_at = datetime('now') WHERE chunk_sha256 = ?`
      ).bind(sha).run()
    }
    return id
  }

  it('PR 3.3 r4 codex P1 regression：跨日 blacklisted chunk 必須擋住今天 fresh pipeline，不該繞過 force_purge invariant', async () => {
    // 場景：admin 昨天 mark_resolved 把 failed chunk → blacklisted（等 force_purge）。
    // source aggregate row 仍 archived_at=NULL。今天 cron 跑：
    //   - Step 0 必須掃到 blacklisted blocker → emit chunk_skipped warn
    //   - Step 1 SELECT 必須 NOT EXISTS 排除被 blocker 覆蓋 id range 的 row
    //   - Step 3 不該新建任何 chunk（不該繞過 invariant 把資料 archive 掉）
    const id = await seedTerminalBlockerScenario('blacklisted', 'b'.repeat(64))

    const { status, body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.chunks_blocked_terminal ?? 0).toBe(1)
    expect(body.chunks_planned ?? 0).toBe(0)
    expect(body.chunks_uploaded ?? 0).toBe(0)
    expect(body.chunks_verified ?? 0).toBe(0)
    expect(body.chunks_marked_archived ?? 0).toBe(0)

    const r = await env.chiyigo_db.prepare(
      `SELECT archived_at FROM audit_log_aggregate_telemetry WHERE id = ?`
    ).bind(id).first()
    expect(r.archived_at).toBeNull()

    const allChunks = await listChunks()
    expect(allChunks.length).toBe(1)
    expect(allChunks[0].state).toBe('blacklisted')

    const skipped = await listAuditEvents('audit.aggregate_archive.telemetry.chunk_skipped')
    const warn = skipped.find(e => {
      try { return JSON.parse(e.event_data).reason?.includes('cross_day_blacklisted_blocker') }
      catch { return false }
    })
    expect(warn).toBeTruthy()
    expect(warn.severity).toBe('warn')
  })

  it('PR 3.3 r4 codex P1 regression：跨日 failed chunk 同樣擋住今天 fresh pipeline（admin 必須 re_verify 或 mark_resolved 後續）', async () => {
    const id = await seedTerminalBlockerScenario('failed', 'c'.repeat(64))

    const { status, body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    expect(status).toBe(200)
    expect(body.chunks_blocked_terminal ?? 0).toBe(1)
    expect(body.chunks_planned ?? 0).toBe(0)
    const r = await env.chiyigo_db.prepare(
      `SELECT archived_at FROM audit_log_aggregate_telemetry WHERE id = ?`
    ).bind(id).first()
    expect(r.archived_at).toBeNull()
    const allChunks = await listChunks()
    expect(allChunks.length).toBe(1)
    expect(allChunks[0].state).toBe('failed')

    const skipped = await listAuditEvents('audit.aggregate_archive.telemetry.chunk_skipped')
    const warn = skipped.find(e => {
      try { return JSON.parse(e.event_data).reason?.includes('cross_day_failed_blocker') }
      catch { return false }
    })
    expect(warn).toBeTruthy()
  })

  it('PR 3.3 r3 codex P2 regression：uploaded resume 時 R2 物件遺失 → chunk atomic 轉回 failed（admin 可 re_verify）', async () => {
    // Step 1：跑一次得 chunk + R2 物件
    await seedTelemetryRow()
    await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    const before = await listChunks()
    expect(before[0].state).toBe('verified')

    // Step 2：模擬 admin re_verify → state='uploaded' + 把 R2 物件刪掉（模擬遺失）
    await env.chiyigo_db.prepare(
      `UPDATE audit_archive_chunks SET state = 'uploaded' WHERE state = 'verified'`
    ).run()
    const r2List = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log-aggregate-telemetry-dryrun/' })
    for (const o of r2List.objects ?? []) {
      await env.AUDIT_ARCHIVE_BUCKET.delete(o.key)
    }

    // Step 3：cron 跑 → Step 0 resumeUploadedBlocker → R2 GET 找不到 →
    //   transitionUploadedToFailed atomic state→'failed' + retry_count++ + last_failure
    //   throw 進外 catch → run_failed critical
    const { status, body } = await runTelemetry({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    expect(status).toBe(500)  // run_failed（resume crash）
    expect(body.ok).toBe(false)
    expect(body.errors?.[0]?.event).toBe('blocker_resume_failed')

    // chunk row 必須 atomic 轉到 'failed'（admin 後續可走 re_verify）
    const after = await listChunks()
    expect(after[0].state).toBe('failed')
    expect(after[0].retry_count).toBeGreaterThanOrEqual(1)
    expect(after[0].last_failure).toBe('r2_object_not_found')
    expect(after[0].last_failure_at).toBeTruthy()
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
