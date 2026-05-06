/**
 * TG 訊息動態渲染（Phase F-2 wave 8）
 *
 * 緣起：requisition 從建立到成交經歷多個狀態（pending → refund_pending →
 *   revoked / deal / deleted），每次轉換 admin 在 TG 都要看到同一筆訊息更新到
 *   最新狀態，不要新增訊息洗版。所以 sendMessage 只發一次（建單時），之後都
 *   editMessageText 蓋掉。
 *
 * 此模組統一：
 *   1. 從 D1 撈 requisition + linked payment_intents 拼成完整快照
 *   2. 依狀態組訊息文字（含付款 / 退款金額）
 *   3. call editMessageText（沒 message_id 就 silently 跳過）
 *
 * 不在這裡做：
 *   - 第一次建單的 sendMessage（保留在 requisition.js，因為要拿 message_id）
 *   - audit log（caller 自己負責，這裡純做訊息）
 */

function escapeTgHtml(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

const STATUS_HEADER = {
  pending:        { icon: '📥', label: '新諮詢通知' },
  refund_pending: { icon: '⏳', label: '客戶申請退款，待 admin 審核' },
  revoked:        { icon: '❌', label: '客戶已撤銷此需求單' },
  deal:           { icon: '✅', label: '客戶已成交（存入成交資料庫）' },
  deleted:        { icon: '🗑', label: 'Admin 已刪除此需求單' },
}

const PAYMENT_STATUS_LABEL = {
  pending:    '等待付款',
  processing: '處理中',
  succeeded:  '✅ 已收款',
  failed:     '❌ 失敗',
  canceled:   '已取消',
  refunded:   '↩️ 已退款',
}

/**
 * 撈 requisition + linked payment intents，組訊息字串。
 * @param {object} env
 * @param {number} reqId
 * @param {string} [overrideStatus] 例如刪除時 row 已不存在，由 caller 帶入 'deleted'
 * @returns {Promise<{tg_message_id: number|null, text: string} | null>}
 */
export async function buildRequisitionTgText(env, reqId, overrideStatus) {
  const db = env.chiyigo_db
  if (!db) return null
  const row = await db
    .prepare(`SELECT id, name, company, contact, service_type, budget, timeline,
                     message, status, tg_message_id
                FROM requisition WHERE id = ?`)
    .bind(reqId).first()
  if (!row && overrideStatus !== 'deleted') return null

  const status = overrideStatus || row?.status || 'pending'
  const head   = STATUS_HEADER[status] || STATUS_HEADER.pending
  const E      = escapeTgHtml

  // 撈關聯 payment_intents（user-side metadata.requisition_id = reqId）
  const reqIdStr  = `"requisition_id":${reqId}`
  const reqIdStr2 = `"requisition_id":"${reqId}"`
  const paymentsRes = await db
    .prepare(`SELECT id, vendor, status, amount_subunit, currency, created_at
                FROM payment_intents
               WHERE metadata LIKE ? OR metadata LIKE ?
               ORDER BY id ASC`)
    .bind(`%${reqIdStr}%`, `%${reqIdStr2}%`).all()
  const payments = paymentsRes?.results ?? []

  // 主訊息
  const lines = [`${head.icon} <b>${head.label}</b>  #${reqId}`, '']
  if (row) {
    lines.push(`👤 <b>姓名：</b>${E(row.name)}`)
    lines.push(`📱 <b>聯絡：</b>${E(row.contact)}`)
    lines.push(`🏢 <b>公司：</b>${E(row.company || '未填')}`)
    lines.push(`🛠 <b>需求：</b>${E(row.service_type)}`)
    lines.push(`💰 <b>預算：</b>${E(row.budget || '未填')}`)
    lines.push(`⏱ <b>時程：</b>${E(row.timeline || '未填')}`)
    lines.push(`📝 <b>簡述：</b>\n${E(row.message)}`)
  }

  // 付款摘要
  if (payments.length) {
    let totalSucceeded = 0, totalRefunded = 0
    const detail = payments.map(p => {
      const amt = p.amount_subunit ?? 0
      if (p.status === 'succeeded') totalSucceeded += amt
      if (p.status === 'refunded')  totalRefunded += amt
      const lbl = PAYMENT_STATUS_LABEL[p.status] || p.status
      return `  • #${p.id} ${amt.toLocaleString()} ${E(p.currency || 'TWD')} — ${lbl}`
    }).join('\n')
    lines.push('')
    lines.push(`💳 <b>付款紀錄（${payments.length} 筆）</b>`)
    lines.push(detail)
    if (totalSucceeded || totalRefunded) {
      lines.push(`  ─ 已收款：${totalSucceeded.toLocaleString()} TWD${totalRefunded ? ` ／ 已退款：${totalRefunded.toLocaleString()} TWD` : ''}`)
    }
  }

  return {
    tg_message_id: row?.tg_message_id ?? null,
    text:          lines.join('\n'),
  }
}

/**
 * 觸發 editMessageText 把 TG 訊息更新到最新狀態。
 * 沒有 tg_message_id 或環境變數缺失就 noop（不報錯，避免影響主流程）。
 */
export async function syncRequisitionTgMessage(env, reqId, overrideStatus) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return
  const built = await buildRequisitionTgText(env, reqId, overrideStatus)
  if (!built || !built.tg_message_id) return
  try {
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    env.TELEGRAM_CHAT_ID,
          message_id: built.tg_message_id,
          text:       built.text,
          parse_mode: 'HTML',
        }),
      }
    )
  } catch { /* 連 TG 失敗不擋主流程 */ }
}
