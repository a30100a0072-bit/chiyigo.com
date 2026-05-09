/**
 * DELETE /api/admin/audit/:id
 *
 * Admin 清 audit_log 單筆。為了避免誤刪安全事件，只允許清「明確可清」的事件類型 —
 * 目前只有 requisition.deleted（刪需求單留下的痕跡，admin 判斷後可永久消除）。
 *
 * 認證：admin:audit scope + elevated:account step-up（兩段式高權限）
 *
 * 行為：刪除前必先寫 admin_audit_log（hash chain）留證；hash 寫失敗 → 拒刪 5xx，
 * 保護 evidence trail。再寫一筆 user-audit critical（觸發 Discord 告警）。
 */

import { res, requireStepUp } from '../../../utils/auth.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes.js'
import { appendAuditLog } from '../../../utils/audit-log.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

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

  // P0-4：刪前先寫 hash-chain admin_audit_log（防 admin 默默清痕跡）。
  // 任何寫失敗都當 5xx，不繼續刪 row。
  try {
    await appendAuditLog(env.chiyigo_db, {
      admin_id:     Number(stepCheck.user.sub),
      admin_email:  stepCheck.user.email,
      action:       'audit_log.delete',
      target_id:    id,
      target_email: `audit_log:${id}:${row.event_type}`,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch (e) {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  await env.chiyigo_db.prepare('DELETE FROM audit_log WHERE id = ?').bind(id).run()

  // critical user_audit（觸發 Discord webhook），方便即時看到 admin 在清痕跡
  await safeUserAudit(env, {
    event_type: 'admin.audit_log.deleted',
    severity: 'critical',
    user_id: Number(stepCheck.user.sub),
    request,
    data: { audit_id: id, event_type: row.event_type },
  })

  return res({ ok: true, id }, 200)
}
