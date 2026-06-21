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
    // full enforcement: EVERY agent() call must carry agentType:'readonly-reviewer' + a schema.
    // readonly-reviewer = global read-only agent with NO model pin -> inherits the session model
    // (verified loads in a fresh session 2026-06-21 as `readonly-reviewer · inherit`; see memory
    // feedback_selfreview_workflow_model_inheritance). Built-in 'Explore' is FORBIDDEN here: /agents
    // shows it pinned to haiku, which silently downgrades finders/verifiers off the session model.
    const nAgent = (src.match(/\bagent\s*\(/g) || []).length
    const nReviewer = (src.match(/agentType:\s*'readonly-reviewer'/g) || []).length
    const nSchema = (src.match(/\bschema:\s*[A-Za-z_{]/g) || []).length
    if (nAgent === 0) err(file, 'workflow entry has no agent() call')
    else if (nReviewer < nAgent || nSchema < nAgent) {
      err(file, `every agent() must use agentType:'readonly-reviewer' + schema (agent=${nAgent}, readonly-reviewer=${nReviewer}, schema=${nSchema})`)
    }
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
