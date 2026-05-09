/**
 * TOTP 驗證 + replay 防護（P1-6 / P1-8）
 *
 * 包一層 otpauth 的 TOTP.validate，並用 used_totp(user_id, slot) PK 確保
 * 同一 (user, slot) 一輩子只能消耗一次。window=±1 = 90s 內三個 slot；
 * 攻擊者偷到一組 6 位 code 在 60s 視窗內也無法重放。
 *
 * 用法：
 *   const r = await verifyTotpReplaySafe(env, {
 *     userId, secret: la.totp_secret, code: '123456'
 *   })
 *   if (!r.ok) {
 *     // r.reason: 'invalid' | 'replay' | 'bad_format'
 *   }
 *
 * Migration 0035 後可用。沒套 migration → INSERT 會 throw → 視為 invalid（保守）。
 */

import { TOTP, Secret } from 'otpauth'

const PERIOD_SEC = 30
const DIGITS     = 6

export async function verifyTotpReplaySafe(env, { userId, secret, code, window = 1 }) {
  const sanitized = String(code ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(sanitized)) return { ok: false, reason: 'bad_format' }

  const totp = new TOTP({
    algorithm: 'SHA1', digits: DIGITS, period: PERIOD_SEC,
    secret: Secret.fromBase32(secret),
  })
  const delta = totp.validate({ token: sanitized, window })
  if (delta === null) return { ok: false, reason: 'invalid' }

  const currentSlot = Math.floor(Date.now() / 1000 / PERIOD_SEC)
  const matchedSlot = currentSlot + delta

  // INSERT (user_id, slot) — PK 衝突 = 同一 slot 已被消耗 = replay
  try {
    await env.chiyigo_db
      .prepare(`INSERT INTO used_totp (user_id, slot) VALUES (?, ?)`)
      .bind(userId, matchedSlot)
      .run()
  } catch (e) {
    // SQLITE_CONSTRAINT — 視為 replay。其他 DB 錯誤也保守當失敗（不放行）
    return { ok: false, reason: 'replay' }
  }

  return { ok: true, slot: matchedSlot }
}
