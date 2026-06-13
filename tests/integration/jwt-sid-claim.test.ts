/**
 * PR-0（sid claim shared contract）— pre-fix RED repro
 *
 * 契約：所有 access-token issuance path 簽出的 access token 帶 `sid` claim，
 *       且 == 對應 refresh_tokens row 的 session_id；refresh rotation 跨輪保留同一 sid。
 * pre-fix（sid 未上線）：access payload 無 sid → `payload.sid` undefined ≠ refresh session_id → RED。
 * post-fix：相等 → GREEN。
 *
 * 直接覆蓋 register / login / refresh-rotation（fresh-mint + rotation-preserve 兩語意）；
 * 其餘 6 條 issuance（2fa-verify / webauthn-login / oauth-token / callback / bind-email / org-switch）
 * 為同一 hoist-sessionId pattern，由各自既有 flow 測試 regression 覆蓋。
 *
 * SEC-FACTOR-ADD-A 依此 sid 綁定 factor-add elevation grant；缺 sid 的舊 token elevation fail-closed。
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { jwtVerify, importJWK } from 'jose'
import { resetDb, seedUser, callFunction, jsonPost, ensureJwtKeys } from './_helpers'
import { onRequestPost as loginPost } from '../../functions/api/auth/local/login'
import { onRequestPost as refreshPost } from '../../functions/api/auth/refresh'

// register.js 會嘗試寄信 → mock（與 register.test 同模式）
vi.mock('../../functions/utils/email', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
}))
const { onRequestPost: registerPost } = await import('../../functions/api/auth/local/register')

const IP = '1.2.3.4'

async function decodeClaims(accessToken: string) {
  const pub = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY), 'ES256')
  const { payload } = await jwtVerify(accessToken, pub, { algorithms: ['ES256'] })
  return payload
}

async function latestSessionId(userId: number) {
  const row = await env.chiyigo_db
    .prepare(`SELECT session_id FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`)
    .bind(userId).first()
  return row?.session_id ?? null
}

describe('PR-0 sid claim — access token sid == refresh session_id', () => {
  beforeAll(async () => { await ensureJwtKeys(); await resetDb() })
  beforeEach(async () => { await resetDb(); delete env.RESEND_API_KEY })

  it('register（非 web）→ access sid 存在且 == refresh session_id（Codex 明確要求）', async () => {
    const res = await callFunction(registerPost, jsonPost('http://x/api/auth/local/register',
      { email: 'reg@x.com', password: 'GoodPass#1234' }, { 'CF-Connecting-IP': IP }))
    expect(res.status).toBe(201)
    const body = await res.json()
    const claims = await decodeClaims(body.access_token)
    const sid = await latestSessionId(body.user_id)
    expect(sid).toBeTruthy()
    expect(typeof claims.sid).toBe('string')   // pre-fix: undefined
    expect(claims.sid).toBe(sid)
  })

  it('login（非 web）→ access sid == refresh session_id', async () => {
    const u = await seedUser({ email: 'lg@x.com', password: 'GoodPass#1234' })
    const res = await callFunction(loginPost, jsonPost('http://x/api/auth/local/login',
      { email: 'lg@x.com', password: 'GoodPass#1234' }, { 'CF-Connecting-IP': IP }))
    expect(res.status).toBe(200)
    const body = await res.json()
    const claims = await decodeClaims(body.access_token)
    const sid = await latestSessionId(u.id)
    expect(sid).toBeTruthy()
    expect(claims.sid).toBe(sid)
  })

  it('refresh rotation → 新 access sid == 原 session_id（跨輪保留）', async () => {
    const u = await seedUser({ email: 'rt@x.com', password: 'GoodPass#1234' })
    // 非 web login 取 refresh_token（body）+ 原 access sid
    const loginRes = await callFunction(loginPost, jsonPost('http://x/api/auth/local/login',
      { email: 'rt@x.com', password: 'GoodPass#1234' }, { 'CF-Connecting-IP': IP }))
    const loginBody = await loginRes.json()
    const originalSid = (await decodeClaims(loginBody.access_token)).sid
    expect(originalSid).toBeTruthy()

    const refRes = await callFunction(refreshPost, jsonPost('http://x/api/auth/refresh',
      { refresh_token: loginBody.refresh_token }, { 'CF-Connecting-IP': IP }))
    expect(refRes.status).toBe(200)
    const refBody = await refRes.json()
    const rotatedSid = (await decodeClaims(refBody.access_token)).sid
    expect(rotatedSid).toBe(originalSid)   // rotation 保留同一 per-login sid
  })
})
