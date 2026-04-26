import { describe, it, expect } from 'vitest'
import {
  generateSalt,
  generateSecureToken,
  hashPassword,
  verifyPassword,
  hashToken,
  pkceVerify,
  generateBackupCodes,
  verifyBackupCode,
} from '../functions/utils/crypto.js'

describe('generateSalt / generateSecureToken', () => {
  it('returns 64-char hex (32 bytes)', () => {
    const s = generateSalt()
    expect(s).toMatch(/^[0-9a-f]{64}$/)
    const t = generateSecureToken()
    expect(t).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns different values each call', () => {
    expect(generateSalt()).not.toBe(generateSalt())
  })
})

describe('hashPassword / verifyPassword', () => {
  it('roundtrip: correct password verifies', async () => {
    const salt = generateSalt()
    const hash = await hashPassword('correct horse battery staple', salt)
    expect(await verifyPassword('correct horse battery staple', salt, hash)).toBe(true)
  })

  it('rejects wrong password', async () => {
    const salt = generateSalt()
    const hash = await hashPassword('right', salt)
    expect(await verifyPassword('wrong', salt, hash)).toBe(false)
  })

  it('rejects mismatched length stored hash (timing-safe early exit)', async () => {
    const salt = generateSalt()
    expect(await verifyPassword('x', salt, 'shorthex')).toBe(false)
  })

  it('different salts produce different hashes for same password', async () => {
    const s1 = generateSalt()
    const s2 = generateSalt()
    const h1 = await hashPassword('same', s1)
    const h2 = await hashPassword('same', s2)
    expect(h1).not.toBe(h2)
  })
})

describe('hashToken', () => {
  it('is deterministic', async () => {
    const a = await hashToken('abc')
    const b = await hashToken('abc')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('pkceVerify', () => {
  it('verifies a known RFC 7636 vector', async () => {
    // RFC 7636 Appendix B
    const verifier  = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    expect(await pkceVerify(verifier, challenge)).toBe(true)
  })

  it('rejects mismatched verifier', async () => {
    expect(await pkceVerify('wrong', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false)
  })
})

describe('generateBackupCodes / verifyBackupCode', () => {
  it('generates 10 plain codes in XXXXX-XXXXX-XXXXX-XXXXX format with matching hashes', async () => {
    const { plain, hashed } = await generateBackupCodes()
    expect(plain).toHaveLength(10)
    expect(hashed).toHaveLength(10)
    for (const p of plain) {
      expect(p).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}-[0-9a-f]{5}-[0-9a-f]{5}$/)
    }
    for (const h of hashed) {
      expect(h).toMatch(/^[0-9a-f]{64}$/)
    }
    // Each plain matches its corresponding hash
    for (let i = 0; i < 10; i++) {
      expect(await verifyBackupCode(plain[i], hashed[i])).toBe(true)
    }
  })

  it('rejects wrong code against a real hash', async () => {
    const { hashed } = await generateBackupCodes()
    expect(await verifyBackupCode('00000-00000-00000-00000', hashed[0])).toBe(false)
  })

  it('accepts dashed and undashed formats equally', async () => {
    const { plain, hashed } = await generateBackupCodes()
    const noDash = plain[0].replace(/-/g, '')
    expect(await verifyBackupCode(noDash, hashed[0])).toBe(true)
  })
})
