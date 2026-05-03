/**
 * Refresh token cookie 統一格式
 *
 * Domain=.chiyigo.com → 跨子網域共用（chiyigo / mbti / talo）
 * Path=/api/auth      → 只送到 auth 路由，避免每個請求都帶
 * SameSite=Lax        → 容許從子網域 top-level navigation 帶 cookie
 */

const COOKIE_BASE = 'chiyigo_refresh=%TOKEN%; Domain=.chiyigo.com; HttpOnly; Secure; SameSite=Lax; Path=/api/auth'

export function refreshCookie(token, maxAgeSec) {
  return `${COOKIE_BASE.replace('%TOKEN%', token)}; Max-Age=${maxAgeSec}`
}

// 清空 cookie（登出 / end-session）— Max-Age=0 立即過期
export const CLEAR_REFRESH_COOKIE = COOKIE_BASE.replace('%TOKEN%', '') + '; Max-Age=0'
