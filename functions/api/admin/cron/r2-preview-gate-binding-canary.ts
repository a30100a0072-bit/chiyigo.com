/**
 * POST /api/admin/cron/r2-preview-gate-binding-canary
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 0.2c-pre-3（2026-05-25，TEMPORARY）— Worker R2 binding canary on
 * the **prod** bucket (`AUDIT_ARCHIVE_BUCKET`).
 *
 * 為什麼存在（codex 推翻原 wrangler-based Layer 1 後升 mandatory replacement）：
 *   PR 0.2c-pre-1b.1 binding canary 驗的是 PREVIEW bucket。prod cron 真正走的是
 *   prod binding；preview/prod 跨 bucket 平台行為若不一致，preview fixture 不能
 *   外推 prod lock semantics。本 endpoint 對 prod bucket 跑 6 個 op 捕捉真實
 *   binding throw shape + classifier 三路命中 paths，是 prod retention lock 上線
 *   前最後一道強制 gate（docs/reviews/preview-gate-binding-canary-pr-plan-2026-05-25.md）。
 *
 *   6 ops 順序固定（fixture 比對穩定）：
 *     1. setup_control:  prefix 內 control key PUT bootstrap object（HARD PASS 條件）
 *     2. put_overwrite:  同 key 再 PUT（lock 應擋 → thrown；driver test）
 *     3. put_new:        prefix 內**新** key PUT（lock 不擋 → success；write-once
 *                        design 對 prod bucket 必須成立，否則 archive 上線後新 chunk
 *                        / manifest 寫不進）
 *     4. delete:         control key DELETE（lock 應擋 → thrown；driver test）
 *     5. head:           control key HEAD（驗證物件仍在）
 *     6. get_control:    control key GET → return `{ body_sha256, size }`（NEVER
 *                        raw body — fixture 比對 hash；overwrite/delete 未造成
 *                        state 破壞的最終證明）
 *
 *   PASS / 5 FAIL 分類見 plan §7：FAIL_CRITICAL（op 2/4 沒 throw）/
 *   FAIL_CLASSIFIER_MISS（throw 但 classifier 漏判）/ FAIL_WRITE_BLOCKED（op 1/3
 *   thrown，違反 Cloudflare bucket lock 設計）/ FAIL_STATE_BREACH（op 6 sha 不對
 *   齊）/ FAIL_UNEXPECTED（4xx/5xx）。
 *
 * 何時移除：commit 2 of PR 0.2c-pre-3。本檔 + tests 同 PR 一起 delete，避免 prod
 *   殘留 surface。`classifyR2LockError` helper 保留並升 **diagnostic classifier**
 *   命名（plan §9 codex r1 answer 4），給未來 R2 throw shape 改變時 forensic 比對。
 *
 * 安全護欄：
 *   - Auth: Bearer CRON_SECRET（同 audit-archive cron endpoint pattern）
 *   - prefix 必符 PREFIX_REGEX `^sacrificial\/preview-gate-binding\/\d{8}-\d{6}-[0-9a-f]{6}\/$`
 *     → 400 BAD_PREFIX（plan §4 升 r2，codex finding 4 — startsWith 太寬）
 *   - key 必須以 prefix 開頭 → 400 BAD_KEY
 *   - op 限定 6 個 → 400 BAD_OP
 *   - put-class（setup_control / put_overwrite / put_new）：body 必填非空 string
 *     → 否則 400 PUT_BODY_REQUIRED
 *   - 非 put-class（delete / head / get_control）：body 必須 absent / null / `''`
 *     → 否則 400 NON_PUT_REJECT_BODY
 *   - body 出現 `bucket` 欄位 → 400 BUCKET_FIELD_FORBIDDEN（用 `Object.hasOwn`
 *     判斷 property presence，**不管值**；plan §4 升 r3，codex r2 finding 4 fail-closed
 *     防 `bucket: null` 之類繞過；binding 由 server 硬寫 `env.AUDIT_ARCHIVE_BUCKET`）
 *   - 只 touch env.AUDIT_ARCHIVE_BUCKET；不 import 其他 binding
 *
 * 回應：HTTP 200（無論 op 成功或 throw，都 200 回真實 shape + classifier verdict +
 *   paths，便於 curl + fixture capture）；auth / binding / validation fail 才用
 *   4xx/5xx。
 *
 * Lint 互動：r2-preview-gate-binding-canary.ts 檔名不符
 *   scripts/_archive-lint-patterns.js FILE_PATTERN（`/^audit-(aggregate-)?archive.*\.(js|ts)$/`）
 *   → 自動豁免 archive no-delete / no-bare-put discipline。canary 的 .delete / .put
 *   是測試本身（lock 應擋）；不在 audit-archive worker codepath。
 */

import { res } from '../../../utils/auth'
import { classifyR2LockError } from '../../../utils/audit-archive'

// 嚴格 prefix regex（升 r2，codex finding 4 — startsWith 太寬）
// 格式：sacrificial/preview-gate-binding/<yyyymmdd>-<hhmmss>-<6hex>/
const PREFIX_REGEX = /^sacrificial\/preview-gate-binding\/\d{8}-\d{6}-[0-9a-f]{6}\/$/

const SUPPORTED_OPS = ['setup_control', 'put_overwrite', 'put_new', 'delete', 'head', 'get_control'] as const
type CanaryOp = typeof SUPPORTED_OPS[number]
const SUPPORTED_OPS_SET: ReadonlySet<string> = new Set<string>(SUPPORTED_OPS)
const PUT_CLASS_OPS: ReadonlySet<string> = new Set<string>(['setup_control', 'put_overwrite', 'put_new'])

const BUCKET_NAME = 'chiyigo-audit-archive'

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

// SHA-256 hex of a Uint8Array / ArrayBuffer — 給 get_control 算 body hash。
// 與 functions/utils/audit-archive#sha256Hex 邏輯一致；inline 避免額外 import
// surface 把 archive worker 重 helper 拉進這個 canary endpoint。
async function sha256HexBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const arr = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0')
  return hex
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

  // ── Binding 檢查（prod binding 應永遠存在；缺即 500 INTERNAL）──
  const bucket = env.AUDIT_ARCHIVE_BUCKET
  if (!bucket) {
    return res({ error: 'AUDIT_ARCHIVE_BUCKET binding missing', code: 'BINDING_MISSING' }, 500)
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

  // bucket field fail-closed — reject property presence 不管值（plan §4 升 r3）
  if (Object.hasOwn(body as object, 'bucket')) {
    return res({
      error: 'bucket field forbidden; binding source of truth is env.AUDIT_ARCHIVE_BUCKET',
      code: 'BUCKET_FIELD_FORBIDDEN',
    }, 400)
  }

  const op = typeof body.op === 'string' ? body.op : ''
  const prefix = typeof body.prefix === 'string' ? body.prefix : ''
  const key = typeof body.key === 'string' ? body.key : ''

  if (!SUPPORTED_OPS_SET.has(op)) {
    return res({ error: 'unknown op', code: 'BAD_OP', supported: [...SUPPORTED_OPS] }, 400)
  }
  if (!PREFIX_REGEX.test(prefix)) {
    return res({
      error: 'prefix must match /^sacrificial\\/preview-gate-binding\\/\\d{8}-\\d{6}-[0-9a-f]{6}\\/$/',
      code: 'BAD_PREFIX',
    }, 400)
  }
  if (!key.startsWith(prefix)) {
    return res({ error: 'key must start with prefix', code: 'BAD_KEY' }, 400)
  }

  // op-specific body validation（plan §4 升 r2，codex finding 4b）
  const opTyped = op as CanaryOp
  const isPutClass = PUT_CLASS_OPS.has(opTyped)
  if (isPutClass) {
    if (typeof body.body !== 'string' || body.body === '') {
      return res({
        error: `op '${opTyped}' requires non-empty body string`,
        code: 'PUT_BODY_REQUIRED',
      }, 400)
    }
  } else {
    // 非 put-class：body 必須 absent / null / ''
    const rawBody = body.body
    const bodyAbsentish = rawBody === undefined || rawBody === null || rawBody === ''
    if (!bodyAbsentish) {
      return res({
        error: `op '${opTyped}' must not include body (got ${typeof rawBody})`,
        code: 'NON_PUT_REJECT_BODY',
      }, 400)
    }
  }

  const putBody = typeof body.body === 'string' ? body.body : ''

  // ── Run op ──────────────────────────────────────────────
  const startedAt = Date.now()
  try {
    let success_meta: unknown = null
    if (opTyped === 'setup_control' || opTyped === 'put_overwrite' || opTyped === 'put_new') {
      const r = await bucket.put(key, putBody)
      success_meta = r
        ? { etag: r.etag ?? null, httpEtag: r.httpEtag ?? null, size: r.size ?? null, version: r.version ?? null }
        : null
    } else if (opTyped === 'delete') {
      await bucket.delete(key)
      success_meta = { deleted: true }
    } else if (opTyped === 'head') {
      const h = await bucket.head(key)
      success_meta = h ? { etag: h.etag ?? null, size: h.size ?? null } : null
    } else {
      // get_control: 讀 body → sha256 hex + size；**絕不**回 raw bytes（plan §4
      //   設計考量：fixture 落地的位元組成為 leak surface / git 體積 bloat；
      //   hash 比對 setup_control 階段預先計算的 expected sha256 就足夠驗 state
      //   integrity）
      const obj = await bucket.get(key)
      if (!obj) {
        success_meta = null
      } else {
        const buf = await obj.arrayBuffer()
        const body_sha256 = await sha256HexBytes(buf)
        success_meta = { body_sha256, size: typeof obj.size === 'number' ? obj.size : buf.byteLength }
      }
    }
    return res({
      op: opTyped,
      prefix,
      key,
      bucket: BUCKET_NAME,
      outcome: 'success',
      success_meta,
      thrown: null,
      classifier_verdict: null,
      classifier_paths_hit: null,
      timing_ms: Date.now() - startedAt,
    }, 200)
  } catch (err) {
    // classifier 同時跑 — verdict (boolean) 給 PASS gate 判斷；paths_hit (string[])
    // 給 forensic 比對 S3 / preview bucket / prod bucket 三路命中差異
    const classification = classifyR2LockError(err)
    return res({
      op: opTyped,
      prefix,
      key,
      bucket: BUCKET_NAME,
      outcome: 'thrown',
      success_meta: null,
      thrown: captureThrown(err),
      classifier_verdict: classification.matched,
      classifier_paths_hit: classification.paths,
      timing_ms: Date.now() - startedAt,
    }, 200)
  }
}
