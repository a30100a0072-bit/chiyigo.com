/**
 * OIDC discovery + userinfo + JWKS endpoint integration tests
 *
 * 鎖定 chiyigo IAM 作為合規 OpenID Provider 的對外契約。
 * 任何子站 / RP 用 openid-client 之類 library 自動探查時，會打這 3 個端點。
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { jwtVerify, importJWK, SignJWT } from 'jose'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'

import { onRequestGet as discoveryGet } from '../../functions/.well-known/openid-configuration.js'
import { onRequestGet as jwksGet      } from '../../functions/.well-known/jwks.json.js'
import { onRequestGet as userinfoGet  } from '../../functions/api/auth/userinfo.js'

const ORIGIN = 'https://chiyigo.com'

describe('GET /.well-known/openid-configuration — OIDC discovery', () => {
  it('回 OIDC 必填 metadata', async () => {
    const res  = await discoveryGet({ request: new Request(`${ORIGIN}/.well-known/openid-configuration`), env })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.issuer).toBe('https://chiyigo.com')
    expect(body.authorization_endpoint).toBe('https://chiyigo.com/api/auth/oauth/authorize')
    expect(body.token_endpoint).toBe('https://chiyigo.com/api/auth/oauth/token')
    expect(body.userinfo_endpoint).toBe('https://chiyigo.com/api/auth/userinfo')
    expect(body.jwks_uri).toBe('https://chiyigo.com/.well-known/jwks.json')
    expect(body.response_types_supported).toContain('code')
    expect(body.id_token_signing_alg_values_supported).toContain('ES256')
    expect(body.code_challenge_methods_supported).toContain('S256')
    expect(body.scopes_supported).toEqual(expect.arrayContaining(['openid', 'profile', 'email']))
    expect(body.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']))
    expect(body.token_endpoint_auth_methods_supported).toContain('none') // public client
  })

  it('Cache-Control 1 小時 + CORS 公開', async () => {
    const res = await discoveryGet({ request: new Request(`${ORIGIN}/.well-known/openid-configuration`), env })
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=3600/)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('Phase C-4：acr_values_supported 含 urn:chiyigo:loa:2 (step-up)', async () => {
    const res  = await discoveryGet({ request: new Request(`${ORIGIN}/.well-known/openid-configuration`), env })
    const body = await res.json()
    expect(body.acr_values_supported).toContain('urn:chiyigo:loa:2')
  })

  it('Phase C-4：claims_parameter_supported = false（明確宣告不支援）', async () => {
    const res  = await discoveryGet({ request: new Request(`${ORIGIN}/.well-known/openid-configuration`), env })
    const body = await res.json()
    expect(body.claims_parameter_supported).toBe(false)
  })

  it('Phase C-4：claims_supported 含 step-up token claims（acr/amr/for_action/scope）', async () => {
    const res  = await discoveryGet({ request: new Request(`${ORIGIN}/.well-known/openid-configuration`), env })
    const body = await res.json()
    for (const c of ['acr', 'amr', 'for_action', 'scope']) {
      expect(body.claims_supported).toContain(c)
    }
  })

  it('Phase C-4：自訂 metadata 公告 step_up_endpoint + supported scopes', async () => {
    const res  = await discoveryGet({ request: new Request(`${ORIGIN}/.well-known/openid-configuration`), env })
    const body = await res.json()
    expect(body['urn:chiyigo:step_up_endpoint']).toBe('https://chiyigo.com/api/auth/step-up')
    const stepUpScopes = body['urn:chiyigo:step_up_scopes_supported']
    expect(stepUpScopes).toEqual(expect.arrayContaining([
      'elevated:account', 'elevated:payment', 'elevated:withdraw', 'elevated:wallet_op',
    ]))
  })
})

describe('GET /.well-known/jwks.json — public keys', () => {
  beforeAll(async () => { await ensureJwtKeys() })

  it('回 ES256 公鑰陣列，不含私鑰分量 d', async () => {
    const res  = await jwksGet({ env })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(body.keys)).toBe(true)
    expect(body.keys.length).toBeGreaterThan(0)
    for (const k of body.keys) {
      expect(k.kty).toBe('EC')
      expect(k.crv).toBe('P-256')
      expect(k.alg).toBe('ES256')
      expect(k.use).toBe('sig')
      expect(k.kid).toBeTruthy()
      expect(k.x).toBeTruthy()
      expect(k.y).toBeTruthy()
      expect(k.d).toBeUndefined()  // 🔴 私鑰絕不可洩漏
    }
  })

  it('Cache-Control 1 小時', async () => {
    const res = await jwksGet({ env })
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=3600/)
  })
})

describe('GET /api/auth/userinfo — OIDC UserInfo', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  async function signTestAccessToken(userId, { aud = 'chiyigo', email = 'u@x.com', ver = 0 } = {}) {
    const priv = JSON.parse(env.JWT_PRIVATE_KEY)
    const key  = await importJWK(priv, 'ES256')
    return new SignJWT({ sub: String(userId), email, ver })
      .setProtectedHeader({ alg: 'ES256', kid: priv.kid })
      .setIssuer('https://chiyigo.com')
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key)
  }

  it('合法 token → 回 OIDC 標準 claims（sub/email/email_verified/name）', async () => {
    const user = await seedUser({ email: 'userinfo@example.com' })
    const tok  = await signTestAccessToken(user.id, { email: user.email })

    const req = new Request(`${ORIGIN}/api/auth/userinfo`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
    const res  = await userinfoGet({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sub).toBe(String(user.id))
    expect(body.email).toBe('userinfo@example.com')
    expect(body.email_verified).toBe(true)
    expect(body.name).toBeTruthy()
    expect(body.updated_at).toBeTypeOf('number')
  })

  it('無 token → 401', async () => {
    const req = new Request(`${ORIGIN}/api/auth/userinfo`)
    const res = await userinfoGet({ request: req, env })
    expect(res.status).toBe(401)
  })

  it('用戶被封禁 → 403 ACCOUNT_BANNED（即時 DB 檢查，覆蓋 JWT 簽發時 status 快照）', async () => {
    const user = await seedUser({ email: 'banned@example.com' })
    await env.chiyigo_db
      .prepare(`UPDATE users SET status = 'banned' WHERE id = ?`)
      .bind(user.id).run()
    const tok = await signTestAccessToken(user.id, { email: user.email })

    const req = new Request(`${ORIGIN}/api/auth/userinfo`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
    const res  = await userinfoGet({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('ACCOUNT_BANNED')
  })

  it('用戶已軟刪 → 404', async () => {
    const user = await seedUser({ email: 'deleted@example.com' })
    await env.chiyigo_db
      .prepare(`UPDATE users SET deleted_at = datetime('now') WHERE id = ?`)
      .bind(user.id).run()
    const tok = await signTestAccessToken(user.id, { email: user.email })

    const req = new Request(`${ORIGIN}/api/auth/userinfo`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
    const res = await userinfoGet({ request: req, env })
    expect(res.status).toBe(404)
  })
})
