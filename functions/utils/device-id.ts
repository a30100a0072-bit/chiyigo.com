/**
 * device-id.js — browser-level device_uuid 純邏輯（給 unit test 用）
 *
 * Frontend 側 inline 同樣邏輯於 4 處（不是 ESM 不能 import）：
 *   - public/js/auth-ui.js：_chiyigoGetDeviceUuid()
 *   - public/js/api.js：_chiyigoGetDeviceUuid()
 *   - public/js/sidebar-auth.js：_chiyigoGetDeviceUuid()
 *   - public/js/ai-assistant.js：refresh 段 inline IIFE
 * 改 logic 時 4 處要同步，否則裝置綁定行為會不一致。
 *
 * 規格：
 *   - localStorage 已存且符合 web-<uuid> → 回傳
 *   - 無存 → 用 randomUuid() 產 + 寫 localStorage → 回傳
 *   - randomUuid 不可用 → 回 null（前端 console.warn，不阻擋登入）
 *   - localStorage 寫失敗（Safari private mode）→ 接受值仍回傳，前端退到 in-memory cache
 */
const VALID_RE = /^web-[0-9a-f-]{36}$/i

export function pickOrMakeDeviceUuid({ read, write, makeUuid }) {
  const existing = safeCall(read)
  if (existing && VALID_RE.test(existing)) return existing

  const fresh = safeCall(makeUuid)
  if (!fresh) return null

  const fullUuid = 'web-' + fresh
  safeCall(() => write(fullUuid))
  return fullUuid
}

function safeCall(fn) {
  try { return fn() }
  catch { return null }
}
