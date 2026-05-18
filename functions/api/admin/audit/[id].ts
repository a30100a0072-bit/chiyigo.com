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

import { res, requireStepUp } from '../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
import { prepareAppendAuditLog } from '../../../utils/audit-log'
import { safeUserAudit } from '../../../utils/user-audit'

const DELETABLE_EVENTS = new Set(['requisition.deleted'])

export async function onRequestDelete({ request, env, params }) {
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'delete_audit')
  if (stepCheck.error) return stepCheck.error

  // P1-17：fine-grain admin:audit:write（DELETE 是 destructive，不能讓 read-only token 動）
  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_AUDIT_WRITE)) {
    return res({ error: 'admin:audit:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:audit:write' }, 403)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found', code: 'AUDIT_NOT_FOUND' }, 404)

  const row = await env.chiyigo_db
    .prepare('SELECT id, event_type FROM audit_log WHERE id = ?')
    .bind(id).first()
  if (!row) return res({ error: 'not_found', code: 'AUDIT_NOT_FOUND' }, 404)

  if (!DELETABLE_EVENTS.has(row.event_type)) {
    return res({
      error: 'event_type_not_deletable',
      code: 'EVENT_NOT_DELETABLE',
      event_type: row.event_type,
      allowed: [...DELETABLE_EVENTS],
    }, 403)
  }

  // P0-4 + codex F3：admin_audit_log INSERT 與 audit_log DELETE 綁在同一 D1 batch（atomic）。
  // DELETE 帶 event_type guard：若 row 在 SELECT 與 batch 之間被改/刪 → changes=0 → 409，
  // audit_log row 不刪；hash-chain 寫入的是「delete attempt」紀錄（同 batch 一起 commit），
  // 語意正確且 chain 仍 verifiable —— 不是「沒刪到卻寫了 hash-chain」的污染。
  let prepared
  try {
    prepared = await prepareAppendAuditLog(env.chiyigo_db, {
      admin_id:     Number(stepCheck.user.sub),
      admin_email:  stepCheck.user.email,
      action:       'audit_log.delete',
      target_id:    id,
      target_email: `audit_log:${id}:${row.event_type}`,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  const deleteStmt = env.chiyigo_db
    .prepare('DELETE FROM audit_log WHERE id = ? AND event_type = ?')
    .bind(id, row.event_type)

  let batchResults
  try {
    batchResults = await env.chiyigo_db.batch([prepared.statement, deleteStmt])
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  const deleteChanges = batchResults?.[1]?.meta?.changes ?? 0
  if (deleteChanges !== 1) {
    // race: SELECT 看到的 row 在 batch commit 前被別人刪/改了。
    // hash-chain 仍記下「admin 嘗試刪」的證據 — 這是正確行為。
    return res({ error: 'audit_row_changed_during_delete', code: 'AUDIT_RACE' }, 409)
  }

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
