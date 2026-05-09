/**
 * P1-17 Phase 2 — changeUserRole helper integration test
 *
 * 驗證：合法 role / 非法 role / 不存在 user / role 未變 / token_version bump /
 * refresh family revoke / hash-chain audit_log + user_audit / self-demotion critical
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { changeUserRole } from '../../functions/utils/role-change.js'

const REQ = new Request('http://x/role', { headers: { 'CF-Connecting-IP': '203.0.113.9' } })

describe('changeUserRole', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('未知 role → INVALID_ROLE', async () => {
    const u = await seedUser({ email: 'a@x', role: 'admin' })
    const r = await changeUserRole(env, { userId: u.id, newRole: 'hacker', actorId: u.id, actorEmail: 'a@x' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('INVALID_ROLE')
  })

  it('user 不存在 → USER_NOT_FOUND', async () => {
    const r = await changeUserRole(env, { userId: 99999, newRole: 'finance', actorId: 1, actorEmail: 'a@x' })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('USER_NOT_FOUND')
  })

  it('role 未變 → NOOP（不 bump）', async () => {
    const u = await seedUser({ email: 'a@x', role: 'admin' })
    const before = await env.chiyigo_db.prepare('SELECT token_version FROM users WHERE id=?').bind(u.id).first()
    const r = await changeUserRole(env, { userId: u.id, newRole: 'admin', actorId: u.id, actorEmail: 'a@x' })
    expect(r.ok).toBe(true)
    expect(r.code).toBe('NOOP')
    const after = await env.chiyigo_db.prepare('SELECT token_version FROM users WHERE id=?').bind(u.id).first()
    expect(after.token_version).toBe(before.token_version)
  })

  it('合法 role 變更 → role 更新 + token_version+1 + refresh family revoke + audit', async () => {
    const actor = await seedUser({ email: 'admin@x', role: 'admin' })
    const target = await seedUser({ email: 'b@x', role: 'player' })

    // 種一個未撤的 refresh token
    await env.chiyigo_db
      .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
                VALUES (?, 'h', datetime('now','+30 day'))`)
      .bind(target.id).run()

    const before = await env.chiyigo_db.prepare('SELECT token_version FROM users WHERE id=?').bind(target.id).first()
    const r = await changeUserRole(env, {
      userId: target.id, newRole: 'finance',
      actorId: actor.id, actorEmail: 'admin@x',
      request: REQ, reason: 'promote to finance ops',
    })
    expect(r.ok).toBe(true)
    expect(r.oldRole).toBe('player')

    const after = await env.chiyigo_db.prepare('SELECT role, token_version FROM users WHERE id=?').bind(target.id).first()
    expect(after.role).toBe('finance')
    expect(after.token_version).toBe(before.token_version + 1)

    const rt = await env.chiyigo_db.prepare('SELECT revoked_at FROM refresh_tokens WHERE user_id=? AND token_hash=?').bind(target.id, 'h').first()
    expect(rt.revoked_at).toBeTruthy()

    // hash-chain audit
    const chainRow = await env.chiyigo_db
      .prepare(`SELECT action, target_id, prev_hash, row_hash FROM admin_audit_log ORDER BY id DESC LIMIT 1`)
      .first()
    expect(chainRow.action).toBe('role_change:player->finance')
    expect(chainRow.target_id).toBe(target.id)
    expect(chainRow.row_hash).toBeTruthy()

    // user_audit
    const userAudit = await env.chiyigo_db
      .prepare(`SELECT event_type, severity FROM audit_log WHERE event_type='admin.user.role_changed' ORDER BY id DESC LIMIT 1`)
      .first()
    expect(userAudit?.event_type).toBe('admin.user.role_changed')
    expect(userAudit?.severity).toBe('warn')
  })

  it('self-demotion admin→support → critical audit', async () => {
    const actor = await seedUser({ email: 'me@x', role: 'admin' })
    const r = await changeUserRole(env, {
      userId: actor.id, newRole: 'support',
      actorId: actor.id, actorEmail: 'me@x', request: REQ,
    })
    expect(r.ok).toBe(true)
    const userAudit = await env.chiyigo_db
      .prepare(`SELECT severity, event_data FROM audit_log WHERE event_type='admin.user.role_changed' ORDER BY id DESC LIMIT 1`)
      .first()
    expect(userAudit.severity).toBe('critical')
    expect(JSON.parse(userAudit.event_data).self_demotion).toBe(true)
  })
})
