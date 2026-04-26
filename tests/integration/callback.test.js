import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import {
  resetDb, seedUser, ensureJwtKeys,
} from './_helpers.js'
import {
  onRequestGet as cbGet,
} from '../../functions/api/auth/oauth/[provider]/callback.js'

const BASE = 'http://localhost/api/auth/oauth'

// ── 通用：seed oauth_states，回傳 state_token 字串 ─────────────────
async function seedOauthState({
  state = 'state-' + Math.random().toString(36).slice(2),
  codeVerifier = 'verifier-xyz',
  redirectUri = 'https://chiyigo.com/api/auth/oauth/google/callback',
  platform = 'web',
  clientCallback = null,
  ttlSec = 600,
} = {}) {
  const exp = new Date(Date.now() + ttlSec * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(`INSERT INTO oauth_states
      (state_token, code_verifier, redirect_uri, platform, client_callback, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(state, codeVerifier, redirectUri, platform, clientCallback, exp)
    .run()
  return state
}

function callCb(req, provider = 'google') {
  return cbGet({
    request: req,
    env,
    params: { provider },
    waitUntil: () => {},
    data: {},
    next: async () => new Response('next'),
  })
}

function cbReq(state, code = 'auth-code-abc', provider = 'google') {
  const url = `${BASE}/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
  return new Request(url, { method: 'GET', headers: { 'CF-Connecting-IP': '1.2.3.4' } })
}

// ── Mock fetch：根據 URL 決定回什麼 ────────────────────────────────
let fetchPlan  // { tokenStatus, tokenBody, profileStatus, profileBody }

function makeFetchMock(plan) {
  return vi.fn(async (input /* , init */) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('oauth2/v') && url.includes('token')) {
      // google / line token endpoints
      return new Response(JSON.stringify(plan.tokenBody ?? { access_token: 'fake-tok', token_type: 'Bearer' }), {
        status: plan.tokenStatus ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('oauth2.googleapis.com/token') || url.includes('api.line.me/oauth2')) {
      return new Response(JSON.stringify(plan.tokenBody ?? { access_token: 'fake-tok' }), {
        status: plan.tokenStatus ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('googleapis.com/oauth2') || url.includes('api.line.me/v2/profile')) {
      return new Response(JSON.stringify(plan.profileBody ?? {}), {
        status: plan.profileStatus ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('not-mocked', { status: 599 })
  })
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})

beforeEach(async () => {
  await resetDb()
  env.GOOGLE_CLIENT_ID     = 'goog-cid'
  env.GOOGLE_CLIENT_SECRET = 'goog-sec'
  env.LINE_CLIENT_ID       = 'line-cid'
  env.LINE_CLIENT_SECRET   = 'line-sec'
  fetchPlan = {}
  vi.stubGlobal('fetch', makeFetchMock(fetchPlan))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/auth/oauth/[provider]/callback', () => {
  it('state 不存在 / 過期 → 400 htmlError', async () => {
    // 不 seed → 直接打 callback
    const res = await callCb(cbReq('nonexistent-state'))
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toMatch(/已過期或無效|登入階段/)

    // 過期狀態也應拒絕
    await seedOauthState({ state: 'expired-state', ttlSec: -10 })
    const res2 = await callCb(cbReq('expired-state'))
    expect(res2.status).toBe(400)
  })

  it('PKCE / token 交換失敗 → 400 htmlError（IdP 回 4xx）', async () => {
    fetchPlan.tokenStatus = 400
    fetchPlan.tokenBody   = { error: 'invalid_grant', error_description: 'PKCE verifier mismatch' }
    const state = await seedOauthState()
    const res = await callCb(cbReq(state))
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toMatch(/無法向.*換取 Token/)
    // oauth_states 已被原子核銷
    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM oauth_states WHERE state_token = ?',
    ).bind(state).first()
    expect(cnt.n).toBe(0)
  })

  it('全新用戶（google, email_verified=true）→ 200 + users + user_identities + refresh_tokens（L9：用 last_row_id）', async () => {
    fetchPlan.profileBody = {
      sub:            'g-12345',
      email:          'newgoog@example.com',
      email_verified: true,
      name:           'Goog User',
      picture:        'https://example.com/a.png',
    }
    const state = await seedOauthState({ platform: 'web' })
    const res = await callCb(cbReq(state))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/)
    expect(res.headers.get('Set-Cookie')).toMatch(/^chiyigo_refresh=[0-9a-f]{64};/)

    // users row（email_verified=1）
    const u = await env.chiyigo_db.prepare(
      'SELECT id, email_verified FROM users WHERE email = ?',
    ).bind('newgoog@example.com').first()
    expect(u).toBeTruthy()
    expect(u.email_verified).toBe(1)

    // user_identities row（用 last_row_id 寫入）
    const ident = await env.chiyigo_db.prepare(
      'SELECT user_id, provider_id, display_name FROM user_identities WHERE provider = ? AND provider_id = ?',
    ).bind('google', 'g-12345').first()
    expect(ident).toBeTruthy()
    expect(ident.user_id).toBe(u.id)
    expect(ident.display_name).toBe('Goog User')

    // refresh_tokens row
    const rt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?',
    ).bind(u.id).first()
    expect(rt.n).toBe(1)
  })

  it('信箱碰撞 + trustEmail=true (google) + email_verified=true → 靜默綁定（C2）', async () => {
    const u = await seedUser({ email: 'collide@example.com', password: 'OldPass#1234', emailVerified: 0 })
    fetchPlan.profileBody = {
      sub:            'g-collide',
      email:          'collide@example.com',
      email_verified: true,
      name:           'Collide',
    }
    const state = await seedOauthState({ platform: 'web' })
    const res = await callCb(cbReq(state))
    expect(res.status).toBe(200)

    // user_identities 已綁到既有 user
    const ident = await env.chiyigo_db.prepare(
      'SELECT user_id FROM user_identities WHERE provider = ? AND provider_id = ?',
    ).bind('google', 'g-collide').first()
    expect(ident.user_id).toBe(u.id)

    // users.email_verified 升為 1
    const row = await env.chiyigo_db.prepare(
      'SELECT email_verified FROM users WHERE id = ?',
    ).bind(u.id).first()
    expect(row.email_verified).toBe(1)
  })

  it('信箱碰撞 + trustEmail=true 但 email_verified=false → 403 拒絕（C2 雙重守門）', async () => {
    const u = await seedUser({ email: 'unverified@example.com', password: 'OldPass#1234' })
    fetchPlan.profileBody = {
      sub:            'g-unver',
      email:          'unverified@example.com',
      email_verified: false,
      name:           'NotVer',
    }
    const state = await seedOauthState({ platform: 'web' })
    const res = await callCb(cbReq(state))
    expect(res.status).toBe(403)

    // 未建立 user_identities
    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM user_identities WHERE provider_id = ?',
    ).bind('g-unver').first()
    expect(cnt.n).toBe(0)
    // 未額外建立 user
    const userCnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE email = ?',
    ).bind('unverified@example.com').first()
    expect(userCnt.n).toBe(1)  // 仍只有原本的 seedUser
    // 沒升級 email_verified
    const row = await env.chiyigo_db.prepare(
      'SELECT email_verified FROM users WHERE id = ?',
    ).bind(u.id).first()
    expect(row.email_verified).toBe(1)  // seedUser 預設 1（未被改動）
  })

  it('信箱碰撞 + 不信任 IdP (line, trustEmail=false) → 403 拒絕', async () => {
    await seedUser({ email: 'line@example.com', password: 'OldPass#1234' })
    fetchPlan.profileBody = {
      userId:      'line-uid-1',
      displayName: 'LineUser',
      pictureUrl:  null,
      email:       'line@example.com',
    }
    const state = await seedOauthState({
      redirectUri: 'https://chiyigo.com/api/auth/oauth/line/callback',
    })
    const res = await callCb(cbReq(state, 'auth-code-line', 'line'), 'line')
    expect(res.status).toBe(403)
    const body = await res.text()
    expect(body).toMatch(/已透過密碼登入|line/i)

    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM user_identities WHERE provider = ?',
    ).bind('line').first()
    expect(cnt.n).toBe(0)
  })

  it('既有 identity（同 provider+provider_id）→ 不再造新 user，只更新 display_name/avatar', async () => {
    // 預先建立 user + identity
    const u = await seedUser({ email: 'returning@example.com', password: 'OldPass#1234' })
    await env.chiyigo_db.prepare(
      `INSERT INTO user_identities (user_id, provider, provider_id, display_name, avatar_url)
       VALUES (?, 'google', 'g-return', 'OldName', 'old.png')`,
    ).bind(u.id).run()

    fetchPlan.profileBody = {
      sub:            'g-return',
      email:          'returning@example.com',
      email_verified: true,
      name:           'NewName',
      picture:        'new.png',
    }
    const state = await seedOauthState({ platform: 'web' })
    const res = await callCb(cbReq(state))
    expect(res.status).toBe(200)

    // 不會多出新 user
    const userCnt = await env.chiyigo_db.prepare('SELECT COUNT(*) AS n FROM users').first()
    expect(userCnt.n).toBe(1)

    // identity 被 update（display_name / avatar_url 換新）
    const ident = await env.chiyigo_db.prepare(
      'SELECT display_name, avatar_url FROM user_identities WHERE provider = ? AND provider_id = ?',
    ).bind('google', 'g-return').first()
    expect(ident.display_name).toBe('NewName')
    expect(ident.avatar_url).toBe('new.png')
  })
})
