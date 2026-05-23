#!/usr/bin/env node
/**
 * spike-r2-lock.mjs
 *
 * F-3 Phase 2 PR 0.2c-pre-1b — R2 retention lock enforcement spike via S3 API
 * + limited token（audit-archive-writer，Object Read & Write）。
 *
 * 目的：把「猜 R2 lock error shape」變成「實測 fixture」。1a isR2LockError 保守
 * 偵測器（HTTP 409/412 AND message/code/name 含 lock|retention|immutable|
 * objectlocked|object locked）需要真實 shape 驗證；本 spike 用 preview bucket
 * + 1-day retention lock + limited token 走 S3 sigv4 試 PUT-overwrite / DELETE
 * 看 R2 真實回什麼。0.2a wrangler r2 smoke 過 lock 不 enforce（owner bypass），
 * 用 limited token + S3 API 才測得到 prod cron 會撞到的 contract（即便 prod
 * cron 走 worker binding 是 owner-level，limited token 仍給「外部消費者」契約）。
 *
 * 5 guard rails（user 拍板）：
 *   1. env var 只設當前 shell session — 不寫 .env / 不 commit
 *   2. 腳本只允許 throwaway prefix：spike/r2-lock/YYYYMMDD-HHMMSS-*
 *   3. 輸出 JSON 不得 echo secret/access key／R2 endpoint host（只記 response data）
 *   4. 腳本 hard fail：bucket 不是 preview / prefix 不符 pattern 即拒跑
 *   5. commit 腳本，不 commit output 裡任何 credential-like value
 *
 * Codex r1 pre-spike review 修法：
 *   - P1：control body 去掉 timestamp 改 deterministic；setup/test 用同一個
 *         buildControlBody(prefix) helper，put_same_key_same_body 真同 body；
 *         輸出 body_sha256 給 reviewer 對齊驗證
 *   - P2：signedRequest 不輸出 full URL（含 R2 account host）；改 url_path 只
 *         path component；endpoint host 加入 sanitize secrets 做 defense in depth
 *
 * Codex r2 pre-spike review 修法：
 *   - P2'：setup gate `next_step.wrangler_lock` 在 baseline PUT 2xx 才輸出；
 *          否則 `ready_for_lock: false` + 診斷欄位，防 PUT 失敗時 user 仍 lock
 *          空 prefix → Phase C 假測（"same body" probe 沒 pre-lock object 可比）
 *   - P3'：ruleName 用完整 prefix segment（含 random suffix YYYYMMDD-HHMMSS-XXXXXX），
 *          快速 rerun 也保證 unique；不再只取 timestamp 截斷
 *
 * 用法（兩階段）：
 *   # Phase A — pre-lock baseline + 算 prefix（read-only on existing data）
 *   $env:AUDIT_ARCHIVE_S3_ACCESS_KEY_ID="<from 1Password>"
 *   $env:AUDIT_ARCHIVE_S3_SECRET_ACCESS_KEY="<from 1Password>"
 *   $env:AUDIT_ARCHIVE_S3_ENDPOINT="<from 1Password>"  # e.g. https://<account>.r2.cloudflarestorage.com
 *   node scripts/spike-r2-lock.mjs --phase=setup > /tmp/spike-setup.json
 *
 *   # 從 setup 輸出取 prefix + 跑 wrangler lock add（腳本會 echo 確切指令）
 *   # 等 ~10s 讓 lock propagate
 *
 *   # Phase B — post-lock attempts
 *   node scripts/spike-r2-lock.mjs --phase=test --prefix="<setup 輸出的 prefix>" > /tmp/spike-test.json
 *
 *   # 把兩 JSON 貼回對話，我會 commit 成 docs/fixtures/r2-lock-spike-<date>.json
 *
 * Spike 輸出後續：
 *   - tighten isR2LockError per guard rails（status + marker 雙條件；nested field
 *     可擴；保守原則不變）
 *   - 若仍不 enforce → freeze not_enforced fixture/notes，write-once 保留
 *     defense-in-depth，isR2LockError 不刪（user 補充 rail）
 *   - 加 docs/AUDIT_ARCHIVE_LOCK_BEHAVIOR.md runbook
 */

import crypto from 'node:crypto'

// ── Hard guards ─────────────────────────────────────────────────────────────
const REQUIRED_BUCKET  = 'chiyigo-audit-archive-preview'
const PREFIX_PATTERN   = /^spike\/r2-lock\/\d{8}-\d{6}-[a-z0-9]{6}\/$/
const RETENTION_DAYS   = 1

function hardFail(msg) {
  process.stderr.write(`HARD FAIL: ${msg}\n`)
  process.exit(1)
}

// ── Args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    if (m) out[m[1]] = m[2]
    else if (/^--/.test(a)) out[a.slice(2)] = true
  }
  return out
}

function readEnv() {
  const env = process.env
  const required = [
    'AUDIT_ARCHIVE_S3_ACCESS_KEY_ID',
    'AUDIT_ARCHIVE_S3_SECRET_ACCESS_KEY',
    'AUDIT_ARCHIVE_S3_ENDPOINT',
  ]
  for (const k of required) {
    if (!env[k]) hardFail(`env ${k} required (session-only; do not commit / .env)`)
  }
  // Endpoint hygiene: strip trailing slash
  const endpoint = env.AUDIT_ARCHIVE_S3_ENDPOINT.replace(/\/$/, '')
  if (!/^https:\/\//.test(endpoint)) hardFail(`endpoint must be https:// — got '${endpoint.slice(0, 40)}...'`)
  return {
    ACCESS_KEY: env.AUDIT_ARCHIVE_S3_ACCESS_KEY_ID,
    SECRET_KEY: env.AUDIT_ARCHIVE_S3_SECRET_ACCESS_KEY,
    ENDPOINT:   endpoint,
  }
}

// ── SigV4 helpers (AWS-style) ───────────────────────────────────────────────
function sha256Hex(b) {
  return crypto.createHash('sha256').update(b).digest('hex')
}
function hmacBytes(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

/**
 * S3-compatible sigv4 signer for R2.
 * region=auto, service=s3, path-style URLs (R2 default for S3 endpoint).
 *
 * R2 S3 endpoint URL format:
 *   https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
 *
 * 回傳含 status / headers / body 的純資料物件（不含 Authorization / request
 * sigv4 headers — guard rail #3：避免 echo 給 access key/secret 留紙條）。
 */
async function signedRequest({ method, endpoint, bucket, key, body, contentType, accessKey, secretKey }) {
  const region  = 'auto'
  const service = 's3'
  const url     = new URL(`${endpoint}/${bucket}/${encodeURI(key).replace(/%2F/g, '/')}`)
  const now     = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const bodyBuf = body === undefined || body === null ? Buffer.alloc(0)
                : Buffer.isBuffer(body) ? body
                : Buffer.from(body)
  const payloadHash = sha256Hex(bodyBuf)

  // Canonical request 用的 headers — 只含必要欄位（host / x-amz-date / x-amz-content-sha256）
  const sigHeaders = {
    host:                       url.host,
    'x-amz-date':               amzDate,
    'x-amz-content-sha256':     payloadHash,
  }
  if (contentType) sigHeaders['content-type'] = contentType

  const sortedKeys = Object.keys(sigHeaders).sort()
  const canonicalHeaders = sortedKeys.map(k => `${k}:${String(sigHeaders[k]).trim()}\n`).join('')
  const signedHeaders = sortedKeys.join(';')

  const canonicalRequest = [
    method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate    = hmacBytes('AWS4' + secretKey, dateStamp)
  const kRegion  = hmacBytes(kDate, region)
  const kService = hmacBytes(kRegion, service)
  const kSigning = hmacBytes(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const fetchHeaders = { ...sigHeaders, Authorization: authHeader }

  let resp, errorShape = null
  try {
    resp = await fetch(url.toString(), {
      method,
      headers: fetchHeaders,
      body: (method === 'GET' || method === 'DELETE' || method === 'HEAD') ? undefined : bodyBuf,
    })
  } catch (e) {
    errorShape = { fetch_error: { name: e?.name ?? null, message: String(e?.message ?? e) } }
  }

  // Codex r1 P2 fix：不輸出 full URL（含 R2 account host）；改 url_path 只 path
  // component。bucket / key 已是獨立欄位，host 由 sanitize 兜底（仍會 redact 任何
  // 漏網的 endpoint host 出現）。
  const urlPath = url.pathname

  if (errorShape) {
    return { method, bucket, key, url_path: urlPath, request_body_len: bodyBuf.length, ...errorShape }
  }
  const respHeaders = {}
  for (const [k, v] of resp.headers.entries()) respHeaders[k] = v
  const respBody = await resp.text()
  return {
    method,
    bucket,
    key,
    url_path: urlPath,
    request_body_len: bodyBuf.length,
    response: {
      status:  resp.status,
      headers: respHeaders,
      body:    respBody,
    },
  }
}

// ── Output sanitization ─────────────────────────────────────────────────────
/**
 * Walk a plain object/array recursively, redact any string value that contains
 * the access key or secret as substring. Belt-and-suspenders — we already avoid
 * including credentials in any response data, but R2 echoing a credential-like
 * value via x-amz-request-id is unlikely yet possible; redact defensively.
 */
function sanitize(obj, secrets) {
  if (obj == null || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      let s = obj
      for (const sec of secrets) if (sec && s.includes(sec)) s = s.split(sec).join('[REDACTED]')
      return s
    }
    return obj
  }
  if (Array.isArray(obj)) return obj.map(x => sanitize(x, secrets))
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k] = sanitize(v, secrets)
  return out
}

// ── Prefix generator ────────────────────────────────────────────────────────
function genPrefix() {
  const t = new Date().toISOString()
  const yyyymmdd = t.slice(0, 10).replace(/-/g, '')
  const hhmmss   = t.slice(11, 19).replace(/:/g, '')
  const rand     = crypto.randomBytes(3).toString('hex')   // 6 hex chars
  return `spike/r2-lock/${yyyymmdd}-${hhmmss}-${rand}/`
}

// ── Deterministic body builders（Codex r1 P1 fix）─────────────────────────
// setup 與 test 共用同一 helper，put_same_key_same_body 才真同 body bytes
// （之前 setup 含 timestamp、test 用 'PLACEHOLDER' 字面值 → 不同 body，誤把
// 「different body overwrite」標成「same body overwrite」）。
function buildControlBody(prefix) {
  return `phase=setup\nprefix=${prefix}\nbody=v1\n`
}
function buildDiffBody(prefix) {
  return `phase=test-overwrite-different\nprefix=${prefix}\nbody=v2\n`
}

// ── Phases ──────────────────────────────────────────────────────────────────
async function phaseSetup(env) {
  const prefix = genPrefix()
  if (!PREFIX_PATTERN.test(prefix)) hardFail(`generated prefix '${prefix}' does not match pattern (internal bug)`)

  const controlKey = `${prefix}control.txt`
  const controlBody = buildControlBody(prefix)
  const controlBodySha256 = sha256Hex(controlBody)

  const put = await signedRequest({
    method: 'PUT', endpoint: env.ENDPOINT, bucket: REQUIRED_BUCKET,
    key: controlKey, body: controlBody, contentType: 'text/plain',
    accessKey: env.ACCESS_KEY, secretKey: env.SECRET_KEY,
  })

  // Codex r2 P3' fix：ruleName 取完整 prefix segment（含 6-hex random suffix），
  // 快速 rerun 不會 collide（之前只取 YYYYMMDDHHMMSS 截斷會撞）
  const prefixSeg = prefix.slice('spike/r2-lock/'.length).replace(/\/$/, '')   // YYYYMMDD-HHMMSS-XXXXXX
  const ruleName = `spike-r2-lock-${prefixSeg}`
  // Wrangler lock add for next-step (user runs manually; script does NOT touch lock)
  const wranglerLockCmd =
    `npx wrangler r2 bucket lock add ${REQUIRED_BUCKET} ${ruleName} "${prefix}" --retention-days ${RETENTION_DAYS} -y`
  // Optional lifecycle cleanup post lock expiry (manual; recommended for preview hygiene)
  const wranglerLifecycleCmd =
    `npx wrangler r2 bucket lifecycle add ${REQUIRED_BUCKET} ${ruleName}-cleanup "${prefix}" --expire-days ${RETENTION_DAYS + 1} -y`

  // Codex r2 P2' fix：gate next_step 在 baseline PUT 2xx；否則不出 wrangler 指令、
  //   防 user 仍 lock 空 prefix 後 Phase C 假測（同 key same body probe 沒 pre-lock
  //   object 可比、整個 fixture 失去意義）
  const putStatus = put?.response?.status
  const okPut = typeof putStatus === 'number' && putStatus >= 200 && putStatus < 300
  const nextStep = okPut ? {
    description:
      'Run the wrangler lock command, wait ~10s for propagation, then run phase=test ' +
      'with the same --prefix. Optional: also run the lifecycle command for post-expiry cleanup.',
    wrangler_lock:      wranglerLockCmd,
    wrangler_lifecycle: wranglerLifecycleCmd,
  } : {
    description:
      'BASELINE PUT FAILED — DO NOT proceed to wrangler lock add. The wrangler_* fields ' +
      'are intentionally omitted to prevent locking an empty prefix (which would make ' +
      'Phase C "same body" probe meaningless). Inspect control_put.response.status / body / ' +
      'control_put.fetch_error to diagnose: env vars (S3 keys / endpoint), SigV4 (clock skew, ' +
      'header order), or limited-token permissions. Once fixed, re-run --phase=setup; a fresh ' +
      'prefix will be generated.',
    blocked_because: {
      response_status: putStatus ?? null,
      fetch_error:     put?.fetch_error ?? null,
    },
  }

  return {
    phase: 'setup',
    bucket: REQUIRED_BUCKET,
    prefix,
    setup_at: new Date().toISOString(),   // human-only timestamp（不在 body 內，保 body deterministic）
    control_put: put,
    // Codex r1 P1：sha256 of deterministic control body — test phase 必算出同 value，
    // reviewer 對齊 setup.control_body_sha256 === test.same_body_sha256 才證 put_same_key_same_body
    // 真的 same body（之前 setup body 含 timestamp / test 用 PLACEHOLDER 字面值，sha 不會等）
    control_body_sha256: controlBodySha256,
    ready_for_lock: okPut,
    next_step: nextStep,
  }
}

async function phaseTest(env, prefix) {
  if (!PREFIX_PATTERN.test(prefix)) hardFail(`--prefix must match ${PREFIX_PATTERN.source}, got '${prefix}'`)

  const controlKey = `${prefix}control.txt`
  const newKey     = `${prefix}newkey-${crypto.randomBytes(3).toString('hex')}.txt`
  // Codex r1 P1：用同一個 buildControlBody helper 確保 byte-identical
  const sameBody   = buildControlBody(prefix)
  const diffBody   = buildDiffBody(prefix)
  const sameBodySha256 = sha256Hex(sameBody)
  const diffBodySha256 = sha256Hex(diffBody)

  // 1) PUT same key, same body — does R2 allow idempotent overwrite under lock?
  const putSameSame = await signedRequest({
    method: 'PUT', endpoint: env.ENDPOINT, bucket: REQUIRED_BUCKET,
    key: controlKey, body: sameBody, contentType: 'text/plain',
    accessKey: env.ACCESS_KEY, secretKey: env.SECRET_KEY,
  })

  // 2) PUT same key, different body — does R2 allow content-changing overwrite?
  const putSameDiff = await signedRequest({
    method: 'PUT', endpoint: env.ENDPOINT, bucket: REQUIRED_BUCKET,
    key: controlKey, body: diffBody, contentType: 'text/plain',
    accessKey: env.ACCESS_KEY, secretKey: env.SECRET_KEY,
  })

  // 3) PUT different key in same locked prefix — should succeed (write-once new key)
  const putNewKey = await signedRequest({
    method: 'PUT', endpoint: env.ENDPOINT, bucket: REQUIRED_BUCKET,
    key: newKey, body: diffBody, contentType: 'text/plain',
    accessKey: env.ACCESS_KEY, secretKey: env.SECRET_KEY,
  })

  // 4) DELETE same key — should be blocked by retention lock
  const del = await signedRequest({
    method: 'DELETE', endpoint: env.ENDPOINT, bucket: REQUIRED_BUCKET,
    key: controlKey,
    accessKey: env.ACCESS_KEY, secretKey: env.SECRET_KEY,
  })

  return {
    phase: 'test',
    bucket: REQUIRED_BUCKET,
    prefix,
    captured_at: new Date().toISOString(),
    // Codex r1 P1：對齊用 — same_body_sha256 必等於 setup.control_body_sha256，
    //   否則 put_same_key_same_body 名不符實
    same_body_sha256: sameBodySha256,
    diff_body_sha256: diffBodySha256,
    operations: {
      put_same_key_same_body: putSameSame,
      put_same_key_diff_body: putSameDiff,
      put_new_key_locked_prefix: putNewKey,
      delete_same_key:           del,
    },
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const env  = readEnv()

  // Codex r1 P2：endpoint host 加入 sanitize defense（已 drop url 但兜底 — R2
  // 偶有可能在 error body / headers 回 endpoint-shaped URL）；host-only 不含 scheme
  let endpointHost = ''
  try { endpointHost = new URL(env.ENDPOINT).host } catch { /* env validation 已 hard fail */ }
  const secrets = [env.ACCESS_KEY, env.SECRET_KEY, endpointHost].filter(Boolean)

  let result
  if (args.phase === 'setup') {
    result = await phaseSetup(env)
  } else if (args.phase === 'test') {
    if (!args.prefix) hardFail(`--prefix required for phase=test (use setup output's prefix)`)
    result = await phaseTest(env, args.prefix)
  } else {
    process.stderr.write(
      `Usage:\n` +
      `  node scripts/spike-r2-lock.mjs --phase=setup\n` +
      `  node scripts/spike-r2-lock.mjs --phase=test --prefix="spike/r2-lock/YYYYMMDD-HHMMSS-XXXXXX/"\n`
    )
    process.exit(1)
  }

  process.stdout.write(JSON.stringify(sanitize(result, secrets), null, 2) + '\n')
}

main().catch(e => {
  process.stderr.write(`SPIKE FAILED: ${e?.stack ?? e}\n`)
  process.exit(1)
})
