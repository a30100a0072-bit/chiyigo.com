import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, exportJWK } from 'jose'
import { signJwt, verifyJwt, getPublicJwk } from '../functions/utils/jwt.js'

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
