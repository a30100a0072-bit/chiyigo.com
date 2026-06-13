export const meta = {
  name: 'code-self-review',
  description: 'v3 dimension-A code self-review + emits the section-6 ChatGPT faithfulness package',
  phases: [{ title: 'Artifacts' }, { title: 'Find' }, { title: 'Verify' }, { title: 'Package' }],
}

// OD-D import (UNVERIFIED at workflow runtime until dry-run; fallback = inline; see plan section 8).
import {
  FINDING_SCHEMA, FINDINGS_RESULT_SCHEMA, GUARD,
  isSafeRef, isSafeReadPath, RESOLVED_SHA_PATTERN,
} from './lib/schemas.mjs'

// ---- args + validation (section 5.2; B3 / P1) ----
const a = args || {}
function bad(msg) { throw new Error(`code-self-review: ${msg}`) }
if (!isSafeRef(a.baseRef)) bad(`baseRef unsafe (first char must not be '-', no '..'): ${JSON.stringify(a.baseRef)}`)
if (!isSafeRef(a.headRef)) bad(`headRef unsafe: ${JSON.stringify(a.headRef)}`)
if (!isSafeReadPath(a.planDocPath)) bad(`planDocPath unsafe: ${JSON.stringify(a.planDocPath)}`)
for (const dp of (Array.isArray(a.decisionPoints) ? a.decisionPoints : [])) {
  if (!dp || !isSafeReadPath(dp.file)) bad(`decisionPoints.file unsafe: ${JSON.stringify(dp)}`)
}
if (!/^[0-9a-f]{7,40}$/.test(String(a.archApprovedSha || ''))) bad('archApprovedSha must be 7-40 hex')
if (!/^[0-9a-f]{7,40}$/.test(String(a.planApprovedSha || ''))) bad('planApprovedSha must be 7-40 hex')

// ---- Artifacts: resolve refs to 40-hex commits, then diff on RESOLVED SHAs only (section 5.4; P1) ----
phase('Artifacts')
const ARTIFACTS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['base_sha', 'reviewed_sha', 'name_status', 'stat', 'changed_files'],
  properties: {
    base_sha: { type: 'string' }, reviewed_sha: { type: 'string' },
    name_status: { type: 'string' }, stat: { type: 'string' },
    changed_files: { type: 'array', items: { type: 'string' } },
  },
}
const artifacts = await agent(`${GUARD}

You are a READ-ONLY git collector. Run ONLY these fixed steps; no other command, no write op, no network.
Step 1 -- resolve each ref to a single commit SHA (reject if not exactly one 40-hex commit):
    git rev-parse --verify --quiet "${a.baseRef}^{commit}"
    git rev-parse --verify --quiet "${a.headRef}^{commit}"
  Call the outputs BASE_SHA and HEAD_SHA. If either is empty or not 40-hex, STOP and report an error.
Step 2 -- using ONLY the resolved SHAs (never the raw refs), run:
    git diff --name-status BASE_SHA..HEAD_SHA
    git diff --stat BASE_SHA..HEAD_SHA
Return base_sha=BASE_SHA, reviewed_sha=HEAD_SHA, name_status, stat, and the changed-file list.`,
  { agentType: 'Explore', phase: 'Artifacts', label: 'git-artifacts', schema: ARTIFACTS_SCHEMA })

if (!artifacts ||
  !RESOLVED_SHA_PATTERN.test(String(artifacts.base_sha || '')) ||
  !RESOLVED_SHA_PATTERN.test(String(artifacts.reviewed_sha || ''))) {
  bad(`collector did not return resolved 40-hex SHAs: ${JSON.stringify(artifacts)}`)
}

// ---- semantic-dimension finders (section 5.3) ----
const DIMENSIONS = [
  { key: 'race', focus: 'races, CAS gaps, TOCTOU' },
  { key: 'idempotency', focus: 'idempotency keys, replay safety' },
  { key: 'tenant-bare-query', focus: 'bare query missing tenant scope' },
  { key: 'async-boundary', focus: 'every external call has error handling + timeout + retry; resource release' },
  { key: 'contract-enum', focus: 'contract / enum breaking changes' },
  { key: 'naming-ssot', focus: 'same concept = same string; no alias' },
  { key: 'regression-lock', focus: 'bug-fix regression tests truly lock the exact failure (red pre-fix)' },
]
function finderPrompt(dim) {
  return `${GUARD}

You are a code self-review FINDER for "${dim.key}". Focus: ${dim.focus}.
Review the changed code between ${artifacts.base_sha}..${artifacts.reviewed_sha} (read those files read-only).
Report concrete findings: evidence_path + ref + mechanism + recommendation + severity + status:'candidate'.
Return a FINDINGS_RESULT for "${dim.key}".`
}
function verifyPrompt(f) {
  return `${GUARD}

ADVERSARIAL VERIFIER, DEFAULT refuted. Candidate:
${JSON.stringify(f)}
Re-read the cited code; accept only if real + concretely evidenced; else refuted. Fill verdict_note.
Return the single updated FINDING.`
}
const reviews = await pipeline(
  DIMENSIONS,
  (d) => agent(finderPrompt(d), { agentType: 'Explore', phase: 'Find', label: `find:${d.key}`, schema: FINDINGS_RESULT_SCHEMA }),
  (review) => {
    if (!review || !Array.isArray(review.findings) || review.findings.length === 0) return review
    return parallel(review.findings.map((f) => () =>
      agent(verifyPrompt(f), { agentType: 'Explore', phase: 'Verify', label: `verify:${review.dimension}`, schema: FINDING_SCHEMA })
        .then((v) => v || { ...f, status: 'refuted', verdict_note: 'verifier returned null' })
    )).then((verified) => ({ dimension: review.dimension, findings: verified.filter(Boolean) }))
  }
)

// ---- Package: section-6 faithfulness package (AC4) ----
phase('Package')
const dimensionAFindings = (reviews || []).filter(Boolean).flatMap((r) => (r.findings || []))
const suspiciousCount = dimensionAFindings.filter((f) => f && f.status === 'suspicious_input').length
const reviewPackage = {
  anchor: {
    plan_doc_path: a.planDocPath,
    arch_approved_sha: a.archApprovedSha,
    plan_approved_sha: a.planApprovedSha,
    od_rulings: Array.isArray(a.odRulings) ? a.odRulings : [],
  },
  git_artifacts: {
    reviewed_sha: artifacts.reviewed_sha,
    name_status: artifacts.name_status,
    stat: artifacts.stat,
    changed_files: artifacts.changed_files,
  },
  // main thread fills these from the plan before sending to ChatGPT faithfulness:
  scope_mapping: [],
  decision_hunks: [], // OD-E: config-change hunks for this PR; runtime PRs add security/state hunks
  deviations: [],
  dimension_a_findings: dimensionAFindings,
  questions: [
    'Does the implementation betray the approved architecture / OD rulings / smuggle scope creep?',
    'B MUST cross-check git_artifacts.name_status and name any changed file lacking a hunk.',
  ],
}
log('=== CODE-SELF-REVIEW + FAITHFULNESS PACKAGE (JSON) ===')
log(JSON.stringify(reviewPackage, null, 2))
log('=== 中文摘要 ===')
log(`code-self-review：dimension-A findings ${dimensionAFindings.length}（suspicious_input ${suspiciousCount}）、reviewed_sha=${artifacts.reviewed_sha}。主線須獨立讀真碼裁決，並補 scope_mapping/decision_hunks/deviations 後送 ChatGPT faithfulness。`)
return reviewPackage
