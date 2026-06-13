import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { jwtVerify, importJWK } from 'jose'
import {
  resetDb, seedUser, ensureJwtKeys,
  googleSignIdToken, googleJwksBody, seedFactorAddGrant,
} from './_helpers'
import { hashToken } from '../../functions/utils/crypto'
import { signJwt } from '../../functions/utils/jwt'
import {
  onRequestGet as cbGet,
} from '../../functions/api/auth/oauth/[provider]/callback'
import {
  onRequestGet as initGet,
} from '../../functions/api/auth/oauth/[provider]/init'

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
    // Google JWKS — P0-3 id_token 驗章用
    if (url.includes('googleapis.com/oauth2/v3/certs')) {
      const body = await googleJwksBody()
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
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
  Object.assign(env, {
    GOOGLE_CLIENT_ID:     'goog-cid',
    GOOGLE_CLIENT_SECRET: 'goog-sec',
    LINE_CLIENT_ID:       'line-cid',
    LINE_CLIENT_SECRET:   'line-sec',
  })
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
    fetchPlan.tokenBody = {
      access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({
        sub: 'g-12345', email: 'newgoog@example.com', email_verified: true,
      }),
    }
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
      'SELECT COUNT(*) AS n, MAX(session_id) AS sid FROM refresh_tokens WHERE user_id = ?',
    ).bind(u.id).first()
    expect(rt.n).toBe(1)
    expect(rt.sid).toBeTruthy()  // PR5 5d-1b: oauth callback stamps a non-null per-login session_id
  })

  // PR-0（Codex Code Gate r1 blocker）：pc/mobile direct-callback 是 access-only token（無 refresh row）
  // → 不得帶 sid（否則 sid 指向不存在的 session）。factor-add elevation 對該 token fail-closed。
  async function sidFromLocation(loc: string) {
    const m = loc.match(/access_token=([^&]+)/)
    const token = decodeURIComponent(m?.[1] ?? '')
    const pub = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY), 'ES256')
    const { payload } = await jwtVerify(token, pub, { algorithms: ['ES256'] })
    return { token, sid: payload.sid }
  }

  it('PR-0: pc direct-callback → access token 不帶 sid + 不建 refresh row（access-only）', async () => {
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-pc', email: 'pc@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-pc', email: 'pc@example.com', email_verified: true, name: 'PC User' }
    const state = await seedOauthState({ platform: 'pc', clientCallback: 'http://127.0.0.1:8080/callback' })
    const res = await callCb(cbReq(state))
    expect(res.status).toBe(302)
    const { token, sid } = await sidFromLocation(res.headers.get('Location') ?? '')
    expect(token).toBeTruthy()
    expect(sid).toBeUndefined()   // pre-fix(#74 buggy): sid 存在 → RED
    const u = await env.chiyigo_db.prepare('SELECT id FROM users WHERE email = ?').bind('pc@example.com').first()
    const rt = await env.chiyigo_db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?').bind(u.id).first()
    expect(rt.n).toBe(0)   // access-only：無 refresh row（契約一致：無 row ⟺ 無 sid）
  })

  it('PR-0: mobile direct-callback → access token 不帶 sid + 不建 refresh row', async () => {
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-mob', email: 'mob@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-mob', email: 'mob@example.com', email_verified: true, name: 'Mob User' }
    const state = await seedOauthState({ platform: 'mobile' })
    const res = await callCb(cbReq(state))
    expect(res.status).toBe(302)
    const { token, sid } = await sidFromLocation(res.headers.get('Location') ?? '')
    expect(token).toBeTruthy()
    expect(sid).toBeUndefined()
    const u = await env.chiyigo_db.prepare('SELECT id FROM users WHERE email = ?').bind('mob@example.com').first()
    const rt = await env.chiyigo_db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?').bind(u.id).first()
    expect(rt.n).toBe(0)
  })

  // PR-A2（SEC-FACTOR-ADD-A）：OAuth-reauth elevation callback 分支（purpose=elevation）。
  async function seedElevState(stateToken: string, userId: number, { sid = 'SE', action = 'add_passkey' } = {}) {
    const exp = new Date(Date.now() + 600_000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(`
      INSERT INTO oauth_states (state_token, code_verifier, nonce, redirect_uri, platform, expires_at, purpose, elevation_user_id, session_id, action)
      VALUES (?, 'verifier-xyz', NULL, 'https://chiyigo.com/api/auth/oauth/google/callback', 'web', ?, 'elevation', ?, ?, ?)
    `).bind(stateToken, exp, userId, sid, action).run()
  }

  // PR-A3（SEC-FACTOR-ADD P1）：is_binding factor-add 分支。對齊 init.ts 寫入語意——
  //   client_callback='binding:<id>'、purpose='factor_add_binding'、session_id=sid、action='bind_identity'、
  //   factor_add_grant_hash=grantHash。withGrant=false 模擬 pre-PR-A3 / 被竄改 state（無 elevation proof）。
  async function seedBindingState(
    stateToken: string, userId: number,
    { sid = 'BS', grantHash = null as string | null, withGrant = true } = {},
  ) {
    const exp = new Date(Date.now() + 600_000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(`
      INSERT INTO oauth_states (state_token, code_verifier, nonce, redirect_uri, platform, client_callback, expires_at, purpose, elevation_user_id, session_id, action, factor_add_grant_hash)
      VALUES (?, 'verifier-xyz', NULL, 'https://chiyigo.com/api/auth/oauth/google/callback', 'web', ?, ?, ?, ?, ?, 'bind_identity', ?)
    `).bind(
      stateToken, `binding:${userId}`, exp,
      withGrant ? 'factor_add_binding' : null, userId, sid,
      withGrant ? grantHash : null,
    ).run()
  }

  it('PR-A2 elevation: provider_id match 既綁 → 建 exchange + fragment redirect，無 login/bind 副作用', async () => {
    const u = await seedUser({ email: 'elev@example.com' })
    await env.chiyigo_db.prepare(`INSERT INTO user_identities (user_id, provider, provider_id) VALUES (?, 'google', 'g-elev')`).bind(u.id).run()
    await seedElevState('st-elev', u.id, { sid: 'SE', action: 'bind_wallet' })
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-elev', email: 'elev@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-elev', email: 'elev@example.com', email_verified: true, name: '' }

    const res = await callCb(cbReq('st-elev'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain('#elev_exchange=')
    // exchange row 建立（session/action 透傳；provider_id 只存 hash）
    const ex = await env.chiyigo_db.prepare(`SELECT * FROM elevation_exchanges WHERE user_id = ?`).bind(u.id).first()
    expect(ex).toBeTruthy()
    expect(ex.action).toBe('bind_wallet')
    expect(ex.session_id).toBe('SE')
    expect(ex.provider).toBe('google')
    // 無 login/bind 副作用：無 refresh token、無新 identity
    const rt = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS c FROM refresh_tokens WHERE user_id = ?`).bind(u.id).first()
    expect(Number(rt.c)).toBe(0)
    const idCount = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS c FROM user_identities WHERE user_id = ?`).bind(u.id).first()
    expect(Number(idCount.c)).toBe(1)  // 仍只有種子那一筆
  })

  it('PR-A2 elevation: provider_id MISMATCH（攻擊者自己的 OAuth 帳號）→ provider_mismatch + 無 exchange', async () => {
    const u = await seedUser({ email: 'elev2@example.com' })
    await env.chiyigo_db.prepare(`INSERT INTO user_identities (user_id, provider, provider_id) VALUES (?, 'google', 'g-legit')`).bind(u.id).run()
    await seedElevState('st-elev2', u.id, { sid: 'SE2', action: 'add_passkey' })
    // reauth 回來的是攻擊者自己的 google 帳號 g-attacker（≠ 既綁 g-legit）
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-attacker', email: 'attacker@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-attacker', email: 'attacker@example.com', email_verified: true, name: '' }

    const res = await callCb(cbReq('st-elev2'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain('elev_error=provider_mismatch')
    const ex = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS c FROM elevation_exchanges WHERE user_id = ?`).bind(u.id).first()
    expect(Number(ex.c)).toBe(0)
    const audit = await env.chiyigo_db.prepare(`SELECT 1 FROM audit_log WHERE event_type='auth.elevation.provider_mismatch' AND user_id = ?`).bind(u.id).first()
    expect(audit).toBeTruthy()
  })

  it('PR-A2 elevation callback RL（Codex watch item）：達 per-user 上限 → rate_limited，token-exchange 前擋', async () => {
    const u = await seedUser({ email: 'elevrl@example.com' })
    await env.chiyigo_db.prepare(`INSERT INTO user_identities (user_id, provider, provider_id) VALUES (?, 'google', 'g-rl')`).bind(u.id).run()
    // 預填 10 筆 elevation_oauth_callback 計數（達 max=10）→ 下一次 callback checkRateLimit 即 blocked
    for (let i = 0; i < 10; i++) {
      await env.chiyigo_db.prepare(`INSERT INTO login_attempts (kind, user_id) VALUES ('elevation_oauth_callback', ?)`).bind(u.id).run()
    }
    await seedElevState('st-elevrl', u.id, { sid: 'SRL', action: 'add_passkey' })
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-rl', email: 'elevrl@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-rl', email: 'elevrl@example.com', email_verified: true, name: '' }

    const res = await callCb(cbReq('st-elevrl'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain('elev_error=rate_limited')
    // RL 命中 → 無 exchange 建立（token-exchange 前已擋）
    const ex = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS c FROM elevation_exchanges WHERE user_id = ?`).bind(u.id).first()
    expect(Number(ex.c)).toBe(0)
  })

  // ── PR-A3（SEC-FACTOR-ADD P1 封閉）：is_binding 綁新 OAuth identity 需 factor-add grant ──
  it('PR-A3 binding: factor_add_binding state + 有效 grant → 綁定成功 + identity 寫入 + grant 消耗', async () => {
    const u = await seedUser({ email: 'bind-ok@example.com' })
    const grantToken = await seedFactorAddGrant(u.id, { sid: 'BS-OK', action: 'bind_identity' })
    const grantHash  = await hashToken(grantToken)
    await seedBindingState('st-bind-ok', u.id, { sid: 'BS-OK', grantHash })
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-bind-ok', email: 'bind-ok@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-bind-ok', email: 'bind-ok@example.com', email_verified: true, name: 'BindOK' }

    const res = await callCb(cbReq('st-bind-ok'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain('bind=success')

    const ident = await env.chiyigo_db.prepare(
      'SELECT user_id FROM user_identities WHERE provider = ? AND provider_id = ?',
    ).bind('google', 'g-bind-ok').first()
    expect(ident?.user_id).toBe(u.id)

    // grant 必被消耗（atomic batch S1）
    const grantRow = await env.chiyigo_db.prepare(
      `SELECT consumed_at FROM elevation_grants WHERE user_id = ? AND action = 'bind_identity'`,
    ).bind(u.id).first()
    expect(grantRow?.consumed_at).not.toBeNull()
  })

  // P1-closure RED：pre-PR-A3 binding state（無 factor proof）→ callback 不得綁。
  // pre-fix（無 gate）此情境會 INSERT identity（= 偷到 access token 即可加因子）；post-fix → elevation_required。
  it('PR-A3 binding: 無 factor_add grant 的 binding state → bind_error=elevation_required，無 identity 寫入', async () => {
    const u = await seedUser({ email: 'bind-nogr@example.com' })
    await seedBindingState('st-bind-nogr', u.id, { sid: 'BS-NG', withGrant: false })
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-bind-nogr', email: 'bind-nogr@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-bind-nogr', email: 'bind-nogr@example.com', email_verified: true, name: 'X' }

    const res = await callCb(cbReq('st-bind-nogr'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain('bind_error=elevation_required')
    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM user_identities WHERE provider_id = ?',
    ).bind('g-bind-nogr').first()
    expect(cnt.n).toBe(0)
  })

  // P1-closure：grant 已消耗（replay 同一 binding state）→ CAS changes=0 → 不綁 + replay_detected。
  it('PR-A3 binding: grant 已消耗（replay）→ bind_error=elevation_consumed + 無 identity + replay audit', async () => {
    const u = await seedUser({ email: 'bind-rp@example.com' })
    const grantToken = await seedFactorAddGrant(u.id, { sid: 'BS-RP', action: 'bind_identity', consumed: true })
    const grantHash  = await hashToken(grantToken)
    await seedBindingState('st-bind-rp', u.id, { sid: 'BS-RP', grantHash })
    fetchPlan.tokenBody = { access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({ sub: 'g-bind-rp', email: 'bind-rp@example.com', email_verified: true }) }
    fetchPlan.profileBody = { sub: 'g-bind-rp', email: 'bind-rp@example.com', email_verified: true, name: 'X' }

    const res = await callCb(cbReq('st-bind-rp'))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location') ?? '').toContain('bind_error=elevation_consumed')
    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM user_identities WHERE provider_id = ?',
    ).bind('g-bind-rp').first()
    expect(cnt.n).toBe(0)

    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.elevation.replay_detected' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).toBeTruthy()
  })

  it('信箱碰撞 + trustEmail=true (google) + email_verified=true → 靜默綁定（C2）', async () => {
    const u = await seedUser({ email: 'collide@example.com', password: 'OldPass#1234', emailVerified: 0 })
    fetchPlan.tokenBody = {
      access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({
        sub: 'g-collide', email: 'collide@example.com', email_verified: true,
      }),
    }
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
    fetchPlan.tokenBody = {
      access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({
        sub: 'g-unver', email: 'unverified@example.com', email_verified: false,
      }),
    }
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

    fetchPlan.tokenBody = {
      access_token: 'fake-tok', token_type: 'Bearer',
      id_token: await googleSignIdToken({
        sub: 'g-return', email: 'returning@example.com', email_verified: true,
      }),
    }
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

// ── PR-A3（SEC-FACTOR-ADD P1）：init is_binding 入口 gate ───────────────────────
// callback 是 consume 端；init 是 validate 端。init 要求 factor-add grant 才肯起 binding OAuth flow
// 並把 grant_hash 寫進 oauth_states 供 callback consume。此處鎖 init 側的 fail-closed + state 正確性。
describe('GET /api/auth/oauth/[provider]/init — SEC-FACTOR-ADD P1 binding gate', () => {
  async function bindUserToken(userId: number, sid: string) {
    return signJwt(
      { sub: String(userId), email: 'b@x', role: 'player', status: 'active', ver: 0,
        scope: 'read:profile write:profile', sid },
      '15m', env, { audience: 'chiyigo' },
    )
  }
  function initBindReq(token: string, grantToken: string | null = null) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (grantToken) headers['X-Factor-Add-Grant'] = grantToken
    // 不帶 CF-Connecting-IP → 跳過 per-IP rate limit，隔離 gate 行為
    return new Request('http://localhost/api/auth/oauth/google/init?platform=web&is_binding=true', { method: 'GET', headers })
  }
  function callInit(req) {
    return initGet({ request: req, env, params: { provider: 'google' } })
  }

  it('P1: is_binding 無 grant header → 403 FACTOR_ADD_GRANT_REQUIRED + 不建 binding state', async () => {
    const u = await seedUser({ email: 'init-nogr@example.com' })
    const tok = await bindUserToken(u.id, 'IB-NG')
    const res = await callInit(initBindReq(tok))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FACTOR_ADD_GRANT_REQUIRED')
    const cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM oauth_states WHERE client_callback = ?`,
    ).bind(`binding:${u.id}`).first()
    expect(cnt.n).toBe(0)
  })

  it('P1: is_binding 但 access token 無 sid → 403 ELEVATION_SID_REQUIRED（fail-closed）', async () => {
    const u = await seedUser({ email: 'init-nosid@example.com' })
    const noSidTok = await signJwt(
      { sub: String(u.id), email: 'init-nosid@example.com', role: 'player', status: 'active', ver: 0,
        scope: 'read:profile write:profile' },
      '15m', env, { audience: 'chiyigo' },
    )
    const grant = await seedFactorAddGrant(u.id, { sid: 'IB-NS', action: 'bind_identity' })
    const res = await callInit(initBindReq(noSidTok, grant))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ELEVATION_SID_REQUIRED')
  })

  it('P1: is_binding + 有效 bind_identity grant → 200 redirect_url + binding state（purpose=factor_add_binding + grant_hash）', async () => {
    const u = await seedUser({ email: 'init-ok@example.com' })
    const sid = 'IB-OK'
    const tok = await bindUserToken(u.id, sid)
    const grantToken = await seedFactorAddGrant(u.id, { sid, action: 'bind_identity' })
    const grantHash  = await hashToken(grantToken)
    const res = await callInit(initBindReq(tok, grantToken))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirect_url).toMatch(/google/i)

    const st = await env.chiyigo_db.prepare(
      `SELECT purpose, session_id, action, factor_add_grant_hash FROM oauth_states WHERE client_callback = ?`,
    ).bind(`binding:${u.id}`).first()
    expect(st).toBeTruthy()
    expect(st.purpose).toBe('factor_add_binding')
    expect(st.session_id).toBe(sid)
    expect(st.action).toBe('bind_identity')
    expect(st.factor_add_grant_hash).toBe(grantHash)  // init validate-not-consume：hash 透傳給 callback
  })

  it('P1: is_binding + cross-action grant（add_passkey）→ 403 + 不建 binding state', async () => {
    const u = await seedUser({ email: 'init-xact@example.com' })
    const sid = 'IB-XA'
    const tok = await bindUserToken(u.id, sid)
    const wrongGrant = await seedFactorAddGrant(u.id, { sid, action: 'add_passkey' })  // 非 bind_identity
    const res = await callInit(initBindReq(tok, wrongGrant))
    expect(res.status).toBe(403)
    const cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM oauth_states WHERE client_callback = ?`,
    ).bind(`binding:${u.id}`).first()
    expect(cnt.n).toBe(0)
  })
})
