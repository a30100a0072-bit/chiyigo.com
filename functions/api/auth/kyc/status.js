/**
 * GET /api/auth/kyc/status
 * Header: Authorization: Bearer <access_token>
 *
 * Phase F-1 — 回當前 user KYC 狀態。dashboard / 提款前置確認用。
 *
 * 回傳：
 *   200 → { status, level, vendor, expires_at, can_withdraw }
 *   401 → access_token 無效
 */

import { requireAuth, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { getUserKycStatus, KYC_STATUS } from '../../../utils/kyc.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const kyc = await getUserKycStatus(env, userId)

  return res({
    status:        kyc.status,
    level:         kyc.level,
    vendor:        kyc.vendor,
    expires_at:    kyc.expires_at,
    can_withdraw:  kyc.status === KYC_STATUS.VERIFIED,
  }, 200, cors)
}
