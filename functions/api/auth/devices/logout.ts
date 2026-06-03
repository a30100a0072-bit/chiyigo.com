/**
 * POST /api/auth/devices/logout
 * Header: Authorization: Bearer <access_token>
 * Body:   { device_uuid: string | null }
 *
 * Phase D-3a — 從 dashboard「登出此裝置」按鈕觸發。
 *
 * 撤該 user 在指定 device 上**所有未撤銷**的 session families（每個 per-login session_id 一個 family），並對每個
 * 撤掉的 family emit 一筆 session.revoked（PR5 5d-2 c5，multi-family）。不撤已撤的（idempotent，誤點兩下不擲錯）。
 * 撤完後該 device 上現有 access_token 仍然 valid 直到 15 分鐘 TTL 自然過期 — 這是 stateless JWT 的本質取捨；
 * 要立刻 kick off 走 admin/revoke 的 user-wide bumpTokenVersion。
 *
 * 為何不需 step-up：
 *   - 自己登自己的裝置，誤操作最多重 login，無法用來打別人
 *   - step-up UX 太重會讓用戶懶得登出舊裝置 → 安全反而更差
 *
 * 回傳：
 *   200 → { revoked: <family count> }（revoked == emitted == 撤掉的 family 數）
 *   400 → device_uuid 不是 string|null
 *   401 → access_token 無效
 *   404 → 該 user 在此 device 沒任何 refresh_tokens（防瞎刪別人 device 的探測）
 *   500 → { code: 'SESSION_INTEGRITY_VIOLATION' }（同 session_id >1 live head，不變量破壞；不撤不 emit）
 *       / { code: 'REVOKE_INCOMPLETE', revoked, emitted, remaining }（chunk 部分失敗，前面 chunk 已 commit；retry 剩下的）
 */

import { requireAuth, res } from '../../../utils/auth'
import { getCorsHeaders } from '../../../utils/cors'
import { safeUserAudit, hashIdentifierForAudit, auditDomainEventEmitted } from '../../../utils/user-audit'
import { revokeSessionFamilies, FAMILY_REF_SQL } from '../../../utils/session-revoke'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400, cors) }

  const dev = body?.device_uuid
  if (dev !== null && typeof dev !== 'string') {
    return res({ error: 'device_uuid must be string or null', code: 'INVALID_DEVICE_UUID' }, 400, cors)
  }

  // 先確認該 user 在此 device 真的有 row（無論已撤未撤）— 否則 404，避免 attacker
  // 用其他 user 的 device_uuid 來探測「該 device 是否屬於某 user」（雖然 device_uuid
  // 是 client 自己生 random UUID，理論探測沒意義，但 defense-in-depth 一致 pattern）
  const exists = dev === null
    ? await env.chiyigo_db
        .prepare(`SELECT 1 FROM refresh_tokens
                   WHERE user_id = ? AND device_uuid IS NULL LIMIT 1`)
        .bind(userId).first()
    : await env.chiyigo_db
        .prepare(`SELECT 1 FROM refresh_tokens
                   WHERE user_id = ? AND device_uuid = ? LIMIT 1`)
        .bind(userId, dev).first()
  if (!exists) return res({ error: 'Device not found', code: 'DEVICE_NOT_FOUND' }, 404, cors)

  // PR5 5d-2 c5：multi-family。先 device-filtered 列出此 device 上**仍 live** 的 DISTINCT family refs（device 分支
  // 只在這層 enumeration，不進 device-less 的 casByFamily — B2），交 revokeSessionFamilies 做 GLOBAL 完整性前置檢查
  // + chunk + 撤銷 + emit。candidate 空（rows 都已撤）→ helper 回 revoked:0（冪等）。
  const db = env.chiyigo_db
  const candRows = dev === null
    ? await db.prepare(`SELECT DISTINCT ${FAMILY_REF_SQL} AS ref FROM refresh_tokens
                          WHERE user_id = ? AND device_uuid IS NULL AND revoked_at IS NULL`).bind(userId).all()
    : await db.prepare(`SELECT DISTINCT ${FAMILY_REF_SQL} AS ref FROM refresh_tokens
                          WHERE user_id = ? AND device_uuid = ? AND revoked_at IS NULL`).bind(userId, dev).all()
  const candidateRefs = (candRows.results ?? []).map((r) => String(r.ref))

  // actorSub = 自己（self-logout）。
  const result = await revokeSessionFamilies(db, userId, candidateRefs, String(userId))

  // 同一 session_id 出現 >1 live head（不變量被破壞）→ fail-closed：critical 稽核 + 500，不撤不 emit、不清狀態。
  if (result.outcome === 'integrity_violation') {
    await safeUserAudit(env, {
      event_type: 'session.integrity_violation', severity: 'critical',
      user_id: userId, request,
      data: { heads: result.integrityHeads, site: 'auth.devices.logout' },
    })
    return res({ error: 'Session integrity violation', code: 'SESSION_INTEGRITY_VIOLATION' }, 500, cors)
  }

  // 既有 auth.devices.logout 觀測（revoked_count = 撤掉的 family 數）。
  // Codex r9-4：device_uuid_prefix → keyed HMAC（domain='device-uuid'，與 device-alerts 同 domain）
  const sig = dev === null ? null : await hashIdentifierForAudit(env, 'device-uuid', dev)
  await safeUserAudit(env, {
    event_type: 'auth.devices.logout',
    severity:   'info',
    user_id:    userId,
    request,
    data: {
      device_uuid_hmac16: sig === null ? null : sig.hex.slice(0, 16),
      salted:             sig === null ? null : sig.salted,
      revoked_count:      result.revoked,
    },
  })
  // post-commit、best-effort：每個已 emit 的 family 記一筆 redacted domain.event.emitted（stream_key→hash）。
  for (const id of result.emittedIdentities) await auditDomainEventEmitted(env, id)

  // 某 chunk 失敗、前面 chunk 已 commit → forward-progress：回 NON-2xx + counts，client retry 剩下的
  // （已撤的 family 不會被重新 enumerate → 不重複 emit）。
  if (result.outcome === 'incomplete') {
    return res({
      error: 'Session revocation incomplete; retry to finish',
      code: 'REVOKE_INCOMPLETE',
      revoked: result.revoked, emitted: result.emitted, remaining: result.remaining,
    }, 500, cors)
  }

  return res({ revoked: result.revoked }, 200, cors)
}
