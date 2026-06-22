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

// Strip JS line/block comments while PRESERVING string + template-literal content (so an
// `agentType: 'readonly-reviewer'` value stays visible while a doc-comment bearing the token cannot
// interfere). Feeds the per-call-site scanner below a comment-free view. Known limitation: a regex
// literal containing an unbalanced quote would desync the string tracker -- but that fails CLOSED
// (it over-rejects: the following agent() call is missed and the entry is flagged "no agent() call",
// never laundered). No workflow entry uses such a regex (the real entries passing is the live check).
function stripComments(code) {
  return code.replace(
    /("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|(`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_m, dq, sq, tpl) => dq || sq || tpl || '',
  )
}

// --- per-call-site agent() options binding (C; replaces the maskable file-wide count) ---
// A file-wide token count is bypassable: an indirect `agentType: someVar` (-> 'Explore' -> haiku)
// escapes a literal-value forbid, while a string-literal token satisfies the count -- F1+F2 compose
// into a real no-haiku bypass (Codex Plan Gate REJECT 2026-06-22). So instead of counting, we ISOLATE
// each agent() call and require THAT call's own options object to carry a LITERAL
// agentType:'readonly-reviewer' + a schema. Minimal hand-rolled scanner (no parser dependency, no
// general AST): track string/template literals + bracket depth only. Self-checked at end of file.

// From a quote char at s[i], return the index of its matching close quote -- honoring \-escapes and,
// for templates, ${ ... } interpolation (which may nest braces/strings).
function skipString(s, i) {
  const q = s[i]
  i++
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') { i += 2; continue }
    if (q === '`' && c === '$' && s[i + 1] === '{') {
      i += 2
      let d = 1
      while (i < s.length && d > 0) {
        const cc = s[i]
        if (cc === '\\') { i += 2; continue }
        if (cc === "'" || cc === '"' || cc === '`') { i = skipString(s, i) + 1; continue }
        if (cc === '{') d++
        else if (cc === '}') d--
        i++
      }
      continue
    }
    if (c === q) return i
    i++
  }
  return s.length - 1
}

// Index of the delimiter matching the opener at s[open] ('(' '{' '['), skipping strings; -1 if none.
function matchSpan(s, open) {
  const close = { '(': ')', '{': '}', '[': ']' }[s[open]]
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(s, i); continue }
    if (c === s[open]) depth++
    else if (c === close) { depth--; if (depth === 0) return i }
  }
  return -1
}

// Split the inner text of an object / arg list on TOP-LEVEL commas (skip strings + nested brackets).
function splitTopLevel(inner) {
  const out = []
  let depth = 0, start = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(inner, i); continue }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (c === ',' && depth === 0) { out.push(inner.slice(start, i)); start = i + 1 }
  }
  if (inner.slice(start).trim()) out.push(inner.slice(start))
  return out
}

// Parse one options object literal `{ ... }` into { agentType, hasSchema, hasSpread, hasComputedKey }.
// agentType is the RAW value token of the agentType key (null if absent). A top-level spread (`...x`)
// or a computed key (`[...]:`) is reported because either could override / alias agentType at runtime.
function readOptions(objText) {
  const inner = objText.slice(1, -1)
  let agentType = null, hasSchema = false, hasSpread = false, hasComputedKey = false
  for (const seg of splitTopLevel(inner)) {
    if (seg.trim().startsWith('...')) { hasSpread = true; continue }
    let depth = 0, colon = -1
    for (let i = 0; i < seg.length; i++) {
      const c = seg[i]
      if (c === "'" || c === '"' || c === '`') { i = skipString(seg, i); continue }
      if (c === '(' || c === '{' || c === '[') depth++
      else if (c === ')' || c === '}' || c === ']') depth--
      else if (c === ':' && depth === 0) { colon = i; break }
    }
    if (colon < 0) continue
    const rawKey = seg.slice(0, colon).trim()
    // A computed key (`['agentType']: ...`) could alias agentType to a non-readonly value at runtime
    // while a static `agentType: 'readonly-reviewer'` reads clean -- reject rather than try to resolve.
    if (rawKey.startsWith('[')) { hasComputedKey = true; continue }
    const key = rawKey.replace(/^['"`]|['"`]$/g, '')
    const val = seg.slice(colon + 1).trim()
    if (key === 'agentType') agentType = val
    else if (key === 'schema') hasSchema = true
  }
  return { agentType, hasSchema, hasSpread, hasComputedKey }
}

// Validate EVERY agent() call in a workflow entry by binding each call to its own options object.
// Returns problems ([] = clean). The no-haiku invariant is enforced here: a call cannot pass unless
// its inline options literally select 'readonly-reviewer' (which the agent-DEF validator proves has
// no model pin). Note: this enforces *which agent is selected*, not read-only itself -- readonly-
// reviewer holds Bash, so its read-only posture is best-effort (prompt-enforced), not a sandbox.
function entryAgentErrors(src) {
  const out = []
  const code = stripComments(src)
  let n = 0
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(code, i); continue }
    if (!code.startsWith('agent', i)) continue
    if (i > 0 && /[A-Za-z0-9_$]/.test(code[i - 1])) continue // word boundary (skip e.g. subagent)
    const head = /^agent(\s*)\(/.exec(code.slice(i))
    if (!head) continue
    n++
    const openParen = i + head[0].length - 1
    const closeParen = matchSpan(code, openParen)
    if (closeParen < 0) { out.push(`agent() call #${n}: unbalanced parentheses`); continue }
    const argText = code.slice(openParen + 1, closeParen)
    // Bind to the 2nd POSITIONAL argument -- the runtime contract is agent(prompt, options). Picking
    // "the first { anywhere in the args" would let a decoy options literal sit in the prompt (arg #1)
    // or a 3rd-arg position and launder a variable/Explore real 2nd arg (F-1). Require exactly 2 args
    // and an inline object literal as arg #2.
    const callArgs = splitTopLevel(argText)
    if (callArgs.length !== 2) {
      out.push(`agent() call #${n}: must be agent(prompt, { agentType: 'readonly-reviewer', schema: ... }) -- got ${callArgs.length} arg(s)`)
      continue
    }
    const optText = callArgs[1].trim()
    // arg #2 must be a SINGLE balanced object literal -- not an expression that merely begins and ends
    // with braces (e.g. `{readonly} && {Explore}` returns the Explore object at runtime; F-2). The
    // matching brace of the leading `{` must be the final char.
    if (!optText.startsWith('{') || matchSpan(optText, 0) !== optText.length - 1) {
      out.push(`agent() call #${n}: 2nd argument must be a single inline object literal (not a variable/expression)`)
      continue
    }
    const { agentType, hasSchema, hasSpread, hasComputedKey } = readOptions(optText)
    // Byte-exact single-quoted literal only (fail-closed): a double-quoted / backtick / escaped value
    // would resolve to readonly-reviewer at runtime but is still rejected -- the sanctioned form is the
    // single-quoted literal the real entries use; over-rejection is the safe direction here.
    if (agentType !== "'readonly-reviewer'") {
      out.push(`agent() call #${n}: agentType must be the literal 'readonly-reviewer' (got: ${agentType === null ? 'absent' : agentType})`)
    }
    if (hasComputedKey) out.push(`agent() call #${n}: computed keys are not allowed in options (could alias agentType)`)
    if (hasSpread) out.push(`agent() call #${n}: spread in options is not allowed (could override agentType)`)
    if (!hasSchema) out.push(`agent() call #${n}: options must include a schema`)
  }
  if (n === 0) out.push('workflow entry has no agent() call')
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
    // Agent() discipline -- delegated to entryAgentErrors(): per-call-site binding. Each call must be
    // agent(prompt, options) where options is a SINGLE inline object literal whose agentType is the
    // LITERAL 'readonly-reviewer' (+ a schema). Rejected: a variable/expression/decoy-position 2nd arg,
    // a non-readonly or indirect agentType, spread, computed keys, string/comment padding -- so the
    // textually-checked agent equals the runtime-selected agent. This binds the no-haiku invariant per
    // call (the agent-DEF validator below proves readonly-reviewer carries no model pin). 'Explore' is
    // the hazard: /agents pins it to haiku. NB: read-only ITSELF is not mechanically enforced --
    // readonly-reviewer holds Bash, so its read-only posture is best-effort (prompt-enforced), not a sandbox.
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

// self-check (locks the C fix): per-call-site binding MUST reject indirect/absent/forbidden agentType,
// string/comment padding, and spread, and MUST accept clean entries. Pre-fix the file-wide count
// laundered the indirect+padding case (Codex Plan Gate REJECT 2026-06-22 repro). [name, src, expectFlagged]
const SELF_CHECKS = [
  ['clean', `await agent(p1, { agentType: 'readonly-reviewer', schema: S1 })\nawait agent(p2, { agentType: 'readonly-reviewer', phase: 'Find', label: \`x:\${d}\`, schema: S2 })`, false],
  ['literal-Explore', `await agent(p, { agentType: 'Explore', schema: S })`, true],
  ['comment-masked-Explore', `await agent(p1, { agentType: 'Explore', schema: S1 })\n// agentType: 'readonly-reviewer'`, true],
  ['indirect-agentType+note-string', `const _t = 'Explore'\nawait agent(p, { agentType: _t, note: "agentType: 'readonly-reviewer'", schema: S })`, true],
  ['indirect+separate-pad-string', `const _t = 'Explore'\nawait agent(p, { agentType: _t, schema: S })\nconst _pad = "agentType: 'readonly-reviewer'"`, true],
  ['absent-agentType', `await agent(p, { schema: S })`, true],
  ['missing-schema', `await agent(p, { agentType: 'readonly-reviewer' })`, true],
  ['spread-options', `await agent(p, { agentType: 'readonly-reviewer', schema: S, ...override })`, true],
  ['decoy-options-3rd-arg', `await agent(prompt, runtimeOpts, { agentType: 'readonly-reviewer', schema: S })`, true],
  ['object-in-prompt-position', `await agent({ agentType: 'readonly-reviewer', schema: S }, optsVar)`, true],
  ['expression-2nd-arg-&&', `await agent(p, { agentType: 'readonly-reviewer', schema: S } && { agentType: 'Explore', schema: S })`, true],
  ['computed-key-alias', `await agent(p, { agentType: 'readonly-reviewer', ['agentType']: 'Explore', schema: S })`, true],
  ['no-options-arg', `await agent(prompt)`, true],
  ['no-agent-call', `const x = 1`, true],
]
for (const [name, sample, expectFlagged] of SELF_CHECKS) {
  const flagged = entryAgentErrors(sample).length > 0
  if (flagged !== expectFlagged) {
    err('lint-workflows self-check', `entryAgentErrors[${name}] expected ${expectFlagged ? 'FLAGGED' : 'clean'}, got ${flagged ? 'FLAGGED' : 'clean'} (${JSON.stringify(entryAgentErrors(sample))})`)
  }
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
