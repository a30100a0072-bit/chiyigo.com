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
import { onRequestPost as cronArchive } from '../../functions/api/admin/cron/audit-archive.js'
import {
  rowsToJsonl,
  sha256Hex,
  buildChunkKeys,
} from '../../functions/utils/audit-archive.js'

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

    // R2 應有 data + manifest
    const dataKey = `audit-log/${ARCHIVE_ENV}/audit_log/telemetry/`
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    expect(list.objects?.some(o => o.key.startsWith(dataKey) && o.key.endsWith('.jsonl'))).toBe(true)
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
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
        (env, table_name, cold_class, cold_class_version, archive_date,
         min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id)
       VALUES (?, 'audit_log', 'telemetry', 1, ?, ?, ?, ?, 'planned', ?, 0, 'run-seed')`
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
    // 把 R2 data object 刪掉 模擬 cold storage 異常
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ prefix: 'audit-log/' })
    for (const o of list.objects ?? []) {
      if (o.key.endsWith('.jsonl')) await env.AUDIT_ARCHIVE_BUCKET.delete(o.key)
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
