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
 * 並發保證（migration 0045，2026-05-23）：
 *   admin_audit_log.prev_hash 上有 UNIQUE INDEX (idx_admin_audit_prev_hash_unique)。
 *   兩個 concurrent writer 算到同 prev_hash 時，第二個 INSERT 觸發 UNIQUE 衝突。
 *   appendAuditLog (本檔) 內建 CAS retry loop 在衝突時 re-SELECT + 重算 + 重 INSERT，
 *   caller 無感；prepareAppendAuditLog 保持 single-shot，UNIQUE 衝突 propagate
 *   到 batch caller (admin/audit/[id].ts DELETE) 由其既有 catch → 500 回覆。
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
 * 準備一筆 admin_audit_log INSERT，回傳 D1PreparedStatement 但不執行。
 *
 * 用於要把 audit-log INSERT 與其他寫入綁進同一個 db.batch() 的場景
 * （admin/audit/[id] DELETE atomicity）。SELECT prev_hash 仍在 batch 外發生，
 * 但 UNIQUE INDEX on prev_hash (migration 0045) 保證 race 衝突會在 batch 執行時
 * 以 UNIQUE constraint failure 顯式失敗，不會 silently 寫出兩列同 prev_hash。
 * Batch caller 收到失敗時應回 500 讓 admin 重送（不適合 batch 內 retry —
 * 重新算 hash 後 batch 內其他 statement 的綁定可能也需要重做）。
 */
export async function prepareAppendAuditLog(db, entry) {
  const lastRow = await db
    .prepare('SELECT row_hash FROM admin_audit_log ORDER BY id DESC LIMIT 1')
    .first()
  const prevHash = lastRow?.row_hash ?? GENESIS_HASH

  const createdAt = new Date()
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19)

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

  const statement = db
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

  return { statement, prevHash, rowHash, createdAt }
}

/**
 * 寫入一筆 admin_audit_log，自動串接 hash chain。CAS race-safe via UNIQUE INDEX
 * on prev_hash (migration 0045) + retry loop。
 *
 * entry: { admin_id, admin_email, action, target_id, target_email, ip_address }
 */
const CAS_MAX_RETRIES = 5
const CAS_BASE_DELAY_MS = 5

export async function appendAuditLog(db, entry) {
  let lastErr
  for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
    try {
      const prepared = await prepareAppendAuditLog(db, entry)
      await prepared.statement.run()
      return { prevHash: prepared.prevHash, rowHash: prepared.rowHash, createdAt: prepared.createdAt }
    } catch (err) {
      if (!isUniquePrevHashError(err)) throw err
      lastErr = err
      if (attempt < CAS_MAX_RETRIES - 1) {
        // exponential backoff with jitter: 5 + 15 + 35 + 75 ~= 130ms 總預算
        const delayMs = (1 << attempt) * CAS_BASE_DELAY_MS + Math.floor(Math.random() * CAS_BASE_DELAY_MS)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  throw new Error(`audit_log append: CAS retry exhausted after ${CAS_MAX_RETRIES} attempts: ${lastErr?.message ?? 'unknown'}`)
}

/**
 * 嚴格 regex 匹配 SQLite UNIQUE 衝突在 admin_audit_log.prev_hash 上的錯誤訊息。
 * 同 user-audit.ts:109 慣例同時看 e.message 與 e.cause.message（D1 有時把底層
 * SQLite 錯誤包在 cause 裡，外層只是泛用 'D1_ERROR'）。
 * 嚴格限定欄位避免捕捉到不相關的 UNIQUE 違例（防呆）。
 */
export function isUniquePrevHashError(err) {
  if (!err) return false
  const msg = [err?.message, err?.cause?.message].filter(Boolean).join('\n')
  return /UNIQUE constraint failed:\s*admin_audit_log\.prev_hash/i.test(msg)
}

/**
 * 從頭驗證整條 hash chain。
 *
 * brokenAt: 第一筆 hash 不符的 id，valid=true 時為 null
 */
export async function verifyAuditChain(db): Promise<{
  valid: boolean,
  total: number,
  brokenAt: number | null,
  reason: string | null,
}> {
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
