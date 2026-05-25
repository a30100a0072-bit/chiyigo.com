/**
 * F-3 Phase 2 PR 0.2c-pre-3（2026-05-25，TEMPORARY）— r2-preview-gate-binding-canary
 * unit test。
 *
 * 直接 import handler + stub prod R2 binding（`AUDIT_ARCHIVE_BUCKET`）。涵蓋：
 *   - auth 401 / CRON_SECRET 未設 500
 *   - binding 缺 500（defensive — prod binding 應永遠在，但缺時不可崩成 RuntimeError）
 *   - bad JSON / bad op / bad prefix（PREFIX_REGEX）/ bad key 400
 *   - body validation：put-class PUT_BODY_REQUIRED / non-put NON_PUT_REJECT_BODY
 *   - BUCKET_FIELD_FORBIDDEN（Object.hasOwn 判斷 property presence，不管值）
 *   - happy path：6 個 op 各回 outcome=success + success_meta
 *   - thrown path：stub bucket throw 帶 status/code/cause → captureThrown + classifier_verdict
 *     + classifier_paths_hit 對齊 isR2LockError 判定
 *
 * 本檔 commit 2 of PR 0.2c-pre-3 一起 delete（與 endpoint + integration test 同步）。
 */

import { describe, it, expect } from 'vitest'
import { onRequestPost } from '../functions/api/admin/cron/r2-preview-gate-binding-canary'

const CRON_SECRET = 'test-cron-secret'
// Match PREFIX_REGEX `^sacrificial\/preview-gate-binding\/\d{8}-\d{6}-[0-9a-f]{6}\/$`
const PREFIX = 'sacrificial/preview-gate-binding/20260525-143000-abc123/'
const KEY = `${PREFIX}control.txt`

function makeRequest(body: unknown, auth: string | null = `Bearer ${CRON_SECRET}`): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) headers['Authorization'] = auth
  return new Request('http://test/api/admin/cron/r2-preview-gate-binding-canary', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// stub bucket 同 1b.1 pattern + 多 get（給 get_control 用）
type StubBucket = {
  put: (key: string, body: unknown) => Promise<unknown>
  delete: (key: string) => Promise<void>
  head: (key: string) => Promise<unknown>
  get: (key: string) => Promise<unknown>
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
  const defaultGet: StubBucket['get'] = async (key) => {
    // 回 R2ObjectBody-like shape：含 arrayBuffer() + size
    const body = new TextEncoder().encode('canary-' + key)
    return {
      key,
      etag: 'etag-' + key,
      size: body.byteLength,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    }
  }
  const b: StubBucket = {
    put: overrides.put ?? defaultPut,
    delete: overrides.delete ?? defaultDelete,
    head: overrides.head ?? defaultHead,
    get: overrides.get ?? defaultGet,
  }
  return b
}

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    CRON_SECRET,
    AUDIT_ARCHIVE_BUCKET: stubBucket(),
    ...overrides,
  } as unknown as Env
}

describe('r2-preview-gate-binding-canary auth', () => {
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

  it('500 when prod binding missing', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: undefined }),
    })
    expect(r.status).toBe(500)
    const j = await r.json() as { code: string }
    expect(j.code).toBe('BINDING_MISSING')
  })
})

describe('r2-preview-gate-binding-canary validation', () => {
  it('400 on invalid JSON body', async () => {
    const r = await onRequestPost({
      request: makeRequest('not-json{'),
      env: makeEnv(),
    })
    expect(r.status).toBe(400)
    const j = await r.json() as { code: string }
    expect(j.code).toBe('BAD_REQUEST')
  })

  it('400 on body that parses to null', async () => {
    const r = await onRequestPost({
      request: makeRequest('null'),
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
    expect(j.supported).toContain('get_control')
    expect(j.supported).toHaveLength(6)
  })

  describe('PREFIX_REGEX strictness (升 r2 — startsWith 太寬)', () => {
    it.each([
      ['sacrificial/preview-gate-binding/', 'missing tail segment'],
      ['sacrificial/preview-gate-binding/2026-05-25/', 'wrong tail format'],
      ['sacrificial/preview-gate-binding/20260525-143000-abc123', 'missing trailing slash'],
      ['sacrificial/preview-gate-binding/20260525-143000-ABCDEF/', 'uppercase hex not allowed'],
      ['sacrificial/preview-gate-binding/2026525-143000-abc123/', '7-digit date'],
      ['sacrificial/preview-gate-binding/20260525-14300-abc123/', '5-digit time'],
      ['sacrificial/preview-gate-binding/20260525-143000-abc12/', '5-hex tail'],
      ['sacrificial/preview-gate-binding/20260525-143000-abc1234/', '7-hex tail'],
      ['audit-log-dryrun/', 'completely wrong prefix'],
      ['spike/binding-canary/test/', 'old 1b.1 prefix (must not pass new gate)'],
    ])('400 BAD_PREFIX for %s (%s)', async (prefix) => {
      const r = await onRequestPost({
        request: makeRequest({ op: 'head', prefix, key: prefix + 'x' }),
        env: makeEnv(),
      })
      expect(r.status).toBe(400)
      const j = await r.json() as { code: string }
      expect(j.code).toBe('BAD_PREFIX')
    })

    it('passes for canonical valid prefix', async () => {
      const r = await onRequestPost({
        request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }),
        env: makeEnv(),
      })
      expect(r.status).toBe(200)
      const j = await r.json() as { outcome: string }
      expect(j.outcome).toBe('success')
    })
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

  describe('body validation (升 r2 — op-specific)', () => {
    it.each(['setup_control', 'put_overwrite', 'put_new'] as const)
      ('400 PUT_BODY_REQUIRED for %s without body', async (op) => {
      const r = await onRequestPost({
        request: makeRequest({ op, prefix: PREFIX, key: KEY }),
        env: makeEnv(),
      })
      expect(r.status).toBe(400)
      const j = await r.json() as { code: string }
      expect(j.code).toBe('PUT_BODY_REQUIRED')
    })

    it('400 PUT_BODY_REQUIRED for put_new with empty string body', async () => {
      const r = await onRequestPost({
        request: makeRequest({ op: 'put_new', prefix: PREFIX, key: KEY, body: '' }),
        env: makeEnv(),
      })
      expect(r.status).toBe(400)
      const j = await r.json() as { code: string }
      expect(j.code).toBe('PUT_BODY_REQUIRED')
    })

    it('400 PUT_BODY_REQUIRED for put_overwrite with non-string body (number)', async () => {
      const r = await onRequestPost({
        request: makeRequest({ op: 'put_overwrite', prefix: PREFIX, key: KEY, body: 42 }),
        env: makeEnv(),
      })
      expect(r.status).toBe(400)
      const j = await r.json() as { code: string }
      expect(j.code).toBe('PUT_BODY_REQUIRED')
    })

    it.each(['delete', 'head', 'get_control'] as const)
      ('400 NON_PUT_REJECT_BODY for %s when body present', async (op) => {
      const r = await onRequestPost({
        request: makeRequest({ op, prefix: PREFIX, key: KEY, body: 'should-not-be-here' }),
        env: makeEnv(),
      })
      expect(r.status).toBe(400)
      const j = await r.json() as { code: string }
      expect(j.code).toBe('NON_PUT_REJECT_BODY')
    })

    it.each(['delete', 'head', 'get_control'] as const)
      ('200 success for %s when body absent/null/empty', async (op) => {
      // null
      const r1 = await onRequestPost({
        request: makeRequest({ op, prefix: PREFIX, key: KEY, body: null }),
        env: makeEnv(),
      })
      expect(r1.status).toBe(200)
      // empty string
      const r2 = await onRequestPost({
        request: makeRequest({ op, prefix: PREFIX, key: KEY, body: '' }),
        env: makeEnv(),
      })
      expect(r2.status).toBe(200)
    })
  })

  describe('BUCKET_FIELD_FORBIDDEN (升 r3 — Object.hasOwn property presence)', () => {
    it.each([
      ['chiyigo-audit-archive', 'truthy match (would-be valid)'],
      ['chiyigo-audit-archive-preview', 'truthy wrong'],
      ['', 'empty string'],
      [null, 'explicit null'],
      [false, 'explicit false'],
      [0, 'explicit zero'],
    ] as Array<[unknown, string]>)
      ('400 BUCKET_FIELD_FORBIDDEN for bucket=%j (%s) — fail-closed', async (value, _label) => {
      const r = await onRequestPost({
        request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY, bucket: value }),
        env: makeEnv(),
      })
      expect(r.status).toBe(400)
      const j = await r.json() as { code: string }
      expect(j.code).toBe('BUCKET_FIELD_FORBIDDEN')
    })

    it('200 when bucket field absent (does not even check op validation order)', async () => {
      const r = await onRequestPost({
        request: makeRequest({ op: 'head', prefix: PREFIX, key: KEY }),
        env: makeEnv(),
      })
      expect(r.status).toBe(200)
    })

    it('bucket field is checked BEFORE op enum (codex r2 finding 4 — fail-closed precedence)', async () => {
      // 同時帶 bucket + 帶 invalid op → 應先觸 BUCKET_FIELD_FORBIDDEN
      const r = await onRequestPost({
        request: makeRequest({ op: 'nope-invalid', prefix: PREFIX, key: KEY, bucket: 'x' }),
        env: makeEnv(),
      })
      expect(r.status).toBe(400)
      const j = await r.json() as { code: string }
      expect(j.code).toBe('BUCKET_FIELD_FORBIDDEN')
    })
  })
})

describe('r2-preview-gate-binding-canary happy path (6 ops)', () => {
  it('setup_control returns outcome=success + put meta', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'setup_control', prefix: PREFIX, key: KEY, body: 'canary-body' }),
      env: makeEnv(),
    })
    expect(r.status).toBe(200)
    const j = await r.json() as {
      op: string
      bucket: string
      outcome: string
      success_meta: { etag: string }
      thrown: unknown
      classifier_verdict: unknown
      classifier_paths_hit: unknown
      timing_ms: number
    }
    expect(j.op).toBe('setup_control')
    expect(j.bucket).toBe('chiyigo-audit-archive')
    expect(j.outcome).toBe('success')
    expect(j.success_meta.etag).toBe('etag-' + KEY)
    expect(j.thrown).toBeNull()
    expect(j.classifier_verdict).toBeNull()
    expect(j.classifier_paths_hit).toBeNull()
    expect(j.timing_ms).toBeGreaterThanOrEqual(0)
  })

  it('put_new returns outcome=success on different key', async () => {
    const newKey = PREFIX + 'newkey-abc.txt'
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_new', prefix: PREFIX, key: newKey, body: 'x' }),
      env: makeEnv(),
    })
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
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: bucket }),
    })
    const j = await r.json() as { outcome: string; success_meta: unknown }
    expect(j.outcome).toBe('success')
    expect(j.success_meta).toBeNull()
  })

  describe('get_control (op 6 — body_sha256 + size, NEVER raw body)', () => {
    it('returns success_meta with body_sha256 hex + size; no raw body', async () => {
      const knownBody = 'canary-' + KEY   // 對齊 stubBucket defaultGet
      const r = await onRequestPost({
        request: makeRequest({ op: 'get_control', prefix: PREFIX, key: KEY }),
        env: makeEnv(),
      })
      expect(r.status).toBe(200)
      const j = await r.json() as {
        outcome: string
        success_meta: { body_sha256: string; size: number } | null
      }
      expect(j.outcome).toBe('success')
      expect(j.success_meta).not.toBeNull()
      // sha256 hex 必 64 字
      expect(j.success_meta!.body_sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(j.success_meta!.size).toBe(new TextEncoder().encode(knownBody).byteLength)
      // 真實 sha256 對齊
      const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(knownBody))
      const expectedHex = Array.from(new Uint8Array(expected))
        .map(b => b.toString(16).padStart(2, '0')).join('')
      expect(j.success_meta!.body_sha256).toBe(expectedHex)
    })

    it('returns success_meta=null when object missing (get_control on nonexistent key)', async () => {
      const bucket = stubBucket({ get: async () => null })
      const r = await onRequestPost({
        request: makeRequest({ op: 'get_control', prefix: PREFIX, key: KEY }),
        env: makeEnv({ AUDIT_ARCHIVE_BUCKET: bucket }),
      })
      const j = await r.json() as { outcome: string; success_meta: unknown }
      expect(j.outcome).toBe('success')
      expect(j.success_meta).toBeNull()
    })

    it('response NEVER contains raw body bytes / body field (forensic SoT)', async () => {
      const r = await onRequestPost({
        request: makeRequest({ op: 'get_control', prefix: PREFIX, key: KEY }),
        env: makeEnv(),
      })
      const text = await r.text()
      // success_meta 不可包 'body' 欄位（只能 body_sha256 + size）
      expect(text).not.toMatch(/"body"\s*:/)
      expect(text).toContain('"body_sha256"')
      expect(text).toContain('"size"')
    })
  })
})

describe('r2-preview-gate-binding-canary thrown path (real bug surface + classifier verdict)', () => {
  function throwingBucket(err: unknown): unknown {
    return stubBucket({
      put: async () => { throw err },
      delete: async () => { throw err },
      get: async () => { throw err },
    })
  }

  it('captures Error + classifier hits fast_path_code on prod bucket lock (S3 shape)', async () => {
    // 模擬 S3 sigv4 path 的真實 R2 lock error（PR 1b spike fixture frozen shape）
    const err = Object.assign(new Error('The object is locked by the bucket policy.'), {
      code: 'ObjectLockedByBucketPolicy',
      status: 409,
    })
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_overwrite', prefix: PREFIX, key: KEY, body: 'x' }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: throwingBucket(err) }),
    })
    expect(r.status).toBe(200)  // 200 by design — fixture wants raw shape
    const j = await r.json() as {
      outcome: string
      thrown: {
        name: string; message: string; code: string; status: number
      }
      classifier_verdict: boolean
      classifier_paths_hit: string[]
    }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.code).toBe('ObjectLockedByBucketPolicy')
    expect(j.thrown.status).toBe(409)
    expect(j.classifier_verdict).toBe(true)
    expect(j.classifier_paths_hit).toContain('fast_path_code')
    // S3 shape 同時命中 dual_condition（status 409 + marker "locked"）
    expect(j.classifier_paths_hit).toContain('dual_condition')
  })

  it('captures binding shape (canary fixture) + classifier hits canonical_phrase + numeric_code', async () => {
    // 1b.1 binding canary fixture frozen: generic Error, no code/status/cause,
    // canonical phrase + 尾巴 "(10069)"
    const err = Object.assign(new Error('put: The object is locked by the bucket policy. (10069)'), {
      name: 'Error',
    })
    const r = await onRequestPost({
      request: makeRequest({ op: 'put_overwrite', prefix: PREFIX, key: KEY, body: 'x' }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: throwingBucket(err) }),
    })
    const j = await r.json() as {
      outcome: string
      thrown: { name: string; message: string; code: unknown; status: unknown; cause: unknown }
      classifier_verdict: boolean
      classifier_paths_hit: string[]
    }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.code).toBeNull()
    expect(j.thrown.status).toBeNull()
    expect(j.thrown.cause).toBeNull()
    expect(j.classifier_verdict).toBe(true)
    expect(j.classifier_paths_hit).toContain('canonical_phrase')
    expect(j.classifier_paths_hit).toContain('numeric_code')
    // 不應命中 fast_path_code（無 string code）或 dual_condition（無 status）
    expect(j.classifier_paths_hit).not.toContain('fast_path_code')
    expect(j.classifier_paths_hit).not.toContain('dual_condition')
  })

  it('captures non-lock throw → classifier_verdict=false + empty paths_hit', async () => {
    // 平凡 throw（無 lock 訊號）→ verdict 必 false
    const err = new Error('something else broke')
    const r = await onRequestPost({
      request: makeRequest({ op: 'delete', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: throwingBucket(err) }),
    })
    const j = await r.json() as {
      outcome: string
      classifier_verdict: boolean
      classifier_paths_hit: string[]
    }
    expect(j.outcome).toBe('thrown')
    expect(j.classifier_verdict).toBe(false)
    expect(j.classifier_paths_hit).toEqual([])
  })

  it('captures non-Error throw (string) with fallback name + verdict false', async () => {
    const r = await onRequestPost({
      request: makeRequest({ op: 'delete', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: throwingBucket('string-thrown') }),
    })
    const j = await r.json() as {
      outcome: string
      thrown: { name: string; message: string }
      classifier_verdict: boolean
      classifier_paths_hit: string[]
    }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.name).toBe('UnknownError')
    expect(j.thrown.message).toBe('string-thrown')
    // string 是 primitive，classifyR2LockError 在 typeof !== 'object' 即 false
    expect(j.classifier_verdict).toBe(false)
    expect(j.classifier_paths_hit).toEqual([])
  })

  it('captures get_control throw + classifier verdict on prod lock', async () => {
    // get_control 對 locked object 不應該 throw（lock 只擋 mutation），但若 throw
    // 仍要捕捉 + 跑 classifier，避免靜默
    const err = Object.assign(new Error('get: The object is locked by the bucket policy. (10069)'), {
      name: 'Error',
    })
    const r = await onRequestPost({
      request: makeRequest({ op: 'get_control', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: throwingBucket(err) }),
    })
    const j = await r.json() as {
      outcome: string
      classifier_verdict: boolean
      classifier_paths_hit: string[]
    }
    expect(j.outcome).toBe('thrown')
    expect(j.classifier_verdict).toBe(true)
    expect(j.classifier_paths_hit).toContain('canonical_phrase')
  })

  it('captures wrapped Error with cause chain — classifier walks one level', async () => {
    const cause = Object.assign(new Error('inner lock'), {
      code: 'ObjectLockedByBucketPolicy',
    })
    const top = Object.assign(new Error('R2 binding wrapper'), { name: 'Error', cause })
    const r = await onRequestPost({
      request: makeRequest({ op: 'delete', prefix: PREFIX, key: KEY }),
      env: makeEnv({ AUDIT_ARCHIVE_BUCKET: throwingBucket(top) }),
    })
    const j = await r.json() as {
      outcome: string
      thrown: { cause: { code: string } | null }
      classifier_verdict: boolean
      classifier_paths_hit: string[]
    }
    expect(j.outcome).toBe('thrown')
    expect(j.thrown.cause).not.toBeNull()
    expect(j.thrown.cause?.code).toBe('ObjectLockedByBucketPolicy')
    expect(j.classifier_verdict).toBe(true)
    expect(j.classifier_paths_hit).toContain('fast_path_code')
  })
})
