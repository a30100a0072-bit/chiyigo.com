import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, exportJWK } from 'jose'
import { signJwt } from '../functions/utils/jwt.js'
import { requireAuth, res } from '../functions/utils/auth.js'
import { requireRole } from '../functions/utils/requireRole.js'

let env

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const priv = await exportJWK(privateKey)
  const pub  = await exportJWK(publicKey)
  priv.kid = pub.kid = 'test-key'
  priv.alg = pub.alg = 'ES256'
  pub.use  = 'sig'
  env = {
    JWT_PRIVATE_KEY: JSON.stringify(priv),
    JWT_PUBLIC_KEY:  JSON.stringify(pub),
  }
})

function reqWithAuth(token) {
  return new Request('http://x/', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function expectError(promise, status, errorMatch) {
  const r = await promise
  expect(r.user).toBeNull()
  expect(r.error.status).toBe(status)
  const body = await r.error.json()
  if (errorMatch) expect(body).toMatchObject(errorMatch)
}

describe('res helper', () => {
  it('回 JSON Response with content-type', async () => {
    const r = res({ ok: true }, 201)
    expect(r.status).toBe(201)
    expect(r.headers.get('Content-Type')).toBe('application/json')
    expect(await r.json()).toEqual({ ok: true })
  })
})

describe('requireAuth', () => {
  it('合法 token + 無 scope 限制 → 回 user', async () => {
    const tok = await signJwt({ sub: '1', email: 'a@b', role: 'player', status: 'active' }, '5m', env)
    const { user, error } = await requireAuth(reqWithAuth(tok), env)
    expect(error).toBeNull()
    expect(user.sub).toBe('1')
    expect(user.email).toBe('a@b')
  })

  it('無 Authorization header → 401', async () => {
    await expectError(requireAuth(reqWithAuth(null), env), 401, { error: 'Unauthorized' })
  })

  it('Authorization 格式不對（缺 Bearer 前綴） → 401', async () => {
    const r = new Request('http://x/', { headers: { Authorization: 'Basic xxx' } })
    await expectError(requireAuth(r, env), 401)
  })

  it('Bearer 後接空字串 → 401', async () => {
    const r = new Request('http://x/', { headers: { Authorization: 'Bearer    ' } })
    await expectError(requireAuth(r, env), 401)
  })

  it('簽章無效 / 偽造 token → 401', async () => {
    await expectError(requireAuth(reqWithAuth('not.a.jwt'), env), 401)
  })

  it('payload.status === banned → 403 ACCOUNT_BANNED', async () => {
    const tok = await signJwt({ sub: '1', status: 'banned' }, '5m', env)
    await expectError(requireAuth(reqWithAuth(tok), env), 403, { code: 'ACCOUNT_BANNED' })
  })

  it('要求特定 scope，scope 不吻合 → 403', async () => {
    const tok = await signJwt({ sub: '1', scope: 'normal' }, '5m', env)
    await expectError(requireAuth(reqWithAuth(tok), env, 'pre_auth'), 403, { error: /wrong token scope/ })
  })

  it('要求特定 scope，scope 吻合 → user 通過', async () => {
    const tok = await signJwt({ sub: '1', scope: 'pre_auth' }, '5m', env)
    const { user, error } = await requireAuth(reqWithAuth(tok), env, 'pre_auth')
    expect(error).toBeNull()
    expect(user.scope).toBe('pre_auth')
  })

  it('一般存取 + pre_auth scope token → 403（受限 token 不可用於一般 endpoint）', async () => {
    const tok = await signJwt({ sub: '1', scope: 'pre_auth' }, '5m', env)
    await expectError(requireAuth(reqWithAuth(tok), env), 403, { error: /pre_auth token cannot access/ })
  })

  it('opts.audience 吻合 → 通過', async () => {
    const tok = await signJwt({ sub: '1', role: 'player', status: 'active' }, '5m', env, { audience: 'chiyigo' })
    const { user, error } = await requireAuth(reqWithAuth(tok), env, null, { audience: 'chiyigo' })
    expect(error).toBeNull()
    expect(user.aud).toBe('chiyigo')
  })

  it('opts.audience 不符 → 401（aud=mbti token 給 chiyigo IAM 端點被擋）', async () => {
    const tok = await signJwt({ sub: '1', role: 'player', status: 'active' }, '5m', env, { audience: 'mbti' })
    await expectError(
      requireAuth(reqWithAuth(tok), env, null, { audience: 'chiyigo' }),
      401,
      { error: 'Unauthorized' },
    )
  })
})

describe('requireRole', () => {
  async function tokenWithRole(role) {
    return signJwt({ sub: '1', email: 'a@b', role, status: 'active' }, '5m', env)
  }

  it('admin 訪問 admin endpoint → 通過', async () => {
    const tok = await tokenWithRole('admin')
    const { user, error } = await requireRole(reqWithAuth(tok), env, 'admin')
    expect(error).toBeNull()
    expect(user.role).toBe('admin')
  })

  it('developer 訪問 admin endpoint → 通過（更高層級）', async () => {
    const tok = await tokenWithRole('developer')
    const { error } = await requireRole(reqWithAuth(tok), env, 'admin')
    expect(error).toBeNull()
  })

  it('player 訪問 admin endpoint → 403 INSUFFICIENT_ROLE', async () => {
    const tok = await tokenWithRole('player')
    await expectError(requireRole(reqWithAuth(tok), env, 'admin'), 403, { code: 'INSUFFICIENT_ROLE' })
  })

  it('moderator 訪問 admin endpoint → 403 INSUFFICIENT_ROLE', async () => {
    const tok = await tokenWithRole('moderator')
    await expectError(requireRole(reqWithAuth(tok), env, 'admin'), 403, { code: 'INSUFFICIENT_ROLE' })
  })

  it('未知 role → 視為 -1，比 player 還低', async () => {
    const tok = await tokenWithRole('weird-role')
    await expectError(requireRole(reqWithAuth(tok), env, 'player'), 403, { code: 'INSUFFICIENT_ROLE' })
  })

  it('未知 minRole 參數 → 永遠拒絕', async () => {
    const tok = await tokenWithRole('developer')
    await expectError(requireRole(reqWithAuth(tok), env, 'godmode'), 403)
  })

  it('JWT 驗證失敗 → 透傳 401（requireRole 委派 requireAuth）', async () => {
    await expectError(requireRole(reqWithAuth(null), env, 'admin'), 401)
  })
})
