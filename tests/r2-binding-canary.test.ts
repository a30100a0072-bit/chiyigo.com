/**
 * F-3 Phase 2 PR 0.2c-pre-1b.1（2026-05-24，TEMPORARY）— r2-binding-canary handler unit test.
 *
 * 直接 import handler + stub R2 binding。涵蓋：
 *   - auth 401 / CRON_SECRET 未設 500
 *   - binding 缺 500
 *   - bad JSON / bad op / bad prefix / bad key 400
 *   - happy path：setup_control / put_new / put_overwrite / delete / head 各回 outcome=success +
 *     success_meta 帶 etag/size
 *   - thrown path：stub bucket throw 帶 status/code/cause → captureThrown shape 對齊
 *     （這是 binding canary 真正要驗的重點：runtime 真實 throw 也要被原樣捕捉成 JSON）
 *
 * 本檔 commit 2 of PR 0.2c-pre-1b.1 一起 delete（與 endpoint + binding 同步）。
 */

import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../functions/api/admin/cron/r2-binding-canary'

const CRON_SECRET = 'test-cron-secret'
const PREFIX = 'spike/binding-canary/20260524-test/'
const KEY = `${PREFIX}control.txt`

function makeRequest(body: unknown, auth: string | null = `Bearer ${CRON_SECRET}`): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) headers['Authorization'] = auth
  return new Request('http://test/api/admin/cron/r2-binding-canary', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// 用 plain object stub + 結尾 cast，避開引入 @cloudflare/workers-types
// 全域型別（本 repo 沒裝；env.d.ts 走 .d.ts ambient relax 才不 error）。
type StubBucket = {
  put: (key: string, body: unknown) => Promise<unknown>
  delete: (key: string) => Promise<void>
  head: (key: string) => Promise<unknown>
}

function stubBucket(overrides: Partial<StubBucket> = {}): unknown {
  const defaultPut: StubBucket['put'] = async (key) => ({
    key,
    etag: 'etag-' + key,
    httpEtag: '"etag-' + key + '"',
    size: 0,
    version: 'v-' + key,
  })
  const defaultDelete: StubBucket['delete'] = async () => {}
  const defaultHead: StubBucket['head'] = async (key) => ({
    key,
    etag: 'etag-' + key,
    size: 4,
  })
  const b: StubBucket = {
    put: overrides.put ?? defaultPut,
    delete: overrides.delete ?? defaultDelete,
    head: overrides.head ?? defaultHead,
  }
  return b
}

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    CRON_SECRET,
    AUDIT_ARCHIVE_BUCKET_PREVIEW: stubBucket(),
    ...overrides,
  } as unknown as Env
}

describe('r2-binding-canary auth', () => {
  it('500 when CRON_SECRET not configured', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }),
      env: makeEnv({ CRON_SECRET: undefined }),
    })
    expect(r.status).toBe(500)
    const j = await r.json() as { code: string }
    expect(j.code).toBe('CRON_SECRET_NOT_CONFIGURED')
  })

  it('401 when missing bearer', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }, null),
      env: makeEnv(),
    })
    expect(r.status).toBe(401)
  })

  it('401 when wrong bearer', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }, 'Bearer wrong'),
      env: makeEnv(),
    })
    expect(r.status).toBe(401)
  })

  it('500 when preview binding missing', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET_PREVIEW: undefined }),
    })
    expect(r.status).toBe(500)
    const j = await r.json() as { code: string }
    expect(j.code).toBe('BINDING_MISSING')
  })
})

describe('r2-binding-canary validation', () => {
  it('400 on invalid JSON body', async () => {
    const r = await onRequestPost({
      request: makeRequest('not-json{'),
      env: makeEnv(),
    })
    expect(r.status).toBe(400)
    const j = await r.json() as { code: string }
    expect(j.code).toBe('BAD_REQUEST')
  })

  it('400 on unknown op', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'nope', prefix: PREFIX, key: KEY }),
      env: makeEnv(),
    })
    expect(r.status).toBe(400)
    const j = await r.json() as { code: string; supported: string[] }
    expect(j.code).toBe('BAD_OP')
    expect(j.supported).toContain('put_overwrite')
  })

  it('400 when prefix does not start with spike/binding-canary/', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: 'audit-log-dryrun/', key: 'audit-log-dryrun/x.json' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(400)
    const j = await r.json() as { code: string }
    expect(j.code).toBe('BAD_PREFIX')
  })

  it('400 when key does not start with prefix', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: 'other/key.txt' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(400)
    const j = await r.json() as { code: string }
    expect(j.code).toBe('BAD_KEY')
  })
})

describe('r2-binding-canary happy path', () => {
  it('setup_control returns outcome=success + put meta', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'setup_control', prefix: PREFIX, key: KEY, body: 'canary-body' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(200)
    const j = await r.json() as {
      op: string; outcome: string; success_meta: { etag: string }; thrown: unknown; timing_ms: number
    }
    expect(j.op).toBe('setup_control')
    expect(j.outcome).toBe('success')
    expect(j.success_meta.etag).toBe('etag-' + KEY)
    expect(j.thrown).toBeNull()
    expect(j.timing_ms).toBeGreaterThanOrEqual(0)
  })

  it('put_new returns outcome=success', async () => {
    const newKey = PREFIX + 'newkey-abc.txt'
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_new', prefix: PREFIX, key: newKey, body: 'x' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(200)
    const j = await r.json() as { outcome: string; key: string }
    expect(j.outcome).toBe('success')
    expect(j.key).toBe(newKey)
  })

  it('put_overwrite happy path returns outcome=success (no lock in stub)', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_overwrite', prefix: PREFIX, key: KEY, body: 'overwrite' }),
      env: makeEnv(),
    })
    const j = await r.json() as { outcome: string }
    expect(j.outcome).toBe('success')
  })

  it('delete happy path returns outcome=success', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'delete', prefix: PREFIX, key: KEY }),
      env: makeEnv(),
    })
    const j = await r.json() as { outcome: string; success_meta: { deleted: boolean } }
    expect(j.outcome).toBe('success')
    expect(j.success_meta.deleted).toBe(true)
  })

  it('head returns success_meta when object exists', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }),
      env: makeEnv(),
    })
    const j = await r.json() as { outcome: string; success_meta: { etag: string } }
    expect(j.outcome).toBe('success')
    expect(j.success_meta.etag).toBe('etag-' + KEY)
  })

  it('head returns success_meta=null when object missing', async () => {
    const bucket = stubBucket({ head: async () => null })
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET_PREVIEW: bucket }),
    })
    const j = await r.json() as { outcome: string; success_meta: unknown }
    expect(j.outcome).toBe('success')
    expect(j.success_meta).toBeNull()
  })
})

describe('r2-binding-canary thrown path (real bug surface)', () => {
  function throwingBucket(err: unknown): unknown {
    return stubBucket({
      put: async () => { throw err },
      delete: async () => { throw err },
    })
  }

  it('captures Error with status + code + cause chain on put_overwrite', async () => {
    const cause = Object.assign(new Error('object locked by bucket policy'), {
      code: 'ObjectLockedByBucketPolicy',
      status: 409,
    })
    const top = Object.assign(new Error('R2 put failed'), {
      name: 'R2Error',
      code: 'PUT_FAILED',
      status: 409,
      cause,
    })
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_overwrite', prefix: PREFIX, key: KEY, body: 'x' }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET_PREVIEW: throwingBucket(top) }),
    })
    expect(r.status).toBe(200)  // 200 by design — fixture wants raw shape
    const j = await r.json() as {
      outcome: string
      thrown: {
        name: string; message: string; code: string; status: number
        cause: { name: string; message: string; code: string; status: number } | null
        stringified: string
      }
    }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.name).toBe('R2Error')
    expect(j.thrown.message).toBe('R2 put failed')
    expect(j.thrown.code).toBe('PUT_FAILED')
    expect(j.thrown.status).toBe(409)
    expect(j.thrown.cause).not.toBeNull()
    expect(j.thrown.cause?.code).toBe('ObjectLockedByBucketPolicy')
    expect(j.thrown.cause?.status).toBe(409)
    expect(j.thrown.stringified.length).toBeGreaterThan(0)
  })

  it('captures Error on delete with status + code', async () => {
    const err = Object.assign(new Error('locked'), {
      name: 'R2Error',
      code: 'ObjectLockedByBucketPolicy',
      status: 409,
    })
    const r = await onRequestPost({
      request: makeRequest({ op: 'delete', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET_PREVIEW: throwingBucket(err) }),
    })
    const j = await r.json() as { outcome: string; thrown: { code: string; status: number; cause: unknown } }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.code).toBe('ObjectLockedByBucketPolicy')
    expect(j.thrown.status).toBe(409)
    expect(j.thrown.cause).toBeNull()
  })

  it('captures throw without status/code/cause as nullable fields', async () => {
    const err = new Error('plain error')
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_new', prefix: PREFIX, key: PREFIX + 'x.txt', body: 'y' }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET_PREVIEW: throwingBucket(err) }),
    })
    const j = await r.json() as { outcome: string; thrown: { code: unknown; status: unknown; cause: unknown } }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.code).toBeNull()
    expect(j.thrown.status).toBeNull()
    expect(j.thrown.cause).toBeNull()
  })

  it('captures non-Error throw (string) with fallback name', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'delete', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET_PREVIEW: throwingBucket('string-thrown') }),
    })
    const j = await r.json() as { outcome: string; thrown: { name: string; message: string } }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.name).toBe('UnknownError')
    expect(j.thrown.message).toBe('string-thrown')
  })

  it('reads httpStatus / statusCode aliases', async () => {
    const err = Object.assign(new Error('locked via httpStatus'), { httpStatus: 423 })
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_overwrite', prefix: PREFIX, key: KEY, body: 'x' }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET_PREVIEW: throwingBucket(err) }),
    })
    const j = await r.json() as { thrown: { status: number } }
    expect(j.thrown.status).toBe(423)
  })
})
