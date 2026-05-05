/**
 * Phase C-1 Wave 2 — oauth_clients D1 backed 整合測試
 *
 * 驗證 functions/utils/oauth-clients.js：
 *  - refreshClientsCache：D1 → KV cache → in-code fallback 三層
 *  - sync getters（getAllClients / getClient / getValidAuds / ...）
 *    讀取 module-level cache（中間人 middleware 觸發 refresh）
 *  - 60s throttle 行為
 *  - invalidateClientsCache 清 KV + 強制下次 refresh
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers.js'
import {
  IN_CODE_CLIENTS,
  refreshClientsCache,
  getAllClients,
  getClient,
  getValidAuds,
  getAllowedRedirectUris,
  getAudByOrigin,
  invalidateClientsCache,
  _resetCacheForTests,
} from '../../functions/utils/oauth-clients.js'

async function seedRP({ client_id, aud, redirect_uris = [], origins = [], post_logout = [], frontchannel = [], backchannel = null }) {
  await env.chiyigo_db
    .prepare(`
      INSERT OR REPLACE INTO oauth_clients (
        client_id, client_name, app_type,
        allowed_redirect_uris, allowed_scopes,
        post_logout_redirect_uris,
        frontchannel_logout_uris, backchannel_logout_uri,
        cors_origins, aud,
        is_active, created_at, updated_at
      ) VALUES (?, ?, 'web', ?, '["openid"]', ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `)
    .bind(
      client_id, client_id,
      JSON.stringify(redirect_uris),
      JSON.stringify(post_logout),
      JSON.stringify(frontchannel),
      backchannel,
      JSON.stringify(origins),
      aud ?? client_id,
    )
    .run()
}

describe('oauth-clients D1 cache + sync getters', () => {
  beforeAll(async () => { await resetDb() })
  beforeEach(async () => {
    await resetDb()
    _resetCacheForTests()                 // module state
    await invalidateClientsCache(env)     // KV
  })

  it('未 refresh 過 → sync getter 讀到 in-code（4 個 RP）', () => {
    expect(getAllClients().length).toBe(IN_CODE_CLIENTS.length)
    expect(getValidAuds().has('chiyigo')).toBe(true)
  })

  it('refreshClientsCache 後 D1 有 row → 讀到 D1 內容', async () => {
    await seedRP({
      client_id: 'd1-only-rp',
      origins: ['https://d1only.example'],
      redirect_uris: ['https://d1only.example/cb'],
    })
    await refreshClientsCache(env)

    const all = getAllClients()
    expect(all.length).toBe(1)
    expect(all[0].client_id).toBe('d1-only-rp')
  })

  it('JSON column 正確解析成 array', async () => {
    await seedRP({
      client_id: 'multi-rp',
      redirect_uris: ['https://a.com/cb', 'https://b.com/cb'],
      origins: ['https://a.com', 'https://b.com'],
      backchannel: 'https://a.com/bc',
    })
    await refreshClientsCache(env)

    const c = getAllClients()[0]
    expect(c.redirect_uris).toEqual(['https://a.com/cb', 'https://b.com/cb'])
    expect(c.backchannel_logout_uri).toBe('https://a.com/bc')
  })

  it('壞 JSON column → 該欄位 fallback []，不擋整體', async () => {
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_clients (
          client_id, client_name, app_type,
          allowed_redirect_uris, allowed_scopes,
          is_active, created_at, updated_at
        ) VALUES ('broken-rp', 'Broken', 'web', 'NOT_JSON', '[]', 1, datetime('now'), datetime('now'))
      `).run()
    await refreshClientsCache(env)

    const c = getAllClients()[0]
    expect(c.client_id).toBe('broken-rp')
    expect(c.redirect_uris).toEqual([])
  })

  it('aud 欄位 NULL → fallback = client_id', async () => {
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_clients (
          client_id, client_name, app_type,
          allowed_redirect_uris, allowed_scopes, aud,
          is_active, created_at, updated_at
        ) VALUES ('no-aud', 'No Aud', 'web', '[]', '[]', NULL, 1, datetime('now'), datetime('now'))
      `).run()
    await refreshClientsCache(env)

    const c = getClient('no-aud')
    expect(c.aud).toBe('no-aud')
  })

  it('is_active = 0 → 不出現', async () => {
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_clients (
          client_id, client_name, app_type,
          allowed_redirect_uris, allowed_scopes,
          is_active, created_at, updated_at
        ) VALUES ('disabled-rp', 'Disabled', 'web', '[]', '[]', 0, datetime('now'), datetime('now'))
      `).run()
    await seedRP({ client_id: 'live-rp' })
    await refreshClientsCache(env)

    expect(getAllClients().map(c => c.client_id)).toEqual(['live-rp'])
  })

  it('60s throttle：同 isolate 內第二次呼叫不打 D1', async () => {
    await seedRP({ client_id: 'first-rp' })
    await refreshClientsCache(env)
    expect(getAllClients()[0].client_id).toBe('first-rp')

    // 改 D1，但因 throttle 不會重讀
    await env.chiyigo_db.prepare(`UPDATE oauth_clients SET client_id = 'changed-rp' WHERE client_id = 'first-rp'`).run()
    await refreshClientsCache(env)
    expect(getAllClients()[0].client_id).toBe('first-rp') // 還是舊值
  })

  it('invalidateClientsCache 後強制重讀 D1', async () => {
    await seedRP({ client_id: 'before' })
    await refreshClientsCache(env)
    expect(getAllClients()[0].client_id).toBe('before')

    await env.chiyigo_db.prepare(`UPDATE oauth_clients SET client_id = 'after' WHERE client_id = 'before'`).run()
    await invalidateClientsCache(env)  // 重置 throttle + 清 KV
    await refreshClientsCache(env)
    expect(getAllClients()[0].client_id).toBe('after')
  })

  it('衍生 getter：getAllowedRedirectUris flatten', async () => {
    await seedRP({ client_id: 'rp1', redirect_uris: ['https://x/cb1', 'https://x/cb2'] })
    await seedRP({ client_id: 'rp2', redirect_uris: ['https://y/cb'] })
    await refreshClientsCache(env)

    const list = getAllowedRedirectUris()
    expect(list.length).toBe(3)
    expect(list).toContain('https://x/cb1')
    expect(list).toContain('https://y/cb')
  })

  it('衍生 getter：getAudByOrigin 反查表', async () => {
    await seedRP({ client_id: 'rpA', aud: 'aud-A', origins: ['https://a.example', 'https://a2.example'] })
    await seedRP({ client_id: 'rpB', aud: 'aud-B', origins: ['https://b.example'] })
    await refreshClientsCache(env)

    const map = getAudByOrigin()
    expect(map['https://a.example']).toBe('aud-A')
    expect(map['https://a2.example']).toBe('aud-A')
    expect(map['https://b.example']).toBe('aud-B')
  })

  it('D1 表存在但無 active row → fallback 回 in-code（避免 stale cache 跨測試污染）', async () => {
    await seedRP({ client_id: 'cached-rp' })
    await refreshClientsCache(env)
    expect(getAllClients()[0].client_id).toBe('cached-rp')

    // 把所有 row 設成 inactive
    await env.chiyigo_db.prepare(`UPDATE oauth_clients SET is_active = 0`).run()
    await invalidateClientsCache(env)
    await refreshClientsCache(env)

    // 應該回 in-code 4 個 RP（不是維持 stale cached-rp）
    expect(getAllClients().length).toBe(IN_CODE_CLIENTS.length)
    expect(getAllClients().some(c => c.client_id === 'chiyigo')).toBe(true)
    expect(getAllClients().some(c => c.client_id === 'cached-rp')).toBe(false)
  })
})
