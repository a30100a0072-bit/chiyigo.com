export const meta = {
  name: 'plan-self-review',
  description: 'v3 dimension-A plan self-review: 7 finders adversarially tear an approved-pending plan',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

// OD-D: import the shared SSOT. Workflow-runtime relative import is UNVERIFIED until the
// owner-monitored dry-run (plan section 8 layer 3). If unsupported, the approved OD-D
// fallback inlines these and lint-workflows asserts the inlined copy matches the SSOT.
import { FINDING_SCHEMA, FINDINGS_RESULT_SCHEMA, GUARD, isSafeReadPath } from './lib/schemas.mjs'

// args.planDocPath is a read target -> repo-relative, no '..', no secret-denylist hit (section 5.2).
const planDocPath = args && args.planDocPath
if (typeof planDocPath !== 'string' || !isSafeReadPath(planDocPath)) {
  throw new Error(`plan-self-review: args.planDocPath invalid/unsafe: ${JSON.stringify(planDocPath)}`)
}

// 7 dimensions = v3 section-5 Plan checklist; one finder per dimension (no homogeneous agents).
const DIMENSIONS = [
  { key: 'security-boundary', focus: 'auth gates, RBAC, secure/deny-by-default, boundary input validation' },
  { key: 'tenant-scope', focus: 'every data op carries tenant scope; no bare query missing WHERE tenant_id' },
  { key: 'migration', focus: 'up/down round-trip; expand-migrate-contract; rollback safety' },
  { key: 'api-contract-enum', focus: 'API/schema contract; enum change = breaking; explicit version field' },
  { key: 'high-risk-state-idempotency', focus: 'state machine, idempotency key, retry+timeout, failure modes (queue/payment/txn/distributed)' },
  { key: 'naming-ssot', focus: 'same concept = same string across layers; no alias' },
  { key: 'spec-scope', focus: 'within SPEC_APPROVED scope; no Non-goals touched; every Acceptance Criterion has a plan item' },
]

function finderPrompt(dim, path) {
  return `${GUARD}

You are a plan self-review FINDER for the "${dim.key}" dimension only.
Read the approved-pending plan doc at the repo-relative path: ${path}
Focus: ${dim.focus}

Find concrete completeness/correctness gaps in the PLAN (not runtime bugs) on this dimension only.
Each finding needs: concrete evidence_path + ref (section/line), a concrete mechanism (no vague
speculation), a recommendation, severity (tier0..tier3), status:'candidate'.
Return a FINDINGS_RESULT for dimension "${dim.key}" (empty findings array if none).`
}

function verifyPrompt(f) {
  return `${GUARD}

You are an ADVERSARIAL VERIFIER. DEFAULT TO refuted.
A finder produced this candidate finding about a plan:
${JSON.stringify(f)}

Re-read the cited evidence_path + ref in the plan and TRY TO REFUTE it. Only set status:'accepted'
if the gap is real and concretely evidenced; otherwise status:'refuted'. Fill verdict_note with the
rationale. Return the single updated FINDING.`
}

// pipeline: each dimension's findings verify as soon as that finder returns (no barrier).
const reviews = await pipeline(
  DIMENSIONS,
  (d) => agent(finderPrompt(d, planDocPath), {
    agentType: 'Explore', phase: 'Find', label: `find:${d.key}`, schema: FINDINGS_RESULT_SCHEMA,
  }),
  (review) => {
    if (!review || !Array.isArray(review.findings) || review.findings.length === 0) return review
    return parallel(review.findings.map((f) => () =>
      agent(verifyPrompt(f), {
        agentType: 'Explore', phase: 'Verify', label: `verify:${review.dimension}`, schema: FINDING_SCHEMA,
      }).then((v) => v || { ...f, status: 'refuted', verdict_note: 'verifier returned null' })
    )).then((verified) => ({ dimension: review.dimension, findings: verified.filter(Boolean) }))
  }
)

// section 3.5: emit machine-readable JSON to task output; main thread parses, reads the real
// plan, and adjudicates independently (raw output is NOT the conclusion -- v3 section 5).
const dims = (reviews || []).filter(Boolean)
const findings = dims.flatMap((r) => (r.findings || []))
const acceptedCount = findings.filter((f) => f && f.status === 'accepted').length
const suspiciousCount = findings.filter((f) => f && f.status === 'suspicious_input').length
const result = { planDocPath, dimensions: dims, accepted_count: acceptedCount, suspicious_input_count: suspiciousCount }
log('=== PLAN-SELF-REVIEW RESULT (JSON) ===')
log(JSON.stringify(result, null, 2))
log('=== 中文摘要 ===')
log(`plan-self-review：${dims.length} 維、accepted ${acceptedCount}、suspicious_input ${suspiciousCount}。主線須獨立讀 plan 裁決，不直接採此 raw 輸出。`)
return result
