/**
 * Factor-add elevation 共用工具（SEC-FACTOR-ADD-A，ADD-A PR-A2）
 *
 * factor-add elevation 是 server-side one-time grant（elevation_grants，migration 0054），
 * 與 elevated:account（delete/change-password，TOTP-only step-up）**結構分離**。三條 elevation
 * 路徑（/elevation/{totp,password,exchange}）證明一個 attacker 不持有的因子後鑄 grant；factor-add
 * 端點（PR-A3）以 grant_token 驗 + atomic consume。grant_token 明文不入 DB（只存 hashToken）。
 *
 * OD-B：抽共用 second-factor verify helper（TOTP + backup code）供 /elevation/totp 用。
 * OD-C：grant TTL 5min。
 * sid 契約（PR-0）：grant 綁 per-login sid（access token sid claim）；缺 sid → 不得鑄 grant（fail-closed）。
 */

import { generateSecureToken, hashToken, verifyBackupCode } from './crypto'
import { verifyTotpReplaySafe } from './totp'
import { requireAuth, res } from './auth'

// elevation_grants / elevation_exchanges 的 action 白名單（與 migration 0054 CHECK 對齊）
const FACTOR_ADD_ACTIONS = new Set(['add_passkey', 'bind_wallet', 'bind_identity'])

/** action 是否為合法 factor-add action（端點入口 schema 驗證用）。 */
export function isFactorAddAction(action: unknown): action is string {
  return typeof action === 'string' && FACTOR_ADD_ACTIONS.has(action)
}

/**
 * 從 access token claim 取 per-login sid（PR-0）。缺值（PR-0 上線前簽的舊 token / 非
 * session-backed 的 pc/mobile direct-callback token）→ null。factor-add elevation **必 fail-closed**：
 * 無 sid = 無對應 server session row 可綁 grant。
 */
export function sidFromUser(user: { sid?: unknown } | null | undefined): string | null {
  return user && typeof user.sid === 'string' && user.sid ? user.sid : null
}

interface SecondFactorResult {
  ok: boolean
  method?: 'totp' | 'backup_code'
  reason?: 'bad_format' | 'bad_totp' | 'replay' | 'bad_backup_code'
}

/**
 * 共用 second-factor 驗證（OD-B）：6 位 → TOTP（replay-safe）；20-hex → backup code（atomic 核銷）。
 * 鏡射 2fa/verify / step-up 既有語意（verifyTotpReplaySafe + verifyBackupCode + UPDATE used_at CAS）。
 * 不負責 rate-limit / audit（由 caller 端點處理）。
 */
export async function verifySecondFactor(
  env: Env,
  { userId, secret, code }: { userId: number; secret: string; code: unknown },
): Promise<SecondFactorResult> {
  const sanitized = String(code ?? '').replace(/[\s-]/g, '')

  if (/^\d{6}$/.test(sanitized)) {
    const r = await verifyTotpReplaySafe(env, { userId, secret, code: sanitized })
    if (r.ok) return { ok: true, method: 'totp' }
    return { ok: false, reason: r.reason === 'replay' ? 'replay' : 'bad_totp' }
  }

  if (/^[0-9a-f]{20}$/i.test(sanitized)) {
    const codes = await env.chiyigo_db
      .prepare('SELECT id, code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL')
      .bind(userId).all()
    for (const c of codes.results ?? []) {
      if (await verifyBackupCode(sanitized, c.code_hash as string)) {
        // 原子核銷：並發只有一個成功
        const consumed = await env.chiyigo_db
          .prepare(`UPDATE backup_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`)
          .bind(c.id).run()
        if ((consumed.meta?.changes ?? 0) > 0) return { ok: true, method: 'backup_code' }
      }
    }
    return { ok: false, reason: 'bad_backup_code' }
  }

  return { ok: false, reason: 'bad_format' }
}

// OD-C：grant 5min
const GRANT_TTL_SEC = 5 * 60

/**
 * 鑄一張 factor-add elevation grant（elevation_grants，purpose='factor_add'）。回明文 grant_token
 * 給 client（DB 只存 hashToken(grant_token)）。consume 與 factor-add 寫入 atomic（PR-A3）。
 *
 * method='oauth_reauth' 時帶 provider + providerIdHash（callback 已驗 match 既綁 identity）。
 */
export async function mintFactorAddGrant(
  env: Env,
  {
    userId, sessionId, action, method, provider = null, providerIdHash = null,
  }: {
    userId: number
    sessionId: string
    action: string
    method: 'totp' | 'current_password' | 'oauth_reauth'
    provider?: string | null
    providerIdHash?: string | null
  },
): Promise<{ grant_token: string; expires_in: number }> {
  const grantToken = generateSecureToken()
  const grantTokenHash = await hashToken(grantToken)
  const expiresAt = new Date(Date.now() + GRANT_TTL_SEC * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await env.chiyigo_db
    .prepare(`
      INSERT INTO elevation_grants
        (grant_token_hash, user_id, session_id, purpose, action, method, provider, provider_id_hash, expires_at)
      VALUES (?, ?, ?, 'factor_add', ?, ?, ?, ?, ?)
    `)
    .bind(grantTokenHash, userId, sessionId, action, method, provider, providerIdHash, expiresAt)
    .run()

  return { grant_token: grantToken, expires_in: GRANT_TTL_SEC }
}

// grant_token 由 client 經 X-Factor-Add-Grant header 帶入（與 body 分離，避免 gate/handler 雙讀 body）。
const GRANT_HEADER = 'X-Factor-Add-Grant'

interface FactorAddGate {
  user: Record<string, unknown> | null
  userId: number
  sid: string
  grantTokenHash: string
  error: Response | null
}

/**
 * factor-add 端點 gate（PR-A3，SEC-FACTOR-ADD P1 封閉）。**validate-not-consume**：驗 grant 有效
 * （存在 + 未消費 + 未過期 + 比對 user_id+sid+action+purpose）但**不**消費；回 grantTokenHash 供 caller
 * 在 factor-add 寫入的**同一 db.batch** 內以 consumeFactorAddGrantStmt 做 CAS consume（both-or-neither）。
 *
 * pre-read 用與 consume CAS 完全相同的 predicate（feedback_gating_preread_not_narrower_than_cas）：
 * 並發兩請求可同時通過 pre-read，但只有一個贏 CAS consume → 只有一個寫 credential。
 *
 * 同步路徑（register-verify / wallet-verify）：caller 拿 grantTokenHash 自建 batch。
 * async 路徑（oauth is_binding）：init 用此 validate + 存 factor_add_grant_hash 進 oauth_states，
 * callback 才 consume（見 callback factor_add_binding 分派）。
 */
export async function requireFactorAddGrant(
  request: Request,
  env: Env,
  { action }: { action: string },
): Promise<FactorAddGate> {
  const fail = (error: Response): FactorAddGate => ({ user: null, userId: 0, sid: '', grantTokenHash: '', error })

  const { user, error } = await requireAuth(request, env)
  if (error) return fail(error)

  const sid = sidFromUser(user)
  if (!sid)
    return fail(res({ error: 'Session not eligible for factor-add; re-login required', code: 'ELEVATION_SID_REQUIRED' }, 403))

  const grantToken = request.headers.get(GRANT_HEADER) ?? request.headers.get(GRANT_HEADER.toLowerCase())
  if (!grantToken)
    return fail(res({ error: 'Factor-add elevation required', code: 'FACTOR_ADD_GRANT_REQUIRED' }, 403))

  const userId = Number(user.sub)
  const grantTokenHash = await hashToken(grantToken)
  const row = await env.chiyigo_db
    .prepare(`
      SELECT id FROM elevation_grants
      WHERE grant_token_hash = ? AND user_id = ? AND session_id = ? AND action = ? AND purpose = 'factor_add'
        AND consumed_at IS NULL AND expires_at > datetime('now')
    `)
    .bind(grantTokenHash, userId, sid, action).first()
  if (!row)
    return fail(res({ error: 'Factor-add elevation grant invalid, expired, used, or wrong action', code: 'FACTOR_ADD_ELEVATION_REQUIRED' }, 403))

  return { user, userId, sid, grantTokenHash, error: null }
}

/**
 * grant consume 的 CAS UPDATE 句（caller 放進 factor-add 寫入的同一 db.batch 當 S1；factor-add
 * INSERT 用 `... WHERE changes()=1` gate 在其後當 S2）。批次後檢查 S1.changes===1 才算 consume 成功。
 * predicate 與 requireFactorAddGrant pre-read 一致；consumed_at IS NULL 對並發做 row-level 序列化。
 */
export function consumeFactorAddGrantStmt(
  env: Env,
  { grantTokenHash, userId, sid, action }: { grantTokenHash: string; userId: number; sid: string; action: string },
) {
  return env.chiyigo_db
    .prepare(`
      UPDATE elevation_grants SET consumed_at = datetime('now')
      WHERE grant_token_hash = ? AND user_id = ? AND session_id = ? AND action = ? AND purpose = 'factor_add'
        AND consumed_at IS NULL AND expires_at > datetime('now')
    `)
    .bind(grantTokenHash, userId, sid, action)
}
