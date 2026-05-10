/**
 * audit-policy registry unit test（F-3 Phase 1，2026-05-10）
 *
 * 驗：
 *  - 5 個分類常數存在且 frozen
 *  - 已知 event 分類正確（每類抽樣 + 關鍵安全事件如 aud_mismatch / device_mismatch）
 *  - 未知 event_type 回 null
 *  - registry 大小覆蓋當下 grep 出來的 97 個 event_type（防漏分類）
 *  - 同一 event 不重複歸兩類（map 自然保證，但測一次以防手誤）
 */

import { describe, it, expect } from 'vitest'
import {
  AUDIT_CATEGORY,
  classifyAuditEvent,
  listEventsByCategory,
  _registrySize,
} from '../functions/utils/audit-policy.js'

describe('audit-policy AUDIT_CATEGORY', () => {
  it('5 個分類常數齊全', () => {
    expect(AUDIT_CATEGORY.IMMUTABLE).toBe('immutable')
    expect(AUDIT_CATEGORY.SECURITY_SIGNAL).toBe('security_signal')
    expect(AUDIT_CATEGORY.TELEMETRY).toBe('telemetry')
    expect(AUDIT_CATEGORY.READ_AUDIT).toBe('read_audit')
    expect(AUDIT_CATEGORY.DEBUG_FAILURE).toBe('debug_failure')
  })

  it('AUDIT_CATEGORY 是 frozen', () => {
    expect(Object.isFrozen(AUDIT_CATEGORY)).toBe(true)
  })
})

describe('classifyAuditEvent — immutable（金融/權限/安全狀態變更）', () => {
  it.each([
    'account.delete',
    'admin.user.banned',
    'admin.user.role_changed',
    'admin.token.revoked.user',
    'auth.refresh.aud_mismatch',     // F-2 critical
    'auth.refresh.device_mismatch',
    'mfa.totp.disable',
    'payment.refund.success',
    'payment.webhook.amount_mismatch',
    'requisition.refund.approved',
    'wallet.bind.success',
    'webauthn.credential.deleted',
  ])('%s → immutable', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.IMMUTABLE)
  })
})

describe('classifyAuditEvent — security_signal（撞庫/釣魚/2FA fail）', () => {
  it.each([
    'auth.login.fail',
    'auth.login.success',             // 高頻但仍是 security trail
    'auth.refresh.fail',              // reuse_detected
    'auth.country_jump',
    'auth.new_device',
    'mfa.totp.verify.replay',
    'admin.unknown_role_actor',
    'webauthn.register.fail',
  ])('%s → security_signal', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.SECURITY_SIGNAL)
  })
})

describe('classifyAuditEvent — telemetry（rate_limit / dispatch）', () => {
  it.each([
    'auth.login.rate_limited',
    'auth.refresh.rate_limited',
    'oauth.backchannel.dispatch',
    'webauthn.register.options',
  ])('%s → telemetry', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.TELEMETRY)
  })
})

describe('classifyAuditEvent — read_audit（admin 讀敏感資料）', () => {
  it.each([
    'admin.audit.read',
    'admin.requisitions.read',
    'admin.refund_requests.read',
    'payment.metadata_archive.viewed',
  ])('%s → read_audit', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.READ_AUDIT)
  })
})

describe('classifyAuditEvent — debug_failure（操作異常/網路錯）', () => {
  it.each([
    'auth.delete.exception',
    'payment.refund.network_error',
    'payment.vendor.misconfigured',
    'kyc.webhook.fail',
  ])('%s → debug_failure', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.DEBUG_FAILURE)
  })
})

describe('classifyAuditEvent — 未知 event', () => {
  it.each([
    'foo.bar.baz',
    '',
    'admin.totally.fake.event',
    'auth.login.success.extra',  // 多了 .extra 應認不出
  ])('%s → null', (e) => {
    expect(classifyAuditEvent(e)).toBeNull()
  })
})

describe('registry coverage', () => {
  it('registry 大小 = 5 類加總（無重複歸類，無遺漏）', () => {
    const sum =
      listEventsByCategory(AUDIT_CATEGORY.IMMUTABLE).length +
      listEventsByCategory(AUDIT_CATEGORY.SECURITY_SIGNAL).length +
      listEventsByCategory(AUDIT_CATEGORY.TELEMETRY).length +
      listEventsByCategory(AUDIT_CATEGORY.READ_AUDIT).length +
      listEventsByCategory(AUDIT_CATEGORY.DEBUG_FAILURE).length
    expect(sum).toBe(_registrySize)
    // 當下盤點 98（grep functions/ 後 unique 數，2026-05-10）；新增 audit event 必須
    // 同 PR 補進 audit-policy.js 並更新本斷言。否則 prod 會出 [audit-policy] unclassified warn。
    expect(_registrySize).toBe(98)
  })

  it('listEventsByCategory 各類有合理數量（防整類被誤刪）', () => {
    expect(listEventsByCategory(AUDIT_CATEGORY.IMMUTABLE).length).toBeGreaterThanOrEqual(40)
    expect(listEventsByCategory(AUDIT_CATEGORY.SECURITY_SIGNAL).length).toBeGreaterThanOrEqual(20)
    expect(listEventsByCategory(AUDIT_CATEGORY.TELEMETRY).length).toBeGreaterThanOrEqual(5)
    expect(listEventsByCategory(AUDIT_CATEGORY.READ_AUDIT).length).toBeGreaterThanOrEqual(3)
    expect(listEventsByCategory(AUDIT_CATEGORY.DEBUG_FAILURE).length).toBeGreaterThanOrEqual(5)
  })
})
