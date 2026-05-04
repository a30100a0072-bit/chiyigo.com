/**
 * OAuth/OIDC Client Registry — Phase 1（in-code source of truth）
 *
 * 為什麼有這個檔：
 *   未做這件事前 RP metadata 散落 5 個檔，加新 RP 要 patch 5 處。本檔把
 *   redirect / post-logout / frontchannel / backchannel / cors origin / aud
 *   集中為單一 source；其他模組改 import helper，不再各自硬寫名單。
 *
 * Phase 2（IAM_PLATFORM Phase C）會把 OAUTH_CLIENTS 從 in-code 換成 D1 表
 * `oauth_clients`（migration 0015 已建空表）。helper 介面屆時不變，呼叫端
 * 不必再動。
 *
 * 加新 RP 步驟（Phase 1 期間）：
 *   1. 在 OAUTH_CLIENTS 加一 entry
 *   2. 跑相關測試
 *   3. 部署
 */

/**
 * @typedef {Object} OAuthClient
 * @property {string}   client_id                    JWT aud claim 與業務識別
 * @property {string}   aud                          通常 = client_id；保留分開以利 Phase 2 演進
 * @property {string[]} origins                      該 RP 所有 web origin（CORS 白名單來源 + aud 反查）
 * @property {string[]} redirect_uris                authorize.js 白名單
 * @property {string[]} post_logout_redirect_uris    end-session.js post_logout_redirect_uri 白名單
 * @property {string[]} frontchannel_logout_uris     end-session HTML 內嵌 iframe URL
 * @property {string|null} backchannel_logout_uri    cross-site RP 必備；其餘留 null
 */

/** @type {OAuthClient[]} */
export const OAUTH_CLIENTS = [
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
    backchannel_logout_uri: null,  // 待 mbti repo 補 endpoint
  },
  {
    client_id: 'talo',
    aud: 'talo',
    origins: ['https://talo.chiyigo.com'],
    redirect_uris: ['https://talo.chiyigo.com/'],
    post_logout_redirect_uris: ['https://talo.chiyigo.com/'],
    frontchannel_logout_uris: ['https://talo.chiyigo.com/frontchannel-logout'],
    backchannel_logout_uri: null,  // 待 talo repo 補 endpoint
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

const flat = (key) => OAUTH_CLIENTS.flatMap(c => c[key] ?? [])

export const ALLOWED_CORS_ORIGINS         = flat('origins')
export const ALLOWED_REDIRECT_URIS        = flat('redirect_uris')
export const ALLOWED_POST_LOGOUT_URIS     = flat('post_logout_redirect_uris')
export const FRONTCHANNEL_LOGOUT_URIS     = flat('frontchannel_logout_uris')

/** [{ aud, url }] — 只有設定 backchannel_logout_uri 的 RP 會出現 */
export const BACKCHANNEL_LOGOUT_ENDPOINTS = OAUTH_CLIENTS
  .filter(c => c.backchannel_logout_uri)
  .map(c => ({ aud: c.aud, url: c.backchannel_logout_uri }))

/** Set，給 JWT aud 驗證用 */
export const VALID_AUDS = new Set(OAUTH_CLIENTS.map(c => c.aud))

/** origin → aud 反查表（cors.js resolveAud 用） */
export const AUD_BY_ORIGIN = Object.fromEntries(
  OAUTH_CLIENTS.flatMap(c => c.origins.map(o => [o, c.aud]))
)

/** end-session HTML 的 CSP frame-src 用（去重 origin） */
export const FRONTCHANNEL_FRAME_ORIGINS = [
  ...new Set(FRONTCHANNEL_LOGOUT_URIS.map(u => new URL(u).origin)),
]
