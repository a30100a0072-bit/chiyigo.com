/**
 * POST /api/auth/wallet/verify
 * Header: Authorization: Bearer <access_token>
 * Body:   {
 *   message: string,    // 完整 SIWE message（前端用 nonce endpoint 回的值組）
 *   signature: string,  // wallet 簽出來的 0x...
 *   nickname?: string,  // 使用者命名（如「我的 MetaMask」）
 * }
 *
 * Phase F-3 — SIWE ceremony 第二步。
 *
 * 流程：
 *   1. 驗 access_token
 *   2. SIWE verify（lib spec correct，含 signature 對應 address / 時間 / domain）
 *   3. 一次性消耗 nonce（必須是這個 user 在 nonce endpoint 拿的）
 *   4. nonce.user_id 必須等於當前 user（防別人拿 nonce 來綁）
 *   5. nonce.address 必須等於 SIWE message 的 address（防換 address）
 *   6. INSERT user_wallets；UNIQUE 撞 → 409（並發或補綁）
 *   7. critical audit（綁定 wallet 是金流前置 — 可疑請告警）
 *
 * 回傳：
 *   200 → { id, address, chain_id, nickname, signed_at }
 *   400 → JSON 錯 / message 錯 / 簽章錯
 *   401 → access_token 無效 / nonce 不存在或已消耗 / 不屬於本 user
 *   409 → 已綁
 */

import { requireAuth, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { verifySiweMessage, consumeWalletNonce } from '../../../utils/siwe.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

const NICKNAME_MAX = 64

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error
  const userId = Number(user.sub)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400, cors) }

  const messageRaw = typeof body?.message === 'string' ? body.message : null
  const signature  = typeof body?.signature === 'string' ? body.signature : null
  const nickname   = typeof body?.nickname === 'string'
    ? body.nickname.slice(0, NICKNAME_MAX) : null

  if (!messageRaw || !signature) {
    return res({ error: 'message and signature are required' }, 400, cors)
  }

  // 1. SIWE 驗章
  const verifyResult = await verifySiweMessage(env, { messageRaw, signature })
  if (!verifyResult.ok) {
    await safeUserAudit(env, {
      event_type: 'wallet.bind.fail', severity: 'warn', user_id: userId, request,
      data: { reason: verifyResult.error },
    })
    return res({ error: 'Invalid SIWE signature', code: 'SIGNATURE_INVALID' }, 400, cors)
  }
  const { address, chainId, nonce } = verifyResult

  // 2. 一次性消耗 nonce（且必須 user_id 屬於我）
  const nonceRow = await consumeWalletNonce(env, nonce)
  if (!nonceRow) {
    await safeUserAudit(env, {
      event_type: 'wallet.bind.fail', severity: 'warn', user_id: userId, request,
      data: { reason: 'nonce_invalid_or_expired' },
    })
    return res({ error: 'Nonce invalid or expired' }, 401, cors)
  }
  if (nonceRow.user_id !== userId) {
    // 高度可疑：拿別人的 nonce 來綁
    await safeUserAudit(env, {
      event_type: 'wallet.bind.fail', severity: 'critical', user_id: userId, request,
      data: { reason: 'nonce_user_mismatch', nonce_user: nonceRow.user_id },
    })
    return res({ error: 'Nonce mismatch' }, 401, cors)
  }
  if (nonceRow.address !== address) {
    await safeUserAudit(env, {
      event_type: 'wallet.bind.fail', severity: 'warn', user_id: userId, request,
      data: { reason: 'address_mismatch', expected: nonceRow.address.slice(0, 10), actual: address.slice(0, 10) },
    })
    return res({ error: 'Address does not match nonce' }, 400, cors)
  }

  // 3. INSERT；UNIQUE(user_id, address) 撞 → 409
  try {
    const ins = await env.chiyigo_db
      .prepare(
        `INSERT INTO user_wallets (user_id, address, chain_id, nickname)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(userId, address, chainId ?? nonceRow.chain_id ?? 1, nickname)
      .run()

    await safeUserAudit(env, {
      event_type: 'wallet.bind.success',
      severity:   'critical',                 // 綁 wallet 是金流前置，視同 mfa.disable 等級需要 alert
      user_id:    userId,
      request,
      data: { address_prefix: address.slice(0, 10), chain_id: chainId },
    })

    return res({
      id:        ins.meta.last_row_id,
      address,
      chain_id:  chainId,
      nickname,
      signed_at: new Date().toISOString(),
    }, 200, cors)
  } catch (e) {
    if (String(e?.message ?? e).includes('UNIQUE')) {
      return res({ error: 'Wallet already bound', code: 'ALREADY_BOUND' }, 409, cors)
    }
    throw e
  }
}
