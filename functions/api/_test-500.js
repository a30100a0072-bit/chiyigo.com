// 臨時測試端點：故意回 500，驗證 5xx 告警鏈路
// ⚠️ 測完立刻刪掉這個檔案
export function onRequest() {
  return new Response(JSON.stringify({ error: 'boom' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}
