/**
 * OAuth/OIDC Client Registry — Phase C-1 (Wave 1)
 *
 * 演進歷史：
 *   - Phase 1（2026-05-04）：in-code OAUTH_CLIENTS 為唯一 source of truth，
 *     集中 5 處 hardcode。
 *   - Phase C-1 Wave 1（2026-05-05）：搬到 D1 表 `oauth_clients`（migration
 *     0020 seed 過，欄位齊）。新 RP 可走 SQL INSERT 不必改 code。in-code list
 *     保留作 boot-time 預設值 + D1 不可用時 fallback（縱深防禦）。
 *   - Wave 2（未來）：consumers（cors / authorize / end-session / backchannel）
 *     一個一個切到 async getter，從同步 const 變成請求時讀 D1+KV。
 *   - Wave 3（未來）：admin CRUD endpoints 走 D1。
 *
 * 模組現況：
 *   - 同步 export（IN_CODE_CLIENTS / ALLOWED_REDIRECT_URIS / ...）保留：
 *     既有 consumers 不必改，仍能跑（值來自 in-code 與 D1 seed 一致）。
 *   - 非同步 export（getAllClients / getClient / getValidAuds 等）：
 *     讀 D1（KV cache），D1 fail 時 fallback in-code。Wave 2 之後 consumers 換用此 API。
 *
 * 加新 RP 步驟（Wave 1 期間）：
 *   1. 跑一條 INSERT INTO oauth_clients 到 prod D1
 *   2. （**重要**）順便在 IN_CODE_CLIENTS 加一筆並 deploy，否則：
 *      - cors.js 等同步 consumer 看不到新 RP（aud/origin 反查失效）
 *      - D1 暫時失效時 fallback 也沒這筆
 *   3. Wave 2 完工後 step 2 才能省略
 */

/**
 * @typedef {Object} OAuthClient
 * @property {string}   client_id                    JWT aud claim 與業務識別
 * @property {string}   aud                          通常 = client_id；保留分開以利演進
 * @property {string[]} origins                      該 RP 所有 web origin（CORS 白名單來源 + aud 反查）
 * @property {string[]} redirect_uris                authorize.js 白名單
 * @property {string[]} post_logout_redirect_uris    end-session.js post_logout_redirect_uri 白名單
 * @property {string[]} frontchannel_logout_uris     end-session HTML 內嵌 iframe URL
 * @property {string|null} backchannel_logout_uri    cross-site RP 必備；其餘留 null
 */

/** @type {OAuthClient[]} — boot-time 預設值，與 migrations/0020 seed 對齊 */
export const IN_CODE_CLIENTS = [
  {
    client_id: 'chiyigo',
    aud: 'chiyigo',
    origins: ['https://chiyigo.com'],
    redirect_uris: [
      'chiyigo://auth/callback',          // Unity / Unreal / mobile custom scheme
      'https://chiyigo.com/callback',     // Web SPA
      'https://chiyigo.com/app/callback', // iOS Universal Link（預留）
    ],
    post_logout_redirect_uris: [
      'https://chiyigo.com/',
      'https://chiyigo.com/login',
    ],
    // chiyigo 自己用 /api/ 子路徑（避開 root-level single function 觸發 Pages bundle bug）
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

// ── Sync exports（既有 consumers 用；值取自 in-code）──────────────

const flat = (key) => IN_CODE_CLIENTS.flatMap(c => c[key] ?? [])

/** @deprecated 名稱保留向後相容；同等 IN_CODE_CLIENTS */
export const OAUTH_CLIENTS                 = IN_CODE_CLIENTS
export const ALLOWED_CORS_ORIGINS          = flat('origins')
export const ALLOWED_REDIRECT_URIS         = flat('redirect_uris')
export const ALLOWED_POST_LOGOUT_URIS      = flat('post_logout_redirect_uris')
export const FRONTCHANNEL_LOGOUT_URIS      = flat('frontchannel_logout_uris')

export const BACKCHANNEL_LOGOUT_ENDPOINTS  = IN_CODE_CLIENTS
  .filter(c => c.backchannel_logout_uri)
  .map(c => ({ aud: c.aud, url: c.backchannel_logout_uri }))

export const VALID_AUDS                    = new Set(IN_CODE_CLIENTS.map(c => c.aud))

export const AUD_BY_ORIGIN                 = Object.fromEntries(
  IN_CODE_CLIENTS.flatMap(c => c.origins.map(o => [o, c.aud]))
)

export const FRONTCHANNEL_FRAME_ORIGINS    = [
  ...new Set(FRONTCHANNEL_LOGOUT_URIS.map(u => new URL(u).origin)),
]

// ── Async D1-backed API（Wave 2 之後 consumers 切到這邊）─────────

const KV_KEY = 'oauth_clients:all'
const KV_TTL_SEC = 300 // 5 min；admin CRUD 寫入時應該主動 purge

/**
 * 把 D1 row 轉成統一 OAuthClient shape（JSON columns 解析）。
 * 失敗（壞 JSON）→ 該欄位 fallback 空陣列／null，不擋整體流程。
 */
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
 * 取所有 active client（D1 → KV cache → in-code fallback）。
 *
 * 來源優先序：
 *   1. KV cache hit
 *   2. D1 SELECT WHERE is_active=1
 *   3. IN_CODE_CLIENTS（D1 fail / 空表 / env 缺 binding）
 *
 * @param {object} env  Cloudflare env（CHIYIGO_KV / chiyigo_db optional）
 * @returns {Promise<OAuthClient[]>}
 */
export async function getAllClients(env) {
  // 1. KV cache
  if (env?.CHIYIGO_KV) {
    try {
      const cached = await env.CHIYIGO_KV.get(KV_KEY, 'json')
      if (Array.isArray(cached) && cached.length) return cached
    } catch { /* KV 暫時失效 → 走 D1 */ }
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
        // 寫 KV cache（失敗不擋）
        if (env.CHIYIGO_KV) {
          try { await env.CHIYIGO_KV.put(KV_KEY, JSON.stringify(clients), { expirationTtl: KV_TTL_SEC }) }
          catch { /* ignore */ }
        }
        return clients
      }
    } catch { /* D1 fail → in-code fallback */ }
  }

  // 3. in-code
  return IN_CODE_CLIENTS
}

/** 依 client_id 取單一 client（找不到回 null）。 */
export async function getClient(env, clientId) {
  const all = await getAllClients(env)
  return all.find(c => c.client_id === clientId) ?? null
}

/** 給 JWT aud 驗證用：所有 active aud 字串集合。 */
export async function getValidAuds(env) {
  const all = await getAllClients(env)
  return new Set(all.map(c => c.aud))
}

/** 主動清 KV cache（admin CRUD 寫入後呼叫）。 */
export async function invalidateClientsCache(env) {
  if (!env?.CHIYIGO_KV) return
  try { await env.CHIYIGO_KV.delete(KV_KEY) } catch { /* ignore */ }
}
