/**
 * POST /api/auth/org-switch — 切換 active tenant，重發 access token（PR1 Tenant Foundation）。
 *
 * Plan：docs/reviews/pr1-tenant-foundation-plan-2026-05-28.md §6.1（codex Gate 1 r1→r3）。
 *
 * chiyigo control-plane only：requireRegularAccessToken 內含 requireAuth 預設 aud='chiyigo' gate，
 * 擋掉 RP（mbti/talo）aud 與 temp_bind / step-up token；重發 token 明確 audience='chiyigo'（禁 audience:null）。
 * tenant_id 一律經 resolveIssuanceContextForTenant 驗過（fail-closed），platform_role 由 DB 推導、禁信 client。
 * 不改 refresh token（決策 D：PR1 不做跨 refresh 持久化）。
 */

import { res, requireRegularAccessToken } from '../../utils/auth'
import { signJwt } from '../../utils/jwt'
import { resolveIssuanceContextForTenant } from '../../utils/tenant-context'
import { safeUserAudit } from '../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

const ACCESS_TOKEN_TTL = '15m'
const RL_WINDOW_SEC = 60
const RL_MAX        = 20

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const { user, userId, error } = await requireRegularAccessToken(request, env)
  if (error) return error

  const db = env.chiyigo_db

  // per-user write-path 限流（§13）
  const { blocked } = await checkRateLimit(db, { kind: 'org_switch', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) {
    return res({ error: 'Too many tenant switches. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(db, { kind: 'org_switch', userId })

  // body validation（inline runtime validator，不引 Zod；嚴格型別、不強制轉型）
  let body: unknown
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res({ error: 'Body must be a JSON object', code: 'ERR_VALIDATION' }, 400)
  }
  const targetTenantId = (body as Record<string, unknown>).tenant_id
  // 嚴格：必須是 number（拒 "1" / true / [1] 等被 Number() 矇混的型別），且正整數、安全範圍
  if (typeof targetTenantId !== 'number' || !Number.isSafeInteger(targetTenantId) || targetTenantId <= 0) {
    return res({ error: 'tenant_id must be a positive integer', code: 'ERR_VALIDATION' }, 400)
  }

  // fail-closed invariant（§20 驗收門）：tenant active + membership active + personal owner guard + role 由 DB
  const ctx = await resolveIssuanceContextForTenant(db, userId, targetTenantId)
  if (ctx.ok === false) {
    await safeUserAudit(env, {
      event_type: 'tenant.switch.deny', severity: 'warn', user_id: userId, request,
      data: { target_tenant_id: targetTenantId, reason_code: ctx.code },
    })
    return res({ error: 'Tenant switch denied', code: 'TENANT_SWITCH_DENIED' }, 403)
  }

  // 重發 access token：保留現有 session claim（已過 requireAuth ver/status gate）+ 覆寫 tenant_id/platform_role。
  // 明確 audience='chiyigo'；不 spread 整個舊 payload（避免帶到舊 jti/iat/exp/aud）。
  const claims: Record<string, unknown> = {
    sub:            user.sub,
    email:          user.email,
    email_verified: user.email_verified,
    role:           user.role,
    status:         user.status,
    ver:            user.ver,
    scope:          user.scope,
    tenant_id:      ctx.tenant_id,
    platform_role:  ctx.platform_role,
  }
  // 保留 auth-context claim（webauthn/step-up 後的 session 連續性），present 才帶
  if (user.amr !== undefined) claims.amr = user.amr
  if (user.acr !== undefined) claims.acr = user.acr
  // PR-0（sid claim）：org-switch 重發不換 session，preserve 當前 token 的 per-login sid；
  // 舊 token 無 sid → 重發亦無 sid（factor-add elevation 對該 token fail-closed，符契約）。
  if (user.sid !== undefined) claims.sid = user.sid

  const accessToken = await signJwt(claims, ACCESS_TOKEN_TTL, env, { audience: 'chiyigo' })

  await safeUserAudit(env, {
    event_type: 'tenant.switch.success', user_id: userId, request,
    data: { from_tenant_id: user.tenant_id ?? null, to_tenant_id: ctx.tenant_id, platform_role: ctx.platform_role },
  })

  return res({ access_token: accessToken, tenant_id: ctx.tenant_id, platform_role: ctx.platform_role })
}
