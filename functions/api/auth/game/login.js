/**
 * GET /api/auth/game/login?platform=pc|mobile|web&provider=discord[&port=PORT]
 *
 * 遊戲端登入統整入口。回傳 JSON 格式的 SSO 啟動 URL。
 *
 * 設計動機：
 *  Unity / Unreal 等遊戲引擎不適合直接跟隨 HTTP 重導向，
 *  需先以 HTTP GET 取得 URL，再呼叫平台 API 開啟外部瀏覽器（Desktop Shell / SFSafariViewController 等）。
 *  本端點提供穩定的統一接口，provider 增加時只需更新此處，遊戲端無需改動。
 *
 * 流程（PC 範例）：
 *  1. 遊戲引擎 → GET /api/auth/game/login?platform=pc&port=12345
 *  2. 回傳 { url: "https://chiyigo.com/api/auth/discord/init?platform=pc&port=12345" }
 *  3. 遊戲引擎以 Shell.Execute / Process.Start 開啟 URL
 *  4. 用戶完成 Discord OAuth
 *  5. 回呼至 http://127.0.0.1:12345/callback?access_token=... （遊戲引擎本地監聽）
 *
 * 參數：
 *  platform  — 'pc' | 'mobile' | 'web'（必填）
 *  provider  — 'discord'（選填，預設 discord；未來支援 steam / epic）
 *  port      — 4-5 位數字（platform=pc 時必填，Loopback 監聽埠）
 *
 * 回傳：
 *  200 → { provider, platform, url }
 *  400 → { error: string }
 */

const SUPPORTED_PROVIDERS = ['discord']

const PROVIDER_INIT_PATHS = {
  discord: '/api/auth/discord/init',
}

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url)
  const platform = url.searchParams.get('platform') ?? 'web'
  const provider = url.searchParams.get('provider') ?? 'discord'
  const port     = url.searchParams.get('port')

  // ── 參數驗證 ─────────────────────────────────────────────────
  if (!['web', 'pc', 'mobile'].includes(platform))
    return res({ error: 'Invalid platform. Must be web, pc, or mobile.' }, 400)

  if (!SUPPORTED_PROVIDERS.includes(provider))
    return res({
      error: `Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
    }, 400)

  if (platform === 'pc' && (!port || !/^\d{4,5}$/.test(port)))
    return res({ error: 'platform=pc requires a valid port parameter (4-5 digits)' }, 400)

  // ── 建構 SSO 啟動 URL ────────────────────────────────────────
  const baseUrl  = env.IAM_BASE_URL ?? 'https://chiyigo.com'
  const initUrl  = new URL(PROVIDER_INIT_PATHS[provider], baseUrl)

  initUrl.searchParams.set('platform', platform)
  if (port) initUrl.searchParams.set('port', port)

  return res({ provider, platform, url: initUrl.toString() })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
