/**
 * Stage 7 PR-2dv 棒5b — LINE id_token（HS256）驗證 hardening
 *
 * 5 項 fail-closed 補強 ＝ alg / iss / aud / exp / nonce（item 1-5）；signature 為既有 gate，
 * 本 PR 僅在其上加 F-2 channelSecret guard。驗證順序：alg → signature → iss → aud → exp → nonce。
 *
 * 兩類（PLAN §4.3 L8 base-RED 證據法）：
 *   DELTA_RED       base RED（200）→ candidate GREEN（400）＝新增的 reject 行為
 *   INVARIANT_GREEN base GREEN ∧ candidate GREEN＝no-weakening 錨（禁逼 pre-fix RED）
 *
 * ⚠ INVARIANT 案只斷言 status（+ 無 user），**不**斷言 candidate 專屬錯誤訊息 —— 訊息在 base
 * 走不同 gate（如 N1 base 走 signature invalid、candidate 走 unexpected alg），斷言訊息會使
 * INVARIANT 在 base RED、誤分類成 DELTA。DELTA 案 base 為 200，故可斷言精確訊息鎖定 gate。
 *
 * N11 主案（stored.nonce=NULL → 400 反轉）在 oauth-nonce.test.ts:202（N11-NARROW-EDIT）；
 * 本檔只收其 empty-string 子案（stored.nonce=''）。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys } from './_helpers'
import { onRequestGet as cbGet } from '../../functions/api/auth/oauth/[provider]/callback'

const BASE = 'http://localhost/api/auth/oauth'
const LINE_ISS    = 'https://access.line.me'
const LINE_CID    = 'line-cid'
const LINE_SECRET = 'line-channel-secret'
const NONCE       = 'nonce-session-1'

/**
 * N15：LINE_CLIENT_SECRET 未設時 cfg.clientSecret 為 null，而 base 的
 * `new TextEncoder().encode(null)` 會編出字面字串 "null" 的 4 bytes 當 HMAC key。
 * 攻擊者若知 secret 未設，即可用這個字面值自簽。此常數即該 key。
 */
const NULL_KEY = 'null'

// ── file-local typed helpers（OD-3：不 export、不進 _helpers）─────────

interface LineJwtHeader { alg: string; typ: 'JWT' }

/**
 * aud/exp 用 unknown：測試須構造 malformed 值（array / number / object / 字串 exp），
 * 標成 string/number 會觸 TS2322 使本檔非 clean → 破 ratchet cleanFiles。verifier 端
 * payload.aud / payload.exp 本就來自 JSON.parse（any），unknown 忠實反映邊界事實。
 */
interface LineIdTokenClaims {
  iss?: string
  sub?: string
  aud?: unknown
  exp?: unknown
  nonce?: string
  email?: string
  [k: string]: unknown
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
function b64urlString(s: string): string { return b64url(new TextEncoder().encode(s)) }

const HS256_HEADER: LineJwtHeader = { alg: 'HS256', typ: 'JWT' }

/** JWS compact serialization + HMAC-SHA256 簽章（三個 signer 的共用底層）。 */
async function signCompact(headerJson: string, payloadJson: string, secret: string): Promise<string> {
  const data = `${b64urlString(headerJson)}.${b64urlString(payloadJson)}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${b64url(sig)}`
}

/** 預設 HS256 header 簽 LINE id_token。 */
async function signLineIdToken(payload: LineIdTokenClaims, secret: string): Promise<string> {
  return signCompact(JSON.stringify(HS256_HEADER), JSON.stringify(payload), secret)
}

/** N2：header.alg 可謊報，簽章仍固定 HMAC-SHA256 + channel secret（證 alg 是獨立 gate）。 */
async function signLineIdTokenWithHeader(
  payload: LineIdTokenClaims, header: LineJwtHeader, secret: string,
): Promise<string> {
  return signCompact(JSON.stringify(header), JSON.stringify(payload), secret)
}

/**
 * N10 exp=1e999：JSON.stringify(Infinity) === 'null'，object-based signer 產不出 Infinity
 * → 直接注入 raw payload JSON 字串（JSON.parse('{"exp":1e999}').exp === Infinity）。
 */
async function signLineIdTokenWithRawPayload(payloadJson: string, secret: string): Promise<string> {
  return signCompact(JSON.stringify(HS256_HEADER), payloadJson, secret)
}

/** 其餘 claim 全 valid；傳 undefined 代表「該 claim 缺席」（JSON.stringify 會丟棄 undefined）。 */
function lineClaims(over: LineIdTokenClaims = {}): LineIdTokenClaims {
  return {
    iss: LINE_ISS,
    sub: 'line-uid-1',
    aud: LINE_CID,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: NONCE,
    email: 'user@line.example',
    ...over,
  }
}

async function seedOauthState(
  { state, nonce = NONCE, codeVerifier = 'verifier-xyz', ttlSec = 600 }:
  { state: string; nonce?: string | null; codeVerifier?: string; ttlSec?: number },
): Promise<void> {
  const exp = new Date(Date.now() + ttlSec * 1000).toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db.prepare(
    `INSERT INTO oauth_states (state_token, code_verifier, nonce, redirect_uri, platform, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(state, codeVerifier, nonce, 'https://chiyigo.com/api/auth/oauth/line/callback', 'web', exp)
    .run()
}

function callCb(state: string, code: string = 'auth-code') {
  const url = `${BASE}/line/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
  return cbGet({
    request: new Request(url, { method: 'GET', headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
    env, params: { provider: 'line' }, waitUntil: () => {}, data: {}, next: async () => new Response('next'),
  })
}

async function userCount(email: string): Promise<number> {
  const row = await env.chiyigo_db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').bind(email).first()
  return Number(row?.n ?? 0)
}

/** 登入成功會寫 refresh_tokens；用於斷言「驗證失敗 → 零 session 副作用」。 */
async function refreshTokenCount(): Promise<number> {
  const row = await env.chiyigo_db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens').first()
  return Number(row?.n ?? 0)
}

let fetchCalls: string[] = []

/** LINE token + profile mock；fetchCalls 記錄器供 N14 機械證明 pre-verifier 短路。 */
function installLineMock(idToken: string, userId: string = 'line-uid-1') {
  const fn = vi.fn(async (input: Request | string) => {
    const url = typeof input === 'string' ? input : input.url
    fetchCalls.push(url)
    if (url.includes('/oauth2/')) {
      return new Response(JSON.stringify({ access_token: 'fake-tok', id_token: idToken }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/v2/profile')) {
      return new Response(JSON.stringify({ userId, displayName: 'LineUser' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('not-mocked', { status: 599 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

// ── setup ─────────────────────────────────────────────────────────

beforeAll(async () => { await ensureJwtKeys(); await resetDb() })

beforeEach(async () => {
  await resetDb()
  Object.assign(env, {
    LINE_CLIENT_ID:     LINE_CID,
    LINE_CLIENT_SECRET: LINE_SECRET,
  })
  fetchCalls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── item 1：alg ───────────────────────────────────────────────────

describe('PR-2dv item 1 — alg', () => {
  it('[N1 INVARIANT_GREEN] alg=none + 空簽章 → 拒絕', async () => {
    // base 走 signature invalid、candidate 走 unexpected alg —— 兩者皆 400（故不斷言訊息）
    const payloadB64 = b64urlString(JSON.stringify(lineClaims({ email: 'none@line.example' })))
    const headerB64  = b64urlString(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    installLineMock(`${headerB64}.${payloadB64}.`)

    await seedOauthState({ state: 'st-n1' })
    const res = await callCb('st-n1')
    expect(res.status).toBe(400)
    expect(await userCount('none@line.example')).toBe(0)
  })

  it('[N2 DELTA_RED] alg 謊報 RS256 但用正確 channel secret HMAC 簽 → 拒絕', async () => {
    // alg gate 獨立於 signature gate：簽章本身有效，故 400 只可能來自 alg 檢查
    const idToken = await signLineIdTokenWithHeader(
      lineClaims({ sub: 'line-rs256', email: 'rs256@line.example' }),
      { alg: 'RS256', typ: 'JWT' },
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-rs256')

    await seedOauthState({ state: 'st-n2' })
    const res = await callCb('st-n2')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token unexpected alg')
    expect(await userCount('rs256@line.example')).toBe(0)
  })

  it('[N3 INVARIANT_GREEN] 誠實 HS256 + 全 valid → 登入成功、email 自 id_token 注入', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ sub: 'line-happy', email: 'happy@line.example' }), LINE_SECRET,
    )
    installLineMock(idToken, 'line-happy')

    await seedOauthState({ state: 'st-n3' })
    const res = await callCb('st-n3')
    expect(res.status).toBe(200)
    expect(await userCount('happy@line.example')).toBe(1)
  })
})

// ── item 2：iss ───────────────────────────────────────────────────

describe('PR-2dv item 2 — iss', () => {
  it('[N4 DELTA_RED] iss 為他 IdP → 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ iss: 'https://accounts.google.com', sub: 'line-iss-bad', email: 'iss-bad@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-iss-bad')

    await seedOauthState({ state: 'st-n4' })
    const res = await callCb('st-n4')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token issuer mismatch')
    expect(await userCount('iss-bad@line.example')).toBe(0)
  })

  it('[N5 DELTA_RED] iss 缺席 → 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ iss: undefined, sub: 'line-iss-missing', email: 'iss-missing@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-iss-missing')

    await seedOauthState({ state: 'st-n5' })
    const res = await callCb('st-n5')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token issuer mismatch')
    expect(await userCount('iss-missing@line.example')).toBe(0)
  })
})

// ── item 3：aud（LINE-AUD-STRING-ONLY）────────────────────────────

describe('PR-2dv item 3 — aud（string-only exact）', () => {
  it('[N6 DELTA_RED] aud 為他 channel（string）→ 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ aud: 'other-channel-cid', sub: 'line-aud-bad', email: 'aud-bad@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-aud-bad')

    await seedOauthState({ state: 'st-n6' })
    const res = await callCb('st-n6')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token audience mismatch')
    expect(await userCount('aud-bad@line.example')).toBe(0)
  })

  it('[N7 DELTA_RED] aud 缺席 → 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ aud: undefined, sub: 'line-aud-missing', email: 'aud-missing@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-aud-missing')

    await seedOauthState({ state: 'st-n7' })
    const res = await callCb('st-n7')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token audience mismatch')
    expect(await userCount('aud-missing@line.example')).toBe(0)
  })

  it('[N8 DELTA_RED] aud array 不含本 channel → 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ aud: ['other-channel-cid'], sub: 'line-aud-arr', email: 'aud-arr@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-aud-arr')

    await seedOauthState({ state: 'st-n8' })
    const res = await callCb('st-n8')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token audience mismatch')
    expect(await userCount('aud-arr@line.example')).toBe(0)
  })

  it('[N9 DELTA_RED] aud array 含本 channel → 仍拒絕（string-only，禁 array/includes）', async () => {
    // ARCH-PR2DV-RR1：LINE 官方 aud Type=String；HS256 multi-audience OIDC 未定義 → array 一律拒
    const idToken = await signLineIdToken(
      lineClaims({ aud: [LINE_CID, 'other-channel-cid'], sub: 'line-aud-arr2', email: 'aud-arr2@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-aud-arr2')

    await seedOauthState({ state: 'st-n9' })
    const res = await callCb('st-n9')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token audience mismatch')
    expect(await userCount('aud-arr2@line.example')).toBe(0)
  })

  // AUD-TYPE-FAIL 子案：非 string 型別一律拒（base 無 aud 檢查 → 全 200 → 全 DELTA）
  const AUD_TYPE_FAIL: Array<{ label: string; aud: unknown }> = [
    { label: '空 array',   aud: [] },
    { label: '非字串元素', aud: [123] },
    { label: 'number',    aud: 123 },
    { label: 'object',    aud: {} },
    { label: 'null',      aud: null },
    { label: '空字串',     aud: '' },
  ]
  for (const [i, c] of AUD_TYPE_FAIL.entries()) {
    it(`[N8 子案 DELTA_RED] aud 型別 ${c.label} → 拒絕`, async () => {
      const email = `aud-type-${i}@line.example`
      const idToken = await signLineIdToken(
        lineClaims({ aud: c.aud, sub: `line-aud-t${i}`, email }), LINE_SECRET,
      )
      installLineMock(idToken, `line-aud-t${i}`)

      await seedOauthState({ state: `st-n8-t${i}` })
      const res = await callCb(`st-n8-t${i}`)
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('id_token audience mismatch')
      expect(await userCount(email)).toBe(0)
    })
  }
})

// ── item 4：exp ───────────────────────────────────────────────────

describe('PR-2dv item 4 — exp（強制存在 + finite + now>=exp）', () => {
  it('[N10 DELTA_RED] exp 缺席 → 拒絕（缺 exp 等同永不過期）', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ exp: undefined, sub: 'line-exp-missing', email: 'exp-missing@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-exp-missing')

    await seedOauthState({ state: 'st-n10' })
    const res = await callCb('st-n10')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token expired')
    expect(await userCount('exp-missing@line.example')).toBe(0)
  })

  // non-coercible 非數字：base `now > exp` 得 NaN → false → 放行（200）→ DELTA
  const EXP_NON_COERCIBLE: Array<{ label: string; exp: unknown }> = [
    { label: '"not-a-number"', exp: 'not-a-number' },
    { label: '{}',             exp: {} },
  ]
  for (const [i, c] of EXP_NON_COERCIBLE.entries()) {
    it(`[N10 子案 DELTA_RED] exp 為 non-coercible 非數字 ${c.label} → 拒絕`, async () => {
      const email = `exp-nan-${i}@line.example`
      const idToken = await signLineIdToken(
        lineClaims({ exp: c.exp, sub: `line-exp-nan${i}`, email }), LINE_SECRET,
      )
      installLineMock(idToken, `line-exp-nan${i}`)

      await seedOauthState({ state: `st-n10-nan${i}` })
      const res = await callCb(`st-n10-nan${i}`)
      expect(res.status).toBe(400)
      expect(await res.text()).toContain('id_token expired')
      expect(await userCount(email)).toBe(0)
    })
  }

  it('[N10 子案 DELTA_RED] exp=1e999 → Infinity → 拒絕（base now>Infinity=false 會漏放）', async () => {
    const raw = `{"iss":"${LINE_ISS}","sub":"line-exp-inf","aud":"${LINE_CID}",`
      + `"exp":1e999,"nonce":"${NONCE}","email":"exp-inf@line.example"}`
    const idToken = await signLineIdTokenWithRawPayload(raw, LINE_SECRET)
    installLineMock(idToken, 'line-exp-inf')

    await seedOauthState({ state: 'st-n10-inf' })
    const res = await callCb('st-n10-inf')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token expired')
    expect(await userCount('exp-inf@line.example')).toBe(0)
  })

  it('[N10 子案 DELTA_RED] now === exp 邊界 → 拒絕（leeway 0；base `>` 放行）', async () => {
    // FIXED_MS 取整秒：base `Date.now()/1000 > exp` 恰 false（放行）、candidate `now >= exp` 為 true
    const FIXED_MS = 1_900_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_MS)

    const idToken = await signLineIdToken(
      lineClaims({ exp: FIXED_MS / 1000, sub: 'line-exp-edge', email: 'exp-edge@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-exp-edge')

    await seedOauthState({ state: 'st-n10-edge' })
    const res = await callCb('st-n10-edge')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token expired')
    expect(await userCount('exp-edge@line.example')).toBe(0)
  })

  // base L725 `payload.exp && now > payload.exp` 對這些值強制轉型後已 true → base 已 400
  // ⚠ 這些**不可**拿來構 DELTA：base-swap 會回 GREEN 而非 RED（PLAN §4.3 R2-1）
  const EXP_ALREADY_REJECTED: Array<{ label: string; exp: unknown }> = [
    { label: '過去的數字',            exp: 1_000_000_000 },
    { label: 'coercible 字串 "1000000000"', exp: '1000000000' },
    { label: '空 array（轉型為 0）',   exp: [] },
    { label: '[123]（轉型為 123）',    exp: [123] },
  ]
  for (const [i, c] of EXP_ALREADY_REJECTED.entries()) {
    it(`[N10 INVARIANT_GREEN] exp ${c.label} → 拒絕（base 既有弱檢查已擋）`, async () => {
      const email = `exp-inv-${i}@line.example`
      const idToken = await signLineIdToken(
        lineClaims({ exp: c.exp, sub: `line-exp-inv${i}`, email }), LINE_SECRET,
      )
      installLineMock(idToken, `line-exp-inv${i}`)

      await seedOauthState({ state: `st-n10-inv${i}` })
      const res = await callCb(`st-n10-inv${i}`)
      expect(res.status).toBe(400)
      expect(await userCount(email)).toBe(0)
    })
  }
})

// ── item 5：nonce ─────────────────────────────────────────────────

describe('PR-2dv item 5 — nonce（移入 verifier + 強制）', () => {
  it('[N11 子案 DELTA_RED] stored.nonce 為空字串 → 拒絕（base falsy 跳過比對）', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ nonce: 'attacker-nonce', sub: 'line-nonce-empty', email: 'nonce-empty@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-nonce-empty')

    await seedOauthState({ state: 'st-n11-empty', nonce: '' })
    const res = await callCb('st-n11-empty')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('id_token nonce mismatch')
    expect(await userCount('nonce-empty@line.example')).toBe(0)
  })

  it('[N12 INVARIANT_GREEN] stored.nonce 已設 + token nonce 不符 → 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ nonce: 'nonce-from-attacker', sub: 'line-nonce-bad', email: 'nonce-bad@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-nonce-bad')

    await seedOauthState({ state: 'st-n12' })
    const res = await callCb('st-n12')
    expect(res.status).toBe(400)
    expect(await userCount('nonce-bad@line.example')).toBe(0)
  })

  it('[N12 子案 INVARIANT_GREEN] stored.nonce 已設 + token nonce 缺席 → 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ nonce: undefined, sub: 'line-nonce-missing', email: 'nonce-missing@line.example' }),
      LINE_SECRET,
    )
    installLineMock(idToken, 'line-nonce-missing')

    await seedOauthState({ state: 'st-n12-missing' })
    const res = await callCb('st-n12-missing')
    expect(res.status).toBe(400)
    expect(await userCount('nonce-missing@line.example')).toBe(0)
  })
})

// ── signature（CHANNEL-SECRET-REQUIRED）───────────────────────────

describe('PR-2dv signature gate', () => {
  it('[N13 INVARIANT_GREEN] 用錯的 secret 簽 → 拒絕', async () => {
    const idToken = await signLineIdToken(
      lineClaims({ sub: 'line-sig-bad', email: 'sig-bad@line.example' }), 'wrong-channel-secret',
    )
    installLineMock(idToken, 'line-sig-bad')

    await seedOauthState({ state: 'st-n13' })
    const res = await callCb('st-n13')
    expect(res.status).toBe(400)
    expect(await userCount('sig-bad@line.example')).toBe(0)
  })

  it('[N13 子案 INVARIANT_GREEN] channel secret 為空字串（misconfig）→ 拒絕', async () => {
    // F-2 CHANNEL-SECRET-REQUIRED。base 亦 400，但成因是 workerd importKey 拒絕 0-length HMAC
    // key 而拋例外（CODE stage 實測；訊息 "Imported HMAC key length (0)…" 會被回顯到錯誤頁）；
    // candidate 改由顯式 guard 擋下並回 generic 訊息，不洩漏 misconfig。故本案 base∧cand 皆 400
    // ＝INVARIANT_GREEN（鎖 fail-closed 契約），不斷言訊息（兩側訊息不同）。
    // 以正常 secret 簽：伺服器端 secret 為 '' 時，任何 token 都必須 fail-closed。
    Object.assign(env, { LINE_CLIENT_SECRET: '' })
    const idToken = await signLineIdToken(
      lineClaims({ sub: 'line-sig-empty', email: 'sig-empty@line.example' }), LINE_SECRET,
    )
    installLineMock(idToken, 'line-sig-empty')

    await seedOauthState({ state: 'st-n13-empty' })
    const res = await callCb('st-n13-empty')
    expect(res.status).toBe(400)
    // 斷言收斂為穩定外部行為：status + 零副作用。刻意不 pin workerd 的 crypto
    // exception 字串（base 走該例外、candidate 走 guard，訊息不同；且 runtime 升級會使其脆弱）。
    expect(await userCount('sig-empty@line.example')).toBe(0)
    expect(await refreshTokenCount()).toBe(0)
  })
})

// ── N15：F-2 CHANNEL-SECRET-REQUIRED load-bearing ─────────────────

describe('PR-2dv N15 — F-2 load-bearing（LINE_CLIENT_SECRET 未設 → key "null"）', () => {
  // N15-SHARED-TOKEN-LOCK：token 只產一次、兩案重用同一字串常數。
  // 若兩案各自呼叫 signer，lineClaims() 的 exp 取自 Date.now()，跨秒邊界會使 payload
  // 差 1 秒 → 簽章不同 → 「唯一變數＝secret 設定」的前提破裂，退化成雙變數比較；
  // 且此破裂是偶發的（多數執行同秒仍全綠＝假安全）。語義相同 ≠ byte 相同。
  let n15IdToken: string

  beforeAll(async () => {
    n15IdToken = await signLineIdToken(
      lineClaims({ sub: 'line-null-key', email: 'null-key@line.example' }),
      NULL_KEY,
    )
  })

  it('[N15 DELTA_RED] secret 未設 + 攻擊者以字面 "null" 為 key 自簽 → 拒絕、零副作用', async () => {
    Object.assign(env, { LINE_CLIENT_SECRET: undefined })   // → cfg.clientSecret = null
    installLineMock(n15IdToken, 'line-null-key')

    await seedOauthState({ state: 'st-n15' })
    const res = await callCb('st-n15')
    const body = await res.text()

    expect(res.status).toBe(400)
    // mock token exchange 成功回傳 ∧ flow 已抵達 verifier
    //（fetchCalls 只證明呼叫發生，不宣稱外部 authorization code 被消費）
    expect(fetchCalls.some(u => u.includes('/oauth2/'))).toBe(true)
    // 止於 verifier、userinfo 之前 → 失敗點在 verifier 內（ORDER-LOCK）
    expect(fetchCalls.some(u => u.includes('/v2/profile'))).toBe(false)
    // 屬 signature 家族 → 排除 alg/iss/aud/exp/nonce gate
    expect(body).toContain('id_token signature invalid')
    // 零帳號／零 session／零 access-token 副作用
    expect(await userCount('null-key@line.example')).toBe(0)
    expect(await refreshTokenCount()).toBe(0)
    expect(body).not.toContain('access_token')
  })

  it('[N15-control INVARIANT_GREEN] secret = 字串 "null" + 同一 token → 200 登入成功', async () => {
    // 單變數差分的另一半：token/claims/簽章與 N15 逐 byte 相同（同一字串常數），
    // 唯一變數＝LINE_CLIENT_SECRET 未設 vs 字串 "null"。本案 200 證明 fixture 的
    // claims 全 valid ∧ 簽章確實可被 key "null" 驗過 ⇒ N15 的 400 不可能來自
    // fixture 瑕疵或其他 gate，只可能源自 typeof channelSecret !== 'string'。
    Object.assign(env, { LINE_CLIENT_SECRET: NULL_KEY })
    installLineMock(n15IdToken, 'line-null-key')

    await seedOauthState({ state: 'st-n15-ctl' })
    const res = await callCb('st-n15-ctl')
    expect(res.status).toBe(200)
    expect(await userCount('null-key@line.example')).toBe(1)
  })
})

// ── config guard（N14＝L76 pre-verifier，非 verifier aud 分支）─────

describe('PR-2dv N14 CONFIG-GUARD（LINE_CLIENT_ID 缺失）', () => {
  // AUD-TEST-LOCK-R2 ②：N14 證的是 callback L76 既有 pre-verifier config guard 的 fail-closed，
  // **不**證 verifier 的 !expectedAud 分支（該分支 UNREACHABLE_BY_CURRENT_CALL_GRAPH_DID）。
  // fetchCalls=[] 機械證明短路發生在任何 provider 外呼之前。
  const MISSING: Array<{ label: string; value: string | undefined }> = [
    { label: 'null（未設定）', value: undefined },
    { label: '空字串',        value: '' },
  ]
  for (const [i, c] of MISSING.entries()) {
    it(`[N14 INVARIANT_GREEN] LINE_CLIENT_ID ${c.label} → 400 且不外呼 provider`, async () => {
      Object.assign(env, { LINE_CLIENT_ID: c.value })
      const idToken = await signLineIdToken(
        lineClaims({ sub: `line-cfg${i}`, email: `cfg-${i}@line.example` }), LINE_SECRET,
      )
      installLineMock(idToken, `line-cfg${i}`)

      await seedOauthState({ state: `st-n14-${i}` })
      const res = await callCb(`st-n14-${i}`)
      expect(res.status).toBe(400)
      expect(fetchCalls).toEqual([])
      expect(await userCount(`cfg-${i}@line.example`)).toBe(0)
    })
  }
})
