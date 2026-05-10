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

import { classifyAuditEvent, classifyForCold } from './audit-policy.js'

const KNOWN_SEVERITY = new Set(['info', 'warn', 'critical'])

/**
 * 把 IP 字串雜湊成 hex（用 AUDIT_IP_SALT 加鹽）。
 * salt 缺值 → 回 null（寧願不記也不要存 raw IP）。
 */
async function hashIp(env, ip) {
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
function extractTraceId(request, explicitTraceId) {
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
export async function safeUserAudit(env, entry) {
  try {
    if (!env?.chiyigo_db) return
    // F-3 Phase 1：查 event_type 是否在 audit-policy registry。
    // 不在則 console.warn，但照常寫入 audit（不擋 handler、不影響稽核完整性）。
    // 新增 audit event 必須同 PR 補進 audit-policy.js，否則 prod 會持續 warn。
    if (entry.event_type && !classifyAuditEvent(entry.event_type)) {
      console.warn('[audit-policy] unclassified event_type:', entry.event_type)
    }
    const severity = KNOWN_SEVERITY.has(entry.severity) ? entry.severity : 'info'
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
      // Codex round-11 H-1：deploy ordering 防呆。若 functions 比 migration 0038 先 deploy，
      // cold_class 欄不存在會炸；外層 catch-all 會吞掉，audit 靜默流失。
      // 用「no such column: cold_class」精準匹配重試舊 schema INSERT，覆蓋 short window；
      // migration 上線後 fallback 自然不會再觸發。其他錯誤往上拋給外層吞。
      const msg = String(e?.message ?? '')
      if (msg.includes('no such column: cold_class') || msg.includes('cold_class')) {
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
      } else {
        throw e
      }
    }

    if (severity === 'critical') {
      // 必須 await：Cloudflare Worker 對未 await 的 fetch 會在 handler return 時 kill，
      // 沒 ctx.waitUntil 鉤點時只能同步等。critical 事件量極低（mfa.disable / account.delete），
      // 多 ~100ms 延遲可接受；webhook URL 缺值 / Discord 失敗都吞掉不擋主流程。
      try { await notifyCritical(env, { ...entry, severity, ipHash, traceId }) } catch { /* swallow */ }
    }
  } catch { /* 表不存在 / D1 暫時失效 — 不擋主流程 */ }
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
export async function hashIdentifierForAudit(env, domain, raw) {
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
  const sigBuf = await crypto.subtle.sign(
    'HMAC', domainKey, new TextEncoder().encode(String(raw)),
  )
  const bytes = new Uint8Array(sigBuf)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return { hex, bytes, salted: Boolean(env.AUDIT_IP_SALT) }
}

/**
 * Critical 事件 Discord webhook 預留 hook。
 * env.DISCORD_AUDIT_WEBHOOK 缺值即 noop。設 secret 後自動生效，無 code 改動。
 */
async function notifyCritical(env, entry) {
  const url = env.DISCORD_AUDIT_WEBHOOK
  if (!url) return
  const content =
    `🚨 \`${entry.event_type}\` user_id=${entry.user_id ?? '—'} ` +
    `trace=${entry.traceId ?? '—'} ip_hash=${entry.ipHash?.slice(0, 12) ?? '—'}`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

// 測試用（可單獨驗 hashIp 行為）
export const _internal = { hashIp }
