/**
 * Phase F-3 — SIWE（Sign-In with Ethereum, EIP-4361）
 *
 * 自實作 minimal verifier — siwe@2 拉 ethers v6，ethers 拉 node:https，
 * 在 Cloudflare Workers test runtime 沒得跑。改用 @noble/curves 自驗章
 * 對核心安全 path 也更可控。
 *
 * 流程：
 *   1. parseSiweMessage(text) → 解出 EIP-4361 規範欄位
 *   2. hashMessageEip191(text) → keccak256 of `\x19Ethereum Signed Message:\n${len}${text}`
 *   3. recoverAddress(hash, signature) → 用 secp256k1 ecrecover 出 pubkey → keccak256 last 20 bytes
 *   4. 比對 recovered === message.address；驗 domain / uri / 時間
 */

import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'

const NONCE_TTL_SEC = 5 * 60
const VERIFY_DOMAIN_DEFAULT = 'chiyigo.com'

export function getSiweConfig(env) {
  return {
    domain: env?.WALLET_SIWE_DOMAIN || VERIFY_DOMAIN_DEFAULT,
    uri:    env?.WALLET_SIWE_URI    || `https://${env?.WALLET_SIWE_DOMAIN || VERIFY_DOMAIN_DEFAULT}`,
  }
}

/** 產符合 EIP-4361 格式的 nonce（≥8 字 alphanumeric）。 */
export function generateSiweNonce() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  // base36 編碼讓 nonce 全是 alphanumeric（避開 SIWE 規範禁止的字元）
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 17)
}

/**
 * Issue nonce + 寫 wallet_nonces。caller 需先確認 user 已登入 + address 格式 OK。
 */
export async function issueWalletNonce(env, { userId, address, chainId = 1 }) {
  const nonce = generateSiweNonce()
  const expiresAt = new Date(Date.now() + NONCE_TTL_SEC * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(
      `INSERT INTO wallet_nonces (nonce, user_id, address, chain_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(nonce, userId, address.toLowerCase(), chainId, expiresAt)
    .run()
  return { nonce, expires_at: expiresAt }
}

/**
 * 一次性消耗 nonce。caller 拿 row（user_id / address / chain_id）。
 */
export async function consumeWalletNonce(env, nonce) {
  const row = await env.chiyigo_db
    .prepare(
      `SELECT id, user_id, address, chain_id, expires_at, consumed_at
         FROM wallet_nonces
        WHERE nonce = ? AND expires_at > datetime('now') AND consumed_at IS NULL`,
    )
    .bind(nonce).first()
  if (!row) return null
  const upd = await env.chiyigo_db
    .prepare(`UPDATE wallet_nonces SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL`)
    .bind(row.id).run()
  if ((upd.meta?.changes ?? 0) === 0) return null
  return row
}

/** 0x 開頭 + 40 hex chars。 */
export function isValidEthAddress(s) {
  return typeof s === 'string' && /^0x[a-fA-F0-9]{40}$/.test(s)
}

// ── EIP-4361 message parser ─────────────────────────────────────

const REQUIRED_FIELDS = ['URI', 'Version', 'Chain ID', 'Nonce', 'Issued At']

/**
 * 解 SIWE 文本格式（spec：https://eips.ethereum.org/EIPS/eip-4361）。
 * 不寬鬆 — 缺欄位 / 順序錯都 throw。
 */
export function parseSiweMessage(text) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('Empty message')
  const lines = text.split('\n')

  // line 0：`${domain} wants you to sign in with your Ethereum account:`
  // line 1：address
  // line 2：(empty)
  // line 3：statement (optional)
  // line 4 or 3：(empty)
  // 之後：key-value 欄位
  const m = lines[0]?.match(/^(.+?) wants you to sign in with your Ethereum account:$/)
  if (!m) throw new Error('Invalid line 0 (domain)')
  const domain = m[1]

  const address = lines[1]
  if (!isValidEthAddress(address)) throw new Error('Invalid address line 1')

  // 找第一個 "Key: value" 的行 index
  const kvStart = lines.findIndex((l, i) => i >= 3 && /^[A-Z][A-Za-z ]+: /.test(l))
  if (kvStart < 0) throw new Error('No key-value section')

  const statement = kvStart === 4 ? lines[3] : null
  // (empty line) 應出現在 kvStart-1（如有 statement 在 line 3）

  const fields = {}
  for (let i = kvStart; i < lines.length; i++) {
    const ln = lines[i]
    if (!ln) continue
    const idx = ln.indexOf(': ')
    if (idx < 0) throw new Error(`Bad key-value at line ${i}: ${ln}`)
    fields[ln.slice(0, idx)] = ln.slice(idx + 2)
  }
  for (const k of REQUIRED_FIELDS) {
    if (!fields[k]) throw new Error(`Missing field: ${k}`)
  }

  return {
    domain,
    address,
    statement,
    uri:            fields['URI'],
    version:        fields['Version'],
    chainId:        Number(fields['Chain ID']),
    nonce:          fields['Nonce'],
    issuedAt:       fields['Issued At'],
    expirationTime: fields['Expiration Time'] ?? null,
    notBefore:      fields['Not Before'] ?? null,
  }
}

// ── EIP-191 hash + ecrecover ─────────────────────────────────────

const HEX_TABLE = '0123456789abcdef'

function bytesToHex(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += HEX_TABLE[bytes[i] >> 4] + HEX_TABLE[bytes[i] & 0xf]
  }
  return s
}

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  if (h.length % 2 !== 0) throw new Error('Odd hex length')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** EIP-191 personal_sign 的 hash：keccak256("\x19Ethereum Signed Message:\n${len}${msg}") */
function hashMessageEip191(text) {
  const msgBytes    = new TextEncoder().encode(text)
  const prefixBytes = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msgBytes.length}`)
  const full = new Uint8Array(prefixBytes.length + msgBytes.length)
  full.set(prefixBytes)
  full.set(msgBytes, prefixBytes.length)
  return keccak_256(full)
}

/**
 * ecrecover：用 signature + msgHash 還原 ETH address（lowercase 0x...）。
 * sig 格式 = 0x{r:32}{s:32}{v:1}（共 65 bytes / 130 hex）。
 */
function recoverAddressFromSig(msgHash, sigHex) {
  const sigBytes = hexToBytes(sigHex)
  if (sigBytes.length !== 65) throw new Error('Signature must be 65 bytes')
  const r = sigBytes.slice(0, 32)
  const s = sigBytes.slice(32, 64)
  const v = sigBytes[64]
  // EIP-155 / personal_sign：v 是 27 或 28（recovery bit = v - 27）
  const recovery = v - 27
  if (recovery !== 0 && recovery !== 1) throw new Error(`Invalid recovery byte: ${v}`)

  const sig = new secp256k1.Signature(
    BigInt('0x' + bytesToHex(r)),
    BigInt('0x' + bytesToHex(s)),
  ).addRecoveryBit(recovery)

  const pubKeyPoint = sig.recoverPublicKey(msgHash)
  // uncompressed 65 bytes：0x04 || X(32) || Y(32)；address = keccak256(X||Y).slice(-20)
  const uncompressed = pubKeyPoint.toRawBytes(false)
  if (uncompressed[0] !== 0x04 || uncompressed.length !== 65) {
    throw new Error('Bad recovered pubkey format')
  }
  const xy = uncompressed.slice(1)
  const hash = keccak_256(xy)
  const addr = '0x' + bytesToHex(hash.slice(-20))
  return addr.toLowerCase()
}

/** ISO 8601 → ms epoch；非法回 NaN */
function parseIsoMs(s) {
  if (!s) return NaN
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : NaN
}

/**
 * 完整驗 SIWE message + signature。回 { ok, address?, chainId?, nonce?, error? }。
 *
 * 嚴格驗：
 *  - parse 不爛
 *  - signature recover 出來的 address 跟 message.address 相符
 *  - issuedAt 不在未來；expirationTime（若有）大於 now；notBefore（若有）小於 now
 *  - domain 跟 server config 相符
 *  - uri 跟 server config 同 origin（防 sig 拿到別站重用）
 */
export async function verifySiweMessage(env, { messageRaw, signature }) {
  let parsed
  try { parsed = parseSiweMessage(messageRaw) }
  catch (e) { return { ok: false, error: `parse: ${e?.message ?? e}`.slice(0, 120) } }

  // domain check
  const cfg = getSiweConfig(env)
  if (parsed.domain !== cfg.domain) {
    return { ok: false, error: `domain_mismatch (got=${parsed.domain})` }
  }
  // uri origin check
  try {
    if (new URL(parsed.uri).origin !== new URL(cfg.uri).origin) {
      return { ok: false, error: 'uri_mismatch' }
    }
  } catch {
    return { ok: false, error: 'uri_invalid' }
  }

  // 時間 check
  const now = Date.now()
  const issuedMs = parseIsoMs(parsed.issuedAt)
  if (Number.isNaN(issuedMs)) return { ok: false, error: 'issued_at_invalid' }
  if (issuedMs > now + 60_000) return { ok: false, error: 'issued_at_in_future' }
  if (parsed.expirationTime) {
    const expMs = parseIsoMs(parsed.expirationTime)
    if (Number.isNaN(expMs) || expMs < now) return { ok: false, error: 'expired' }
  }
  if (parsed.notBefore) {
    const nbMs = parseIsoMs(parsed.notBefore)
    if (Number.isNaN(nbMs) || nbMs > now) return { ok: false, error: 'not_yet_valid' }
  }

  // signature check
  let recovered
  try {
    const hash = hashMessageEip191(messageRaw)
    recovered  = recoverAddressFromSig(hash, signature)
  } catch (e) {
    return { ok: false, error: `recover: ${e?.message ?? e}`.slice(0, 120) }
  }
  if (recovered !== parsed.address.toLowerCase()) {
    return { ok: false, error: 'signature_mismatch' }
  }

  return {
    ok: true,
    address: recovered,
    chainId: parsed.chainId,
    nonce:   parsed.nonce,
  }
}

// 測試用 helper（給整合測試在 Workers runtime 內生 signature）
export const _internal = {
  hashMessageEip191,
  recoverAddressFromSig,
  parseSiweMessage,
  bytesToHex,
  hexToBytes,
}
