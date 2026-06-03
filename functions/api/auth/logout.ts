/**
 * POST /api/auth/logout
 * Body: { refresh_token }  (或 chiyigo_refresh cookie)
 *
 * 撤銷指定 refresh_token（其所屬的 per-login session family），實現伺服器端登出，並 emit 一筆
 * session.revoked domain event（PR5 5d-2，plan §4.1 single-family）。
 * 不需要 Authorization header — 讓 access_token 過期的用戶也能登出。
 *
 * 設計原則：
 *  - 冪等：token 不存在 / family 已全撤（含 old token 被輪換或登出後 replay）→ 同樣回 200，不洩漏 token 是否有效。
 *  - rotation-robust（B1，端到端）：先用 token_hash 讀 family ref（**不要求該列仍 live**），再用 GLOBAL live-head
 *    COUNT 決定動作；撤銷走 casByFamily（PK-pinned subquery 重新解析當前 head）。即使 concurrent refresh 已把
 *    old token 輪換成 new live head，用 old token logout 仍會撤掉 new head（關掉 refresh-before-logout race）。
 *  - fail-closed：同一 session_id 出現 >1 live head（不變量被破壞）→ 不撤、不 emit、critical 稽核 + 5xx。
 *  - emit ⟺ family 完全撤銷：session.revoked 與 refresh_tokens 撤銷在同一 atomic batch，both-or-neither。
 *
 * 回傳：
 *  200 → { message: 'Logged out' }（冪等；清除 chiyigo_refresh cookie；含 0-live-head 無 emit 路徑）
 *  500 → { error, code: 'SESSION_INTEGRITY_VIOLATION' }（同 family >1 live head；不撤、不 emit、不清 cookie）
 */

import { hashToken } from '../../utils/crypto'
import { getCorsHeaders } from '../../utils/cors'
import { CLEAR_REFRESH_COOKIE } from '../../utils/cookies'
import { safeUserAudit, auditDomainEventEmitted } from '../../utils/user-audit'
import { emitSessionRevoked } from '../../utils/domain-event-emit'
import { casByFamily, FAMILY_REF_SQL } from '../../utils/session-revoke'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  // 成功登出（含並發已撤、token 不存在）一律：200 + 清除 Cookie（冪等）。
  const loggedOut = () => new Response(JSON.stringify({ message: 'Logged out' }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': CLEAR_REFRESH_COOKIE, ...cors },
  })

  // Cookie 優先（Web），其次 JSON body（App）
  const cookieToken = parseCookieHeader(request.headers.get('Cookie'), 'chiyigo_refresh')
  let bodyToken
  try {
    const body = await request.json()
    bodyToken  = body?.refresh_token
  } catch { /* body 為空時忽略 */ }
  const refresh_token = cookieToken ?? bodyToken

  // 無 token：仍清除 Cookie（冪等），不視為錯誤
  if (!refresh_token) return loggedOut()

  const db = env.chiyigo_db
  const tokenHash = await hashToken(refresh_token)

  // PR5 5d-2 §4.1（code-gate c4 fix）：用 token_hash 讀此 token 所屬的 session FAMILY 的 ref — **刻意不要求該列仍
  // live**。否則「concurrent refresh 先完成 atomic rotation（old 列撤、new 列 live、同 session_id）→ logout 才
  // pre-read」這個 interleaving，會因 old 列已撤而找不到 family、直接 200 漏撤 current(new) head（refresh-before-
  // logout race，違反 plan SP7 rotation-before-revoke）。改讀「任一同 token_hash 列（live 或 revoked）」的 family
  // ref，再交給下方 GLOBAL live-head COUNT 決定動作 → casByFamily 仍會解析並撤掉當前 live head。
  // 完全不存在此 token（從未發出 / 已清理）→ 冪等 200、不 emit。
  const familyRow = await db
    .prepare(`SELECT user_id, ${FAMILY_REF_SQL} AS ref FROM refresh_tokens WHERE token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first()
  if (!familyRow?.user_id) return loggedOut()

  const userId = Number(familyRow.user_id)
  const ref = String(familyRow.ref)

  // PR5 5d-2 §4.1 / B3：GLOBAL device-less live-head COUNT on (user_id, ref)（對齊 casByFamily 的 (user_id, ref)
  // keying；revoked 列不計入）：
  //   heads === 0 → family 已全撤（含「old token 早被輪換 / 登出」後的 replay）→ 冪等 200、不 emit。
  //   heads === 1 → casByFamily 撤掉當前 live head（可能正是輪換後的 new head）+ emit。
  //   heads  > 1 → EXACTLY-ONE-LIVE-HEAD 不變量被破壞（同 session_id 兩列同時 live）→ fail-closed：critical 稽核
  //                + 5xx，不撤不 emit、不清 cookie（避免「撤一列、emit 一筆 deny、卻仍留一個 live head」）。
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS heads FROM refresh_tokens WHERE user_id = ? AND ${FAMILY_REF_SQL} = ? AND revoked_at IS NULL`)
    .bind(userId, ref)
    .first()
  const heads = Number(countRow?.heads ?? 0)
  if (heads === 0) return loggedOut()   // family 已全撤 → 冪等，不 emit
  if (heads > 1) {
    await safeUserAudit(env, {
      event_type: 'session.integrity_violation', severity: 'critical',
      user_id: userId, request,
      data: { heads, site: 'auth.logout' },   // 不放 raw ref：user_id 已足以定位待調查的 session 家族
    })
    return new Response(
      JSON.stringify({ error: 'Session integrity violation', code: 'SESSION_INTEGRITY_VIOLATION' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    )
  }

  // PR5 5d-2 §4.1：原子撤銷 family head + emit session.revoked（同一 batch；emit 的 changes() chain 由 casByFamily
  // 仲裁，emit ⟺ 真的撤了一列）。casByFamily 的 subquery 在執行時重新解析當前 live head → 對並發 rotation robust
  // （B1）。eventId/occurredAt 是唯一副作用，在此注入（helper 無 I/O）。
  const emit = emitSessionRevoked(
    db,
    { sub: String(userId), ref, actorSub: String(userId) },
    { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
  )
  const batch = await db.batch([
    casByFamily(db, userId, ref),
    ...emit.statements,
  ])

  // changes()=1 → 本 request 撤了 head（session.revoked 已寫入 outbox）。
  // changes()=0 → 並發 logout/revoke 在 count 與 batch 之間搶先撤掉整個 family → 冪等成功、不 emit
  //               （seqUpsert/outboxInsert 也 0-row，gated 鏈未觸發）。兩者皆回 200 + 清 cookie。
  if (batch[0].meta.changes === 1) {
    await safeUserAudit(env, { event_type: 'auth.logout', user_id: userId, request })
    // post-commit、best-effort 觀測 session.revoked 已寫入 outbox（redact streamKey→hash；失敗不擋已成功的 200）。
    await auditDomainEventEmitted(env, emit.identity)
  }

  return loggedOut()
}

function parseCookieHeader(header, name) {
  if (!header) return null
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[1] : null
}
