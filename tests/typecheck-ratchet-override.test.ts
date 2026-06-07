// PR-0 (Stage 7 strict zero-error gate): pure unit test for the ratchet locked
// override preconditions. Feeds plain objects to the exported helpers; does not
// touch git/tsc (that is covered by the T0-T8 adversarial integration receipts).
// Assertions match on ASCII prefixes (P1-P5 / [BASE...]) which is exactly what
// isExemptableFailure compares; the real (zh) failure strings are exercised by
// the T4 adversarial run. See docs/plans/stage7-strict-zero-error.md section 3.
import { describe, it, expect } from 'vitest'
import {
  analyzeStrictFlagDelta,
  evaluateOverridePreconditions,
  isExemptableFailure,
} from '../scripts/lib/ratchet-override.mjs'

// Shape of normalizeTsconfigParsed output (include/exclude/compilerOptions/references).
function snap(compilerOptions, extra = {}) {
  return { include: [], exclude: [], compilerOptions, references: [], ...(extra || {}) }
}

describe('analyzeStrictFlagDelta (P2)', () => {
  it('single leaf strict false->true passes', () => {
    const base = { 'tsconfig.functions.json': snap({ strict: false, noImplicitAny: false }) }
    const cur = { 'tsconfig.functions.json': snap({ strict: true, noImplicitAny: true }) }
    const r = analyzeStrictFlagDelta(base, cur)
    expect(r.ok).toBe(true)
    expect(r.leaf).toBe('functions')
    expect(r.leafTsconfig).toBe('tsconfig.functions.json')
    expect(r.flags).toEqual(['noImplicitAny', 'strict'])
  })

  it('rejects two leaves opening strict at once', () => {
    const base = { 'tsconfig.functions.json': snap({ strict: false }), 'tsconfig.scripts.json': snap({ strict: false }) }
    const cur = { 'tsconfig.functions.json': snap({ strict: true }), 'tsconfig.scripts.json': snap({ strict: true }) }
    const r = analyzeStrictFlagDelta(base, cur)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P2'))).toBe(true)
  })

  it('rejects strict true->false (weakening)', () => {
    const base = { 'tsconfig.functions.json': snap({ strict: true }) }
    const cur = { 'tsconfig.functions.json': snap({ strict: false }) }
    const r = analyzeStrictFlagDelta(base, cur)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P2'))).toBe(true)
  })

  it('rejects a non-strict-family compilerOptions change', () => {
    const base = { 'tsconfig.functions.json': snap({ strict: false, skipLibCheck: true }) }
    const cur = { 'tsconfig.functions.json': snap({ strict: true, skipLibCheck: false }) }
    const r = analyzeStrictFlagDelta(base, cur)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes('skipLibCheck'))).toBe(true)
  })

  it('rejects an include change alongside strict', () => {
    const base = { 'tsconfig.functions.json': snap({ strict: false }) }
    const cur = { 'tsconfig.functions.json': { include: ['functions/x.ts'], exclude: [], compilerOptions: { strict: true }, references: [] } }
    const r = analyzeStrictFlagDelta(base, cur)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes('include'))).toBe(true)
  })

  it('rejects a non-solution-leaf (root tsconfig.json) opening strict', () => {
    const base = { 'tsconfig.json': snap({ strict: false }) }
    const cur = { 'tsconfig.json': snap({ strict: true }) }
    const r = analyzeStrictFlagDelta(base, cur)
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.includes('solution leaf'))).toBe(true)
  })
})

describe('evaluateOverridePreconditions (P1-P5)', () => {
  const baseSnap = { 'tsconfig.functions.json': snap({ strict: false, noImplicitAny: false }) }
  const curSnap = { 'tsconfig.functions.json': snap({ strict: true, noImplicitAny: true }) }
  function legalCtx(over = {}) {
    return {
      baseBaseline: { errorCount: 0, cleanFiles: 257, errorsByFile: {} },
      baseline: { errorCount: 1293, cleanFiles: 111, errorsByFile: { 'functions/utils/jwt.ts': 36 } },
      current: { errorCount: 1293, cleanFiles: 111, errorsByFile: { 'functions/utils/jwt.ts': 36 } },
      added: [],
      modified: ['tsconfig.functions.json', 'types/typecheck-baseline.json'],
      renameMap: new Map(),
      currentSnap: curSnap,
      baseSnap,
      ...(over || {}),
    }
  }

  it('legal open-strict path passes (T4)', () => {
    const r = evaluateOverridePreconditions(legalCtx())
    expect(r.ok).toBe(true)
    expect(r.leaf).toBe('functions')
    expect(r.leafTsconfig).toBe('tsconfig.functions.json')
  })

  it('P3 base errorCount != 0 is rejected (T5 two leaves open)', () => {
    const r = evaluateOverridePreconditions(legalCtx({ baseBaseline: { errorCount: 5, cleanFiles: 257, errorsByFile: { 'functions/x.ts': 5 } } }))
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P3'))).toBe(true)
  })

  it('P4 baseline != current is rejected (T8 padding)', () => {
    const r = evaluateOverridePreconditions(legalCtx({ baseline: { errorCount: 9999, cleanFiles: 111, errorsByFile: { 'functions/utils/jwt.ts': 36 } } }))
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P4'))).toBe(true)
  })

  it('P1 source change is rejected (T3)', () => {
    const r = evaluateOverridePreconditions(legalCtx({ modified: ['tsconfig.functions.json', 'functions/utils/jwt.ts'] }))
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P1'))).toBe(true)
  })

  it('P1 rename whose source path is code is rejected', () => {
    const rm = new Map()
    rm.set('functions/b.ts', 'functions/a.ts')
    const r = evaluateOverridePreconditions(legalCtx({ added: ['functions/b.ts'], renameMap: rm }))
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P1'))).toBe(true)
  })

  it('P2 no strict change is rejected (T2)', () => {
    const r = evaluateOverridePreconditions(legalCtx({ currentSnap: baseSnap }))
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P2'))).toBe(true)
  })

  it('P5 errorsByFile outside leaf prefix is rejected (T6)', () => {
    const r = evaluateOverridePreconditions(legalCtx({
      baseline: { errorCount: 1293, cleanFiles: 111, errorsByFile: { 'src/js/dashboard.ts': 1293 } },
      current: { errorCount: 1293, cleanFiles: 111, errorsByFile: { 'src/js/dashboard.ts': 1293 } },
    }))
    expect(r.ok).toBe(false)
    expect(r.violations.some((v) => v.startsWith('P5'))).toBe(true)
  })

  it('allows docs/plans and governance-exceptions changes', () => {
    const r = evaluateOverridePreconditions(legalCtx({
      modified: ['tsconfig.functions.json', 'types/typecheck-baseline.json', 'docs/plans/stage7-strict-zero-error.md', 'docs/governance-exceptions.md'],
    }))
    expect(r.ok).toBe(true)
  })
})

describe('isExemptableFailure', () => {
  const ctx = { leafTsconfig: 'tsconfig.functions.json' }

  it('exempts the 5 base-derived failures', () => {
    expect(isExemptableFailure('[BASE] baseline.errorCount weakened 0 -> 1293', ctx)).toBe(true)
    expect(isExemptableFailure('[BASE] baseline.cleanFiles weakened 257 -> 111', ctx)).toBe(true)
    expect(isExemptableFailure("[BASE-B'] new error file functions/utils/jwt.ts", ctx)).toBe(true)
    expect(isExemptableFailure('[BASE-EBF] branch baseline.errorsByFile added functions/utils/jwt.ts', ctx)).toBe(true)
    expect(isExemptableFailure('[BASE-D-tsconfig] tsconfig.functions.json compilerOptions.strict changed false -> true', ctx)).toBe(true)
    expect(isExemptableFailure('[BASE-D-tsconfig] tsconfig.functions.json compilerOptions.noImplicitAny changed false -> true', ctx)).toBe(true)
  })

  it('does not exempt BASE-D-tsconfig of another leaf', () => {
    expect(isExemptableFailure('[BASE-D-tsconfig] tsconfig.scripts.json compilerOptions.strict changed false -> true', ctx)).toBe(false)
  })

  it('does not exempt a non-strict-family key (defense-in-depth)', () => {
    expect(isExemptableFailure('[BASE-D-tsconfig] tsconfig.functions.json compilerOptions.skipLibCheck changed true -> false', ctx)).toBe(false)
  })

  it('does not exempt branch-local guards', () => {
    expect(isExemptableFailure('[A] errorCount rose 0 -> 5 (+5)', ctx)).toBe(false)
    expect(isExemptableFailure('[B] cleanFiles regressed 257 -> 250', ctx)).toBe(false)
    expect(isExemptableFailure("[B'] new error file x.ts", ctx)).toBe(false)
    expect(isExemptableFailure("[B''] x.ts error count rose 1 -> 5", ctx)).toBe(false)
    expect(isExemptableFailure("[BASE-B''] x.ts error count rose (base ref baseline) 1 -> 5", ctx)).toBe(false)
    expect(isExemptableFailure('[C] x.ts:1 banned pattern', ctx)).toBe(false)
    expect(isExemptableFailure('[D/E] x.js new .js source', ctx)).toBe(false)
    expect(isExemptableFailure('[SCHEMA-baseline] errorsByFile[x] not a non-negative integer', ctx)).toBe(false)
  })
})
