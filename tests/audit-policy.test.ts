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
} from '../functions/utils/audit-policy'

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
    'billing.grant.applied',         // PR2 manual grant 成功
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
    'auth.refresh.grace_orphan',      // Fork 2 Route B：benign rotation-orphan（owner-ratified 1b = security_signal, no downgrade）
    'auth.country_jump',
    'auth.new_device',
    'mfa.totp.verify.replay',
    'admin.unknown_role_actor',
    'webauthn.register.fail',
    // PR2 Billing / Entitlement：manual grant 拒絕/衝突
    'billing.grant.denied',
    'billing.grant.conflict',
    'billing.grant.evidence_conflict',
    // PR1 Tenant Foundation：org-switch 信號（deny = 越權/失效嘗試；success = active tenant 變更）
    'tenant.switch.deny',
    'tenant.switch.success',
  ])('%s → security_signal', (e) => {
    expect(classifyAuditEvent(e)).toBe(AUDIT_CATEGORY.SECURITY_SIGNAL)
  })
})

describe('classifyAuditEvent — telemetry（rate_limit / dispatch）', () => {
  it.each([
    'auth.login.rate_limited',
    'auth.refresh.rate_limited',
    'billing.grant.idempotent_replay', // PR2 manual grant idempotency replay
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

// PR3 Credit Wallet：顯式列出 7 個新 event 的分類（codex Gate-2 非阻斷建議：別只靠 _registrySize 間接兜底）。
// billing.quota.set 為 IMMUTABLE（telemetry 對應 authoritative quota_config_ledger，分類仍歸金融狀態變更永久保留）。
describe('classifyAuditEvent — PR3 billing.credit.* / billing.quota.set', () => {
  it.each([
    ['billing.credit.deducted',         AUDIT_CATEGORY.IMMUTABLE],
    ['billing.credit.topup',            AUDIT_CATEGORY.IMMUTABLE],
    ['billing.credit.adjusted',         AUDIT_CATEGORY.IMMUTABLE],
    ['billing.quota.set',               AUDIT_CATEGORY.IMMUTABLE],
    ['billing.credit.conflict',         AUDIT_CATEGORY.SECURITY_SIGNAL],
    ['billing.credit.denied',           AUDIT_CATEGORY.SECURITY_SIGNAL],
    ['billing.credit.idempotent_replay', AUDIT_CATEGORY.TELEMETRY],
  ])('%s → %s', (e, expected) => {
    expect(classifyAuditEvent(e)).toBe(expected)
  })
})

// PR4 Invitation + Member Lifecycle：12 個新 event 顯式分類（org/membership 狀態 = immutable；
// 被拒/accept 失敗 = security_signal；等冪重放 = telemetry）。
describe('classifyAuditEvent — PR4 member lifecycle', () => {
  it.each([
    ['org.created',               AUDIT_CATEGORY.IMMUTABLE],
    ['member.invited',            AUDIT_CATEGORY.IMMUTABLE],
    ['member.joined',             AUDIT_CATEGORY.IMMUTABLE],
    ['member.suspended',          AUDIT_CATEGORY.IMMUTABLE],
    ['member.reactivated',        AUDIT_CATEGORY.IMMUTABLE],
    ['member.offboarded',         AUDIT_CATEGORY.IMMUTABLE],
    ['member.role_changed',       AUDIT_CATEGORY.IMMUTABLE],
    ['invitation.revoked',        AUDIT_CATEGORY.IMMUTABLE],
    ['member.denied',             AUDIT_CATEGORY.SECURITY_SIGNAL],
    ['invitation.accept.denied',  AUDIT_CATEGORY.SECURITY_SIGNAL],
    ['invitation.accept.replay',  AUDIT_CATEGORY.TELEMETRY],
    ['org.create.replay',         AUDIT_CATEGORY.TELEMETRY],
  ])('%s → %s', (e, expected) => {
    expect(classifyAuditEvent(e)).toBe(expected)
  })
})

// PR5 Event Outbox 5b：consumer/replay/emitted 的 8 個 domain.event.* 顯式分類（critical forensic = immutable；
// operational dispatch + endpoint emitted = telemetry）。domain.event.emitted = endpoint post-commit best-effort
// 觀測（plan C3）；domain.event.replay = admin DLQ replay 動作（兩者並存，replay 不替代 emitted）。
describe('classifyAuditEvent — PR5 event outbox consumer/replay/emitted', () => {
  it.each([
    ['domain.event.dlq',               AUDIT_CATEGORY.IMMUTABLE],
    ['domain.event.gap_detected',      AUDIT_CATEGORY.IMMUTABLE],
    ['domain.event.validation_failed', AUDIT_CATEGORY.IMMUTABLE],
    ['domain.event.replay',            AUDIT_CATEGORY.IMMUTABLE],
    ['domain.event.emitted',           AUDIT_CATEGORY.TELEMETRY],
    ['domain.event.delivered',         AUDIT_CATEGORY.TELEMETRY],
    ['domain.event.retry',             AUDIT_CATEGORY.TELEMETRY],
    ['domain.event.consumer_run',      AUDIT_CATEGORY.TELEMETRY],
  ])('%s → %s', (e, expected) => {
    expect(classifyAuditEvent(e)).toBe(expected)
  })
})

// PR5 5d-2 session.revoked emission：1 個新 endpoint audit type session.integrity_violation（critical forensic =
// immutable，永久保留）。fail-closed COUNT!=1 guard 用；emission 本身走既有 domain.event.emitted（無新 domain.event.* type）。
describe('classifyAuditEvent — PR5 5d-2 session.integrity_violation', () => {
  it('session.integrity_violation → immutable', () => {
    expect(classifyAuditEvent('session.integrity_violation')).toBe(AUDIT_CATEGORY.IMMUTABLE)
  })
})

// P4 P2 機械補強（2026-06-13）：SEC-ADMIN-ENUM 的 2 個 read_audit（admin list/metrics 枚舉觀測）
// + SEC-CEREMONY-DOS 的 2 個 telemetry（ceremony per-IP 節流命中）顯式分類。
describe('classifyAuditEvent — P4 P2 hardening', () => {
  it.each([
    ['admin.users.read',              AUDIT_CATEGORY.READ_AUDIT],
    ['admin.metrics.read',            AUDIT_CATEGORY.READ_AUDIT],
    ['auth.authorize.rate_limited',   AUDIT_CATEGORY.TELEMETRY],
    ['webauthn.login.rate_limited',   AUDIT_CATEGORY.TELEMETRY],
  ])('%s → %s', (e, expected) => {
    expect(classifyAuditEvent(e)).toBe(expected)
  })
})

// P4 SEC-RESET-2FA-BF（2026-06-13）：reset-password TOTP 第二因子的失敗信號（security_signal）
// + 節流命中（telemetry）顯式分類。
describe('classifyAuditEvent — P4 SEC-RESET-2FA-BF', () => {
  it.each([
    ['account.password.reset.totp_fail',          AUDIT_CATEGORY.SECURITY_SIGNAL],
    ['account.password.reset.totp_rate_limited',  AUDIT_CATEGORY.TELEMETRY],
  ])('%s → %s', (e, expected) => {
    expect(classifyAuditEvent(e)).toBe(expected)
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
    // Codex 金流 r1 chain 加 6 個 events:
    //   in_flight_conflict / orphan_intent / illegal_transition /
    //   requisition_owner_mismatch / final_cas_lost / status_cas_lost → 133。
    // PR 3.1 加 3 個 debug aggregate events
    //   （audit.aggregate.debug.run_completed / _skipped / _failed）→ 136。
    // PR 3.2 part 1 加 6 個 aggregate→R2 monthly archive events
    //   （audit.aggregate_archive.{telemetry,debug}.{run_completed,run_skipped,run_failed}）→ 142。
    // PR 3.2 part 2 再加 4 個 chunk-level events
    //   （audit.aggregate_archive.{telemetry,debug}.{chunk_uploaded,upload_failed}）→ 146。
    // PR 3.3 加 14 個 admin retry / force_purge endpoint events × 兩 cold_class
    //   （aggregate_archive.{telemetry,debug}.{retry_requested,retry_succeeded,
    //    retry_rejected,force_purge_requested,force_purge_succeeded,
    //    force_purge_failed,force_purge_disabled}）→ 160。
    // PR 3.3 r1 codex P2-1 加 2 個 chunk_skipped events × 兩 cold_class
    //   （aggregate_archive.{telemetry,debug}.chunk_skipped；info/warn severity）→ 162。
    // F7 codex r5 加 1 個 oauth.bind_email.fail（SECURITY_SIGNAL；H1 replay + F8 unsupported_provider）→ 163。
    // PR 0.2c-pre-1a (2026-05-23) 加 2 個 archive events：
    //   audit.archive.manifest_written（info；write-once rollout telemetry）
    //   audit.archive.r2_lock_detected（critical；putWithRetry 命中 lock 時 emit）→ 165。
    // PR 0.2c-pre-1c (2026-05-24) 加 4 個 aggregate-namespaced events × 兩 cold_class：
    //   audit.aggregate_archive.{telemetry,debug}.manifest_written（info）
    //   audit.aggregate_archive.{telemetry,debug}.r2_lock_detected（critical）→ 169。
    // PR 0.2c-pre-2 (2026-05-24) 加 3 個 force_purge_blocked_by_lock events：
    //   audit.archive.force_purge_blocked_by_lock（critical；raw retention lock 423 路徑）
    //   audit.aggregate_archive.{telemetry,debug}.force_purge_blocked_by_lock（critical）→ 172。
    // PR1 Tenant Foundation (2026-05-29) 加 2 個 security_signal events：
    //   tenant.switch.deny（org-switch 被拒；越權/失效嘗試信號，deny 率異常 = 可能越權）
    //   tenant.switch.success（active tenant 切換成功；auth-context 變更信號）→ 174。
    // PR2 Billing / Entitlement Commit 3 (2026-05-30) 加 5 個 billing.grant.* events：
    //   billing.grant.applied（immutable）+ billing.grant.{denied,conflict,evidence_conflict}（security_signal）
    //   + billing.grant.idempotent_replay（telemetry）→ 179。
    // PR3 Credit Wallet 加 7 個 billing.credit.* / billing.quota.set → 186。
    // PR4 Invitation + Member Lifecycle 加 12 個（org.created / member.{invited,joined,suspended,reactivated,
    //   offboarded,role_changed} / invitation.revoked = 8 immutable；member.denied / invitation.accept.denied
    //   = 2 security_signal；invitation.accept.replay / org.create.replay = 2 telemetry）→ 198。
    // PR5 Event Outbox 5b 加 8 個 domain.event.*（dlq / gap_detected / validation_failed / replay = 4 immutable；
    //   emitted / delivered / retry / consumer_run = 4 telemetry）→ 206。emitted = endpoint post-commit best-effort
    //   觀測（plan C3，code-gate 補做 plan-faithful，非 waiver）；replay 與 emitted 並存不互相替代。
    // PR5 5d-2 session.revoked emission 加 1 個 session.integrity_violation（immutable；fail-closed COUNT!=1
    //   guard 用；emission 本身走既有 domain.event.emitted，無新 domain.event.* type）→ 207。
    // Fork 2 Route B (2026-06-07) 加 1 個 auth.refresh.grace_orphan（security_signal；owner-ratified 1b = no downgrade）。
    //   grace-path device mismatch 走既有 auth.refresh.fail/grace_device_mismatch（reason_code，無新 event type）→ 208。
    // EVT-001b (2026-06-12) 加 1 個 domain.event.dlq_list（read_audit；admin 讀 event DLQ list 端點）→ 209。
    // EVT-003 (2026-06-12) 加 2 個 account.delete.membership_skipped / account.delete.membership_overflow（immutable）→ 211。
    // P4 SEC-CEREMONY-DOS + SEC-ADMIN-ENUM (2026-06-13) 加 4 個：
    //   admin.users.read / admin.metrics.read（read_audit；admin list/metrics 枚舉觀測）
    //   auth.authorize.rate_limited / webauthn.login.rate_limited（telemetry；ceremony 節流命中）→ 215。
    // P4 SEC-RESET-2FA-BF (2026-06-13) 加 2 個：
    //   account.password.reset.totp_fail（security_signal；reset TOTP 驗證失敗暴破信號）
    //   account.password.reset.totp_rate_limited（telemetry；reset TOTP 節流命中）→ 217。
    // 新增 audit event 必須同 PR 補進 audit-policy.js + 同步更新本斷言。
    expect(_registrySize).toBe(217)
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
