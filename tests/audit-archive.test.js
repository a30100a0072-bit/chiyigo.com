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
  appendStateHistory,
  aggregateSeverities,
  putWithRetry,
  DEFAULT_PUT_RETRY_BACKOFF_MS,
  SUPPORTED_COLD_CLASSES,
  hotRetentionDaysFor,
} from '../functions/utils/audit-archive.js'

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
      sha256Jsonl: 'abc', dryRun: true, dataKey: 'audit-log-dryrun/...'
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
    })
    expect(m1.severities).toEqual({ info: 4, warn: 1 })

    const m2 = buildManifest({
      env: 'prod', tableName: 'audit_log', coldClass: 'telemetry',
      coldClassVersion: 1, runId: 'r', state: 'planned',
      stateHistory: [], rowCount: 0, minId: 0, maxId: 0,
      minTs: 't', maxTs: 't', sha256Jsonl: 'h',
      dryRun: false, dataKey: 'k',
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
    const bucket = { put: async (k, b) => { calls.push(k); return { ok: true } } }
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
