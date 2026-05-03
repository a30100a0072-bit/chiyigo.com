/**
 * 臨時 endpoint：驗證 KV binding 是否生效
 * GET /api/admin/kv-test
 *
 * 驗證後可刪除此檔（git rm）。
 */
export async function onRequestGet({ env }) {
  const bound      = !!env.CHIYIGO_KV
  let writeReadOk  = false
  let writeReadErr = null

  if (bound) {
    try {
      await env.CHIYIGO_KV.put('kv-test:ping', 'pong', { expirationTtl: 60 })
      const v = await env.CHIYIGO_KV.get('kv-test:ping')
      writeReadOk = v === 'pong'
      await env.CHIYIGO_KV.delete('kv-test:ping')
    } catch (e) {
      writeReadErr = e.message
    }
  }

  return new Response(JSON.stringify({
    bound,
    writeReadOk,
    writeReadErr,
    timestamp: new Date().toISOString(),
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}
