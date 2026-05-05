/**
 * Phase C-2 unit tests — scope catalog + helpers
 */

import { describe, it, expect } from 'vitest'
import {
  SCOPES,
  scopesForRole,
  buildTokenScope,
  effectiveScopesFromJwt,
  hasScope,
  hasAllScopes,
} from '../functions/utils/scopes.js'

describe('scopesForRole', () => {
  it('player → 基本 read/write profile', () => {
    expect(scopesForRole('player')).toContain(SCOPES.READ_PROFILE)
    expect(scopesForRole('player')).toContain(SCOPES.WRITE_PROFILE)
    expect(scopesForRole('player')).not.toContain(SCOPES.ADMIN_USERS)
  })

  it('admin → 含 admin:* 全套', () => {
    const s = scopesForRole('admin')
    expect(s).toContain(SCOPES.ADMIN_USERS)
    expect(s).toContain(SCOPES.ADMIN_REVOKE)
    expect(s).toContain(SCOPES.ADMIN_AUDIT)
    expect(s).toContain(SCOPES.ADMIN_CLIENTS)
  })

  it('developer → 同 admin', () => {
    const adminScopes = new Set(scopesForRole('admin'))
    const devScopes   = new Set(scopesForRole('developer'))
    for (const s of adminScopes) expect(devScopes.has(s)).toBe(true)
  })

  it('未知 role → 空陣列', () => {
    expect(scopesForRole(undefined)).toEqual([])
    expect(scopesForRole('hacker')).toEqual([])
  })
})

describe('buildTokenScope', () => {
  it('沒帶 OIDC scope → 只有 role 內建', () => {
    const s = buildTokenScope('player').split(' ')
    expect(s).toContain(SCOPES.READ_PROFILE)
    expect(s).not.toContain(SCOPES.OPENID)
  })

  it('帶 OIDC scope → 合併', () => {
    const s = buildTokenScope('player', 'openid email').split(' ')
    expect(s).toContain(SCOPES.OPENID)
    expect(s).toContain(SCOPES.EMAIL)
    expect(s).toContain(SCOPES.READ_PROFILE)
  })

  it('OIDC scope 重複 role scope → 去重', () => {
    const s = buildTokenScope('player', 'read:profile read:profile').split(' ')
    expect(s.filter(x => x === SCOPES.READ_PROFILE).length).toBe(1)
  })

  it('admin role + 無 OIDC → 含 admin:*', () => {
    const s = buildTokenScope('admin')
    expect(s).toContain(SCOPES.ADMIN_AUDIT)
  })
})

describe('effectiveScopesFromJwt + hasScope/hasAllScopes', () => {
  it('JWT 含 scope claim → 解析回 Set', () => {
    const set = effectiveScopesFromJwt({ scope: 'openid admin:audit', role: 'player' })
    expect(set.has('openid')).toBe(true)
    expect(set.has('admin:audit')).toBe(true)
  })

  it('JWT 缺 scope claim → fallback 用 role 推', () => {
    const set = effectiveScopesFromJwt({ role: 'admin' })  // 舊 token 沒 scope
    expect(set.has(SCOPES.ADMIN_AUDIT)).toBe(true)
  })

  it('JWT 帶部分 scope → 與 role scope 取聯集', () => {
    const set = effectiveScopesFromJwt({ scope: 'play:poker', role: 'player' })
    expect(set.has('play:poker')).toBe(true)
    expect(set.has(SCOPES.READ_PROFILE)).toBe(true)  // 從 role 補
  })

  it('hasScope 命中', () => {
    const payload = { scope: 'admin:audit', role: 'admin' }
    expect(hasScope(payload, SCOPES.ADMIN_AUDIT)).toBe(true)
    expect(hasScope(payload, 'play:poker')).toBe(false)
  })

  it('hasAllScopes：全部命中才 true', () => {
    const payload = { scope: 'admin:audit admin:revoke', role: 'admin' }
    expect(hasAllScopes(payload, [SCOPES.ADMIN_AUDIT, SCOPES.ADMIN_REVOKE])).toBe(true)
    expect(hasAllScopes(payload, [SCOPES.ADMIN_AUDIT, 'play:poker'])).toBe(false)
  })

  it('payload 為 null / 非物件 → 空 set', () => {
    expect(effectiveScopesFromJwt(null).size).toBe(0)
    expect(effectiveScopesFromJwt('string').size).toBe(0)
  })
})
