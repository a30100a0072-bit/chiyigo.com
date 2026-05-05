/**
 * WebAuthn / Passkeys helpers（Phase D-2）
 *
 * - RP 設定來源：env（WEBAUTHN_RP_ID / WEBAUTHN_RP_NAME / WEBAUTHN_ORIGINS）
 *   缺值用 production 預設；CI / 整合測試會用 wrangler vars 蓋掉。
 * - challenge 暫存：D1 webauthn_challenges 表（5 分鐘 TTL，consume 後立刻刪），
 *   不放 KV 是因為單戶頻率極低且 D1 已是 source of truth。
 *
 * Origin 處理：
 *   WebAuthn ceremony 是綁 origin（含 scheme + host[:port]），不只 host。
 *   IAM 站本體 = chiyigo.com，但 staging/PR preview/localhost dev 都會用，
 *   所以 expectedOrigin 走 array。verify lib 接受 string | string[] | (origin) => bool。
 */

const DEFAULT_RP_ID      = 'chiyigo.com'
const DEFAULT_RP_NAME    = 'Chiyigo'
const DEFAULT_ORIGINS    = ['https://chiyigo.com']
const CHALLENGE_TTL_SEC  = 5 * 60  // 5 分鐘

export function getRpConfig(env) {
  const rpID    = env?.WEBAUTHN_RP_ID   || DEFAULT_RP_ID
  const rpName  = env?.WEBAUTHN_RP_NAME || DEFAULT_RP_NAME
  const origins = (env?.WEBAUTHN_ORIGINS
    ? String(env.WEBAUTHN_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS)
  return { rpID, rpName, expectedOrigin: origins }
}

/**
 * 寫入 challenge。caller 負責產 challenge（SimpleWebAuthn 會回 base64url）。
 * ttlSec 預設 300；同 challenge 重複插入會撞 UNIQUE，理論上極不可能（隨機 32 byte）。
 */
export async function saveChallenge(env, { challenge, user_id = null, ceremony }) {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SEC * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(
      `INSERT INTO webauthn_challenges (challenge, user_id, ceremony, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(challenge, user_id, ceremony, expiresAt)
    .run()
}

/**
 * 一次性消耗 challenge（atomic：先 SELECT 拿值再 DELETE）。
 *  - 已過期 → 視為不存在
 *  - ceremony 不符 → 視為不存在（不要洩漏細節）
 *  - 找不到 / 已被消耗 → 回 null
 *
 * D1 不支援 RETURNING with DELETE 還沒穩定到能依賴，這裡兩步走 + 競態下最多
 * 同 challenge 被驗兩次，但驗證階段還會比對 publicKey + counter，安全性不破。
 */
export async function consumeChallenge(env, { challenge, ceremony }) {
  const row = await env.chiyigo_db
    .prepare(
      `SELECT challenge, user_id, ceremony, expires_at
         FROM webauthn_challenges
        WHERE challenge = ? AND ceremony = ? AND expires_at > datetime('now')`,
    )
    .bind(challenge, ceremony)
    .first()
  if (!row) return null
  // fire and forget delete — 失敗不擋驗證流程，DB 上 5 分鐘後也會被視為過期
  await env.chiyigo_db
    .prepare(`DELETE FROM webauthn_challenges WHERE challenge = ?`)
    .bind(challenge).run()
  return row
}

/**
 * 撈某 user 既有的 credentials（excludeCredentials / allowCredentials 都會用到）。
 * transports 欄位是 JSON array 字串 → parse 回來給 lib。
 */
export async function listUserCredentials(env, userId) {
  const rs = await env.chiyigo_db
    .prepare(
      `SELECT credential_id, transports
         FROM user_webauthn_credentials
        WHERE user_id = ?`,
    )
    .bind(userId)
    .all()
  return (rs.results ?? []).map(r => ({
    id: r.credential_id,
    transports: parseTransports(r.transports),
  }))
}

function parseTransports(raw) {
  if (!raw) return undefined
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : undefined
  } catch { return undefined }
}
