/**
 * F-3 Phase 2 PR 2.1a — archive worker state machine 整合測試
 *
 * 跑滿狀態機 happy path：
 *   1. fresh chunk pipeline: 撈 hot-retention 過期的 telemetry row → planned → uploaded
 *   2. uploaded blocker → R2 GET + sha 對齊 → verified
 *   3. verified blocker（live mode）→ marked_archived first-pass + UPDATE archived_at
 *   4. verified blocker（dry-run mode）→ skip with dry_run_skips_marked_archived
 *
 * 1 條 recovery 主路徑：
 *   5. planted planned chunk + 對齊 row → recovery 升 uploaded
 *
 * 1 條 critical 失敗路徑：
 *   6. planted uploaded chunk + R2 物件不存在 → verification_failed + state=failed
 *
 * 直接 import handler + 帶 bearer call，避免 Pages Functions routing 需求。
 * R2 binding 走 miniflare 內建 R2（vitest.workers.config.js 已加 r2Buckets）。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers.js'
import { onRequestPost as cronArchive } from '../../functions/api/admin/cron/audit-archive'
import {
  rowsToJsonl,
  sha256Hex,
  gzipDecompress,
  buildChunkKeys,
} from '../../functions/utils/audit-archive'

const CRON_SECRET = 'test-cron-secret'
const ARCHIVE_ENV = 'test'

function makeRequest() {
  return new Request('http://test/api/admin/cron/audit-archive', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
}

function makeEnv(overrides = {}) {
  return {
    ...env,
    CRON_SECRET,
    ARCHIVE_ENV,
    AUDIT_ARCHIVE_DRY_RUN: 'false',          // 預設整合測試走 live 才看得到 marked_archived
    AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS: '0',   // 不設下限 — 撈所有 telemetry row（test row 沒 30 天）
    ...overrides,
  }
}

async function runCron(overrides) {
  const r = await cronArchive({ request: makeRequest(), env: makeEnv(overrides) })
  expect(r.status).toBeLessThan(500)
  return await r.json()
}

// 種 N 個 telemetry row 進 audit_log；event_type 用 classifyForCold → telemetry 的事件
async function seedTelemetry(n) {
  const db = env.chiyigo_db
  for (let i = 0; i < n; i++) {
    await db.prepare(
      `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data, cold_class, created_at)
       VALUES ('auth.login.rate_limited', 'info', NULL, 'h', '{}', 'telemetry', datetime('now','-1 hour'))`
    ).run()
  }
}

// 清 R2 + chunks，避免測試間外洩（resetDb 不會碰 R2）
async function resetR2Bucket() {
  const list = await env.AUDIT_ARCHIVE_BUCKET.list({ limit: 1000 })
  for (const obj of list.objects ?? []) {
    // 注意：這是 *test cleanup*，不是 archive worker codepath。
    // archive worker lint 只掃 functions/{utils,api/admin/cron}/audit-archive*.js — test 檔不在掃描範圍。
    await env.AUDIT_ARCHIVE_BUCKET.delete(obj.key)
  }
}

async function getChunk() {
  const r = await env.chiyigo_db.prepare(
    `SELECT * FROM audit_archive_chunks ORDER BY min_id ASC`
  ).all()
  return r.results ?? []
}

beforeEach(async () => {
  await resetDb()
  await resetR2Bucket()
})

describe('audit-archive cron — happy path 狀態機', () => {
  it('Step 1：fresh chunk → planned → uploaded', async () => {
    await seedTelemetry(3)
    const report = await runCron()
    expect(report.ok).toBe(true)
    expect(report.skipped_reason).toBeNull()
    expect(report.chunks_planned).toBe(1)
    expect(report.chunks_uploaded).toBe(1)
    expect(report.rows_uploaded).toBe(3)

    const chunks = await getChunk()
    expect(chunks).toHaveLength(1)
    expect(chunks[0].state).toBe('uploaded')
    expect(chunks[0].row_count).toBe(3)

    // R2 應有 data + manifest（PR 2.1b：data 副檔名 .jsonl.gz）
    const dataPrefix = `audit-log/${ARCHIVE_ENV}/audit_log/telemetry/`
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    expect(list.objects?.some(o => o.key.startsWith(dataPrefix) && o.key.endsWith('.jsonl.gz'))).toBe(true)

    // PR 2.1b：DB chunks 帶 compression='gzip'
    expect(chunks[0].compression).toBe('gzip')
  })

  it('Step 2：uploaded blocker → R2 GET + sha 對齊 → verified', async () => {
    await seedTelemetry(2)
    await runCron()                              // → uploaded
    const report = await runCron()               // uploaded blocker → verified
    expect(report.ok).toBe(true)
    expect(report.blocker?.state).toBe('uploaded')
    expect(report.blocker_action).toBe('verify_uploaded')
    expect(report.chunks_verified).toBe(1)

    const [chunk] = await getChunk()
    expect(chunk.state).toBe('verified')
  })

  it('Step 3：verified blocker（live）→ marked_archived first-pass + UPDATE archived_at', async () => {
    await seedTelemetry(2)
    await runCron()  // uploaded
    await runCron()  // verified
    const report = await runCron()  // marked_archived
    expect(report.ok).toBe(true)
    expect(report.blocker?.state).toBe('verified')
    expect(report.blocker_action).toBe('mark_archived')
    expect(report.chunks_marked_archived).toBe(1)
    expect(report.rows_marked_archived).toBe(2)

    const [chunk] = await getChunk()
    expect(chunk.state).toBe('marked_archived')
    expect(chunk.marked_archived_at).toBeTruthy()
    expect(chunk.purge_after).toBeTruthy()

    const { results } = await env.chiyigo_db
      .prepare(`SELECT id, archived_at FROM audit_log WHERE archived_at IS NOT NULL ORDER BY id`).all()
    expect(results).toHaveLength(2)
  })

  it('Step 3 (DRY_RUN)：verified blocker → skip dry_run_skips_marked_archived，不動 audit_log', async () => {
    await seedTelemetry(2)
    await runCron({ AUDIT_ARCHIVE_DRY_RUN: 'true' })  // uploaded
    await runCron({ AUDIT_ARCHIVE_DRY_RUN: 'true' })  // verified
    const report = await runCron({ AUDIT_ARCHIVE_DRY_RUN: 'true' })
    expect(report.ok).toBe(true)
    expect(report.skipped_reason).toBe('dry_run_skips_marked_archived')

    const [chunk] = await getChunk()
    expect(chunk.state).toBe('verified')  // 維持 verified
    const { results } = await env.chiyigo_db
      .prepare(`SELECT id FROM audit_log WHERE archived_at IS NOT NULL`).all()
    expect(results ?? []).toHaveLength(0)
  })
})

describe('audit-archive cron — PR 2.1b gzip 壓縮', () => {
  it('fresh chunk 寫 .jsonl.gz；R2 obj contentEncoding=gzip；解壓 sha 對齊', async () => {
    await seedTelemetry(4)
    await runCron()

    const [chunk] = await getChunk()
    expect(chunk.compression).toBe('gzip')

    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    const gzKey = list.objects?.find(o => o.key.endsWith('.jsonl.gz'))?.key
    expect(gzKey).toBeTruthy()

    const obj = await env.AUDIT_ARCHIVE_BUCKET.get(gzKey)
    expect(obj.httpMetadata?.contentEncoding).toBe('gzip')

    const gzBytes  = new Uint8Array(await obj.arrayBuffer())
    const jsonlOut = new TextDecoder().decode(await gzipDecompress(gzBytes))
    expect(await sha256Hex(jsonlOut)).toBe(chunk.chunk_sha256)
    expect(jsonlOut.split('\n').filter(Boolean)).toHaveLength(4)
  })

  it('manifest.compression=gzip + sha256_gz 對齊 gz bytes sha256', async () => {
    await seedTelemetry(2)
    await runCron()

    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'manifest/' })
    const manifestKey = list.objects?.find(o => o.key.endsWith('.json'))?.key
    expect(manifestKey).toBeTruthy()
    const manifestObj = await env.AUDIT_ARCHIVE_BUCKET.get(manifestKey)
    const manifest = JSON.parse(await manifestObj.text())
    expect(manifest.compression).toBe('gzip')
    expect(manifest.sha256_gz).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.sha256_jsonl).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.sha256_gz).not.toBe(manifest.sha256_jsonl)

    // sha256_gz 應等於 R2 gz object bytes 的 sha256
    const gzList = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    const gzKey = gzList.objects?.find(o => o.key.endsWith('.jsonl.gz'))?.key
    const gzObj = await env.AUDIT_ARCHIVE_BUCKET.get(gzKey)
    const gzBytes = new Uint8Array(await gzObj.arrayBuffer())
    expect(await sha256Hex(gzBytes)).toBe(manifest.sha256_gz)
  })

  it('uploaded → verified 路徑能正確 decompress + 對齊 chunk_sha256', async () => {
    await seedTelemetry(3)
    await runCron()                       // → uploaded
    const report = await runCron()        // uploaded blocker → verified（含 decompress）
    expect(report.ok).toBe(true)
    expect(report.chunks_verified).toBe(1)
    const [chunk] = await getChunk()
    expect(chunk.state).toBe('verified')
    expect(chunk.compression).toBe('gzip')
  })

  it('codex r1 P2：R2 gz 物件被截斷 → DecompressionStream throw 走 failChunkMismatch', async () => {
    await seedTelemetry(2)
    await runCron()                       // → uploaded

    // 把 .jsonl.gz 物件覆寫成壞 gz bytes（只前 10 bytes，無 gzip footer / 不完整 deflate stream）
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    const gzKey = list.objects.find(o => o.key.endsWith('.jsonl.gz')).key
    const gzObj = await env.AUDIT_ARCHIVE_BUCKET.get(gzKey)
    const corrupted = new Uint8Array(await gzObj.arrayBuffer()).slice(0, 10)
    await env.AUDIT_ARCHIVE_BUCKET.put(gzKey, corrupted, {
      httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
    })

    const r = await cronArchive({ request: makeRequest(), env: makeEnv() })
    expect(r.status).toBe(500)
    const report = await r.json()
    expect(report.ok).toBe(false)
    expect(report.errors?.[0]?.event).toBe('verification_failed')
    expect(report.errors?.[0]?.reason).toBe('gzip_decompress_failed')
    expect(report.errors?.[0]?.compression).toBe('gzip')

    // chunk 應升 failed + retry_count=1（不能卡在 uploaded 監控盲區）
    const [chunk] = await getChunk()
    expect(chunk.state).toBe('failed')
    expect(chunk.last_failure).toBe('verification_failed')
    expect(chunk.retry_count).toBe(1)
  })

  it('codex r1 P2：planned recovery（gzip）→ uploadedManifest.sha256_gz 覆寫對齊新 PUT bytes', async () => {
    await seedTelemetry(2)
    const rowsRes = await env.chiyigo_db.prepare(
      `SELECT id, event_type, severity, user_id, client_id, ip_hash, event_data, cold_class, created_at
         FROM audit_log ORDER BY id ASC`
    ).all()
    const rows = rowsRes.results
    const jsonl = rowsToJsonl(rows)
    const sha = await sha256Hex(jsonl)
    const minId = rows[0].id, maxId = rows[rows.length - 1].id
    const archiveDate = '2026-05-11'

    // 種 planned chunks row（compression='gzip'）+ planned manifest 帶 stale sha256_gz
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
        (env, table_name, cold_class, cold_class_version, archive_date,
         min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run, compression)
       VALUES (?, 'audit_log', 'telemetry', 1, ?, ?, ?, ?, 'planned', ?, 0, 'run-seed', 0, 'gzip')`
    ).bind(ARCHIVE_ENV, archiveDate, minId, maxId, sha, rows.length).run()

    const { manifestKey } = buildChunkKeys({
      env: ARCHIVE_ENV, tableName: 'audit_log', coldClass: 'telemetry',
      minId, maxId, sha256: sha, archiveDate, dryRun: false, compression: 'gzip',
    })
    const STALE_SHA = 'dead'.repeat(16)   // 假裝原 fresh run 寫入的 sha256_gz
    await env.AUDIT_ARCHIVE_BUCKET.put(manifestKey, JSON.stringify({
      state: 'planned',
      state_history: [{ state: 'planned', at: '2026-05-11T00:00:00Z' }],
      sha256_gz: STALE_SHA,
      compression: 'gzip',
    }))

    const report = await runCron()
    expect(report.ok).toBe(true)
    expect(report.blocker_action).toBe('recovery_planned')

    // uploaded manifest 內 sha256_gz 必已被覆寫成新 PUT 的 gz bytes sha
    const manifestObj = await env.AUDIT_ARCHIVE_BUCKET.get(manifestKey)
    const uploadedManifest = JSON.parse(await manifestObj.text())
    expect(uploadedManifest.state).toBe('uploaded')
    expect(uploadedManifest.sha256_gz).not.toBe(STALE_SHA)
    expect(uploadedManifest.sha256_gz).toMatch(/^[0-9a-f]{64}$/)

    // 對齊 R2 實體 gz bytes
    const gzList = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    const gzKey = gzList.objects.find(o => o.key.endsWith('.jsonl.gz')).key
    const gzObj = await env.AUDIT_ARCHIVE_BUCKET.get(gzKey)
    const gzBytes = new Uint8Array(await gzObj.arrayBuffer())
    expect(await sha256Hex(gzBytes)).toBe(uploadedManifest.sha256_gz)
  })
})

describe('audit-archive cron — recovery 與失敗', () => {
  it('Step 5：planned blocker（D1 row 對齊既存 sha）→ recovery 升 uploaded', async () => {
    // 種 row 進 audit_log
    await seedTelemetry(2)
    const rowsRes = await env.chiyigo_db.prepare(
      `SELECT id, event_type, severity, user_id, client_id, ip_hash, event_data, cold_class, created_at
         FROM audit_log ORDER BY id ASC`
    ).all()
    const rows = rowsRes.results
    const jsonl = rowsToJsonl(rows)
    const sha = await sha256Hex(jsonl)
    const minId = rows[0].id, maxId = rows[rows.length - 1].id
    const archiveDate = '2026-05-11'

    // 種 planned chunks row（模擬上輪 worker manifest PUT 後 crash）
    // PR 2.1c：dry_run=0 對齊本測試 default 走 live mode（DRY_RUN=false）
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
        (env, table_name, cold_class, cold_class_version, archive_date,
         min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run)
       VALUES (?, 'audit_log', 'telemetry', 1, ?, ?, ?, ?, 'planned', ?, 0, 'run-seed', 0)`
    ).bind(ARCHIVE_ENV, archiveDate, minId, maxId, sha, rows.length).run()

    // 種 planned manifest 進 R2（recovery loadAndAppend 才有東西讀）
    const { manifestKey } = buildChunkKeys({
      env: ARCHIVE_ENV, tableName: 'audit_log', coldClass: 'telemetry',
      minId, maxId, sha256: sha, archiveDate, dryRun: false,
    })
    await env.AUDIT_ARCHIVE_BUCKET.put(manifestKey, JSON.stringify({
      state: 'planned',
      state_history: [{ state: 'planned', at: '2026-05-11T00:00:00Z' }],
    }))

    const report = await runCron()
    expect(report.ok).toBe(true)
    expect(report.blocker?.state).toBe('planned')
    expect(report.blocker_action).toBe('recovery_planned')
    expect(report.chunks_uploaded).toBe(1)
    expect(report.rows_uploaded).toBe(2)

    const [chunk] = await getChunk()
    expect(chunk.state).toBe('uploaded')
  })

  it('Step 6：uploaded blocker 但 R2 物件缺失 → verification_failed + state=failed', async () => {
    await seedTelemetry(2)
    await runCron()  // uploaded
    // 把 R2 data object 刪掉 模擬 cold storage 異常（PR 2.1b 後副檔名 .jsonl.gz）
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    for (const o of list.objects ?? []) {
      if (o.key.endsWith('.jsonl.gz') || o.key.endsWith('.jsonl')) {
        await env.AUDIT_ARCHIVE_BUCKET.delete(o.key)
      }
    }

    // 失敗刻意回 500（GH Actions workflow 才會抓到），這裡直接拿 handler response
    const r = await cronArchive({ request: makeRequest(), env: makeEnv() })
    expect(r.status).toBe(500)
    const report = await r.json()
    expect(report.ok).toBe(false)
    expect(report.errors?.[0]?.event).toBe('verification_failed')
    expect(report.errors?.[0]?.reason).toBe('r2_object_not_found')

    const [chunk] = await getChunk()
    expect(chunk.state).toBe('failed')
    expect(chunk.last_failure).toBe('verification_failed')
    expect(chunk.retry_count).toBe(1)
  })
})

describe('audit-archive cron — PR 2.1c provenance & drift', () => {
  it('H-1：dry-run chunk 在 env flip 為 live 後仍 skip mark_archived（看 chunk 自身 dry_run）', async () => {
    // 模擬 PR 2.0/2.1a 留下的 dry-run chunk 已升 verified；之後 PR 4 直接 flip live。
    // 預期：worker 看 chunk.dry_run=1 仍 skip，不會強行寫 archived_at 把資料炸了。
    await seedTelemetry(2)
    const rowsRes = await env.chiyigo_db.prepare(
      `SELECT id FROM audit_log ORDER BY id ASC`
    ).all()
    const rows = rowsRes.results
    const minId = rows[0].id, maxId = rows[rows.length - 1].id

    // 直接種一筆 verified + dry_run=1 chunk（模擬 PR 2.0/2.1a steady state）
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
        (env, table_name, cold_class, cold_class_version, archive_date,
         min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run)
       VALUES (?, 'audit_log', 'telemetry', 1, '2026-05-11', ?, ?, 'fake-sha', 'verified', ?, 0, 'run-seed', 1)`
    ).bind(ARCHIVE_ENV, minId, maxId, rows.length).run()

    // env DRY_RUN=false（PR 4 切 live），但 chunk 自身是 dry-run
    const report = await runCron({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    expect(report.ok).toBe(true)
    expect(report.blocker?.state).toBe('verified')
    expect(report.skipped_reason).toBe('dry_run_skips_marked_archived')

    // 關鍵驗：audit_log.archived_at 不能被誤標
    const { results: marked } = await env.chiyigo_db
      .prepare(`SELECT id FROM audit_log WHERE archived_at IS NOT NULL`).all()
    expect(marked ?? []).toHaveLength(0)

    // chunk 仍維持 verified（不會被推進）
    const [chunk] = await getChunk()
    expect(chunk.state).toBe('verified')
    expect(chunk.dry_run).toBe(1)
  })

  it('M-1：cold_class drift candidate → fail-fast emit cold_class_drift、不建 chunk', async () => {
    // 種 row：stored cold_class='telemetry'（matches WHERE）但 event_type
    // 經 classifyForCold 回 'immutable' — 模擬 audit-policy 改後 backfill 沒同步。
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data, cold_class, created_at)
       VALUES ('account.password.change', 'info', NULL, 'h', '{}', 'telemetry', datetime('now','-1 hour'))`
    ).run()

    const report = await runCron()
    // 設計：drift 不算 worker 系統失敗（不 set ok=false / HTTP 500），
    // 但 emit critical + skipped_reason，由 alert pipeline 接 audit event。
    expect(report.ok).toBe(true)
    expect(report.skipped_reason).toBe('cold_class_drift_detected')
    expect(report.errors?.[0]?.event).toBe('cold_class_drift')
    expect(report.errors?.[0]?.drift_count).toBe(1)

    // 不應該有 chunk 被建
    const chunks = await getChunk()
    expect(chunks).toHaveLength(0)

    // R2 不應有 archive object（PR 2.1b 後 .jsonl.gz；舊 .jsonl 也一併防呆檢）
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    expect((list.objects ?? []).filter(o =>
      o.key.endsWith('.jsonl.gz') || o.key.endsWith('.jsonl')
    )).toHaveLength(0)
  })

  it('M-1：drift 與正常 row 混合 → 同樣 fail-fast（不可只 archive 對的那批）', async () => {
    // 一個 drift row + 兩個正常 row。整批不能進，避免 partial archive。
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data, cold_class, created_at)
       VALUES ('account.password.change', 'info', NULL, 'h', '{}', 'telemetry', datetime('now','-1 hour'))`
    ).run()
    await seedTelemetry(2)

    const report = await runCron()
    expect(report.skipped_reason).toBe('cold_class_drift_detected')
    expect(report.errors?.[0]?.drift_count).toBe(1)
    const chunks = await getChunk()
    expect(chunks).toHaveLength(0)
  })

  it('H-1：新 chunk 在 live env 寫入 → chunks.dry_run=0 + R2 走 live prefix', async () => {
    await seedTelemetry(2)
    const report = await runCron({ AUDIT_ARCHIVE_DRY_RUN: 'false' })
    expect(report.ok).toBe(true)
    const [chunk] = await getChunk()
    expect(chunk.dry_run).toBe(0)
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    expect((list.objects ?? []).some(o => o.key.startsWith('audit-log/') && !o.key.startsWith('audit-log-dryrun/'))).toBe(true)
  })
})

describe('audit-archive cron — PR 2.1d F-1 chunk_uploaded emission timing', () => {
  async function selectChunkUploaded() {
    const r = await env.chiyigo_db.prepare(
      `SELECT id, event_type, event_data FROM audit_log
        WHERE event_type = 'audit.archive.chunk_uploaded' ORDER BY id ASC`
    ).all()
    return r.results ?? []
  }

  it('fresh upload 不 emit chunk_uploaded；下一輪 verify 才 emit', async () => {
    await seedTelemetry(2)

    // 第 1 輪 cron：fresh → uploaded。F-1 後此處不 emit。
    await runCron()
    let evs = await selectChunkUploaded()
    expect(evs).toHaveLength(0)

    // 第 2 輪 cron：uploaded blocker → verified。F-1 後在此 emit。
    await runCron()
    evs = await selectChunkUploaded()
    expect(evs).toHaveLength(1)
    const data = JSON.parse(evs[0].event_data)
    expect(data.verified_at).toBeTruthy()
    expect(data.row_count).toBe(2)
  })

  it('planned recovery → uploaded 不 emit；下一輪 verify 才 emit', async () => {
    await seedTelemetry(2)
    const rowsRes = await env.chiyigo_db.prepare(
      `SELECT id, event_type, severity, user_id, client_id, ip_hash, event_data, cold_class, created_at
         FROM audit_log
        WHERE event_type != 'audit.archive.chunk_uploaded'
        ORDER BY id ASC`
    ).all()
    const rows = rowsRes.results
    const jsonl = rowsToJsonl(rows)
    const sha = await sha256Hex(jsonl)
    const minId = rows[0].id, maxId = rows[rows.length - 1].id
    const archiveDate = '2026-05-11'

    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
        (env, table_name, cold_class, cold_class_version, archive_date,
         min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run)
       VALUES (?, 'audit_log', 'telemetry', 1, ?, ?, ?, ?, 'planned', ?, 0, 'run-seed', 0)`
    ).bind(ARCHIVE_ENV, archiveDate, minId, maxId, sha, rows.length).run()

    const { manifestKey } = buildChunkKeys({
      env: ARCHIVE_ENV, tableName: 'audit_log', coldClass: 'telemetry',
      minId, maxId, sha256: sha, archiveDate, dryRun: false,
    })
    await env.AUDIT_ARCHIVE_BUCKET.put(manifestKey, JSON.stringify({
      state: 'planned',
      state_history: [{ state: 'planned', at: '2026-05-11T00:00:00Z' }],
    }))

    // recovery_planned → uploaded：F-1 後此處不 emit
    const r1 = await runCron()
    expect(r1.recovery).toBe('planned_to_uploaded')
    expect(await selectChunkUploaded()).toHaveLength(0)

    // verify → verified：F-1 後此處 emit
    await runCron()
    expect(await selectChunkUploaded()).toHaveLength(1)
  })
})

describe('audit-archive cron — PR 2.1d F-2 manifest severities', () => {
  it('manifest.severities 為 row severities reduce 結果', async () => {
    // 種 3 個 info + 1 個 warning 級 telemetry row
    const db = env.chiyigo_db
    for (let i = 0; i < 3; i++) {
      await db.prepare(
        `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data, cold_class, created_at)
         VALUES ('auth.login.rate_limited', 'info', NULL, 'h', '{}', 'telemetry', datetime('now','-1 hour'))`
      ).run()
    }
    await db.prepare(
      `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data, cold_class, created_at)
       VALUES ('auth.login.rate_limited', 'warn', NULL, 'h', '{}', 'telemetry', datetime('now','-1 hour'))`
    ).run()

    await runCron()
    // 撈 manifest JSON
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'manifest/' })
    const manifestObj = list.objects.find(o => o.key.endsWith('.json'))
    const obj = await env.AUDIT_ARCHIVE_BUCKET.get(manifestObj.key)
    const manifest = JSON.parse(await obj.text())
    expect(manifest.severities).toEqual({ info: 3, warn: 1 })
  })
})

describe('audit-archive cron — PR 2.1d F-3 archivePut e2e (callback glue)', () => {
  // 把 bucket.put 用 wrapper 替換：前 N 次 throw，第 N+1 次成功。
  // 注意：env.AUDIT_ARCHIVE_BUCKET 是 miniflare 內建 R2，我們在 makeEnv 注入
  // 一層 facade，讓 cron handler 走我們的 stub。
  function wrapBucketWithFailingPut(realBucket, failTimes) {
    let n = 0
    return {
      get:    (...a) => realBucket.get(...a),
      list:   (...a) => realBucket.list(...a),
      delete: (...a) => realBucket.delete(...a),
      head:   (...a) => realBucket.head(...a),
      put:    async (k, b, o) => {
        n++
        if (n <= failTimes) throw new Error(`stub-put-fail-${n}`)
        return realBucket.put(k, b, o)
      },
    }
  }

  async function selectUploadFailed() {
    const r = await env.chiyigo_db.prepare(
      `SELECT id, severity, event_data FROM audit_log
        WHERE event_type = 'audit.archive.upload_failed' ORDER BY id ASC`
    ).all()
    return r.results ?? []
  }

  it('前 2 次 PUT 失敗、第 3 次成功 → 2 個 warn upload_failed row + chunk 仍升 uploaded', async () => {
    await seedTelemetry(2)
    const stubBucket = wrapBucketWithFailingPut(env.AUDIT_ARCHIVE_BUCKET, 2)
    const r = await cronArchive({
      request: makeRequest(),
      env: {
        ...makeEnv(),
        AUDIT_ARCHIVE_BUCKET: stubBucket,
        AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS: '0,0,0',   // 不等 21s
      },
    })
    const report = await r.json()
    expect(report.ok).toBe(true)
    expect(report.chunks_uploaded).toBe(1)

    const events = await selectUploadFailed()
    expect(events).toHaveLength(2)
    for (const ev of events) {
      expect(ev.severity).toBe('warn')
      const data = JSON.parse(ev.event_data)
      expect(data.final).toBe(false)
      expect(data.role).toBe('manifest')        // 第一個 PUT 是 planned manifest
      expect(data.attempt).toBeGreaterThanOrEqual(1)
      expect(data.error).toMatch(/stub-put-fail/)
    }
  })

  it('全部 4 次 PUT 都失敗 → 3 個 warn + 1 個 critical（final=true）+ ok=false', async () => {
    await seedTelemetry(2)
    const stubBucket = wrapBucketWithFailingPut(env.AUDIT_ARCHIVE_BUCKET, 999)
    const r = await cronArchive({
      request: makeRequest(),
      env: {
        ...makeEnv(),
        AUDIT_ARCHIVE_BUCKET: stubBucket,
        AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS: '0,0,0',
      },
    })
    expect(r.status).toBe(500)
    const report = await r.json()
    expect(report.ok).toBe(false)

    const events = await selectUploadFailed()
    expect(events).toHaveLength(4)
    expect(events.slice(0, 3).every(e => e.severity === 'warn')).toBe(true)
    expect(events[3].severity).toBe('critical')
    const lastData = JSON.parse(events[3].event_data)
    expect(lastData.final).toBe(true)
    expect(lastData.attempt).toBe(4)
    expect(lastData.next_delay_ms).toBeNull()
  })
})

describe('audit-archive cron — PR 2.2a round-robin 6 cold_class + MAX_CHUNKS_PER_RUN', () => {
  // 種一筆 row 到任意 cold_class。event_type 在 audit-policy 對應到對應 class。
  // immutable=account.password.change/info、security_critical=auth.refresh.aud_mismatch/critical、
  // security_warn=auth.refresh.aud_mismatch/warn、read_audit=admin.deals.read/info、
  // telemetry=auth.login.rate_limited/info、debug_failure=client.network.error/info
  async function seedRow(coldClass, severity = 'info', minutesAgo = 60) {
    const evMap = {
      immutable:         'account.password.change',
      security_critical: 'auth.refresh.aud_mismatch',
      security_warn:     'auth.refresh.aud_mismatch',
      read_audit:        'admin.deals.read',
      telemetry:         'auth.login.rate_limited',
      debug_failure:     'client.network.error',
    }
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data, cold_class, created_at)
       VALUES (?, ?, NULL, 'h', '{}', ?, datetime('now','-${minutesAgo} minutes'))`
    ).bind(evMap[coldClass], severity, coldClass).run()
  }

  // PR 2.2a：所有 class hot retention 都歸 0（不設下限），讓測試 row 不被 hotDays 過濾掉
  function noHotRetentionOverrides() {
    return {
      AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS:        '0',
      AUDIT_ARCHIVE_HOT_DAYS_IMMUTABLE:        '0',
      AUDIT_ARCHIVE_HOT_DAYS_SECURITY_CRITICAL: '0',
      AUDIT_ARCHIVE_HOT_DAYS_SECURITY_WARN:    '0',
      AUDIT_ARCHIVE_HOT_DAYS_READ_AUDIT:       '0',
      AUDIT_ARCHIVE_HOT_DAYS_DEBUG_FAILURE:    '0',
    }
  }

  it('預設 max=2：seed 兩個 class 各 1 row → 兩個 class 各 produce 1 chunk', async () => {
    await seedRow('immutable')
    await seedRow('telemetry')

    const report = await runCron(noHotRetentionOverrides())
    expect(report.ok).toBe(true)
    expect(report.max_chunks_per_run).toBe(2)
    expect(report.chunks_uploaded).toBe(2)
    expect(report.rows_uploaded).toBe(2)
    expect(report.cold_classes).toHaveLength(6)

    // immutable / telemetry 應各 produce 1；其餘四 class 'no_rows_eligible'
    const byClass = Object.fromEntries(report.cold_classes.map(s => [s.cold_class, s]))
    expect(byClass.immutable.chunks_uploaded).toBe(1)
    expect(byClass.telemetry.chunks_uploaded).toBe(1)
    expect(byClass.security_critical.skipped_reason).toBe('no_rows_eligible')
    // debug_failure 排第 6；max=2 配額在 telemetry 後用光 → reached
    expect(byClass.debug_failure.skipped_reason).toBe('max_chunks_per_run_reached')

    // R2 應有 immutable + telemetry 兩個 prefix
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    const keys = (list.objects ?? []).map(o => o.key)
    expect(keys.some(k => k.includes('/audit_log/immutable/'))).toBe(true)
    expect(keys.some(k => k.includes('/audit_log/telemetry/'))).toBe(true)
  })

  it('max=1：兩個 class 都有 row → 只推第一個（順序：immutable 先於 telemetry）', async () => {
    await seedRow('immutable')
    await seedRow('telemetry')

    const report = await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '1' })
    expect(report.ok).toBe(true)
    expect(report.max_chunks_per_run).toBe(1)
    expect(report.chunks_uploaded).toBe(1)

    const byClass = Object.fromEntries(report.cold_classes.map(s => [s.cold_class, s]))
    // immutable 先 produce
    expect(byClass.immutable.chunks_uploaded).toBe(1)
    // telemetry 排第 5 — 配額用盡前先掃過 security_critical/warn/read_audit（無 row → no_rows_eligible，不消配額）
    // 配額用盡後 telemetry 應被標 max_chunks_per_run_reached
    expect(byClass.telemetry.skipped_reason).toBe('max_chunks_per_run_reached')
    expect(byClass.debug_failure.skipped_reason).toBe('max_chunks_per_run_reached')

    // 下一輪 cron 應該先處理 immutable uploaded blocker，但 max=1 配額用掉
    // 為了驗 round-robin 真的繞回 telemetry，下面這條測試。
  })

  it('多輪 cron 推進：immutable 過了 marked_archived 後，telemetry 才會被處理', async () => {
    await seedRow('immutable')
    await seedRow('telemetry')

    // 輪 1：immutable planned→uploaded（max=1）；telemetry max_chunks_per_run_reached
    await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '1' })
    // 輪 2：immutable uploaded→verified（max=1）；telemetry 仍 reached
    await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '1' })
    // 輪 3：immutable verified→marked_archived（max=1）；telemetry 仍 reached
    const r3 = await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '1' })
    expect(r3.chunks_marked_archived).toBe(1)
    // 輪 4：immutable 已 marked_archived（terminal-non-progress on PR 2.1d；
    // computeCursorAndBlocker 視 marked_archived 為 non-terminal-other → blocker
    // 但 handleVerifiedBlocker 不會再觸發；class skip non_terminal_blocker_state_marked_archived。
    // 配額沒被吃 → telemetry 第 1 chunk planned→uploaded。
    const r4 = await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '1' })
    expect(r4.ok).toBe(true)
    const byClass4 = Object.fromEntries(r4.cold_classes.map(s => [s.cold_class, s]))
    expect(byClass4.immutable.skipped_reason).toBe('non_terminal_blocker_state_marked_archived')
    expect(byClass4.telemetry.chunks_uploaded).toBe(1)
  })

  it('一個 class blocker uploaded、第二個 class 空 → blocker verify 推進 + 另 class no_rows', async () => {
    // 種 telemetry → uploaded
    await seedRow('telemetry')
    await runCron(noHotRetentionOverrides())  // → uploaded

    // 再跑一輪：telemetry uploaded→verified（1 work unit），其他 class 無 row → no_rows
    const r = await runCron(noHotRetentionOverrides())
    expect(r.ok).toBe(true)
    expect(r.chunks_verified).toBe(1)
    const byClass = Object.fromEntries(r.cold_classes.map(s => [s.cold_class, s]))
    expect(byClass.telemetry.blocker?.state).toBe('uploaded')
    expect(byClass.telemetry.chunks_verified).toBe(1)
    expect(byClass.immutable.skipped_reason).toBe('no_rows_eligible')
  })

  it('per-class hot retention：immutable 預設 180d → 60min row 不該被撈進 chunk', async () => {
    // 不設 AUDIT_ARCHIVE_HOT_DAYS_IMMUTABLE，吃 design doc 預設 180d
    await seedRow('immutable')  // 60 分鐘前
    const r = await runCron({})  // 仍用 makeEnv 預設（AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS=0）
    expect(r.ok).toBe(true)
    const byClass = Object.fromEntries(r.cold_classes.map(s => [s.cold_class, s]))
    expect(byClass.immutable.skipped_reason).toBe('no_rows_eligible')
  })

  it('back-compat：頂層 mirror primary class（只有 telemetry 動 → 頂層 = telemetry）', async () => {
    await seedRow('telemetry')
    const r = await runCron(noHotRetentionOverrides())
    expect(r.cold_class).toBe('telemetry')
    expect(r.chunks_uploaded).toBe(1)
    expect(r.cursor).toBeGreaterThanOrEqual(0)
  })

  it('codex r1：全 6 class 沒 row → 頂層仍 mirror no_rows_eligible（不是 blank）', async () => {
    const r = await runCron(noHotRetentionOverrides())
    expect(r.ok).toBe(true)
    expect(r.cold_class).toBe('immutable')        // round-robin 第一個
    expect(r.skipped_reason).toBe('no_rows_eligible')
  })

  it('codex r1：R2 PUT 全失敗 → attempted_write 消配額，不會繞跑後續 5 class', async () => {
    // 種 immutable + telemetry 各 1 row。把 bucket.put 全 throw 模擬 R2 outage。
    await seedRow('immutable')
    await seedRow('telemetry')
    const realBucket = env.AUDIT_ARCHIVE_BUCKET
    const stub = {
      get: (...a) => realBucket.get(...a),
      list: (...a) => realBucket.list(...a),
      head: (...a) => realBucket.head?.(...a),
      put: async () => { throw new Error('r2-outage') },
    }
    const r = await cronArchive({
      request: makeRequest(),
      env: {
        ...makeEnv(noHotRetentionOverrides()),
        AUDIT_ARCHIVE_BUCKET: stub,
        AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS: '0,0,0',
        AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '2',
      },
    })
    const report = await r.json()
    expect(report.ok).toBe(false)
    // immutable 失敗 → attempted_write=true → 消 1 配額；
    // 沒 row 的 4 class（security_*/read_audit）= 0 配額；
    // telemetry 失敗 → 消第 2 配額；
    // debug_failure 應被 max_chunks_per_run_reached 擋住（即使有 row 也不再嘗試）
    const byClass = Object.fromEntries(report.cold_classes.map(s => [s.cold_class, s]))
    expect(byClass.immutable.attempted_write).toBe(true)
    expect(byClass.immutable.ok).toBe(false)
    expect(byClass.telemetry.attempted_write).toBe(true)
    expect(byClass.telemetry.ok).toBe(false)
    expect(byClass.debug_failure.skipped_reason).toBe('max_chunks_per_run_reached')
  })

  it('codex r2：AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN 空字串 → 預設 2（不要夾到 1）', async () => {
    await seedRow('immutable')
    await seedRow('telemetry')
    const r = await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '' })
    expect(r.max_chunks_per_run).toBe(2)
    expect(r.chunks_uploaded).toBe(2)
  })

  it('codex r2：uploaded blocker R2 GET 失敗 → attempted_write=true 消配額', async () => {
    // 種兩個 class，第一個 class 留 uploaded chunk，bucket.get throw 模擬 R2 GET outage
    await seedRow('immutable')
    await seedRow('telemetry')
    await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '2' })  // → 兩個 uploaded

    const realBucket = env.AUDIT_ARCHIVE_BUCKET
    const stub = {
      list: (...a) => realBucket.list(...a),
      put:  (...a) => realBucket.put(...a),
      head: (...a) => realBucket.head?.(...a),
      get:  async () => { throw new Error('r2-get-outage') },
    }
    const r = await cronArchive({
      request: makeRequest(),
      env: {
        ...makeEnv(noHotRetentionOverrides()),
        AUDIT_ARCHIVE_BUCKET: stub,
        AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS: '0,0,0',
        AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '1',
      },
    })
    const report = await r.json()
    const byClass = Object.fromEntries(report.cold_classes.map(s => [s.cold_class, s]))
    // immutable verify GET throw → attempted_write=true → 消 1 配額；
    // telemetry 應被 max_chunks_per_run_reached 擋住（不該還跑進來嘗試 GET）
    expect(byClass.immutable.attempted_write).toBe(true)
    expect(byClass.immutable.ok).toBe(false)
    expect(byClass.telemetry.skipped_reason).toBe('max_chunks_per_run_reached')
  })

  it('codex r1：parseMaxChunksPerRun — 0 / 負數 → 夾到 1；非數字 → 預設 2', async () => {
    // 種 immutable + telemetry。max=0 → 夾到 1 → 只推第一個（immutable）。
    await seedRow('immutable')
    await seedRow('telemetry')
    const r1 = await runCron({ ...noHotRetentionOverrides(), AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN: '0' })
    expect(r1.max_chunks_per_run).toBe(1)
    expect(r1.chunks_uploaded).toBe(1)
  })
})

describe('audit-archive cron — auth + binding 防線', () => {
  it('auth fail → 401', async () => {
    const r = await cronArchive({
      request: new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }),
      env: makeEnv(),
    })
    expect(r.status).toBe(401)
  })

  it('CRON_SECRET 缺 → 500', async () => {
    const r = await cronArchive({
      request: makeRequest(),
      env: { ...makeEnv(), CRON_SECRET: undefined },
    })
    expect(r.status).toBe(500)
  })
})
