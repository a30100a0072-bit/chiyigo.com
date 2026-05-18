/**
 * F-3 Phase 2 PR 2.2b — admin retry endpoint 整合測試
 *
 * 路徑：POST /api/admin/audit-archive/retry
 *
 * 蓋三個 action + 護欄：
 *   - re_verify    : failed → uploaded（strict WHERE 帶完整 target key）
 *   - mark_resolved: failed → blacklisted
 *   - force_purge  : PR 2.3 真實作（step-up + PURGE_ENABLED env flag；flag 未設 → 503
 *                    PURGE_DISABLED + emit force_purge_disabled warn，R2/chunks 全不動）
 *
 * 防線：
 *   - auth 401 / role 不夠 403
 *   - body schema 不完整 / 非白名單 action 400
 *   - chunk 不存在 → 404 CHUNK_NOT_FOUND
 *   - chunk 存在但 state !== 'failed' → 409 CHUNK_STATE_MISMATCH
 *   - admin_audit_log hash chain 一定有 row
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt'
import { onRequestPost as retryHandler } from '../../functions/api/admin/audit-archive/retry'

async function adminToken(userId, role = 'admin') {
  return signJwt(
    { sub: String(userId), email: 'a@x', role, status: 'active', ver: 0 },
    '15m', env, { audience: 'chiyigo' },
  )
}

// PR 2.2b codex r1（P1）：mark_resolved / force_purge 改吃 step-up token
// （elevated:account scope claim + for_action 對齊）。一般 admin access token 不行。
async function adminStepUpToken(userId, forAction) {
  return signJwt(
    { sub: String(userId), email: 'a@x', role: 'admin', status: 'active', ver: 0,
      scope: 'elevated:account', for_action: forAction,
      amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
    '5m', env,
  )
}

async function callRetry({ token, body }) {
  const headers = token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
  const req = new Request('http://x/api/admin/audit-archive/retry', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const r = await retryHandler({ request: req, env })
  return { status: r.status, body: await r.json() }
}

// 種一筆 audit_archive_chunks row，預設 state='failed'
async function seedChunk(overrides = {}) {
  const t = {
    env: 'test',
    table_name: 'audit_log',
    cold_class: 'telemetry',
    archive_date: '2026-05-11',
    min_id: 1,
    max_id: 100,
    chunk_sha256: 'a'.repeat(64),
    state: 'failed',
    row_count: 50,
    retry_count: 1,
    dry_run: 0,
    ...overrides,
  }
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_archive_chunks
      (env, table_name, cold_class, cold_class_version, archive_date,
       min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'run-seed', ?)`
  ).bind(
    t.env, t.table_name, t.cold_class, t.archive_date,
    t.min_id, t.max_id, t.chunk_sha256, t.state, t.row_count, t.retry_count, t.dry_run,
  ).run()
  return t
}

function targetOf(chunk) {
  return {
    env: chunk.env,
    table_name: chunk.table_name,
    cold_class: chunk.cold_class,
    archive_date: chunk.archive_date,
    min_id: chunk.min_id,
    max_id: chunk.max_id,
    chunk_sha256: chunk.chunk_sha256,
  }
}

async function getChunkState(chunk) {
  const r = await env.chiyigo_db.prepare(
    `SELECT state, retry_count FROM audit_archive_chunks
      WHERE env=? AND table_name=? AND cold_class=? AND archive_date=?
        AND min_id=? AND max_id=? AND chunk_sha256=?`
  ).bind(chunk.env, chunk.table_name, chunk.cold_class, chunk.archive_date,
         chunk.min_id, chunk.max_id, chunk.chunk_sha256).first()
  return r
}

async function selectAudit(eventType) {
  const r = await env.chiyigo_db.prepare(
    `SELECT severity, event_data FROM audit_log
      WHERE event_type = ? ORDER BY id DESC`
  ).bind(eventType).all()
  return r.results ?? []
}

async function adminAuditRows(action) {
  const r = await env.chiyigo_db.prepare(
    `SELECT action, target_id, target_email, row_hash, prev_hash
       FROM admin_audit_log WHERE action = ? ORDER BY id DESC`
  ).bind(action).all()
  return r.results ?? []
}

describe('admin retry endpoint — auth / role / scope', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('no token → 401', async () => {
    const r = await callRetry({ body: { action: 're_verify', target: {} } })
    expect(r.status).toBe(401)
  })

  it('non-admin role → 403', async () => {
    const { id } = await seedUser({ email: 'p@x', role: 'player' })
    const tok = await adminToken(id, 'player')
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: {} } })
    expect(r.status).toBe(403)
  })
})

describe('admin retry endpoint — schema validation', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('invalid action → 400 + retry_rejected warn', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await callRetry({ token: tok, body: { action: 'restart_world', target: {} } })
    expect(r.status).toBe(400)
    const evs = await selectAudit('audit.archive.retry_rejected')
    expect(evs.length).toBeGreaterThan(0)
    expect(evs[0].severity).toBe('warn')
    expect(JSON.parse(evs[0].event_data).reason).toBe('invalid_action')
  })

  it('missing target → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await callRetry({ token: tok, body: { action: 're_verify' } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/target/)
  })

  it('target.cold_class 不在白名單 → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedChunk())
    t.cold_class = 'fake_class'
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/cold_class/)
  })

  it('target.chunk_sha256 非 64-char hex → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedChunk())
    t.chunk_sha256 = 'short'
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t } })
    expect(r.status).toBe(400)
  })

  it('target.max_id < min_id → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedChunk())
    t.max_id = t.min_id - 1
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t } })
    expect(r.status).toBe(400)
  })
})

describe('admin retry endpoint — re_verify happy path + 護欄', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('failed → uploaded；retry_count 保留；emit retry_succeeded info；admin_audit_log 寫入', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const chunk = await seedChunk({ retry_count: 3 })

    const r = await callRetry({ token: tok, body: { action: 're_verify', target: targetOf(chunk) } })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.from_state).toBe('failed')
    expect(r.body.to_state).toBe('uploaded')

    // PR 2.2b codex r1（P2）：response 明寫 archived:false / blocks_cursor:true / message
    expect(r.body.archived).toBe(false)
    expect(r.body.blocks_cursor).toBe(true)
    expect(r.body.message).toMatch(/retry|verification/i)

    const after = await getChunkState(chunk)
    expect(after.state).toBe('uploaded')
    expect(after.retry_count).toBe(3)  // 保留歷史，不清零

    const succ = await selectAudit('audit.archive.retry_succeeded')
    expect(succ.length).toBe(1)
    expect(succ[0].severity).toBe('info')
    const succData = JSON.parse(succ[0].event_data)
    expect(succData.transition).toBe('failed_to_uploaded')
    expect(succData.archived).toBe(false)
    expect(succData.blocks_cursor).toBe(true)

    const adminRows = await adminAuditRows('audit_archive.retry.re_verify')
    expect(adminRows.length).toBe(1)
    expect(adminRows[0].target_id).toBe(0)
    expect(adminRows[0].target_email).toMatch(/^chunk:/)
    expect(adminRows[0].row_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('chunk 不存在 → 404 CHUNK_NOT_FOUND + retry_rejected', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedChunk())
    t.min_id = 9999  // 不存在的 id range
    t.max_id = 99999
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t } })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('CHUNK_NOT_FOUND')
    const rej = await selectAudit('audit.archive.retry_rejected')
    expect(JSON.parse(rej[0].event_data).reason).toBe('chunk_not_found')
  })

  it('chunk 存在但 state=uploaded → 409 CHUNK_STATE_MISMATCH（嚴格只允許 failed）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const chunk = await seedChunk({ state: 'uploaded' })
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: targetOf(chunk) } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('CHUNK_STATE_MISMATCH')
    expect(r.body.actual_state).toBe('uploaded')
    // 護欄關鍵：chunk state 不能被偷偷改掉
    expect((await getChunkState(chunk)).state).toBe('uploaded')
    const rej = await selectAudit('audit.archive.retry_rejected')
    expect(JSON.parse(rej[0].event_data).reason).toMatch(/state_not_failed:uploaded/)
  })

  it('chunk 存在 + state=verified → 409（保護更晚的狀態不被踩回）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const chunk = await seedChunk({ state: 'verified' })
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: targetOf(chunk) } })
    expect(r.status).toBe(409)
    expect((await getChunkState(chunk)).state).toBe('verified')
  })

  it('target sha256 不對 → 404（複合 PK 任一不符都當不存在）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedChunk())
    t.chunk_sha256 = 'b'.repeat(64)
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t } })
    expect(r.status).toBe(404)
  })
})

describe('admin retry endpoint — mark_resolved（step-up required）', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('PR 2.2b codex r1 P1：普通 admin token → 403 STEP_UP_REQUIRED', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)  // 沒 elevated:account
    const chunk = await seedChunk()
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk) } })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('STEP_UP_REQUIRED')
    // chunk state 不能動
    expect((await getChunkState(chunk)).state).toBe('failed')
    // 留 audit row（admin role + scope 已過，知道誰嘗試了）
    const rej = await selectAudit('audit.archive.retry_rejected')
    expect(rej.length).toBeGreaterThan(0)
    expect(JSON.parse(rej[0].event_data).reason).toMatch(/step_up_required/)
  })

  it('PR 2.2b codex r1 P1：step-up token for_action 不對 → 403 STEP_UP_ACTION_MISMATCH', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'wrong_action')
    const chunk = await seedChunk()
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk) } })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('STEP_UP_ACTION_MISMATCH')
  })

  it('step-up token → failed → blacklisted；transition 標 failed_to_blacklisted（非 archived）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_mark_resolved')
    const chunk = await seedChunk()
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk) } })
    expect(r.status).toBe(200)
    expect(r.body.to_state).toBe('blacklisted')

    // PR 2.2b codex r1（P2）：response 明寫 archived:false / blocks_cursor:true / message
    expect(r.body.archived).toBe(false)
    expect(r.body.blocks_cursor).toBe(true)
    expect(r.body.message).toMatch(/NOT archived/)

    // PR 2.2b codex r1（P3）：blacklisted_at / last_failure 寫入 chunks row
    const after = await env.chiyigo_db.prepare(
      `SELECT state, blacklisted_at, last_failure, last_failure_at FROM audit_archive_chunks
        WHERE env=? AND table_name=? AND cold_class=? AND archive_date=?
          AND min_id=? AND max_id=? AND chunk_sha256=?`
    ).bind(chunk.env, chunk.table_name, chunk.cold_class, chunk.archive_date,
           chunk.min_id, chunk.max_id, chunk.chunk_sha256).first()
    expect(after.state).toBe('blacklisted')
    expect(after.blacklisted_at).toBeTruthy()
    expect(after.last_failure).toBe('admin_mark_resolved')
    expect(after.last_failure_at).toBeTruthy()

    const succ = await selectAudit('audit.archive.retry_succeeded')
    const data = JSON.parse(succ[0].event_data)
    expect(data.transition).toBe('failed_to_blacklisted')
    expect(data.action).toBe('mark_resolved')
    expect(data.to_state).toBe('blacklisted')
    expect(data.archived).toBe(false)
    expect(data.blocks_cursor).toBe(true)

    const adminRows = await adminAuditRows('audit_archive.retry.mark_resolved')
    expect(adminRows.length).toBe(1)
  })

  it('對 uploaded chunk 用 mark_resolved → 409（同 re_verify 嚴格性）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_mark_resolved')
    const chunk = await seedChunk({ state: 'uploaded' })
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk) } })
    expect(r.status).toBe(409)
    expect((await getChunkState(chunk)).state).toBe('uploaded')
  })
})

describe('admin retry endpoint — force_purge（PR 2.3 真實作；step-up + env flag）', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    // 清 R2 — purge 測試會 seed 真實 R2 object
    const list = await env.AUDIT_ARCHIVE_BUCKET.list({ limit: 1000 })
    for (const o of list.objects ?? []) await env.AUDIT_ARCHIVE_BUCKET.delete(o.key)
  })

  // 模擬 prod 設了 AUDIT_ARCHIVE_PURGE_ENABLED='1' 的 env（test env override）
  function purgeEnv() {
    return { ...env, AUDIT_ARCHIVE_PURGE_ENABLED: '1' }
  }
  async function callRetryWithEnv({ token, body, envObj }) {
    const req = new Request('http://x/api/admin/audit-archive/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const r = await retryHandler({ request: req, env: envObj })
    return { status: r.status, body: await r.json() }
  }

  // 把 chunk 對應的 R2 key 兩個物件種起來（與 deriveKeysFromChunk 對齊）
  async function seedR2ForChunk(chunk, { compression = 'none', dryRun = false } = {}) {
    const [yyyy, mm, dd] = chunk.archive_date.split('-')
    const tail = `${chunk.min_id}-${chunk.max_id}-${chunk.chunk_sha256}`
    const dataPrefix     = dryRun ? 'audit-log-dryrun' : 'audit-log'
    const manifestPrefix = dryRun ? 'manifest-dryrun'  : 'manifest'
    const ext = compression === 'gzip' ? '.jsonl.gz' : '.jsonl'
    const dataKey     = `${dataPrefix}/${chunk.env}/${chunk.table_name}/${chunk.cold_class}/${yyyy}/${mm}/${dd}/${tail}${ext}`
    const manifestKey = `${manifestPrefix}/${chunk.env}/${chunk.table_name}/${chunk.cold_class}/${yyyy}/${mm}/${dd}/${tail}.json`
    await env.AUDIT_ARCHIVE_BUCKET.put(dataKey,     new Uint8Array([1, 2, 3]))
    await env.AUDIT_ARCHIVE_BUCKET.put(manifestKey, JSON.stringify({ state: 'verified' }))
    return { dataKey, manifestKey }
  }

  it('普通 admin token → 403 STEP_UP_REQUIRED（不會 emit force_purge_requested）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const chunk = await seedChunk({ state: 'blacklisted' })
    const r = await callRetry({ token: tok, body: { action: 'force_purge', target: targetOf(chunk) } })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('STEP_UP_REQUIRED')
    const critEvs = await selectAudit('audit.archive.force_purge_requested')
    expect(critEvs.length).toBe(0)
  })

  it('env flag 未設 → 503 PURGE_DISABLED + emit force_purge_disabled warn；R2 / chunks 全不動', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_force_purge')
    const chunk = await seedChunk({ state: 'blacklisted' })
    const seeded = await seedR2ForChunk(chunk)

    const r = await callRetry({ token: tok, body: { action: 'force_purge', target: targetOf(chunk) } })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('PURGE_DISABLED')
    expect(r.body.archived).toBe(false)
    expect(r.body.blocks_cursor).toBe(true)

    // chunk row 與 R2 obj 一動不動
    expect((await getChunkState(chunk)).state).toBe('blacklisted')
    expect(await env.AUDIT_ARCHIVE_BUCKET.get(seeded.dataKey)).not.toBeNull()
    expect(await env.AUDIT_ARCHIVE_BUCKET.get(seeded.manifestKey)).not.toBeNull()

    // requested critical 已 emit（為 admin 留申請紀錄），disabled warn 也 emit
    const reqEv = await selectAudit('audit.archive.force_purge_requested')
    expect(reqEv.length).toBe(1)
    expect(reqEv[0].severity).toBe('critical')
    const disEv = await selectAudit('audit.archive.force_purge_disabled')
    expect(disEv.length).toBe(1)
    expect(disEv[0].severity).toBe('warn')

    // admin_audit_log hash chain row 留著
    const adminRows = await adminAuditRows('audit_archive.retry.force_purge')
    expect(adminRows.length).toBe(1)
  })

  it('chunk state != blacklisted → 409 CHUNK_STATE_MISMATCH（要先 mark_resolved）；R2 不動', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_force_purge')
    const chunk = await seedChunk({ state: 'failed' })
    const seeded = await seedR2ForChunk(chunk)

    const r = await callRetryWithEnv({ token: tok, body: { action: 'force_purge', target: targetOf(chunk) }, envObj: purgeEnv() })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('CHUNK_STATE_MISMATCH')
    expect(r.body.actual_state).toBe('failed')

    expect((await getChunkState(chunk)).state).toBe('failed')
    expect(await env.AUDIT_ARCHIVE_BUCKET.get(seeded.dataKey)).not.toBeNull()
    expect(await env.AUDIT_ARCHIVE_BUCKET.get(seeded.manifestKey)).not.toBeNull()

    const rej = await selectAudit('audit.archive.retry_rejected')
    expect(rej.length).toBeGreaterThan(0)
    expect(JSON.parse(rej[0].event_data).reason).toMatch(/state_not_blacklisted/)
  })

  it('chunk 不存在 → 404 CHUNK_NOT_FOUND', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_force_purge')
    const chunk = await seedChunk({ state: 'blacklisted' })
    const t = targetOf(chunk)
    t.chunk_sha256 = 'b'.repeat(64)
    const r = await callRetryWithEnv({ token: tok, body: { action: 'force_purge', target: t }, envObj: purgeEnv() })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('CHUNK_NOT_FOUND')
  })

  it('happy path：blacklisted + env flag 設好 → R2 chunk+manifest+D1 row 三刪、emit succeeded critical', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_force_purge')
    const chunk = await seedChunk({ state: 'blacklisted' })
    const seeded = await seedR2ForChunk(chunk)

    const r = await callRetryWithEnv({ token: tok, body: { action: 'force_purge', target: targetOf(chunk) }, envObj: purgeEnv() })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.chunks_row_deleted).toBe(true)
    expect(r.body.source_rows_deleted).toBe(false)
    expect(r.body.data_key).toBe(seeded.dataKey)
    expect(r.body.manifest_key).toBe(seeded.manifestKey)
    expect(r.body.message).toMatch(/NOT deleted/)

    // R2 全清
    expect(await env.AUDIT_ARCHIVE_BUCKET.get(seeded.dataKey)).toBeNull()
    expect(await env.AUDIT_ARCHIVE_BUCKET.get(seeded.manifestKey)).toBeNull()
    // D1 chunks row 不見
    expect(await getChunkState(chunk)).toBeNull()

    const succ = await selectAudit('audit.archive.force_purge_succeeded')
    expect(succ.length).toBe(1)
    expect(succ[0].severity).toBe('critical')
    const data = JSON.parse(succ[0].event_data)
    expect(data.source_rows_deleted).toBe(false)
    expect(data.chunks_row_deleted).toBe(true)

    const adminRows = await adminAuditRows('audit_archive.retry.force_purge')
    expect(adminRows.length).toBe(1)
  })

  it('R2 missing key 仍 idempotent：blacklisted chunk 但 R2 object 已不在 → 仍刪 D1 row 並 200', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_force_purge')
    const chunk = await seedChunk({ state: 'blacklisted' })
    // 沒 seedR2ForChunk — 模擬 R2 已被人工清掉

    const r = await callRetryWithEnv({ token: tok, body: { action: 'force_purge', target: targetOf(chunk) }, envObj: purgeEnv() })
    expect(r.status).toBe(200)
    expect(r.body.chunks_row_deleted).toBe(true)
    expect(await getChunkState(chunk)).toBeNull()
  })

  it('R2 SDK throw → 502 FORCE_PURGE_FAILED + emit failed critical；chunks row 不刪（admin 可重 retry）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_archive_force_purge')
    const chunk = await seedChunk({ state: 'blacklisted' })

    const failingBucket = {
      delete: async () => { throw new Error('simulated R2 lock 403') },
    }
    const envWithFail = { ...env, AUDIT_ARCHIVE_PURGE_ENABLED: '1', AUDIT_ARCHIVE_BUCKET: failingBucket }

    const r = await callRetryWithEnv({ token: tok, body: { action: 'force_purge', target: targetOf(chunk) }, envObj: envWithFail })
    expect(r.status).toBe(502)
    expect(r.body.code).toBe('FORCE_PURGE_FAILED')
    expect(r.body.detail).toMatch(/simulated R2 lock 403/)

    // chunk row 仍在（admin 可改 enable 後 retry）
    expect((await getChunkState(chunk)).state).toBe('blacklisted')

    const failed = await selectAudit('audit.archive.force_purge_failed')
    expect(failed.length).toBe(1)
    expect(failed[0].severity).toBe('critical')
    expect(JSON.parse(failed[0].event_data).reason).toBe('r2_or_d1_exception')
  })
})

describe('admin retry endpoint — audit chain integrity', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('每次合法呼叫都 append admin_audit_log + retry_requested（含失敗的 schema 通過後）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const chunk = await seedChunk()

    // success
    await callRetry({ token: tok, body: { action: 're_verify', target: targetOf(chunk) } })
    // 同 chunk 再 re_verify 應 409（已 uploaded） — admin_audit_log 仍要記
    await callRetry({ token: tok, body: { action: 're_verify', target: targetOf(chunk) } })

    const rows = await adminAuditRows('audit_archive.retry.re_verify')
    expect(rows.length).toBe(2)
    // hash chain 連續：第 2 筆的 prev_hash = 第 1 筆的 row_hash
    expect(rows[0].prev_hash).toBe(rows[1].row_hash)
  })
})
