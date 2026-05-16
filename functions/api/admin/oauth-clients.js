/**
 * GET  /api/admin/oauth-clients      列表
 * POST /api/admin/oauth-clients      建立 RP
 *
 * Phase C-1 Wave 3 — Admin CRUD endpoints
 *
 * 角色守門：requireRole('admin')
 * 寫入後：invalidateClientsCache(env) → 下次 isolate refresh 立刻看到新 RP
 * 稽核：admin_audit_log（hash chain）action='oauth_client.create'
 *
 * Body（POST）必填：
 *   client_id, client_name, redirect_uris (非空 array)
 *
 * Body 選填（缺省值見下面 normalize）：
 *   aud, origins, post_logout_redirect_uris, frontchannel_logout_uris,
 *   backchannel_logout_uri, allowed_scopes, app_type
 */

import { res, requireAnyScope } from '../../utils/auth.js'
import { requireRole } from '../../utils/requireRole'
import { invalidateClientsCache } from '../../utils/oauth-clients'
import { appendAuditLog } from '../../utils/audit-log.js'
import { safeUserAudit } from '../../utils/user-audit'
import { SCOPES, effectiveScopesFromJwt } from '../../utils/scopes'

const CLIENT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/  // 小寫英數 + - + _，1-64 字
const VALID_APP_TYPES = new Set(['web', 'native', 'mobile'])

function isHttpsOrChiyigoScheme(uri) {
  if (typeof uri !== 'string' || !uri) return false
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'chiyigo:') return true                          // mobile custom scheme
    if (u.hostname === '127.0.0.1' && u.protocol === 'http:') return true // RFC 8252 loopback
    return false
  } catch { return false }
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(s => typeof s === 'string')
}

/**
 * 驗證並 normalize POST body。
 * @returns {{ ok: true, normalized } | { ok: false, error }}
 */
function validateCreateBody(body) {
  if (!body || typeof body !== 'object')
    return { ok: false, error: 'Invalid body' }

  const { client_id, client_name } = body
  if (!client_id || !CLIENT_ID_RE.test(client_id))
    return { ok: false, error: 'client_id must match [a-z0-9][a-z0-9_-]{1,63}' }

  if (!client_name || typeof client_name !== 'string')
    return { ok: false, error: 'client_name is required' }

  if (!isStringArray(body.redirect_uris) || !body.redirect_uris.length)
    return { ok: false, error: 'redirect_uris must be a non-empty array of strings' }

  if (!body.redirect_uris.every(isHttpsOrChiyigoScheme))
    return { ok: false, error: 'redirect_uris must be https / chiyigo:// / http://127.0.0.1' }

  // optional arrays
  for (const k of ['origins', 'post_logout_redirect_uris', 'frontchannel_logout_uris']) {
    if (body[k] !== undefined && !isStringArray(body[k]))
      return { ok: false, error: `${k} must be an array of strings` }
  }

  if (body.backchannel_logout_uri !== undefined &&
      body.backchannel_logout_uri !== null &&
      !isHttpsOrChiyigoScheme(body.backchannel_logout_uri))
    return { ok: false, error: 'backchannel_logout_uri must be https URL or null' }

  if (body.app_type !== undefined && !VALID_APP_TYPES.has(body.app_type))
    return { ok: false, error: `app_type must be one of: ${[...VALID_APP_TYPES].join(', ')}` }

  if (body.allowed_scopes !== undefined && !isStringArray(body.allowed_scopes))
    return { ok: false, error: 'allowed_scopes must be an array of strings' }

  if (body.aud !== undefined && (typeof body.aud !== 'string' || !body.aud))
    return { ok: false, error: 'aud must be a non-empty string' }

  return {
    ok: true,
    normalized: {
      client_id,
      client_name,
      app_type:                  body.app_type ?? 'web',
      allowed_redirect_uris:     JSON.stringify(body.redirect_uris),
      allowed_scopes:            JSON.stringify(body.allowed_scopes ?? ['openid', 'profile', 'email']),
      post_logout_redirect_uris: JSON.stringify(body.post_logout_redirect_uris ?? []),
      frontchannel_logout_uris:  JSON.stringify(body.frontchannel_logout_uris ?? []),
      backchannel_logout_uri:    body.backchannel_logout_uri ?? null,
      cors_origins:              JSON.stringify(body.origins ?? []),
      aud:                       body.aud ?? client_id,
    },
  }
}

// ── GET /api/admin/oauth-clients ─────────────────────────────────

export async function onRequestGet({ request, env }) {
  // P1-17 Phase 3: GET 同時接受 admin:clients:read 或 :write
  const { error } = await requireAnyScope(request, env, SCOPES.ADMIN_CLIENTS_READ, SCOPES.ADMIN_CLIENTS_WRITE)
  if (error) return error

  const url      = new URL(request.url)
  const includeInactive = url.searchParams.get('include_inactive') === '1'
  const where    = includeInactive ? '' : 'WHERE is_active = 1'

  const { results } = await env.chiyigo_db
    .prepare(`
      SELECT client_id, client_name, app_type, aud,
             allowed_redirect_uris, allowed_scopes,
             post_logout_redirect_uris, frontchannel_logout_uris,
             backchannel_logout_uri, cors_origins,
             is_active, created_at, updated_at
      FROM oauth_clients
      ${where}
      ORDER BY created_at DESC
    `)
    .all()

  return res({ rows: results ?? [] })
}

// ── POST /api/admin/oauth-clients ────────────────────────────────

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  // P1-17：fine-grain admin:clients:write 守門。admin role coarse → fine 透過 hierarchy 通過
  if (!effectiveScopesFromJwt(user).has(SCOPES.ADMIN_CLIENTS_WRITE)) {
    return res({ error: 'admin:clients:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:clients:write' }, 403)
  }

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const v = validateCreateBody(body)
  if (!v.ok) return res({ error: v.error, code: 'INVALID_CLIENT_BODY' }, 400)
  const n = v.normalized

  // 重複 client_id → 409
  const exists = await env.chiyigo_db
    .prepare(`SELECT 1 FROM oauth_clients WHERE client_id = ? LIMIT 1`)
    .bind(n.client_id).first()
  if (exists) return res({ error: 'client_id already exists', code: 'CLIENT_ID_TAKEN' }, 409)

  // P1-15：先寫 hash-chain，失敗拒建
  try {
    await appendAuditLog(env.chiyigo_db, {
      admin_id:     Number(user.sub),
      admin_email:  user.email,
      action:       'oauth_client.create',
      target_id:    0,
      target_email: `oauth_client:${n.client_id}`,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  await env.chiyigo_db
    .prepare(`
      INSERT INTO oauth_clients (
        client_id, client_name, app_type,
        allowed_redirect_uris, allowed_scopes,
        post_logout_redirect_uris, frontchannel_logout_uris,
        backchannel_logout_uri, cors_origins, aud,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `)
    .bind(
      n.client_id, n.client_name, n.app_type,
      n.allowed_redirect_uris, n.allowed_scopes,
      n.post_logout_redirect_uris, n.frontchannel_logout_uris,
      n.backchannel_logout_uri, n.cors_origins, n.aud,
    )
    .run()

  // cache invalidate：下次 middleware refresh 立即讀到新 RP
  await invalidateClientsCache(env)

  await safeUserAudit(env, {
    event_type: 'admin.oauth_client.created', severity: 'critical',
    user_id: Number(user.sub), request,
    data: { client_id: n.client_id, app_type: n.app_type, aud: n.aud },
  })

  return res({ message: 'Client created', client_id: n.client_id }, 201)
}
