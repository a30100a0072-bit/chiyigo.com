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
 *     只撤該 user 在指定 device 上的 refresh_token。
 *     access_token 仍有效到 exp，但 refresh 失敗後即下線（不影響其他裝置）。
 *
 * 保護規則（同 ban.js）：
 *  - mode='user' / 'device'：不可撤自己 / 不可撤同層級或更高層級 role
 *
 * 回傳：
 *   200 → { mode, ... }
 *   400 → 參數錯誤
 *   401 / 403 → 未授權 / 角色不足
 *   404 → user not found（mode user/device）
 */

import { res } from '../../utils/auth.js'
import { requireRole, actorOutranksTarget, isKnownRole, safeRoleString } from '../../utils/requireRole.js'
import { revokeJti } from '../../utils/revocation.js'
import { appendAuditLog } from '../../utils/audit-log.js'
import { safeUserAudit } from '../../utils/user-audit.js'

const VALID_MODES = new Set(['jti', 'user', 'device'])

export async function onRequestPost({ request, env }) {
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

  // P1-15：先寫 hash-chain
  try {
    await appendAuditLog(db, {
      admin_id: Number(user.sub), admin_email: user.email,
      action: 'revoke.device', target_id: targetId, target_email: target.email,
      ip_address: ip,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  const result = await db
    .prepare(`
      UPDATE refresh_tokens SET revoked_at = datetime('now')
      WHERE user_id = ? AND device_uuid = ? AND revoked_at IS NULL
    `)
    .bind(targetId, deviceUuid)
    .run()
  const refreshRevoked = result?.meta?.changes ?? 0

  await safeUserAudit(env, {
    event_type: 'admin.token.revoked.device', severity: 'critical',
    user_id: targetId, request,
    data: { admin_id: Number(user.sub), device_uuid: deviceUuid, refresh_revoked: refreshRevoked },
  })
  return res({ mode, user_id: targetId, device_uuid: deviceUuid, refresh_revoked: refreshRevoked })
}
