/**
 * 統一限流工具：以 login_attempts 表為單一計數來源。
 *
 * 設計：
 *   - 同一張表 kind 區分用途（login / 2fa / email_send / oauth_init）
 *   - per-IP 或 per-user 由呼叫端決定（傳 user_id / ip 任一即可）
 *   - 寫入與讀取分離：呼叫端先 checkRateLimit() 拒否，handler 流程內任一失敗才 record()
 *   - 成功事件用 clearRateLimit() 清除（如 2FA 通過）
 *
 * 為何不用 KV / DO：
 *   - 既有 D1 schema 已有 login_attempts，引入 KV 等於兩套一致性模型
 *   - 2FA / email / oauth init 量級遠低於 KV 必要性的閾值（< 1k req/s）
 *   - DELETE...RETURNING / batch 原子保證在 D1 自然成立
 */

/**
 * 檢查指定 (kind, scope) 在 windowSeconds 內是否已超過 max 次。
 *
 * @param {D1Database} db
 * @param {object} opts
 * @param {string}        opts.kind          'login' | '2fa' | 'email_send' | 'oauth_init' | 'oauth_token' | 'refresh' | 'step_up'
 * @param {string|null}   opts.ip            null = 不以 ip 計數
 * @param {number|null}   opts.userId        null = 不以 user_id 計數
 * @param {string|null}   opts.email         null = 不以 email 計數（Phase E3 加，credential stuffing 防護用）
 * @param {number}        opts.windowSeconds 計數視窗（秒）
 * @param {number}        opts.max           上限（含），超過 → 拒絕
 * @returns {Promise<{ blocked: boolean, count: number }>}
 */
export async function checkRateLimit(db, { kind, ip = null, userId = null, email = null, windowSeconds, max }) {
  const where = ['kind = ?', `created_at > datetime('now', ?)`]
  const binds = [kind, `-${windowSeconds} seconds`]
  if (ip)     { where.push('ip = ?');      binds.push(ip) }
  if (userId) { where.push('user_id = ?'); binds.push(userId) }
  if (email)  { where.push('email = ?');   binds.push(email) }

  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM login_attempts WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first()

  const count = row?.cnt ?? 0
  return { blocked: count >= max, count }
}

/** 寫入一筆失敗記錄（kind 區分用途）。 */
export async function recordRateLimit(db, { kind, ip = null, userId = null, email = null }) {
  await db
    .prepare(`
      INSERT INTO login_attempts (kind, ip, email, user_id)
      VALUES (?, ?, ?, ?)
    `)
    .bind(kind, ip, email, userId)
    .run()
}

/** 清除指定 user 在指定 kind 的所有記錄（成功事件後呼叫）。 */
export async function clearRateLimit(db, { kind, userId = null, email = null }) {
  if (userId) {
    await db.prepare(`DELETE FROM login_attempts WHERE kind = ? AND user_id = ?`)
      .bind(kind, userId).run()
  } else if (email) {
    await db.prepare(`DELETE FROM login_attempts WHERE kind = ? AND email = ?`)
      .bind(kind, email).run()
  }
}
