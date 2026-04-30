import { describe, it, expect } from 'vitest'
import { getProvider, SUPPORTED_PROVIDERS } from '../functions/utils/oauth-providers.js'

const env = {
  DISCORD_CLIENT_ID: 'd-id', DISCORD_CLIENT_SECRET: 'd-sec',
  GOOGLE_CLIENT_ID:  'g-id', GOOGLE_CLIENT_SECRET:  'g-sec',
  LINE_CLIENT_ID:    'l-id', LINE_CLIENT_SECRET:    'l-sec',
  FACEBOOK_CLIENT_ID:'f-id', FACEBOOK_CLIENT_SECRET:'f-sec',
  APPLE_CLIENT_ID:   'a-id', APPLE_CLIENT_SECRET:   'a-sec',
}

describe('SUPPORTED_PROVIDERS', () => {
  it('包含 5 個 provider', () => {
    expect(SUPPORTED_PROVIDERS).toEqual(expect.arrayContaining(
      ['discord', 'google', 'line', 'facebook', 'apple']
    ))
  })
})

describe('getProvider', () => {
  it('小寫 / 大寫 / 混合大小寫都能匹配', () => {
    expect(getProvider('google', env)).toBeTruthy()
    expect(getProvider('GOOGLE', env)).toBeTruthy()
    expect(getProvider('Google', env)).toBeTruthy()
  })
  it('不支援的 provider → null', () => {
    expect(getProvider('twitter', env)).toBe(null)
    expect(getProvider('', env)).toBe(null)
    expect(getProvider(null, env)).toBe(null)
    expect(getProvider(undefined, env)).toBe(null)
  })
  it('注入 clientId / clientSecret 對應大寫 env', () => {
    const cfg = getProvider('google', env)
    expect(cfg.clientId).toBe('g-id')
    expect(cfg.clientSecret).toBe('g-sec')
  })
  it('env 缺欄位 → null（不是 undefined）', () => {
    const cfg = getProvider('google', {})
    expect(cfg.clientId).toBe(null)
    expect(cfg.clientSecret).toBe(null)
  })
})

describe('trustEmail 設定（核心安防參數，不可隨意改動）', () => {
  it('Google / Discord / Apple 信箱可信 → trustEmail=true', () => {
    expect(getProvider('google', env).trustEmail).toBe(true)
    expect(getProvider('discord', env).trustEmail).toBe(true)
    expect(getProvider('apple', env).trustEmail).toBe(true)
  })
  it('LINE / Facebook 不可信 → trustEmail=false（避免 IdP 假冒 email 接管帳號）', () => {
    expect(getProvider('line', env).trustEmail).toBe(false)
    expect(getProvider('facebook', env).trustEmail).toBe(false)
  })
})

describe('normalizeProfile 統一輸出格式', () => {
  it('Discord：avatar 拼 CDN URL；verified bool', () => {
    const p = getProvider('discord', env).normalizeProfile({
      id: '123', email: 'a@b', username: 'foo', avatar: 'abc', verified: true,
    })
    expect(p).toEqual({
      provider_id: '123', email: 'a@b', name: 'foo',
      avatar: 'https://cdn.discordapp.com/avatars/123/abc.png',
      email_verified: true,
    })
  })
  it('Discord：無 avatar / verified 缺省', () => {
    const p = getProvider('discord', env).normalizeProfile({ id: '1' })
    expect(p.avatar).toBe(null)
    expect(p.email_verified).toBe(false)
    expect(p.email).toBe(null)
    expect(p.name).toBe(null)
  })
  it('Google：sub → provider_id；email_verified 必須 === true', () => {
    expect(getProvider('google', env).normalizeProfile({
      sub: 'abc', email: 'g@b', name: 'G', picture: 'http://p', email_verified: true,
    }).email_verified).toBe(true)
    // Google 偶而回字串 'true'，依現行邏輯會被視為 false（嚴格 === true）
    expect(getProvider('google', env).normalizeProfile({
      sub: 'abc', email_verified: 'true',
    }).email_verified).toBe(false)
  })
  it('LINE：userId → provider_id，email_verified 永遠 false', () => {
    const p = getProvider('line', env).normalizeProfile({
      userId: 'U123', displayName: 'L', pictureUrl: 'http://p',
    })
    expect(p.provider_id).toBe('U123')
    expect(p.email_verified).toBe(false)
  })
  it('Facebook：picture.data.url 取頭像，email 可缺', () => {
    const p = getProvider('facebook', env).normalizeProfile({
      id: 'fb1', name: 'F', picture: { data: { url: 'http://fb-pic' } },
    })
    expect(p.avatar).toBe('http://fb-pic')
    expect(p.email).toBe(null)
    expect(p.email_verified).toBe(false)
  })
  it('Apple：email_verified 接受 true 或字串 "true"（從 id_token JWT 來）', () => {
    expect(getProvider('apple', env).normalizeProfile({ sub: 'a1', email_verified: true }).email_verified).toBe(true)
    expect(getProvider('apple', env).normalizeProfile({ sub: 'a1', email_verified: 'true' }).email_verified).toBe(true)
    expect(getProvider('apple', env).normalizeProfile({ sub: 'a1', email_verified: false }).email_verified).toBe(false)
  })
})
