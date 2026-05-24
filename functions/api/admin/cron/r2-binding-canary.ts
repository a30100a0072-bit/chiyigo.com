/**
 * POST /api/admin/cron/r2-binding-canary
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 0.2c-pre-1b.1（2026-05-24，TEMPORARY）— Worker R2 binding canary.
 *
 * 為什麼存在：
 *   PR 0.2c-pre-1b spike 用 S3 sigv4 + limited token 親驗 R2 retention lock
 *   enforce same-key PUT-overwrite + DELETE，回 HTTP 409 + ObjectLockedByBucketPolicy。
 *   但 prod cron 走 worker binding（account-level，等同 wrangler 那條被推翻路徑的
 *   權限位階）— S3 sigv4 path 不代表 binding path 同樣行為（codex r1 P1）。本 endpoint
 *   是給 user curl 對 preview bucket 跑 5 個 op，捕捉真實 binding error shape：
 *     - setup_control: 對 prefix 內 control key PUT bootstrap object
 *     - put_overwrite: 對同一 key 再 PUT（lock 應擋 → throw；driver test）
 *     - put_new:       對 prefix 內**新** key PUT（lock 不擋 → success；write-once 設計成立）
 *     - delete:        對 control key DELETE（lock 應擋 → throw；driver test）
 *     - head:          對 control key HEAD（驗證物件仍在）
 *   raw JSON 寫進 docs/fixtures/r2-lock-binding-canary-<DATE>.json，
 *   isR2LockError classifier 對齊新 shape（或證 binding bypass → reject prod lock）。
 *
 * 何時移除：commit 2 of PR 0.2c-pre-1b.1。本檔 + wrangler.toml binding + types/env.d.ts
 *   entry + tests **同 PR 一起 delete**，避免 prod 殘留 surface。Endpoint 唯一允許的
 *   binding 是 AUDIT_ARCHIVE_BUCKET_PREVIEW；對 prod bucket（AUDIT_ARCHIVE_BUCKET）
 *   寫入受 import 限制（本檔不 import）。
 *
 * 安全護欄：
 *   - Auth: Bearer CRON_SECRET（同 audit-archive cron endpoint pattern）
 *   - prefix 必須以 'spike/binding-canary/' 開頭 → 400 BAD_PREFIX
 *   - key 必須以 prefix 開頭 → 400 BAD_KEY
 *   - op 限定 5 個 → 400 BAD_OP
 *   - 只 touch env.AUDIT_ARCHIVE_BUCKET_PREVIEW；不 import AUDIT_ARCHIVE_BUCKET
 *
 * 回應：HTTP 200（無論 op 成功或 throw，都 200 回真實 shape，便於 curl + fixture
 *   capture；auth / binding / validation fail 才用 4xx/5xx）。
 *
 * Lint 互動：r2-binding-canary.ts 檔名不符 scripts/_archive-lint-patterns.js
 *   FILE_PATTERN（/^audit-(aggregate-)?archive.*\.(js|ts)$/） → 不受 archive
 *   no-delete / no-bare-put discipline 規範。R2_BINDING regex 也不含
 *   AUDIT_ARCHIVE_BUCKET_PREVIEW（word boundary 阻擋 `_PREVIEW` suffix）
 *   或 canaryBucket alias。雙層保險。
 */

import { res } from '../../../utils/auth'

const PREFIX_GUARD = 'spike/binding-canary/'

const SUPPORTED_OPS = ['setup_control', 'put_overwrite', 'put_new', 'delete', 'head'] as const
type CanaryOp = typeof SUPPORTED_OPS[number]
const SUPPORTED_OPS_SET: ReadonlySet<string> = new Set<string>(SUPPORTED_OPS)

interface ThrownShape {
  name: string
  message: string
  code: string | number | null
  status: number | null
  cause: {
    name: string | null
    message: string | null
    code: string | number | null
    status: number | null
  } | null
  stringified: string
}

interface CanaryRequestBody {
  op?: unknown
  prefix?: unknown
  key?: unknown
  body?: unknown
}

function pickStatus(e: { status?: unknown; httpStatus?: unknown; statusCode?: unknown } | null | undefined): number | null {
  if (!e) return null
  const n = Number(e.status ?? e.httpStatus ?? e.statusCode)
  return Number.isFinite(n) ? n : null
}

function pickCode(e: { code?: unknown } | null | undefined): string | number | null {
  if (!e) return null
  const c = e.code
  return typeof c === 'string' || typeof c === 'number' ? c : null
}

function captureThrown(err: unknown): ThrownShape {
  const e = (err ?? {}) as {
    name?: unknown
    message?: unknown
    code?: unknown
    status?: unknown
    httpStatus?: unknown
    statusCode?: unknown
    cause?: unknown
  }
  const causeRaw = e.cause as Record<string, unknown> | null | undefined
  let cause: ThrownShape['cause'] = null
  if (causeRaw && typeof causeRaw === 'object') {
    cause = {
      name: typeof causeRaw['name'] === 'string' ? (causeRaw['name'] as string) : null,
      message: typeof causeRaw['message'] === 'string' ? (causeRaw['message'] as string) : null,
      code: pickCode(causeRaw as { code?: unknown }),
      status: pickStatus(causeRaw as { status?: unknown; httpStatus?: unknown; statusCode?: unknown }),
    }
  }
  return {
    name: typeof e.name === 'string' ? e.name : 'UnknownError',
    message: typeof e.message === 'string' ? e.message : String(err),
    code: pickCode(e),
    status: pickStatus(e),
    cause,
    stringified: tryStringify(err),
  }
}

function tryStringify(err: unknown): string {
  try {
    if (err instanceof Error) {
      const out: Record<string, unknown> = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      }
      const errAsRecord = err as unknown as Record<string, unknown>
      for (const k of Object.getOwnPropertyNames(err)) {
        if (k === 'name' || k === 'message' || k === 'stack') continue
        out[k] = errAsRecord[k]
      }
      return JSON.stringify(out)
    }
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // ── Auth ─────────────────────────────────────────────────
  if (!env.CRON_SECRET) {
    return res({ error: 'CRON_SECRET not configured', code: 'CRON_SECRET_NOT_CONFIGURED' }, 500)
  }
  const auth = request.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return res({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  // ── Binding 檢查（preview 是 optional binding；missing → 500 INTERNAL）──
  const canaryBucket = env.AUDIT_ARCHIVE_BUCKET_PREVIEW
  if (!canaryBucket) {
    return res({ error: 'AUDIT_ARCHIVE_BUCKET_PREVIEW binding missing', code: 'BINDING_MISSING' }, 500)
  }

  // ── Body parse + validate ───────────────────────────────
  let body: CanaryRequestBody
  try {
    body = (await request.json()) as CanaryRequestBody
  } catch {
    return res({ error: 'invalid JSON body', code: 'BAD_REQUEST' }, 400)
  }
  if (!body || typeof body !== 'object') {
    return res({ error: 'body must be an object', code: 'BAD_REQUEST' }, 400)
  }

  const op = typeof body.op === 'string' ? body.op : ''
  const prefix = typeof body.prefix === 'string' ? body.prefix : ''
  const key = typeof body.key === 'string' ? body.key : ''
  const putBody = typeof body.body === 'string' ? body.body : ''

  if (!SUPPORTED_OPS_SET.has(op)) {
    return res({ error: 'unknown op', code: 'BAD_OP', supported: [...SUPPORTED_OPS] }, 400)
  }
  if (!prefix.startsWith(PREFIX_GUARD)) {
    return res({ error: `prefix must start with "${PREFIX_GUARD}"`, code: 'BAD_PREFIX' }, 400)
  }
  if (!key.startsWith(prefix)) {
    return res({ error: 'key must start with prefix', code: 'BAD_KEY' }, 400)
  }

  // ── Run op ──────────────────────────────────────────────
  const startedAt = Date.now()
  const opTyped = op as CanaryOp
  try {
    let success_meta: unknown = null
    if (opTyped === 'setup_control' || opTyped === 'put_overwrite' || opTyped === 'put_new') {
      const r = await canaryBucket.put(key, putBody)
      success_meta = r
        ? { etag: r.etag ?? null, httpEtag: r.httpEtag ?? null, size: r.size ?? null, version: r.version ?? null }
        : null
    } else if (opTyped === 'delete') {
      await canaryBucket.delete(key)
      success_meta = { deleted: true }
    } else {
      const h = await canaryBucket.head(key)
      success_meta = h ? { etag: h.etag ?? null, size: h.size ?? null } : null
    }
    return res({
      op: opTyped,
      prefix,
      key,
      bucket: 'chiyigo-audit-archive-preview',
      outcome: 'success',
      success_meta,
      thrown: null,
      timing_ms: Date.now() - startedAt,
    }, 200)
  } catch (err) {
    return res({
      op: opTyped,
      prefix,
      key,
      bucket: 'chiyigo-audit-archive-preview',
      outcome: 'thrown',
      success_meta: null,
      thrown: captureThrown(err),
      timing_ms: Date.now() - startedAt,
    }, 200)
  }
}
