/**
 * DELETE /api/admin/audit/:id
 *
 * Admin 清 audit_log 單筆。為了避免誤刪安全事件，只允許清「明確可清」的事件類型 —
 * 目前只有 requisition.deleted（刪需求單留下的痕跡，admin 判斷後可永久消除）。
 *
 * 認證：admin:audit scope + elevated:account step-up（兩段式高權限）
 *
 * 行為：硬刪 audit_log row 本體。不再記新 audit（避免越清越多 row）。
 */

import { res, requireStepUp } from '../../../utils/auth.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes.js'

const DELETABLE_EVENTS = new Set(['requisition.deleted'])

export async function onRequestDelete({ request, env, params }) {
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'delete_audit')
  if (stepCheck.error) return stepCheck.error

  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_AUDIT)) {
    return res({ error: 'admin:audit scope required' }, 403)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404)

  const row = await env.chiyigo_db
    .prepare('SELECT id, event_type FROM audit_log WHERE id = ?')
    .bind(id).first()
  if (!row) return res({ error: 'not_found' }, 404)

  if (!DELETABLE_EVENTS.has(row.event_type)) {
    return res({
      error: 'event_type_not_deletable',
      code: 'EVENT_NOT_DELETABLE',
      event_type: row.event_type,
      allowed: [...DELETABLE_EVENTS],
    }, 403)
  }

  await env.chiyigo_db.prepare('DELETE FROM audit_log WHERE id = ?').bind(id).run()
  return res({ ok: true, id }, 200)
}
