import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, exportJWK } from 'jose'
import { signJwt } from '../functions/utils/jwt'
import { requireAuth, requireScope, requireAnyScope, res } from '../functions/utils/auth.js'
import { requireRole } from '../functions/utils/requireRole'
import { SCOPES } from '../functions/utils/scopes'

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

describe('requireScope', () => {
  it('JWT scope claim 含所需 → 通過', async () => {
    const tok = await signJwt(
      { sub: '1', role: 'player', status: 'active', scope: 'admin:audit' },
      '5m', env,
    )
    const { user, error } = await requireScope(reqWithAuth(tok), env, SCOPES.ADMIN_AUDIT)
    expect(error).toBeNull()
    expect(user.sub).toBe('1')
  })

  it('JWT 沒 scope claim 但 role 推得出來 → 通過（向後相容舊 token）', async () => {
    const tok = await signJwt(
      { sub: '1', role: 'admin', status: 'active' },
      '5m', env,
    )
    const { error } = await requireScope(reqWithAuth(tok), env, SCOPES.ADMIN_AUDIT)
    expect(error).toBeNull()
  })

  it('scope 不夠 → 403 INSUFFICIENT_SCOPE + missing 列表', async () => {
    const tok = await signJwt(
      { sub: '1', role: 'player', status: 'active', scope: 'read:profile' },
      '5m', env,
    )
    const r = await requireScope(reqWithAuth(tok), env, SCOPES.ADMIN_AUDIT)
    expect(r.user).toBeNull()
    expect(r.error.status).toBe(403)
    const body = await r.error.json()
    expect(body.code).toBe('INSUFFICIENT_SCOPE')
    expect(body.missing).toContain(SCOPES.ADMIN_AUDIT)
  })

  it('多 scope（AND）：缺一即 403，回報缺哪個', async () => {
    const tok = await signJwt(
      { sub: '1', role: 'player', status: 'active', scope: 'admin:audit' },
      '5m', env,
    )
    const r = await requireScope(reqWithAuth(tok), env, SCOPES.ADMIN_AUDIT, SCOPES.ADMIN_REVOKE)
    expect(r.error.status).toBe(403)
    const body = await r.error.json()
    expect(body.missing).toEqual([SCOPES.ADMIN_REVOKE])
  })

  it('沒 token → 401（透傳 requireAuth）', async () => {
    const r = await requireScope(reqWithAuth(null), env, SCOPES.ADMIN_AUDIT)
    expect(r.error.status).toBe(401)
  })
})

describe('requireAnyScope (P1-17 Phase 3)', () => {
  it('任一 scope 命中 → 通過', async () => {
    const tok = await signJwt(
      { sub: '1', role: 'player', status: 'active', scope: 'admin:users:read' },
      '5m', env,
    )
    const { error } = await requireAnyScope(
      reqWithAuth(tok), env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE,
    )
    expect(error).toBeNull()
  })

  it('write token 也能通過 read endpoint', async () => {
    const tok = await signJwt(
      { sub: '1', role: 'player', status: 'active', scope: 'admin:users:write' },
      '5m', env,
    )
    const { error } = await requireAnyScope(
      reqWithAuth(tok), env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE,
    )
    expect(error).toBeNull()
  })

  it('admin coarse 透過 hierarchy 通過 fine OR 守門', async () => {
    const tok = await signJwt(
      { sub: '1', role: 'admin', status: 'active' },
      '5m', env,
    )
    const { error } = await requireAnyScope(
      reqWithAuth(tok), env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE,
    )
    expect(error).toBeNull()
  })

  it('finance role 透過 ROLE_BASE_SCOPES 通過 admin:payments:* 任一', async () => {
    const tok = await signJwt({ sub: '1', role: 'finance', status: 'active' }, '5m', env)
    const { error } = await requireAnyScope(
      reqWithAuth(tok), env,
      SCOPES.ADMIN_PAYMENTS_READ, SCOPES.ADMIN_PAYMENTS_WRITE,
      SCOPES.ADMIN_PAYMENTS_REFUND, SCOPES.ADMIN_PAYMENTS_APPROVE,
    )
    expect(error).toBeNull()
  })

  it('finance 沒 admin:users:* → 403', async () => {
    const tok = await signJwt({ sub: '1', role: 'finance', status: 'active' }, '5m', env)
    const r = await requireAnyScope(
      reqWithAuth(tok), env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE,
    )
    expect(r.error.status).toBe(403)
    const body = await r.error.json()
    expect(body.code).toBe('INSUFFICIENT_SCOPE')
    expect(body.accepted).toEqual([SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE])
  })

  it('support role 通過 admin:users:read | :write 守門', async () => {
    const tok = await signJwt({ sub: '1', role: 'support', status: 'active' }, '5m', env)
    const { error } = await requireAnyScope(
      reqWithAuth(tok), env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE,
    )
    expect(error).toBeNull()
  })

  it('player（無 admin scope）→ 403', async () => {
    const tok = await signJwt({ sub: '1', role: 'player', status: 'active' }, '5m', env)
    const r = await requireAnyScope(
      reqWithAuth(tok), env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE,
    )
    expect(r.error.status).toBe(403)
  })

  it('沒 token → 401（透傳 requireAuth）', async () => {
    const r = await requireAnyScope(reqWithAuth(null), env, SCOPES.ADMIN_USERS_READ)
    expect(r.error.status).toBe(401)
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

  it('未知 actor role → 403 UNKNOWN_ACTOR_ROLE（Codex r6-1 fail-fast）', async () => {
    const tok = await tokenWithRole('weird-role')
    await expectError(requireRole(reqWithAuth(tok), env, 'player'), 403, { code: 'UNKNOWN_ACTOR_ROLE' })
  })

  it('未知 minRole 參數 → 永遠拒絕', async () => {
    const tok = await tokenWithRole('developer')
    await expectError(requireRole(reqWithAuth(tok), env, 'godmode'), 403)
  })

  it('JWT 驗證失敗 → 透傳 401（requireRole 委派 requireAuth）', async () => {
    await expectError(requireRole(reqWithAuth(null), env, 'admin'), 401)
  })
})
