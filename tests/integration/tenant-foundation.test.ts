/**
 * PR1 Tenant Foundation — 整合測試
 *
 * Plan：docs/reviews/pr1-tenant-foundation-plan-2026-05-28.md §8（codex Gate 1 r1→r3）。
 *
 * 本檔分兩段建置：
 *  - Stage 2（本批）：tenant-context resolver 直接測（idempotency + invariant + Finding 1）。
 *  - Stage 5（後批）：org-switch / GET tenants endpoint + token guard + claim wiring + 向後相容。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedTenant, seedMembership, ensureJwtKeys, callFunction, jsonPost } from './_helpers'
import {
  ensurePersonalTenant,
  resolveActiveTenantClaims,
  resolveIssuanceContextForTenant,
} from '../../functions/utils/tenant-context'
import { signJwt } from '../../functions/utils/jwt'
import { jwtVerify, importJWK } from 'jose'
import { onRequestPost as orgSwitch } from '../../functions/api/auth/org-switch'
import { onRequestGet as listTenants } from '../../functions/api/tenants/index'
import up0047sql from '../../migrations/0047_tenant_foundation.sql?raw'
import down0047sql from '../../migrations/down/0047_tenant_foundation.down.sql?raw'

/** 簽一張測試 access token（預設 aud=chiyigo、ver=0 對齊 seedUser 的 token_version）。 */
async function bearerFor(
  userId: number,
  opts: { scope?: string; aud?: string; sub?: string; extra?: Record<string, unknown> } = {},
) {
  const { scope = 'read:profile write:profile', aud = 'chiyigo', sub = String(userId), extra = {} } = opts
  const token = await signJwt(
    { sub, email: 'tok@e.com', email_verified: true, role: 'player', status: 'active', ver: 0, scope, ...extra },
    '15m', env, { audience: aud },
  )
  return `Bearer ${token}`
}

const ORG_SWITCH_URL = 'https://chiyigo.com/api/auth/org-switch'
const TENANTS_URL    = 'https://chiyigo.com/api/tenants'

function getReq(auth: string) {
  return new Request(TENANTS_URL, { headers: { Authorization: auth } })
}

/** 逐條跑 migration .sql（剝整行註解後 split ';'；對齊 migrations.test.ts execAll）。 */
async function execMigrationSql(sql: string) {
  const stmts = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean)
  for (const s of stmts) await env.chiyigo_db.prepare(s).run()
}
async function listTableNames() {
  const r = await env.chiyigo_db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  return (r.results ?? []).map((x) => (x as { name: string }).name)
}

describe('tenant-context: ensurePersonalTenant', () => {
  beforeEach(async () => { await resetDb() })

  it('建 personal tenant + tenant_owner membership', async () => {
    const u = await seedUser({ email: 'ensure1@e.com' })
    const tid = await ensurePersonalTenant(env.chiyigo_db, u.id)
    expect(typeof tid).toBe('number')

    const t = await env.chiyigo_db
      .prepare('SELECT type, status, personal_owner_user_id FROM tenants WHERE id = ?')
      .bind(tid).first()
    expect(t.type).toBe('personal')
    expect(t.status).toBe('active')
    expect(t.personal_owner_user_id).toBe(u.id)

    const m = await env.chiyigo_db
      .prepare('SELECT platform_role, status FROM organization_members WHERE tenant_id = ? AND user_id = ?')
      .bind(tid, u.id).first()
    expect(m.platform_role).toBe('tenant_owner')
    expect(m.status).toBe('active')
  })

  it('idempotent：連呼兩次 → 只有 1 筆 personal tenant + 1 筆 membership（test 13）', async () => {
    const u = await seedUser({ email: 'ensure2@e.com' })
    const t1 = await ensurePersonalTenant(env.chiyigo_db, u.id)
    const t2 = await ensurePersonalTenant(env.chiyigo_db, u.id)
    expect(t2).toBe(t1)

    const tc = await env.chiyigo_db
      .prepare("SELECT COUNT(*) AS n FROM tenants WHERE type = 'personal' AND personal_owner_user_id = ?")
      .bind(u.id).first()
    expect(tc.n).toBe(1)
    const mc = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM organization_members WHERE tenant_id = ? AND user_id = ?')
      .bind(t1, u.id).first()
    expect(mc.n).toBe(1)
  })

  it('self-heal：tenant 在但 owner membership 漏 → 補回（部分失敗窗口）', async () => {
    const u = await seedUser({ email: 'ensure3@e.com' })
    const t = await seedTenant({ type: 'personal', status: 'active', ownerUserId: u.id })
    // 故意不建 membership，模擬「tenant 建了但 membership INSERT 前 crash」
    const tid = await ensurePersonalTenant(env.chiyigo_db, u.id)
    expect(tid).toBe(t.id)
    const m = await env.chiyigo_db
      .prepare('SELECT platform_role, status FROM organization_members WHERE tenant_id = ? AND user_id = ?')
      .bind(t.id, u.id).first()
    expect(m.platform_role).toBe('tenant_owner')
    expect(m.status).toBe('active')
  })

  it('Gate-2 High：personal tenant 不可被 suspend（DB CHECK 擋，使 inactive-personal 不可達）', async () => {
    const u = await seedUser({ email: 'chk-susp@e.com' })
    const t = await seedTenant({ type: 'personal', status: 'active', ownerUserId: u.id })
    await expect(
      env.chiyigo_db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").bind(t.id).run(),
    ).rejects.toThrow()
  })

  it('Gate-2 High：personal tenant 不可被 soft-delete（DB CHECK 擋）', async () => {
    const u = await seedUser({ email: 'chk-del@e.com' })
    const t = await seedTenant({ type: 'personal', status: 'active', ownerUserId: u.id })
    await expect(
      env.chiyigo_db.prepare("UPDATE tenants SET deleted_at = datetime('now') WHERE id = ?").bind(t.id).run(),
    ).rejects.toThrow()
  })

  it('Gate-2 High：ensurePersonalTenant 自癒 inactive owner membership → active+tenant_owner', async () => {
    const u = await seedUser({ email: 'chk-heal@e.com' })
    const t = await seedTenant({ type: 'personal', status: 'active', ownerUserId: u.id })
    await seedMembership({ tenantId: t.id, userId: u.id, role: 'member', status: 'suspended' })
    await ensurePersonalTenant(env.chiyigo_db, u.id)
    const m = await env.chiyigo_db
      .prepare('SELECT status, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?')
      .bind(t.id, u.id).first()
    expect(m.status).toBe('active')
    expect(m.platform_role).toBe('tenant_owner')
  })
})

describe('tenant-context: resolveActiveTenantClaims', () => {
  beforeEach(async () => { await resetDb() })

  it('fresh login → personal tenant + tenant_owner', async () => {
    const u = await seedUser({ email: 'active1@e.com' })
    const claims = await resolveActiveTenantClaims(env.chiyigo_db, u.id)
    expect(claims.platform_role).toBe('tenant_owner')
    const t = await env.chiyigo_db
      .prepare('SELECT type, personal_owner_user_id FROM tenants WHERE id = ?')
      .bind(claims.tenant_id).first()
    expect(t.type).toBe('personal')
    expect(t.personal_owner_user_id).toBe(u.id)
  })
})

describe('tenant-context: resolveIssuanceContextForTenant invariant（§20 驗收門）', () => {
  beforeEach(async () => { await resetDb() })

  it('happy：org tenant 的 active member → ok + DB 推導 platform_role', async () => {
    const u = await seedUser({ email: 'inv-ok@e.com' })
    const org = await seedTenant({ type: 'organization', name: 'Acme', status: 'active' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'tenant_admin', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: true, tenant_id: org.id, platform_role: 'tenant_admin' })
  })

  it('suspended tenant → TENANT_NOT_ACTIVE', async () => {
    const u = await seedUser({ email: 'inv-susp-t@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'suspended' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: false, code: 'TENANT_NOT_ACTIVE' })
  })

  it('closed tenant → TENANT_NOT_ACTIVE', async () => {
    const u = await seedUser({ email: 'inv-closed@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'closed' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: false, code: 'TENANT_NOT_ACTIVE' })
  })

  it('soft-deleted tenant → TENANT_NOT_FOUND', async () => {
    const u = await seedUser({ email: 'inv-del@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    await env.chiyigo_db.prepare("UPDATE tenants SET deleted_at = datetime('now') WHERE id = ?").bind(org.id).run()
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: false, code: 'TENANT_NOT_FOUND' })
  })

  it('不存在的 tenant id → TENANT_NOT_FOUND', async () => {
    const u = await seedUser({ email: 'inv-nope@e.com' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, 999999)
    expect(r).toMatchObject({ ok: false, code: 'TENANT_NOT_FOUND' })
  })

  it('非 member → NOT_A_MEMBER', async () => {
    const u = await seedUser({ email: 'inv-nonmember@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: false, code: 'NOT_A_MEMBER' })
  })

  it('invited（未接受）membership → MEMBERSHIP_NOT_ACTIVE', async () => {
    const u = await seedUser({ email: 'inv-invited@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'invited' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' })
  })

  it('suspended membership → MEMBERSHIP_NOT_ACTIVE', async () => {
    const u = await seedUser({ email: 'inv-suspm@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'suspended' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' })
  })

  it('Finding 1：active membership 指向他人 personal tenant → PERSONAL_TENANT_FOREIGN', async () => {
    const alice = await seedUser({ email: 'alice@e.com' })
    const bob   = await seedUser({ email: 'bob@e.com' })
    const aliceP = await seedTenant({ type: 'personal', status: 'active', ownerUserId: alice.id })
    // 錯誤 row：bob 對 alice 的 personal tenant 有 active membership（bug/seed/admin path）
    await seedMembership({ tenantId: aliceP.id, userId: bob.id, role: 'member', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, bob.id, aliceP.id)
    expect(r).toMatchObject({ ok: false, code: 'PERSONAL_TENANT_FOREIGN' })
  })

  it('owner 可進自己的 personal tenant', async () => {
    const alice = await seedUser({ email: 'alice-own@e.com' })
    const aliceP = await seedTenant({ type: 'personal', status: 'active', ownerUserId: alice.id })
    await seedMembership({ tenantId: aliceP.id, userId: alice.id, role: 'tenant_owner', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, alice.id, aliceP.id)
    expect(r).toMatchObject({ ok: true, platform_role: 'tenant_owner' })
  })

  it('platform_role 由 DB 推導（member，非 client 宣稱）', async () => {
    const u = await seedUser({ email: 'inv-role@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'active' })
    const r = await resolveIssuanceContextForTenant(env.chiyigo_db, u.id, org.id)
    expect(r).toMatchObject({ ok: true, platform_role: 'member' })
  })
})

describe('POST /api/auth/org-switch + GET /api/tenants（endpoint + token guard §5.1）', () => {
  beforeEach(async () => { await resetDb(); await ensureJwtKeys() })

  it('happy：active member 切 org tenant → 200 + 正確 tenant_id/platform_role', async () => {
    const u = await seedUser({ email: 'ep-ok@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'tenant_admin', status: 'active' })
    const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: org.id }, { Authorization: await bearerFor(u.id) }))
    expect(resp.status).toBe(200)
    const body = await resp.json() as Record<string, unknown>
    expect(body.tenant_id).toBe(org.id)
    expect(body.platform_role).toBe('tenant_admin')
    expect(typeof body.access_token).toBe('string')
    // 解 token 確認 tenant claim 真的進到簽出的 JWT（claim wiring e2e proof；signJwt 路徑與 8 簽點同）
    const pub = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY), 'ES256')
    const { payload } = await jwtVerify(body.access_token as string, pub, { algorithms: ['ES256'] })
    expect(payload.tenant_id).toBe(org.id)
    expect(payload.platform_role).toBe('tenant_admin')
  })

  it('suspended tenant → 403 TENANT_SWITCH_DENIED（不洩具體 reason）', async () => {
    const u = await seedUser({ email: 'ep-susp@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'suspended' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'active' })
    const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: org.id }, { Authorization: await bearerFor(u.id) }))
    expect(resp.status).toBe(403)
    expect((await resp.json() as Record<string, unknown>).code).toBe('TENANT_SWITCH_DENIED')
  })

  it('非 member（forged tenant_id）→ 403', async () => {
    const u = await seedUser({ email: 'ep-nonmember@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: org.id }, { Authorization: await bearerFor(u.id) }))
    expect(resp.status).toBe(403)
  })

  it('suspended membership → 403', async () => {
    const u = await seedUser({ email: 'ep-suspm@e.com' })
    const org = await seedTenant({ type: 'organization', status: 'active' })
    await seedMembership({ tenantId: org.id, userId: u.id, role: 'member', status: 'suspended' })
    const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: org.id }, { Authorization: await bearerFor(u.id) }))
    expect(resp.status).toBe(403)
  })

  it('Finding 1：org-switch 進他人 personal tenant → 403', async () => {
    const alice = await seedUser({ email: 'ep-alice@e.com' })
    const bob   = await seedUser({ email: 'ep-bob@e.com' })
    const aliceP = await seedTenant({ type: 'personal', status: 'active', ownerUserId: alice.id })
    await seedMembership({ tenantId: aliceP.id, userId: bob.id, role: 'member', status: 'active' })
    const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: aliceP.id }, { Authorization: await bearerFor(bob.id) }))
    expect(resp.status).toBe(403)
  })

  it('tenant_id 非嚴格正整數 → 400 ERR_VALIDATION（拒型別強制轉型：codex Medium）', async () => {
    const u = await seedUser({ email: 'ep-badbody@e.com' })
    const auth = await bearerFor(u.id)
    for (const bad of ['1', true, [1], 1.5, 0, -1, null, 'x']) {
      const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: bad }, { Authorization: auth }))
      expect(resp.status, `tenant_id=${JSON.stringify(bad)}`).toBe(400)
      expect((await resp.json() as Record<string, unknown>).code).toBe('ERR_VALIDATION')
    }
  })

  it('temp_bind token → org-switch 403 NOT_A_REGULAR_TOKEN', async () => {
    const u = await seedUser({ email: 'ep-tb@e.com' })
    const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: 1 }, { Authorization: await bearerFor(u.id, { scope: 'temp_bind' }) }))
    expect(resp.status).toBe(403)
    expect((await resp.json() as Record<string, unknown>).code).toBe('NOT_A_REGULAR_TOKEN')
  })

  it('temp_bind token → GET /api/tenants 403 NOT_A_REGULAR_TOKEN', async () => {
    const u = await seedUser({ email: 'ep-tb2@e.com' })
    const resp = await callFunction(listTenants, getReq(await bearerFor(u.id, { scope: 'temp_bind' })))
    expect(resp.status).toBe(403)
    expect((await resp.json() as Record<string, unknown>).code).toBe('NOT_A_REGULAR_TOKEN')
  })

  it('step-up（elevated:*）token → org-switch 與 GET tenants 皆 403', async () => {
    const u = await seedUser({ email: 'ep-su@e.com' })
    const auth = await bearerFor(u.id, { scope: 'elevated:payment' })
    const r1 = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: 1 }, { Authorization: auth }))
    expect(r1.status).toBe(403)
    expect((await r1.json() as Record<string, unknown>).code).toBe('NOT_A_REGULAR_TOKEN')
    const r2 = await callFunction(listTenants, getReq(auth))
    expect(r2.status).toBe(403)
  })

  it('pre_auth token → 403（requireAuth 擋）', async () => {
    const u = await seedUser({ email: 'ep-pa@e.com' })
    const resp = await callFunction(listTenants, getReq(await bearerFor(u.id, { scope: 'pre_auth' })))
    expect(resp.status).toBe(403)
  })

  it('非整數 sub → 401 INVALID_SUBJECT', async () => {
    const resp = await callFunction(listTenants, getReq(await bearerFor(0, { sub: 'abc' })))
    expect(resp.status).toBe(401)
    expect((await resp.json() as Record<string, unknown>).code).toBe('INVALID_SUBJECT')
  })

  it('非 chiyigo aud token → org-switch 401（requireAuth aud gate，不進 switch 邏輯）', async () => {
    const u = await seedUser({ email: 'ep-aud@e.com' })
    const resp = await callFunction(orgSwitch, jsonPost(ORG_SWITCH_URL, { tenant_id: 1 }, { Authorization: await bearerFor(u.id, { aud: 'mbti' }) }))
    expect(resp.status).toBe(401)
  })

  it('GET /api/tenants 只回自己的 active membership（cross-tenant guard）', async () => {
    const u     = await seedUser({ email: 'ep-list@e.com' })
    const other = await seedUser({ email: 'ep-other@e.com' })
    const orgA = await seedTenant({ type: 'organization', name: 'A', status: 'active' })
    const orgB = await seedTenant({ type: 'organization', name: 'B', status: 'active' })
    await seedMembership({ tenantId: orgA.id, userId: u.id, role: 'member', status: 'active' })
    await seedMembership({ tenantId: orgB.id, userId: other.id, role: 'member', status: 'active' })
    const resp = await callFunction(listTenants, getReq(await bearerFor(u.id)))
    expect(resp.status).toBe(200)
    const body = await resp.json() as { tenants: Array<{ id: number }> }
    const ids = body.tenants.map(t => t.id)
    expect(ids).toContain(orgA.id)
    expect(ids).not.toContain(orgB.id)
  })

  it('Finding 1：GET /api/tenants 不列他人 personal tenant', async () => {
    const alice = await seedUser({ email: 'ep-l-alice@e.com' })
    const bob   = await seedUser({ email: 'ep-l-bob@e.com' })
    const aliceP = await seedTenant({ type: 'personal', status: 'active', ownerUserId: alice.id })
    await seedMembership({ tenantId: aliceP.id, userId: alice.id, role: 'tenant_owner', status: 'active' })
    await seedMembership({ tenantId: aliceP.id, userId: bob.id, role: 'member', status: 'active' }) // 錯誤 row
    const aliceResp = await callFunction(listTenants, getReq(await bearerFor(alice.id)))
    const aliceBody = await aliceResp.json() as { tenants: Array<{ id: number }> }
    expect(aliceBody.tenants.map(t => t.id)).toContain(aliceP.id)
    const bobResp = await callFunction(listTenants, getReq(await bearerFor(bob.id)))
    const bobBody = await bobResp.json() as { tenants: Array<{ id: number }> }
    expect(bobBody.tenants.map(t => t.id)).not.toContain(aliceP.id)
  })

  it('舊 token（無 tenant_id claim）仍可存取新 endpoint（向後相容，不被踢）', async () => {
    const u = await seedUser({ email: 'ep-bc@e.com' })
    const resp = await callFunction(listTenants, getReq(await bearerFor(u.id)))
    expect(resp.status).toBe(200)
  })
})

describe('migration 0047 up→down→up round-trip（rollback safety §8.15）', () => {
  // 只操作 tenant 兩表（不碰 audit_log / ALL_UPS，避免 migrations.test.ts 那種共用 D1 FK footgun）；
  // beforeEach resetDb 會經 _setup.sql 重建乾淨狀態給後續 test。
  beforeEach(async () => { await resetDb() })

  it('down 移除兩表；up 重建 + backfill personal tenant；再 up idempotent', async () => {
    const u = await seedUser({ email: 'mig-rt@e.com' })

    // down：DROP organization_members + tenants
    await execMigrationSql(down0047sql)
    let tables = await listTableNames()
    expect(tables).not.toContain('tenants')
    expect(tables).not.toContain('organization_members')

    // up：重建 + backfill（未刪 user u 應獲得 1 筆 personal tenant + owner membership）
    await execMigrationSql(up0047sql)
    tables = await listTableNames()
    expect(tables).toContain('tenants')
    expect(tables).toContain('organization_members')
    const t1 = await env.chiyigo_db
      .prepare("SELECT COUNT(*) AS n FROM tenants WHERE type = 'personal' AND personal_owner_user_id = ?")
      .bind(u.id).first()
    expect(t1.n).toBe(1)
    const m1 = await env.chiyigo_db
      .prepare("SELECT COUNT(*) AS n FROM organization_members WHERE user_id = ? AND platform_role = 'tenant_owner'")
      .bind(u.id).first()
    expect(m1.n).toBe(1)

    // 再 up 一次：IF NOT EXISTS + INSERT OR IGNORE → 無錯、不重複
    await execMigrationSql(up0047sql)
    const t2 = await env.chiyigo_db
      .prepare("SELECT COUNT(*) AS n FROM tenants WHERE type = 'personal' AND personal_owner_user_id = ?")
      .bind(u.id).first()
    expect(t2.n).toBe(1)
  })
})
