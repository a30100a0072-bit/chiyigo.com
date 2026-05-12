/**
 * F-3 Phase 2 PR 3.0 — audit-aggregate helpers unit test
 *
 * 驗：
 *  - hourBucket 對齊 YYYY-MM-DDTHH:00:00Z
 *  - telemetryCutoffISO 對齊 hot 過期前 24h（或 leadHours 自訂）
 *  - reduceTelemetryBuckets 命中 design doc bucket key 形式
 *  - ip_hash_top 取出現次數最多者 + 同票字典序較小
 *  - rowIsTelemetry 與 classifyForCold 一致
 *  - parseMaxRowsPerRun / parseLeadHours 邊界（空字串 / 非數字 / <1）
 */

import { describe, it, expect } from 'vitest'
import {
  AGGREGATE_LEAD_HOURS_DEFAULT,
  AGGREGATE_WRITER_VERSION,
  PR30_SUPPORTED_COLD_CLASS,
  MAX_TOTAL_HOURS,
  parseMaxRowsPerRun,
  parseLeadHours,
  hourBucket,
  telemetryCutoffISO,
  totalCutoffHours,
  reduceTelemetryBuckets,
  rowIsTelemetry,
} from '../functions/utils/audit-aggregate.js'

describe('constants', () => {
  it('cold_class = telemetry / writer version 帶 pr3.0', () => {
    expect(PR30_SUPPORTED_COLD_CLASS).toBe('telemetry')
    expect(AGGREGATE_WRITER_VERSION).toMatch(/pr3\.0/)
    expect(AGGREGATE_LEAD_HOURS_DEFAULT).toBe(24)
  })
})

describe('parseMaxRowsPerRun', () => {
  it('預設 50000', () => {
    expect(parseMaxRowsPerRun({})).toBe(50_000)
  })
  it('空字串 → default', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_MAX_ROWS_PER_RUN: '' })).toBe(50_000)
  })
  it('非數字 → default', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_MAX_ROWS_PER_RUN: 'foo' })).toBe(50_000)
  })
  it('<1 → 夾到 1', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_MAX_ROWS_PER_RUN: '0' })).toBe(1)
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_MAX_ROWS_PER_RUN: '-5' })).toBe(1)
  })
  it('正常整數 → 採用', () => {
    expect(parseMaxRowsPerRun({ AUDIT_AGGREGATE_MAX_ROWS_PER_RUN: '1234' })).toBe(1234)
  })
})

describe('parseLeadHours', () => {
  it('預設 24', () => {
    expect(parseLeadHours({})).toBe(24)
  })
  it('空字串 → default', () => {
    expect(parseLeadHours({ AUDIT_AGGREGATE_LEAD_HOURS: '' })).toBe(24)
  })
  it('負數 → default', () => {
    expect(parseLeadHours({ AUDIT_AGGREGATE_LEAD_HOURS: '-1' })).toBe(24)
  })
  it('正常 → 採用（含 0 = 不留 buffer）', () => {
    expect(parseLeadHours({ AUDIT_AGGREGATE_LEAD_HOURS: '0' })).toBe(0)
    expect(parseLeadHours({ AUDIT_AGGREGATE_LEAD_HOURS: '48' })).toBe(48)
  })
})

describe('hourBucket', () => {
  it('整點對齊（UTC，min/sec/ms 歸零）', () => {
    expect(hourBucket('2026-05-12T03:45:17.300Z')).toBe('2026-05-12T03:00:00Z')
  })
  it('midnight', () => {
    expect(hourBucket('2026-05-12T00:00:00Z')).toBe('2026-05-12T00:00:00Z')
  })
  it('接受 Date instance', () => {
    expect(hourBucket(new Date('2026-05-12T23:59:59Z'))).toBe('2026-05-12T23:00:00Z')
  })
  it('SQLite datetime() 格式（空白分隔無 TZ）視為 UTC', () => {
    // codex r1 M-1：原本 new Date('2026-05-12 03:15:00') 在 Asia/Taipei 會被當 local
    // → toISOString() 變 '2026-05-11T19:15:00Z'，bucket 偏 8h。修法後規範化為 'T'+'Z' parse。
    expect(hourBucket('2026-05-12 03:15:00')).toBe('2026-05-12T03:00:00Z')
    expect(hourBucket('2026-05-12 23:59:59')).toBe('2026-05-12T23:00:00Z')
  })
  it('ISO 無 TZ 也視為 UTC（補 Z）', () => {
    expect(hourBucket('2026-05-12T03:15:00')).toBe('2026-05-12T03:00:00Z')
    expect(hourBucket('2026-05-12T03:15:00.500')).toBe('2026-05-12T03:00:00Z')
  })
  it('invalid → throws', () => {
    expect(() => hourBucket('not-a-date')).toThrow()
  })
})

describe('totalCutoffHours', () => {
  it('正常算式：hotDays=30 / leadHours=24 → 696h', () => {
    expect(totalCutoffHours(30, 24)).toBe(696)
  })
  it('hotDays=0 → 負數 clamp 到 0', () => {
    expect(totalCutoffHours(0, 24)).toBe(0)
  })
  it('Infinity / 1e308 hotDays → SQL 安全範圍內（不 throw、不 Infinity）', () => {
    // codex r1 L-1：避免 Infinity 內嵌成 SQL `datetime('now','-Infinity hours')` 字串
    for (const v of [totalCutoffHours(1e308, 24), totalCutoffHours(Infinity, 24)]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(MAX_TOTAL_HOURS)
    }
  })
  it('NaN → 0', () => {
    expect(totalCutoffHours(NaN, 24)).toBe(0)
    expect(totalCutoffHours(30, NaN)).toBe(720)  // 30*24-0 = 720
  })
  it('負 leadHours （> hotDays*24） → clamp 到 0', () => {
    expect(totalCutoffHours(1, 100)).toBe(0)
  })
})

describe('telemetryCutoffISO', () => {
  const now = new Date('2026-05-12T12:00:00Z')

  it('hotDays=30 / leadHours=24 → now - 29 days', () => {
    const cutoff = telemetryCutoffISO(30, 24, now)
    // 30 days - 24 hours = 29 days
    expect(cutoff).toBe('2026-04-13T12:00:00.000Z')
  })

  it('hotDays=30 / leadHours=0 → now - 30 days（無 buffer）', () => {
    const cutoff = telemetryCutoffISO(30, 0, now)
    expect(cutoff).toBe('2026-04-12T12:00:00.000Z')
  })

  it('hotDays<=0 → null（skip 訊號）', () => {
    expect(telemetryCutoffISO(0, 24, now)).toBeNull()
    expect(telemetryCutoffISO(-1, 24, now)).toBeNull()
  })

  it('hotDays 非有限 → null', () => {
    expect(telemetryCutoffISO(NaN, 24, now)).toBeNull()
  })

  it('leadHours 非有限 → null（防 NaN/Infinity 漏進 Date）', () => {
    expect(telemetryCutoffISO(30, NaN, now)).toBeNull()
    expect(telemetryCutoffISO(30, Infinity, now)).toBeNull()
  })

  it('1e308 hotDays 不 throw（codex r1 L-1）', () => {
    // 原本 1e308 * 86400 * 1000 → Infinity → new Date(...).toISOString() throws RangeError
    expect(() => telemetryCutoffISO(1e308, 24, now)).not.toThrow()
    expect(telemetryCutoffISO(1e308, 24, now)).toBeNull()
  })
})

describe('reduceTelemetryBuckets — _ip_hashes cleanup', () => {
  it('結算後 _ip_hashes 不在 return value（codex r1 L）', () => {
    const rows = [
      { event_type: 'x', severity: 'info', user_id: null, ip_hash: 'a',
        created_at: '2026-05-12 03:15:00' },
    ]
    const buckets = reduceTelemetryBuckets(rows)
    const b = [...buckets.values()][0]
    expect(b._ip_hashes).toBeUndefined()
    expect(b.ip_hash_top).toBe('a')
  })
})

describe('reduceTelemetryBuckets', () => {
  const makeRow = (over) => ({
    id: 1, event_type: 'auth.login.rate_limited', severity: 'info',
    user_id: null, ip_hash: 'h1', created_at: '2026-05-12T03:15:00Z',
    ...over,
  })

  it('同 (event_type, user_id, severity, hour_bucket) 合併 count', () => {
    const rows = [
      makeRow({ id: 1, created_at: '2026-05-12T03:10:00Z' }),
      makeRow({ id: 2, created_at: '2026-05-12T03:50:00Z' }),
      makeRow({ id: 3, created_at: '2026-05-12T03:59:59Z' }),
    ]
    const buckets = reduceTelemetryBuckets(rows)
    expect(buckets.size).toBe(1)
    const b = [...buckets.values()][0]
    expect(b.count).toBe(3)
    expect(b.hour_bucket).toBe('2026-05-12T03:00:00Z')
    expect(b.user_id).toBeNull()
  })

  it('不同小時 → 不同 bucket', () => {
    const rows = [
      makeRow({ id: 1, created_at: '2026-05-12T03:30:00Z' }),
      makeRow({ id: 2, created_at: '2026-05-12T04:00:00Z' }),
    ]
    const buckets = reduceTelemetryBuckets(rows)
    expect(buckets.size).toBe(2)
  })

  it('不同 user_id → 不同 bucket（null vs 數字也分）', () => {
    const rows = [
      makeRow({ id: 1, user_id: null }),
      makeRow({ id: 2, user_id: 42 }),
      makeRow({ id: 3, user_id: 42 }),
    ]
    const buckets = reduceTelemetryBuckets(rows)
    expect(buckets.size).toBe(2)
    const byUser = new Map([...buckets.values()].map(b => [String(b.user_id), b.count]))
    expect(byUser.get('null')).toBe(1)
    expect(byUser.get('42')).toBe(2)
  })

  it('ip_hash_top = 出現最多者', () => {
    const rows = [
      makeRow({ id: 1, ip_hash: 'a' }),
      makeRow({ id: 2, ip_hash: 'b' }),
      makeRow({ id: 3, ip_hash: 'b' }),
      makeRow({ id: 4, ip_hash: null }),
    ]
    const buckets = reduceTelemetryBuckets(rows)
    expect([...buckets.values()][0].ip_hash_top).toBe('b')
  })

  it('ip_hash_top 同票取字典序較小（deterministic）', () => {
    const rows = [
      makeRow({ id: 1, ip_hash: 'z' }),
      makeRow({ id: 2, ip_hash: 'a' }),
    ]
    const buckets = reduceTelemetryBuckets(rows)
    expect([...buckets.values()][0].ip_hash_top).toBe('a')
  })

  it('ip_hash 全 NULL → ip_hash_top=null', () => {
    const rows = [
      makeRow({ id: 1, ip_hash: null }),
      makeRow({ id: 2, ip_hash: null }),
    ]
    const buckets = reduceTelemetryBuckets(rows)
    expect([...buckets.values()][0].ip_hash_top).toBeNull()
    expect([...buckets.values()][0].count).toBe(2)
  })

  it('空 row → 空 Map', () => {
    expect(reduceTelemetryBuckets([]).size).toBe(0)
  })
})

describe('rowIsTelemetry', () => {
  it('telemetry event → true', () => {
    expect(rowIsTelemetry({ event_type: 'auth.login.rate_limited', severity: 'info' })).toBe(true)
    expect(rowIsTelemetry({ event_type: 'oauth.backchannel.dispatch', severity: 'info' })).toBe(true)
  })
  it('non-telemetry event → false', () => {
    expect(rowIsTelemetry({ event_type: 'auth.login.success', severity: 'info' })).toBe(false)
    expect(rowIsTelemetry({ event_type: 'account.register', severity: 'info' })).toBe(false)
  })
})
