/**
 * POST /api/requisition
 * Header: Authorization: Bearer <access_token>
 *
 * 提交接案需求單（登入選填，訪客可送）。
 * 限流（UTC+8）：登入用戶 10 單/日、訪客同 guest_id 5 單/日、每 IP 3 單/日。
 * 流程：驗 JWT（選填）→ 主限流 → IP 限流 → INSERT → 發 TG → UPDATE tg_message_id
 * 訪客 guest_id：body.guest_id 或 X-Device-Id header（前端 chiyigo.device_uuid），
 * 寫入 owner_guest_id 供註冊時 takeover；無 guest_id 時退回純 IP 限流。
 */

import { requireAuth, res } from '../utils/auth'

const REQUIRED = ['name', 'contact', 'service_type', 'message']

const SERVICE_TYPES = ['system', 'web', 'game', 'integration', 'interactive', 'branding', 'marketing', 'other']
const BUDGETS       = ['under30k', '30k-80k', '80k-200k', '200k-1m', 'flexible']
const TIMELINES     = ['asap', '1-3m', '3-6m', 'flexible']

function validate(body: Record<string, string | undefined>) {
  for (const key of REQUIRED) {
    if (!body[key]?.trim()) return `Missing field: ${key}`
  }
  const v = body.contact.trim()
  const isEmail = /.+@.+\..+/.test(v)
  const isPhone = /^09\d{8}$/.test(v)
  const isLine  = /^[a-zA-Z0-9._\-@]{4,}$/.test(v)
  if (!isEmail && !isPhone && !isLine) return 'Invalid contact format'
  if (body.name.trim().length > 50) return 'Name too long'
  if (body.contact.trim().length > 100) return 'Contact too long'
  if (body.company && body.company.length > 100) return 'Company too long'
  if (body.message.length > 2000) return 'Message too long'
  if (!SERVICE_TYPES.includes(body.service_type.trim())) return 'Invalid service_type'
  if (body.budget && !BUDGETS.includes(body.budget.trim())) return 'Invalid budget'
  if (body.timeline && !TIMELINES.includes(body.timeline.trim())) return 'Invalid timeline'
  return null
}

function escapeTgHtml(s: unknown) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

async function sendTelegram(env: Env, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
        }),
      }
    )
    const data = await r.json()
    return data.ok ? (data.result?.message_id ?? null) : null
  } catch {
    return null
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // ── 1. Auth optional（訪客不需登入即可提單）─────────────────
  let userId = null
  const authHeader = request.headers.get('Authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const { user, error } = await requireAuth(request, env)
    if (!error && user) userId = Number(user.sub)
  }

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const err = validate(body)
  if (err) return res({ error: err, code: 'INVALID_REQUISITION_BODY' }, 422)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  // 訪客 guest_id：優先取 body，其次 X-Device-Id header；格式 web-<uuid>
  let guestId = null
  if (userId === null) {
    const candidate = (body.guest_id || request.headers.get('X-Device-Id') || '').trim()
    if (/^web-[0-9a-f-]{36}$/i.test(candidate)) guestId = candidate
  }

  // ── 2a. 主限流：登入用戶 10 單/日；同 guest_id 訪客 5 單/日 ────
  // 無 guest_id 訪客（無 localStorage 環境）僅靠 2b 的 per-IP 3 單/日鎖
  let countRow = null
  if (userId !== null) {
    countRow = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM requisition
      WHERE user_id = ?
        AND date(created_at, '+8 hours') = date('now', '+8 hours')
        AND deleted_at IS NULL
    `).bind(userId).first()
  } else if (guestId) {
    countRow = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM requisition
      WHERE owner_guest_id = ?
        AND date(created_at, '+8 hours') = date('now', '+8 hours')
        AND deleted_at IS NULL
    `).bind(guestId).first()
  }

  const dayLimit = userId !== null ? 10 : 5
  if (countRow && (countRow.cnt ?? 0) >= dayLimit)
    return res({ error: '今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們', code: 'REQUISITION_DAILY_LIMIT' }, 429)

  // ── 2b. 每 IP 限流：3 單/日（防單一機器人耗光訪客全域配額）──
  if (ip) {
    const ipRow = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM requisition
      WHERE source_ip = ?
        AND date(created_at, '+8 hours') = date('now', '+8 hours')
        AND deleted_at IS NULL
    `).bind(ip).first()
    if ((ipRow?.cnt ?? 0) >= 3)
      return res({ error: '今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們', code: 'REQUISITION_DAILY_LIMIT' }, 429)
  }

  try {
    // ── 3. INSERT 基本資料 ────────────────────────────────────
    const { meta } = await db
      .prepare(`
        INSERT INTO requisition
          (user_id, owner_user_id, owner_guest_id, name, company, contact, service_type, budget, timeline, message, source_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        userId,
        userId,
        guestId,
        body.name.trim(),
        body.company?.trim()  ?? '',
        body.contact.trim(),
        body.service_type.trim(),
        body.budget?.trim()   ?? '',
        body.timeline?.trim() ?? '',
        body.message.trim(),
        ip
      )
      .run()

    const reqId = meta.last_row_id

    // ── 4. 發送 Telegram，取得 message_id（使用者輸入須 escape 防 HTML 注入）──
    const E = escapeTgHtml
    const tgText =
      `📥 <b>新諮詢通知</b>  #${reqId}\n\n` +
      `👤 <b>姓名：</b>${E(body.name)}\n` +
      `📱 <b>聯絡：</b>${E(body.contact)}\n` +
      `🏢 <b>公司：</b>${E(body.company || '未填')}\n` +
      `🛠 <b>需求：</b>${E(body.service_type)}\n` +
      `💰 <b>預算：</b>${E(body.budget || '未填')}\n` +
      `⏱ <b>時程：</b>${E(body.timeline || '未填')}\n` +
      `📝 <b>簡述：</b>\n${E(body.message)}`

    const tgMessageId = await sendTelegram(env, tgText)

    // ── 5. 寫回 tg_message_id ─────────────────────────────────
    if (tgMessageId) {
      await db
        .prepare('UPDATE requisition SET tg_message_id = ? WHERE id = ?')
        .bind(tgMessageId, reqId)
        .run()
    }

    return res({ success: true, id: reqId }, 201)
  } catch {
    return res({ error: 'Server error', code: 'INTERNAL_ERROR' }, 500)
  }
}
