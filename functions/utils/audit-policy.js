/**
 * Audit policy registry（F-3 Phase 1，2026-05-10）
 *
 * 把每個 audit event_type 分類，作為未來 retention / aggregate / 冷存策略的地基。
 * Phase 1 行為：safeUserAudit 呼叫時查 registry，缺分類只 console.warn 不擋寫入；
 * 不改 audit 寫入語意、不刪資料、不採樣。
 *
 * 分類定義：
 *  - immutable      永不去重；金融、權限、安全狀態變更；未來只冷存不丟
 *  - security_signal 可保留每筆一段時間，未來可 aggregate（撞庫/釣魚/2FA fail 等）
 *  - telemetry      可採樣 / aggregate（rate_limited、operational dispatch）
 *  - read_audit     admin 讀取敏感資料；retention 可短於 mutation
 *  - debug_failure  錯誤摘要；要嚴格避免 raw PII
 *
 * 維護規則（feedback_audit_classification.md）：
 *  - 新增 audit event 同 PR 內必須在這裡分類
 *  - prod 出現 [audit-policy] unclassified 警告 = 漏分類，回頭補
 *  - 已分類的 event 改類別需另開 PR + 評估 retention 衝擊
 */

export const AUDIT_CATEGORY = Object.freeze({
  IMMUTABLE:       'immutable',
  SECURITY_SIGNAL: 'security_signal',
  TELEMETRY:       'telemetry',
  READ_AUDIT:      'read_audit',
  DEBUG_FAILURE:   'debug_failure',
})

// F-3 Phase 2 archive 操作事件（commit 0038 起加入；全部歸 immutable category，
// archive 操作本身要永久保留作 forensic trail）
const ARCHIVE_OPS_IMMUTABLE = [
  'audit.archive.chunk_uploaded',
  'audit.archive.marked_archived',
  'audit.archive.d1_purged',
  'audit.archive.cold_copied',
  'audit.archive.month_completed',
  'audit.archive.aggregate_completed',
  'audit.archive.verification_failed',          // critical severity 觸發 Discord
  'audit.archive.upload_failed',
  'audit.archive.row_count_mismatch',           // critical
  'audit.archive.partial_archive_mismatch',     // critical
  'audit.archive.purge_mismatch',               // critical
  'admin.audit.archive.read',                   // admin export 觸發
  'audit.deploy_ordering.fallback_triggered',   // PR 1.1 自審 M-2：deploy 順序錯訊號
]

const IMMUTABLE = [
  ...ARCHIVE_OPS_IMMUTABLE,
  'account.delete',
  'account.email.verify',
  'account.password.change',
  'account.password.reset_request',
  'account.register',
  'admin.audit_log.deleted',
  'admin.oauth_client.created',
  'admin.oauth_client.disabled',
  'admin.oauth_client.updated',
  'admin.token.revoked.device',
  'admin.token.revoked.jti',
  'admin.token.revoked.user',
  'admin.user.banned',
  'admin.user.role_changed',
  'admin.user.unbanned',
  'auth.devices.logout',
  'auth.logout',
  'auth.refresh.aud_mismatch',      // F-2 critical
  'auth.refresh.device_mismatch',
  'auth.token_revoked',
  'kyc.status.change',
  'mfa.backup_code.regenerate',
  'mfa.backup_code.use',
  'mfa.totp.activate',
  'mfa.totp.disable',
  'oauth.bind_email.success',
  'oauth.code.exchange.success',
  'oauth.end_session',
  'oauth.identity.unbind',
  'payment.checkout.created',
  'payment.intent.deleted',
  'payment.intent.succeeded_status_changed',
  'payment.refund.requested',
  'payment.refund.success',
  'payment.status.change',
  'payment.webhook.amount_mismatch',
  'requisition.admin_deleted',
  'requisition.deleted',
  'requisition.refund.approved',
  'requisition.refund.rejected',
  'requisition.refund.requested',
  'requisition.saved_as_deal',
  'requisition.takeover',
  'wallet.bind.success',
  'wallet.unbind',
  'webauthn.credential.deleted',
  'webauthn.register.success',
]

const SECURITY_SIGNAL = [
  'account.password.reset.backup_code_fail',
  'admin.unknown_role_actor',
  'admin.unknown_role_target',
  'auth.country_jump',
  'auth.login.banned_attempt',
  'auth.login.cooldown',
  'auth.login.fail',
  'auth.login.ip_blacklist_added',
  'auth.login.ip_blacklisted',
  'auth.login.success',
  'auth.new_device',
  'auth.refresh.fail',
  'auth.risk.blocked',
  'auth.risk.medium',
  'auth.step_up.fail',
  'auth.step_up.success',
  'kyc.gate.fail',
  'mfa.totp.activate.fail',
  'mfa.totp.disable.fail',
  'mfa.totp.verify.fail',
  'mfa.totp.verify.replay',
  'mfa.totp.verify.success',
  'oauth.bind_email.collision_blocked',
  'oauth.callback.fail',
  'oauth.code.exchange.fail',
  'payment.gate.fail',
  'payment.webhook.psp_direct_blocked',
  'register.guest_id_invalid_format',
  'wallet.bind.fail',
  'webauthn.register.fail',
]

const TELEMETRY = [
  'admin.read.rate_limited',
  'auth.login.rate_limited',
  'auth.refresh.rate_limited',
  'auth.step_up.rate_limited',
  'oauth.backchannel.dispatch',
  'oauth.token.rate_limited',
  'webauthn.register.options',
]

const READ_AUDIT = [
  'admin.audit.read',
  'admin.payment_webhook_dlq.read',
  'admin.refund_requests.read',
  'admin.requisitions.read',
  'payment.metadata_archive.viewed',
]

const DEBUG_FAILURE = [
  'auth.delete.exception',
  'kyc.webhook.fail',
  'payment.refund.fail',
  'payment.refund.network_error',
  'payment.vendor.misconfigured',
  'payment.webhook.fail',
  'requisition.refund.fail',
  'requisition.refund.network_error',
  'requisition.save_as_deal.fail',
]

const REGISTRY = new Map()
for (const e of IMMUTABLE)        REGISTRY.set(e, AUDIT_CATEGORY.IMMUTABLE)
for (const e of SECURITY_SIGNAL)  REGISTRY.set(e, AUDIT_CATEGORY.SECURITY_SIGNAL)
for (const e of TELEMETRY)        REGISTRY.set(e, AUDIT_CATEGORY.TELEMETRY)
for (const e of READ_AUDIT)       REGISTRY.set(e, AUDIT_CATEGORY.READ_AUDIT)
for (const e of DEBUG_FAILURE)    REGISTRY.set(e, AUDIT_CATEGORY.DEBUG_FAILURE)

/**
 * 查 event_type 的 audit 分類。未分類回 null。
 * @param {string} eventType
 * @returns {string|null}
 */
export function classifyAuditEvent(eventType) {
  return REGISTRY.get(eventType) ?? null
}

/**
 * F-3 Phase 2：把 (event_type, severity) 對應到 R2 cold archive class（六選一）。
 * 是 audit_log.cold_class 欄的值來源；R2 prefix 對應 retention lock。
 *
 * 規則：
 *   immutable          → 'immutable'
 *   security_signal + critical → 'security_critical'
 *   security_signal + warn/info → 'security_warn'
 *   read_audit         → 'read_audit'
 *   telemetry          → 'telemetry'
 *   debug_failure      → 'debug_failure'
 *   未分類             → 'immutable'（最長 retention，金融級保險）
 *
 * Deterministic：相同 (event_type, severity) 必回相同結果；archive worker 重跑 idempotent。
 *
 * @param {string} eventType
 * @param {string} severity   'info' | 'warn' | 'critical'
 * @returns {string}          immutable / security_critical / security_warn / read_audit / telemetry / debug_failure
 */
export function classifyForCold(eventType, severity) {
  const category = REGISTRY.get(eventType)
  // 未分類事件 fallback 'immutable'，與 audit-policy unclassified warn 並存
  // （safeUserAudit 會 console.warn，但仍寫入；cold_class 拿最長 retention 保險）
  if (!category) return 'immutable'

  if (category === AUDIT_CATEGORY.SECURITY_SIGNAL) {
    return severity === 'critical' ? 'security_critical' : 'security_warn'
  }
  // immutable / read_audit / telemetry / debug_failure 直接對應
  return category
}

/**
 * 列出指定分類的所有 event_type（測試 / admin 觀察用）。
 * @param {string} category
 * @returns {string[]}
 */
export function listEventsByCategory(category) {
  const out = []
  for (const [event, cat] of REGISTRY) {
    if (cat === category) out.push(event)
  }
  return out
}

// 給測試用：完整 registry 大小
export const _registrySize = REGISTRY.size
