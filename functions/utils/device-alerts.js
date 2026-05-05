/**
 * Phase D-4 — 異常裝置警示
 *
 * 兩種偵測：
 *  1. 新裝置首次登入  → audit critical（→ Discord）+ email
 *  2. 跨國 IP 跳變    → audit critical（→ Discord，**不寄 email**，VPN 誤報率太高）
 *
 * 觸發點：4 個 login 入口（local/login、2fa/verify、oauth/callback、webauthn/login-verify）
 * 在 INSERT refresh_tokens 之後 + safeUserAudit('auth.login.success') 之後 fire-and-forget。
 *
 * 設計：
 *  - 整支 fire-and-forget：任何錯誤都吞掉，絕不擋登入主流程
 *  - request.cf.country 在 production 才有，integration test 環境 `request.cf` undefined
 *    → country jump 直接 skip（不誤報）
 *  - web (device_uuid IS NULL) 跳過新裝置偵測（一個 user 可能在 N 台電腦開瀏覽器，全標新裝置等於 spam）
 *  - 第一次登入（總 refresh_tokens=1）跳過新裝置偵測（剛註冊不算新裝置）
 *  - country jump 比對「上一筆 auth.login.success」audit_log；要 work 必須讓
 *    login.success audit 帶 country（4 個入口的 audit data 加 country）
 */

import { safeUserAudit } from './user-audit.js'
import { sendNewDeviceAlertEmail } from './email.js'

/**
 * 主入口。caller 一律 fire-and-forget：
 *
 *   safeAlertAnomalies(env, request, { userId, email, deviceUuid })
 *     // 不需 await；handler 已經要 return 了
 *
 * 但 Cloudflare Workers 對未 await 的 fetch 會 kill；推薦呼叫前 await，整支已 try/catch
 * 包好不會擲。
 */
export async function safeAlertAnomalies(env, request, { userId, email, deviceUuid }) {
  if (!env?.chiyigo_db || !userId) return
  await Promise.allSettled([
    checkNewDevice(env, request, userId, email, deviceUuid ?? null),
    checkCountryJump(env, request, userId, email),
  ])
}

async function checkNewDevice(env, request, userId, email, deviceUuid) {
  if (!deviceUuid) return  // web → 跳過
  try {
    const row = await env.chiyigo_db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN device_uuid = ? THEN 1 ELSE 0 END) AS same_device
       FROM refresh_tokens WHERE user_id = ?`,
    ).bind(deviceUuid, userId).first()

    const total      = Number(row?.total ?? 0)
    const sameDevice = Number(row?.same_device ?? 0)

    // 第一次登入（剛 INSERT 那筆即 total=1） → 不算新裝置
    if (total <= 1) return
    // 此 device_uuid 之前出現過（>=2 筆，含剛 INSERT） → 不是新
    if (sameDevice > 1) return
    // total>1 且 sameDevice==1 → 確實是新裝置

    const country = request?.cf?.country ?? null
    await safeUserAudit(env, {
      event_type: 'auth.new_device',
      severity:   'critical',
      user_id:    userId,
      request,
      data: {
        device_uuid_prefix: String(deviceUuid).slice(0, 8),
        country,
      },
    })

    if (env.RESEND_API_KEY && email) {
      try {
        await sendNewDeviceAlertEmail(env.RESEND_API_KEY, email, {
          deviceUuidPrefix: String(deviceUuid).slice(0, 8),
          country,
          when: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        }, env)
      } catch { /* swallow — email 失敗不擋登入 */ }
    }
  } catch { /* swallow */ }
}

async function checkCountryJump(env, request, userId, _email) {
  const currCountry = request?.cf?.country
  if (!currCountry) return  // 測試 / 本地環境沒 cf object
  try {
    // 撈最近 2 筆 auth.login.success；index 0 = 剛剛這次（caller 已寫 audit），
    // index 1 = 上一次。少於 2 筆就 skip（首登或舊資料沒 country）。
    const rs = await env.chiyigo_db.prepare(
      `SELECT event_data FROM audit_log
        WHERE user_id = ? AND event_type = 'auth.login.success'
        ORDER BY id DESC LIMIT 2`,
    ).bind(userId).all()

    const prev = rs.results?.[1]
    if (!prev?.event_data) return

    let prevCountry = null
    try { prevCountry = JSON.parse(prev.event_data)?.country ?? null } catch { return }
    if (!prevCountry || prevCountry === currCountry) return

    await safeUserAudit(env, {
      event_type: 'auth.country_jump',
      severity:   'critical',
      user_id:    userId,
      request,
      data: { from: prevCountry, to: currCountry },
    })
    // 不寄 email — VPN / 出國旅遊誤報率高，audit + Discord 即可
  } catch { /* swallow */ }
}
