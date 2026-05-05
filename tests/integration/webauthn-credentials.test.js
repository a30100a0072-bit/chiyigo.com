/**
 * Phase D-2 Wave C — Passkey 管理 endpoint 整合測試
 *
 * 涵蓋：
 *  - GET    /api/auth/webauthn/credentials
 *  - PATCH  /api/auth/webauthn/credentials/:id
 *  - DELETE /api/auth/webauthn/credentials/:id（必須 step-up）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { onRequestGet as listHandler } from '../../functions/api/auth/webauthn/credentials.js'
import {
  onRequestPatch as patchHandler,
  onRequestDelete as deleteHandler,
} from '../../functions/api/auth/webauthn/credentials/[id].js'

async function userToken(userId, email = 'wac@x') {
  return signJwt(
    { sub: String(userId), email, role: 'player', status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

async function stepUpToken(userId, action) {
  return signJwt(
    { sub: String(userId), email: 'wac@x', role: 'player', status: 'active', ver: 0,
      scope: 'elevated:account', for_action: action, amr: ['pwd', 'totp'],
      acr: 'urn:chiyigo:loa:2' },
    '5m', env, { audience: 'chiyigo' },
  )
}

function reqWithBearer(method, url, token, body = null) {
  return new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function seedCredential(userId, {
  credentialId = `cred-${userId}-${Math.random().toString(36).slice(2, 8)}`,
  nickname = null,
  transports = ['internal'],
  aaguid = 'aa-bb-cc',
  backupEligible = 0,
  backupState = 0,
} = {}) {
  const r = await env.chiyigo_db.prepare(
    `INSERT INTO user_webauthn_credentials
       (user_id, credential_id, public_key, counter, transports, aaguid,
        nickname, backup_eligible, backup_state)
     VALUES (?, ?, 'pk-bytes', 0, ?, ?, ?, ?, ?)`,
  ).bind(
    userId, credentialId, JSON.stringify(transports),
    aaguid, nickname, backupEligible, backupState,
  ).run()
  return { pk: r.meta.last_row_id, credentialId }
}

describe('GET /api/auth/webauthn/credentials', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 access_token → 401', async () => {
    const resp = await listHandler({
      request: new Request('http://x/api/auth/webauthn/credentials'),
      env,
    })
    expect(resp.status).toBe(401)
  })

  it('happy → 列出該 user 的 passkey，不洩漏 public_key/counter', async () => {
    const u = await seedUser({ email: 'list@x' })
    await seedCredential(u.id, { nickname: 'iPhone', backupEligible: 1, backupState: 1 })
    await seedCredential(u.id, { nickname: 'YubiKey', transports: ['usb','nfc'] })
    // 別 user 的 cred 不該被列出
    const other = await seedUser({ email: 'other@x' })
    await seedCredential(other.id, { nickname: 'should-not-show' })

    const tok = await userToken(u.id, 'list@x')
    const resp = await listHandler({
      request: reqWithBearer('GET', 'http://x/api/auth/webauthn/credentials', tok), env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.credentials).toHaveLength(2)
    const nicks = body.credentials.map(c => c.nickname).sort()
    expect(nicks).toEqual(['YubiKey', 'iPhone'])
    // 不洩漏敏感欄位
    for (const c of body.credentials) {
      expect(c).not.toHaveProperty('public_key')
      expect(c).not.toHaveProperty('counter')
      expect(c).not.toHaveProperty('credential_id')
    }
    const iphone = body.credentials.find(c => c.nickname === 'iPhone')
    expect(iphone.backup_eligible).toBe(true)
    expect(iphone.backup_state).toBe(true)
    expect(iphone.transports).toEqual(['internal'])
  })
})

describe('PATCH /api/auth/webauthn/credentials/:id', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('改 nickname 成功', async () => {
    const u = await seedUser({ email: 'p@x' })
    const c = await seedCredential(u.id, { nickname: 'old' })
    const tok = await userToken(u.id, 'p@x')
    const resp = await patchHandler({
      request: reqWithBearer('PATCH',
        `http://x/api/auth/webauthn/credentials/${c.pk}`,
        tok, { nickname: '我的 iPad' }),
      env, params: { id: String(c.pk) },
    })
    expect(resp.status).toBe(200)
    const row = await env.chiyigo_db.prepare(
      `SELECT nickname FROM user_webauthn_credentials WHERE id = ?`,
    ).bind(c.pk).first()
    expect(row.nickname).toBe('我的 iPad')
  })

  it('別 user 的 credential 不能改 → 404', async () => {
    const a = await seedUser({ email: 'pa@x' })
    const b = await seedUser({ email: 'pb@x' })
    const c = await seedCredential(a.id, { nickname: 'a-pk' })
    const tokB = await userToken(b.id, 'pb@x')
    const resp = await patchHandler({
      request: reqWithBearer('PATCH',
        `http://x/api/auth/webauthn/credentials/${c.pk}`,
        tokB, { nickname: 'hijack' }),
      env, params: { id: String(c.pk) },
    })
    expect(resp.status).toBe(404)
  })

  it('nickname 太長 → 400', async () => {
    const u = await seedUser({ email: 'pl@x' })
    const c = await seedCredential(u.id)
    const tok = await userToken(u.id, 'pl@x')
    const resp = await patchHandler({
      request: reqWithBearer('PATCH',
        `http://x/api/auth/webauthn/credentials/${c.pk}`,
        tok, { nickname: 'x'.repeat(65) }),
      env, params: { id: String(c.pk) },
    })
    expect(resp.status).toBe(400)
  })
})

describe('DELETE /api/auth/webauthn/credentials/:id', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('一般 access_token（無 elevated）→ 403 STEP_UP_REQUIRED', async () => {
    const u = await seedUser({ email: 'd@x' })
    const c = await seedCredential(u.id)
    const tok = await userToken(u.id, 'd@x')
    const resp = await deleteHandler({
      request: reqWithBearer('DELETE',
        `http://x/api/auth/webauthn/credentials/${c.pk}`, tok),
      env, params: { id: String(c.pk) },
    })
    expect(resp.status).toBe(403)
    const body = await resp.json()
    expect(body.code).toBe('STEP_UP_REQUIRED')
  })

  it('step-up 但 for_action 不符 → 403 STEP_UP_ACTION_MISMATCH', async () => {
    const u = await seedUser({ email: 'dm@x' })
    const c = await seedCredential(u.id)
    const tok = await stepUpToken(u.id, 'change_password')  // 錯的 action
    const resp = await deleteHandler({
      request: reqWithBearer('DELETE',
        `http://x/api/auth/webauthn/credentials/${c.pk}`, tok),
      env, params: { id: String(c.pk) },
    })
    expect(resp.status).toBe(403)
    const body = await resp.json()
    expect(body.code).toBe('STEP_UP_ACTION_MISMATCH')
  })

  it('正確 step-up → 刪除成功 + critical audit + jti 一次性消耗', async () => {
    const u = await seedUser({ email: 'dh@x' })
    const c = await seedCredential(u.id, { nickname: 'old-pk' })
    const tok = await stepUpToken(u.id, 'remove_passkey')

    const resp = await deleteHandler({
      request: reqWithBearer('DELETE',
        `http://x/api/auth/webauthn/credentials/${c.pk}`, tok),
      env, params: { id: String(c.pk) },
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.deleted).toBe(true)

    // row 真的不見
    const row = await env.chiyigo_db.prepare(
      `SELECT 1 FROM user_webauthn_credentials WHERE id = ?`,
    ).bind(c.pk).first()
    expect(row).toBeNull()

    // critical audit
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log
         WHERE event_type = 'webauthn.credential.deleted' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')

    // 同 step-up token 第二次用 → 因 jti 進黑名單失敗
    const second = await deleteHandler({
      request: reqWithBearer('DELETE',
        `http://x/api/auth/webauthn/credentials/${c.pk}`, tok),
      env, params: { id: String(c.pk) },
    })
    expect(second.status).toBe(401)  // jti revoked → requireAuth 端 401
  })

  it('別 user 的 credential 不能刪 → 404（即使 step-up token 正確）', async () => {
    const a = await seedUser({ email: 'da@x' })
    const b = await seedUser({ email: 'db@x' })
    const c = await seedCredential(a.id)
    const tokB = await stepUpToken(b.id, 'remove_passkey')
    const resp = await deleteHandler({
      request: reqWithBearer('DELETE',
        `http://x/api/auth/webauthn/credentials/${c.pk}`, tokB),
      env, params: { id: String(c.pk) },
    })
    expect(resp.status).toBe(404)
  })
})
