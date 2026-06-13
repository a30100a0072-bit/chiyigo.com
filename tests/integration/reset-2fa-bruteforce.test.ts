/**
 * SEC-RESET-2FA-BF — pre-fix RED repro（窗內修第二顆）
 *
 * 鎖定 EXACT failure mode：reset-password 的 TOTP 第二因子驗證
 *  - pre-fix：失敗不消耗 token + 無 rate-limit + 無 audit → 同 token 在 1h TTL 內可無限暴破 ~333k 碼
 *  - post-fix：per-user reset_2fa 節流（5/5min→429）+ TOTP 失敗計數 + audit
 *
 * 對照：backup_code path 本就 atomic 消耗 token（單發），非本 finding 範圍。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { onRequestPost as resetPost } from '../../functions/api/auth/local/reset-password'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedResetToken, enableTotp, callFunction, jsonPost } from './_helpers'

const URL_RESET = 'http://localhost/api/auth/local/reset-password'
const TEST_SECRET = 'JBSWY3DPEHPK3PXP'

function liveOtp(base32: string) {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(base32) }).generate()
}

describe('SEC-RESET-2FA-BF: reset-password TOTP brute-force bound + audit', () => {
  beforeAll(resetDb)
  beforeEach(resetDb)

  it('6 連發錯 TOTP（同 token）→ 第 6 次 429（pre-fix 全 401＝無限暴破）；429 不消耗 token', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const token = await seedResetToken(u.id)
    let last = 0
    for (let i = 0; i < 6; i++) {
      const res = await callFunction(resetPost, jsonPost(URL_RESET, {
        token, new_password: 'BrandNew#9876', totp_code: '000000',
      }))
      last = res.status
    }
    expect(last).toBe(429)   // pre-fix: 401（無節流）
    // 被節流的請求不該 burn reset token（user 過窗後仍可用）
    const tok = await env.chiyigo_db
      .prepare(`SELECT used_at FROM email_verifications WHERE user_id = ? AND token_type='reset_password'`)
      .bind(u.id).first()
    expect(tok.used_at).toBeNull()
  })

  it('1 次錯 TOTP → 寫 account.password.reset.totp_fail audit（pre-fix 零稽核）', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876', totp_code: '000000',
    }))
    expect(res.status).toBe(401)
    const audit = await env.chiyigo_db
      .prepare(`SELECT 1 FROM audit_log WHERE event_type = 'account.password.reset.totp_fail' AND user_id = ?`)
      .bind(u.id).first()
    expect(audit).toBeTruthy()   // pre-fix: 無 row
  })

  it('cap 邊界：4 次錯後第 5 次帶正確 TOTP 仍 200（未越界不誤擋合法 user）', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const token = await seedResetToken(u.id)
    for (let i = 0; i < 4; i++) {
      const r = await callFunction(resetPost, jsonPost(URL_RESET, {
        token, new_password: 'BrandNew#9876', totp_code: '000000',
      }))
      expect(r.status).toBe(401)
    }
    const ok = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876', totp_code: liveOtp(TEST_SECRET),
    }))
    expect(ok.status).toBe(200)
  })
})
