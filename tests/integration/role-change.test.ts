/**
 * P1-17 Phase 2 — changeUserRole helper integration test
 *
 * 驗證：合法 role / 非法 role / 不存在 user / role 未變 / token_version bump /
 * refresh family revoke / hash-chain audit_log + user_audit / self-demotion critical
 *
 * F2 atomicity（codex 2026-05-16）：
 *   - CAS race（role 在 SELECT 與 batch 之間被改）→ ROLE_RACE 409；hash-chain
 *     仍寫「嘗試紀錄」；DB role/token_version/refresh 不變
 *   - stub batch 模擬 CAS=0 + 真 DB race 兩個 case
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { changeUserRole } from '../../functions/utils/role-change'
import { verifyAuditChain } from '../../functions/utils/audit-log'

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

  it('F2 atomicity：CAS race (stub batch 模擬 changes=0) → ROLE_RACE，hash-chain 仍記錄嘗試', async () => {
    const actor  = await seedUser({ email: 'admin@x', role: 'admin' })
    const target = await seedUser({ email: 'b@x', role: 'player' })

    // 種一個未撤 refresh token，驗證 race 時不會被誤撤
    await env.chiyigo_db
      .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
                VALUES (?, 'rt-race', datetime('now','+30 day'))`)
      .bind(target.id).run()

    const before = await env.chiyigo_db
      .prepare('SELECT role, token_version FROM users WHERE id=?').bind(target.id).first()

    // stub batch：INSERT admin_audit_log 真實執行；UPDATE+revoke 回 changes=0
    // 模擬「SELECT 後別人改了 role，CAS WHERE role=oldRole 失敗」
    const realDb = env.chiyigo_db
    const stubEnv = {
      ...env,
      chiyigo_db: {
        prepare: realDb.prepare.bind(realDb),
        batch: async (stmts) => {
          await stmts[0].run() // INSERT admin_audit_log 真寫
          return [
            { meta: { changes: 1 } }, // audit insert
            { meta: { changes: 0 } }, // revoke 0（stub 不實跑）
            { meta: { changes: 0 } }, // role CAS 失敗（caller 讀 [2]）
          ]
        },
      },
    }

    const r = await changeUserRole(stubEnv, {
      userId: target.id, newRole: 'finance',
      actorId: actor.id, actorEmail: 'admin@x', request: REQ,
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ROLE_RACE')
    expect(r.oldRole).toBe('player')

    // role + token_version 不變（stub 沒實際跑 UPDATE）
    const after = await env.chiyigo_db
      .prepare('SELECT role, token_version FROM users WHERE id=?').bind(target.id).first()
    expect(after.role).toBe(before.role)
    expect(after.token_version).toBe(before.token_version)

    // refresh token 未被撤（stub batch 沒實跑 revoke）
    const rt = await env.chiyigo_db
      .prepare('SELECT revoked_at FROM refresh_tokens WHERE user_id=? AND token_hash=?')
      .bind(target.id, 'rt-race').first()
    expect(rt.revoked_at).toBeNull()

    // hash-chain 嘗試紀錄已寫
    const adminLog = await env.chiyigo_db
      .prepare(`SELECT action, target_id FROM admin_audit_log
                 WHERE action = 'role_change:player->finance' ORDER BY id DESC LIMIT 1`).first()
    expect(adminLog).toBeTruthy()
    expect(Number(adminLog.target_id)).toBe(target.id)

    // hash chain 仍 valid
    const chain = await verifyAuditChain(env.chiyigo_db)
    expect(chain.valid).toBe(true)

    // user_audit (admin.user.role_changed) 不寫（race 退出在 safeUserAudit 之前）
    const ua = await env.chiyigo_db
      .prepare(`SELECT id FROM audit_log WHERE event_type='admin.user.role_changed'`).first()
    expect(ua).toBeFalsy()
  })

  it('F2 atomicity：CAS race (真 DB — SELECT 後 role 被改) → ROLE_RACE，不誤撤 refresh', async () => {
    const actor  = await seedUser({ email: 'admin@x', role: 'admin' })
    const target = await seedUser({ email: 'b@x', role: 'player' })

    // 種未撤 refresh — codex PR-A r1: 驗 batch revoke EXISTS-gate 真擋
    await env.chiyigo_db
      .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
                VALUES (?, 'rt-real-race', datetime('now','+30 day'))`)
      .bind(target.id).run()

    // 攔截 SELECT，回過去的 role；底層 DB 已被改 → batch CAS 0 changes
    await env.chiyigo_db
      .prepare(`UPDATE users SET role='support' WHERE id=?`).bind(target.id).run()
    const versionBeforeBatch = await env.chiyigo_db
      .prepare('SELECT token_version FROM users WHERE id=?').bind(target.id).first()

    const realDb = env.chiyigo_db
    const stubEnv = {
      ...env,
      chiyigo_db: {
        prepare: (sql) => {
          const stmt = realDb.prepare(sql)
          if (/SELECT id, email, role FROM users WHERE id = \? AND deleted_at IS NULL/.test(sql)) {
            return {
              bind: (...args) => ({
                first: async () => ({ id: args[0], email: 'b@x', role: 'player' }),
              }),
            }
          }
          return stmt
        },
        batch: realDb.batch.bind(realDb),
      },
    }

    const r = await changeUserRole(stubEnv, {
      userId: target.id, newRole: 'finance',
      actorId: actor.id, actorEmail: 'admin@x', request: REQ,
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ROLE_RACE')

    // DB 真實 role 仍是 race 寫入的 'support'，沒被打成 'finance'
    const after = await env.chiyigo_db
      .prepare('SELECT role, token_version FROM users WHERE id=?').bind(target.id).first()
    expect(after.role).toBe('support')
    expect(after.token_version).toBe(versionBeforeBatch.token_version)

    // hash-chain row 已 commit，verifyAuditChain valid
    const adminLog = await env.chiyigo_db
      .prepare(`SELECT action FROM admin_audit_log
                 WHERE action = 'role_change:player->finance' ORDER BY id DESC LIMIT 1`).first()
    expect(adminLog?.action).toBe('role_change:player->finance')
    const chain = await verifyAuditChain(env.chiyigo_db)
    expect(chain.valid).toBe(true)

    // codex PR-A r1 high: refresh token 未被誤撤
    const rt = await env.chiyigo_db
      .prepare('SELECT revoked_at FROM refresh_tokens WHERE user_id=? AND token_hash=?')
      .bind(target.id, 'rt-real-race').first()
    expect(rt.revoked_at).toBeNull()
  })

  it('F2 atomicity：same-target race (B 用舊快照、A 已改成同 newRole) → ROLE_RACE，refresh 不誤撤', async () => {
    // codex PR-A r2 medium: B SELECT 看到 player；A 已把 role 改成 finance（同 newRole）。
    // 若 revoke gate on newRole，B 的 EXISTS 仍成立 → 誤撤；現改 gate on oldRole 後應擋住。
    const actor  = await seedUser({ email: 'admin@x', role: 'admin' })
    const target = await seedUser({ email: 'b@x', role: 'player' })

    await env.chiyigo_db
      .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
                VALUES (?, 'rt-same-target', datetime('now','+30 day'))`)
      .bind(target.id).run()

    // A 已把 role 改成 finance（race winner）
    await env.chiyigo_db
      .prepare(`UPDATE users SET role='finance' WHERE id=?`).bind(target.id).run()
    const versionBefore = await env.chiyigo_db
      .prepare('SELECT token_version FROM users WHERE id=?').bind(target.id).first()

    const realDb = env.chiyigo_db
    const stubEnv = {
      ...env,
      chiyigo_db: {
        prepare: (sql) => {
          const stmt = realDb.prepare(sql)
          // B SELECT 攔截：回 player 舊快照
          if (/SELECT id, email, role FROM users WHERE id = \? AND deleted_at IS NULL/.test(sql)) {
            return {
              bind: (...args) => ({
                first: async () => ({ id: args[0], email: 'b@x', role: 'player' }),
              }),
            }
          }
          return stmt
        },
        batch: realDb.batch.bind(realDb),
      },
    }

    // B 也想改成 finance（same-target）
    const r = await changeUserRole(stubEnv, {
      userId: target.id, newRole: 'finance',
      actorId: actor.id, actorEmail: 'admin@x', request: REQ,
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ROLE_RACE')

    // role 仍是 A 寫入的 finance；token_version 不變
    const after = await env.chiyigo_db
      .prepare('SELECT role, token_version FROM users WHERE id=?').bind(target.id).first()
    expect(after.role).toBe('finance')
    expect(after.token_version).toBe(versionBefore.token_version)

    // refresh 未被 B 誤撤（gate on oldRole='player'，已不成立）
    const rt = await env.chiyigo_db
      .prepare('SELECT revoked_at FROM refresh_tokens WHERE user_id=? AND token_hash=?')
      .bind(target.id, 'rt-same-target').first()
    expect(rt.revoked_at).toBeNull()

    // hash-chain 嘗試紀錄已寫；chain 仍 valid
    const chain = await verifyAuditChain(env.chiyigo_db)
    expect(chain.valid).toBe(true)
  })

  it('F2 atomicity：soft-delete race (SELECT 後 deleted_at 被設) → ROLE_RACE，不動 DB', async () => {
    // codex PR-A r1 medium: CAS 補 deleted_at IS NULL；軟刪期間 role 仍同也不能改
    const actor  = await seedUser({ email: 'admin@x', role: 'admin' })
    const target = await seedUser({ email: 'b@x', role: 'player' })

    await env.chiyigo_db
      .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
                VALUES (?, 'rt-soft-del', datetime('now','+30 day'))`)
      .bind(target.id).run()
    const before = await env.chiyigo_db
      .prepare('SELECT role, token_version FROM users WHERE id=?').bind(target.id).first()

    // 攔截 SELECT 回 active user，底層 DB SELECT 後 user 被軟刪
    const realDb = env.chiyigo_db
    const stubEnv = {
      ...env,
      chiyigo_db: {
        prepare: (sql) => {
          const stmt = realDb.prepare(sql)
          if (/SELECT id, email, role FROM users WHERE id = \? AND deleted_at IS NULL/.test(sql)) {
            return {
              bind: (...args) => ({
                first: async () => {
                  // SELECT 回過去快照；同時把 user 軟刪掉，模擬 race
                  await realDb.prepare(`UPDATE users SET deleted_at = datetime('now') WHERE id = ?`)
                    .bind(args[0]).run()
                  return { id: args[0], email: 'b@x', role: 'player' }
                },
              }),
            }
          }
          return stmt
        },
        batch: realDb.batch.bind(realDb),
      },
    }

    const r = await changeUserRole(stubEnv, {
      userId: target.id, newRole: 'finance',
      actorId: actor.id, actorEmail: 'admin@x', request: REQ,
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ROLE_RACE')

    // role / token_version 不變
    const after = await env.chiyigo_db
      .prepare('SELECT role, token_version, deleted_at FROM users WHERE id=?').bind(target.id).first()
    expect(after.role).toBe(before.role)
    expect(after.token_version).toBe(before.token_version)
    expect(after.deleted_at).toBeTruthy()

    // refresh 不被誤撤
    const rt = await env.chiyigo_db
      .prepare('SELECT revoked_at FROM refresh_tokens WHERE user_id=? AND token_hash=?')
      .bind(target.id, 'rt-soft-del').first()
    expect(rt.revoked_at).toBeNull()

    // hash-chain 仍 valid（嘗試 row 已寫）
    const chain = await verifyAuditChain(env.chiyigo_db)
    expect(chain.valid).toBe(true)
  })
})
