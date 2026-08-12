/**
 * User-level audit log（Phase B / B4）
 *
 * 對應 migration 0017 的 audit_log 表。記錄一般使用者端事件
 * （auth/account/oauth/mfa）以追蹤撞庫、釣魚、token 重放等樣態。
 *
 * 設計原則：
 *  - **不存 PII 明文**：IP 走 SHA-256 + AUDIT_IP_SALT 鹽；email 不入。
 *  - **fire-and-forget**：寫入失敗（表不存在 / D1 暫時失效）不擋 handler 主流程。
 *    呼叫方一律 `await safeUserAudit(...)`，內部吞所有錯誤。
 *  - **severity='critical' 預留 Discord webhook hook**：
 *    `env.DISCORD_AUDIT_WEBHOOK` 缺值即 noop，不增加部署摩擦。
 *  - **trace_id 透傳**：middleware 注入的 traceId 寫到 event_data，跟結構化 log 串得起來。
 *
 * event_type 命名：`<domain>.<action>[.<result>]`
 *   domain: auth / account / oauth / mfa
 *
 * event_data 約定欄位（皆 optional，依事件需要帶）：
 *   trace_id, reason_code, provider, mode, jti（截斷）, device_uuid（截斷）...
 */

import { AUDIT_CATEGORY, classifyAuditEvent, classifyForCold, parseAuditSeverity } from './audit-policy'
import type { AuditSeverity } from './audit-policy'
import { hashToken } from './crypto'
import type { EmitIdentity } from './domain-event-emit'

/** 本模組實際讀取的 env capability（沿用 Env 為單一真相源，同 device-alerts.ts:27 AlertEnv 慣例）。 */
type UserAuditEnv = {
  chiyigo_db?: Env['chiyigo_db'] | null
  AUDIT_IP_SALT?: Env['AUDIT_IP_SALT']
  DISCORD_AUDIT_WEBHOOK?: Env['DISCORD_AUDIT_WEBHOOK']
}

type UserAuditEntry = {
  event_type: string
  severity?: AuditSeverity
  user_id?: number | null
  client_id?: string | null
  request?: Request
  trace_id?: string | null
  data?: Record<string, unknown>
}

type CriticalNotice = UserAuditEntry & {
  severity: AuditSeverity
  ipHash: string | null
  traceId: string | null
}

/**
 * 把 IP 字串雜湊成 hex（用 AUDIT_IP_SALT 加鹽）。
 * salt 缺值 → 回 null（寧願不記也不要存 raw IP）。
 */
async function hashIp(env: UserAuditEnv, ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null
  const salt = env.AUDIT_IP_SALT
  if (!salt) return null
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(salt + '|' + ip),
  )
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 從 Request 取 trace_id（middleware 注入到 response header X-Request-Id）。
 * 若 handler 已直接接收 traceId（例如 data.observe.traceId），呼叫方傳入 explicitTraceId。
 */
function extractTraceId(request: Request | undefined, explicitTraceId: string | null | undefined): string | null {
  if (explicitTraceId) return explicitTraceId
  return request?.headers?.get('X-Request-Id') ?? null
}

/**
 * 寫入 audit_log。任何錯誤都吞掉（不擋主流程）。
 *
 * @param {object} env
 * @param {object} entry
 * @param {string}  entry.event_type   例：'auth.login.success'
 * @param {string} [entry.severity]    'info' | 'warn' | 'critical'，預設 'info'
 * @param {number} [entry.user_id]     已知時帶；未登入失敗事件可缺
 * @param {string} [entry.client_id]   OIDC RP client_id（未來 oauth_clients 表化後用）
 * @param {Request}[entry.request]     用來抽 IP + traceId
 * @param {string} [entry.trace_id]    顯式覆寫 traceId
 * @param {object} [entry.data]        其他結構化欄位（trace_id 會自動併入）
 */
export async function safeUserAudit(env: UserAuditEnv, entry: UserAuditEntry): Promise<void> {
  try {
    if (!env?.chiyigo_db) return
    // F-3 Phase 1：查 event_type 是否在 audit-policy registry。
    // 不在則 console.warn，但照常寫入 audit（不擋 handler、不影響稽核完整性）。
    // 新增 audit event 必須同 PR 補進 audit-policy.js，否則 prod 會持續 warn。
    const category = classifyAuditEvent(entry.event_type)
    if (entry.event_type && !category) {
      console.warn('[audit-policy] unclassified event_type:', entry.event_type)
    }
    // 二分（ARCH-C2-R2-L2）：省略/undefined ＝ 合法預設 info、不記 invalid log；
    // present-but-invalid（null / 'PANIC' / 非字串）＝ 才進 category-aware fallback。
    const parsed = entry.severity === undefined ? 'info' : parseAuditSeverity(entry.severity)
    const severity: AuditSeverity =
      parsed ?? (category === AUDIT_CATEGORY.SECURITY_SIGNAL ? 'critical' : 'info')
    if (parsed === null) {
      console.warn('[audit-severity-invalid] illegal severity coerced by category-aware fallback', {
        event_type: typeof entry.event_type === 'string' ? entry.event_type : `<${typeof entry.event_type}>`,
        category: category ?? null,
        fallback: severity,
        notified: false,   // fallback 產生的 critical 一律不觸發 webhook（見下表）
      })
    }
    const ipHash   = await hashIp(env, entry.request?.headers?.get('CF-Connecting-IP'))
    const traceId  = extractTraceId(entry.request, entry.trace_id)

    const eventData = { ...(entry.data ?? {}) }
    if (traceId) eventData.trace_id = traceId

    // F-3 Phase 2（migration 0038）：cold_class 由 classifyForCold 衍生，存進 audit_log row。
    // archive worker 之後依 cold_class 分流寫進 R2 對應 retention prefix。
    const coldClass = classifyForCold(entry.event_type, severity)

    try {
      await env.chiyigo_db
        .prepare(`
          INSERT INTO audit_log (event_type, severity, user_id, client_id, ip_hash, event_data, cold_class)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          entry.event_type,
          severity,
          Number.isFinite(entry.user_id) ? entry.user_id : null,
          entry.client_id ?? null,
          ipHash,
          Object.keys(eventData).length ? JSON.stringify(eventData) : null,
          coldClass,
        )
        .run()
    } catch (e) {
      // Codex round-11 H-1 + 自審 H-1（PR 1.1）：deploy ordering 防呆。若 functions 比
      // migration 0038 先 deploy，cold_class 欄不存在會炸；外層 catch-all 會吞掉，
      // audit 靜默流失。
      // 嚴格 regex 匹配 SQLite 兩種常見 missing-column 錯誤訊息：
      //   1. 'no such column: cold_class'                                  (SELECT/UPDATE 路徑)
      //   2. 'table audit_log has no column named cold_class'              (INSERT 路徑，現況常走這支)
      // 其他含 cold_class 字眼的錯誤（例如未來加 CHECK constraint 違例）不走 fallback，
      // 避免錯誤資料被壓進舊 schema row（codex r1+r3 都點到，PR 1.2）。
      // 同步嘗試 e.cause.message — D1 有時把底層 SQLite 錯誤包在 cause 裡。
      // 用 join 不用 ??：D1 若外層 message 是泛用字串（如 'D1_ERROR'），detail 在 cause，
      // ?? 會被外層短路掉看不到 cause（codex r4 建議，PR 1.2）。
      const msg = [e?.message, e?.cause?.message].filter(Boolean).join('\n')
      const missingColdClass =
        /\bno such column:\s*cold_class\b/i.test(msg) ||
        /\btable\s+audit_log\s+has no column named\s+cold_class\b/i.test(msg)
      if (missingColdClass) {
        // M-2：deploy 順序錯是 ops 警訊，發 console.error + 寫 critical audit 給監控抓
        console.error(
          '[deploy-ordering] cold_class column missing — run migration 0038 first; fallback INSERT engaged',
          { event_type: entry.event_type },
        )
        await env.chiyigo_db
          .prepare(`
            INSERT INTO audit_log (event_type, severity, user_id, client_id, ip_hash, event_data)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(
            entry.event_type,
            severity,
            Number.isFinite(entry.user_id) ? entry.user_id : null,
            entry.client_id ?? null,
            ipHash,
            Object.keys(eventData).length ? JSON.stringify(eventData) : null,
          )
          .run()
        // 額外寫 deploy_ordering 訊號 row（同樣走 legacy schema，可被監控/admin 查詢抓到）
        // 不 await Discord webhook（避免 fallback 路徑串接更多失敗模式；audit_log 已留證）
        try {
          await env.chiyigo_db
            .prepare(`
              INSERT INTO audit_log (event_type, severity, ip_hash, event_data)
              VALUES ('audit.deploy_ordering.fallback_triggered', 'critical', ?, ?)
            `)
            .bind(ipHash, JSON.stringify({
              original_event_type: entry.event_type,
              hint: 'apply migration 0038, then redeploy functions',
            }))
            .run()
        } catch { /* swallow：fallback 主路徑已成功，這只是 ops 訊號 */ }
      } else {
        throw e
      }
    }

    if (parsed === 'critical') {
      // 必須 await：Cloudflare Worker 對未 await 的 fetch 會在 handler return 時 kill，
      // 沒 ctx.waitUntil 鉤點時只能同步等。critical 事件量極低（mfa.disable / account.delete），
      // 多 ~100ms 延遲可接受；webhook URL 缺值 / Discord 失敗都吞掉不擋主流程。
      try { await notifyCritical(env, { ...entry, severity, ipHash, traceId }) } catch { /* swallow */ }
    }
  } catch (e) {
    // audit 寫入失敗一律吞（不擋主流程），但**不再靜默**：留一筆 log 訊號供 tail / 監控偵測 audit-loss。
    // event_type 可能非 string（如 caller 誤傳 function，ISO-ENUM-1 即此情形）→ 以 typeof 安全描述輸出；
    // 此 log 本身不得 throw（已失敗路徑），故不記 entry.data（可能含 PII，且既有 redact 紀律）。
    const etDesc = typeof entry?.event_type === 'string' ? entry.event_type : `<${typeof entry?.event_type}>`
    console.error('[audit-loss] safeUserAudit swallowed an error; audit_log row not written', {
      event_type: etDesc,
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * PR5 5b（plan C3）：endpoint 在 domain 變更 COMMIT 後、best-effort emit 的 domain.event.emitted audit。
 * 純 observability —— outbox row 才是 SoT，遺失不影響正確性，故吞錯（safeUserAudit 本就吞）、絕不擋請求。
 * REDACTION：只記 stream_key_hash（SHA-256），永不記 raw streamKey；streamSeq 在 outbox row 上，applied 路徑
 * 不需 read-back。env: Env / identity: EmitIdentity 顯式標型（此檔其餘為 loose JS style，新函式不增 implicit-any）。
 */
export async function auditDomainEventEmitted(env: Env, identity: EmitIdentity): Promise<void> {
  // Wrap the WHOLE body: this runs POST-COMMIT, so even the hashToken() (outside safeUserAudit's own swallow) must
  // never throw out and turn an already-applied 200 into a 500. Loss is acceptable (the outbox row is the SoT).
  try {
    await safeUserAudit(env, {
      event_type: 'domain.event.emitted',
      severity: 'info',
      data: {
        event_id: identity.eventId,
        domain_event_type: identity.eventType,
        stream_key_hash: await hashToken(identity.streamKey),
        tenant_id: identity.tenantId,
      },
    })
  } catch { /* best-effort observability — never affects the committed request */ }
}

/**
 * Codex r8 / r9 helper（2026-05-10）：把 user-controlled 識別符（guest_id / device_uuid /
 * credential_id / wallet address）轉成可放 audit 的 keyed HMAC hex；防 audit DB 外洩
 * 後字典反推。
 *
 * Domain key 派生：HMAC(AUDIT_IP_SALT, "chiyigo.audit.<domain>:v1") — 不直接用 root salt
 * 簽 raw 值；不同 domain (guest-id / device-uuid / credential-id / wallet-address) key 互相
 * 獨立；rotation 時改派生字串版本即可，不影響其他 domain。
 * Codex r9-1：namespace 加 chiyigo.audit. 前綴，避免未來多系統共用 AUDIT_IP_SALT 時撞名。
 *
 * 缺 AUDIT_IP_SALT 時 fallback 字串可被 audit DB 外洩者推出，但仍比 raw SHA 安全；
 * 回傳 `salted: false` 給 caller 寫入 audit data，下游監控可偵測 prod 缺 salt 配置。
 *
 * @param {object} env
 * @param {string} domain  e.g. 'guest-id-audit'（多種識別符共用此 helper）
 * @param {string} raw     原始字串
 * @returns {Promise<{ hex: string, bytes: Uint8Array, salted: boolean }>}
 */
export async function hashIdentifierForAudit(env: UserAuditEnv, domain: string, raw: string): Promise<{ hex: string; bytes: Uint8Array; salted: boolean }> {
  const root = env.AUDIT_IP_SALT || 'dev-fallback-no-salt'
  const rootKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(root),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const derivedBuf = await crypto.subtle.sign(
    'HMAC', rootKey, new TextEncoder().encode(`chiyigo.audit.${domain}:v1`),
  )
  const domainKey = await crypto.subtle.importKey(
    'raw', derivedBuf,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  // raw 僅在編譯期為 string：實測 20 個 caller 中 6 個傳 any（admin/revoke.ts:196 ·
  // auth/refresh.ts:223 · auth/devices/logout.ts:101 · auth/local/register.ts:157 ·
  // webauthn/login-verify.ts:183 · :267），型別在該 6 處給不了 runtime 保證。String() 的實質
  // 作用是讓 runtime undefined 編成 "undefined" 而非與 '' 產生相同 HMAC 摘要造成稽核識別符
  // 互撞／誤歸屬；null／number／object 有無 String() 結果相同。
  // 故本行不得因「參數已是 string 看似冗餘」而在後續 strict:true 階段被清掉。
  const sigBuf = await crypto.subtle.sign(
    'HMAC', domainKey, new TextEncoder().encode(String(raw)),
  )
  const bytes = new Uint8Array(sigBuf)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return { hex, bytes, salted: Boolean(env.AUDIT_IP_SALT) }
}

/** Discord webhook 外呼逾時後請求取消（非精確 wall-clock 上限；見 PLAN §4.6）。
 *  目的：防單一外部服務卡住把 Worker 拖進平台 wall-clock 限制。
 *  zero-env：不讀 Env，故無須擴 UserAuditEnv／types/env.d.ts。前例 send-verification.ts:23 */
const AUDIT_WEBHOOK_TIMEOUT_MS = 8000

/**
 * Critical 事件 Discord webhook 預留 hook。
 * env.DISCORD_AUDIT_WEBHOOK 缺值即 noop。設 secret 後自動生效，無 code 改動。
 */
async function notifyCritical(env: UserAuditEnv, entry: CriticalNotice): Promise<void> {
  const url = env.DISCORD_AUDIT_WEBHOOK
  if (!url) return
  const content =
    `🚨 \`${entry.event_type}\` user_id=${entry.user_id ?? '—'} ` +
    `trace=${entry.traceId ?? '—'} ip_hash=${entry.ipHash?.slice(0, 12) ?? '—'}`
  // TECH-DEBT: notifyCritical 仍無 retry policy 且為 await 同步等待（TD-BATCHD-1 根因 (2)(4)），且投遞失敗零可觀測性（見 §10.1.2 之 (F-a)/(F-b)/(F-c)）— docs/plans/stage7-pr2dw-batchd-user-audit-severity-parser.md
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AUDIT_WEBHOOK_TIMEOUT_MS)
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

// 測試用（可單獨驗 hashIp 行為）
export const _internal = { hashIp }
