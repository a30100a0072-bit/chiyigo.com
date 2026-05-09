/**
 * P1-17 Phase 2 unit tests — roles catalog + audit filter
 */

import { describe, it, expect } from 'vitest'
import {
  VALID_ROLES,
  isValidRole,
  canRoleSeeAuditEvent,
} from '../functions/utils/roles.js'

describe('VALID_ROLES + isValidRole', () => {
  it('包含全部 8 個 role（4 legacy + 4 latent）', () => {
    expect(VALID_ROLES).toEqual([
      'player', 'moderator', 'admin', 'developer',
      'super_admin', 'finance', 'support', 'user',
    ])
  })

  it('isValidRole 對合法 role 回 true', () => {
    for (const r of VALID_ROLES) expect(isValidRole(r)).toBe(true)
  })

  it('isValidRole 對未知 / 非字串回 false', () => {
    expect(isValidRole('hacker')).toBe(false)
    expect(isValidRole('')).toBe(false)
    expect(isValidRole(null)).toBe(false)
    expect(isValidRole(undefined)).toBe(false)
    expect(isValidRole(123)).toBe(false)
    expect(isValidRole({})).toBe(false)
  })
})

describe('canRoleSeeAuditEvent — non-support roles 走全套', () => {
  for (const role of ['super_admin', 'admin', 'developer', 'finance']) {
    it(`${role} 對任意 event 回 true`, () => {
      expect(canRoleSeeAuditEvent('auth.login.risk_block', role)).toBe(true)
      expect(canRoleSeeAuditEvent('admin.user.role_changed', role)).toBe(true)
      expect(canRoleSeeAuditEvent('foo.bar.baz', role)).toBe(true)
    })
  }
})

describe('canRoleSeeAuditEvent — support 白/黑名單', () => {
  it('白名單 prefix 命中 → true', () => {
    expect(canRoleSeeAuditEvent('auth.login.success', 'support')).toBe(true)
    expect(canRoleSeeAuditEvent('auth.login.fail', 'support')).toBe(true)
    expect(canRoleSeeAuditEvent('auth.logout.normal', 'support')).toBe(true)
    expect(canRoleSeeAuditEvent('auth.password_reset.completed', 'support')).toBe(true)
    expect(canRoleSeeAuditEvent('payment.intent.succeeded', 'support')).toBe(true)
    expect(canRoleSeeAuditEvent('payment.refund.completed', 'support')).toBe(true)
    expect(canRoleSeeAuditEvent('admin.read.rate_limited', 'support')).toBe(true)
  })

  it('白名單外 → false（fail-closed）', () => {
    expect(canRoleSeeAuditEvent('webauthn.register', 'support')).toBe(false)
    expect(canRoleSeeAuditEvent('foo.bar', 'support')).toBe(false)
    expect(canRoleSeeAuditEvent('', 'support')).toBe(false)
    expect(canRoleSeeAuditEvent(null, 'support')).toBe(false)
  })

  it('黑名單 prefix 即使白名單也擋下', () => {
    // 'auth.login.' 在白名單，但 'auth.login.risk_' / 'auth.login.device_' 在黑名單
    expect(canRoleSeeAuditEvent('auth.login.risk_block', 'support')).toBe(false)
    expect(canRoleSeeAuditEvent('auth.login.risk_warn', 'support')).toBe(false)
    expect(canRoleSeeAuditEvent('auth.login.device_new', 'support')).toBe(false)
    expect(canRoleSeeAuditEvent('admin.audit.delete', 'support')).toBe(false)
    expect(canRoleSeeAuditEvent('admin.user.role_changed', 'support')).toBe(false)
  })
})
