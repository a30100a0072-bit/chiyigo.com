/**
 * GET /api/auth/webauthn/credentials
 * Header: Authorization: Bearer <access_token>
 *
 * Phase D-2 Wave C — 列出當前 user 的所有 passkey。
 *
 * 用於 dashboard 裝置管理頁。**不**回傳 public_key / counter（safety + payload size）。
 *
 * 回傳：
 *   200 → { credentials: [{ id, nickname, transports, aaguid, backup_eligible,
 *                            backup_state, created_at, last_used_at }] }
 *   401 → access_token 無效
 */

import { requireAuth, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const rs = await env.chiyigo_db
    .prepare(
      `SELECT id, nickname, transports, aaguid, backup_eligible, backup_state,
              created_at, last_used_at
         FROM user_webauthn_credentials
        WHERE user_id = ?
        ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all()

  const credentials = (rs.results ?? []).map(r => ({
    id:               r.id,
    nickname:         r.nickname,
    transports:       parseTransports(r.transports),
    aaguid:           r.aaguid,
    backup_eligible:  !!r.backup_eligible,
    backup_state:     !!r.backup_state,
    created_at:       r.created_at,
    last_used_at:     r.last_used_at,
  }))

  return res({ credentials }, 200, cors)
}

function parseTransports(raw) {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
