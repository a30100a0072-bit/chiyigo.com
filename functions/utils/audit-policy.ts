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

export type AuditCategory =
  (typeof AUDIT_CATEGORY)[keyof typeof AUDIT_CATEGORY]

export type AuditSeverity = 'info' | 'warn' | 'critical'

export type AuditColdClass =
  | 'immutable'
  | 'security_critical'
  | 'security_warn'
  | 'read_audit'
  | 'telemetry'
  | 'debug_failure'

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
  'audit.archive.cold_class_drift',             // critical（PR 2.1c codex M-1：classifier 與 stored cold_class 不一致）
  'admin.audit.archive.read',                   // admin export 觸發
  // PR 2.2b admin retry endpoint（POST /api/admin/audit-archive/retry）
  'audit.archive.retry_requested',              // info — endpoint 收到合法請求（auth+schema 通過）
  'audit.archive.retry_succeeded',              // info — re_verify / mark_resolved 真實 UPDATE 成功
  'audit.archive.retry_rejected',               // warn — 404/409/validation：找不到 chunk 或狀態不符
  'audit.archive.force_purge_requested',        // critical — admin 申請 force_purge（PR 2.2b stub→PR 2.3 真實作）
  // PR 2.3 force_purge 真實作（manual R2 + chunks-row DELETE；audit_log raw 不刪，留 PR 4）
  'audit.archive.force_purge_succeeded',        // critical — R2 chunk+manifest+chunks row 全刪成功
  'audit.archive.force_purge_failed',           // critical — R2/D1 操作中斷（含未來 retention lock 423 路徑）
  'audit.archive.force_purge_disabled',         // warn — AUDIT_ARCHIVE_PURGE_ENABLED 未設，endpoint 拒絕
  // PR 0.2c-pre-2：R2 retention lock 擋住 force_purge 時的 critical signal。
  // 與 force_purge_failed 區分：blocked_by_lock 是 by-policy reject（admin 動作被
  // 刻意拒），處置是「等 retention 過期 / 找 CF support」，不是「retry / 改 code」。
  // alerting 規則建議分流：blocked_by_lock 進「policy notify」隊列，failed 進「on-call paging」。
  'audit.archive.force_purge_blocked_by_lock',  // critical — retention lock active，無法 force_purge
  // PR 3.0 aggregate worker（POST /api/admin/cron/audit-aggregate, telemetry-only skeleton）
  'audit.aggregate.run_completed',              // info — 整輪成功 + summary（rows_scanned / buckets_upserted）
  'audit.aggregate.run_skipped',                // info — hot_days_disabled / no_rows_eligible 等正常 skip
  'audit.aggregate.run_failed',                 // critical — drift / partial upsert / D1 select 失敗
  // PR 3.1 aggregate worker debug（POST /api/admin/cron/audit-aggregate-debug, debug_failure）
  'audit.aggregate.debug.run_completed',        // info — 整輪成功 + summary（含 samples_total）
  'audit.aggregate.debug.run_skipped',          // info — hot_days_disabled / no_rows_eligible / cutoff_hours_collapsed
  'audit.aggregate.debug.run_failed',           // critical — drift / partial upsert / D1 select 失敗
  // PR 3.2 aggregate→R2 monthly archive worker（telemetry + debug 各一支 cron）
  //   POST /api/admin/cron/audit-aggregate-archive-telemetry
  //   POST /api/admin/cron/audit-aggregate-archive-debug
  // 與 PR 2.x audit_log archive 共用 audit_archive_chunks 表，靠 cold_class 區分
  // （'aggregate_telemetry' / 'aggregate_debug'，與 audit_log 既有 6 class 不撞）
  'audit.aggregate_archive.telemetry.run_completed',  // info — 整輪成功 + summary（chunks_uploaded / rows_archived）
  'audit.aggregate_archive.telemetry.run_skipped',    // info — no_rows_eligible / disabled
  'audit.aggregate_archive.telemetry.run_failed',     // critical — R2 PUT 失敗 / drift / D1 失敗
  'audit.aggregate_archive.debug.run_completed',      // info
  'audit.aggregate_archive.debug.run_skipped',        // info
  'audit.aggregate_archive.debug.run_failed',         // critical
  // PR 3.2 part 2：chunk-level emit（mirror PR 2.x audit_log archive）
  //   chunk_uploaded → verify ok 後 emit；upload_failed → putWithRetry callback emit
  'audit.aggregate_archive.telemetry.chunk_uploaded', // info
  'audit.aggregate_archive.telemetry.upload_failed',  // warn / critical
  'audit.aggregate_archive.debug.chunk_uploaded',     // info
  'audit.aggregate_archive.debug.upload_failed',      // warn / critical
  // PR 0.2c-pre-1c：aggregate-namespaced r2_lock_detected（mirror raw
  // audit.archive.r2_lock_detected；**不**共用 raw event name 避免 alerting 散到
  // raw archive namespace）。putWithRetry classifier 命中 lock 時由 callback 額外 emit
  // （與 upload_failed 並存，不取代）。manifest_written **不**在此 list —— 那是 TELEMETRY
  // 類（高頻 rollout signal，放 IMMUTABLE 會自我遞迴噬 archive 配額）。
  'audit.aggregate_archive.telemetry.r2_lock_detected',   // critical
  'audit.aggregate_archive.debug.r2_lock_detected',       // critical
  // PR 3.3 r1 codex P2-1：existing chunk row 非 'planned' 時 fresh pipeline 早退
  //   - dry-run 'verified' / live 'marked_archived' = idempotent rerun，info severity
  //   - 其他 ('uploaded' / 'failed' / 'blacklisted') = partial / admin-intervened，warn severity
  'audit.aggregate_archive.telemetry.chunk_skipped',  // info / warn
  'audit.aggregate_archive.debug.chunk_skipped',      // info / warn
  // PR 3.3 admin retry / force_purge endpoint（POST /api/admin/audit-aggregate-archive/retry）
  //   mirror PR 2.2b/2.3 raw retry.ts 三段事件 × 兩 cold_class（telemetry / debug）
  //   force_purge_disabled / retry_rejected = warn；其餘 retry_* info；force_purge_*
  //   critical（destructive R2 + chunks row delete）
  'audit.aggregate_archive.telemetry.retry_requested',          // info
  'audit.aggregate_archive.telemetry.retry_succeeded',          // info
  'audit.aggregate_archive.telemetry.retry_rejected',           // warn — 含 integrity_breach critical 也走此 type
  'audit.aggregate_archive.telemetry.force_purge_requested',    // critical
  'audit.aggregate_archive.telemetry.force_purge_succeeded',    // critical
  'audit.aggregate_archive.telemetry.force_purge_failed',       // critical
  'audit.aggregate_archive.telemetry.force_purge_disabled',     // warn
  // PR 0.2c-pre-2：retention lock 擋住 force_purge 時的 critical signal。
  // 與 force_purge_failed 區分：blocked_by_lock 是 by-policy reject（admin 動作
  // 被刻意拒），需要的處置是「等 retention 過期 / 找 CF support」，不是「retry / 改 code」
  'audit.aggregate_archive.telemetry.force_purge_blocked_by_lock', // critical
  'audit.aggregate_archive.debug.retry_requested',              // info
  'audit.aggregate_archive.debug.retry_succeeded',              // info
  'audit.aggregate_archive.debug.retry_rejected',               // warn
  'audit.aggregate_archive.debug.force_purge_requested',        // critical
  'audit.aggregate_archive.debug.force_purge_succeeded',        // critical
  'audit.aggregate_archive.debug.force_purge_failed',           // critical
  'audit.aggregate_archive.debug.force_purge_disabled',         // warn
  // PR 0.2c-pre-2 (mirror telemetry above)
  'audit.aggregate_archive.debug.force_purge_blocked_by_lock',   // critical
  // PR 0.2c-pre-1a (2026-05-23) write-once R2 key + lock-aware refactor
  //   r2_lock_detected：critical — putWithRetry 命中 isR2LockError 時 emit；
  //                     payload 帶 operation/key/attempt/status/code，不塞 stack
  //                     或敏感 body 內容（避免 audit 反成 PII / secrets sink）
  //
  //   manifest_written 由 TELEMETRY 類接（見下方 TELEMETRY list）— rollout
  //   telemetry 高頻、每 chunk 4 events、不適合 IMMUTABLE 永久保留；放 IMMUTABLE
  //   會自我遞迴（每 archive 一個 immutable chunk 又 emit 4 events 進 immutable
  //   → 下輪 cron 再處理它們 → 跨 class 噬 max_chunks_per_run 配額；測試端親驗
  //   過會 break telemetry verify 推進與「另 class 應為 no_rows_eligible」契約）。
  //   留 TELEMETRY 雖然仍會遞迴但只影響 telemetry 自己一條 pipeline，且最終會被
  //   PR 3.0 aggregate worker rollup 收掉，不會持續累積 raw row。
  'audit.archive.r2_lock_detected',                              // critical
]

// F-3 Phase 2 PR 1.2 codex r3 L：deploy_ordering 是 system ops 類訊號，不是 archive ops。
// 拆獨立 list 以免後續維護者 grep ARCHIVE_OPS 時誤以為是 archive worker 範圍。
const SYSTEM_OPS_IMMUTABLE = [
  'audit.deploy_ordering.fallback_triggered',   // PR 1.1 M-2：deploy 順序錯訊號（critical）
]

const IMMUTABLE = [
  ...ARCHIVE_OPS_IMMUTABLE,
  ...SYSTEM_OPS_IMMUTABLE,
  'account.delete',
  'account.delete.membership_skipped',   // EVT-003：刪號 batch 內某 membership 因 last-owner guard/並發而留存（人工補救債）
  'account.delete.membership_overflow',  // EVT-003：刪號者 org membership 數超過 batch 上限，fail-closed 409
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
  // PR5 5d-2：session-family 完整性違反 — logout / device-revoke 的 fail-closed 前置檢查偵測到某 (user_id, ref)
  // family 的 GLOBAL live-head 數 != 1（rotation 不變量被破壞，或並發異常）→ 不撤銷、不 emit。critical forensic
  // 訊號（不該發生；發生即需調查該 user 的 session 家族），永久保留。
  'session.integrity_violation',
  // PR2 Billing / Entitlement：manual grant 成功（金融狀態變更，永久 forensic trail）
  'billing.grant.applied',
  // PR3 Credit Wallet：金融狀態變更（永久 forensic trail）。billing.quota.set 為 telemetry，
  // 對應 authoritative quota_config_ledger row（SoT 是 ledger，非 audit；plan §5.5）。
  'billing.credit.deducted',
  'billing.credit.topup',
  'billing.credit.adjusted',
  'billing.quota.set',
  // PR4 Invitation + Member Lifecycle：org / membership 狀態變更（永久 forensic trail）
  'org.created',
  'member.invited',
  'member.joined',
  'member.suspended',
  'member.reactivated',
  'member.offboarded',
  'member.role_changed',
  'invitation.revoked',
  // PR5 Event Outbox consumer / replay — critical forensic（投遞失敗 + admin replay；永久保留）
  'domain.event.dlq',                // critical — 事件 dead-letter（投遞失敗，deny-state 未套用）
  'domain.event.gap_detected',       // critical — contiguity invariant 違反
  'domain.event.validation_failed',  // critical — poison event（reconstruct/validate 失敗）
  'domain.event.replay',             // admin DLQ replay 動作（domain.event-dlq/[id]/replay）
  'kyc.status.change',
  'mfa.backup_code.regenerate',
  'mfa.backup_code.use',
  'mfa.totp.activate',
  'mfa.totp.disable',
  'oauth.bind_email.success',
  'oauth.code.exchange.success',
  'oauth.end_session',
  'oauth.identity.bind.success',                 // SEC-FACTOR-ADD-A PR-A4：OAuth identity 綁定成功（add-time context，對齊 wallet.bind.success）
  'oauth.identity.unbind',
  'payment.checkout.created',
  'payment.intent.anonymized',                  // PR 1.2：admin 對 succeeded intent 做 PII 抹除（forensic trail，永久保留）
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
  // SEC-FACTOR-ADD-A PR-A4：existing-credential disposition（per-row finding + run lifecycle）
  'account.credential.disposition',            // per-row：high/unknown credential 處置（hashed id，無明文）
  'account.credential.disposition.run',        // run lifecycle：phase=start/dry_run/complete/failed + counts
  // OD-3 credential requires_reverification enforcement（使用前強制 re-verify）
  'auth.credential.reverification_required',   // 4 use surface（passkey/oauth login/bind-email/factor-add elevation reauth）擋下 flagged credential
  'account.credential.reverification_cleared', // self/admin clear 成功（merged event：actor_type/clear_method/credential_tier payload；動態 severity，admin+high→critical→security_critical 與 flagging 對稱）
  'account.password.reset.backup_code_fail',
  'account.password.reset.totp_fail',          // SEC-RESET-2FA-BF：reset TOTP 驗證失敗（暴破偵測信號）
  // SEC-FACTOR-ADD-A（ADD-A PR-A2）：factor-add elevation 結果信號
  'auth.elevation.succeeded',
  'auth.elevation.failed',
  'auth.elevation.provider_mismatch',          // critical：OAuth reauth 的 provider_id 不 match 既綁 identity
  'auth.elevation.replay_detected',            // critical：exchange code / grant 重放
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
  // Fork 2 Route B：benign rotation-orphan re-classification（distinct from the FALSE reuse_detected）。Owner-ratified
  // "1b" = SECURITY_SIGNAL/warn（NO retention downgrade — kept at security forensic tier, just a distinct event type so
  // theft analytics can exclude the benign pattern）。grace-path device mismatch reuses auth.refresh.fail/grace_device_mismatch.
  'auth.refresh.grace_orphan',
  // SEC-REFRESH-REUSE（P1）：refresh reuse 偵測到「proven non-benign」→ family-revoke 撤掉攻擊者持久 successor
  // 後的 critical 訊號（severity critical → cold_class security_critical）。**只在 CAS changes>0（真撤到 live head）
  // 才 emit**（C1）；changes=0 / DB error 走既有 auth.refresh.fail（reason 區分），不冒充本事件。
  'auth.refresh.family_revoked',
  'auth.risk.blocked',
  'auth.risk.medium',
  'auth.step_up.fail',
  'auth.step_up.success',
  // PR2 Billing / Entitlement：manual grant 被拒/衝突信號
  'billing.grant.conflict',          // idempotency key 衝突（同 key 異 params）
  'billing.grant.denied',            // 資格/驗證/授權失敗
  'billing.grant.evidence_conflict', // offline payment_ref 重用
  // PR3 Credit Wallet：扣點/錢包被拒/衝突信號
  'billing.credit.conflict',         // idempotency (tenant,scope,key) 衝突（同 key 異 params）
  'billing.credit.denied',           // insufficient / quota_exceeded / not_provisioned / 資格 / 驗證 / 授權 / rate_limited
  // PR4：owner/admin lifecycle 或 org-create 被拒（reason_code in payload）；accept 失敗（leaked-link / brute-force 信號）
  'member.denied',
  'invitation.accept.denied',
  'kyc.gate.fail',
  'mfa.totp.activate.fail',
  'mfa.totp.disable.fail',
  'mfa.totp.verify.fail',
  'mfa.totp.verify.replay',
  'mfa.totp.verify.success',
  'oauth.bind_email.collision_blocked',
  'oauth.bind_email.fail',
  'oauth.callback.fail',
  'oauth.code.exchange.fail',
  'payment.checkout.requisition_owner_mismatch',
  'payment.gate.fail',
  'payment.status.illegal_transition',
  'payment.webhook.orphan_intent',
  'payment.webhook.status_cas_lost',
  'payment.webhook.psp_direct_blocked',
  'register.guest_id_invalid_format',
  'tenant.switch.deny',                          // PR1 Tenant Foundation：org-switch 被拒（越權/失效嘗試信號；deny 率異常 = 可能越權）
  'tenant.switch.success',                       // PR1 Tenant Foundation：active tenant 切換成功（auth-context 變更信號）
  'wallet.bind.fail',
  'webauthn.register.fail',
]

const TELEMETRY = [
  'account.password.reset.totp_rate_limited',  // SEC-RESET-2FA-BF：reset TOTP 驗證節流命中
  'auth.elevation.started',                    // SEC-FACTOR-ADD-A：factor-add elevation 起手（高頻觀測）
  'admin.read.rate_limited',
  'auth.authorize.rate_limited',   // SEC-CEREMONY-DOS：oauth authorize per-IP 節流命中
  'auth.login.rate_limited',
  'auth.refresh.rate_limited',
  'auth.step_up.rate_limited',
  'webauthn.login.rate_limited',   // SEC-CEREMONY-DOS：webauthn login ceremony per-IP 節流命中
  'billing.grant.idempotent_replay', // PR2：manual grant idempotency replay（非錯誤，計量用）
  'billing.credit.idempotent_replay', // PR3：credit op idempotency replay（非錯誤，計量用）
  // PR4：accept re-click 等冪重放 / org-create same-key+payload replay（非錯誤，計量用）
  'invitation.accept.replay',
  'org.create.replay',
  // PR5 Event Outbox consumer — operational dispatch（高量、可 aggregate）
  'domain.event.emitted',     // info — endpoint post-commit best-effort：domain 事件已寫入 outbox（plan C3；純觀測，SoT 是 outbox row）
  'domain.event.delivered',   // info — 事件投遞到 deny-state projection（含 idempotent noop）
  'domain.event.retry',       // warn — transient 投遞失敗重試
  'domain.event.consumer_run', // info — consumer run report summary（counts only）
  'oauth.backchannel.dispatch',
  'oauth.token.rate_limited',
  'webauthn.register.options',
  // PR 0.2c-pre-1a (2026-05-23) write-once rollout telemetry
  //   manifest_written：每次 manifest PUT 成功 emit；payload 帶 chunk_id /
  //                     key_scheme / manifest_state / manifest_key / archive_state；
  //                     用來追新 chunk 走 write-once 路徑、舊 chunk 走 legacy 路徑
  //                     的比例 + 各 state 推進。歸 TELEMETRY 不歸 IMMUTABLE 是為
  //                     了避免自我遞迴噬 max_chunks_per_run 配額（細節見 audit-policy
  //                     ARCHIVE_OPS_IMMUTABLE 附近註解）。
  'audit.archive.manifest_written',             // info
  // PR 0.2c-pre-1c：aggregate-namespaced manifest_written（mirror raw；同 self-recursion
  // 顧慮，歸 TELEMETRY 不歸 IMMUTABLE）。Write-once 每 state manifest PUT 成功 / HEAD
  // skip 都 emit；用來追新 chunk 走 write-once 路徑、舊 chunk 走 legacy 路徑的比例 +
  // 各 state 推進。
  'audit.aggregate_archive.telemetry.manifest_written',   // info
  'audit.aggregate_archive.debug.manifest_written',       // info
]

const READ_AUDIT = [
  'admin.audit.read',
  'admin.deals.exported',                      // PR 1.2：admin CSV export deals
  'admin.deals.read',                          // PR 1.2：admin 讀 deals list
  'admin.metrics.read',                        // SEC-ADMIN-ENUM：admin 讀全站 metrics（含 hashed top-IP）
  'admin.users.read',                          // SEC-ADMIN-ENUM：admin 讀全站 user 列表（PII 枚舉面）
  'admin.payment_webhook_dlq.read',
  'domain.event.dlq_list',                     // EVT-001b：admin 讀 event DLQ list（redacted，stream_key→hash）
  'admin.payments.intents.exported',           // PR 1.2：admin CSV export payment intents
  'admin.payments.intents.read',               // PR 1.2：admin 讀 payment intents list
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
  'payment.webhook.in_flight_conflict',
  'requisition.refund.fail',
  'requisition.refund.final_cas_lost',
  'requisition.refund.network_error',
  'requisition.save_as_deal.fail',
]

const REGISTRY = new Map<string, AuditCategory>()
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
export function classifyAuditEvent(eventType: string): AuditCategory | null {
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
export function classifyForCold(eventType: string, severity: AuditSeverity): AuditColdClass {
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
export function listEventsByCategory(category: AuditCategory): string[] {
  const out = []
  for (const [event, cat] of REGISTRY) {
    if (cat === category) out.push(event)
  }
  return out
}

// 給測試用：完整 registry 大小
export const _registrySize = REGISTRY.size
