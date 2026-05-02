/**
 * GET /frontchannel-logout
 *
 * OIDC Front-Channel Logout 1.0：被 chiyigo end_session_endpoint 嵌入 iframe。
 * 改成 Pages Function 動態回應，完全控制 response header；
 * 避開 _headers `! X-Frame-Options` 路徑覆寫不可靠的問題。
 *
 * 行為：
 *  - 清自己 origin (chiyigo.com) 的 sessionStorage
 *  - localStorage.setItem('oidc_logout_at', ts) 觸發同源主頁分頁 storage event → 即時清 token
 */

const HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>Logout</title>
<script>
  try { sessionStorage.removeItem('access_token') } catch (_) {}
  try { sessionStorage.removeItem('chiyigo_email') } catch (_) {}
  try { localStorage.setItem('oidc_logout_at', String(Date.now())) } catch (_) {}
</script>
</head>
<body></body>
</html>`

export async function onRequestGet() {
  return new Response(HTML, {
    status: 200,
    headers: {
      'Content-Type':            'text/html; charset=utf-8',
      'Cache-Control':           'no-store',
      // 不設 X-Frame-Options：完全靠 CSP frame-ancestors 控制嵌入權限
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors https://chiyigo.com",
      'Referrer-Policy':         'no-referrer',
    },
  })
}
