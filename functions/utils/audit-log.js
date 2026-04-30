/**
 * Admin audit log — append-only hash chain（防竄改）
 *
 * row_hash = SHA-256( prev_hash || canonical(row) )
 *   prev_hash：前一筆的 row_hash（首筆 = '0' * 64）
 *   canonical(row)：固定欄位順序的 JSON
 *
 * 任何中間列被改 → 該列 row_hash 不符 → 後續每一筆 prev_hash 都不再 reproducible，
 * verifyAuditChain() 會回報第一個 break 點。
 *
 * 寫入流程：append() 一次完成「取上一筆 hash → 計算 hash → INSERT」，
 * 用 db.batch 把 SELECT 與 INSERT 分開但同一進程，
 * D1 同 worker 同步行為下無 race（admin 操作 QPS 極低）。
 */

const GENESIS_HASH = '0'.repeat(64)

// ── 雜湊工具 ────────────────────────────────────────────────────

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * canonical(row)：固定欄位順序，JSON.stringify 不可信，需手寫保證 key 順序。
 */
function canonicalize(row) {
  const ordered = {
    admin_id:     row.admin_id,
    admin_email:  row.admin_email,
    action:       row.action,
    target_id:    row.target_id,
    target_email: row.target_email,
    ip_address:   row.ip_address ?? null,
    created_at:   row.created_at,
  }
  return JSON.stringify(ordered)
}

async function computeRowHash(prevHash, row) {
  return sha256Hex(prevHash + canonicalize(row))
}

// ── 公開 API ────────────────────────────────────────────────────

/**
 * 寫入一筆 admin_audit_log，自動串接 hash chain。
 *
 * @param {D1Database} db
 * @param {object} entry  { admin_id, admin_email, action, target_id, target_email, ip_address }
 */
export async function appendAuditLog(db, entry) {
  // 1. 取最後一筆的 row_hash 作為 prev_hash
  const lastRow = await db
    .prepare('SELECT row_hash FROM admin_audit_log ORDER BY id DESC LIMIT 1')
    .first()
  const prevHash = lastRow?.row_hash ?? GENESIS_HASH

  // 2. 用「現在時間」當 created_at（與 INSERT 時的 datetime('now') 對齊）
  // 為了 hash 可重現，必須先把這個時間鎖定，再用同一字串寫入 DB
  const createdAt = new Date()
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19) // 'YYYY-MM-DD HH:MM:SS' 與 SQLite datetime('now') 同格式

  const row = {
    admin_id:     entry.admin_id,
    admin_email:  entry.admin_email,
    action:       entry.action,
    target_id:    entry.target_id,
    target_email: entry.target_email,
    ip_address:   entry.ip_address ?? null,
    created_at:   createdAt,
  }
  const rowHash = await computeRowHash(prevHash, row)

  // 3. INSERT — created_at 顯式寫入（取代欄位 default），確保與 hash 計算用的值一致
  await db
    .prepare(`
      INSERT INTO admin_audit_log
        (admin_id, admin_email, action, target_id, target_email, ip_address, created_at, prev_hash, row_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      row.admin_id, row.admin_email, row.action,
      row.target_id, row.target_email, row.ip_address,
      row.created_at, prevHash, rowHash,
    )
    .run()

  return { prevHash, rowHash, createdAt }
}

/**
 * 從頭驗證整條 hash chain。
 *
 * @param {D1Database} db
 * @returns {{
 *   valid: boolean,
 *   total: number,
 *   brokenAt: number|null,   // 第一筆 hash 不符的 id，valid=true 時為 null
 *   reason:   string|null,
 * }}
 */
export async function verifyAuditChain(db) {
  const { results } = await db
    .prepare(`
      SELECT id, admin_id, admin_email, action, target_id, target_email,
             ip_address, created_at, prev_hash, row_hash
      FROM admin_audit_log
      ORDER BY id ASC
    `)
    .all()

  let prev = GENESIS_HASH
  for (const row of results ?? []) {
    if (row.prev_hash !== prev) {
      return { valid: false, total: results.length, brokenAt: row.id, reason: 'prev_hash mismatch' }
    }
    const expected = await computeRowHash(prev, row)
    if (expected !== row.row_hash) {
      return { valid: false, total: results.length, brokenAt: row.id, reason: 'row_hash mismatch' }
    }
    prev = row.row_hash
  }
  return { valid: true, total: results?.length ?? 0, brokenAt: null, reason: null }
}

export const _internal = { GENESIS_HASH, sha256Hex, canonicalize, computeRowHash }
