/**
 * POST /api/requisition
 * Header: Authorization: Bearer <access_token>
 *
 * 提交接案需求單（登入選填，訪客可送）。
 * 限流（UTC+8）：登入用戶 10 單/日、訪客 5 單/日（全域）、每 IP 3 單/日。
 * 流程：驗 JWT（選填）→ 主限流 → IP 限流 → INSERT → 發 TG → UPDATE tg_message_id
 */

import { requireAuth, res } from '../utils/auth.js'

const REQUIRED = ['name', 'contact', 'service_type', 'message']

const SERVICE_TYPES = ['system', 'web', 'game', 'integration', 'interactive', 'branding', 'marketing', 'other']
const BUDGETS       = ['under30k', '30k-80k', '80k-200k', '200k-1m', 'flexible']
const TIMELINES     = ['asap', '1-3m', '3-6m', 'flexible']

function validate(body) {
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

function escapeTgHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
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
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  // ── 2a. 主限流：登入用戶 10 單/日；訪客全域 5 單/日 ──────────
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

  // ── 2b. 每 IP 限流：3 單/日（防單一機器人耗光訪客全域配額）──
  if (ip) {
    const ipRow = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM requisition
      WHERE source_ip = ?
        AND date(created_at, '+8 hours') = date('now', '+8 hours')
        AND deleted_at IS NULL
    `).bind(ip).first()
    if ((ipRow?.cnt ?? 0) >= 3)
      return res({ error: '今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們' }, 429)
  }

  try {
    // ── 3. INSERT 基本資料 ────────────────────────────────────
    const { meta } = await db
      .prepare(`
        INSERT INTO requisition
          (user_id, name, company, contact, service_type, budget, timeline, message, source_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        userId,
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
    return res({ error: 'Server error' }, 500)
  }
}
