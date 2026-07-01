/**
 * POST /api/admin/revoke
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * Phase B / B3 — Token Revocation Admin API
 *
 * 三種 revoke 模式（body.mode 決定）：
 *
 *  1. mode='jti'         { mode, jti, exp? }
 *     精準撤一張 access_token（最常見：單裝置被偷時用）。
 *     exp 為 epoch 秒（KV TTL 用），缺省 = now + 1 hour（access_token 預設 15min，
 *     1 hour 涵蓋所有合理 access_token TTL）。
 *
 *  2. mode='user'        { mode, user_id }
 *     撤一個 user 所有現存 access_token + 所有 active refresh_token。
 *     做法：bump users.token_version（access_token 全部 ver mismatch）+
 *           UPDATE refresh_tokens SET revoked_at（refresh 無法 rotate）。
 *     被偷裝置不明 / 帳號全面失守時用。
 *
 *  3. mode='device'      { mode, user_id, device_uuid }
 *     只撤該 user 在指定 device 上的 session families（每個 per-login session_id 一個 family），並對每個撤掉的
 *     family emit 一筆 session.revoked（PR5 5d-2 c5，multi-family；device_uuid 為 non-null）。
 *     access_token 仍有效到 exp，但 refresh 失敗後即下線（不影響其他裝置）。
 *
 * 注意：mode='user'（bump token_version）與 mode='jti' **永不** emit session.revoked — token-epoch / 單一 access
 *       token 的失效不是「per-login session 被撤」的 deny subject（master plan D6）。只有 mode='device' 走 emission。
 *
 * 保護規則（同 ban.ts）：
 *  - mode='user' / 'device'：不可撤自己 / 不可撤同層級或更高層級 role
 *
 * 回傳：
 *   200 → { mode, ... }
 *   400 → 參數錯誤
 *   401 / 403 → 未授權 / 角色不足
 *   404 → user not found（mode user/device）
 *   500 → mode=device：{ code:'SESSION_INTEGRITY_VIOLATION' }（同 session_id >1 live head）
 *                    / { code:'REVOKE_INCOMPLETE', revoked, emitted, remaining }（chunk 部分失敗，retry 剩下的）
 */

import { res } from '../../utils/auth'
import { requireRole, actorOutranksTarget, isKnownRole, safeRoleString } from '../../utils/requireRole'
import { revokeJti } from '../../utils/revocation'
import { appendAuditLog } from '../../utils/audit-log'
import { safeUserAudit, auditDomainEventEmitted, hashIdentifierForAudit } from '../../utils/user-audit'
import { revokeSessionFamilies, FAMILY_REF_SQL, SESSION_REVOKE_CHUNK_SIZE, resolveLargeNThreshold } from '../../utils/session-revoke'

const VALID_MODES = new Set(['jti', 'user', 'device'])

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const mode = body?.mode
  if (!VALID_MODES.has(mode))
    return res({ error: `mode must be one of: ${[...VALID_MODES].join(', ')}`, code: 'INVALID_MODE' }, 400)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  if (mode === 'jti') {
    const jti = typeof body.jti === 'string' ? body.jti.trim() : ''
    if (!jti) return res({ error: 'jti is required for mode=jti', code: 'JTI_REQUIRED' }, 400)

    const exp = Number.isFinite(body.exp) ? body.exp : Math.floor(Date.now() / 1000) + 3600

    // P1-15：先寫 hash-chain；失敗即拒，不做 KV revoke 也不留靜默痕跡
    try {
      await appendAuditLog(db, {
        admin_id: Number(user.sub), admin_email: user.email,
        action: 'revoke.jti', target_id: 0, target_email: `jti:${jti.slice(0, 32)}`,
        ip_address: ip,
      })
    } catch {
      return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
    }

    await revokeJti(env, jti, exp)
    await safeUserAudit(env, {
      event_type: 'admin.token.revoked.jti', severity: 'critical',
      user_id: Number(user.sub), request,
      data: { jti: jti.slice(0, 32), exp, admin_id: Number(user.sub) },
    })
    return res({ mode, jti, message: 'Access token revoked' })
  }

  // mode='user' / 'device' 共用：先驗 target user
  const targetId = Number(body.user_id)
  if (!Number.isFinite(targetId) || targetId <= 0)
    return res({ error: 'user_id must be a positive integer', code: 'USER_ID_INVALID' }, 400)

  if (targetId === Number(user.sub))
    return res({ error: 'Cannot revoke your own tokens via admin API', code: 'CANNOT_TARGET_SELF' }, 400)

  const target = await db
    .prepare(`SELECT id, email, role FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(targetId)
    .first()
  if (!target) return res({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404)

  // Codex r4 #4：unknown target role critical audit
  if (!isKnownRole(target.role)) {
    await safeUserAudit(env, {
      event_type: 'admin.unknown_role_target', severity: 'critical',
      user_id: targetId, request,
      data: { action: 'revoke_user', target_role: safeRoleString(target.role), actor_id: Number(user.sub) },
    })
    return res({ error: 'Target user has unknown role; refused for safety', code: 'UNKNOWN_TARGET_ROLE' }, 403)
  }
  if (!actorOutranksTarget(user.role, target.role))
    return res({ error: 'Cannot revoke a user with equal or higher role', code: 'CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE' }, 403)

  if (mode === 'user') {
    // P1-15：先寫 hash-chain；失敗拒動
    try {
      await appendAuditLog(db, {
        admin_id: Number(user.sub), admin_email: user.email,
        action: 'revoke.user', target_id: targetId, target_email: target.email,
        ip_address: ip,
      })
    } catch {
      return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
    }

    // bump token_version → access_token 全失效；撤所有 refresh_token
    const stats = await db.batch([
      db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).bind(targetId),
      db.prepare(`
        UPDATE refresh_tokens SET revoked_at = datetime('now')
        WHERE user_id = ? AND revoked_at IS NULL
      `).bind(targetId),
    ])
    const refreshRevoked = stats?.[1]?.meta?.changes ?? 0

    await safeUserAudit(env, {
      event_type: 'admin.token.revoked.user', severity: 'critical',
      user_id: targetId, request,
      data: { admin_id: Number(user.sub), refresh_revoked: refreshRevoked, target_email: target.email },
    })
    return res({ mode, user_id: targetId, refresh_revoked: refreshRevoked })
  }

  // mode === 'device'
  const deviceUuid = typeof body.device_uuid === 'string' ? body.device_uuid.trim() : ''
  if (!deviceUuid) return res({ error: 'device_uuid is required for mode=device', code: 'DEVICE_UUID_REQUIRED' }, 400)

  // P1-15：先寫 hash-chain（記錄 admin 動作，無論結果；失敗即拒）
  try {
    await appendAuditLog(db, {
      admin_id: Number(user.sub), admin_email: user.email,
      action: 'revoke.device', target_id: targetId, target_email: target.email,
      ip_address: ip,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  // PR5 5d-2 c5：multi-family。device_uuid 為 non-null（admin 契約不擴充到 null，master plan D6）。先列此 device 上
  // 仍 live 的 DISTINCT family refs，交 revokeSessionFamilies 做 GLOBAL 完整性前置檢查 + chunk + 撤銷 + emit。
  // actorSub = admin 的 sub。
  const candRows = await db
    .prepare(`SELECT DISTINCT ${FAMILY_REF_SQL} AS ref FROM refresh_tokens
                WHERE user_id = ? AND device_uuid = ? AND revoked_at IS NULL`)
    .bind(targetId, deviceUuid)
    .all()
  const candidateRefs = (candRows.results ?? []).map((r: Record<string, unknown>) => String(r.ref))

  // PR5 large-N 異常告警（observability，no silent cap）：N = 此 device 上列舉到的 live family 數；超過異常門檻就在
  // 既有 critical 稽核加 large_n flag（即使 full success 也發）。門檻 env 可調（嚴格只收 finite 正整數，否則 default 50）。
  const threshold = resolveLargeNThreshold(env.SESSION_REVOKE_LARGE_N_THRESHOLD)
  const n = candidateRefs.length
  const largeNData = n > threshold ? { large_n: true, n, threshold } : {}

  const result = await revokeSessionFamilies(db, targetId, candidateRefs, String(user.sub))

  // 同一 session_id 出現 >1 live head（不變量被破壞）→ fail-closed：critical 稽核 + 500，不撤不 emit
  //（P1-15 已記錄此次 admin 嘗試；不寫 admin.token.revoked.device，因為實際沒撤任何 token）。
  if (result.outcome === 'integrity_violation') {
    await safeUserAudit(env, {
      event_type: 'session.integrity_violation', severity: 'critical',
      user_id: targetId, request,
      data: { heads: result.integrityHeads, site: 'admin.revoke.device', admin_id: Number(user.sub) },
    })
    return res({ error: 'Session integrity violation', code: 'SESSION_INTEGRITY_VIOLATION' }, 500)
  }

  // post-commit、best-effort：每個已 emit 的 family 記一筆 redacted domain.event.emitted（部分失敗時也對已 commit 的記）。
  for (const id of result.emittedIdentities) await auditDomainEventEmitted(env, id)

  // EVT-006：device_uuid 是 client 識別符且參與 refresh device-binding（refresh.ts），不可明文入 audit_log（防 DB 外洩
  // 後反查 + 配合被竊 refresh token 通過綁定）。改 keyed-HMAC，與 devices/logout.ts / device-alerts.ts 同 domain/同欄位名。
  // deviceUuid 在 mode=device 恆 non-null（上方已驗，空值回 400），故無需 null 分支。
  const sig = await hashIdentifierForAudit(env, 'device-uuid', deviceUuid)
  const deviceAudit = { device_uuid_hmac16: sig.hex.slice(0, 16), salted: sig.salted }

  // chunk 部分失敗、前面 chunk 已 commit → forward-progress。寫一筆**獨立的 partial-failure 稽核**（partial:true +
  // counts），ops 才能區分「完整成功」與「只完成前幾個 chunk 後失敗」（plan §5）；回 NON-2xx + counts，client retry 剩下的。
  if (result.outcome === 'incomplete') {
    await safeUserAudit(env, {
      event_type: 'admin.token.revoked.device', severity: 'critical',
      user_id: targetId, request,
      data: {
        partial: true, site: 'admin.revoke.device', admin_id: Number(user.sub), ...deviceAudit,
        revoked: result.revoked, emitted: result.emitted, remaining: result.remaining,
        chunk_size: SESSION_REVOKE_CHUNK_SIZE, ...largeNData,
      },
    })
    return res({
      error: 'Session revocation incomplete; retry to finish',
      code: 'REVOKE_INCOMPLETE',
      revoked: result.revoked, emitted: result.emitted, remaining: result.remaining,
    }, 500)
  }

  // ok：既有 admin.token.revoked.device 稽核（refresh_revoked = 撤掉的 family 數）。large-N 時加 large_n flag
  //（severity 已是 critical ≥ warn，不變）；正常小 N 不加欄位。
  await safeUserAudit(env, {
    event_type: 'admin.token.revoked.device', severity: 'critical',
    user_id: targetId, request,
    data: { admin_id: Number(user.sub), ...deviceAudit, refresh_revoked: result.revoked, ...largeNData },
  })
  return res({ mode, user_id: targetId, device_uuid: deviceUuid, refresh_revoked: result.revoked })
}
