/**
 * Spike (will be deleted in PR-16c fix commit) — measure D1's actual
 * "LIKE or GLOB pattern too complex" ceiling for the patterns used by
 * GET /api/admin/requisitions.
 *
 * Goal: figure out the safe q-length cap given:
 *   (a) wrapped as `%${q}%`
 *   (b) bound to 1, 2, or 4 OR'd LIKE columns (requisitions uses 4)
 *
 * Output is captured in the PR-16c commit message; the file itself is
 * removed in the fix commit so it does not become permanent CI cost.
 */

import { describe, it, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys } from './_helpers.js'

const COL_PATTERNS = {
  1: 'name LIKE ?',
  2: 'name LIKE ? OR contact LIKE ?',
  4: 'name LIKE ? OR contact LIKE ? OR message LIKE ? OR company LIKE ?',
}

async function tryQuery(colCount, qLen, fillChar = 'a') {
  const q = fillChar.repeat(qLen)
  const pattern = `%${q}%`
  const binds = Array(colCount).fill(pattern)
  try {
    await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM requisition WHERE (${COL_PATTERNS[colCount]}) AND deleted_at IS NULL`)
      .bind(...binds)
      .first()
    return { ok: true }
  } catch (e) {
    return { ok: false, msg: String(e?.message || e) }
  }
}

async function tryProdShape(qLen) {
  // mirror requisitions.ts: two parallel queries via Promise.all, both 4-OR + deleted_at filter
  const q = 'a'.repeat(qLen)
  const pattern = `%${q}%`
  const binds = [pattern, pattern, pattern, pattern]
  try {
    await Promise.all([
      env.chiyigo_db
        .prepare(`SELECT COUNT(*) AS total FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL`)
        .bind(...binds).first(),
      env.chiyigo_db
        .prepare(`SELECT id FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .bind(...binds, 20, 0).all(),
    ])
    return { ok: true }
  } catch (e) {
    return { ok: false, msg: String(e?.message || e) }
  }
}

async function findCeiling(colCount) {
  // Binary search 1..2000
  let lo = 1, hi = 2000, lastOk = 0, firstFail = null, firstFailMsg = null
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const r = await tryQuery(colCount, mid)
    if (r.ok) { lastOk = mid; lo = mid + 1 }
    else { firstFail = mid; firstFailMsg = r.msg; hi = mid - 1 }
  }
  return { lastOk, firstFail, firstFailMsg }
}

describe('D1 LIKE complexity spike', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  it('measure ceiling on SEEDED table (1/2/4 column OR LIKE)', async () => {
    await resetDb()
    // need at least one row for LIKE engine to actually execute
    await env.chiyigo_db.prepare(`INSERT INTO requisition (name, contact, service_type, message)
                                   VALUES ('targetUser', 'c@x', 'web', 'm')`).run()
    const r1 = await findCeiling(1)
    const r2 = await findCeiling(2)
    const r4 = await findCeiling(4)

    const out = {
      one_column:  { largest_ok_qlen: r1.lastOk, first_fail_qlen: r1.firstFail, err: r1.firstFailMsg },
      two_column:  { largest_ok_qlen: r2.lastOk, first_fail_qlen: r2.firstFail, err: r2.firstFailMsg },
      four_column: { largest_ok_qlen: r4.lastOk, first_fail_qlen: r4.firstFail, err: r4.firstFailMsg },
    }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_LIKE_SPIKE_PLAIN ===\n' + JSON.stringify(out, null, 2) + '\n=== END ===\n')
  })

  it('repro prod failure shape (Promise.all of COUNT + SELECT with 4-OR)', async () => {
    await resetDb()
    const checkpoints = [50, 80, 90, 95, 99, 100, 101, 105, 120, 150, 200, 500, 1000]
    const results = []
    for (const len of checkpoints) {
      const r = await tryProdShape(len)
      results.push({ qlen: len, ok: r.ok, err: r.ok ? null : r.msg })
    }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_LIKE_SPIKE_PRODSHAPE ===\n' + JSON.stringify(results, null, 2) + '\n=== END ===\n')
  })

  it('repro pr-16b exact failing input (targetUser + 190 a, sliced to 100)', async () => {
    await resetDb()
    const longQ = 'targetUser' + 'a'.repeat(190)
    const sliced = longQ.slice(0, 100)
    const pattern = `%${sliced}%`
    const binds = [pattern, pattern, pattern, pattern]
    let exactResult, plainResult
    try {
      await Promise.all([
        env.chiyigo_db.prepare(`SELECT COUNT(*) AS total FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL`).bind(...binds).first(),
        env.chiyigo_db.prepare(`SELECT id FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...binds, 20, 0).all(),
      ])
      exactResult = { ok: true }
    } catch (e) {
      exactResult = { ok: false, msg: String(e?.message || e) }
    }
    // Same length, all 'a':
    const plainBinds = ['%' + 'a'.repeat(100) + '%']
    const fourPlain = [plainBinds[0], plainBinds[0], plainBinds[0], plainBinds[0]]
    try {
      await Promise.all([
        env.chiyigo_db.prepare(`SELECT COUNT(*) AS total FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL`).bind(...fourPlain).first(),
        env.chiyigo_db.prepare(`SELECT id FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...fourPlain, 20, 0).all(),
      ])
      plainResult = { ok: true }
    } catch (e) {
      plainResult = { ok: false, msg: String(e?.message || e) }
    }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_LIKE_SPIKE_PR16B_REPRO ===\n' + JSON.stringify({
      sliced_pattern_first_30: pattern.slice(0, 30),
      sliced_pattern_len: pattern.length,
      exact_input_result: exactResult,
      plain_aaa_result:   plainResult,
    }, null, 2) + '\n=== END ===\n')
  })

  it('isolate: empty table vs seeded row at qlen=100 mixed content', async () => {
    await resetDb()
    const q = 'targetUser' + 'a'.repeat(90)
    const pattern = `%${q}%`
    const binds = [pattern, pattern, pattern, pattern]
    const stmt = () => env.chiyigo_db.prepare(
      `SELECT id FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, 20, 0).all()

    let emptyR, seededR
    try { await stmt(); emptyR = { ok: true } } catch (e) { emptyR = { ok: false, msg: String(e?.message || e) } }
    await env.chiyigo_db.prepare(`INSERT INTO requisition (name, contact, service_type, message)
                                   VALUES ('targetUser', 'c@x', 'web', 'm')`).run()
    try { await stmt(); seededR = { ok: true } } catch (e) { seededR = { ok: false, msg: String(e?.message || e) } }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_LIKE_SPIKE_SEEDED ===\n' + JSON.stringify({ empty: emptyR, seeded: seededR }, null, 2) + '\n=== END ===\n')
  })

  it('repro through actual handler (rule out non-SQL cause)', async () => {
    await resetDb()
    const { seedUser } = await import('./_helpers.js')
    const { signJwt } = await import('../../functions/utils/jwt')
    const { onRequestGet } = await import('../../functions/api/admin/requisitions')
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    // seed one matching row
    await env.chiyigo_db.prepare(`INSERT INTO requisition (name, contact, service_type, message, status)
                                   VALUES ('targetUser', 'c@x', 'web', 'm', 'pending')`).run()
    const tok = await signJwt({
      sub: String(aid), email: 'a@x', role: 'admin', status: 'active', ver: 0,
    }, '15m', env, { audience: 'chiyigo' })
    const longQ = 'targetUser' + 'a'.repeat(190)
    const req = new Request(`http://x/api/admin/requisitions?q=${encodeURIComponent(longQ)}`,
                             { headers: { Authorization: `Bearer ${tok}` } })
    let outcome
    try {
      const resp = await onRequestGet({ request: req, env })
      const body = await resp.json()
      outcome = { status: resp.status, body_keys: Object.keys(body), bodyJson: body }
    } catch (e) {
      outcome = { threw: true, msg: String(e?.message || e) }
    }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_LIKE_SPIKE_HANDLER ===\n' + JSON.stringify(outcome, null, 2) + '\n=== END ===\n')
  })

  it('verify fix candidate: slice cap=32 survives multi-byte / wildcards', async () => {
    await resetDb()
    await env.chiyigo_db.prepare(`INSERT INTO requisition (name, contact, service_type, message)
                                   VALUES ('targetUser', 'c@x', 'web', 'm')`).run()
    const cases = {
      'plain_32a':      'a'.repeat(32),
      'percent_pad':    'a%'.repeat(16),
      'utf8_chinese':   '中'.repeat(32),  // 32 chars but 96 UTF-8 bytes
      'mixed_32':       'targetUser123456789012345678901',  // 31 + 1 = 32
    }
    const out = {}
    for (const [name, q] of Object.entries(cases)) {
      const pattern = `%${q}%`
      const binds = [pattern, pattern, pattern, pattern]
      try {
        await env.chiyigo_db.prepare(
          `SELECT id FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`
        ).bind(...binds).all()
        out[name] = { qlen: q.length, byte_len: new TextEncoder().encode(q).length, ok: true }
      } catch (e) {
        out[name] = { qlen: q.length, byte_len: new TextEncoder().encode(q).length, ok: false, msg: String(e?.message || e) }
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_LIKE_SPIKE_FIX_VERIFY ===\n' + JSON.stringify(out, null, 2) + '\n=== END ===\n')
  })

  it('verify INSTR pivot survives long input + UTF-8 + 4-OR', async () => {
    await resetDb()
    await env.chiyigo_db.prepare(`INSERT INTO requisition (name, contact, service_type, message)
                                   VALUES ('Alice', 'alice@x', 'web', '你好 Alice')`).run()
    const instrSql = `(INSTR(LOWER(name),    LOWER(?)) > 0
                    OR INSTR(LOWER(contact), LOWER(?)) > 0
                    OR INSTR(LOWER(message), LOWER(?)) > 0
                    OR INSTR(LOWER(COALESCE(company,'')), LOWER(?)) > 0) AND deleted_at IS NULL`
    const cases = {
      'short_match_lowercase':   { q: 'alice',        expectHit: true },
      'short_match_uppercase':   { q: 'ALICE',        expectHit: true },  // case-insensitive via LOWER
      'utf8_match':              { q: '你好',         expectHit: true },
      'long_100_chars_ascii':    { q: 'a'.repeat(100),       expectHit: false },
      'long_500_chars_ascii':    { q: 'a'.repeat(500),       expectHit: false },
      'long_100_chinese':        { q: '中'.repeat(100),      expectHit: false },
    }
    const out = {}
    for (const [name, { q, expectHit }] of Object.entries(cases)) {
      try {
        const r = await env.chiyigo_db.prepare(`SELECT id FROM requisition WHERE ${instrSql} LIMIT 20`).bind(q, q, q, q).all()
        const hits = (r.results || []).length
        out[name] = { qlen: q.length, byte_len: new TextEncoder().encode(q).length, ok: true, hits, expectHit, asExpected: (hits > 0) === expectHit }
      } catch (e) {
        out[name] = { qlen: q.length, ok: false, msg: String(e?.message || e) }
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_INSTR_PIVOT_VERIFY ===\n' + JSON.stringify(out, null, 2) + '\n=== END ===\n')
  })

  it('hunt: vary content shape at qlen=100 across 4-OR', async () => {
    await resetDb()
    const cases = {
      'all_a':              'a'.repeat(100),
      'all_z':              'z'.repeat(100),
      'targetUser_then_a':  'targetUser' + 'a'.repeat(90),
      'random_letters':     Array.from({length:100}, (_,i)=>'abcdefghij'[i%10]).join(''),
      'with_percent':       'a%'.repeat(50),
      'with_underscore':    'a_'.repeat(50),
      'with_backslash':     'a\\'.repeat(50),
      'mostly_digits':      '1234567890'.repeat(10),
    }
    const out = {}
    for (const [name, q] of Object.entries(cases)) {
      const pattern = `%${q}%`
      const binds = [pattern, pattern, pattern, pattern]
      try {
        await Promise.all([
          env.chiyigo_db.prepare(`SELECT COUNT(*) AS total FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL`).bind(...binds).first(),
          env.chiyigo_db.prepare(`SELECT id FROM requisition WHERE (${COL_PATTERNS[4]}) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...binds, 20, 0).all(),
        ])
        out[name] = { qlen: q.length, ok: true }
      } catch (e) {
        out[name] = { qlen: q.length, ok: false, msg: String(e?.message || e) }
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n=== D1_LIKE_SPIKE_CONTENT ===\n' + JSON.stringify(out, null, 2) + '\n=== END ===\n')
  })
})
