/**
 * F7: OAuth bind-email 整合測試
 *
 * 涵蓋：
 *  1. 成功路徑：合法 temp_bind token + 新 email → 建 user + identity + audit
 *  2. F6 canonicalize：JWT 內 provider='Google'（mixed-case）→ DB 寫入 'google'
 *  3. F1 defense-in-depth：JWT 內 provider 不在 allowlist → 400 + audit fail
 *  4. F8 觀測性：unsupported_provider / link_already_used 都留 oauth.bind_email.fail
 *  5. 一次性 token（codex r5 H1）：同 jti 第二次 → 401 LINK_ALREADY_USED + 不鑄新 session
 *  6. Device binding（codex r5 M1）：chiyigo_oauth_device cookie → refresh_tokens.device_uuid
 *  7. token 各失敗變體：LINK_TYPE_INVALID / LINK_INVALID_OR_EXPIRED / TOKEN_DATA_INCOMPLETE
 *  8. email 與既有帳號碰撞 → 409 EMAIL_USED_BIND_AFTER_LOGIN + audit warn
 *  9. legit retry：不同 jti 同 (provider, provider_id) → 沿用 user_id
 * 10. 入口校驗 + 非 JSON body
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { decodeJwt } from 'jose'
import { onRequestPost as bindEmailPost } from '../../functions/api/auth/oauth/bind-email'

const URL_PATH = 'http://localhost/api/auth/oauth/bind-email'

function callBindEmail(body, { headers = {} } = {}) {
  return bindEmailPost({
    request: new Request(URL_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
      body: JSON.stringify(body),
    }),
    env,
    params: {},
    waitUntil: () => {},
    data: {},
    next: async () => new Response('next'),
  })
}

async function signTempBind({ sub = 'discord-uid-1', provider = 'discord', name = 'User', avatar = null } = {}) {
  return signJwt({ sub, provider, name, avatar, scope: 'temp_bind' }, '10m', env)
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})

beforeEach(async () => {
  await resetDb()
})

function getSetCookies(res) {
  // Workers Response.headers.getSetCookie 標準 API；fallback 逗號切只用於極舊 runtime
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie()
  return [res.headers.get('Set-Cookie')].filter(Boolean)
}

describe('bind-email 成功路徑', () => {
  it('合法 temp_bind + 新 email → 建 user/identity + audit + Set-Cookie（refresh + clear device）', async () => {
    const token = await signTempBind({ sub: 'discord-uid-new', provider: 'discord', name: 'Alice' })
    const res = await callBindEmail({ token, email: 'alice@example.com' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toMatch(/^eyJ/)
    // PR1 tenant claim wiring：bind-email 新用戶 token 帶 active personal tenant
    const bindClaims = decodeJwt(body.access_token)
    expect(typeof bindClaims.tenant_id).toBe('number')
    expect(bindClaims.platform_role).toBe('tenant_owner')

    const cookies = getSetCookies(res)
    expect(cookies.some(c => /chiyigo_refresh=/.test(c))).toBe(true)
    expect(cookies.some(c => /chiyigo_oauth_device=;.*Max-Age=0/.test(c))).toBe(true)

    const u = await env.chiyigo_db
      .prepare('SELECT id, email, email_verified FROM users WHERE email = ?')
      .bind('alice@example.com').first()
    expect(u).toBeTruthy()
    expect(u.email_verified).toBe(0)

    const ident = await env.chiyigo_db
      .prepare('SELECT provider, provider_id FROM user_identities WHERE user_id = ?')
      .bind(u.id).first()
    expect(ident.provider).toBe('discord')
    expect(ident.provider_id).toBe('discord-uid-new')

    const rt = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n, MAX(session_id) AS sid FROM refresh_tokens WHERE user_id = ?')
      .bind(u.id).first()
    expect(rt.n).toBe(1)
    expect(rt.sid).toBeTruthy()  // PR5 5d-1b: oauth bind-email stamps a non-null per-login session_id

    // Audit：oauth.bind_email.success 含 user_id + provider
    const audit = await env.chiyigo_db
      .prepare(`SELECT event_type, severity, user_id, event_data
                FROM audit_log WHERE event_type = 'oauth.bind_email.success'`)
      .first()
    expect(audit).toBeTruthy()
    expect(audit.user_id).toBe(u.id)
    expect(audit.severity).toBe('info')
    expect(JSON.parse(audit.event_data).provider).toBe('discord')
  })

  it('email 帶大小寫/前後空白 → 正規化為小寫 trim', async () => {
    const token = await signTempBind({ sub: 'discord-uid-trim' })
    const res = await callBindEmail({ token, email: '  BoB@Example.COM ' })
    expect(res.status).toBe(200)
    const u = await env.chiyigo_db
      .prepare('SELECT email FROM users WHERE email = ?').bind('bob@example.com').first()
    expect(u).toBeTruthy()
  })
})

describe('bind-email F6 provider canonicalize', () => {
  it("JWT 內 provider='Google'（mixed-case）→ DB user_identities.provider 寫入 'google'", async () => {
    const token = await signTempBind({ sub: 'goog-uid-mixed', provider: 'Google', name: 'Mixie' })
    const res = await callBindEmail({ token, email: 'mixie@example.com' })
    expect(res.status).toBe(200)

    const ident = await env.chiyigo_db
      .prepare('SELECT provider FROM user_identities WHERE provider_id = ?')
      .bind('goog-uid-mixed').first()
    expect(ident.provider).toBe('google')
    expect(ident.provider).not.toBe('Google')
  })

  it("JWT 內 provider='GOOGLE'（all-caps）→ 同一 (provider, provider_id) invariant 不被污染", async () => {
    // 預先用小寫綁定建一筆
    const t1 = await signTempBind({ sub: 'goog-uid-dup', provider: 'google' })
    const r1 = await callBindEmail({ token: t1, email: 'first@example.com' })
    expect(r1.status).toBe(200)

    // 再用 'GOOGLE' 同 provider_id 進來，應命中既有 identity（idempotent 重放）
    const t2 = await signTempBind({ sub: 'goog-uid-dup', provider: 'GOOGLE' })
    const r2 = await callBindEmail({ token: t2, email: 'second@example.com' })
    // 既有 identity → 沿用 user_id，DB 不應出現 provider='GOOGLE' 第二列
    expect(r2.status).toBe(200)

    const rows = await env.chiyigo_db
      .prepare('SELECT provider FROM user_identities WHERE provider_id = ?')
      .bind('goog-uid-dup').all()
    expect(rows.results.length).toBe(1)
    expect(rows.results[0].provider).toBe('google')
  })
})

describe('bind-email F1 unsupported provider defense-in-depth', () => {
  it('簽出的 temp_bind 帶非 allowlist provider → 400 UNSUPPORTED_PROVIDER + audit', async () => {
    const token = await signTempBind({ sub: 'fc-uid', provider: 'fakecorp' })
    const res = await callBindEmail({ token, email: 'foo@example.com' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('UNSUPPORTED_PROVIDER')

    const cnt = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').bind('foo@example.com').first()
    expect(cnt.n).toBe(0)

    // F8 觀測性：signer/config drift 訊號必須留 audit
    const audit = await env.chiyigo_db
      .prepare(`SELECT severity, event_data FROM audit_log
                WHERE event_type = 'oauth.bind_email.fail'`)
      .first()
    expect(audit).toBeTruthy()
    expect(audit.severity).toBe('warn')
    const data = JSON.parse(audit.event_data)
    expect(data.reason_code).toBe('unsupported_provider')
    expect(data.provider).toBe('fakecorp')
  })

  it('mixed-case 但仍不在 allowlist（FakeCorp）→ 同樣 400 + audit provider 走小寫', async () => {
    const token = await signTempBind({ sub: 'fc-uid-2', provider: 'FakeCorp' })
    const res = await callBindEmail({ token, email: 'bar@example.com' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('UNSUPPORTED_PROVIDER')

    const audit = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE event_type = 'oauth.bind_email.fail'`)
      .first()
    expect(JSON.parse(audit.event_data).provider).toBe('fakecorp')
  })
})

// ── codex r5 H1: one-shot replay 防禦 ─────────────────────────────
describe('bind-email 一次性 token consume（replay 防禦）', () => {
  it('同 token 第二次打 → 401 LINK_ALREADY_USED + 不鑄第二份 refresh_token', async () => {
    const token = await signTempBind({ sub: 'discord-uid-replay-same', provider: 'discord' })
    const r1 = await callBindEmail({ token, email: 'first-victim@example.com' })
    expect(r1.status).toBe(200)
    const u1 = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('first-victim@example.com').first()
    expect(u1).toBeTruthy()

    // 攻擊者重放截獲的 same temp_bind URL
    const r2 = await callBindEmail({ token, email: 'attacker-controlled@example.com' })
    expect(r2.status).toBe(401)
    expect((await r2.json()).code).toBe('LINK_ALREADY_USED')

    // 不能因為 r2 而新增 refresh_token / user / identity
    const rtCount = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM refresh_tokens').first()
    expect(rtCount.n).toBe(1)
    const userCount = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users').first()
    expect(userCount.n).toBe(1)
    const identCount = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM user_identities').first()
    expect(identCount.n).toBe(1)

    // audit 留紀錄（reason_code 區分 replay）
    const audit = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log
                WHERE event_type = 'oauth.bind_email.fail'`)
      .first()
    expect(audit).toBeTruthy()
    expect(JSON.parse(audit.event_data).reason_code).toBe('link_already_used')

    // revoked_jti 真有 row（atomic claim 仲裁者）
    const rev = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM revoked_jti').first()
    expect(rev.n).toBe(1)
  })

  it('legit retry：重新跑 OAuth 拿到不同 jti 的新 token（同 provider_id）→ 沿用既有 user_id', async () => {
    const t1 = await signTempBind({ sub: 'discord-uid-replay-legit', provider: 'discord' })
    const r1 = await callBindEmail({ token: t1, email: 'legit@example.com' })
    expect(r1.status).toBe(200)
    const u1 = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('legit@example.com').first()

    // 使用者按了「重新登入」→ callback 重新簽發新 jti 的 temp_bind
    const t2 = await signTempBind({ sub: 'discord-uid-replay-legit', provider: 'discord' })
    expect(t2).not.toBe(t1)
    const r2 = await callBindEmail({ token: t2, email: 'doesnt-matter@example.com' })
    expect(r2.status).toBe(200)

    // 仍只有一個 user / 一個 identity（identity 路徑命中）
    const userCount = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users').first()
    expect(userCount.n).toBe(1)
    const ident = await env.chiyigo_db
      .prepare('SELECT user_id FROM user_identities WHERE provider_id = ?')
      .bind('discord-uid-replay-legit').first()
    expect(ident.user_id).toBe(u1.id)
  })
})

// ── codex r5 M1: chiyigo_oauth_device cookie 必持久化 ─────────────
describe('bind-email device binding', () => {
  it('cookie chiyigo_oauth_device=web-<uuid> → 寫進 refresh_tokens.device_uuid', async () => {
    const deviceUuid = 'web-12345678-1234-4321-abcd-1234567890ab'
    const token = await signTempBind({ sub: 'discord-uid-dev', provider: 'discord' })
    const res = await callBindEmail(
      { token, email: 'dev@example.com' },
      { headers: { cookie: `chiyigo_oauth_device=${deviceUuid}` } },
    )
    expect(res.status).toBe(200)

    const u = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('dev@example.com').first()
    const rt = await env.chiyigo_db
      .prepare('SELECT device_uuid FROM refresh_tokens WHERE user_id = ?')
      .bind(u.id).first()
    expect(rt.device_uuid).toBe(deviceUuid)

    // 並且 Set-Cookie 必 clear 掉 device cookie（同 callback.js 收尾語意）
    const cookies = getSetCookies(res)
    expect(cookies.some(c => /chiyigo_oauth_device=;.*Max-Age=0/.test(c))).toBe(true)
  })

  it('沒帶 cookie → device_uuid 回 NULL（不阻擋舊 client）', async () => {
    const token = await signTempBind({ sub: 'discord-uid-nodev', provider: 'discord' })
    const res = await callBindEmail({ token, email: 'nodev@example.com' })
    expect(res.status).toBe(200)

    const u = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('nodev@example.com').first()
    const rt = await env.chiyigo_db
      .prepare('SELECT device_uuid FROM refresh_tokens WHERE user_id = ?')
      .bind(u.id).first()
    expect(rt.device_uuid).toBeNull()
  })

  it('cookie 格式不合（非 web-<uuid>）→ 視為無 cookie，device_uuid NULL', async () => {
    const token = await signTempBind({ sub: 'discord-uid-bad-dev', provider: 'discord' })
    const res = await callBindEmail(
      { token, email: 'baddev@example.com' },
      { headers: { cookie: 'chiyigo_oauth_device=evil-injected-value' } },
    )
    expect(res.status).toBe(200)

    const u = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('baddev@example.com').first()
    const rt = await env.chiyigo_db
      .prepare('SELECT device_uuid FROM refresh_tokens WHERE user_id = ?')
      .bind(u.id).first()
    expect(rt.device_uuid).toBeNull()
  })
})

describe('bind-email token 驗證', () => {
  it('scope 不是 temp_bind → 401 LINK_TYPE_INVALID', async () => {
    const token = await signJwt(
      { sub: '1', provider: 'discord', scope: 'access' },
      '10m', env,
    )
    const res = await callBindEmail({ token, email: 'x@example.com' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('LINK_TYPE_INVALID')
  })

  it('token 簽章壞掉 → 401 LINK_INVALID_OR_EXPIRED', async () => {
    const res = await callBindEmail({ token: 'not-a-real-jwt', email: 'x@example.com' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('LINK_INVALID_OR_EXPIRED')
  })

  it('payload 缺 provider 字串 → 401 TOKEN_DATA_INCOMPLETE', async () => {
    const token = await signJwt(
      { sub: 'u1', scope: 'temp_bind' /* no provider */ },
      '10m', env,
    )
    const res = await callBindEmail({ token, email: 'x@example.com' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('TOKEN_DATA_INCOMPLETE')
  })

  it('codex r6: payload.exp 缺值（hand-rolled token 沒 setExpirationTime）→ 401 + audit reason_code=missing_exp', async () => {
    // signJwt 一定 setExpirationTime，所以這條 prod path 不可達；手簽繞過 signJwt
    // 來驗 defense-in-depth：避免 consumeJtiOnce 用 fallback 1hr TTL 寫 revoked_jti
    const { SignJWT, importJWK } = await import('jose')
    const jwk = JSON.parse(env.JWT_PRIVATE_KEY)
    const key = await importJWK(jwk, 'ES256')
    const token = await new SignJWT({
      sub: 'discord-uid-no-exp', provider: 'discord', scope: 'temp_bind',
      jti: crypto.randomUUID(),
    })
      .setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
      .setIssuer('https://chiyigo.com')
      .setIssuedAt()
      .setAudience('chiyigo')
      // 刻意不 setExpirationTime → jwtVerify 仍會放行（jose 對 exp 缺值預設不擋）
      .sign(key)

    const r = await callBindEmail({ token, email: 'no-exp@example.com' })
    expect(r.status).toBe(401)
    expect((await r.json()).code).toBe('LINK_INVALID_OR_EXPIRED')

    // 不可寫 revoked_jti（fail 在 consumeJtiOnce 之前）
    const rev = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM revoked_jti').first()
    expect(rev.n).toBe(0)

    // 不可有任何 user / refresh_token
    const u = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users').first()
    expect(u.n).toBe(0)

    // Audit 留 reason_code=missing_exp
    const audit = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE event_type = 'oauth.bind_email.fail'`)
      .first()
    expect(audit).toBeTruthy()
    expect(JSON.parse(audit.event_data).reason_code).toBe('missing_exp')
  })
})

describe('bind-email email 碰撞', () => {
  it('email 與既有帳號碰撞 → 409 EMAIL_USED_BIND_AFTER_LOGIN（不靜默接管）+ audit warn', async () => {
    await env.chiyigo_db
      .prepare('INSERT INTO users (email, email_verified) VALUES (?, 1)')
      .bind('taken@example.com').run()
    const existing = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('taken@example.com').first()

    const token = await signTempBind({ sub: 'discord-uid-collide', provider: 'discord' })
    const res = await callBindEmail({ token, email: 'taken@example.com' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('EMAIL_USED_BIND_AFTER_LOGIN')
    expect(body.provider).toBe('discord')

    // 既有 user 不應被綁上新 identity
    const ident = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?')
      .bind(existing.id).first()
    expect(ident.n).toBe(0)

    // Audit：oauth.bind_email.collision_blocked warn + 鎖 user_id + provider + reason
    const audit = await env.chiyigo_db
      .prepare(`SELECT severity, user_id, event_data FROM audit_log
                WHERE event_type = 'oauth.bind_email.collision_blocked'`)
      .first()
    expect(audit).toBeTruthy()
    expect(audit.severity).toBe('warn')
    expect(audit.user_id).toBe(existing.id)
    const data = JSON.parse(audit.event_data)
    expect(data.provider).toBe('discord')
    expect(data.reason).toBe('unverified_typed_email')

    // 不可寫 success（避免誤觸發 D-4 新裝置 email 之類副作用）
    const cnt = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'oauth.bind_email.success'`)
      .first()
    expect(cnt.n).toBe(0)
  })
})

describe('bind-email 入口校驗', () => {
  it('email 格式錯誤 → 400 INVALID_EMAIL_FORMAT', async () => {
    const token = await signTempBind({ sub: 'discord-uid-bad-email' })
    const res = await callBindEmail({ token, email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_EMAIL_FORMAT')
  })

  it('缺 token → 400 MISSING_REQUIRED_FIELD', async () => {
    const res = await callBindEmail({ email: 'x@example.com' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('缺 email → 400 MISSING_REQUIRED_FIELD', async () => {
    const token = await signTempBind()
    const res = await callBindEmail({ token })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('request body 非 JSON → 400 INVALID_REQUEST_FORMAT', async () => {
    const res = await bindEmailPost({
      request: new Request(URL_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      env, params: {}, waitUntil: () => {}, data: {}, next: async () => new Response('next'),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_REQUEST_FORMAT')
  })
})

// OD-3 credential requires_reverification enforcement — bind-email surface (plan §6.3 / §12).
// Read-only flag pre-check runs BEFORE consumeJtiOnce, so a blocked token is never burned.
describe('OD-3 — bind-email requires_reverification block', () => {
  it('flagged identity -> 403 CREDENTIAL_REVERIFICATION_REQUIRED, temp_bind jti NOT consumed, no token', async () => {
    const ins = await env.chiyigo_db.prepare(`INSERT INTO users (email, email_verified) VALUES ('be@example.com', 1)`).run()
    const uid = ins.meta.last_row_id
    await env.chiyigo_db.prepare(
      `INSERT INTO user_identities (user_id, provider, provider_id, requires_reverification, disposition_reason) VALUES (?, 'discord', 'discord-uid-flag', 1, 'unknown_context')`,
    ).bind(uid).run()
    const token = await signTempBind({ sub: 'discord-uid-flag', provider: 'discord', name: 'X' })

    const res = await callBindEmail({ token, email: 'newbe@example.com' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('CREDENTIAL_REVERIFICATION_REQUIRED')

    // Codex P2: this security signal is account-attributable — the audit binds the affected user_id.
    const auditRow = await env.chiyigo_db
      .prepare(`SELECT user_id FROM audit_log WHERE event_type='auth.credential.reverification_required' ORDER BY id DESC LIMIT 1`)
      .first()
    expect(Number(auditRow?.user_id)).toBe(Number(uid))

    // jti NOT consumed: same token again still hits the reverification gate (not LINK_ALREADY_USED)
    const res2 = await callBindEmail({ token, email: 'newbe@example.com' })
    expect(res2.status).toBe(403)
    expect((await res2.json()).code).toBe('CREDENTIAL_REVERIFICATION_REQUIRED')
  })
})
