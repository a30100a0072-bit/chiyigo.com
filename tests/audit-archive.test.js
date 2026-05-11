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
  buildChunkKeys,
  computeCursorAndBlocker,
  rowMatchesColdClass,
  buildManifest,
  isChunkTerminal,
  NON_TERMINAL_STATES,
  archivePrefixes,
  deriveKeysFromChunk,
  appendStateHistory,
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

  it('live 模式 → audit-log/ + manifest/', () => {
    const k = buildChunkKeys({ ...base, dryRun: false })
    expect(k.dataKey).toBe('audit-log/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.jsonl')
    expect(k.manifestKey).toBe('manifest/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.json')
  })

  it('dry-run 模式 → audit-log-dryrun/ + manifest-dryrun/', () => {
    const k = buildChunkKeys({ ...base, dryRun: true })
    expect(k.dataKey).toBe('audit-log-dryrun/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.jsonl')
    expect(k.manifestKey).toBe('manifest-dryrun/prod/audit_log/telemetry/2026/05/11/100-200-deadbeef.json')
  })

  it('archivePrefixes 兩模式 prefix 不相同', () => {
    const live = archivePrefixes(false)
    const dry  = archivePrefixes(true)
    expect(live.data).not.toBe(dry.data)
    expect(live.manifest).not.toBe(dry.manifest)
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

describe('deriveKeysFromChunk (PR 2.1a + 2.1c provenance)', () => {
  it('row.dry_run=1（INTEGER）→ dryrun prefix', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 8, max_id: 922, chunk_sha256: 'abc',
      dry_run: 1,
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey).toBe('audit-log-dryrun/prod/audit_log/telemetry/2026/05/11/8-922-abc.jsonl')
    expect(k.manifestKey).toBe('manifest-dryrun/prod/audit_log/telemetry/2026/05/11/8-922-abc.json')
  })

  it('row.dry_run=0 → live prefix', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 1, max_id: 2, chunk_sha256: 'dead',
      dry_run: 0,
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey.startsWith('audit-log/')).toBe(true)
    expect(k.manifestKey.startsWith('manifest/')).toBe(true)
  })

  it('row.dry_run=true（BOOL，相容性）→ dryrun prefix', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 1, max_id: 2, chunk_sha256: 'dead',
      dry_run: true,
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey.startsWith('audit-log-dryrun/')).toBe(true)
  })

  it('row.dry_run 缺欄（極端 fallback）→ live prefix', () => {
    const row = {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-05-11',
      min_id: 1, max_id: 2, chunk_sha256: 'dead',
    }
    const k = deriveKeysFromChunk(row)
    expect(k.dataKey.startsWith('audit-log/')).toBe(true)
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
  it('必要欄位齊全 + dry_run flag 反映輸入', () => {
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
    expect(m.compression).toBe('none')   // PR 2.0 不壓
    expect(m.sha256_zst).toBeNull()
    expect(m.dry_run).toBe(true)
    expect(m.state).toBe('planned')
    expect(m.state_history).toHaveLength(1)
    expect(m.row_count).toBe(3)
  })
})
