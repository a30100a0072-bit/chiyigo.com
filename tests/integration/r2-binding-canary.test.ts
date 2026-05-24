/**
 * F-3 Phase 2 PR 0.2c-pre-1b.1（2026-05-24，TEMPORARY）— r2-binding-canary integration test.
 *
 * 走 miniflare 內建 R2 binding (AUDIT_ARCHIVE_BUCKET_PREVIEW) — 與單元 stub 對照，
 * 驗證 wiring 正確：auth / binding lookup / JSON parsing / op dispatch / 真實 PUT
 * + HEAD round-trip。miniflare R2 不 enforce bucket lock，所以 thrown path 仍由
 * 單元測試覆蓋（見 tests/r2-binding-canary.test.ts thrown 段）。
 *
 * commit 2 of PR 0.2c-pre-1b.1 一起 delete。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { onRequestPost as canary } from '../../functions/api/admin/cron/r2-binding-canary'

const CRON_SECRET = 'test-cron-secret'
const PREFIX = 'spike/binding-canary/integ-test/'
const CONTROL_KEY = `${PREFIX}control.txt`

function makeRequest(body: unknown, auth: string | null = `Bearer ${CRON_SECRET}`): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) headers['Authorization'] = auth
  return new Request('http://test/api/admin/cron/r2-binding-canary', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function envWith(overrides: Record<string, unknown> = {}): Env {
  return { ...env, CRON_SECRET, ...overrides } as unknown as Env
}

async function clearPreviewBucket() {
  // R2Bucket 全域型別在本 repo 沒裝 @cloudflare/workers-types，這裡用最小 shape
  // 標 list / delete 即可。env.d.ts 走 .d.ts ambient relax，不適用於 .ts test。
  interface MinR2 {
    list: (opts: { limit: number }) => Promise<{ objects?: Array<{ key: string }> }>
    delete: (key: string) => Promise<void>
  }
  const bucket = (env as unknown as { AUDIT_ARCHIVE_BUCKET_PREVIEW?: MinR2 }).AUDIT_ARCHIVE_BUCKET_PREVIEW
  if (!bucket) return
  const list = await bucket.list({ limit: 1000 })
  for (const obj of list.objects ?? []) {
    await bucket.delete(obj.key)
  }
}

describe('r2-binding-canary integration', () => {
  beforeEach(async () => {
    await clearPreviewBucket()
  })

  it('401 without bearer', async () => {
    const r = await canary({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: CONTROL_KEY }, null),
      env: envWith(),
    })
    expect(r.status).toBe(401)
  })

  it('setup_control PUTs object then head sees it', async () => {
    const r1 = await canary({
      request: makeRequest({ op: 'setup_control', prefix: PREFIX, key: CONTROL_KEY, body: 'canary-integ' }),
      env: envWith(),
    })
    expect(r1.status).toBe(200)
    const j1 = await r1.json() as { outcome: string; success_meta: { etag: string | null } }
    expect(j1.outcome).toBe('success')
    expect(typeof j1.success_meta.etag).toBe('string')

    const r2 = await canary({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: CONTROL_KEY }),
      env: envWith(),
    })
    const j2 = await r2.json() as { outcome: string; success_meta: { etag: string | null; size: number | null } | null }
    expect(j2.outcome).toBe('success')
    expect(j2.success_meta).not.toBeNull()
    expect(j2.success_meta?.size).toBeGreaterThan(0)
  })

  it('put_new + head round-trip on different key', async () => {
    const newKey = PREFIX + 'newkey-integ.txt'
    const r1 = await canary({
      request: makeRequest({ op: 'put_new', prefix: PREFIX, key: newKey, body: 'newbody' }),
      env: envWith(),
    })
    expect((await r1.json() as { outcome: string }).outcome).toBe('success')

    const r2 = await canary({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: newKey }),
      env: envWith(),
    })
    const j2 = await r2.json() as { outcome: string; success_meta: { size: number | null } | null }
    expect(j2.outcome).toBe('success')
    expect(j2.success_meta?.size).toBe('newbody'.length)
  })

  it('delete removes the object (miniflare not lock-enforced)', async () => {
    await canary({
      request: makeRequest({ op: 'setup_control', prefix: PREFIX, key: CONTROL_KEY, body: 'x' }),
      env: envWith(),
    })
    const rd = await canary({
      request: makeRequest({ op: 'delete', prefix: PREFIX, key: CONTROL_KEY }),
      env: envWith(),
    })
    expect((await rd.json() as { outcome: string }).outcome).toBe('success')

    const rh = await canary({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: CONTROL_KEY }),
      env: envWith(),
    })
    const jh = await rh.json() as { outcome: string; success_meta: unknown }
    expect(jh.outcome).toBe('success')
    expect(jh.success_meta).toBeNull()
  })
})
