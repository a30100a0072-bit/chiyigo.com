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
} from '../functions/utils/scopes'

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

describe('P1-17 Phase 2 — latent role mappings (super_admin / finance / support / user)', () => {
  it('super_admin → 與 admin coarse 完全等價', () => {
    const a = new Set(scopesForRole('admin'))
    const s = new Set(scopesForRole('super_admin'))
    expect(s.size).toBe(a.size)
    for (const x of a) expect(s.has(x)).toBe(true)
  })

  it('finance → 拿 fine payment scope；不得有 users / clients / audit / *_WRITE non-payment', () => {
    const set = new Set(scopesForRole('finance'))
    expect(set.has(SCOPES.ADMIN_PAYMENTS_READ)).toBe(true)
    expect(set.has(SCOPES.ADMIN_PAYMENTS_REFUND)).toBe(true)
    expect(set.has(SCOPES.ADMIN_PAYMENTS_APPROVE)).toBe(true)
    // 不得 escalate
    expect(set.has(SCOPES.ADMIN_USERS)).toBe(false)
    expect(set.has(SCOPES.ADMIN_USERS_WRITE)).toBe(false)
    expect(set.has(SCOPES.ADMIN_CLIENTS)).toBe(false)
    expect(set.has(SCOPES.ADMIN_CLIENTS_WRITE)).toBe(false)
    expect(set.has(SCOPES.ADMIN_AUDIT)).toBe(false)
    expect(set.has(SCOPES.ADMIN_AUDIT_WRITE)).toBe(false)
    // 透過 hierarchy 也不應展開出 ADMIN_PAYMENTS coarse → 不該有 :write（finance 不能 hard delete）
    const eff = effectiveScopesFromJwt({ role: 'finance' })
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_WRITE)).toBe(false)
  })

  it('support → 純 read；無 write / refund / clients', () => {
    const set = new Set(scopesForRole('support'))
    expect(set.has(SCOPES.ADMIN_USERS_READ)).toBe(true)
    expect(set.has(SCOPES.ADMIN_PAYMENTS_READ)).toBe(true)
    expect(set.has(SCOPES.ADMIN_AUDIT_READ)).toBe(true)
    // 不得 escalate
    expect(set.has(SCOPES.ADMIN_USERS_WRITE)).toBe(false)
    expect(set.has(SCOPES.ADMIN_PAYMENTS_REFUND)).toBe(false)
    expect(set.has(SCOPES.ADMIN_PAYMENTS_WRITE)).toBe(false)
    expect(set.has(SCOPES.ADMIN_CLIENTS_READ)).toBe(false)
    expect(set.has(SCOPES.ADMIN_CLIENTS_WRITE)).toBe(false)
    expect(set.has(SCOPES.ADMIN_AUDIT_WRITE)).toBe(false)
  })

  it('user → 與 player 等價（基本 profile 而已）', () => {
    const u = new Set(scopesForRole('user'))
    const p = new Set(scopesForRole('player'))
    expect(u.size).toBe(p.size)
    for (const x of p) expect(u.has(x)).toBe(true)
  })

  it('既有 admin / developer 條目沒被改（backward compat）', () => {
    expect(scopesForRole('admin')).toContain(SCOPES.ADMIN_PAYMENTS)
    expect(scopesForRole('developer')).toContain(SCOPES.ADMIN_PAYMENTS)
  })
})

describe('P1-17 Phase 2 — admin:payments:approve fine scope', () => {
  it('coarse admin:payments → 自動含 :approve', () => {
    const eff = effectiveScopesFromJwt({ scope: 'admin:payments', role: 'player' })
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_APPROVE)).toBe(true)
  })

  it(':refund token 不會自動長出 :approve（fine → fine 互不蘊含）', () => {
    const eff = effectiveScopesFromJwt({ scope: 'admin:payments:refund', role: 'player' })
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_APPROVE)).toBe(false)
  })
})

describe('P1-17 hierarchical scope expansion', () => {
  it('admin:payments coarse → 自動含 :read/:write/:refund', () => {
    const payload = { scope: 'admin:payments', role: 'player' }
    const eff = effectiveScopesFromJwt(payload)
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_READ)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_WRITE)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_REFUND)).toBe(true)
  })

  it('admin role 透過 ROLE_BASE_SCOPES → 也展開 fine', () => {
    const payload = { role: 'admin' }  // 連 scope claim 都沒
    const eff = effectiveScopesFromJwt(payload)
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_REFUND)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_USERS_WRITE)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_WRITE)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_CLIENTS_WRITE)).toBe(true)
  })

  it('只給 fine read 不會自動長出 write', () => {
    const payload = { scope: 'admin:payments:read', role: 'player' }
    const eff = effectiveScopesFromJwt(payload)
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_READ)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_WRITE)).toBe(false)
    expect(eff.has(SCOPES.ADMIN_PAYMENTS_REFUND)).toBe(false)
  })

  it('hasAllScopes：coarse token 也能通過 fine 守門', () => {
    const payload = { scope: 'admin:payments', role: 'player' }
    expect(hasAllScopes(payload, [SCOPES.ADMIN_PAYMENTS_REFUND])).toBe(true)
  })

  it('hasAllScopes：fine read token 不能通過 fine refund 守門', () => {
    const payload = { scope: 'admin:payments:read', role: 'player' }
    expect(hasAllScopes(payload, [SCOPES.ADMIN_PAYMENTS_REFUND])).toBe(false)
  })
})

describe('PR 2.2d — admin:audit_archive fine scope（retry / resolve / purge）', () => {
  it('admin role 透過 ROLE_BASE_SCOPES → 自動含 audit_archive 三 fine', () => {
    const eff = effectiveScopesFromJwt({ role: 'admin' })
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RESOLVE)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_PURGE)).toBe(true)
  })

  it('developer / super_admin 同等', () => {
    for (const role of ['developer', 'super_admin']) {
      const eff = effectiveScopesFromJwt({ role })
      expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY)).toBe(true)
      expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RESOLVE)).toBe(true)
      expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_PURGE)).toBe(true)
    }
  })

  it('coarse admin:audit_archive token → 自動展開 3 fine', () => {
    const eff = effectiveScopesFromJwt({ scope: 'admin:audit_archive', role: 'player' })
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RESOLVE)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_PURGE)).toBe(true)
  })

  it('只給 :retry fine → 不會長出 :resolve / :purge（最少特權）', () => {
    const eff = effectiveScopesFromJwt({ scope: 'admin:audit_archive:retry', role: 'player' })
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RESOLVE)).toBe(false)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_PURGE)).toBe(false)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE)).toBe(false)
  })

  it('admin:audit coarse 不會誤展開 audit_archive（兩個獨立 namespace）', () => {
    const eff = effectiveScopesFromJwt({ scope: 'admin:audit', role: 'player' })
    expect(eff.has(SCOPES.ADMIN_AUDIT_WRITE)).toBe(true)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE)).toBe(false)
    expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY)).toBe(false)
  })

  it('finance / support 不得有 audit_archive 任何 fine（避免金流/客服 role 升權）', () => {
    for (const role of ['finance', 'support']) {
      const eff = effectiveScopesFromJwt({ role })
      expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE)).toBe(false)
      expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY)).toBe(false)
      expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_RESOLVE)).toBe(false)
      expect(eff.has(SCOPES.ADMIN_AUDIT_ARCHIVE_PURGE)).toBe(false)
    }
  })
})
