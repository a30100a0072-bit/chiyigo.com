/**
 * GET    /api/admin/oauth-clients/:client_id
 * PATCH  /api/admin/oauth-clients/:client_id
 * DELETE /api/admin/oauth-clients/:client_id
 *
 * Phase C-1 Wave 3 — 單一 RP CRUD
 *
 * PATCH 接受部分欄位更新（任一 optional 欄位可單獨改）。client_id 不可改。
 * DELETE 是「軟下架」（is_active=0），不刪 row 保留 audit history。
 *   要硬刪：admin 直接走 SQL（不開 API，避免誤操作）。
 */

import { res, requireStepUp, requireAnyScope } from '../../../utils/auth.js'
import { requireRole } from '../../../utils/requireRole.js'
import { invalidateClientsCache } from '../../../utils/oauth-clients.js'
import { appendAuditLog } from '../../../utils/audit-log.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes.js'

const VALID_APP_TYPES = new Set(['web', 'native', 'mobile'])

function isHttpsOrChiyigoScheme(uri) {
  if (typeof uri !== 'string' || !uri) return false
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'chiyigo:') return true
    if (u.hostname === '127.0.0.1' && u.protocol === 'http:') return true
    return false
  } catch { return false }
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(s => typeof s === 'string')
}

// ── GET ─────────────────────────────────────────────────────────

export async function onRequestGet({ request, env, params }) {
  // P1-17 Phase 3: GET 同時接受 admin:clients:read 或 :write
  const { error } = await requireAnyScope(request, env, SCOPES.ADMIN_CLIENTS_READ, SCOPES.ADMIN_CLIENTS_WRITE)
  if (error) return error

  const row = await env.chiyigo_db
    .prepare(`
      SELECT client_id, client_name, app_type, aud,
             allowed_redirect_uris, allowed_scopes,
             post_logout_redirect_uris, frontchannel_logout_uris,
             backchannel_logout_uri, cors_origins,
             is_active, created_at, updated_at
      FROM oauth_clients
      WHERE client_id = ?
    `)
    .bind(params.client_id).first()

  if (!row) return res({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404)
  return res(row)
}

// ── PATCH ───────────────────────────────────────────────────────

/**
 * 把可變更欄位 normalize 成 (column, value) pairs。
 * 未在 body 出現的欄位 → 不動。
 */
function buildPatchSet(body) {
  const sets = []
  const binds = []
  const errors = []

  if (body.client_name !== undefined) {
    if (typeof body.client_name !== 'string' || !body.client_name) {
      errors.push('client_name must be a non-empty string')
    } else {
      sets.push('client_name = ?'); binds.push(body.client_name)
    }
  }

  if (body.aud !== undefined) {
    if (typeof body.aud !== 'string' || !body.aud) errors.push('aud must be a non-empty string')
    else { sets.push('aud = ?'); binds.push(body.aud) }
  }

  if (body.app_type !== undefined) {
    if (!VALID_APP_TYPES.has(body.app_type)) errors.push(`app_type must be one of: ${[...VALID_APP_TYPES].join(', ')}`)
    else { sets.push('app_type = ?'); binds.push(body.app_type) }
  }

  if (body.redirect_uris !== undefined) {
    if (!isStringArray(body.redirect_uris) || !body.redirect_uris.length ||
        !body.redirect_uris.every(isHttpsOrChiyigoScheme)) {
      errors.push('redirect_uris must be a non-empty array of valid URIs')
    } else {
      sets.push('allowed_redirect_uris = ?'); binds.push(JSON.stringify(body.redirect_uris))
    }
  }

  if (body.allowed_scopes !== undefined) {
    if (!isStringArray(body.allowed_scopes)) errors.push('allowed_scopes must be a string array')
    else { sets.push('allowed_scopes = ?'); binds.push(JSON.stringify(body.allowed_scopes)) }
  }

  // optional array fields — null 也 OK（清空）
  for (const [bodyKey, col] of [
    ['origins',                   'cors_origins'],
    ['post_logout_redirect_uris', 'post_logout_redirect_uris'],
    ['frontchannel_logout_uris',  'frontchannel_logout_uris'],
  ]) {
    if (body[bodyKey] !== undefined) {
      if (!isStringArray(body[bodyKey])) errors.push(`${bodyKey} must be a string array`)
      else { sets.push(`${col} = ?`); binds.push(JSON.stringify(body[bodyKey])) }
    }
  }

  if (body.backchannel_logout_uri !== undefined) {
    if (body.backchannel_logout_uri !== null &&
        !isHttpsOrChiyigoScheme(body.backchannel_logout_uri)) {
      errors.push('backchannel_logout_uri must be https URL or null')
    } else {
      sets.push('backchannel_logout_uri = ?')
      binds.push(body.backchannel_logout_uri)
    }
  }

  if (body.is_active !== undefined) {
    if (body.is_active !== 0 && body.is_active !== 1)
      errors.push('is_active must be 0 or 1')
    else { sets.push('is_active = ?'); binds.push(body.is_active) }
  }

  return { sets, binds, errors }
}

export async function onRequestPatch({ request, env, params }) {
  // P0-5：改 redirect_uris / scopes 等同帳號劫持武器，必須 step-up
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'update_oauth_client')
  if (stepCheck.error) return stepCheck.error
  const user = stepCheck.user
  // P1-17：fine-grain admin:clients:write 守門（取代 hard-coded role==='admin'）
  if (!effectiveScopesFromJwt(user).has(SCOPES.ADMIN_CLIENTS_WRITE)) {
    return res({ error: 'admin:clients:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:clients:write' }, 403)
  }

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { sets, binds, errors } = buildPatchSet(body)
  if (errors.length) return res({ error: errors.join('; ') }, 400)
  if (!sets.length) return res({ error: 'No updatable fields provided', code: 'NO_UPDATABLE_FIELDS' }, 400)

  // P1-15：先確認目標存在，再寫 hash-chain；失敗拒改（避免靜默改 RP 後無證據）
  const exists = await env.chiyigo_db
    .prepare(`SELECT 1 FROM oauth_clients WHERE client_id = ? LIMIT 1`)
    .bind(params.client_id).first()
  if (!exists) return res({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404)

  try {
    await appendAuditLog(env.chiyigo_db, {
      admin_id:     Number(user.sub),
      admin_email:  user.email,
      action:       'oauth_client.update',
      target_id:    0,
      target_email: `oauth_client:${params.client_id}`,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  const result = await env.chiyigo_db
    .prepare(`UPDATE oauth_clients SET ${sets.join(', ')}, updated_at = datetime('now')
              WHERE client_id = ?`)
    .bind(...binds, params.client_id)
    .run()

  if ((result.meta?.changes ?? 0) === 0)
    return res({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404)

  await invalidateClientsCache(env)

  await safeUserAudit(env, {
    event_type: 'admin.oauth_client.updated', severity: 'critical',
    user_id: Number(user.sub), request,
    data: { client_id: params.client_id, fields_changed: sets.map(s => s.split(' = ')[0]) },
  })

  return res({ message: 'Client updated', client_id: params.client_id })
}

// ── DELETE（軟下架）─────────────────────────────────────────────

export async function onRequestDelete({ request, env, params }) {
  // P0-5：軟下架仍可造成既有 RP 全斷，必須 step-up
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'delete_oauth_client')
  if (stepCheck.error) return stepCheck.error
  const user = stepCheck.user
  // P1-17：fine-grain admin:clients:write 守門（軟下架仍是 destructive）
  if (!effectiveScopesFromJwt(user).has(SCOPES.ADMIN_CLIENTS_WRITE)) {
    return res({ error: 'admin:clients:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:clients:write' }, 403)
  }

  // P1-15：先確認狀態，再 hash-chain，再執行 UPDATE
  const existing = await env.chiyigo_db
    .prepare(`SELECT is_active FROM oauth_clients WHERE client_id = ?`)
    .bind(params.client_id).first()
  if (!existing) return res({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404)
  if (!existing.is_active) return res({ error: 'Client already disabled', code: 'CLIENT_ALREADY_DISABLED' }, 409)

  try {
    await appendAuditLog(env.chiyigo_db, {
      admin_id:     Number(user.sub),
      admin_email:  user.email,
      action:       'oauth_client.disable',
      target_id:    0,
      target_email: `oauth_client:${params.client_id}`,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  await env.chiyigo_db
    .prepare(`UPDATE oauth_clients SET is_active = 0, updated_at = datetime('now')
              WHERE client_id = ?`)
    .bind(params.client_id)
    .run()

  await invalidateClientsCache(env)

  await safeUserAudit(env, {
    event_type: 'admin.oauth_client.disabled', severity: 'critical',
    user_id: Number(user.sub), request,
    data: { client_id: params.client_id },
  })

  return res({ message: 'Client disabled (soft delete)', client_id: params.client_id })
}
