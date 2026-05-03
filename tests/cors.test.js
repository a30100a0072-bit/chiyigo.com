import { describe, it, expect } from 'vitest'
import { getCorsHeaders, resolveAud } from '../functions/utils/cors.js'

function req(origin) {
  return new Request('http://x/', { headers: origin ? { Origin: origin } : {} })
}

describe('resolveAud', () => {
  it('URL → 對應 aud', () => {
    expect(resolveAud('https://talo.chiyigo.com')).toBe('talo')
    expect(resolveAud('https://mbti.chiyigo.com')).toBe('mbti')
    expect(resolveAud('https://talo.chiyigo.com/path?x=1')).toBe('talo')
  })
  it('aud 字串直接回傳', () => {
    expect(resolveAud('talo')).toBe('talo')
    expect(resolveAud('mbti')).toBe('mbti')
    expect(resolveAud('chiyigo')).toBe('chiyigo')
  })
  it('未知 / 無效 / undefined → chiyigo', () => {
    expect(resolveAud('https://evil.com')).toBe('chiyigo')
    expect(resolveAud('not-a-url')).toBe('chiyigo')
    expect(resolveAud(undefined)).toBe('chiyigo')
    expect(resolveAud(null)).toBe('chiyigo')
    expect(resolveAud('')).toBe('chiyigo')
    expect(resolveAud(123)).toBe('chiyigo')
  })
})

describe('getCorsHeaders', () => {
  const env = {}
  it('白名單 origin → 完整 CORS header', () => {
    const h = getCorsHeaders(req('https://talo.chiyigo.com'), env)
    expect(h['Access-Control-Allow-Origin']).toBe('https://talo.chiyigo.com')
    expect(h['Access-Control-Allow-Methods']).toContain('POST')
    expect(h['Access-Control-Allow-Headers']).toContain('Content-Type')
    expect(h['Vary']).toBe('Origin')
  })
  it('chiyigo / mbti 預設白名單', () => {
    expect(getCorsHeaders(req('https://chiyigo.com'), env)['Access-Control-Allow-Origin'])
      .toBe('https://chiyigo.com')
    expect(getCorsHeaders(req('https://mbti.chiyigo.com'), env)['Access-Control-Allow-Origin'])
      .toBe('https://mbti.chiyigo.com')
  })
  it('非白名單 origin → 空物件', () => {
    expect(getCorsHeaders(req('https://evil.com'), env)).toEqual({})
  })
  it('無 Origin header → 空物件', () => {
    expect(getCorsHeaders(req(null), env)).toEqual({})
  })
  it('env.ALLOWED_ORIGINS 動態加入', () => {
    const e = { ALLOWED_ORIGINS: 'https://extra.example.com, https://other.test' }
    expect(getCorsHeaders(req('https://extra.example.com'), e)['Access-Control-Allow-Origin'])
      .toBe('https://extra.example.com')
    expect(getCorsHeaders(req('https://other.test'), e)['Access-Control-Allow-Origin'])
      .toBe('https://other.test')
  })
  it('development 模式放行 localhost / 127.0.0.1 任意 port', () => {
    const e = { ENVIRONMENT: 'development' }
    expect(getCorsHeaders(req('http://localhost:5173'), e)['Access-Control-Allow-Origin'])
      .toBe('http://localhost:5173')
    expect(getCorsHeaders(req('http://127.0.0.1:8788'), e)['Access-Control-Allow-Origin'])
      .toBe('http://127.0.0.1:8788')
  })
  it('非 development 不放行 localhost', () => {
    expect(getCorsHeaders(req('http://localhost:5173'), {})).toEqual({})
  })
})

describe('getCorsHeaders with { credentials: true }', () => {
  it('白名單 origin → 帶 Allow-Credentials: true', () => {
    const h = getCorsHeaders(req('https://talo.chiyigo.com'), {}, { credentials: true })
    expect(h['Access-Control-Allow-Origin']).toBe('https://talo.chiyigo.com')
    expect(h['Access-Control-Allow-Credentials']).toBe('true')
    expect(h['Vary']).toBe('Origin')
  })
  it('預設不帶 Allow-Credentials', () => {
    const h = getCorsHeaders(req('https://talo.chiyigo.com'), {})
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined()
  })
  it('非白名單 → 空物件（不帶 Allow-Credentials 避免 wildcard 被瀏覽器拒）', () => {
    expect(getCorsHeaders(req('https://evil.com'), {}, { credentials: true })).toEqual({})
    expect(getCorsHeaders(req(null), {}, { credentials: true })).toEqual({})
  })
})
