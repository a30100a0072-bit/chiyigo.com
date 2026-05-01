/**
 * GET /.well-known/openid-configuration
 *
 * OpenID Connect Discovery 1.0 §4 — Provider 的 metadata 端點。
 * 子站 / 第三方 OIDC client 透過此端點自動探查 chiyigo IAM 的所有 OAuth/OIDC URL。
 *
 * 用途：
 *  - 子站可用 openid-client / 任何 OIDC library 直接讀此 URL 自動配置：
 *      const issuer = await Issuer.discover('https://chiyigo.com')
 *  - 不再硬寫死 authorization_endpoint / token_endpoint，未來換路徑只改這裡
 *
 * 安全性：
 *  - 所有資訊都是公開的（純 metadata，無 secret）
 *  - 1 小時快取（與 jwks.json 一致）
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const ISSUER = 'https://chiyigo.com'

const CONFIG = {
  issuer: ISSUER,
  authorization_endpoint:  `${ISSUER}/api/auth/oauth/authorize`,
  token_endpoint:          `${ISSUER}/api/auth/oauth/token`,
  userinfo_endpoint:        `${ISSUER}/api/auth/userinfo`,
  jwks_uri:                `${ISSUER}/.well-known/jwks.json`,
  end_session_endpoint:    `${ISSUER}/api/auth/oauth/end-session`,
  frontchannel_logout_supported:          true,
  frontchannel_logout_session_supported:  false,

  response_types_supported:               ['code'],
  subject_types_supported:                ['public'],
  id_token_signing_alg_values_supported:  ['ES256'],
  token_endpoint_auth_methods_supported:  ['none'],  // PKCE-only, public client
  code_challenge_methods_supported:       ['S256'],
  grant_types_supported:                  ['authorization_code', 'refresh_token'],
  scopes_supported:                       ['openid', 'profile', 'email'],
  claims_supported: [
    'sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'auth_time',
    'email', 'email_verified', 'name',
  ],
  // 標明本端點不支援的可選功能（client 不要嘗試）
  request_parameter_supported:            false,
  request_uri_parameter_supported:        false,
}

export async function onRequestGet() {
  return new Response(JSON.stringify(CONFIG), {
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    },
  })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
