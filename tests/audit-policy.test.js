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
  classifyForCold,
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

  // PR 1.1 自審 L-2：12 個 archive ops events 顯式覆蓋
  // PR 1.2 codex r3：deploy_ordering 拆 SYSTEM_OPS_IMMUTABLE
  it.each([
    'audit.archive.chunk_uploaded',
    'audit.archive.marked_archived',
    'audit.archive.d1_purged',
    'audit.archive.cold_copied',
    'audit.archive.month_completed',
    'audit.archive.aggregate_completed',
    'audit.archive.verification_failed',
    'audit.archive.upload_failed',
    'audit.archive.row_count_mismatch',
    'audit.archive.partial_archive_mismatch',
    'audit.archive.purge_mismatch',
    'admin.audit.archive.read',
  ])('%s (archive ops) → immutable', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.IMMUTABLE)
  })

  // PR 1.2：system ops immutable（deploy_ordering fallback 訊號）
  it.each([
    'audit.deploy_ordering.fallback_triggered',
  ])('%s (system ops) → immutable', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.IMMUTABLE)
  })

  // PR 1.2 codex r1+r3：補 5 個原本漏分類的 live events
  it('payment.intent.anonymized → immutable（admin PII 抹除 forensic trail）', () => {
    expect(classifyAuditEvent('payment.intent.anonymized')).toBe(AUDIT_CATEGORY.IMMUTABLE)
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
    // PR 1.2：補 4 個漏分類 admin read/export events
    'admin.deals.read',
    'admin.deals.exported',
    'admin.payments.intents.read',
    'admin.payments.intents.exported',
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
    // 2026-05-10 盤點 98（grep functions/）；migration 0038 加 12 archive ops + PR 1.1
    // 加 1 個 deploy_ordering fallback → 111；
    // PR 1.2 補 5 個漏分類 live events（4 read_audit + 1 immutable）→ 116。
    // PR 2.1c 加 audit.archive.cold_class_drift（codex M-1）→ 117。
    // PR 2.2b 加 4 個 admin retry endpoint events
    //   （retry_requested / retry_succeeded / retry_rejected / force_purge_requested）→ 121。
    // PR 2.3 加 3 個 force_purge 真實作 events
    //   （force_purge_succeeded / _failed / _disabled）→ 124。
    // PR 3.0 加 3 個 aggregate worker events
    //   （audit.aggregate.run_completed / _skipped / _failed）→ 127。
    // 新增 audit event 必須同 PR 補進 audit-policy.js + 同步更新本斷言。
    expect(_registrySize).toBe(127)
  })

  it('listEventsByCategory 各類有合理數量（防整類被誤刪）', () => {
    // 0038 後 immutable 含 12 archive ops + 1 system ops + 1 anonymized（總 59）
    expect(listEventsByCategory(AUDIT_CATEGORY.IMMUTABLE).length).toBeGreaterThanOrEqual(50)
    expect(listEventsByCategory(AUDIT_CATEGORY.SECURITY_SIGNAL).length).toBeGreaterThanOrEqual(20)
    expect(listEventsByCategory(AUDIT_CATEGORY.TELEMETRY).length).toBeGreaterThanOrEqual(5)
    expect(listEventsByCategory(AUDIT_CATEGORY.READ_AUDIT).length).toBeGreaterThanOrEqual(8)
    expect(listEventsByCategory(AUDIT_CATEGORY.DEBUG_FAILURE).length).toBeGreaterThanOrEqual(5)
  })
})

describe('classifyForCold — 6 cold archive classes（migration 0038）', () => {
  it.each([
    ['account.delete',                    'info',     'immutable'],
    ['admin.user.banned',                 'critical', 'immutable'],
    ['auth.refresh.aud_mismatch',         'critical', 'immutable'],   // F-2
    ['payment.refund.success',            'info',     'immutable'],
    ['audit.archive.chunk_uploaded',      'info',     'immutable'],   // archive ops
    ['audit.archive.verification_failed', 'critical', 'immutable'],
  ])('%s (severity=%s) → immutable', (e, sev, expected) => {
    expect(classifyForCold(e, sev)).toBe(expected)
  })

  it.each([
    ['auth.login.fail',           'critical'],
    ['auth.refresh.fail',         'critical'],
    ['mfa.totp.verify.replay',    'critical'],
    ['auth.risk.blocked',         'critical'],
  ])('%s critical → security_critical', (e, sev) => {
    expect(classifyForCold(e, sev)).toBe('security_critical')
  })

  it.each([
    ['auth.login.fail',     'warn'],
    ['auth.login.success',  'info'],
    ['auth.new_device',     'warn'],
    ['mfa.totp.verify.fail', 'warn'],
  ])('%s non-critical → security_warn', (e, sev) => {
    expect(classifyForCold(e, sev)).toBe('security_warn')
  })

  it.each([
    'admin.audit.read',
    'admin.requisitions.read',
    'payment.metadata_archive.viewed',
  ])('%s → read_audit', (e) => {
    expect(classifyForCold(e, 'info')).toBe('read_audit')
  })

  it.each([
    'auth.login.rate_limited',
    'oauth.backchannel.dispatch',
    'webauthn.register.options',
  ])('%s → telemetry', (e) => {
    expect(classifyForCold(e, 'info')).toBe('telemetry')
  })

  it.each([
    'auth.delete.exception',
    'payment.refund.network_error',
    'kyc.webhook.fail',
  ])('%s → debug_failure', (e) => {
    expect(classifyForCold(e, 'warn')).toBe('debug_failure')
  })

  it.each([
    ['unknown.event',          'info',     'immutable'],   // 未分類 → fallback immutable（最長 retention 保險）
    ['totally.fake',           'critical', 'immutable'],
    ['',                       'info',     'immutable'],
  ])('未知 %s → fallback immutable', (e, sev, expected) => {
    expect(classifyForCold(e, sev)).toBe(expected)
  })

  it('deterministic：相同 input 多次呼叫結果一致（archive worker 重跑 idempotent 必要條件）', () => {
    const cases = [
      ['auth.login.fail', 'critical'],
      ['auth.login.fail', 'warn'],
      ['unknown.event',   'info'],
    ]
    for (const [e, sev] of cases) {
      const first = classifyForCold(e, sev)
      for (let i = 0; i < 5; i++) {
        expect(classifyForCold(e, sev)).toBe(first)
      }
    }
  })
})
