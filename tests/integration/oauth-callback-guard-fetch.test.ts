/**
 * PR-2du 棒5a — OAuth callback File-narrow guard + provider fetch 韌性
 *
 * 17 cases、兩類（SPEC-D-5）：
 *   DELTA_RED (11)      base RED → candidate GREEN（新增行為 delta）
 *   INVARIANT_GREEN (6) base GREEN ∧ candidate GREEN（no-weakening）
 *
 * DELTA_RED       = T1 T2 T4 T4b T5 T5b T8 T8b T8c T9 T17
 * INVARIANT_GREEN = T3 T6 T6b T7 T10 T11
 *
 * 分類靠 fetchCalls 記錄器機械斷言（禁靠推理）。timeout 用 OAUTH_FETCH_TIMEOUT_MS='50'
 * 壓到 <1s（否則真等 8s/5s）。timeout mock 必須 honor abort 才 reject。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys } from './_helpers'
import {
  onRequestGet as cbGet,
  onRequestPost as cbPost,
} from '../../functions/api/auth/oauth/[provider]/callback'
// namespace import：容忍 base 無此 export（base callbackMod.parseFetchTimeoutMs===undefined
// → T17 於 base RED，不破壞其餘 16 case 的 base 編譯 / evidence）
import * as callbackMod from '../../functions/api/auth/oauth/[provider]/callback'

const BASE = 'http://localhost/api/auth/oauth'

// ── file-local helpers ────────────────────────────────────────────

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
function b64urlString(s) { return b64url(new TextEncoder().encode(s)) }

/** Sign an HS256 LINE id_token（file-local；不 promote 到 _helpers，promote 屬 PR-2dv）。 */
async function signLineIdToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const data = `${b64urlString(JSON.stringify(header))}.${b64urlString(JSON.stringify(payload))}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${b64url(sig)}`
}

async function seedOauthState({ state, nonce = null, platform = 'web', codeVerifier = 'verifier-xyz' }) {
  const exp = new Date(Date.now() + 600_000).toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db.prepare(
    `INSERT INTO oauth_states (state_token, code_verifier, nonce, redirect_uri, platform, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(state, codeVerifier, nonce, 'https://chiyigo.com/cb', platform, exp).run()
}

async function stateRowExists(state) {
  const row = await env.chiyigo_db
    .prepare('SELECT state_token FROM oauth_states WHERE state_token = ?').bind(state).first()
  return !!row
}

function callGet(provider, state, code = 'auth-code') {
  const url = `${BASE}/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
  // 傳完整 EventContext literal；handler ctx 的 [key:string]:unknown 吸收 waitUntil/data/next
  return cbGet({
    request: new Request(url, { method: 'GET', headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
    env, params: { provider }, waitUntil: () => {}, data: {}, next: async () => new Response('next'),
  })
}

function callPost(provider, body, contentType) {
  return cbPost({
    request: new Request(`${BASE}/${provider}/callback`, {
      method: 'POST', headers: { 'Content-Type': contentType, 'CF-Connecting-IP': '1.2.3.4' }, body,
    }),
    env, params: { provider }, waitUntil: () => {}, data: {}, next: async () => new Response('next'),
  })
}

/** multipart body；帶 filename 的 part 會被 FormData parser 當 File。 */
function multipart(parts: Array<{ name: string; value: string; filename?: string }>) {
  const B = 'ZZBOUNDARYZZ'
  let body = ''
  for (const p of parts) {
    body += `--${B}\r\nContent-Disposition: form-data; name="${p.name}"`
    if (p.filename) body += `; filename="${p.filename}"`
    body += '\r\n'
    if (p.filename) body += 'Content-Type: text/plain\r\n'
    body += '\r\n' + p.value + '\r\n'
  }
  body += `--${B}--\r\n`
  // poisoned CT：真實 media type 是 multipart，但通過 callback.ts:61 的 .includes() 子字串守門
  return { body, ct: `multipart/form-data; boundary=${B}; probe=application/x-www-form-urlencoded` }
}

// ── fetch mock（fetchCalls 記錄器 + 每 URL 可給序列行為）───────────

let fetchCalls: string[]
const isToken = (u: string) => u.includes('/token')
const isUserinfo = (u: string) => u.includes('/users/@me') || u.includes('/v2/profile')
const countToken = () => fetchCalls.filter(isToken).length
const countUserinfo = () => fetchCalls.filter(isUserinfo).length

// behavior：物件=200 JSON；數字=該 status；'hang'=fetch 掛住 honor abort；
// 'body-stall'=200 headers 但 json() 掛住 honor abort；'network'=reject；'bad-json'=200 壞 body
async function behave(b, init) {
  if (b === 'hang') {
    return new Promise((_res, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  }
  if (b === 'body-stall') {
    return {
      ok: true, status: 200,
      json: () => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('body aborted')), { once: true })),
    }
  }
  if (b === 'network') throw new Error('network')
  if (b === 'bad-json') return new Response('not json{', { status: 200 })
  if (typeof b === 'number') {
    return new Response(JSON.stringify({ error: 'x' }), { status: b, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** token/userinfo 各可給單一 behavior 或 behavior 陣列（依 attempt 序）。 */
function installMock(plan: { token?: unknown; userinfo?: unknown } = {}) {
  const { token, userinfo } = plan
  const tSeq = Array.isArray(token) ? [...token] : null
  const uSeq = Array.isArray(userinfo) ? [...userinfo] : null
  let tI = 0, uI = 0
  const fn = vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    fetchCalls.push(url)
    if (isToken(url)) return behave(tSeq ? tSeq[tI++] : (token ?? { access_token: 'tok' }), init)
    if (isUserinfo(url)) return behave(uSeq ? uSeq[uI++] : userinfo, init)
    return new Response('not-mocked', { status: 599 })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const DISCORD_PROFILE = { id: 'd-1', email: 'd1@ex.com', username: 'U', verified: true }

// ── setup ─────────────────────────────────────────────────────────

beforeAll(async () => { await ensureJwtKeys(); await resetDb() })

beforeEach(async () => {
  await resetDb()
  Object.assign(env, {
    DISCORD_CLIENT_ID: 'd-cid', DISCORD_CLIENT_SECRET: 'd-sec',
    APPLE_CLIENT_ID:   'a-cid', APPLE_CLIENT_SECRET:   'a-sec',
    LINE_CLIENT_ID:    'line-cid', LINE_CLIENT_SECRET: 'line-channel-secret',
    OAUTH_FETCH_TIMEOUT_MS: undefined,   // 每 test 預設不 override；timeout case 自行設 '50'
  })
  fetchCalls = []
})

afterEach(() => { vi.unstubAllGlobals() })

// ══════════════════════════════════════════════════════════════════
// DELTA_RED — File guard（T1/T2）
// ══════════════════════════════════════════════════════════════════

describe('PR-2du guard + fetch resilience', () => {
  it('T1 [DELTA_RED] poisoned multipart, code=File → 400、無 token 外呼、state row 未燒', async () => {
    installMock({})
    await seedOauthState({ state: 'st1' })
    const { body, ct } = multipart([{ name: 'code', value: 'X', filename: 'c.txt' }, { name: 'state', value: 'st1' }])
    const res = await callPost('discord', body, ct)
    expect(res.status).toBe(400)
    expect(countToken()).toBe(0)
    expect(await stateRowExists('st1')).toBe(true)
  })

  it('T2 [DELTA_RED] poisoned multipart, state=File → 400 htmlError、不 throw（非 D1_TYPE_ERROR 500）', async () => {
    installMock({})
    await seedOauthState({ state: 'st2' })
    const { body, ct } = multipart([{ name: 'code', value: 'c' }, { name: 'state', value: 'st2', filename: 's.txt' }])
    // base（無 guard）：state=File → db.bind(File) 拋 D1_TYPE_ERROR → await 直接 reject → RED；
    // candidate：guard 先 fail-closed → 400、不 throw → GREEN
    const res = await callPost('discord', body, ct)
    expect(res.status).toBe(400)
    expect(countToken()).toBe(0)
  })

  it('T3 [INVARIANT_GREEN] 合法 apple form_post → guard 未擋、到 token exchange（fetchCalls 含 apple token）', async () => {
    installMock({})
    await seedOauthState({ state: 'st3' })
    // 合法 urlencoded：code/state 為 string → guard 通過 → 走到 apple token exchange
    const res = await callPost('apple', 'code=auth-code&state=st3', 'application/x-www-form-urlencoded; charset=UTF-8')
    // apple 之後因無有效 id_token 會 400，但本 case 只證 guard 未擋 + 到 exchange
    expect(res.status).toBe(400)
    expect(fetchCalls.some((u) => u.includes('appleid.apple.com/auth/token'))).toBe(true)
  })

  // ── DELTA_RED — token timeout（T4/T4b）──────────────────────────

  it('T4 [DELTA_RED] token fetch-timeout → abort → 400、token 恰 1 次、<1s', async () => {
    env.OAUTH_FETCH_TIMEOUT_MS = '50'
    installMock({ token: 'hang' })
    await seedOauthState({ state: 'st4' })
    const t0 = Date.now()
    const res = await callGet('discord', 'st4')
    expect(res.status).toBe(400)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(countToken()).toBe(1)
    // no-config-leak lock（code-self-review #5）：bare ctrl.abort() ⇒ err.message 無 timeout 值；
    // 若 regress 成 email.ts 式描述性 abort（`...${timeoutMs}ms`），htmlError body 會出現 `\d+ms`
    const body = await res.text()
    expect(body).not.toMatch(/\d+\s?ms/)
  })

  it('T4b [DELTA_RED] token body-stall timeout → abort → 400、token 恰 1 次、<1s', async () => {
    env.OAUTH_FETCH_TIMEOUT_MS = '50'
    installMock({ token: 'body-stall' })
    await seedOauthState({ state: 'st4b' })
    const t0 = Date.now()
    const res = await callGet('discord', 'st4b')
    expect(res.status).toBe(400)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(countToken()).toBe(1)
  })

  // ── DELTA_RED — userinfo retry（T5/T5b/T8/T8b/T8c/T9）───────────

  it('T5 [DELTA_RED] userinfo 5xx→200：登入成功、userinfo 恰 2 次', async () => {
    installMock({ token: { access_token: 'tok' }, userinfo: [500, DISCORD_PROFILE] })
    await seedOauthState({ state: 'st5' })
    const res = await callGet('discord', 'st5')
    expect(res.status).toBe(200)
    expect(countUserinfo()).toBe(2)
  })

  it('T5b [DELTA_RED] userinfo 兩次皆 5xx（resolved-5xx 分支耗盡）→ 400、userinfo 恰 2 次', async () => {
    installMock({ token: { access_token: 'tok' }, userinfo: [500, 500] })
    await seedOauthState({ state: 'st5b' })
    const res = await callGet('discord', 'st5b')
    expect(res.status).toBe(400)
    expect(countUserinfo()).toBe(2)
  })

  it('T8 [DELTA_RED] userinfo fetch-timeout→200：登入成功、userinfo 恰 2 次', async () => {
    env.OAUTH_FETCH_TIMEOUT_MS = '50'
    installMock({ token: { access_token: 'tok' }, userinfo: ['hang', DISCORD_PROFILE] })
    await seedOauthState({ state: 'st8' })
    const t0 = Date.now()
    const res = await callGet('discord', 'st8')
    expect(res.status).toBe(200)
    expect(countUserinfo()).toBe(2)
    expect(Date.now() - t0).toBeLessThan(1500)   // 完成上限（code-self-review #4）：override 若失效退回 5s default 會超標
  })

  it('T8b [DELTA_RED] userinfo body-stall timeout→200：登入成功、userinfo 恰 2 次', async () => {
    env.OAUTH_FETCH_TIMEOUT_MS = '50'
    installMock({ token: { access_token: 'tok' }, userinfo: ['body-stall', DISCORD_PROFILE] })
    await seedOauthState({ state: 'st8b' })
    const t0 = Date.now()
    const res = await callGet('discord', 'st8b')
    expect(res.status).toBe(200)
    expect(countUserinfo()).toBe(2)
    expect(Date.now() - t0).toBeLessThan(1500)   // 完成上限（code-self-review #4）
  })

  it('T8c [DELTA_RED] userinfo 兩次皆 timeout（rejection/timeout 分支耗盡）→ 400、userinfo 恰 2 次', async () => {
    env.OAUTH_FETCH_TIMEOUT_MS = '50'
    installMock({ token: { access_token: 'tok' }, userinfo: ['hang', 'hang'] })
    await seedOauthState({ state: 'st8c' })
    const t0 = Date.now()
    const res = await callGet('discord', 'st8c')
    expect(res.status).toBe(400)
    expect(countUserinfo()).toBe(2)
    expect(Date.now() - t0).toBeLessThan(1500)   // 完成上限（code-self-review #4）
  })

  it('T9 [DELTA_RED] userinfo network-error→200：登入成功、userinfo 恰 2 次', async () => {
    installMock({ token: { access_token: 'tok' }, userinfo: ['network', DISCORD_PROFILE] })
    await seedOauthState({ state: 'st9' })
    const res = await callGet('discord', 'st9')
    expect(res.status).toBe(200)
    expect(countUserinfo()).toBe(2)
  })

  // ── INVARIANT_GREEN — no-retry / verify-first / malformed（T6/T6b/T7/T10/T11）──

  it('T6 [INVARIANT_GREEN] userinfo 401 → 400、userinfo 恰 1 次（不 retry 4xx）', async () => {
    installMock({ token: { access_token: 'tok' }, userinfo: 401 })
    await seedOauthState({ state: 'st6' })
    const res = await callGet('discord', 'st6')
    expect(res.status).toBe(400)
    expect(countUserinfo()).toBe(1)
  })

  it('T6b [INVARIANT_GREEN] userinfo 429 → 400、userinfo 恰 1 次（不 retry 429）', async () => {
    installMock({ token: { access_token: 'tok' }, userinfo: 429 })
    await seedOauthState({ state: 'st6b' })
    const res = await callGet('discord', 'st6b')
    expect(res.status).toBe(400)
    expect(countUserinfo()).toBe(1)
  })

  it('T7 [INVARIANT_GREEN] token 5xx → 400、token 恰 1 次（token exchange 永不 retry）', async () => {
    installMock({ token: 500 })
    await seedOauthState({ state: 'st7' })
    const res = await callGet('discord', 'st7')
    expect(res.status).toBe(400)
    expect(countToken()).toBe(1)
  })

  it('T10 [INVARIANT_GREEN] LINE id_token 簽章無效（wrong secret）→ 400、userinfo 恰 0 次（verify 在 retry loop 外）', async () => {
    const idToken = await signLineIdToken(
      { iss: 'https://access.line.me', sub: 'line-1', aud: 'line-cid', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'n' },
      'WRONG-secret',   // 非 cfg.clientSecret('line-channel-secret') → HMAC 驗證失敗
    )
    installMock({ token: { access_token: 'tok', id_token: idToken }, userinfo: { userId: 'line-1' } })
    await seedOauthState({ state: 'st10', nonce: 'n' })
    const res = await callGet('line', 'st10')
    expect(res.status).toBe(400)
    expect(countUserinfo()).toBe(0)
  })

  it('T11 [INVARIANT_GREEN] userinfo 200 但 body 非法 JSON（malformed、非 timeout）→ 400、userinfo 恰 1 次（不 retry）', async () => {
    installMock({ token: { access_token: 'tok' }, userinfo: 'bad-json' })
    await seedOauthState({ state: 'st11' })
    const res = await callGet('discord', 'st11')
    expect(res.status).toBe(400)
    expect(countUserinfo()).toBe(1)
  })

  it('T17 [DELTA_RED] parseFetchTimeoutMs：上限 clamp + <10/invalid fallback 不變量（code-self-review #3）', () => {
    const p = callbackMod.parseFetchTimeoutMs   // base 無此 export → undefined → 本 case base RED
    expect(p({ ...env, OAUTH_FETCH_TIMEOUT_MS: '99999999' }, 8000)).toBe(15000)  // 上限 clamp（禁無限等）
    expect(p({ ...env, OAUTH_FETCH_TIMEOUT_MS: '15000' }, 8000)).toBe(15000)     // 邊界
    expect(p({ ...env, OAUTH_FETCH_TIMEOUT_MS: '5' }, 8000)).toBe(8000)          // <10 → fallback
    expect(p({ ...env, OAUTH_FETCH_TIMEOUT_MS: 'abc' }, 8000)).toBe(8000)        // invalid → fallback
    expect(p({ ...env, OAUTH_FETCH_TIMEOUT_MS: '' }, 5000)).toBe(5000)           // empty → fallback
    expect(p({ ...env, OAUTH_FETCH_TIMEOUT_MS: undefined }, 5000)).toBe(5000)    // unset → fallback
    expect(p({ ...env, OAUTH_FETCH_TIMEOUT_MS: '3000' }, 8000)).toBe(3000)       // 合法 → 直用
  })
})
