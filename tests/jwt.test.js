import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, exportJWK } from 'jose'
import { signJwt, verifyJwt, getPublicJwk, getPublicJwks, _resetJwtCache } from '../functions/utils/jwt.js'

let env

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const privJwk = await exportJWK(privateKey)
  const pubJwk  = await exportJWK(publicKey)
  privJwk.kid = pubJwk.kid = 'test-key'
  privJwk.alg = pubJwk.alg = 'ES256'
  pubJwk.use  = 'sig'
  env = {
    JWT_PRIVATE_KEY: JSON.stringify(privJwk),
    JWT_PUBLIC_KEY:  JSON.stringify(pubJwk),
  }
})

describe('signJwt / verifyJwt', () => {
  it('roundtrip: signed token verifies and returns payload', async () => {
    const token = await signJwt({ sub: 'user-1', scope: 'read' }, '5m', env)
    expect(typeof token).toBe('string')
    const payload = await verifyJwt(token, env)
    expect(payload.sub).toBe('user-1')
    expect(payload.scope).toBe('read')
    expect(payload.iat).toBeTypeOf('number')
    expect(payload.exp).toBeTypeOf('number')
  })

  it('rejects tampered token', async () => {
    const token = await signJwt({ sub: 'x' }, '5m', env)
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A') + token.slice(-1)
    await expect(verifyJwt(tampered, env)).rejects.toThrow()
  })

  it('always sets iss=https://chiyigo.com', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env)
    const payload = await verifyJwt(token, env)
    expect(payload.iss).toBe('https://chiyigo.com')
  })

  it('sets aud when audience option provided', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env, { audience: 'talo' })
    const payload = await verifyJwt(token, env)
    expect(payload.aud).toBe('talo')
  })

  it('verifyJwt accepts matching audience', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env, { audience: 'chiyigo' })
    const payload = await verifyJwt(token, env, { audience: 'chiyigo' })
    expect(payload.aud).toBe('chiyigo')
  })

  it('verifyJwt rejects mismatched audience', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env, { audience: 'mbti' })
    await expect(verifyJwt(token, env, { audience: 'chiyigo' })).rejects.toThrow()
  })

  it('verifyJwt audience accepts array of valid auds', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env, { audience: 'sport-app' })
    const payload = await verifyJwt(token, env, { audience: ['chiyigo', 'sport-app'] })
    expect(payload.aud).toBe('sport-app')
  })

  it('verifyJwt without audience opt does NOT verify aud (backward compat)', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env, { audience: 'whatever' })
    const payload = await verifyJwt(token, env)
    expect(payload.aud).toBe('whatever')
  })

  it('signJwt 自動補 jti（Phase B 精準 revoke）', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env)
    const payload = await verifyJwt(token, env)
    expect(payload.jti).toBeTypeOf('string')
    expect(payload.jti.length).toBeGreaterThan(10) // randomUUID 是 36 字元
  })

  it('signJwt jti 每次 unique', async () => {
    const t1 = await signJwt({ sub: 'u' }, '5m', env)
    const t2 = await signJwt({ sub: 'u' }, '5m', env)
    const p1 = await verifyJwt(t1, env)
    const p2 = await verifyJwt(t2, env)
    expect(p1.jti).not.toBe(p2.jti)
  })

  it('caller 自帶 jti 時 signJwt 不覆寫', async () => {
    const token = await signJwt({ sub: 'u', jti: 'fixed-jti-123' }, '5m', env)
    const payload = await verifyJwt(token, env)
    expect(payload.jti).toBe('fixed-jti-123')
  })

  it('passes through ver claim (token_version)', async () => {
    const token = await signJwt({ sub: 'u', ver: 7 }, '5m', env)
    const payload = await verifyJwt(token, env)
    expect(payload.ver).toBe(7)
  })

  it('omits aud when audience option not provided', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env)
    const payload = await verifyJwt(token, env)
    expect(payload.aud).toBeUndefined()
  })

  it('header includes kid', async () => {
    const token = await signJwt({ sub: 'u' }, '5m', env)
    const headerB64 = token.split('.')[0]
    const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe('test-key')
  })
})

describe('getPublicJwk', () => {
  it('returns only public fields (no d)', () => {
    const jwk = getPublicJwk(env)
    expect(jwk.kty).toBeDefined()
    expect(jwk.crv).toBeDefined()
    expect(jwk.x).toBeDefined()
    expect(jwk.y).toBeDefined()
    expect(jwk.kid).toBe('test-key')
    expect(jwk.use).toBe('sig')
    expect(jwk.alg).toBe('ES256')
    expect(jwk.d).toBeUndefined()
  })
})

describe('JWKS multi-key verification', () => {
  it('JWT_PUBLIC_KEYS 陣列 → 用對應 kid 驗證舊 token', async () => {
    // 先簽一個 token（kid=test-key）
    const oldToken = await signJwt({ sub: 'rotate-old' }, '5m', env)

    // 模擬 rotation：active 改為 new-key，但保留 test-key 在驗章陣列
    const { privateKey: newPriv, publicKey: newPub } = await generateKeyPair('ES256', { extractable: true })
    const newPrivJwk = await exportJWK(newPriv)
    const newPubJwk  = await exportJWK(newPub)
    newPrivJwk.kid = newPubJwk.kid = 'new-key'
    newPrivJwk.alg = newPubJwk.alg = 'ES256'
    newPubJwk.use  = 'sig'

    const oldPubJwk = JSON.parse(env.JWT_PUBLIC_KEY)
    const rotatedEnv = {
      JWT_PRIVATE_KEY: JSON.stringify(newPrivJwk),
      JWT_PUBLIC_KEYS: JSON.stringify([newPubJwk, oldPubJwk]),
    }
    _resetJwtCache()

    // 1. 舊 token (kid=test-key) 仍可被驗
    const p1 = await verifyJwt(oldToken, rotatedEnv)
    expect(p1.sub).toBe('rotate-old')

    // 2. 新簽的 token (kid=new-key) 也可被驗
    const newToken = await signJwt({ sub: 'rotate-new' }, '5m', rotatedEnv)
    const p2 = await verifyJwt(newToken, rotatedEnv)
    expect(p2.sub).toBe('rotate-new')

    // 3. 從 keys map 移除舊 kid → 舊 token 應失敗
    _resetJwtCache()
    const noOldEnv = {
      JWT_PRIVATE_KEY: JSON.stringify(newPrivJwk),
      JWT_PUBLIC_KEYS: JSON.stringify([newPubJwk]),
    }
    await expect(verifyJwt(oldToken, noOldEnv)).rejects.toThrow()

    // restore module cache to original keys for subsequent tests
    _resetJwtCache()
  })

  it('getPublicJwks 回傳陣列，每筆只含公鑰欄位', () => {
    _resetJwtCache()
    const keys = getPublicJwks(env)
    expect(Array.isArray(keys)).toBe(true)
    expect(keys).toHaveLength(1)
    expect(keys[0].d).toBeUndefined()
    expect(keys[0].kid).toBe('test-key')
  })

  it('JWT_PUBLIC_KEYS 為非陣列 → throw', () => {
    _resetJwtCache()
    expect(() => getPublicJwks({ JWT_PUBLIC_KEYS: '{"single": true}' })).toThrow()
    _resetJwtCache()
  })
})
