/**
 * OD-3 credential requires_reverification enforcement — integration tests.
 *
 * Plan: docs/audit/cred-reverify-enforcement-plan.md §12 (Dimension-A x4 + ChatGPT Arch + Codex Plan APPROVED).
 * Grown incrementally across the PR's implementation steps. Step 4: me.ts identities DTO exposes the row id
 * (= stable credential_id used by self-reverify / dashboard actions; APIC-IDENTITY-1) without leaking provider_id.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { onRequestGet as meHandler } from '../../functions/api/auth/me'

beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

// regular access token for a user (mirrors the wallet-DTO pattern in credential-disposition.test.ts).
async function regularToken(userId: number, email: string): Promise<string> {
  return signJwt(
    { sub: String(userId), email, role: 'player', status: 'active', ver: 0, scope: 'read:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

async function seedIdentity(
  userId: number, provider: string, providerId: string,
  opts: { flagged?: boolean; reason?: string | null } = {},
): Promise<number> {
  await env.chiyigo_db
    .prepare(`INSERT INTO user_identities (user_id, provider, provider_id, requires_reverification, disposition_reason)
              VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, provider, providerId, opts.flagged ? 1 : 0, opts.reason ?? null)
    .run()
  const row = await env.chiyigo_db
    .prepare(`SELECT id FROM user_identities WHERE user_id=? AND provider=? AND provider_id=?`)
    .bind(userId, provider, providerId)
    .first()
  return Number(row?.id)
}

interface MeBody { identities: Array<Record<string, unknown>> }

async function callMe(token: string): Promise<{ status: number; body: MeBody }> {
  const resp = await meHandler({
    request: new Request('http://x/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
    env,
  })
  return { status: resp.status, body: (await resp.json()) as MeBody }
}

function firstIdentity(body: MeBody): Record<string, unknown> {
  const it0 = body.identities[0]
  if (!it0) throw new Error('expected at least one identity in /me DTO')
  return it0
}

describe('OD-3 step 4 — me.ts identities DTO credential_id exposure (APIC-IDENTITY-1)', () => {
  it('(1) identities DTO includes the row id (= stable credential_id for self-reverify)', async () => {
    const u = await seedUser({ email: 'id@x' })
    const idId = await seedIdentity(u.id, 'google', 'g-sub-1')
    const { status, body } = await callMe(await regularToken(u.id, 'id@x'))
    expect(status).toBe(200)
    expect(body.identities).toHaveLength(1)
    expect(firstIdentity(body).id).toBe(idId)
  })

  it('(2) flagged identity still surfaces requires_reverification + publicReasonCode (unknown_context -> needs_review)', async () => {
    const u = await seedUser({ email: 'fl@x' })
    await seedIdentity(u.id, 'discord', 'd-sub-1', { flagged: true, reason: 'unknown_context' })
    const it0 = firstIdentity((await callMe(await regularToken(u.id, 'fl@x'))).body)
    expect(it0.requires_reverification).toBe(true)
    expect(it0.disposition_reason).toBe('needs_review')   // publicReasonCode(1,'unknown_context'); raw never leaked
  })

  it('(3) does NOT expose provider_id / raw subject — only the existing public contract + id', async () => {
    const u = await seedUser({ email: 'pi@x' })
    await seedIdentity(u.id, 'google', 'SECRET-PROVIDER-ID-123')
    const it0 = firstIdentity((await callMe(await regularToken(u.id, 'pi@x'))).body)
    expect(it0).not.toHaveProperty('provider_id')
    expect(JSON.stringify(it0)).not.toContain('SECRET-PROVIDER-ID-123')
    expect(Object.keys(it0).sort()).toEqual(
      ['id', 'provider', 'display_name', 'avatar_url', 'linked_at', 'requires_reverification', 'disposition_reason'].sort(),
    )
  })

  it('(4) unflagged identity behavior unchanged (flag false, reason null, id numeric)', async () => {
    const u = await seedUser({ email: 'un@x' })
    await seedIdentity(u.id, 'line', 'l-sub-1')
    const it0 = firstIdentity((await callMe(await regularToken(u.id, 'un@x'))).body)
    expect(it0.requires_reverification).toBe(false)
    expect(it0.disposition_reason).toBe(null)             // publicReasonCode(0,...) = null
    expect(typeof it0.id).toBe('number')
  })
})
