/**
 * OAuth/OIDC Client Registry — Phase C-1 Wave 2
 *
 * 演進：
 *   - Phase 1（2026-05-04）：in-code OAUTH_CLIENTS 為唯一 source of truth。
 *   - Phase C-1 Wave 1（2026-05-05）：D1 表 + KV cache + async getters；
 *     consumers 仍用 sync exports（值取自 in-code）。
 *   - Phase C-1 Wave 2（2026-05-05）：sync getters 讀 module-level mutable cache，
 *     `refreshClientsCache(env)` 由 _middleware.js 在每個 /api/* 請求前觸發
 *     （per-isolate 60s throttle），cache 從 KV → D1 → in-code 三層讀。
 *     consumers 從 sync const 改成 sync getter function（getXxx），不必 cascade async。
 *
 * 為什麼用 sync getter + 模組級 cache（不用 async cascade）：
 *   cors.getCorsHeaders / resolveAud 已在 ~14 個 handler 同步呼叫，把它們改 async
 *   要每個 caller 全部 await，diff 量大且風險高。模組級 cache + middleware 預 refresh
 *   讓 sync 端維持原樣，新增 RP 改 D1 → 下次 isolate refresh（≤60s + KV TTL 5min）
 *   後可見。一致性 eventual 但對 RP 註冊（極低頻變動）足夠。
 */

/**
 * @typedef {Object} OAuthClient
 * @property {string}   client_id
 * @property {string}   aud
 * @property {string[]} origins
 * @property {string[]} redirect_uris
 * @property {string[]} post_logout_redirect_uris
 * @property {string[]} frontchannel_logout_uris
 * @property {string|null} backchannel_logout_uri
 */

/** boot-time 預設值，與 migrations/0020 seed 對齊 */
export const IN_CODE_CLIENTS = [
  {
    client_id: 'chiyigo',
    aud: 'chiyigo',
    origins: ['https://chiyigo.com'],
    redirect_uris: [
      'chiyigo://auth/callback',
      'https://chiyigo.com/callback',
      'https://chiyigo.com/app/callback',
    ],
    post_logout_redirect_uris: [
      'https://chiyigo.com/',
      'https://chiyigo.com/login',
    ],
    frontchannel_logout_uris: ['https://chiyigo.com/api/frontchannel-logout'],
    backchannel_logout_uri: null,
  },
  {
    client_id: 'mbti',
    aud: 'mbti',
    origins: ['https://mbti.chiyigo.com'],
    redirect_uris: ['https://mbti.chiyigo.com/login.html'],
    post_logout_redirect_uris: [
      'https://mbti.chiyigo.com/',
      'https://mbti.chiyigo.com/login.html',
    ],
    frontchannel_logout_uris: ['https://mbti.chiyigo.com/frontchannel-logout'],
    backchannel_logout_uri: null,
  },
  {
    client_id: 'talo',
    aud: 'talo',
    origins: ['https://talo.chiyigo.com'],
    redirect_uris: ['https://talo.chiyigo.com/'],
    post_logout_redirect_uris: ['https://talo.chiyigo.com/'],
    frontchannel_logout_uris: ['https://talo.chiyigo.com/frontchannel-logout'],
    backchannel_logout_uri: null,
  },
  {
    client_id: 'sport-app',
    aud: 'sport-app',
    origins: [
      'https://sport-app-web.pages.dev',
      'https://sport-app-admin.pages.dev',
    ],
    redirect_uris: [
      'https://sport-app-web.pages.dev/auth/callback',
      'https://sport-app-admin.pages.dev/auth/callback',
    ],
    post_logout_redirect_uris: [
      'https://sport-app-web.pages.dev/',
      'https://sport-app-admin.pages.dev/',
    ],
    frontchannel_logout_uris: [
      'https://sport-app-web.pages.dev/frontchannel-logout',
      'https://sport-app-admin.pages.dev/frontchannel-logout',
    ],
    backchannel_logout_uri:
      'https://sport-app-worker.a30100a0072.workers.dev/api/auth/backchannel-logout',
  },
]

// ── 模組級可變 cache ───────────────────────────────────────────

let _currentClients = IN_CODE_CLIENTS
let _lastRefreshAt  = 0
const REFRESH_THROTTLE_MS = 60_000  // 同一 isolate 內 60s 內只跑一次 refresh
const KV_KEY = 'oauth_clients:all'
const KV_TTL_SEC = 300              // 5 min；admin CRUD 寫入時應該主動 purge

function rowToClient(row) {
  const j = (s, def) => {
    if (s == null) return def
    try { const v = JSON.parse(s); return Array.isArray(v) ? v : def } catch { return def }
  }
  return {
    client_id: row.client_id,
    aud:       row.aud ?? row.client_id,
    origins:                   j(row.cors_origins,              []),
    redirect_uris:             j(row.allowed_redirect_uris,     []),
    post_logout_redirect_uris: j(row.post_logout_redirect_uris, []),
    frontchannel_logout_uris:  j(row.frontchannel_logout_uris,  []),
    backchannel_logout_uri:    row.backchannel_logout_uri ?? null,
  }
}

/**
 * 由 middleware 在每個 /api/* 請求前呼叫；per-isolate 60s 內只實際跑一次。
 * 來源優先序：KV cache → D1 → in-code（fallback）。
 *
 * 失敗（D1 down / KV down）：不擋請求，繼續用上次 cache 或 in-code。
 *
 * @param {object} env
 * @param {boolean} [force]  跳過 60s throttle（admin CRUD 後呼叫）
 */
export async function refreshClientsCache(env, force = false) {
  const now = Date.now()
  if (!force && now - _lastRefreshAt < REFRESH_THROTTLE_MS) return
  _lastRefreshAt = now

  // 1. KV cache hit
  if (env?.CHIYIGO_KV) {
    try {
      const cached = await env.CHIYIGO_KV.get(KV_KEY, 'json')
      if (Array.isArray(cached) && cached.length) { _currentClients = cached; return }
    } catch { /* fallthrough */ }
  }

  // 2. D1
  if (env?.chiyigo_db) {
    try {
      const { results } = await env.chiyigo_db
        .prepare(`
          SELECT client_id, aud,
                 allowed_redirect_uris,
                 post_logout_redirect_uris,
                 frontchannel_logout_uris,
                 backchannel_logout_uri,
                 cors_origins
          FROM oauth_clients
          WHERE is_active = 1
        `)
        .all()
      if (Array.isArray(results) && results.length) {
        const clients = results.map(rowToClient)
        _currentClients = clients
        if (env.CHIYIGO_KV) {
          try { await env.CHIYIGO_KV.put(KV_KEY, JSON.stringify(clients), { expirationTtl: KV_TTL_SEC }) }
          catch { /* ignore */ }
        }
        return
      }
      // D1 表存在但無 active row → 視為「合法的空 registry」，回 in-code 預設
      // （比保留前次 stale 值安全；測試 resetDb 之後也能拿到乾淨狀態）
      _currentClients = IN_CODE_CLIENTS
      return
    } catch { /* D1 query 噴錯：保留上次 _currentClients（防衛 D1 暫時失效）*/ }
  }

  // 3. fallback：env 缺 binding → 保持 _currentClients 為上次值
}

/** Admin CRUD 寫入後呼叫：清 KV，下次 middleware refresh 會立即從 D1 抓新資料 */
export async function invalidateClientsCache(env) {
  _lastRefreshAt = 0  // 強制下次 refresh 不被 throttle 跳過
  if (env?.CHIYIGO_KV) {
    try { await env.CHIYIGO_KV.delete(KV_KEY) } catch { /* ignore */ }
  }
}

/** 測試用：reset 模組狀態 */
export function _resetCacheForTests() {
  _currentClients = IN_CODE_CLIENTS
  _lastRefreshAt  = 0
}

// ── Sync getters（consumers 改用這些，不再用舊 const）────────

export function getAllClients()        { return _currentClients }
export function getClient(clientId)    { return _currentClients.find(c => c.client_id === clientId) ?? null }

export function getAllowedCorsOrigins()   { return _currentClients.flatMap(c => c.origins ?? []) }
export function getAllowedRedirectUris()  { return _currentClients.flatMap(c => c.redirect_uris ?? []) }
export function getAllowedPostLogoutUris(){ return _currentClients.flatMap(c => c.post_logout_redirect_uris ?? []) }
export function getFrontchannelUris()     { return _currentClients.flatMap(c => c.frontchannel_logout_uris ?? []) }

export function getBackchannelEndpoints() {
  return _currentClients
    .filter(c => c.backchannel_logout_uri)
    .map(c => ({ aud: c.aud, url: c.backchannel_logout_uri }))
}

export function getValidAuds() {
  return new Set(_currentClients.map(c => c.aud))
}

export function getAudByOrigin() {
  return Object.fromEntries(
    _currentClients.flatMap(c => (c.origins ?? []).map(o => [o, c.aud])),
  )
}

export function getFrontchannelFrameOrigins() {
  return [...new Set(getFrontchannelUris().map(u => {
    try { return new URL(u).origin } catch { return null }
  }).filter(Boolean))]
}

// ── 向後相容：舊 const 名稱 ────────────────────────────────
// 注意：這些是「first-load 快照」，cache refresh 後不會更新。
// 新 code 用 getXxx() 函式版本。

const flat = (key) => IN_CODE_CLIENTS.flatMap(c => c[key] ?? [])

/** @deprecated 用 getAllClients() 或 IN_CODE_CLIENTS */
export const OAUTH_CLIENTS                 = IN_CODE_CLIENTS
/** @deprecated 用 getAllowedCorsOrigins() */
export const ALLOWED_CORS_ORIGINS          = flat('origins')
/** @deprecated 用 getAllowedRedirectUris() */
export const ALLOWED_REDIRECT_URIS         = flat('redirect_uris')
/** @deprecated 用 getAllowedPostLogoutUris() */
export const ALLOWED_POST_LOGOUT_URIS      = flat('post_logout_redirect_uris')
/** @deprecated 用 getFrontchannelUris() */
export const FRONTCHANNEL_LOGOUT_URIS      = flat('frontchannel_logout_uris')
/** @deprecated 用 getBackchannelEndpoints() */
export const BACKCHANNEL_LOGOUT_ENDPOINTS  = IN_CODE_CLIENTS
  .filter(c => c.backchannel_logout_uri)
  .map(c => ({ aud: c.aud, url: c.backchannel_logout_uri }))
/** @deprecated 用 getValidAuds() */
export const VALID_AUDS                    = new Set(IN_CODE_CLIENTS.map(c => c.aud))
/** @deprecated 用 getAudByOrigin() */
export const AUD_BY_ORIGIN                 = Object.fromEntries(
  IN_CODE_CLIENTS.flatMap(c => c.origins.map(o => [o, c.aud])),
)
/** @deprecated 用 getFrontchannelFrameOrigins() */
export const FRONTCHANNEL_FRAME_ORIGINS    = [
  ...new Set(FRONTCHANNEL_LOGOUT_URIS.map(u => new URL(u).origin)),
]
