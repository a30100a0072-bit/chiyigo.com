/**
 * Phase C-1 Wave 1 — oauth_clients D1 backed 整合測試
 *
 * 驗證 functions/utils/oauth-clients.js 新 async API：
 *  - getAllClients：D1 → KV cache → in-code fallback 三層
 *  - getClient：依 client_id 取
 *  - getValidAuds：aud Set
 *  - invalidateClientsCache：清 KV
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers.js'
import {
  IN_CODE_CLIENTS,
  getAllClients,
  getClient,
  getValidAuds,
  invalidateClientsCache,
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

describe('oauth-clients D1 async API', () => {
  beforeAll(async () => { await resetDb() })
  beforeEach(async () => {
    await resetDb()
    await invalidateClientsCache(env) // 確保每個 test 從乾淨 KV 開始
  })

  it('D1 空表 → fallback in-code 4 個 RP', async () => {
    const all = await getAllClients(env)
    expect(all.length).toBe(IN_CODE_CLIENTS.length)
    expect(all.map(c => c.client_id).sort()).toEqual(['chiyigo', 'mbti', 'sport-app', 'talo'])
  })

  it('D1 有 row → 回 D1 內容（不再用 in-code）', async () => {
    await seedRP({
      client_id: 'test-rp',
      origins: ['https://test.example.com'],
      redirect_uris: ['https://test.example.com/cb'],
    })
    const all = await getAllClients(env)
    // D1 只有 1 個 row → in-code 不出現（因為 D1 path hit 後直接 return）
    expect(all.length).toBe(1)
    expect(all[0].client_id).toBe('test-rp')
    expect(all[0].origins).toEqual(['https://test.example.com'])
  })

  it('JSON column 解析正確（redirect_uris 是 array 不是 string）', async () => {
    await seedRP({
      client_id: 'multi-rp',
      redirect_uris: ['https://a.com/cb', 'https://b.com/cb'],
      origins: ['https://a.com', 'https://b.com'],
      backchannel: 'https://a.com/bc',
    })
    const all = await getAllClients(env)
    const c = all[0]
    expect(c.redirect_uris).toEqual(['https://a.com/cb', 'https://b.com/cb'])
    expect(c.origins.length).toBe(2)
    expect(c.backchannel_logout_uri).toBe('https://a.com/bc')
  })

  it('壞 JSON column → 該欄位 fallback 空陣列，不擋整體', async () => {
    // 直接寫一筆 redirect_uris 是壞 JSON
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_clients (
          client_id, client_name, app_type,
          allowed_redirect_uris, allowed_scopes,
          is_active, created_at, updated_at
        ) VALUES ('broken-rp', 'Broken', 'web', 'NOT_JSON', '[]', 1, datetime('now'), datetime('now'))
      `).run()
    const all = await getAllClients(env)
    expect(all.length).toBe(1)
    expect(all[0].redirect_uris).toEqual([])  // fallback
    expect(all[0].client_id).toBe('broken-rp')
  })

  it('aud 缺值（NULL）→ fallback = client_id', async () => {
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_clients (
          client_id, client_name, app_type,
          allowed_redirect_uris, allowed_scopes,
          aud,
          is_active, created_at, updated_at
        ) VALUES ('no-aud', 'No Aud', 'web', '[]', '[]', NULL, 1, datetime('now'), datetime('now'))
      `).run()
    const c = await getClient(env, 'no-aud')
    expect(c.aud).toBe('no-aud')
  })

  it('is_active = 0 → 不出現在 getAllClients', async () => {
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_clients (
          client_id, client_name, app_type,
          allowed_redirect_uris, allowed_scopes,
          is_active, created_at, updated_at
        ) VALUES ('disabled-rp', 'Disabled', 'web', '[]', '[]', 0, datetime('now'), datetime('now'))
      `).run()
    // is_active=1 的也要有，否則 fallback 會回 in-code
    await seedRP({ client_id: 'live-rp' })

    const all = await getAllClients(env)
    expect(all.map(c => c.client_id)).toEqual(['live-rp'])
  })

  it('getClient 找不到 → null', async () => {
    const c = await getClient(env, 'nope-not-here')
    // D1 空 → 走 in-code，in-code 沒這個 → null
    expect(c).toBeNull()
  })

  it('getClient 對 in-code RP（D1 空）→ 找得到', async () => {
    const c = await getClient(env, 'chiyigo')
    expect(c).toBeTruthy()
    expect(c.aud).toBe('chiyigo')
    expect(c.origins).toContain('https://chiyigo.com')
  })

  it('getValidAuds 回 Set 含所有 active aud', async () => {
    await seedRP({ client_id: 'a', aud: 'aud-A' })
    await seedRP({ client_id: 'b', aud: 'aud-B' })
    const auds = await getValidAuds(env)
    expect(auds.has('aud-A')).toBe(true)
    expect(auds.has('aud-B')).toBe(true)
    expect(auds.size).toBe(2)
  })

  it('KV cache：第二次呼叫不再打 D1', async () => {
    await seedRP({ client_id: 'cached-rp', origins: ['https://cached.example'] })

    const first = await getAllClients(env)
    expect(first[0].client_id).toBe('cached-rp')

    // 直接刪 D1 row；如果 KV cache 有效，下次呼叫仍應回 cached-rp
    await env.chiyigo_db.prepare(`DELETE FROM oauth_clients WHERE client_id = 'cached-rp'`).run()

    const second = await getAllClients(env)
    expect(second[0].client_id).toBe('cached-rp')
  })

  it('invalidateClientsCache 後再呼叫會重讀 D1', async () => {
    await seedRP({ client_id: 'before' })
    await getAllClients(env)  // populate cache

    // 改 D1，不清 cache → 還是讀到舊
    await env.chiyigo_db.prepare(`UPDATE oauth_clients SET client_id = 'after' WHERE client_id = 'before'`).run()
    let r = await getAllClients(env)
    expect(r[0].client_id).toBe('before') // cache hit

    // 清 cache → 重讀 D1
    await invalidateClientsCache(env)
    r = await getAllClients(env)
    expect(r[0].client_id).toBe('after')
  })

  it('in-code sync exports 不變（向後相容）', async () => {
    const { ALLOWED_REDIRECT_URIS, VALID_AUDS, AUD_BY_ORIGIN } =
      await import('../../functions/utils/oauth-clients.js')
    expect(ALLOWED_REDIRECT_URIS).toContain('https://chiyigo.com/callback')
    expect(VALID_AUDS.has('chiyigo')).toBe(true)
    expect(AUD_BY_ORIGIN['https://mbti.chiyigo.com']).toBe('mbti')
  })
})
