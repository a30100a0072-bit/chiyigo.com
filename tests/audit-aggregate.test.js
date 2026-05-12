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
  parseMaxRowsPerRun,
  parseLeadHours,
  hourBucket,
  telemetryCutoffISO,
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
  it('invalid → throws', () => {
    expect(() => hourBucket('not-a-date')).toThrow()
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
