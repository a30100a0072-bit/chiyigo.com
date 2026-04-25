/**
 * POST /api/requisition
 * Header: Authorization: Bearer <access_token>
 *
 * 提交接案需求單（需登入）。
 * 限流：每位用戶每日 (UTC+8) 最多 3 單。
 * 流程：驗 JWT → 限流檢查 → INSERT → 發 TG → UPDATE tg_message_id
 */

import { requireAuth, res } from '../utils/auth.js'

const REQUIRED = ['name', 'contact', 'service_type', 'message']

function validate(body) {
  for (const key of REQUIRED) {
    if (!body[key]?.trim()) return `Missing field: ${key}`
  }
  const v = body.contact.trim()
  const isEmail = /.+@.+\..+/.test(v)
  const isPhone = /^09\d{8}$/.test(v)
  const isLine  = /^[a-zA-Z0-9._\-@]{4,}$/.test(v)
  if (!isEmail && !isPhone && !isLine) return 'Invalid contact format'
  if (body.message.length > 2000) return 'Message too long'
  return null
}

async function sendTelegram(env, text) {
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

export async function onRequestPost({ request, env }) {
  // ── 1. Auth optional（訪客不需登入即可提單）─────────────────
  let userId = null
  const authHeader = request.headers.get('Authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const { user, error } = await requireAuth(request, env)
    if (!error && user) userId = Number(user.sub)
  }

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const err = validate(body)
  if (err) return res({ error: err }, 422)

  const db = env.chiyigo_db

  // ── 2. 限流：登入用戶 10 單/日；訪客全域 5 單/日 ─────────────
  const countRow = userId !== null
    ? await db.prepare(`
        SELECT COUNT(*) AS cnt FROM requisition
        WHERE user_id = ?
          AND date(created_at, '+8 hours') = date('now', '+8 hours')
          AND deleted_at IS NULL
      `).bind(userId).first()
    : await db.prepare(`
        SELECT COUNT(*) AS cnt FROM requisition
        WHERE user_id IS NULL
          AND date(created_at, '+8 hours') = date('now', '+8 hours')
          AND deleted_at IS NULL
      `).first()

  const dayLimit = userId !== null ? 10 : 5
  if ((countRow?.cnt ?? 0) >= dayLimit)
    return res({ error: '今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們' }, 429)

  try {
    // ── 3. INSERT 基本資料 ────────────────────────────────────
    const { meta } = await db
      .prepare(`
        INSERT INTO requisition
          (user_id, name, company, contact, service_type, budget, timeline, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        userId,
        body.name.trim(),
        body.company?.trim()  ?? '',
        body.contact.trim(),
        body.service_type.trim(),
        body.budget?.trim()   ?? '',
        body.timeline?.trim() ?? '',
        body.message.trim()
      )
      .run()

    const reqId = meta.last_row_id

    // ── 4. 發送 Telegram，取得 message_id ────────────────────
    const tgText =
      `📥 <b>新諮詢通知</b>  #${reqId}\n\n` +
      `👤 <b>姓名：</b>${body.name}\n` +
      `📱 <b>聯絡：</b>${body.contact}\n` +
      `🏢 <b>公司：</b>${body.company || '未填'}\n` +
      `🛠 <b>需求：</b>${body.service_type}\n` +
      `💰 <b>預算：</b>${body.budget || '未填'}\n` +
      `⏱ <b>時程：</b>${body.timeline || '未填'}\n` +
      `📝 <b>簡述：</b>\n${body.message}`

    const tgMessageId = await sendTelegram(env, tgText)

    // ── 5. 寫回 tg_message_id ─────────────────────────────────
    if (tgMessageId) {
      await db
        .prepare('UPDATE requisition SET tg_message_id = ? WHERE id = ?')
        .bind(tgMessageId, reqId)
        .run()
    }

    return res({ success: true, id: reqId }, 201)
  } catch (e) {
    console.error(e)
    return res({ error: 'Server error' }, 500)
  }
}
