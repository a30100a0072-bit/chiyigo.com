/**
 * F-3 Phase 2 PR 3.1 — audit-aggregate-debug helpers unit test
 *
 * 驗：
 *  - hourBucket / debugCutoffISO / totalCutoffHours 行為與 PR 3.0 一致
 *  - parseMaxRowsPerRun / parseLeadHours 邊界（吃 DEBUG_ 變體 env key）
 *  - fnv1a32 同輸入回相同 32-bit 整數
 *  - extractReasonCode 三 key 優先序 + JSON 壞 → null
 *  - reduceDebugBuckets：bucket key / total_count / deterministic reservoir N=10 /
 *    sampled flag / reason_code NULL → '' sentinel
 *  - rowIsDebugFailure 與 classifyForCold 一致
 */

import { describe, it, expect } from 'vitest'
import {
  AGGREGATE_LEAD_HOURS_DEFAULT,
  AGGREGATE_DEBUG_WRITER_VERSION,
  PR31_SUPPORTED_COLD_CLASS,
  SAMPLE_SIZE,
  MAX_TOTAL_HOURS,
  parseMaxRowsPerRun,
  parseLeadHours,
  hourBucket,
  debugCutoffISO,
  totalCutoffHours,
  fnv1a32,
  samplePriority,
  extractReasonCode,
  reduceDebugBuckets,
  rowIsDebugFailure,
} from '../functions/utils/audit-aggregate-debug.js'

describe('constants', () => {
  it('cold_class = debug_failure / writer version 帶 pr3.1 / sample size 10', () => {
    expect(PR31_SUPPORTED_COLD_CLASS).toBe('debug_failure')
    expect(AGGREGATE_DEBUG_WRITER_VERSION).toMatch(/pr3\.1/)
    expect(AGGREGATE_LEAD_HOURS_DEFAULT).toBe(24)
    expect(SAMPLE_SIZE).toBe(10)
  })
})

describe('parseMaxRowsPerRun（吃 DEBUG_ env key）', () => {
  it('預設 50000', () => {
    expect(parseMaxRowsPerRun({})).toBe(50_000)
  })
  it('空字串 → default', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_DEBUG_MAX_ROWS_PER_RUN: '' })).toBe(50_000)
  })
  it('非數字 → default', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_DEBUG_MAX_ROWS_PER_RUN: 'foo' })).toBe(50_000)
  })
  it('<1 → 夾到 1', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_DEBUG_MAX_ROWS_PER_RUN: '0' })).toBe(1)
  })
  it('正常 → 採用', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_DEBUG_MAX_ROWS_PER_RUN: '12' })).toBe(12)
  })
  it('不吃 telemetry env key（避免兩 worker 互相干擾）', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_MAX_ROWS_PER_RUN: '7' })).toBe(50_000)
  })
})

describe('parseLeadHours（吃 DEBUG_ env key）', () => {
  it('預設 24', () => {
    expect(parseLeadHours({})).toBe(24)
  })
  it('負數 → default', () => {
    expect(parseLeadHours({ AUDIT_AGGREGATE_DEBUG_LEAD_HOURS: '-1' })).toBe(24)
  })
  it('正常 → 採用', () => {
    expect(parseLeadHours({ AUDIT_AGGREGATE_DEBUG_LEAD_HOURS: '48' })).toBe(48)
  })
  it('不吃 telemetry env key', () => {
    expect(parseLeadHours({ AUDIT_AGGREGATE_LEAD_HOURS: '48' })).toBe(24)
  })
})

describe('hourBucket', () => {
  it('SQLite "YYYY-MM-DD HH:MM:SS" → UTC bucket', () => {
    expect(hourBucket('2026-05-12 03:15:00')).toBe('2026-05-12T03:00:00Z')
  })
  it('ISO Z 直通', () => {
    expect(hourBucket('2026-05-12T03:59:59.999Z')).toBe('2026-05-12T03:00:00Z')
  })
  it('Date instance', () => {
    expect(hourBucket(new Date('2026-05-12T03:30:00Z'))).toBe('2026-05-12T03:00:00Z')
  })
  it('壞輸入 throw', () => {
    expect(() => hourBucket('not-a-date')).toThrow()
  })
})

describe('debugCutoffISO', () => {
  it('hotDays=30 leadHours=24 → now-29d', () => {
    const now = new Date('2026-05-12T12:00:00Z')
    const iso = debugCutoffISO(30, 24, now)
    expect(iso).toBe('2026-04-13T12:00:00.000Z')
  })
  it('hotDays<=0 → null', () => {
    expect(debugCutoffISO(0, 24)).toBeNull()
  })
  it('1e308 hotDays → null（overflow 保護）', () => {
    expect(debugCutoffISO(1e308, 24)).toBeNull()
  })
})

describe('totalCutoffHours', () => {
  it('30d / 24h → 696h', () => {
    expect(totalCutoffHours(30, 24)).toBe(696)
  })
  it('hotDays<=0 → 0', () => {
    expect(totalCutoffHours(0, 24)).toBe(0)
    expect(totalCutoffHours(-5, 24)).toBe(0)
  })
  it('leadHours >= hotDays*24 → 0', () => {
    expect(totalCutoffHours(30, 720)).toBe(0)
  })
  it('clamp 到 MAX_TOTAL_HOURS', () => {
    expect(totalCutoffHours(1e308, 0)).toBeLessThanOrEqual(MAX_TOTAL_HOURS)
  })
})

describe('fnv1a32 / samplePriority', () => {
  it('同輸入回相同 32-bit', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'))
    expect(fnv1a32('hello')).toBeLessThan(2 ** 32)
  })
  it('不同輸入回不同值（典型 case）', () => {
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'))
  })
  it('samplePriority deterministic', () => {
    const p1 = samplePriority('e1|r1|2026-05-01T00:00:00Z', 42, '2026-05-01 00:30:00')
    const p2 = samplePriority('e1|r1|2026-05-01T00:00:00Z', 42, '2026-05-01 00:30:00')
    expect(p1).toBe(p2)
  })
})

describe('extractReasonCode 優先序', () => {
  it('reason_code 優先', () => {
    expect(extractReasonCode(JSON.stringify({ reason_code: 'A', code: 'B', reason: 'C' }))).toBe('A')
  })
  it('reason_code 缺 → code', () => {
    expect(extractReasonCode(JSON.stringify({ code: 'B', reason: 'C' }))).toBe('B')
  })
  it('reason_code/code 都缺 → reason', () => {
    expect(extractReasonCode(JSON.stringify({ reason: 'C' }))).toBe('C')
  })
  it('全缺 → null', () => {
    expect(extractReasonCode('{}')).toBeNull()
  })
  it('空字串 reason_code → 跳過往下找', () => {
    expect(extractReasonCode(JSON.stringify({ reason_code: '', code: 'B' }))).toBe('B')
  })
  it('JSON 壞 → null（不 throw）', () => {
    expect(extractReasonCode('not-json')).toBeNull()
  })
  it('null / 非物件 → null', () => {
    expect(extractReasonCode(null)).toBeNull()
    expect(extractReasonCode('"string"')).toBeNull()
  })
  it('物件直通（避雙重 JSON.parse）', () => {
    expect(extractReasonCode({ reason_code: 'X' })).toBe('X')
  })
})

describe('reduceDebugBuckets', () => {
  function mkRow(id, over = {}) {
    return {
      id,
      event_type: 'payment.webhook.fail',
      severity:   'critical',
      user_id:    null,
      ip_hash:    null,
      event_data: JSON.stringify({ reason_code: 'TIMEOUT' }),
      created_at: '2026-05-12 03:15:00',
      ...over,
    }
  }

  it('同 (event_type, reason_code, hour_bucket) 合一 bucket', () => {
    const buckets = reduceDebugBuckets([mkRow(1), mkRow(2), mkRow(3)])
    expect(buckets.size).toBe(1)
    const b = [...buckets.values()][0]
    expect(b.event_type).toBe('payment.webhook.fail')
    expect(b.reason_code).toBe('TIMEOUT')
    expect(b.hour_bucket).toBe('2026-05-12T03:00:00Z')
    expect(b.total_count).toBe(3)
    expect(b.sample_count).toBe(3)
    expect(b.sampled).toBe(0)
  })

  it('reason_code 不同 → 分 bucket', () => {
    const buckets = reduceDebugBuckets([
      mkRow(1, { event_data: JSON.stringify({ reason_code: 'TIMEOUT' }) }),
      mkRow(2, { event_data: JSON.stringify({ reason_code: 'CONFLICT' }) }),
    ])
    expect(buckets.size).toBe(2)
  })

  it('reason_code 缺 → null（UNIQUE 索引 COALESCE("") sentinel 處理）', () => {
    const buckets = reduceDebugBuckets([
      mkRow(1, { event_data: '{}' }),
      mkRow(2, { event_data: '{}' }),
    ])
    expect(buckets.size).toBe(1)
    const b = [...buckets.values()][0]
    expect(b.reason_code).toBeNull()
    expect(b.total_count).toBe(2)
  })

  it('reservoir：total_count > 10 → sample_count=10 + sampled=1', () => {
    const rows = []
    for (let i = 1; i <= 25; i++) rows.push(mkRow(i))
    const buckets = reduceDebugBuckets(rows)
    const b = [...buckets.values()][0]
    expect(b.total_count).toBe(25)
    expect(b.sample_count).toBe(10)
    expect(b.sampled).toBe(1)
    const samples = JSON.parse(b.samples_json)
    expect(samples).toHaveLength(10)
    // 採樣 id 應為 1..25 內的 10 個 distinct integer
    const ids = samples.map(s => s.id)
    expect(new Set(ids).size).toBe(10)
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1)
      expect(id).toBeLessThanOrEqual(25)
    }
  })

  it('deterministic：兩次 reduce 同 rows 回相同 samples_json', () => {
    const rows = []
    for (let i = 1; i <= 50; i++) rows.push(mkRow(i))
    const b1 = [...reduceDebugBuckets(rows).values()][0]
    const b2 = [...reduceDebugBuckets(rows).values()][0]
    expect(b1.samples_json).toBe(b2.samples_json)
  })

  it('deterministic：rows 順序變化不影響 samples_json（採樣 by priority asc）', () => {
    const rows = []
    for (let i = 1; i <= 30; i++) rows.push(mkRow(i))
    const shuffled = [...rows].reverse()
    const b1 = [...reduceDebugBuckets(rows).values()][0]
    const b2 = [...reduceDebugBuckets(shuffled).values()][0]
    // sample 集合相同（順序皆按 priority 排）
    expect(b1.samples_json).toBe(b2.samples_json)
  })

  it('sample 內容含 id / created_at / severity / user_id / event_data', () => {
    const buckets = reduceDebugBuckets([mkRow(1, { user_id: 99 })])
    const b = [...buckets.values()][0]
    const s = JSON.parse(b.samples_json)[0]
    expect(s.id).toBe(1)
    expect(s.severity).toBe('critical')
    expect(s.user_id).toBe(99)
    expect(s.event_data).toContain('TIMEOUT')
    expect(s.created_at).toBe('2026-05-12 03:15:00')
  })

  it('整批 < SAMPLE_SIZE → sampled=0 + sample_count=total_count', () => {
    const buckets = reduceDebugBuckets([mkRow(1), mkRow(2)])
    const b = [...buckets.values()][0]
    expect(b.sampled).toBe(0)
    expect(b.sample_count).toBe(2)
  })
})

describe('rowIsDebugFailure', () => {
  it('payment.webhook.fail → true', () => {
    expect(rowIsDebugFailure({ event_type: 'payment.webhook.fail', severity: 'critical' })).toBe(true)
  })
  it('account.register → false（immutable category）', () => {
    expect(rowIsDebugFailure({ event_type: 'account.register', severity: 'info' })).toBe(false)
  })
  it('未知 event_type → false（落 immutable default）', () => {
    expect(rowIsDebugFailure({ event_type: 'totally.made.up', severity: 'info' })).toBe(false)
  })
})
