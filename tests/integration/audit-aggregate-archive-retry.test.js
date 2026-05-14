/**
 * F-3 Phase 2 PR 3.3 — aggregate-archive admin retry endpoint 整合測試
 *
 * 路徑：POST /api/admin/audit-aggregate-archive/retry
 *
 * 覆蓋三 action × 護欄（mirror tests/integration/audit-archive-retry.test.js，
 * 補 aggregate 專屬 invariant）：
 *   - re_verify     : failed → uploaded（strict WHERE 含 dry_run guard）
 *   - mark_resolved : failed → blacklisted（raw mirror）
 *                     + dry_run=1 AND verified → blacklisted（PR 3.3 special）
 *                     + live verified → 409 LIVE_VERIFIED_NOT_BLACKLISTABLE
 *                     + dry-run verified + aggregate row archived_at NOT NULL
 *                       → 409 INTEGRITY_BREACH（codex r2 H-1 invariant 守門）
 *   - force_purge   : blacklisted only；env AUDIT_AGGREGATE_PURGE_ENABLED=1 gate；
 *                     呼叫 purgeAggregateChunk（不共用 raw purgeChunk）；
 *                     dry_run mismatch / not found / state mismatch 各自分流
 *
 * 護欄：
 *   - auth 401 / role 403 / scope 403
 *   - schema validation：invalid action / invalid table_name+cold_class 配對 /
 *     missing dry_run / missing reason_code / operator_reason 長度
 *   - step-up token 缺失 / for_action mismatch
 *   - admin_audit_log hash chain 必有 row
 *   - emit chain：retry_requested → retry_succeeded / retry_rejected /
 *     force_purge_{requested,succeeded,failed,disabled}
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { onRequestPost as retryHandler } from '../../functions/api/admin/audit-aggregate-archive/retry.js'

async function adminToken(userId, role = 'admin') {
  return signJwt(
    { sub: String(userId), email: 'a@x', role, status: 'active', ver: 0 },
    '15m', env, { audience: 'chiyigo' },
  )
}

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
  const req = new Request('http://x/api/admin/audit-aggregate-archive/retry', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const r = await retryHandler({ request: req, env })
  return { status: r.status, body: await r.json() }
}

// 預設 telemetry / failed / live
async function seedAggregateChunk(overrides = {}) {
  const t = {
    env: 'test',
    table_name: 'audit_log_aggregate_telemetry',
    cold_class: 'aggregate_telemetry',
    archive_date: '2026-05-01',
    min_id: 1,
    max_id: 100,
    chunk_sha256: 'a'.repeat(64),
    state: 'failed',
    row_count: 50,
    retry_count: 1,
    dry_run: 0,
    compression: 'gzip',
    ...overrides,
  }
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_archive_chunks
      (env, table_name, cold_class, cold_class_version, archive_date,
       min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run, compression)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'run-seed', ?, ?)`
  ).bind(
    t.env, t.table_name, t.cold_class, t.archive_date,
    t.min_id, t.max_id, t.chunk_sha256, t.state, t.row_count, t.retry_count,
    t.dry_run, t.compression,
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
    dry_run: chunk.dry_run === 1,
  }
}

async function getChunkState(chunk) {
  const r = await env.chiyigo_db.prepare(
    `SELECT state, retry_count, dry_run, blacklisted_at, last_failure FROM audit_archive_chunks
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
    `SELECT action, target_id, target_email FROM admin_audit_log WHERE action = ? ORDER BY id DESC`
  ).bind(action).all()
  return r.results ?? []
}

const VALID_REASON = {
  reason_code: 'manual_cleanup',
  operator_reason: 'PR 3.3 integration test exercising endpoint path',
}

describe('PR 3.3 retry — auth / role / scope', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('no token → 401', async () => {
    const r = await callRetry({ body: { action: 're_verify', target: {}, ...VALID_REASON } })
    expect(r.status).toBe(401)
  })

  it('non-admin role → 403', async () => {
    const { id } = await seedUser({ email: 'p@x', role: 'player' })
    const tok = await adminToken(id, 'player')
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: {}, ...VALID_REASON } })
    expect(r.status).toBe(403)
  })
})

describe('PR 3.3 retry — schema validation', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('invalid action → 400 + retry_rejected warn', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await callRetry({ token: tok, body: { action: 'nuke_world', target: {}, ...VALID_REASON } })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('INVALID_ACTION')
    // emit fallback prefix (telemetry) because target.cold_class undefined
    const evs = await selectAudit('audit.aggregate_archive.telemetry.retry_rejected')
    expect(evs.length).toBeGreaterThan(0)
    expect(JSON.parse(evs[0].event_data).reason).toBe('invalid_action')
  })

  it('raw audit_log table_name not allowed (cross-system protection) → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedAggregateChunk())
    t.table_name = 'audit_log'           // raw — must be rejected
    t.cold_class = 'telemetry'           // raw cold_class
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t, ...VALID_REASON } })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('INVALID_TARGET')
    expect(r.body.error).toMatch(/aggregate pairs/)
  })

  it('aggregate table_name + wrong cold_class → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedAggregateChunk())
    t.cold_class = 'aggregate_debug'    // mismatched with telemetry table
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t, ...VALID_REASON } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/aggregate pairs/)
  })

  it('target.dry_run missing → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedAggregateChunk())
    delete t.dry_run
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t, ...VALID_REASON } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/dry_run/)
  })

  it('missing reason_code → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedAggregateChunk())
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t, operator_reason: VALID_REASON.operator_reason } })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('INVALID_REASON')
    expect(r.body.error).toMatch(/reason_code/)
  })

  it('operator_reason too short → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedAggregateChunk())
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t, reason_code: 'manual_cleanup', operator_reason: 'short' } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/length/)
  })

  it('PR 3.3 r1 codex test gap：invalid reason_code（白名單外）→ 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const t = targetOf(await seedAggregateChunk())
    const r = await callRetry({ token: tok, body: { action: 're_verify', target: t, reason_code: 'fake_reason_not_in_whitelist', operator_reason: 'valid 10 char reason here' } })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('INVALID_REASON')
    expect(r.body.error).toMatch(/reason_code/)
  })
})

describe('PR 3.3 retry — re_verify happy path', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('failed → uploaded（retry_count 保留；emit retry_succeeded；admin_audit_log 入鏈）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const chunk = await seedAggregateChunk({ retry_count: 3 })

    const r = await callRetry({ token: tok, body: { action: 're_verify', target: targetOf(chunk), ...VALID_REASON } })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.from_state).toBe('failed')
    expect(r.body.to_state).toBe('uploaded')
    expect(r.body.archived).toBe(false)
    expect(r.body.blocks_cursor).toBe(true)

    const after = await getChunkState(chunk)
    expect(after.state).toBe('uploaded')
    expect(after.retry_count).toBe(3)

    const succ = await selectAudit('audit.aggregate_archive.telemetry.retry_succeeded')
    expect(succ.length).toBe(1)
    expect(JSON.parse(succ[0].event_data).transition).toBe('failed_to_uploaded')

    const aar = await adminAuditRows('audit_aggregate_archive.retry.re_verify')
    expect(aar.length).toBe(1)
    expect(aar[0].target_email).toMatch(/aggregate_chunk:/)
  })
})

describe('PR 3.3 retry — mark_resolved（step-up）', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('failed → blacklisted（標 blacklisted_at + last_failure=admin_mark_resolved）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_mark_resolved')
    const chunk = await seedAggregateChunk()

    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk), ...VALID_REASON } })
    expect(r.status).toBe(200)
    expect(r.body.to_state).toBe('blacklisted')
    expect(r.body.transition).toBe('failed_to_blacklisted')

    const after = await getChunkState(chunk)
    expect(after.state).toBe('blacklisted')
    expect(after.blacklisted_at).toBeTruthy()
    expect(after.last_failure).toBe('admin_mark_resolved')
  })

  it('dry-run verified → blacklisted（PR 3.3 special；aggregate row archived_at IS NULL invariant 守住）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_mark_resolved')
    // dry-run verified chunk + aggregate row archived_at IS NULL
    const chunk = await seedAggregateChunk({ state: 'verified', dry_run: 1 })
    // seed 一筆 aggregate row 落在 chunk min..max 之內、archived_at IS NULL
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log_aggregate_telemetry
        (id, event_type, user_id, severity, hour_bucket, count, archived_at)
       VALUES (?, 'auth.login.rate_limited', NULL, 'info', '2025-01-15T01:00', 5, NULL)`
    ).bind(50).run()

    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk), reason_code: 'dry_run_collision_cleanup', operator_reason: 'r2 H-1 cleanup before live rerun' } })
    expect(r.status).toBe(200)
    expect(r.body.to_state).toBe('blacklisted')
    expect(r.body.transition).toBe('dry_run_verified_to_blacklisted')

    const after = await getChunkState(chunk)
    expect(after.state).toBe('blacklisted')
    expect(after.last_failure).toBe('admin_mark_resolved_dry_run_collision')
  })

  it('dry-run verified BUT aggregate row archived_at NOT NULL → 409 INTEGRITY_BREACH（codex r2 H-1 invariant 守門）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_mark_resolved')
    const chunk = await seedAggregateChunk({ state: 'verified', dry_run: 1 })
    // seed aggregate row archived_at NOT NULL（invariant 已破）
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log_aggregate_telemetry
        (id, event_type, user_id, severity, hour_bucket, count, archived_at)
       VALUES (?, 'auth.login.rate_limited', NULL, 'info', '2025-01-15T01:00', 5, datetime('now'))`
    ).bind(50).run()

    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk), reason_code: 'dry_run_collision_cleanup', operator_reason: 'should fail — integrity breach' } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('INTEGRITY_BREACH')
    expect(r.body.archived_row_count).toBe(1)

    // chunk state 未變
    const after = await getChunkState(chunk)
    expect(after.state).toBe('verified')

    // critical reject emit
    const evs = await selectAudit('audit.aggregate_archive.telemetry.retry_rejected')
    const critical = evs.find(e => e.severity === 'critical')
    expect(critical).toBeTruthy()
    expect(JSON.parse(critical.event_data).reason).toBe('integrity_breach_dry_run_chunk_with_archived_aggregate_rows')
  })

  it('live verified → 409 LIVE_VERIFIED_NOT_BLACKLISTABLE（不繞過 deletion invariant）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_mark_resolved')
    const chunk = await seedAggregateChunk({ state: 'verified', dry_run: 0 })

    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk), ...VALID_REASON } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('LIVE_VERIFIED_NOT_BLACKLISTABLE')
    const after = await getChunkState(chunk)
    expect(after.state).toBe('verified')
  })

  it('chunk not found → 404 CHUNK_NOT_FOUND', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_mark_resolved')
    const chunk = await seedAggregateChunk()  // seed
    const t = targetOf(chunk)
    t.min_id = 999  // 不存在
    t.max_id = 1099
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: t, ...VALID_REASON } })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('CHUNK_NOT_FOUND')
  })

  it('dry_run mismatch → 409 DRY_RUN_MISMATCH（防 operator 以為刪 dry-run 實際刪 live）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_mark_resolved')
    const chunk = await seedAggregateChunk({ dry_run: 0 })  // live row
    const t = targetOf(chunk)
    t.dry_run = true   // operator 以為 dry-run
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: t, ...VALID_REASON } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('DRY_RUN_MISMATCH')
    expect(r.body.expected_dry_run).toBe(1)
    expect(r.body.actual_dry_run).toBe(0)
  })

  it('mark_resolved 缺 step-up → 403（普通 admin token 不行）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)  // 一般 admin token，無 elevated/for_action
    const chunk = await seedAggregateChunk()
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk), ...VALID_REASON } })
    expect(r.status).toBe(403)
  })

  it('PR 3.3 r1 codex test gap：wrong step-up for_action（raw 的 token 想刪 aggregate）→ 403', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    // 拿錯 anti-replay 域：raw audit_archive 的 for_action 不能用在 aggregate endpoint
    const tok = await adminStepUpToken(id, 'audit_archive_mark_resolved')
    const chunk = await seedAggregateChunk()
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: targetOf(chunk), ...VALID_REASON } })
    expect(r.status).toBe(403)
  })

  it('PR 3.3 r1 codex P2-2 regression：不存在的 dry-run target + id range 夾雜 archived aggregate row → 404 CHUNK_NOT_FOUND（不是 INTEGRITY_BREACH）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_mark_resolved')
    // 種一個 archived aggregate row 在 id 50（不種 chunk）
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log_aggregate_telemetry
        (id, event_type, user_id, severity, hour_bucket, count, archived_at)
       VALUES (50, 'auth.login.rate_limited', NULL, 'info', '2025-01-15T01:00', 5, datetime('now'))`
    ).run()
    // fake target — chunk 完全不存在
    const t = {
      env: 'test',
      table_name: 'audit_log_aggregate_telemetry',
      cold_class: 'aggregate_telemetry',
      archive_date: '2026-05-01',
      min_id: 1, max_id: 100, chunk_sha256: 'f'.repeat(64),
      dry_run: true,
    }
    const r = await callRetry({ token: tok, body: { action: 'mark_resolved', target: t, reason_code: 'dry_run_collision_cleanup', operator_reason: 'should be 404 not integrity breach' } })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('CHUNK_NOT_FOUND')
    // 不該出現 INTEGRITY_BREACH critical emit
    const evs = await selectAudit('audit.aggregate_archive.telemetry.retry_rejected')
    const critical = evs.find(e => e.severity === 'critical')
    expect(critical).toBeUndefined()
  })
})

describe('PR 3.3 retry — force_purge（step-up + env flag）', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('AUDIT_AGGREGATE_PURGE_ENABLED 未設 → 503 PURGE_DISABLED + warn emit', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_force_purge')
    const chunk = await seedAggregateChunk({ state: 'blacklisted' })
    // 不設 env flag — 預設應拒
    const r = await callRetry({ token: tok, body: { action: 'force_purge', target: targetOf(chunk), ...VALID_REASON } })
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('PURGE_DISABLED')
    // chunk row 仍在
    const after = await getChunkState(chunk)
    expect(after.state).toBe('blacklisted')
  })

  it('blacklisted chunk + env flag 1 → 200 + chunks row gone + force_purge_succeeded critical emit', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_force_purge')
    const chunk = await seedAggregateChunk({ state: 'blacklisted' })
    // env override：注入 AUDIT_AGGREGATE_PURGE_ENABLED='1'
    const req = new Request('http://x/api/admin/audit-aggregate-archive/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_purge', target: targetOf(chunk), ...VALID_REASON }),
    })
    const r = await retryHandler({ request: req, env: { ...env, AUDIT_AGGREGATE_PURGE_ENABLED: '1' } })
    const body = await r.json()
    expect(r.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.chunks_row_deleted).toBe(true)
    expect(body.source_rows_deleted).toBe(false)
    expect(body.data_key).toMatch(/audit-log-aggregate-telemetry\//)
    expect(body.manifest_key).toMatch(/^manifest\//)

    // chunks row 已被刪
    const after = await getChunkState(chunk)
    expect(after).toBeNull()

    const succ = await selectAudit('audit.aggregate_archive.telemetry.force_purge_succeeded')
    expect(succ.length).toBe(1)
    expect(succ[0].severity).toBe('critical')
  })

  it('dry-run blacklisted chunk → R2 key 走 dryrun prefix', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_force_purge')
    const chunk = await seedAggregateChunk({ state: 'blacklisted', dry_run: 1, cold_class: 'aggregate_debug', table_name: 'audit_log_aggregate_debug' })
    const req = new Request('http://x/api/admin/audit-aggregate-archive/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_purge', target: targetOf(chunk), ...VALID_REASON }),
    })
    const r = await retryHandler({ request: req, env: { ...env, AUDIT_AGGREGATE_PURGE_ENABLED: '1' } })
    const body = await r.json()
    expect(r.status).toBe(200)
    expect(body.data_key).toMatch(/audit-log-aggregate-debug-dryrun\//)
    expect(body.manifest_key).toMatch(/^manifest-dryrun\//)
  })

  it('non-blacklisted → 409 CHUNK_STATE_MISMATCH', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_force_purge')
    const chunk = await seedAggregateChunk({ state: 'failed' })  // 不是 blacklisted
    const req = new Request('http://x/api/admin/audit-aggregate-archive/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_purge', target: targetOf(chunk), ...VALID_REASON }),
    })
    const r = await retryHandler({ request: req, env: { ...env, AUDIT_AGGREGATE_PURGE_ENABLED: '1' } })
    const body = await r.json()
    expect(r.status).toBe(409)
    expect(body.code).toBe('CHUNK_STATE_MISMATCH')
    expect(body.actual_state).toBe('failed')
    // chunk row 仍在
    const after = await getChunkState(chunk)
    expect(after.state).toBe('failed')
  })

  it('row missing → 404 CHUNK_NOT_FOUND', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_force_purge')
    const chunk = await seedAggregateChunk({ state: 'blacklisted' })
    const t = targetOf(chunk)
    t.min_id = 9999  // 不存在
    t.max_id = 10099
    const req = new Request('http://x/api/admin/audit-aggregate-archive/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_purge', target: t, ...VALID_REASON }),
    })
    const r = await retryHandler({ request: req, env: { ...env, AUDIT_AGGREGATE_PURGE_ENABLED: '1' } })
    const body = await r.json()
    expect(r.status).toBe(404)
    expect(body.code).toBe('CHUNK_NOT_FOUND')
  })

  it('dry_run mismatch → 409 DRY_RUN_MISMATCH', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(id, 'audit_aggregate_archive_force_purge')
    const chunk = await seedAggregateChunk({ state: 'blacklisted', dry_run: 0 })
    const t = targetOf(chunk)
    t.dry_run = true  // mismatch
    const req = new Request('http://x/api/admin/audit-aggregate-archive/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_purge', target: t, ...VALID_REASON }),
    })
    const r = await retryHandler({ request: req, env: { ...env, AUDIT_AGGREGATE_PURGE_ENABLED: '1' } })
    const body = await r.json()
    expect(r.status).toBe(409)
    expect(body.code).toBe('DRY_RUN_MISMATCH')
    expect(body.expected_dry_run).toBe(1)
    expect(body.actual_dry_run).toBe(0)
  })

  it('force_purge 缺 step-up → 403', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const chunk = await seedAggregateChunk({ state: 'blacklisted' })
    const req = new Request('http://x/api/admin/audit-aggregate-archive/retry', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_purge', target: targetOf(chunk), ...VALID_REASON }),
    })
    const r = await retryHandler({ request: req, env: { ...env, AUDIT_AGGREGATE_PURGE_ENABLED: '1' } })
    expect(r.status).toBe(403)
  })
})
