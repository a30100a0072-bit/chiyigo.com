/**
 * Credential disposition (SEC-FACTOR-ADD ADD-A PR-A4).
 *
 * Plan: docs/audit/sec-factor-add-a4-disposition-plan.md (ChatGPT Arch Gate r2 + Codex Plan Gate APPROVED).
 *
 * Dispositions credentials (passkey / wallet / OAuth identity) added BEFORE the #78 factor-add gate
 * (prod deploy 2026-06-13T09:06:08Z). Before that gate, a stolen access token alone could add a login
 * factor; we cannot tell malicious adds from legitimate ones, so we inventory the window, classify each
 * credential into a risk tier, and record the disposition ON THE CREDENTIAL ROW (SSOT = credential row,
 * NOT elevation_grants.risk_reason which scopes one-time grant risk only).
 *
 * Tiers (OD-1=b):
 *   high            — add-time has an anomaly signal (new device / country jump / risk-blocked / burst).
 *   unknown_context — no add success audit near the anchor, or cannot attribute (ALL historical OAuth
 *                     identities — they have no add success event). Cannot be proven safe → flagged.
 *   low             — add success audit present + no anomaly.
 *
 * Disposition: high + unknown_context → requires_reverification=1 + per-row audit (+ notify for high only,
 * OD-4). low → disposition_at + summary count only. Active enforcement (block use until re-verified) is a
 * RESUME-LOCKED follow-up PR; PR-A4 only sets the passive flag (surfaced in list DTOs).
 *
 * Idempotency: runner only touches rows where disposition_at IS NULL (CAS), so a re-run skips already
 * dispositioned rows — no duplicate notify / audit. dry-run classifies + counts with ZERO side effects.
 */

import { safeUserAudit, hashIdentifierForAudit } from './user-audit'
import { sendCredentialReverificationEmail } from './email'

// #78 factor-add gate became effective at prod deploy 2026-06-13T09:06:08Z. Rounded UP conservatively so any
// credential added during edge propagation is still treated as window (reviewed). SQL-comparable UTC string.
export const WINDOW_END = '2026-06-13 09:10:00'

// classifyRisk anomaly correlation window (minutes around the credential anchor timestamp).
const ANOMALY_CORRELATION_WINDOW_MIN = 60
// "multiple factors added in a short window" signal.
const MULTI_FACTOR_BURST_N = 3
const MULTI_FACTOR_BURST_MIN = 30
// default per-call cap (runner is re-invokable until drained).
const DEFAULT_MAX_PER_RUN = 200

export type CredentialType = 'passkey' | 'wallet' | 'identity'
export type DispositionTier = 'high' | 'unknown_context' | 'low'

interface TableConfig {
  type: CredentialType
  table: string
  anchorCol: string                  // build-time column whose value == add moment
  addEvent: string | null            // add-success audit event_type, or null (identity has none historically)
}

// per-table config (Codex coding watch: passkey/identity=created_at, wallet=signed_at)
const TABLE_CONFIGS: TableConfig[] = [
  { type: 'passkey',  table: 'user_webauthn_credentials', anchorCol: 'created_at', addEvent: 'webauthn.register.success' },
  { type: 'wallet',   table: 'user_wallets',              anchorCol: 'signed_at',  addEvent: 'wallet.bind.success' },
  { type: 'identity', table: 'user_identities',           anchorCol: 'created_at', addEvent: null },
]

// anomaly audit event_types that, near a credential anchor, mark it high-risk (signals 1-3).
const ANOMALY_EVENTS = ['auth.new_device', 'auth.country_jump', 'auth.risk.blocked']
// every factor-add success event_type (cross-type) — used for the burst signal (6) which counts ANY factor
// added by the user near the anchor, not just the same type. (identity has no historical add event.)
const ADD_EVENTS = ['webauthn.register.success', 'wallet.bind.success']

interface PreloadedEvent { user_id: number; event_type: string; created_at: string }

interface CredentialRow { type: CredentialType; id: number; user_id: number; anchor: string }

/**
 * Pure risk classifier. Given a credential + the user's relevant audit events (preloaded), returns the tier.
 * No D1 access → unit/integration-testable in isolation.
 *
 * @param cred       the credential being classified (anchor = its build-time timestamp)
 * @param userEvents audit events for THIS user only (add-success + anomaly), already time-filtered to a
 *                   superset window. Each has event_type + created_at (UTC string, lexicographically ordered).
 * @param addEvent   the add-success event_type for this credential's type, or null (identity)
 */
export function classifyRisk(
  cred: CredentialRow,
  userEvents: PreloadedEvent[],
  addEvent: string | null,
): { tier: DispositionTier; reason: string } {
  const anchor = cred.anchor
  const within = (ts: string, minutes: number) => {
    // |ts - anchor| <= minutes, on UTC 'YYYY-MM-DD HH:MM:SS' strings via Date diff (anchor/ts are SQL UTC)
    const a = Date.parse(anchor.replace(' ', 'T') + 'Z')
    const t = Date.parse(ts.replace(' ', 'T') + 'Z')
    if (Number.isNaN(a) || Number.isNaN(t)) return false
    return Math.abs(t - a) <= minutes * 60_000
  }

  // identity (no historical add event) OR no add-success near the anchor → cannot attribute → unknown_context.
  const hasAddContext =
    addEvent != null &&
    userEvents.some(e => e.event_type === addEvent && within(e.created_at, 1))  // add stamp ~= anchor (<=1 min)
  if (!hasAddContext) {
    return { tier: 'unknown_context', reason: 'unknown_context' }
  }

  // signals 1-3: an anomaly event near the anchor.
  const anomaly = userEvents.find(e => ANOMALY_EVENTS.includes(e.event_type) && within(e.created_at, ANOMALY_CORRELATION_WINDOW_MIN))
  if (anomaly) {
    return { tier: 'high', reason: `high:${anomaly.event_type}` }
  }

  // signal 6: multiple factor-add successes (ANY type, cross-type) for this user in a short burst near anchor.
  const burst = userEvents.filter(e => ADD_EVENTS.includes(e.event_type) && within(e.created_at, MULTI_FACTOR_BURST_MIN)).length
  if (burst >= MULTI_FACTOR_BURST_N) {
    return { tier: 'high', reason: 'high:multi_factor_burst' }
  }

  return { tier: 'low', reason: 'low_reviewed' }
}

/**
 * Map an internal tier/reason to the MINIMIZED public reason code exposed in list DTOs (Codex coding watch:
 * never leak raw high:<signal> to users). high/unknown → a user-visible "needs re-verification" code; low → null.
 */
export function publicReasonCode(requiresReverification: number, reason: string | null): string | null {
  if (!requiresReverification) return null
  if (reason === 'unknown_context') return 'needs_review'
  return 'security_review'   // collapses every high:<signal> into one opaque public code
}

/**
 * Disposition tier of a flagged credential, derived from its disposition_reason. SSOT for the clear-audit
 * `credential_tier` field and the dynamic clear severity (cred-reverify plan Arch C3). The A4 runner only ever
 * writes `high:<signal>` / `unknown_context` onto flagged rows (`low_reviewed` never flags), but this is total
 * over any input — NULL / '' / malformed → 'unknown' (never throws).
 */
export function dispositionTierFromReason(reason: string | null): 'high' | 'unknown_context' | 'unknown' {
  if (typeof reason !== 'string') return 'unknown'
  if (reason.startsWith('high:')) return 'high'
  if (reason === 'unknown_context') return 'unknown_context'
  return 'unknown'
}

/**
 * Fail-closed whitelist gate for SELF-service reverification (cred-reverify plan Arch C2). ONLY a credential whose
 * disposition_reason is EXACTLY 'unknown_context' may be self-reverified; every other value — `high:<signal>`,
 * NULL, '', or any unknown/malformed tier — denies (high-risk credentials must be deleted or admin-cleared).
 * The /credential/reverify endpoint MUST decide via this single SSOT helper and MUST NOT inline-match
 * disposition_reason strings (deny-by-default at one site, so a future signal that forgets the `high:` prefix
 * can never silently become self-reverifiable).
 */
export function isSelfReverifyAllowed(reason: string | null): boolean {
  return reason === 'unknown_context'
}

interface RunOpts {
  dryRun: boolean
  types: CredentialType[]
  maxPerRun: number
  actorId: number
  request: Request
}

interface RunCounts {
  scanned: number
  dispositioned: number
  high: number
  unknown_context: number
  low: number
  notified: number
  failed: number
  remaining: number
}

/**
 * Disposition runner core. Processes up to maxPerRun undispositioned window credentials across the requested
 * types, classifies each, and (unless dryRun) writes the disposition via CAS + emits per-row audit (high/
 * unknown) + notifies (high). Returns count-only result. Re-invoke until remaining === 0.
 */
export async function runDisposition(env: Env, opts: RunOpts): Promise<RunCounts> {
  const { dryRun, types, actorId, request } = opts
  const maxPerRun = Number.isFinite(opts.maxPerRun) && opts.maxPerRun > 0 ? Math.min(opts.maxPerRun, 1000) : DEFAULT_MAX_PER_RUN
  const db = env.chiyigo_db
  const counts: RunCounts = { scanned: 0, dispositioned: 0, high: 0, unknown_context: 0, low: 0, notified: 0, failed: 0, remaining: 0 }

  let budget = maxPerRun
  for (const cfg of TABLE_CONFIGS) {
    if (!types.includes(cfg.type)) continue
    if (budget <= 0) break

    // window credentials not yet dispositioned (idempotent: disposition_at IS NULL)
    const rows = await db
      .prepare(
        `SELECT id, user_id, ${cfg.anchorCol} AS anchor FROM ${cfg.table}
          WHERE ${cfg.anchorCol} < ? AND disposition_at IS NULL
          ORDER BY id ASC LIMIT ?`,
      )
      .bind(WINDOW_END, budget)
      .all()
    const batch: CredentialRow[] = (rows.results ?? []).map((r: Record<string, unknown>) => ({
      type: cfg.type, id: Number(r.id), user_id: Number(r.user_id), anchor: String(r.anchor),
    }))
    if (batch.length === 0) continue
    counts.scanned += batch.length
    budget -= batch.length

    // per-user BATCH preload of relevant audit events (NO N+1): one query for the whole batch.
    const eventsByUser = await preloadAuditContext(env, batch)

    for (const cred of batch) {
      const { tier, reason } = classifyRisk(cred, eventsByUser.get(cred.user_id) ?? [], cfg.addEvent)
      counts[tier] += 1
      if (dryRun) continue

      const requiresReverif = tier === 'low' ? 0 : 1
      try {
        const upd = await db
          .prepare(
            `UPDATE ${cfg.table}
                SET requires_reverification = ?, disposition_reason = ?, disposition_at = datetime('now'), disposition_by = ?
              WHERE id = ? AND disposition_at IS NULL`,
          )
          .bind(requiresReverif, reason, `a4_runner:${actorId}`, cred.id)
          .run()
        if ((upd.meta?.changes ?? 0) !== 1) continue   // lost CAS race / already dispositioned
        counts.dispositioned += 1

        // per-row audit for high + unknown_context only (low → summary count). PII-safe: hashed id, no plaintext.
        if (tier !== 'low') {
          // notify high tier only (OD-4); safe-send (failure never aborts the run). capture outcome for the audit
          // so a failed notify is observable per-credential (the durable disposition flag is still written).
          let notifyOutcome = 'not_applicable'
          if (tier === 'high') {
            const ok = await notifyHigh(env, cred.user_id, cred.type)
            notifyOutcome = ok ? 'sent' : 'failed'
            if (ok) counts.notified += 1
          }
          const sig = await hashIdentifierForAudit(env, 'credential-disposition', `${cred.type}:${cred.id}`)
          await safeUserAudit(env, {
            event_type: 'account.credential.disposition',
            severity: tier === 'high' ? 'critical' : 'warn',
            user_id: cred.user_id,
            request,
            data: { credential_type: cred.type, tier, reason_code: publicReasonCode(1, reason), notify_outcome: notifyOutcome, id_hmac16: sig.hex.slice(0, 16), salted: sig.salted },
          })
        }
      } catch {
        counts.failed += 1
      }
    }
  }

  // remaining undispositioned window credentials (so the admin knows whether to re-invoke).
  counts.remaining = await countRemaining(env, types)
  return counts
}

/**
 * One query per batch (not per credential) preloading add-success + anomaly events for every user in the batch,
 * within a superset time range covering all anchors ± the widest correlation window. Returns user_id → events.
 * Uses json_each(?) so the IN-list does not explode bind params.
 */
async function preloadAuditContext(
  env: Env,
  batch: CredentialRow[],
): Promise<Map<number, PreloadedEvent[]>> {
  const userIds = [...new Set(batch.map(c => c.user_id))]
  const anchors = batch.map(c => Date.parse(c.anchor.replace(' ', 'T') + 'Z')).filter(n => !Number.isNaN(n))
  const out = new Map<number, PreloadedEvent[]>()
  if (userIds.length === 0 || anchors.length === 0) return out

  const pad = ANOMALY_CORRELATION_WINDOW_MIN * 60_000
  const toSql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
  const lo = toSql(Math.min(...anchors) - pad)
  const hi = toSql(Math.max(...anchors) + pad)

  const wantedEvents = [...ANOMALY_EVENTS, ...ADD_EVENTS]
  const res = await env.chiyigo_db
    .prepare(
      `SELECT user_id, event_type, created_at FROM audit_log
        WHERE user_id IN (SELECT value FROM json_each(?))
          AND event_type IN (SELECT value FROM json_each(?))
          AND created_at BETWEEN ? AND ?`,
    )
    .bind(JSON.stringify(userIds), JSON.stringify(wantedEvents), lo, hi)
    .all()
  for (const r of (res.results ?? []) as Record<string, unknown>[]) {
    const uid = Number(r.user_id)
    if (!out.has(uid)) out.set(uid, [])
    out.get(uid)!.push({ user_id: uid, event_type: String(r.event_type), created_at: String(r.created_at) })
  }
  return out
}

/** Send the high-risk re-verification email. PII-safe + best-effort: never throws, returns whether it sent. */
async function notifyHigh(env: Env, userId: number, credentialType: CredentialType): Promise<boolean> {
  try {
    if (!env.RESEND_API_KEY) return false
    const u = await env.chiyigo_db.prepare(`SELECT email FROM users WHERE id = ? AND deleted_at IS NULL`).bind(userId).first<{ email: string | null }>()
    const email = u?.email
    if (!email) return false
    await sendCredentialReverificationEmail(env.RESEND_API_KEY, email, { credentialType }, env)
    return true
  } catch {
    return false
  }
}

/** Count undispositioned window credentials remaining across the requested types (for the run response). */
async function countRemaining(env: Env, types: CredentialType[]): Promise<number> {
  let total = 0
  for (const cfg of TABLE_CONFIGS) {
    if (!types.includes(cfg.type)) continue
    const r = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM ${cfg.table} WHERE ${cfg.anchorCol} < ? AND disposition_at IS NULL`)
      .bind(WINDOW_END)
      .first<{ n: number }>()
    total += Number(r?.n ?? 0)
  }
  return total
}
