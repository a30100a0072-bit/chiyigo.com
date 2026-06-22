// scripts/lint-workflows.mjs
//
// v3 dimension-A workflow static gate (OD-A; enforces B2 / B3 / P1). Read-only; exit 1 on
// violation. Runs in the `npm run lint` chain (package.json) so CI's lint step covers it.
// This file is a Node tooling script (scripts/), NOT a workflow -- it may use Node APIs;
// the import-denylist below applies only to .claude/workflows/**.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
// SSOT for the expected GUARD / patterns / denylist + validators (self-check + drift-guard).
import {
  GUARD, SECRET_DENYLIST, isSafeReadPath, isSafeRef,
  REPO_PATH_PATTERN, REF_PATTERN, RESOLVED_SHA_PATTERN,
} from '../.claude/workflows/lib/schemas.mjs'

const WF_DIR = '.claude/workflows'
const errors = []
const err = (file, msg) => errors.push(`${file}: ${msg}`)

function listMjs(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listMjs(p))
    else if (name.endsWith('.mjs')) out.push(p)
  }
  return out
}

// Extract the balanced `export const meta = { ... }` block (brace-matched) for pure-literal checks.
function extractMetaBlock(src) {
  const m = src.match(/export const meta = \{/)
  if (!m) return null
  let depth = 0
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1) }
  }
  return null
}

// Strip JS line/block comments while PRESERVING string + template-literal content, so an
// `agentType: 'readonly-reviewer'` *value* is still counted but a doc-comment bearing the token
// cannot inflate the tallies (closes the count-masking gap; branch
// refactor/selfreview-workflow-readonly-reviewer, see memory feedback_selfreview_workflow_model_inheritance).
// Known limitation: a regex literal containing an unbalanced quote would desync the string tracker;
// no workflow entry uses one (the real entries passing is the live check). Belt-and-suspenders
// behind the agent-DEF validator further below, which is the robust guard.
function stripComments(code) {
  return code.replace(
    /("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|(`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_m, dq, sq, tpl) => dq || sq || tpl || '',
  )
}

// Per-entry agent() discipline. Returns a list of problems ([] = clean). Runs on the comment-
// stripped view: (1) forbids ANY agentType value other than 'readonly-reviewer' -- built-in
// 'Explore' (which /agents pins to haiku, silently downgrading finders/verifiers off the session
// model) and any other model-pinned / non-read-only type are rejected outright; (2) requires every
// agent() call to carry agentType:'readonly-reviewer' + a schema. LIMITATION (this gate is
// belt-and-suspenders): counts are string-level on the comment-stripped view, so comment-token
// masking is closed, but a token inside a STRING literal -- or an indirect (non-literal)
// `agentType: someVar` -- is NOT caught here. The agent-DEF validator below is the robust primary
// guard; per-call-site arg binding is the future hardening (tracked follow-up). The no-haiku
// invariant still holds regardless: a literal non-readonly agentType is forbidden, and an omitted
// agentType falls back to the session-model default (not haiku). Self-checked at end of file.
function entryAgentErrors(src) {
  const out = []
  const code = stripComments(src)
  const bad = [...new Set(code.match(/agentType:\s*'(?!readonly-reviewer')[^']*'/g) || [])]
  if (bad.length) out.push(`forbidden agentType (only 'readonly-reviewer' allowed): ${bad.join(', ')}`)
  const nAgent = (code.match(/\bagent\s*\(/g) || []).length
  const nReviewer = (code.match(/agentType:\s*'readonly-reviewer'/g) || []).length
  const nSchema = (code.match(/\bschema:\s*[A-Za-z_{]/g) || []).length
  if (nAgent === 0) out.push('workflow entry has no agent() call')
  else if (nReviewer < nAgent || nSchema < nAgent) {
    out.push(`every agent() must use agentType:'readonly-reviewer' + schema (agent=${nAgent}, readonly-reviewer=${nReviewer}, schema=${nSchema})`)
  }
  return out
}

const IMPORT_DENYLIST = [
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'child_process', 'node:child_process',
  'http', 'node:http', 'https', 'node:https', 'net', 'node:net', 'tls', 'node:tls', 'dns', 'node:dns',
]
const isWorkflowEntry = (p) => /(plan-self-review|code-self-review)\.mjs$/.test(p)

const files = listMjs(WF_DIR)
if (!files.some(isWorkflowEntry)) err(WF_DIR, 'no workflow entry (.mjs) found')

for (const file of files) {
  const src = readFileSync(file, 'utf8')

  // nondeterministic API (section 3.4) -- applies to every workflow .mjs incl. the lib

  if (/\bDate\.now\s*\(/.test(src)) err(file, 'forbidden Date.now()')
  if (/\bMath\.random\s*\(/.test(src)) err(file, 'forbidden Math.random()')
  if (/\bnew Date\s*\(\s*\)/.test(src)) err(file, 'forbidden argless new Date()')

  // import denylist (B2): workflow scripts must not import fs/child_process/network modules
  for (const m of src.matchAll(/import\b[^'"`]*from\s*['"]([^'"]+)['"]/g)) {
    if (IMPORT_DENYLIST.includes(m[1])) err(file, `forbidden import: ${m[1]}`)
  }

  // secret denylist as a READ TARGET = fail (section 8.1). A denylist literal appearing on the
  // SAME line as a Read/Grep/Glob/git read command is treated as a read target. The GUARD
  // forbid-declaration (schemas.mjs) lists denylist literals but NOT next to a read command, so
  // it is not flagged (required forbid-declaration, not a violation).
  for (const s of SECRET_DENYLIST) {
    const lit = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b(Read|Grep|Glob|git\\b[^\\n]*)[^\\n]*${lit}`)
    if (re.test(src)) err(file, `secret denylist literal "${s}" appears as a read target`)
  }

  if (isWorkflowEntry(file)) {
    // meta-first + pure-literal contract; the shared lib (schemas.mjs) has no meta.
    const meta = extractMetaBlock(src)
    if (!meta) {
      err(file, 'missing or unbalanced `export const meta = { ... }`')
    } else {
      if (!/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*export const meta = \{/.test(src)) {
        err(file, '`export const meta` must be the first statement (meta-first)')
      }
      if (/\.\.\./.test(meta) || /`|\$\{/.test(meta) || /\bfunction\b|=>/.test(meta) || /\brequire\s*\(/.test(meta)) {
        err(file, 'meta must be a pure literal (no spread / template / function / require)')
      }
    }
    if (!/\bGUARD\b/.test(src)) err(file, 'workflow entry must reference the injection GUARD (B2/AC6)')
    // Agent() discipline for this entry -- delegated to entryAgentErrors(): a comment-stripped count
    // (every agent() call carries agentType:'readonly-reviewer' + schema; doc-comment tokens can no
    // longer mask it) PLUS an explicit forbid of any non-'readonly-reviewer' agentType.
    // readonly-reviewer = repo-local read-only agent (.claude/agents/readonly-reviewer.md, tracked,
    // NO model pin -> inherits the session model; the agent-DEF validator below locks its shape and is
    // the robust primary guard). Built-in 'Explore' is the specific hazard: /agents pins it to haiku,
    // silently downgrading finders/verifiers off the session model.
    for (const e of entryAgentErrors(src)) err(file, e)
    // OD-D: Workflow runtime rejects static import -> entries must be self-contained (inline SSOT).
    if (/^\s*import\s[^\n]*\sfrom\s/m.test(src)) {
      err(file, 'workflow entry must NOT use static import (runtime rejects it; inline the SSOT -- OD-D)')
    }
    // drift-guard: the inlined SSOT must byte-match lib/schemas.mjs (normalize CRLF for compare).
    const norm = src.replace(/\r\n/g, '\n')
    if (!norm.includes(GUARD)) err(file, 'inlined GUARD drifted from lib SSOT')
    if (!norm.includes(REPO_PATH_PATTERN.source)) err(file, 'inlined REPO_PATH_PATTERN drifted from lib SSOT')
    for (const s of SECRET_DENYLIST) if (!norm.includes(`'${s}'`)) err(file, `inlined SECRET_DENYLIST missing '${s}'`)
  }
}

// code-self-review must carry ref validation + resolve + resolved-SHA collector (B3 / P1)
const codeSr = join(WF_DIR, 'code-self-review.mjs')
try {
  const src = readFileSync(codeSr, 'utf8')
  if (!/isSafeRef\s*\(/.test(src)) err(codeSr, 'missing isSafeRef ref validation (B3)')
  if (!/rev-parse --verify --quiet/.test(src)) err(codeSr, 'missing `git rev-parse --verify --quiet` resolve (P1)')
  if (!/RESOLVED_SHA_PATTERN/.test(src)) err(codeSr, 'missing resolved 40-hex SHA check (P1)')
  // collector must NOT build a diff range from raw refs (must use resolved SHAs)
  if (/\$\{a\.baseRef\}\s*\.\.\s*\$\{a\.headRef\}/.test(src) || /<baseRef>\.\.<headRef>/.test(src)) {
    err(codeSr, 'collector builds diff range from raw refs (P1: must use resolved SHA)')
  }
  // drift-guard: inlined ref validators must byte-match lib SSOT.
  if (!src.includes(REF_PATTERN.source)) err(codeSr, 'inlined REF_PATTERN drifted from lib SSOT')
  if (!src.includes(RESOLVED_SHA_PATTERN.source)) err(codeSr, 'inlined RESOLVED_SHA_PATTERN drifted from lib SSOT')
} catch {
  err(codeSr, 'code-self-review.mjs missing or unreadable')
}

// GUARD SSOT must still carry the required secret-denylist forbid-declaration (section 8.1)
if (!GUARD.includes('.env') || !GUARD.includes('.dev.vars') || !GUARD.includes('.canary-')) {
  err('lib/schemas.mjs', 'GUARD missing required secret-denylist forbid-declaration (section 8.1)')
}

// The readonly-reviewer agent DEFINITION must be repo-local + minimally/correctly configured. Without
// this the "no haiku downgrade" invariant is only string-deep: a fresh clone has no agent (runtime
// `agent type not found`), or a drifted global agent (gaining `model: haiku`, wrong tools) silently
// re-breaks it. Lock it mechanically (Codex Code Gate 2026-06-21).
const AGENT_PATH = '.claude/agents/readonly-reviewer.md'
try {
  const fm = readFileSync(AGENT_PATH, 'utf8').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)
  if (!fm) {
    err(AGENT_PATH, 'missing YAML frontmatter')
  } else {
    const body = fm[1]
    const keys = [...body.matchAll(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/gm)].map((m) => m[1])
    const ALLOWED_KEYS = ['name', 'description', 'tools']
    for (const k of keys) if (!ALLOWED_KEYS.includes(k)) err(AGENT_PATH, `unexpected frontmatter key '${k}' (allowed: ${ALLOWED_KEYS.join('/')})`)
    if (keys.includes('model')) err(AGENT_PATH, 'MUST NOT set `model:` (a pin would defeat session-model inheritance)')
    if (!/^name:\s*readonly-reviewer\s*$/m.test(body)) err(AGENT_PATH, "name must be exactly 'readonly-reviewer'")
    const toolsM = body.match(/^tools:\s*(.+?)\s*$/m)
    const tools = toolsM ? toolsM[1].split(',').map((s) => s.trim()).filter(Boolean).sort() : []
    const EXPECTED_TOOLS = ['Bash', 'Glob', 'Grep', 'Read']
    if (JSON.stringify(tools) !== JSON.stringify(EXPECTED_TOOLS)) {
      err(AGENT_PATH, `tools must be exactly Read/Grep/Glob/Bash (got: [${tools.join(', ')}])`)
    }
  }
} catch (e) {
  err(AGENT_PATH, `repo-local agent definition missing/unreadable (committed workflows depend on it at runtime): ${e.message}`)
}

// self-check: the entry agent() gate MUST flag a comment-masked forbidden agentType and MUST pass a
// clean entry. Locks the count-masking fix -- pre-fix the masked fixture PASSED (the old gate counted
// comment tokens too; branch refactor/selfreview-workflow-readonly-reviewer, Codex Code Gate 2026-06-22).
const SC_MASKED = [
  "await agent(p1, { agentType: 'Explore', schema: S1 })",
  "await agent(p2, { agentType: 'readonly-reviewer', schema: S2 })",
  "// agentType: 'readonly-reviewer' -- masking doc-comment must NOT launder the Explore call",
].join('\n')
const SC_CLEAN = [
  "await agent(p1, { agentType: 'readonly-reviewer', schema: S1 })",
  "await agent(p2, { agentType: 'readonly-reviewer', schema: S2 })",
].join('\n')
if (entryAgentErrors(SC_MASKED).length === 0) err('lint-workflows self-check', 'entryAgentErrors must flag a comment-masked forbidden agentType')
if (entryAgentErrors(SC_CLEAN).length !== 0) err('lint-workflows self-check', `entryAgentErrors must accept a clean entry (got: ${entryAgentErrors(SC_CLEAN).join('; ')})`)

// validator self-check (section 8 layer 2; P1): known-bad inputs MUST be rejected, good ones accepted.
const BAD_PATHS = ['foo;git status', 'foo|git status', 'a&b', 'a b', 'foo\nbar', '/etc/passwd', '../x', '..\\x', '~/x', 'C:\\x', '\\\\srv\\share', 'file:x', '.dev.vars', 'x.env', 'a$(b)', 'a`b`', "a'b", 'a"b', 'a{b}', 'a<b']
for (const bp of BAD_PATHS) if (isSafeReadPath(bp)) err('schemas.mjs', `isSafeReadPath must reject: ${JSON.stringify(bp)}`)
const GOOD_PATHS = ['docs/reviews/x.md', '.gitignore', 'scripts/lint-workflows.mjs', 'a/b/c.mjs', '.claude/workflows/lib/schemas.mjs']
for (const gp of GOOD_PATHS) if (!isSafeReadPath(gp)) err('schemas.mjs', `isSafeReadPath must accept: ${JSON.stringify(gp)}`)
const BAD_REFS = ['--show-toplevel', '-x', 'a..b', 'a b', 'a;b', 'a|b', 'a\nb', '']
for (const br of BAD_REFS) if (isSafeRef(br)) err('schemas.mjs', `isSafeRef must reject: ${JSON.stringify(br)}`)
const GOOD_REFS = ['main', 'HEAD', '7da1f9c0', 'feat/x', 'origin/main', '@']
for (const gr of GOOD_REFS) if (!isSafeRef(gr)) err('schemas.mjs', `isSafeRef must accept: ${JSON.stringify(gr)}`)

if (errors.length) {
  console.error('[lint-workflows] FAIL:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log(`[lint-workflows] OK (${files.length} workflow .mjs checked)`)
