/**
 * GET /api/redirect/line
 *
 * 防禦性 LINE 官方帳號轉址端點。
 * 前端不直接持有 LINE deep link；由此 Worker 做 302 redirect，
 * 並記錄 IP / UA 觀測資料（placeholder，可擴充至 D1 / Analytics）。
 *
 * 環境變數：
 *   LINE_OA_URL  — LINE deep link（設定於 Cloudflare Pages → Settings → Variables）
 *                  預設值：https://line.me/ti/p/p8VUMxtZEc
 */

export async function onRequestGet(context) {
  const { request, env } = context

  const dest = env.LINE_OA_URL ?? 'https://line.me/ti/p/p8VUMxtZEc'
  const ip   = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const ua   = (request.headers.get('User-Agent') ?? '').slice(0, 120)
  const ref  = request.headers.get('Referer') ?? ''

  // Placeholder log — 可擴充：寫入 D1 analytics_events 表或 Logpush
  console.log(JSON.stringify({
    event : 'line_redirect_click',
    ts    : Date.now(),
    ip,
    ua,
    ref,
  }))

  return Response.redirect(dest, 302)
}
