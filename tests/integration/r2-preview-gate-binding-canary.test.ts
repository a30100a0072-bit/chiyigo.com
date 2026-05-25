/**
 * F-3 Phase 2 PR 0.2c-pre-3（2026-05-25，TEMPORARY）— r2-preview-gate-binding-canary
 * integration test。
 *
 * 走 miniflare 內建 R2 binding（`AUDIT_ARCHIVE_BUCKET`，名稱與 prod 一致 — 但 miniflare
 * 走 local in-memory bucket，不 touch 真 prod bucket）— 與單元 stub 對照，驗證 wiring
 * 正確：auth / binding lookup / JSON parsing / op dispatch / 真實 PUT + HEAD + GET round-trip。
 * miniflare R2 不 enforce bucket lock，所以 thrown path（lock 真擋）仍由單元測試覆蓋。
 *
 * 重點：本檔最 critical 的驗證是 **get_control round-trip sha256 對齊**（plan §7 HARD
 * PASS condition 7）— 證明 endpoint setup_control + get_control 的 sha 計算流程
 * 端到端 reproducible。
 *
 * commit 2 of PR 0.2c-pre-3 一起 delete。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { onRequestPost as canary } from '../../functions/api/admin/cron/r2-preview-gate-binding-canary'

const CRON_SECRET = 'test-cron-secret'
// Match PREFIX_REGEX
const PREFIX = 'sacrificial/preview-gate-binding/20260525-143000-deadbe/'
const CONTROL_KEY = `${PREFIX}control.txt`
const CONTROL_BODY = 'canary-integ-known-body'

function makeRequest(body: unknown, auth: string | null = `Bearer ${CRON_SECRET}`): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) headers['Authorization'] = auth
  return new Request('http://test/api/admin/cron/r2-preview-gate-binding-canary', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function envWith(overrides: Record<string, unknown> = {}): Env {
  return { ...env, CRON_SECRET, ...overrides } as unknown as Env
}

async function clearBucket() {
  interface MinR2 {
    list: (opts: { limit: number }) => Promise<{ objects?: Array<{ key: string }> }>
    delete: (key: string) => Promise<void>
  }
  const bucket = (env as unknown as { AUDIT_ARCHIVE_BUCKET?: MinR2 }).AUDIT_ARCHIVE_BUCKET
  if (!bucket) return
  const list = await bucket.list({ limit: 1000 })
  for (const obj of list.objects ?? []) {
    await bucket.delete(obj.key)
  }
}

async function expectedSha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('r2-preview-gate-binding-canary integration', () => {
  beforeEach(async () => {
    await clearBucket()
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
      request: makeRequest({ op: 'setup_control', prefix: PREFIX, key: CONTROL_KEY, body: CONTROL_BODY }),
      env: envWith(),
    })
    expect(r1.status).toBe(200)
    const j1 = await r1.json() as {
      outcome: string
      success_meta: { etag: string | null }
      classifier_verdict: unknown
      classifier_paths_hit: unknown
    }
    expect(j1.outcome).toBe('success')
    expect(typeof j1.success_meta.etag).toBe('string')
    expect(j1.classifier_verdict).toBeNull()
    expect(j1.classifier_paths_hit).toBeNull()

    const r2 = await canary({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: CONTROL_KEY }),
      env: envWith(),
    })
    const j2 = await r2.json() as { outcome: string; success_meta: { etag: string | null; size: number | null } | null }
    expect(j2.outcome).toBe('success')
    expect(j2.success_meta).not.toBeNull()
    expect(j2.success_meta?.size).toBe(CONTROL_BODY.length)
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

  it('get_control round-trip: setup_control body → get_control sha256 matches expected (HARD PASS condition 7)', async () => {
    // 這是 plan §7 第 7 條 HARD PASS condition 的核心驗證：endpoint setup_control
    // 寫的 body，從 get_control 讀回計算的 sha256 必須與獨立計算的 expected sha256
    // 完全一致。prod 跑 canary 時靠這條對齊判 FAIL_STATE_BREACH。
    const r1 = await canary({
      request: makeRequest({ op: 'setup_control', prefix: PREFIX, key: CONTROL_KEY, body: CONTROL_BODY }),
      env: envWith(),
    })
    expect((await r1.json() as { outcome: string }).outcome).toBe('success')

    const r2 = await canary({
      request: makeRequest({ op: 'get_control', prefix: PREFIX, key: CONTROL_KEY }),
      env: envWith(),
    })
    expect(r2.status).toBe(200)
    const j2 = await r2.json() as {
      outcome: string
      success_meta: { body_sha256: string; size: number } | null
    }
    expect(j2.outcome).toBe('success')
    expect(j2.success_meta).not.toBeNull()
    const expected = await expectedSha256Hex(CONTROL_BODY)
    expect(j2.success_meta!.body_sha256).toBe(expected)
    expect(j2.success_meta!.size).toBe(CONTROL_BODY.length)

    // forensic：response text 不含 raw body
    const r3 = await canary({
      request: makeRequest({ op: 'get_control', prefix: PREFIX, key: CONTROL_KEY }),
      env: envWith(),
    })
    const text = await r3.text()
    expect(text).not.toContain(CONTROL_BODY)
  })
})
