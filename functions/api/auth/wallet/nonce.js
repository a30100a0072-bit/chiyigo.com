/**
 * POST /api/auth/wallet/nonce
 * Header: Authorization: Bearer <access_token>
 * Body:   { address: string, chain_id?: number }
 *
 * Phase F-3 — SIWE ceremony 第一步。
 *
 * 流程：
 *   1. 驗 access_token + address 格式
 *   2. 同 user 同 address 已綁定 → 409（不重複綁）
 *   3. issue nonce + 寫 wallet_nonces（5min TTL）
 *   4. 回 nonce + suggested message template（前端可用 SiweMessage 組好給 wallet 簽）
 *
 * 回傳：
 *   200 → { nonce, expires_at, domain, uri, chain_id, address }
 *   400 → address 格式錯
 *   401 → access_token 無效
 *   409 → 此 address 已綁過
 */

import { requireAuth, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { issueWalletNonce, isValidEthAddress, getSiweConfig } from '../../../utils/siwe.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400, cors) }

  const address = typeof body?.address === 'string' ? body.address : null
  const chainId = Number.isFinite(body?.chain_id) ? Number(body.chain_id) : 1

  if (!isValidEthAddress(address)) {
    return res({ error: 'Invalid Ethereum address' }, 400, cors)
  }

  const userId = Number(user.sub)
  const addrLower = address.toLowerCase()

  // 409 防重複綁
  const existing = await env.chiyigo_db
    .prepare(`SELECT 1 FROM user_wallets WHERE user_id = ? AND address = ?`)
    .bind(userId, addrLower).first()
  if (existing) return res({ error: 'Wallet already bound', code: 'ALREADY_BOUND' }, 409, cors)

  const { nonce, expires_at } = await issueWalletNonce(env, {
    userId, address: addrLower, chainId,
  })
  const { domain, uri } = getSiweConfig(env)

  return res({
    nonce,
    expires_at,
    domain,
    uri,
    chain_id: chainId,
    address:  addrLower,
  }, 200, cors)
}
