/**
 * Refresh token cookie 統一格式
 *
 * Domain=.chiyigo.com → 跨子網域共用（chiyigo / mbti / talo）
 * Path=/api/auth      → 只送到 auth 路由，避免每個請求都帶
 * SameSite=None       → 跨站 iframe 也送（IdP 必要）；OIDC silent SSO（prompt=none
 *                       iframe）從第三方 RP 嵌入 chiyigo /authorize 時，Lax 不送 →
 *                       永遠 login_required。改 None 後 cross-site iframe + 跨子網域
 *                       top-level nav 都送，前者新增、後者行為不變。
 *                       前提一律 Secure（HTTPS）+ HttpOnly + Path 限制；
 *                       refresh token 自帶 device_uuid + jti rotation + 撤銷機制，
 *                       SameSite=None 帶來的 CSRF 風險已被多層補償。
 */

const COOKIE_BASE = 'chiyigo_refresh=%TOKEN%; Domain=.chiyigo.com; HttpOnly; Secure; SameSite=None; Path=/api/auth'

export function refreshCookie(token, maxAgeSec) {
  return `${COOKIE_BASE.replace('%TOKEN%', token)}; Max-Age=${maxAgeSec}`
}

// 清空 cookie（登出 / end-session）— Max-Age=0 立即過期
export const CLEAR_REFRESH_COOKIE = COOKIE_BASE.replace('%TOKEN%', '') + '; Max-Age=0'

// ── OAuth device cookie ──────────────────────────────────────
// 給 browser-level device_uuid 走 OAuth flow 用：client JS 在按 OAuth 按鈕前
// 寫入 → server callback 寫進 refresh_tokens.device_uuid → 清掉。
// 不能 HttpOnly（client 端 JS 要寫）；走 SameSite=Lax 可跨 site top-level nav 帶回來。
const OAUTH_DEVICE_BASE = 'chiyigo_oauth_device=%VAL%; Path=/; SameSite=Lax; Secure'

export const CLEAR_OAUTH_DEVICE_COOKIE = OAUTH_DEVICE_BASE.replace('%VAL%', '') + '; Max-Age=0'

export function readOAuthDeviceCookie(request) {
  const c = request.headers.get('cookie') || ''
  const m = c.match(/(?:^|;\s*)chiyigo_oauth_device=([^;]+)/)
  if (!m) return null
  let val
  try { val = decodeURIComponent(m[1]) } catch { return null }
  return /^web-[0-9a-f-]{36}$/i.test(val) ? val : null
}
