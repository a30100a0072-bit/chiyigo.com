/**
 * audit-loss observability: safeUserAudit's outer catch-all must SWALLOW (never break the request) but no longer
 * be SILENT -- it logs a [audit-loss] signal so a failed audit write is observable in tail / monitoring. Root
 * cause of the ISO-ENUM-1 audit-loss: a non-string event_type made D1 .bind throw and the row was lost with no
 * trace. This guards the whole choke-point, across all callers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers'
import { safeUserAudit } from '../../functions/utils/user-audit'

describe('safeUserAudit audit-loss observability', () => {
  beforeEach(async () => { await resetDb() })

  it('logs once and resolves (never throws) when the audit write fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A non-string event_type makes D1 .bind throw inside safeUserAudit -> the outer catch (the ISO-ENUM-1 path).
    // safeUserAudit has untyped params, so no cast is needed to pass a function here.
    const r = await safeUserAudit(env, { event_type: () => 'x', user_id: 1 })
    expect(r).toBeUndefined()   // swallowed: never throws, never breaks the caller
    const lossCalls = spy.mock.calls.filter((c) => String(c[0]).includes('[audit-loss]'))
    expect(lossCalls.length).toBe(1)   // PRE-FIX: 0 (silent). POST-FIX: exactly one signal.
    spy.mockRestore()
  })

  it('does NOT log on the success path (no spam on normal audits)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await safeUserAudit(env, { event_type: 'auth.login.success', user_id: 1 })
    const lossCalls = spy.mock.calls.filter((c) => String(c[0]).includes('[audit-loss]'))
    expect(lossCalls.length).toBe(0)
    spy.mockRestore()
  })
})
