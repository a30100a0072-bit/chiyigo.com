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
