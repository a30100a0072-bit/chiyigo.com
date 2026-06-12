/**
 * GET /api/admin/event-dlq — list dead-lettered domain events (EVT-001b).
 *
 * Companion read surface to POST /api/admin/event-dlq/:id/replay. Before this existed an admin had to query D1
 * directly to find a dlq id to replay; the cron run report now also surfaces blocked_backlog / dlq_unreplayed
 * (EVT-001a), and this endpoint lets an admin enumerate the actual rows.
 *
 * Gate (Codex Plan Gate r2): requireRole(admin) + admin:events:replay scope, NO step-up. Read-only and fully
 * redacted (stream_key -> sha256 hash, NO raw stream_key / data_json), so it does not need the one-time step-up jti
 * that the MUTATING replay requires. Per-user rate limit (admin_read bucket).
 *
 * Pagination (Codex r2 Code-Gate watch): deterministic ORDER BY id DESC; `before=<id>` -> `id < ?` (cursor key ==
 * sort key == the AUTOINCREMENT PK, a total order; never relies on implicit rowid). Response carries next_before
 * (the last row's id) for the next page.
 *
 * Redaction (INV-EVT-9): the DTO exposes stream_key_hash only; raw stream_key and data_json NEVER leave the DB.
 */
import { res } from '../../../utils/auth'
import { requireRole } from '../../../utils/requireRole'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
import { safeUserAudit } from '../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit'
import { hashToken } from '../../../utils/crypto'

const RL_WINDOW_SEC = 60
const RL_MAX = 60
const PAGE_MAX = 100

interface DlqRow {
  id: number; event_id: string; event_type: string; stream_key: string; stream_seq: number
  tenant_id: number | null; dlq_reason: string; attempts: number; last_error: string | null
  failed_at: string; replayed_at: string | null
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error
  const userId = Number(user.sub)

  if (!effectiveScopesFromJwt(user).has(SCOPES.ADMIN_EVENTS_REPLAY)) {
    return res({ error: 'admin:events:replay scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:events:replay' }, 403)
  }

  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'admin_read', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (rl.blocked) return res({ error: 'Too many requests; slow down', code: 'RATE_LIMITED' }, 429)
  await recordRateLimit(env.chiyigo_db, { kind: 'admin_read', userId })

  const url = new URL(request.url)
  const unreplayedOnly = url.searchParams.get('replayed') !== '1' // default: only unreplayed (the actionable set)
  const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const beforeRaw = url.searchParams.get('before')
  const before = beforeRaw !== null && /^\d+$/.test(beforeRaw) ? parseInt(beforeRaw, 10) : null

  const conds: string[] = []
  const binds: unknown[] = []
  if (unreplayedOnly) conds.push('replayed_at IS NULL')
  if (before !== null) { conds.push('id < ?'); binds.push(before) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const { results } = await env.chiyigo_db
    .prepare(
      `SELECT id, event_id, event_type, stream_key, stream_seq, tenant_id, dlq_reason, attempts, last_error,
              failed_at, replayed_at
         FROM event_dlq
         ${where}
        ORDER BY id DESC
        LIMIT ?`,
    )
    .bind(...binds, limit).all<DlqRow>()

  // D1Database resolves to any in this repo (no @cloudflare/workers-types), so .all<DlqRow>() is not typed -- annotate
  // the local to recover DlqRow on the .map callback (avoids an implicit-any param).
  const rowList: DlqRow[] = results ?? []
  // Redact per row: stream_key -> hash; last_error truncated; raw stream_key / data_json NEVER emitted.
  const rows = await Promise.all(rowList.map(async (r) => ({
    id: r.id,
    event_id: r.event_id,
    event_type: r.event_type,
    stream_seq: r.stream_seq,
    tenant_id: r.tenant_id,
    dlq_reason: r.dlq_reason,
    attempts: r.attempts,
    failed_at: r.failed_at,
    replayed_at: r.replayed_at,
    stream_key_hash: await hashToken(r.stream_key),
    last_error: r.last_error === null ? null : r.last_error.slice(0, 200),
  })))
  const nextBefore = rowList.length === limit ? rowList[rowList.length - 1].id : null

  await safeUserAudit(env, {
    event_type: 'domain.event.dlq_list', severity: 'info', user_id: userId, request,
    data: { unreplayed_only: unreplayedOnly, result_count: rows.length, before },
  })

  return res({ rows, next_before: nextBefore }, 200)
}
