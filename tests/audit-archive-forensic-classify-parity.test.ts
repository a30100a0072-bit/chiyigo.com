/**
 * PR 0.2c full prod lock — forensic classify parity test
 *
 * 鎖死 scripts/audit-archive-forensic-classify.mjs 的 inline-port derive logic
 * 對齊 canonical TS function（deriveKeysFromChunk / deriveAggregateKeysFromChunk）。
 *
 * 任一公式 drift → 紅燈 → 修 mjs OR 修 canonical（看哪邊是 source of truth）。
 *
 * Why this exists: codex r3 finding 1 對 §4.3 「formal-prefix object found」hard-stop SOP
 * 的 D1 cross-reference 步驟，必須走 canonical derive 而非 SQL on non-existent column；
 * mjs script 為 user 在 Phase 2/3 walk-through 跑的 CLI，必確保與生產 code path 同 source。
 */

import { describe, it, expect } from 'vitest'
import {
  deriveKeysFromChunk,
  MANIFEST_STATE_FILES,
  KEY_SCHEME_LEGACY,
  KEY_SCHEME_WRITE_ONCE,
  type ManifestStateFile,
} from '../functions/utils/audit-archive'
import { deriveAggregateKeysFromChunk } from '../functions/utils/audit-aggregate-archive'
import { deriveAllKeysForRow } from '../scripts/audit-archive-forensic-classify.mjs'

// ── Fixtures：representative branch coverage across 4 key-shape axes ───────
// 覆蓋 raw / aggregate × keyScheme 1 / 2 × dry-run / live × gzip / none 四維
// 的代表性 branch（非 full cartesian 32 combos；每條 branch 都有至少 1 fixture
// 命中，配 canonical parity 對齊保證任一公式 drift 立刻紅燈）。
const FIXTURES = [
  // ── Raw audit_log / immutable / 7y, key_scheme=1 legacy, live, gzip ──
  {
    name: 'raw audit_log immutable, scheme=1, live, gzip',
    row: {
      env: 'prod', table_name: 'audit_log', cold_class: 'immutable',
      archive_date: '2026-06-01', min_id: 100, max_id: 199,
      chunk_sha256: 'a'.repeat(64),
      dry_run: 0, compression: 'gzip', key_scheme: 1,
    },
    kind: 'raw',
  },
  // ── Raw admin_audit_log / immutable / 7y, scheme=2 write-once, live, gzip ──
  {
    name: 'raw admin_audit_log immutable, scheme=2, live, gzip',
    row: {
      env: 'prod', table_name: 'admin_audit_log', cold_class: 'immutable',
      archive_date: '2026-06-01', min_id: 200, max_id: 299,
      chunk_sha256: 'b'.repeat(64),
      dry_run: 0, compression: 'gzip', key_scheme: 2,
    },
    kind: 'raw',
  },
  // ── Raw audit_log / security_warn / 3y, scheme=1, dry-run, none ──
  {
    name: 'raw audit_log security_warn, scheme=1, dryrun, none',
    row: {
      env: 'prod', table_name: 'audit_log', cold_class: 'security_warn',
      archive_date: '2026-05-15', min_id: 1, max_id: 99,
      chunk_sha256: 'c'.repeat(64),
      dry_run: 1, compression: 'none', key_scheme: 1,
    },
    kind: 'raw',
  },
  // ── Raw audit_log / telemetry / 1y, scheme=2, live, none ──
  {
    name: 'raw audit_log telemetry, scheme=2, live, none',
    row: {
      env: 'prod', table_name: 'audit_log', cold_class: 'telemetry',
      archive_date: '2026-04-30', min_id: 50, max_id: 80,
      chunk_sha256: 'd'.repeat(64),
      dry_run: 0, compression: 'none', key_scheme: 2,
    },
    kind: 'raw',
  },
  // ── Aggregate telemetry, scheme=1, live, gzip ──
  {
    name: 'aggregate_telemetry, scheme=1, live, gzip',
    row: {
      env: 'prod', table_name: 'audit_log_aggregate_telemetry', cold_class: 'aggregate_telemetry',
      archive_date: '2026-05-01', min_id: 300, max_id: 399,
      chunk_sha256: 'e'.repeat(64),
      dry_run: 0, compression: 'gzip', key_scheme: 1,
    },
    kind: 'aggregate',
  },
  // ── Aggregate debug, scheme=2, dry-run, gzip ──
  {
    name: 'aggregate_debug, scheme=2, dryrun, gzip',
    row: {
      env: 'prod', table_name: 'audit_log_aggregate_debug', cold_class: 'aggregate_debug',
      archive_date: '2026-03-01', min_id: 400, max_id: 499,
      chunk_sha256: 'f'.repeat(64),
      dry_run: 1, compression: 'gzip', key_scheme: 2,
    },
    kind: 'aggregate',
  },
]

describe('forensic classify parity — inline-port matches canonical derive', () => {
  for (const fx of FIXTURES) {
    describe(fx.name, () => {
      const inlinePortCandidates = deriveAllKeysForRow(fx.row)
      const inlinePortKeySet = new Set(inlinePortCandidates.map((c: { derived_key: string }) => c.derived_key))

      if (fx.kind === 'raw') {
        if (fx.row.key_scheme === KEY_SCHEME_LEGACY) {
          // Legacy raw chunk: canonical 不需 manifestState，回 single manifest .json
          it('canonical legacy raw → inline-port contains data + legacy manifest', () => {
            const canonical = deriveKeysFromChunk(fx.row)
            expect(inlinePortKeySet.has(canonical.dataKey)).toBe(true)
            expect(inlinePortKeySet.has(canonical.manifestKey)).toBe(true)
          })
        } else {
          // Write-once raw chunk: canonical 必帶 manifestState；對 4 state 各驗
          for (const state of MANIFEST_STATE_FILES) {
            it(`canonical write-once raw[state=${state}] → inline-port contains data + manifest.${state}`, () => {
              const canonical = deriveKeysFromChunk(fx.row, { manifestState: state as ManifestStateFile })
              expect(inlinePortKeySet.has(canonical.dataKey)).toBe(true)
              expect(inlinePortKeySet.has(canonical.manifestKey)).toBe(true)
            })
          }
        }
      } else {
        // Aggregate
        if (fx.row.key_scheme === KEY_SCHEME_LEGACY) {
          it('canonical legacy aggregate → inline-port contains data + legacy manifest', () => {
            const canonical = deriveAggregateKeysFromChunk(fx.row)
            expect(inlinePortKeySet.has(canonical.dataKey)).toBe(true)
            expect(inlinePortKeySet.has(canonical.manifestKey)).toBe(true)
          })
        } else {
          for (const state of MANIFEST_STATE_FILES) {
            it(`canonical write-once aggregate[state=${state}] → inline-port contains data + manifest.${state}`, () => {
              const canonical = deriveAggregateKeysFromChunk(fx.row, { manifestState: state as ManifestStateFile })
              expect(inlinePortKeySet.has(canonical.dataKey)).toBe(true)
              expect(inlinePortKeySet.has(canonical.manifestKey)).toBe(true)
            })
          }
        }
      }

      it('inline-port candidate count matches expected scheme', () => {
        // scheme=1: 1 data + 1 manifest = 2 candidates
        // scheme=2: 1 data + 4 manifest = 5 candidates
        const expected = fx.row.key_scheme === KEY_SCHEME_WRITE_ONCE ? 5 : 2
        expect(inlinePortCandidates.length).toBe(expected)
      })

      it('inline-port candidate kinds are exhaustive', () => {
        const kinds = inlinePortCandidates.map((c: { key_kind: string }) => c.key_kind).sort()
        if (fx.kind === 'raw') {
          if (fx.row.key_scheme === KEY_SCHEME_LEGACY) {
            expect(kinds).toEqual(['raw_data', 'raw_manifest_legacy'])
          } else {
            expect(kinds).toEqual([
              'raw_data',
              'raw_manifest_marked_archived',
              'raw_manifest_planned',
              'raw_manifest_uploaded',
              'raw_manifest_verified',
            ])
          }
        } else {
          if (fx.row.key_scheme === KEY_SCHEME_LEGACY) {
            expect(kinds).toEqual(['aggregate_data', 'aggregate_manifest_legacy'])
          } else {
            expect(kinds).toEqual([
              'aggregate_data',
              'aggregate_manifest_marked_archived',
              'aggregate_manifest_planned',
              'aggregate_manifest_uploaded',
              'aggregate_manifest_verified',
            ])
          }
        }
      })
    })
  }
})
