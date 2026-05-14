/**
 * F-3 Phase 2 PR 3.2 — audit-aggregate-archive helpers unit test
 *
 * 驗：
 *  - cutoffMonthStartUTC 對齊「本月 1 號 00:00:00 UTC」+ 月邊界
 *  - telemetryRowsToJsonl / debugRowsToJsonl 欄序固定 → sha256 deterministic
 *  - debugRowsToJsonl samples_json round-trip JSON.parse；非合法 JSON 退回 raw_samples_json
 *  - aggregatePrefixes dry-run / live × 兩 cold_class
 *  - buildAggregateChunkKeys dry-run prefix + manifest 段 + 副檔名（gzip/none）
 *  - deriveAggregateKeysFromChunk dry_run 從 row 取（不吃 env）
 *  - splitIntoChunks 依 maxRows / maxBytes 分切
 *  - AGGREGATE_TABLES / AGGREGATE_COLD_CLASSES 對照
 */

import { describe, it, expect } from 'vitest'
import {
  AGGREGATE_TABLES,
  AGGREGATE_COLD_CLASSES,
  AGGREGATE_WRITER,
  AGGREGATE_WRITER_VERSION,
  cutoffMonthStartUTC,
  telemetryRowsToJsonl,
  debugRowsToJsonl,
  aggregatePrefixes,
  buildAggregateChunkKeys,
  deriveAggregateKeysFromChunk,
  buildAggregateManifest,
  splitIntoChunks,
  CHUNK_MAX_ROWS,
  CHUNK_MAX_BYTES,
} from '../functions/utils/audit-aggregate-archive.js'

describe('constants', () => {
  it('AGGREGATE_TABLES 對 2 表 + cold_class 對照', () => {
    expect(AGGREGATE_TABLES).toEqual({
      audit_log_aggregate_telemetry: 'aggregate_telemetry',
      audit_log_aggregate_debug:     'aggregate_debug',
    })
  })
  it('AGGREGATE_COLD_CLASSES 兩值順序固定', () => {
    expect(AGGREGATE_COLD_CLASSES).toEqual(['aggregate_telemetry', 'aggregate_debug'])
  })
  it('writer 帶 PR 3.2 版本', () => {
    expect(AGGREGATE_WRITER).toBe('cron-aggregate-archive-worker')
    expect(AGGREGATE_WRITER_VERSION).toMatch(/^3\.2\./)
  })
  it('CHUNK_MAX_ROWS / BYTES 與 PR 2.x 一致', () => {
    expect(CHUNK_MAX_ROWS).toBe(10_000)
    expect(CHUNK_MAX_BYTES).toBe(5_000_000)
  })
})

describe('cutoffMonthStartUTC', () => {
  it('一般月中 → 本月 1 號 00:00:00', () => {
    // 2026-05-14 12:34 UTC
    const cutoff = cutoffMonthStartUTC(new Date(Date.UTC(2026, 4, 14, 12, 34, 56)))
    expect(cutoff).toBe('2026-05-01 00:00:00')
  })
  it('月初 1 號 00:00 UTC → 本月 1 號（cutoff 排除上月最後一秒）', () => {
    const cutoff = cutoffMonthStartUTC(new Date(Date.UTC(2026, 5, 1, 0, 0, 0)))
    expect(cutoff).toBe('2026-06-01 00:00:00')
  })
  it('月底 23:59:59 UTC → 仍指本月 1 號', () => {
    const cutoff = cutoffMonthStartUTC(new Date(Date.UTC(2026, 4, 31, 23, 59, 59)))
    expect(cutoff).toBe('2026-05-01 00:00:00')
  })
  it('1 月 (UTC month 0) padding 正確', () => {
    const cutoff = cutoffMonthStartUTC(new Date(Date.UTC(2026, 0, 15, 0, 0, 0)))
    expect(cutoff).toBe('2026-01-01 00:00:00')
  })
  it('SQLite 文字格式（無 T/Z）— 避 ISO 比較陷阱', () => {
    const cutoff = cutoffMonthStartUTC()
    expect(cutoff).not.toMatch(/[TZ]/)
    expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('telemetryRowsToJsonl', () => {
  const baseRow = {
    id: 1, event_type: 'auth.login.rate_limited', user_id: 42,
    severity: 'info', hour_bucket: '2026-04-15T10:00:00Z',
    count: 5, ip_hash_top: 'abc', cold_class: 'aggregate_telemetry',
    created_at: '2026-04-15 10:30:00',
  }
  it('輸出固定欄序 + trailing newline', () => {
    const out = telemetryRowsToJsonl([baseRow])
    expect(out.endsWith('\n')).toBe(true)
    const obj = JSON.parse(out.trim())
    expect(Object.keys(obj)).toEqual([
      'id', 'event_type', 'user_id', 'severity', 'hour_bucket',
      'count', 'ip_hash_top', 'cold_class', 'created_at',
    ])
  })
  it('user_id / ip_hash_top NULL 規範化', () => {
    const out = telemetryRowsToJsonl([{ ...baseRow, user_id: null, ip_hash_top: null }])
    const obj = JSON.parse(out.trim())
    expect(obj.user_id).toBeNull()
    expect(obj.ip_hash_top).toBeNull()
  })
  it('多 row → deterministic（相同輸入 → 相同輸出）', () => {
    const a = telemetryRowsToJsonl([baseRow, { ...baseRow, id: 2 }])
    const b = telemetryRowsToJsonl([baseRow, { ...baseRow, id: 2 }])
    expect(a).toBe(b)
  })
})

describe('debugRowsToJsonl', () => {
  const baseRow = {
    id: 10, event_type: 'payment.webhook.fail', reason_code: 'VENDOR_REJECTED',
    hour_bucket: '2026-04-15T10:00:00Z', total_count: 3, sample_count: 2,
    samples_json: '[{"id":1,"reason_code":"VENDOR_REJECTED"}]',
    sampled: 1, cold_class: 'aggregate_debug', created_at: '2026-04-15 10:30:00',
  }
  it('samples_json 走 JSON.parse round-trip 進 samples 欄', () => {
    const out = debugRowsToJsonl([baseRow])
    const obj = JSON.parse(out.trim())
    expect(obj.samples).toEqual([{ id: 1, reason_code: 'VENDOR_REJECTED' }])
    expect(obj.raw_samples_json).toBeNull()
  })
  it('非合法 JSON → 退回 raw_samples_json + samples NULL', () => {
    const out = debugRowsToJsonl([{ ...baseRow, samples_json: 'not-json{' }])
    const obj = JSON.parse(out.trim())
    expect(obj.samples).toBeNull()
    expect(obj.raw_samples_json).toBe('not-json{')
  })
  it('samples_json 空 → samples 與 raw 皆 NULL', () => {
    const out = debugRowsToJsonl([{ ...baseRow, samples_json: '' }])
    const obj = JSON.parse(out.trim())
    expect(obj.samples).toBeNull()
    expect(obj.raw_samples_json).toBeNull()
  })
  it('reason_code NULL 規範化', () => {
    const out = debugRowsToJsonl([{ ...baseRow, reason_code: null, samples_json: '[]' }])
    const obj = JSON.parse(out.trim())
    expect(obj.reason_code).toBeNull()
  })
  it('欄序固定 → sha256 deterministic（同輸入兩次相同字串）', () => {
    const a = debugRowsToJsonl([baseRow])
    const b = debugRowsToJsonl([baseRow])
    expect(a).toBe(b)
  })
})

describe('aggregatePrefixes', () => {
  it('live + telemetry', () => {
    expect(aggregatePrefixes(false, 'aggregate_telemetry')).toEqual({
      data: 'audit-log-aggregate-telemetry', manifest: 'manifest',
    })
  })
  it('live + debug', () => {
    expect(aggregatePrefixes(false, 'aggregate_debug')).toEqual({
      data: 'audit-log-aggregate-debug', manifest: 'manifest',
    })
  })
  it('dry-run + telemetry → -dryrun + manifest-dryrun', () => {
    expect(aggregatePrefixes(true, 'aggregate_telemetry')).toEqual({
      data: 'audit-log-aggregate-telemetry-dryrun', manifest: 'manifest-dryrun',
    })
  })
  it('dry-run + debug', () => {
    expect(aggregatePrefixes(true, 'aggregate_debug')).toEqual({
      data: 'audit-log-aggregate-debug-dryrun', manifest: 'manifest-dryrun',
    })
  })
})

describe('buildAggregateChunkKeys', () => {
  const opts = {
    env: 'prod', tableName: 'audit_log_aggregate_telemetry',
    coldClass: 'aggregate_telemetry', minId: 1, maxId: 99,
    sha256: 'deadbeef', archiveDate: '2026-06-01', dryRun: false,
  }
  it('live + gzip → data key 帶 .jsonl.gz / manifest 帶 table 段', () => {
    const k = buildAggregateChunkKeys(opts)
    expect(k.dataKey).toBe('audit-log-aggregate-telemetry/prod/2026/06/01/1-99-deadbeef.jsonl.gz')
    expect(k.manifestKey).toBe('manifest/prod/audit_log_aggregate_telemetry/2026/06/01/1-99-deadbeef.json')
    expect(k.archiveDate).toBe('2026-06-01')
  })
  it('dry-run → data 走 -dryrun，manifest 走 manifest-dryrun', () => {
    const k = buildAggregateChunkKeys({ ...opts, dryRun: true })
    expect(k.dataKey).toBe('audit-log-aggregate-telemetry-dryrun/prod/2026/06/01/1-99-deadbeef.jsonl.gz')
    expect(k.manifestKey).toBe('manifest-dryrun/prod/audit_log_aggregate_telemetry/2026/06/01/1-99-deadbeef.json')
  })
  it('compression="none" → .jsonl', () => {
    const k = buildAggregateChunkKeys({ ...opts, compression: 'none' })
    expect(k.dataKey.endsWith('.jsonl')).toBe(true)
  })
  it('debug cold_class → prefix 換 debug', () => {
    const k = buildAggregateChunkKeys({
      ...opts, tableName: 'audit_log_aggregate_debug', coldClass: 'aggregate_debug',
    })
    expect(k.dataKey.startsWith('audit-log-aggregate-debug/')).toBe(true)
    expect(k.manifestKey).toBe('manifest/prod/audit_log_aggregate_debug/2026/06/01/1-99-deadbeef.json')
  })
})

describe('deriveAggregateKeysFromChunk', () => {
  it('dry_run 從 row 自身取（不吃 env）', () => {
    const row = {
      env: 'prod', table_name: 'audit_log_aggregate_telemetry',
      cold_class: 'aggregate_telemetry', archive_date: '2026-06-01',
      min_id: 1, max_id: 5, chunk_sha256: 'abc', dry_run: 1, compression: 'gzip',
    }
    const k = deriveAggregateKeysFromChunk(row)
    expect(k.dataKey.startsWith('audit-log-aggregate-telemetry-dryrun/')).toBe(true)
  })
  it('compression 預設 gzip（PR 3.2 起新 chunk 預設值）', () => {
    const row = {
      env: 'prod', table_name: 'audit_log_aggregate_debug',
      cold_class: 'aggregate_debug', archive_date: '2026-06-01',
      min_id: 1, max_id: 5, chunk_sha256: 'abc', dry_run: 0,
    }
    const k = deriveAggregateKeysFromChunk(row)
    expect(k.dataKey.endsWith('.jsonl.gz')).toBe(true)
  })
})

describe('buildAggregateManifest', () => {
  it('帶 row_kind + 不含 severities', () => {
    const m = buildAggregateManifest({
      env: 'prod', tableName: 'audit_log_aggregate_telemetry',
      coldClass: 'aggregate_telemetry', runId: 'run-x', state: 'uploaded',
      stateHistory: [{ state: 'uploaded', at: '2026-06-01T19:00:00Z' }],
      rowCount: 5, minId: 1, maxId: 5, minTs: 'a', maxTs: 'b',
      sha256Jsonl: 'deadbeef', dryRun: false, dataKey: 'k',
      compression: 'gzip', sha256Gz: 'gz', rowKind: 'aggregate_telemetry',
    })
    expect(m.row_kind).toBe('aggregate_telemetry')
    expect(m.severities).toBeUndefined()
    expect(m.cold_class).toBe('aggregate_telemetry')
    expect(m.cold_class_version).toBe(1)
    expect(m.compression).toBe('gzip')
    expect(m.writer).toBe('cron-aggregate-archive-worker')
  })
})

describe('splitIntoChunks', () => {
  const mkRow = (id) => ({
    id, event_type: 'e', user_id: null, severity: 'info',
    hour_bucket: 'h', count: 1, ip_hash_top: null,
    cold_class: 'aggregate_telemetry', created_at: 'c',
  })
  it('rows=0 → chunks=[]', () => {
    const { chunks } = splitIntoChunks([], telemetryRowsToJsonl)
    expect(chunks).toEqual([])
  })
  it('小量 → 單 chunk + min/max correct', () => {
    const rows = [mkRow(1), mkRow(2), mkRow(3)]
    const { chunks } = splitIntoChunks(rows, telemetryRowsToJsonl)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].minId).toBe(1)
    expect(chunks[0].maxId).toBe(3)
    expect(chunks[0].rows).toHaveLength(3)
  })
  it('maxRows=2 → 切兩 chunk', () => {
    const rows = [mkRow(1), mkRow(2), mkRow(3)]
    const { chunks } = splitIntoChunks(rows, telemetryRowsToJsonl, { maxRows: 2 })
    expect(chunks).toHaveLength(2)
    expect(chunks[0].rows.map(r => r.id)).toEqual([1, 2])
    expect(chunks[1].rows.map(r => r.id)).toEqual([3])
  })
  it('maxBytes 觸發切片', () => {
    const rows = [mkRow(1), mkRow(2), mkRow(3)]
    // 估單 row ~120 bytes → maxBytes=200 強制切到 1 row/chunk
    const { chunks } = splitIntoChunks(rows, telemetryRowsToJsonl, { maxBytes: 200 })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })
})
