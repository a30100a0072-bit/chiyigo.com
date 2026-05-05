/**
 * Phase F-3 — SIWE 錢包綁定整合測試
 *
 * 涵蓋：
 *  - POST /api/auth/wallet/nonce
 *  - POST /api/auth/wallet/verify  (含真實 secp256k1 簽章)
 *  - GET  /api/auth/wallet
 *  - DELETE /api/auth/wallet/:id   (step-up)
 *
 * 簽章用 @noble/curves（避開 ethers / siwe 對 node:https 的依賴），
 * 模擬 wallet personal_sign 流程。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { SCOPES } from '../../functions/utils/scopes.js'
import { _internal as siweInternal } from '../../functions/utils/siwe.js'

import { onRequestPost as nonceHandler  } from '../../functions/api/auth/wallet/nonce.js'
import { onRequestPost as verifyHandler } from '../../functions/api/auth/wallet/verify.js'
import { onRequestGet  as listHandler   } from '../../functions/api/auth/wallet.js'
import { onRequestDelete as deleteHandler } from '../../functions/api/auth/wallet/[id].js'

env.WALLET_SIWE_DOMAIN = 'localhost'
env.WALLET_SIWE_URI    = 'http://localhost'

// ── 測試用 ETH wallet（純 @noble，沒 ethers 依賴）──
function createWallet() {
  const priv = secp256k1.utils.randomPrivateKey()
  // pubkey uncompressed 65 bytes
  const pub = secp256k1.getPublicKey(priv, false)
  const xy  = pub.slice(1)  // strip 0x04 prefix
  const addrBytes = keccak_256(xy).slice(-20)
  const address = '0x' + siweInternal.bytesToHex(addrBytes)
  return { priv, address }
}

function signMessage(priv, messageText) {
  const hash = siweInternal.hashMessageEip191(messageText)
  const sig  = secp256k1.sign(hash, priv)
  // Encode r || s || (v = recovery + 27)
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (sig.recovery + 27).toString(16).padStart(2, '0')
  return '0x' + r + s + v
}

function buildSiweMessage({ domain = 'localhost', address, uri = 'http://localhost', chainId = 1, nonce, expirationMin = 5 }) {
  const issuedAt = new Date().toISOString()
  const expirationTime = new Date(Date.now() + expirationMin * 60_000).toISOString()
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in with Ethereum to chiyigo.',
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join('\n')
}

async function userToken(userId, email = 'w@x') {
  return signJwt(
    { sub: String(userId), email, role: 'player', status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

async function stepUpToken(userId, action) {
  return signJwt(
    { sub: String(userId), email: 'w@x', role: 'player', status: 'active', ver: 0,
      scope: SCOPES.ELEVATED_ACCOUNT, for_action: action, amr: ['pwd', 'totp'],
      acr: 'urn:chiyigo:loa:2' },
    '5m', env, { audience: 'chiyigo' },
  )
}

function bearer(method, url, token, body = null) {
  return new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/auth/wallet/nonce', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 access_token → 401', async () => {
    const resp = await nonceHandler({
      request: new Request('http://x/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }), env,
    })
    expect(resp.status).toBe(401)
  })

  it('address 格式錯 → 400', async () => {
    const u = await seedUser({ email: 'n1@x' })
    const tok = await userToken(u.id)
    const resp = await nonceHandler({
      request: bearer('POST', 'http://x/', tok, { address: 'not-an-addr' }), env,
    })
    expect(resp.status).toBe(400)
  })

  it('happy → 200 + nonce 寫入', async () => {
    const u = await seedUser({ email: 'n2@x' })
    const tok = await userToken(u.id)
    const w = createWallet()
    const resp = await nonceHandler({
      request: bearer('POST', 'http://x/', tok, { address: w.address }), env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.nonce).toBeTruthy()
    expect(body.address).toBe(w.address.toLowerCase())
    const row = await env.chiyigo_db.prepare(
      `SELECT user_id, address, consumed_at FROM wallet_nonces WHERE nonce = ?`,
    ).bind(body.nonce).first()
    expect(row.user_id).toBe(u.id)
    expect(row.consumed_at).toBeNull()
  })

  it('已綁 address 再申請 → 409', async () => {
    const u = await seedUser({ email: 'n3@x' })
    const tok = await userToken(u.id)
    const w = createWallet()
    await env.chiyigo_db.prepare(
      `INSERT INTO user_wallets (user_id, address) VALUES (?, ?)`,
    ).bind(u.id, w.address.toLowerCase()).run()
    const resp = await nonceHandler({
      request: bearer('POST', 'http://x/', tok, { address: w.address }), env,
    })
    expect(resp.status).toBe(409)
  })
})

describe('POST /api/auth/wallet/verify', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  async function setupNonce(userId, address) {
    const exp = new Date(Date.now() + 5 * 60_000).toISOString().replace('T', ' ').slice(0, 19)
    const nonce = 'a'.repeat(17)
    await env.chiyigo_db.prepare(
      `INSERT INTO wallet_nonces (nonce, user_id, address, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(nonce, userId, address.toLowerCase(), exp).run()
    return nonce
  }

  it('正確簽章 → 200 + INSERT + critical audit + nonce consumed', async () => {
    const u = await seedUser({ email: 'v1@x' })
    const tok = await userToken(u.id)
    const w = createWallet()
    const nonce = await setupNonce(u.id, w.address)
    const messageRaw = buildSiweMessage({ address: w.address, nonce })
    const signature = signMessage(w.priv, messageRaw)

    const resp = await verifyHandler({
      request: bearer('POST', 'http://x/', tok, { message: messageRaw, signature, nickname: 'My Wallet' }),
      env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.address).toBe(w.address.toLowerCase())
    expect(body.nickname).toBe('My Wallet')

    const wRow = await env.chiyigo_db.prepare(
      `SELECT user_id, nickname FROM user_wallets WHERE address = ?`,
    ).bind(w.address.toLowerCase()).first()
    expect(wRow.user_id).toBe(u.id)

    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'wallet.bind.success' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')

    const nrow = await env.chiyigo_db.prepare(
      `SELECT consumed_at FROM wallet_nonces WHERE nonce = ?`,
    ).bind(nonce).first()
    expect(nrow.consumed_at).not.toBeNull()
  })

  it('別人的 nonce（user_id 不符）→ 401 critical audit', async () => {
    const a = await seedUser({ email: 'va@x' })
    const b = await seedUser({ email: 'vb@x' })
    const tokB = await userToken(b.id)
    const w = createWallet()
    const nonce = await setupNonce(a.id, w.address)
    const messageRaw = buildSiweMessage({ address: w.address, nonce })
    const signature  = signMessage(w.priv, messageRaw)

    const resp = await verifyHandler({
      request: bearer('POST', 'http://x/', tokB, { message: messageRaw, signature }), env,
    })
    expect(resp.status).toBe(401)
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'wallet.bind.fail' AND user_id = ?`,
    ).bind(b.id).first()
    expect(audit?.severity).toBe('critical')
  })

  it('簽章被別 wallet 偽造 → 400 SIGNATURE_INVALID', async () => {
    const u = await seedUser({ email: 'v2@x' })
    const tok = await userToken(u.id)
    const w    = createWallet()
    const fake = createWallet()
    const nonce = await setupNonce(u.id, w.address)
    const messageRaw = buildSiweMessage({ address: w.address, nonce })
    const sigByFake  = signMessage(fake.priv, messageRaw)  // 用 fake 簽 → recover 出來 ≠ message.address
    const resp = await verifyHandler({
      request: bearer('POST', 'http://x/', tok, { message: messageRaw, signature: sigByFake }), env,
    })
    expect(resp.status).toBe(400)
    expect((await resp.json()).code).toBe('SIGNATURE_INVALID')
  })

  it('nonce 已被消耗 → 401', async () => {
    const u = await seedUser({ email: 'v3@x' })
    const tok = await userToken(u.id)
    const w = createWallet()
    const nonce = await setupNonce(u.id, w.address)
    await env.chiyigo_db.prepare(
      `UPDATE wallet_nonces SET consumed_at = datetime('now') WHERE nonce = ?`,
    ).bind(nonce).run()
    const messageRaw = buildSiweMessage({ address: w.address, nonce })
    const signature = signMessage(w.priv, messageRaw)
    const resp = await verifyHandler({
      request: bearer('POST', 'http://x/', tok, { message: messageRaw, signature }), env,
    })
    expect(resp.status).toBe(401)
  })

  it('domain 不符 → 400 SIGNATURE_INVALID（防 phishing 重用 sig）', async () => {
    const u = await seedUser({ email: 'v4@x' })
    const tok = await userToken(u.id)
    const w = createWallet()
    const nonce = await setupNonce(u.id, w.address)
    const messageRaw = buildSiweMessage({ address: w.address, nonce, domain: 'evil.com' })
    const signature = signMessage(w.priv, messageRaw)
    const resp = await verifyHandler({
      request: bearer('POST', 'http://x/', tok, { message: messageRaw, signature }), env,
    })
    expect(resp.status).toBe(400)
  })
})

describe('GET /api/auth/wallet', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('列當前 user wallet（隔離別 user）', async () => {
    const a = await seedUser({ email: 'la@x' })
    const b = await seedUser({ email: 'lb@x' })
    await env.chiyigo_db.prepare(
      `INSERT INTO user_wallets (user_id, address, nickname) VALUES (?, '0x1111111111111111111111111111111111111111', 'mine')`,
    ).bind(a.id).run()
    await env.chiyigo_db.prepare(
      `INSERT INTO user_wallets (user_id, address) VALUES (?, '0x2222222222222222222222222222222222222222')`,
    ).bind(b.id).run()

    const tok = await userToken(a.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/', tok), env })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.wallets).toHaveLength(1)
    expect(body.wallets[0].nickname).toBe('mine')
  })
})

describe('DELETE /api/auth/wallet/:id', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('一般 access_token → 403 STEP_UP_REQUIRED', async () => {
    const u = await seedUser({ email: 'd@x' })
    const ins = await env.chiyigo_db.prepare(
      `INSERT INTO user_wallets (user_id, address) VALUES (?, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')`,
    ).bind(u.id).run()
    const tok = await userToken(u.id)
    const resp = await deleteHandler({
      request: bearer('DELETE', 'http://x/', tok),
      env, params: { id: String(ins.meta.last_row_id) },
    })
    expect(resp.status).toBe(403)
    expect((await resp.json()).code).toBe('STEP_UP_REQUIRED')
  })

  it('step-up + 正確 for_action → 200 + critical audit', async () => {
    const u = await seedUser({ email: 'dh@x' })
    const ins = await env.chiyigo_db.prepare(
      `INSERT INTO user_wallets (user_id, address) VALUES (?, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')`,
    ).bind(u.id).run()
    const tok = await stepUpToken(u.id, 'unbind_wallet')
    const resp = await deleteHandler({
      request: bearer('DELETE', 'http://x/', tok),
      env, params: { id: String(ins.meta.last_row_id) },
    })
    expect(resp.status).toBe(200)
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'wallet.unbind' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')
  })

  it('別 user 的 wallet 不能刪 → 404', async () => {
    const a = await seedUser({ email: 'da@x' })
    const b = await seedUser({ email: 'db@x' })
    const ins = await env.chiyigo_db.prepare(
      `INSERT INTO user_wallets (user_id, address) VALUES (?, '0xcccccccccccccccccccccccccccccccccccccccc')`,
    ).bind(a.id).run()
    const tokB = await stepUpToken(b.id, 'unbind_wallet')
    const resp = await deleteHandler({
      request: bearer('DELETE', 'http://x/', tokB),
      env, params: { id: String(ins.meta.last_row_id) },
    })
    expect(resp.status).toBe(404)
  })
})
