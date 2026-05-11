import { describe, it, expect } from 'vitest'
import { isWebClient } from '../functions/utils/cookies.js'

function req(origin) {
  return new Request('http://x/', { headers: origin ? { Origin: origin } : {} })
}

describe('isWebClient (規格 B：Origin 為 source of truth)', () => {
  it('chiyigo Origin + 無 platform → web', () => {
    expect(isWebClient(req('https://chiyigo.com'))).toBe(true)
    expect(isWebClient(req('https://chiyigo.com'), {})).toBe(true)
  })

  it('chiyigo 子網域 Origin → web', () => {
    expect(isWebClient(req('https://mbti.chiyigo.com'))).toBe(true)
    expect(isWebClient(req('https://talo.chiyigo.com'))).toBe(true)
  })

  it('chiyigo Origin + platform=web → web', () => {
    expect(isWebClient(req('https://chiyigo.com'), { platform: 'web' })).toBe(true)
  })

  // P1 鎖：hybrid webview 在 chiyigo 開但宣告 platform=ios → non-web
  it('chiyigo Origin + platform=ios → non-web（hybrid webview 不誤判）', () => {
    expect(isWebClient(req('https://chiyigo.com'), { platform: 'ios' })).toBe(false)
    expect(isWebClient(req('https://chiyigo.com'), { platform: 'android' })).toBe(false)
    expect(isWebClient(req('https://chiyigo.com'), { platform: 'unity' })).toBe(false)
  })

  // P1 鎖：跨站 Origin + 偽造 platform=web 不該被升級為 web
  it('evil.com Origin + platform=web → non-web', () => {
    expect(isWebClient(req('https://evil.com'), { platform: 'web' })).toBe(false)
  })

  it('evil.com Origin + 無 platform → non-web', () => {
    expect(isWebClient(req('https://evil.com'))).toBe(false)
  })

  // 舊 App regression：沒 Origin + 沒 platform + 沒 device_uuid → 仍 non-web
  it('無 Origin + 無 platform → non-web（programmatic / curl / 舊 App）', () => {
    expect(isWebClient(req(null))).toBe(false)
    expect(isWebClient(req(null), {})).toBe(false)
    expect(isWebClient(req(null), { platform: undefined })).toBe(false)
  })

  it('無 Origin + platform=ios → non-web', () => {
    expect(isWebClient(req(null), { platform: 'ios' })).toBe(false)
  })

  it('壞 Origin 字串不爆炸', () => {
    expect(isWebClient(req('not-a-url'))).toBe(false)
    expect(isWebClient(req(''))).toBe(false)
  })

  it('chiyigo 結尾但非子網域 → non-web（避免 evilchiyigo.com）', () => {
    expect(isWebClient(req('https://evilchiyigo.com'))).toBe(false)
    expect(isWebClient(req('https://notchiyigo.com'))).toBe(false)
  })

  it('device_uuid 不參與判斷（規格 B 核心）', () => {
    // 不接受 device_uuid 參數，即使傳入也不影響結果（接口刻意只收 platform）
    expect(isWebClient(req('https://chiyigo.com'), { platform: 'web' })).toBe(true)
    expect(isWebClient(req(null), { platform: 'web' })).toBe(false)
  })
})
