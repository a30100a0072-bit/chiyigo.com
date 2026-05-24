/**
 * F-3 Phase 2 PR 2.0 — audit-archive helpers unit test
 *
 * 驗：
 *  - rowsToJsonl 欄位順序 deterministic（sha 必須 reproducible）
 *  - sha256Hex 對齊已知向量（"" / "a"）
 *  - buildChunkKeys 格式對齊 design doc §「Key 命名」+ dry-run prefix 切換
 *  - computeCursorAndBlocker 對 contiguous terminal prefix / non-terminal blocker 都對
 *  - rowMatchesColdClass 對 classifyForCold 一致
 *  - buildManifest 必要欄位齊全 + dry_run flag 反映輸入
 */

import { describe, it, expect } from 'vitest'
import {
  rowsToJsonl,
  sha256Hex,
  gzipCompress,
  gzipDecompress,
  archiveExtension,
  buildChunkKeys,
  computeCursorAndBlocker,
  rowMatchesColdClass,
  buildManifest,
  isChunkTerminal,
  NON_TERMINAL_STATES,
  archivePrefixes,
  deriveKeysFromChunk,
  deriveDataKey,
  deriveManifestKey,
  appendStateHistory,
  aggregateSeverities,
  putWithRetry,
  isR2LockError,
  KEY_SCHEME_LEGACY,
  KEY_SCHEME_WRITE_ONCE,
  MANIFEST_STATE_FILES,
  DEFAULT_PUT_RETRY_BACKOFF_MS,
  SUPPORTED_COLD_CLASSES,
  hotRetentionDaysFor,
  purgeChunk,
} from '../functions/utils/audit-archive'

describe('rowsToJsonl', () => {
  it('輸出固定欄位順序 + trailing newline', () => {
    const out = rowsToJsonl([
      { id: 1, event_type: 'x', severity: 'info', user_id: null,
        client_id: null, ip_hash: null, event_data: null,
        cold_class: 'telemetry', created_at: '2026-05-01T00:00:00Z' },
    ])
    expect(out).toBe(
      '{"id":1,"event_type":"x","severity":"info","user_id":null,' +
      '"client_id":null,"ip_hash":null,"event_data":null,' +
      '"cold_class":"telemetry","created_at":"2026-05-01T00:00:00Z"}\n'
    )
  })

  it('多 row 各自一行', () => {
    const out = rowsToJsonl([
      { id: 1, event_type: 'a', severity: 'info', cold_class: 'telemetry', created_at: 't1' },
      { id: 2, event_type: 'b', severity: 'warn', cold_class: 'telemetry', created_at: 't2' },
    ])
    expect(out.split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('同資料兩次 serialize sha256 一致（idempotent key 前提）', async () => {
    const rows = [
      { id: 7, event_type: 'auth.login.rate_limited', severity: 'info',
        user_id: 1, client_id: null, ip_hash: 'h', event_data: '{}',
        cold_class: 'telemetry', created_at: '2026-05-01T00:00:00Z' },
    ]
    const a = await sha256Hex(rowsToJsonl(rows))
    const b = await sha256Hex(rowsToJsonl(rows))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('sha256Hex 已知向量', () => {
  it('empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })
  it('"a"', async () => {
    expect(await sha256Hex('a')).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
    )
  })
})

describe('buildChunkKeys', () => {
  const base = {
    env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
    minId: 100, maxId: 200, sha256: 'deadbeef',
    archiveDate: '2026-05-11',
  }

  it('PR 2.1b：預設 compression=gzip → 副檔名 .jsonl.gz', () => {
    const k = buildChunkKeys({ ...base, dryRun: false })
    expect(k.dataKey).toBe('audit-log/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.jsonl.gz')
    expect(k.manifestKey).toBe('manifest/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.json')
  })

  it('compression=none（PR 2.0 向下相容）→ 副檔名 .jsonl', () => {
    const k = buildChunkKeys({ ...base, dryRun: false, compression: 'none' })
    expect(k.dataKey).toBe('audit-log/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.jsonl')
  })

  it('dry-run 模式 → audit-log-dryrun/ + manifest-dryrun/（gzip 副檔名）', () => {
    const k = buildChunkKeys({ ...base, dryRun: true })
    expect(k.dataKey).toBe('audit-log-dryrun/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.jsonl.gz')
    expect(k.manifestKey).toBe('manifest-dryrun/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.json')
  })

  it('archivePrefixes 兩模式 prefix 不相同', () => {
    const live = archivePrefixes(false)
    const dry  = archivePrefixes(true)
    expect(live.data).not.toBe(dry.data)
    expect(live.manifest).not.toBe(dry.manifest)
  })
})

describe('archiveExtension (PR 2.1b)', () => {
  it('gzip → .jsonl.gz', () => {
    expect(archiveExtension('gzip')).toBe('.jsonl.gz')
  })
  it('none → .jsonl', () => {
    expect(archiveExtension('none')).toBe('.jsonl')
  })
  it('unknown / undefined → .jsonl（保守 fallback）', () => {
    expect(archiveExtension(undefined)).toBe('.jsonl')
    expect(archiveExtension('zstd')).toBe('.jsonl')
  })
})

describe('gzipCompress / gzipDecompress (PR 2.1b)', () => {
  it('string round-trip 還原無損', async () => {
    const input = 'hello world\n{"id":1,"x":"中文"}'
    const gz = await gzipCompress(input)
    expect(gz).toBeInstanceOf(Uint8Array)
    expect(gz.length).toBeGreaterThan(0)
    const back = await gzipDecompress(gz)
    expect(new TextDecoder().decode(back)).toBe(input)
  })

  it('Uint8Array round-trip 還原無損', async () => {
    const input = new TextEncoder().encode('{"a":1}\n{"b":2}\n')
    const gz = await gzipCompress(input)
    const back = await gzipDecompress(gz)
    expect(back).toEqual(input)
  })

  it('壓縮後 sha256 與 jsonl sha256 不同（forensic 區分用）', async () => {
    const jsonl = '{"id":1}\n'
    const gz = await gzipCompress(jsonl)
    const shaJsonl = await sha256Hex(jsonl)
    const shaGz    = await sha256Hex(gz)
    expect(shaGz).not.toBe(shaJsonl)
    expect(shaJsonl).toMatch(/^[0-9a-f]{64}$/)
    expect(shaGz).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('computeCursorAndBlocker — stop-on-non-terminal', () => {
  it('全空 → cursor 0、無 blocker', () => {
    const r = computeCursorAndBlocker([], 'audit_log')
    expect(r).toEqual({ cursor: 0, blocker: null })
  })

  it('全部 purged → cursor = 最後一 chunk 的 max_id', () => {
    const r = computeCursorAndBlocker([
      { min_id: 1,   max_id: 100, state: 'purged' },
      { min_id: 101, max_id: 250, state: 'purged' },
    ], 'audit_log')
    expect(r.cursor).toBe(250)
    expect(r.blocker).toBeNull()
  })

  it('中間遇 planned 即停；cursor = 前一段 terminal max_id；blocker 指向 planned', () => {
    const r = computeCursorAndBlocker([
      { min_id: 1,   max_id: 100, state: 'purged'  },
      { min_id: 101, max_id: 250, state: 'planned' },     // ← blocker
      { min_id: 251, max_id: 400, state: 'purged'  },     // 不該被當 cursor
    ], 'audit_log')
    expect(r.cursor).toBe(100)
    expect(r.blocker?.state).toBe('planned')
    expect(r.blocker?.min_id).toBe(101)
  })

  it('第一個就 failed → cursor 0，blocker 指向它', () => {
    const r = computeCursorAndBlocker([
      { min_id: 1, max_id: 50, state: 'failed' },
    ], 'audit_log')
    expect(r.cursor).toBe(0)
    expect(r.blocker?.state).toBe('failed')
  })

  it('admin_audit_log terminal = cold_copied（不是 purged）', () => {
    const r = computeCursorAndBlocker([
      { min_id: 1, max_id: 100, state: 'cold_copied' },
      { min_id: 101, max_id: 200, state: 'verified' },    // blocker
    ], 'admin_audit_log')
    expect(r.cursor).toBe(100)
    expect(r.blocker?.state).toBe('verified')
  })

  it('audit_log 的 cold_copied 不算 terminal', () => {
    const r = computeCursorAndBlocker([
      { min_id: 1, max_id: 100, state: 'cold_copied' },
    ], 'audit_log')
    expect(r.cursor).toBe(0)
    expect(r.blocker?.state).toBe('cold_copied')
  })
})

describe('isChunkTerminal / NON_TERMINAL_STATES', () => {
  it('audit_log: purged terminal、其他 non-terminal', () => {
    expect(isChunkTerminal('audit_log', 'purged')).toBe(true)
    expect(isChunkTerminal('audit_log', 'verified')).toBe(false)
    expect(isChunkTerminal('audit_log', 'cold_copied')).toBe(false)
  })

  it('NON_TERMINAL_STATES 覆蓋 6 個會卡 cursor 的 state', () => {
    for (const s of ['planned','uploaded','verified','marked_archived','failed','blacklisted']) {
      expect(NON_TERMINAL_STATES.has(s)).toBe(true)
    }
    expect(NON_TERMINAL_STATES.has('purged')).toBe(false)
    expect(NON_TERMINAL_STATES.has('cold_copied')).toBe(false)
  })
})

describe('rowMatchesColdClass', () => {
  it('已分類為 telemetry 的 event 對 telemetry 為 true', () => {
    // auth.login.rate_limited 在 audit-policy registry 屬 TELEMETRY
    const row = { event_type: 'auth.login.rate_limited', severity: 'info' }
    expect(rowMatchesColdClass(row, 'telemetry')).toBe(true)
    expect(rowMatchesColdClass(row, 'immutable')).toBe(false)
  })

  it('未分類事件 fallback immutable，對 telemetry 為 false', () => {
    const row = { event_type: 'totally.unknown.event', severity: 'info' }
    expect(rowMatchesColdClass(row, 'immutable')).toBe(true)
    expect(rowMatchesColdClass(row, 'telemetry')).toBe(false)
  })
})

describe('deriveKeysFromChunk (PR 2.1a + 2.1c + 2.1b provenance)', () => {
  it('PR 2.0 既有 chunk：row.dry_run=1 + compression 缺/none → .jsonl + dryrun prefix', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 8, max_id: 922, chunk_sha256: 'abc',
      dry_run: 1,
      // 沒 compression 欄（migration 0041 backfill 前狀態）
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey).toBe('audit-log-dryrun/prod/audit_log/telemetry/2026/05/11/8-922-abc.jsonl')
    expect(k.manifestKey).toBe('manifest-dryrun/prod/audit_log/telemetry/2026/05/11/8-922-abc.json')
  })

  it('PR 2.1b 新 chunk：row.compression=gzip → .jsonl.gz', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 1, max_id: 100, chunk_sha256: 'feed',
      dry_run: 0, compression: 'gzip',
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey).toBe('audit-log/prod/audit_log/telemetry/2026/05/11/1-100-feed.jsonl.gz')
  })

  it('row.dry_run=0 + compression=none → live prefix + .jsonl', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 1, max_id: 2, chunk_sha256: 'dead',
      dry_run: 0, compression: 'none',
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey).toBe('audit-log/prod/audit_log/telemetry/2026/05/11/1-2-dead.jsonl')
    expect(k.manifestKey.startsWith('manifest/')).toBe(true)
  })

  it('row.dry_run=true（BOOL，相容性）→ dryrun prefix', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 1, max_id: 2, chunk_sha256: 'dead',
      dry_run: true, compression: 'gzip',
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey.startsWith('audit-log-dryrun/')).toBe(true)
    expect(k.dataKey.endsWith('.jsonl.gz')).toBe(true)
  })

  it('row.dry_run 缺欄（極端 fallback）→ live prefix', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 1, max_id: 2, chunk_sha256: 'dead',
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey.startsWith('audit-log/')).toBe(true)
    expect(k.dataKey.endsWith('.jsonl')).toBe(true) // compression 缺 → 'none' fallback
  })
})

describe('appendStateHistory (PR 2.1a)', () => {
  it('append 不就地改、回新物件', () => {
    const m = { state: 'planned', state_history: [{ state: 'planned', at: 't0' }], extra: 'k' }
    const next = appendStateHistory(m, 'uploaded', 't1')
    expect(next).not.toBe(m)
    expect(m.state_history).toHaveLength(1)
    expect(next.state).toBe('uploaded')
    expect(next.state_history).toHaveLength(2)
    expect(next.state_history[1]).toEqual({ state: 'uploaded', at: 't1' })
    expect(next.extra).toBe('k')
  })

  it('state_history 缺失也 ok（fallback 空陣列）', () => {
    const next = appendStateHistory({ state: 'planned' }, 'uploaded', 't1')
    expect(next.state_history).toEqual([{ state: 'uploaded', at: 't1' }])
  })
})

describe('buildManifest', () => {
  it('PR 2.1b 預設：compression=gzip + sha256_gz=null（不傳時）', () => {
    const m = buildManifest({
      env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
      coldClassVersion: 1, runId: 'run-x', state: 'planned',
      stateHistory: [{ state: 'planned', at: '2026-05-11T00:00:00Z' }],
      rowCount: 3, minId: 1, maxId: 5,
      minTs: '2026-05-01T00:00:00Z', maxTs: '2026-05-02T00:00:00Z',
      sha256Jsonl: 'abc', dryRun: true, dataKey: 'audit-log-dryrun/...',
      severities: undefined, compression: undefined, sha256Gz: undefined,
    })
    expect(m.schema_version).toBe('2.0')
    expect(m.cold_class).toBe('telemetry')
    expect(m.cold_class_version).toBe(1)
    expect(m.compression).toBe('gzip')
    expect(m.sha256_gz).toBeNull()
    expect(m.dry_run).toBe(true)
    expect(m.state).toBe('planned')
    expect(m.state_history).toHaveLength(1)
    expect(m.row_count).toBe(3)
  })

  it('PR 2.1b：caller 傳 compression + sha256Gz → 反映到 manifest', () => {
    const m = buildManifest({
      env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
      coldClassVersion: 1, runId: 'r', state: 'planned',
      stateHistory: [], rowCount: 5, minId: 1, maxId: 5,
      minTs: 't', maxTs: 't', sha256Jsonl: 'h',
      dryRun: false, dataKey: 'k',
      compression: 'gzip', sha256Gz: 'feedface',
      severities: undefined,
    })
    expect(m.compression).toBe('gzip')
    expect(m.sha256_gz).toBe('feedface')
    expect(m.sha256_jsonl).toBe('h')
  })

  it('PR 2.0 向下相容：caller 傳 compression=none → manifest 反映 none', () => {
    const m = buildManifest({
      env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
      coldClassVersion: 1, runId: 'r', state: 'planned',
      stateHistory: [], rowCount: 1, minId: 1, maxId: 1,
      minTs: 't', maxTs: 't', sha256Jsonl: 'h',
      dryRun: false, dataKey: 'k',
      compression: 'none',
      severities: undefined, sha256Gz: undefined,
    })
    expect(m.compression).toBe('none')
    expect(m.sha256_gz).toBeNull()
  })

  it('PR 2.1d F-2：severities 參數帶入 → manifest 反映；不帶 → 空物件', () => {
    const m1 = buildManifest({
      env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
      coldClassVersion: 1, runId: 'r', state: 'planned',
      stateHistory: [], rowCount: 5, minId: 1, maxId: 5,
      minTs: 't', maxTs: 't', sha256Jsonl: 'h',
      dryRun: false, dataKey: 'k', severities: { info: 4, warn: 1 },
      compression: undefined, sha256Gz: undefined,
    })
    expect(m1.severities).toEqual({ info: 4, warn: 1 })

    const m2 = buildManifest({
      env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
      coldClassVersion: 1, runId: 'r', state: 'planned',
      stateHistory: [], rowCount: 0, minId: 0, maxId: 0,
      minTs: 't', maxTs: 't', sha256Jsonl: 'h',
      dryRun: false, dataKey: 'k',
      severities: undefined, compression: undefined, sha256Gz: undefined,
    })
    expect(m2.severities).toEqual({})
  })
})

describe('aggregateSeverities (PR 2.1d F-2)', () => {
  it('計數 + 忽略 null/undefined severity', () => {
    const rows = [
      { severity: 'info' },
      { severity: 'info' },
      { severity: 'warn' },
      { severity: 'critical' },
      { severity: null },
      { severity: undefined },
      {},
    ]
    expect(aggregateSeverities(rows)).toEqual({ info: 2, warn: 1, critical: 1 })
  })

  it('空陣列回 {}', () => {
    expect(aggregateSeverities([])).toEqual({})
  })
})

describe('putWithRetry (PR 2.1d F-3)', () => {
  it('預設 backoff schedule = [1000, 4000, 16000]', () => {
    expect(DEFAULT_PUT_RETRY_BACKOFF_MS).toEqual([1000, 4000, 16000])
  })

  it('第一次成功 → 不重試、不 sleep、不 callback', async () => {
    const calls = []
    const bucket = { put: async (k, _b) => { calls.push(k); return { ok: true } } }
    const sleeps = []
    const failed = []
    const r = await putWithRetry(bucket, 'k', 'body', { ct: 'x' }, {
      sleep: ms => { sleeps.push(ms); return Promise.resolve() },
      onAttemptFailed: e => { failed.push(e); return Promise.resolve() },
    })
    expect(r).toEqual({ ok: true })
    expect(calls).toEqual(['k'])
    expect(sleeps).toEqual([])
    expect(failed).toEqual([])
  })

  it('前 2 次失敗第 3 次成功 → callback 2 次 willRetry=true，sleep 對應 backoff', async () => {
    let n = 0
    const bucket = { put: async () => {
      n++
      if (n < 3) throw new Error(`fail-${n}`)
      return { ok: true, attempt: n }
    } }
    const sleeps = []
    const failed = []
    const r = await putWithRetry(bucket, 'k', 'b', {}, {
      backoffMs: [10, 20, 30],
      sleep: ms => { sleeps.push(ms); return Promise.resolve() },
      onAttemptFailed: e => { failed.push(e); return Promise.resolve() },
    })
    expect(r.attempt).toBe(3)
    expect(failed).toHaveLength(2)
    expect(failed[0].willRetry).toBe(true)
    expect(failed[0].nextDelayMs).toBe(10)
    expect(failed[1].willRetry).toBe(true)
    expect(failed[1].nextDelayMs).toBe(20)
    expect(sleeps).toEqual([10, 20])
  })

  it('全部失敗 → 最後一次 callback willRetry=false 後 throw', async () => {
    const bucket = { put: async () => { throw new Error('always-fail') } }
    const sleeps = []
    const failed = []
    await expect(putWithRetry(bucket, 'k', 'b', {}, {
      backoffMs: [5, 10, 15],
      sleep: ms => { sleeps.push(ms); return Promise.resolve() },
      onAttemptFailed: e => { failed.push(e); return Promise.resolve() },
    })).rejects.toThrow('always-fail')
    expect(failed).toHaveLength(4)  // 1 + 3 retries
    expect(failed[0].willRetry).toBe(true)
    expect(failed[3].willRetry).toBe(false)
    expect(failed[3].nextDelayMs).toBeNull()
    expect(failed[3].attempt).toBe(4)
    // 最後一次 attempt 不 sleep；只有前 3 次 retry 才 sleep
    expect(sleeps).toEqual([5, 10, 15])
  })

  it('callback 自身 throw 不會中斷重試流程', async () => {
    let n = 0
    const bucket = { put: async () => {
      n++; if (n < 2) throw new Error('boom'); return { ok: true }
    } }
    const r = await putWithRetry(bucket, 'k', 'b', {}, {
      backoffMs: [1],
      sleep: () => Promise.resolve(),
      onAttemptFailed: () => Promise.reject(new Error('callback-broke')),
    })
    expect(r).toEqual({ ok: true })
  })
})

describe('PR 2.2a SUPPORTED_COLD_CLASSES + hotRetentionDaysFor', () => {
  it('SUPPORTED_COLD_CLASSES 固定 6 個順序', () => {
    expect(SUPPORTED_COLD_CLASSES).toEqual([
      'immutable', 'security_critical', 'security_warn',
      'read_audit', 'telemetry', 'debug_failure',
    ])
  })

  it('hotRetentionDaysFor：telemetry 走 AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS（back-compat）', () => {
    expect(hotRetentionDaysFor({ AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS: '7' }, 'telemetry')).toBe(7)
    expect(hotRetentionDaysFor({ AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS: '0' }, 'telemetry')).toBe(0)
  })

  it('hotRetentionDaysFor：immutable 預設 180d / debug_failure 預設 90d / telemetry 預設 30d', () => {
    expect(hotRetentionDaysFor({}, 'immutable')).toBe(180)
    expect(hotRetentionDaysFor({}, 'security_critical')).toBe(180)
    expect(hotRetentionDaysFor({}, 'security_warn')).toBe(180)
    expect(hotRetentionDaysFor({}, 'read_audit')).toBe(180)
    expect(hotRetentionDaysFor({}, 'telemetry')).toBe(30)
    expect(hotRetentionDaysFor({}, 'debug_failure')).toBe(90)
  })

  it('hotRetentionDaysFor：per-class env override 生效', () => {
    expect(hotRetentionDaysFor({ AUDIT_ARCHIVE_HOT_DAYS_IMMUTABLE: '365' }, 'immutable')).toBe(365)
    expect(hotRetentionDaysFor({ AUDIT_ARCHIVE_HOT_DAYS_DEBUG_FAILURE: '0' }, 'debug_failure')).toBe(0)
  })

  it('hotRetentionDaysFor：非數值 env → 走預設', () => {
    expect(hotRetentionDaysFor({ AUDIT_ARCHIVE_HOT_DAYS_IMMUTABLE: 'foo' }, 'immutable')).toBe(180)
    expect(hotRetentionDaysFor({ AUDIT_ARCHIVE_HOT_DAYS_TELEMETRY: '' }, 'telemetry')).toBe(30)
  })
})

describe('purgeChunk — PR 2.3 manual force_purge helper', () => {
  // 共用 stubs：D1 prepare/bind/first/run chain + R2 bucket delete tracker
  function makeRowFromTarget(t, overrides = {}) {
    return {
      env: t.env, table_name: t.table_name, cold_class: t.cold_class,
      archive_date: t.archive_date,
      min_id: t.min_id, max_id: t.max_id, chunk_sha256: t.chunk_sha256,
      state: 'blacklisted', dry_run: 0, compression: 'gzip',
      ...overrides,
    }
  }
  function makeDb({ selectRow, deleteChanges = 1, throwOnDelete = false }) {
    return {
      prepare(sql) {
        const isSelect = /^SELECT/i.test(sql.trim())
        const isDelete = /^\s*DELETE/i.test(sql)
        return {
          bind() { return this },
          first: async () => isSelect ? selectRow : null,
          run:   async () => {
            if (isDelete && throwOnDelete) throw new Error('d1 throw')
            return isDelete ? { meta: { changes: deleteChanges } } : { meta: { changes: 0 } }
          },
        }
      },
    }
  }
  function makeBucket({ throwAt = null } = {}) {
    const deleted = []
    return {
      deleted,
      delete: async (key) => {
        deleted.push(key)
        if (throwAt && deleted.length === throwAt) throw new Error('r2 lock 403')
      },
    }
  }

  const target = {
    env: 'test', table_name: 'audit_log', cold_class: 'telemetry',
    archive_date: '2026-05-11', min_id: 1, max_id: 100,
    chunk_sha256: 'a'.repeat(64),
  }

  it('AUDIT_ARCHIVE_BUCKET 缺 binding → throw', async () => {
    await expect(purgeChunk({ env: {}, db: makeDb({ selectRow: null }), target }))
      .rejects.toThrow(/AUDIT_ARCHIVE_BUCKET/)
  })

  it('chunk not found → throw CHUNK_NOT_FOUND', async () => {
    const bucket = makeBucket()
    await expect(purgeChunk({
      env: { AUDIT_ARCHIVE_BUCKET: bucket },
      db: makeDb({ selectRow: null }),
      target,
    })).rejects.toMatchObject({ code: 'CHUNK_NOT_FOUND' })
    expect(bucket.deleted.length).toBe(0)
  })

  it('chunk state != blacklisted → throw CHUNK_STATE_MISMATCH（含 actualState）；R2 不動', async () => {
    const bucket = makeBucket()
    const row = makeRowFromTarget(target, { state: 'failed' })
    try {
      await purgeChunk({ env: { AUDIT_ARCHIVE_BUCKET: bucket }, db: makeDb({ selectRow: row }), target })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.code).toBe('CHUNK_STATE_MISMATCH')
      expect(e.actualState).toBe('failed')
    }
    expect(bucket.deleted.length).toBe(0)
  })

  it('happy path：依 row.compression=gzip 推 .jsonl.gz key；R2 兩刪 + D1 一刪', async () => {
    const bucket = makeBucket()
    const row = makeRowFromTarget(target, { compression: 'gzip' })
    const r = await purgeChunk({
      env: { AUDIT_ARCHIVE_BUCKET: bucket },
      db: makeDb({ selectRow: row, deleteChanges: 1 }),
      target,
    })
    expect(r.chunks_row_deleted).toBe(true)
    expect(r.source_rows_deleted).toBe(false)
    expect(r.data_key).toMatch(/\.jsonl\.gz$/)
    expect(r.data_key).toContain('audit-log/test/audit_log/telemetry/2026/05/11/')
    expect(r.manifest_key).toMatch(/\.json$/)
    expect(bucket.deleted).toEqual([r.data_key, r.manifest_key])
  })

  it('PR 2.0 dry-run chunk（compression=none, dry_run=1）→ key 走 audit-log-dryrun + .jsonl', async () => {
    const bucket = makeBucket()
    const row = makeRowFromTarget(target, { compression: 'none', dry_run: 1 })
    const r = await purgeChunk({
      env: { AUDIT_ARCHIVE_BUCKET: bucket },
      db: makeDb({ selectRow: row }),
      target,
    })
    expect(r.data_key).toMatch(/^audit-log-dryrun\//)
    expect(r.data_key).toMatch(/\.jsonl$/)
    expect(r.manifest_key).toMatch(/^manifest-dryrun\//)
  })

  it('R2 第一刪 throw → propagate；不會走到第二個 delete / D1', async () => {
    const bucket = makeBucket({ throwAt: 1 })
    const row = makeRowFromTarget(target)
    let dbDeleteCalled = false
    const db = {
      prepare(sql) {
        const isSelect = /^SELECT/i.test(sql.trim())
        return {
          bind() { return this },
          first: async () => isSelect ? row : null,
          run:   async () => { dbDeleteCalled = true; return { meta: { changes: 1 } } },
        }
      },
    }
    await expect(purgeChunk({ env: { AUDIT_ARCHIVE_BUCKET: bucket }, db, target }))
      .rejects.toThrow(/r2 lock 403/)
    expect(bucket.deleted.length).toBe(1)
    expect(dbDeleteCalled).toBe(false)
  })

  it('chunks row DELETE changes=0（race，state 被偷升）→ chunks_row_deleted=false 回去（呼叫端轉 409）', async () => {
    const bucket = makeBucket()
    const row = makeRowFromTarget(target)
    const r = await purgeChunk({
      env: { AUDIT_ARCHIVE_BUCKET: bucket },
      db: makeDb({ selectRow: row, deleteChanges: 0 }),
      target,
    })
    expect(r.chunks_row_deleted).toBe(false)
    expect(bucket.deleted.length).toBe(2)  // R2 已刪（不可逆）
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PR 0.2c-pre-1a — write-once R2 key + lock-aware refactor
// ─────────────────────────────────────────────────────────────────────────────

describe('PR 0.2c-pre-1a：KEY_SCHEME constants + MANIFEST_STATE_FILES', () => {
  it('KEY_SCHEME_LEGACY=1 / WRITE_ONCE=2', () => {
    expect(KEY_SCHEME_LEGACY).toBe(1)
    expect(KEY_SCHEME_WRITE_ONCE).toBe(2)
  })

  it('MANIFEST_STATE_FILES freezes 4 state（順序：planned/uploaded/verified/marked_archived）', () => {
    expect(MANIFEST_STATE_FILES).toEqual(['planned', 'uploaded', 'verified', 'marked_archived'])
    // marked_archived 不縮 marked — 跨層 state 名字一致
    expect(MANIFEST_STATE_FILES).toContain('marked_archived')
    expect(MANIFEST_STATE_FILES).not.toContain('marked')
    expect(Object.isFrozen(MANIFEST_STATE_FILES)).toBe(true)
  })
})

describe('PR 0.2c-pre-1a：buildChunkKeys + manifestState/keyScheme', () => {
  const base = {
    env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
    minId: 1, maxId: 100, sha256: 'feed', archiveDate: '2026-05-23',
  }

  it('legacy (keyScheme=1 預設)：manifestKey 走單 .json，不需 manifestState', () => {
    const k = buildChunkKeys({ ...base, dryRun: false })
    expect(k.manifestKey.endsWith('1-100-feed.json')).toBe(true)
    expect(k.manifestKey).not.toContain('.planned.')
  })

  it('write-once (keyScheme=2)：4 個 state 各自 distinct manifest key', () => {
    const states: Array<'planned' | 'uploaded' | 'verified' | 'marked_archived'> =
      ['planned', 'uploaded', 'verified', 'marked_archived']
    const keys = states.map(s => buildChunkKeys({
      ...base, dryRun: false, keyScheme: KEY_SCHEME_WRITE_ONCE, manifestState: s,
    }).manifestKey)
    // 4 keys 全 distinct
    expect(new Set(keys).size).toBe(4)
    // suffix 對齊跨層命名（不縮 marked_archived）
    expect(keys[0].endsWith('1-100-feed.planned.json')).toBe(true)
    expect(keys[1].endsWith('1-100-feed.uploaded.json')).toBe(true)
    expect(keys[2].endsWith('1-100-feed.verified.json')).toBe(true)
    expect(keys[3].endsWith('1-100-feed.marked_archived.json')).toBe(true)
  })

  it('write-once 但忘了帶 manifestState → throw', () => {
    expect(() => buildChunkKeys({
      ...base, dryRun: false, keyScheme: KEY_SCHEME_WRITE_ONCE,
    })).toThrow(/manifestState required/)
  })

  it('write-once 帶不在 MANIFEST_STATE_FILES 的 state → throw', () => {
    expect(() => buildChunkKeys({
      ...base, dryRun: false, keyScheme: KEY_SCHEME_WRITE_ONCE,
      manifestState: 'failed' as unknown as 'planned',
    })).toThrow(/unknown manifestState/)
  })

  it('dataKey 與 keyScheme/manifestState 無關 — 跨 4 state 永遠同一把', () => {
    const dataKeys = MANIFEST_STATE_FILES.map(s => buildChunkKeys({
      ...base, dryRun: false, keyScheme: KEY_SCHEME_WRITE_ONCE, manifestState: s,
    }).dataKey)
    expect(new Set(dataKeys).size).toBe(1)
  })
})

describe('PR 0.2c-pre-1a：deriveDataKey + deriveManifestKey', () => {
  it('deriveDataKey 與 manifestState 無關，per chunk 固定 1 key', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-23',
      min_id: 1, max_id: 100, chunk_sha256: 'feed',
      dry_run: 0, compression: 'gzip', key_scheme: 2,
    }
    expect(deriveDataKey(row)).toBe('audit-log/prod/audit_log/telemetry/2026/05/23/1-100-feed.jsonl.gz')
  })

  it('deriveManifestKey legacy chunk：忽略 manifestState 回單 .json', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11', min_id: 8, max_id: 922, chunk_sha256: 'abc',
      dry_run: 1, key_scheme: 1,
    }
    expect(deriveManifestKey(row)).toBe('manifest-dryrun/prod/audit_log/telemetry/2026/05/11/8-922-abc.json')
    // 即使 caller 傳 manifestState，legacy 路徑也忽略
    expect(deriveManifestKey(row, 'uploaded')).toBe('manifest-dryrun/prod/audit_log/telemetry/2026/05/11/8-922-abc.json')
  })

  it('deriveManifestKey write-once chunk：依 manifestState 分 4 key', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-23', min_id: 1, max_id: 100, chunk_sha256: 'feed',
      dry_run: 0, key_scheme: 2,
    }
    expect(deriveManifestKey(row, 'planned')).toMatch(/\.planned\.json$/)
    expect(deriveManifestKey(row, 'uploaded')).toMatch(/\.uploaded\.json$/)
    expect(deriveManifestKey(row, 'verified')).toMatch(/\.verified\.json$/)
    expect(deriveManifestKey(row, 'marked_archived')).toMatch(/\.marked_archived\.json$/)
  })

  it('deriveManifestKey write-once chunk 缺 manifestState → throw', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-23', min_id: 1, max_id: 100, chunk_sha256: 'feed',
      dry_run: 0, key_scheme: 2,
    }
    expect(() => deriveManifestKey(row)).toThrow(/manifestState required/)
  })

  it('deriveKeysFromChunk write-once + manifestState → manifestKey 帶 state 後綴', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-23', min_id: 1, max_id: 100, chunk_sha256: 'feed',
      dry_run: 0, compression: 'gzip', key_scheme: 2,
    }
    const k = deriveKeysFromChunk(row, { manifestState: 'verified' })
    expect(k.manifestKey).toMatch(/\.verified\.json$/)
    expect(k.dataKey).toBe('audit-log/prod/audit_log/telemetry/2026/05/23/1-100-feed.jsonl.gz')
  })

  it('deriveKeysFromChunk key_scheme 缺欄（PR 1a 前 row）→ fallback legacy 單 .json', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11', min_id: 8, max_id: 922, chunk_sha256: 'abc',
      dry_run: 1, compression: 'none',
      // key_scheme 缺 → row.key_scheme ?? KEY_SCHEME_LEGACY
    }
    const k = deriveKeysFromChunk(row)
    expect(k.manifestKey.endsWith('.json')).toBe(true)
    expect(k.manifestKey).not.toContain('.planned.')
  })
})

describe('PR 0.2c-pre-1a：isR2LockError 保守 detector', () => {
  // Positive cases — 必須同時 (status ∈ 409/412) AND (message/code/name 含 lock marker)
  it('positive: status=412 + message 含 "object locked"', () => {
    expect(isR2LockError({ status: 412, message: 'The object is locked by retention rule' })).toBe(true)
  })

  it('positive: status=409 + code 含 "ObjectLocked"', () => {
    expect(isR2LockError({ status: 409, code: 'ObjectLocked', message: 'conflict' })).toBe(true)
  })

  it('positive: status=412 + name 含 "RetentionLock"', () => {
    expect(isR2LockError({ status: 412, name: 'R2RetentionLockError' })).toBe(true)
  })

  it('positive: httpStatus=409 + code 含 "Immutable"', () => {
    expect(isR2LockError({ httpStatus: 409, code: 'ImmutableObjectError' })).toBe(true)
  })

  it('positive: statusCode=412 + message 含 "lock"（lowercase）', () => {
    expect(isR2LockError({ statusCode: 412, message: 'precondition failed: lock present' })).toBe(true)
  })

  // Negative cases — 任一條件不滿足都不算 lock（保守原則）
  it('negative: 純 message 含 lock 但無 status → 不算', () => {
    expect(isR2LockError({ message: 'object is locked' })).toBe(false)
  })

  it('negative: status=412 但 message 無 lock marker → 不算（避免 PreconditionFailed for 非 lock 誤判）', () => {
    expect(isR2LockError({ status: 412, message: 'etag mismatch' })).toBe(false)
  })

  it('negative: status=500（server error）+ message 含 lock → 不算', () => {
    expect(isR2LockError({ status: 500, message: 'internal lock failure' })).toBe(false)
  })

  it('negative: undefined / null / string / number → 都 false', () => {
    expect(isR2LockError(undefined)).toBe(false)
    expect(isR2LockError(null)).toBe(false)
    expect(isR2LockError('error message')).toBe(false)
    expect(isR2LockError(412)).toBe(false)
  })

  it('negative: status=403 + message 含 lock → 不算（403 forbidden 非 lock）', () => {
    expect(isR2LockError({ status: 403, message: 'forbidden by lock policy' })).toBe(false)
  })

  // ── PR 0.2c-pre-1b spike fixture regression (docs/fixtures/r2-lock-spike-2026-05-23.json) ──
  it('spike fixture：S3 真實 shape — HTTP 409 + code ObjectLockedByBucketPolicy + 對應 message', () => {
    // 直接從 spike Phase C put_same_key_same_body / put_same_key_diff_body / delete_same_key
    // 三條 operations 拿到的真實 R2 error 形狀（XML 解析後）
    expect(isR2LockError({
      status: 409,
      code: 'ObjectLockedByBucketPolicy',
      message: 'The object is locked by the bucket policy.',
    })).toBe(true)
  })

  it('spike fixture fast-path：知名 lock code 直 true，不必驗 status', () => {
    // R2_LOCK_KNOWN_CODES 是 spike-frozen high-confidence S3 code；單獨 code 命中就 true
    expect(isR2LockError({ code: 'ObjectLockedByBucketPolicy' })).toBe(true)
    expect(isR2LockError({ code: 'ObjectLockedByBucketPolicy', status: 200 })).toBe(true)
  })

  it('nested cause：worker binding 可能 wrap 成 Error.cause，detector 走一層 cause 鏈', () => {
    // 防 binding wrapping 場景（spike 是 fetch path 平的，binding shape 不明 → defensive）
    const wrapped = new Error('R2 PUT failed for chunk') as Error & { cause?: unknown }
    wrapped.cause = { status: 409, code: 'ObjectLockedByBucketPolicy', message: 'The object is locked by the bucket policy.' }
    expect(isR2LockError(wrapped)).toBe(true)
  })

  it('nested cause fast-path：cause.code 是 known lock code 也命中', () => {
    const wrapped = new Error('R2 binding error') as Error & { cause?: unknown }
    wrapped.cause = { code: 'ObjectLockedByBucketPolicy' }
    expect(isR2LockError(wrapped)).toBe(true)
  })

  it('negative：cause 沒命中 + outer 沒命中 → false（防 nested 變太寬）', () => {
    const wrapped = new Error('some other error') as Error & { cause?: unknown }
    wrapped.cause = { status: 500, message: 'internal server error' }
    expect(isR2LockError(wrapped)).toBe(false)
  })

  it('negative：unknown code with 409 but no lock marker → 不算', () => {
    expect(isR2LockError({
      status: 409,
      code: 'ConditionalRequestConflict',
      message: 'request precondition failed',
    })).toBe(false)
  })

  // ── Codex r1 P2 regression：dual condition 逐 candidate 判斷，不可跨 outer/cause 合併 ──
  it('codex r1 P2：outer 有 marker + cause 是非 lock 409 → false（不可跨 candidate 合併 status+marker）', () => {
    // 修前 bug：outer 提供 marker、cause 提供 status，全域 flag 合在一起 return true
    // 修後：每個 candidate 必須自己同時具備 status+marker 才算
    const wrapped = new Error('operation locked by user policy log') as Error & { cause?: unknown }
    wrapped.cause = { status: 409, code: 'ConditionalRequestConflict', message: 'request precondition failed' }
    expect(isR2LockError(wrapped)).toBe(false)
  })

  it('codex r1 P2：outer 是非 lock 409 + cause 有 marker (無 status) → false', () => {
    // 反向：status 從 outer 來、marker 從 cause 來。一樣不該命中。
    const wrapped = new Error('Request conflict') as Error & { status?: number; cause?: unknown }
    wrapped.status = 409
    // outer code 不是 lock-marker，name 是 'Error' 也不是
    wrapped.cause = { message: 'this resource is locked elsewhere by an unrelated system' }
    expect(isR2LockError(wrapped)).toBe(false)
  })

  it('positive control：cause 自己同時具備 status+marker（無 known code）→ true（走 fallback nested dual-condition，非 fast-path）', () => {
    // codex r2 nit：原本 cause 帶 ObjectLockedByBucketPolicy 會被 known-code fast-path
    // 在 dual-condition 前 short-circuit → 沒真正驗到 nested dual-condition path。
    // 改成 cause 只有 status + 含 marker 的 message（no known code），fast-path miss
    // → 必須走 fallback per-candidate dual-condition 才能 return true。
    const wrapped = new Error('R2 binding wrapper') as Error & { cause?: unknown }
    wrapped.cause = { status: 409, message: 'locked by bucket policy' }
    expect(isR2LockError(wrapped)).toBe(true)
  })
})

// ── PR 0.2c-pre-1b.2：Worker binding error shape (regression for canary outcome) ──
// docs/fixtures/r2-lock-binding-canary-2026-05-24.json gate outcome (b): binding 拋
// generic Error 無 code/status/cause，只有 canonical phrase + 尾巴 "(10069)" 在 message。
// 1b spike-tightened classifier 三路全漏（fast-path 無 code / dual 無 status / cause null）。
// 本 describe 鎖住：(a) 新 message-pattern path 覆蓋 binding shape；(b) 既有 negative
// case 不被 canonical phrase 拉成 false positive；(c) fixture 整段 ingest 防再退步。
describe('PR 0.2c-pre-1b.2：Worker binding canonical phrase + numeric code path', () => {
  it('binding shape (canary fixture): generic Error, no code/status/cause, canonical phrase + (10069) → true', () => {
    // 這個 case 在 1b.2 fix 之前**必 false**（fast-path 無 code / dual 無 status /
    // cause null）。post-fix path (2) canonical phrase 接住 → true。
    // [[feedback_regression_test_must_lock_exact_failure]]：鎖 exact failure mode。
    expect(isR2LockError({
      name: 'Error',
      message: 'put: The object is locked by the bucket policy. (10069)',
    })).toBe(true)
  })

  it('binding shape (delete): same shape, delete op prefix → true', () => {
    expect(isR2LockError({
      name: 'Error',
      message: 'delete: The object is locked by the bucket policy. (10069)',
    })).toBe(true)
  })

  it('canonical phrase only (no numeric code suffix) → true', () => {
    // S3 XML body Message 字面（無 numeric tail），canonical phrase 仍命中
    expect(isR2LockError({ message: 'The object is locked by the bucket policy.' })).toBe(true)
  })

  it('numeric code 10069 from message tail (no canonical phrase) → true', () => {
    // 若 Cloudflare 未來改 phrase wording，message 仍尾巴附 (10069) → numeric path 接住
    expect(isR2LockError({ message: 'R2 binding error (10069)' })).toBe(true)
  })

  it('structured numeric code field 10069 (future-proof) → true', () => {
    // 若 binding 未來把 code expose 成 structured 欄位（現行不會），仍命中
    expect(isR2LockError({ code: 10069, message: 'opaque error' })).toBe(true)
    expect(isR2LockError({ code: '10069', message: 'opaque error' })).toBe(true)
  })

  it('numeric code in nested cause → true (defensive nested walk)', () => {
    const wrapped = new Error('R2 binding wrapper') as Error & { cause?: unknown }
    wrapped.cause = { message: 'inner: The object is locked by the bucket policy. (10069)' }
    expect(isR2LockError(wrapped)).toBe(true)
  })

  // ── Negative cases: phrase / numeric code 必須精確，不可被類似字串拉成 false positive ──
  it('negative: similar-looking but missing canonical phrase → false', () => {
    // "locked" 出現但無完整 phrase，且無 status → 1b 既有 negative test 行為保留
    expect(isR2LockError({ message: 'object is locked' })).toBe(false)
    expect(isR2LockError({ message: 'forbidden by lock policy' })).toBe(false)
    expect(isR2LockError({ message: 'internal lock failure' })).toBe(false)
  })

  it('negative: unknown numeric code in message tail → false', () => {
    // 例：(12345) 不在 R2_LOCK_KNOWN_NUMERIC_CODES → 不命中
    expect(isR2LockError({ message: 'some error (12345)' })).toBe(false)
    expect(isR2LockError({ message: 'wrap (99999)' })).toBe(false)
  })

  it('negative: numeric in message but not at tail → false', () => {
    // (10069) 必須在 message 末尾才算 binding shape；middle 位置可能是隨機 log 數字
    expect(isR2LockError({ message: '(10069) was logged at startup, current error: other' })).toBe(false)
  })

  it('negative: structured code as random number not in set → false', () => {
    expect(isR2LockError({ code: 99999, message: 'opaque' })).toBe(false)
  })

  // ── Fixture 整段 ingest：兩個 thrown ops（put_overwrite + delete）原樣灌入 ──
  // 直接從 fixture 拿 response.thrown reconstruct 成 plain object，確保未來 fixture
  // 更新 / classifier 改動 / Cloudflare 改 message wording 任一發生，本 test 會立刻
  // 暴露問題。
  it('fixture wholesale: every thrown op must be detected as lock error', async () => {
    // Dynamic import 因為 vitest-pool-workers + tsconfig resolveJsonModule 路徑解析穩定
    const fixture = (await import('../docs/fixtures/r2-lock-binding-canary-2026-05-24.json')).default as {
      ops: Array<{
        step: number
        label: string
        expected_outcome: 'success' | 'thrown'
        response: {
          outcome: 'success' | 'thrown'
          thrown: null | {
            name: string
            message: string
            code: string | number | null
            status: number | null
            cause: unknown
            stringified: string
          }
        }
      }>
    }
    const thrownOps = fixture.ops.filter(o => o.expected_outcome === 'thrown')
    expect(thrownOps.length).toBeGreaterThanOrEqual(2)   // sanity: fixture 至少 2 個 thrown ops
    for (const op of thrownOps) {
      expect(op.response.outcome).toBe('thrown')   // fixture 自身一致性
      const t = op.response.thrown
      expect(t).not.toBeNull()
      if (!t) continue
      // Reconstruct binding error shape from fixture's captured thrown payload
      const errLike: Record<string, unknown> = {
        name: t.name,
        message: t.message,
      }
      if (t.code !== null) errLike['code'] = t.code
      if (t.status !== null) errLike['status'] = t.status
      if (t.cause !== null) errLike['cause'] = t.cause
      expect(isR2LockError(errLike)).toBe(true)
    }
  })
})

describe('PR 0.2c-pre-1a：putWithRetry lock-aware', () => {
  it('lock error 命中 → 不 retry / 不 sleep / 1 次 callback willRetry=false lockDetected=true', async () => {
    const bucket = { put: async () => {
      const e: Error & { status?: number; code?: string } = new Error('object locked')
      e.status = 412
      e.code = 'ObjectLocked'
      throw e
    } }
    const sleeps: number[] = []
    const failed: Array<{ willRetry: boolean; lockDetected: boolean; attempt: number; nextDelayMs: number | null }> = []
    await expect(putWithRetry(bucket, 'k', 'b', {}, {
      backoffMs: [5, 10, 15],
      sleep: ms => { sleeps.push(ms); return Promise.resolve() },
      onAttemptFailed: e => { failed.push(e); return Promise.resolve() },
    })).rejects.toThrow(/object locked/)
    expect(failed).toHaveLength(1)
    expect(failed[0].willRetry).toBe(false)
    expect(failed[0].lockDetected).toBe(true)
    expect(failed[0].attempt).toBe(1)
    expect(failed[0].nextDelayMs).toBeNull()
    expect(sleeps).toEqual([])   // 沒 sleep — lock 不 retry
  })

  it('非 lock error → 正常 retry，callback lockDetected=false 串連', async () => {
    let n = 0
    const bucket = { put: async () => {
      n++
      if (n < 4) throw new Error(`transient-${n}`)
      return { ok: true }
    } }
    const failed: Array<{ lockDetected: boolean }> = []
    await putWithRetry(bucket, 'k', 'b', {}, {
      backoffMs: [1, 1, 1],
      sleep: () => Promise.resolve(),
      onAttemptFailed: e => { failed.push(e); return Promise.resolve() },
    })
    expect(failed).toHaveLength(3)
    for (const f of failed) expect(f.lockDetected).toBe(false)
  })

  it('opts.isLockError 注入可覆寫 detector（測試 hook）', async () => {
    const bucket = { put: async () => { throw new Error('any error') } }
    const failed: Array<{ willRetry: boolean; lockDetected: boolean }> = []
    await expect(putWithRetry(bucket, 'k', 'b', {}, {
      backoffMs: [1],
      sleep: () => Promise.resolve(),
      onAttemptFailed: e => { failed.push(e); return Promise.resolve() },
      isLockError: () => true,   // 強制所有 error 視為 lock
    })).rejects.toThrow()
    expect(failed).toHaveLength(1)
    expect(failed[0].lockDetected).toBe(true)
    expect(failed[0].willRetry).toBe(false)
  })

  it('lock error throw 後仍 propagate lastError（不可吞錯）', async () => {
    const lockErr: Error & { status?: number } = new Error('locked-permanent')
    lockErr.status = 412
    const bucket = { put: async () => {
      Object.assign(lockErr, { code: 'ObjectLocked' })
      throw lockErr
    } }
    let thrown: unknown = null
    try {
      await putWithRetry(bucket, 'k', 'b', {}, { backoffMs: [1], sleep: () => Promise.resolve() })
    } catch (e) { thrown = e }
    expect(thrown).toBe(lockErr)
  })
})

describe('PR 0.2c-pre-1a：purgeChunk write-once chunk → 1 data + 4 manifest DELETE', () => {
  function makeBucket() {
    const deleted: string[] = []
    return {
      deleted,
      delete: async (key: string) => { deleted.push(key) },
    }
  }
  function makeDb(selectRow) {
    return {
      prepare(sql: string) {
        const isSelect = /^SELECT/i.test(sql.trim())
        return {
          bind() { return this },
          first: async () => isSelect ? selectRow : null,
          run:   async () => ({ meta: { changes: 1 } }),
        }
      },
    }
  }
  const target = {
    env: 'test', table_name: 'audit_log', cold_class: 'telemetry',
    archive_date: '2026-05-23', min_id: 1, max_id: 100,
    chunk_sha256: 'b'.repeat(64),
  }

  it('write-once blacklisted chunk → DELETE 1 data + 4 manifest key (all states)', async () => {
    const bucket = makeBucket()
    const row = {
      env: target.env, table_name: target.table_name, cold_class: target.cold_class,
      archive_date: target.archive_date,
      min_id: target.min_id, max_id: target.max_id, chunk_sha256: target.chunk_sha256,
      state: 'blacklisted', dry_run: 0, compression: 'gzip', key_scheme: 2,
    }
    const r = await purgeChunk({
      env: { AUDIT_ARCHIVE_BUCKET: bucket },
      db: makeDb(row),
      target,
    })
    expect(r.chunks_row_deleted).toBe(true)
    expect(bucket.deleted).toHaveLength(5)   // 1 data + 4 manifest
    expect(bucket.deleted[0]).toMatch(/\.jsonl\.gz$/)  // data first
    expect(bucket.deleted.slice(1)).toEqual([
      expect.stringMatching(/\.planned\.json$/),
      expect.stringMatching(/\.uploaded\.json$/),
      expect.stringMatching(/\.verified\.json$/),
      expect.stringMatching(/\.marked_archived\.json$/),
    ])
    // primary manifest_key 回 last（marked_archived）保持 backwards-compat
    expect(r.manifest_key).toMatch(/\.marked_archived\.json$/)
    // manifest_keys 暴露全集給 admin / forensic
    expect(r.manifest_keys).toHaveLength(4)
  })

  it('legacy blacklisted chunk → 維持 1 data + 1 manifest DELETE（前向相容）', async () => {
    const bucket = makeBucket()
    const row = {
      env: target.env, table_name: target.table_name, cold_class: target.cold_class,
      archive_date: target.archive_date,
      min_id: target.min_id, max_id: target.max_id, chunk_sha256: target.chunk_sha256,
      state: 'blacklisted', dry_run: 0, compression: 'gzip', key_scheme: 1,
    }
    const r = await purgeChunk({
      env: { AUDIT_ARCHIVE_BUCKET: bucket },
      db: makeDb(row),
      target,
    })
    expect(bucket.deleted).toHaveLength(2)
    expect(r.manifest_key.endsWith('.json')).toBe(true)
    expect(r.manifest_key).not.toContain('.marked_archived.')
    expect(r.manifest_keys).toHaveLength(1)
  })
})
