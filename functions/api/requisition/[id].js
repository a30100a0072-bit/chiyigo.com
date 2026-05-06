/**
 * GET    /api/requisition/:id  → 看自己單的完整明細
 * DELETE /api/requisition/:id  → 永久刪除（僅 status='revoked' 自己的單）
 *
 * 硬刪保留 audit_log 一筆 requisition.deleted（user_id + id），admin
 * 之後可在後台兩段式清理 audit row 本身。
 */

import { requireAuth, res } from '../../utils/auth.js'
import { safeUserAudit } from '../../utils/user-audit.js'

export async function onRequestGet({ request, env, params }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404)
  const userId = Number(user.sub)

  const row = await env.chiyigo_db
    .prepare(`
      SELECT id, name, contact, company, service_type, budget, timeline,
             message, status, created_at, deleted_at
      FROM   requisition
      WHERE  id = ? AND user_id = ?
    `)
    .bind(id, userId).first()

  if (!row) return res({ error: 'not_found' }, 404)

  // 串付款狀態：requisition_id FK（P0-3，2026-05-06）
  const payQuery = await env.chiyigo_db
    .prepare(`
      SELECT id, vendor, status, amount_subunit, currency, created_at
      FROM   payment_intents
      WHERE  user_id = ? AND requisition_id = ?
      ORDER  BY id DESC
      LIMIT  20
    `)
    .bind(userId, id).all()

  return res({ ...row, linked_payments: payQuery.results ?? [] }, 200)
}

export async function onRequestDelete({ request, env, params }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404)
  const userId = Number(user.sub)

  const row = await env.chiyigo_db
    .prepare('SELECT id, status FROM requisition WHERE id = ? AND user_id = ?')
    .bind(id, userId).first()

  if (!row) return res({ error: 'not_found' }, 404)
  if (row.status !== 'revoked') {
    return res({ error: 'must_revoke_first', code: 'MUST_REVOKE_FIRST', status: row.status }, 403)
  }

  await env.chiyigo_db
    .prepare('DELETE FROM requisition WHERE id = ? AND user_id = ?')
    .bind(id, userId).run()

  await safeUserAudit(env, {
    event_type: 'requisition.deleted', severity: 'info',
    user_id: userId, request,
    data: { requisition_id: id, actor: 'user' },
  })

  return res({ ok: true, id }, 200)
}
