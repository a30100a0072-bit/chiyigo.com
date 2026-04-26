import { describe, it, expect } from 'vitest'
import { validatePassword } from '../functions/utils/password.js'

describe('validatePassword', () => {
  it('rejects non-string', () => {
    expect(validatePassword(undefined).ok).toBe(false)
    expect(validatePassword(null).ok).toBe(false)
    expect(validatePassword(12345678).ok).toBe(false)
  })

  it('rejects too short (<8)', () => {
    expect(validatePassword('Aa1!aaa').ok).toBe(false)
  })

  it('accepts >=12 chars regardless of class', () => {
    expect(validatePassword('aaaaaaaaaaaa').ok).toBe(true)
    expect(validatePassword('123456789012').ok).toBe(true)
  })

  it('accepts 8-11 chars when 3 classes are present', () => {
    expect(validatePassword('Abc12345').ok).toBe(true)        // upper+lower+digit
    expect(validatePassword('abc12345!').ok).toBe(true)       // lower+digit+symbol
    expect(validatePassword('ABC12345!').ok).toBe(true)       // upper+digit+symbol
  })

  it('rejects 8-11 chars with only 2 classes', () => {
    expect(validatePassword('abcdefgh').ok).toBe(false)       // lower only
    expect(validatePassword('abcdefg1').ok).toBe(false)       // lower+digit
    expect(validatePassword('ABCDEFG1').ok).toBe(false)       // upper+digit
  })
})
