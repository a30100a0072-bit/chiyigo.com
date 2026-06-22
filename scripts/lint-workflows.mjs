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
// AST parser for the agent() invocation validator (owner ruling A' 2026-06-22). Uses the repo's
// existing `typescript` devDependency -- NO new dependency. lint-workflows.mjs is a Node tooling
// script, so importing a dev dependency here is fine (the import-denylist applies to entries only).
import ts from 'typescript'

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

// --- agent() invocation validator (C; AST-based -- owner ruling A' 2026-06-22) ---
// The earlier hand-rolled textual scanner leaked twice (indirect agentType, then aliasing
// `const x = agent`), so validation uses the TypeScript AST. The injected `agent` binding may appear
// ONLY as the callee of a direct, non-optional call `agent(prompt, { ...options })`. Every other
// reference (alias, pass-as-value, `.bind`, optional call `agent?.()`, member `obj.agent`, computed
// `x['agent']`), any SHADOWING of the name `agent` (declaration / param / import / destructure), and
// `eval` / `Function` (including the parenthesized direct-eval form `(eval)(...)`) are rejected; a
// syntactically unparseable entry is also flagged (fail loud). The 2nd arg must be a single inline
// object literal whose `agentType` is the string literal 'readonly-reviewer' (non-computed key, no duplicate) plus a
// `schema`. Comments are AST trivia and string contents are StringLiteral nodes, so comment- and
// string-token masking are inherently impossible. AST-enforced for statically analyzable committed
// entries that pass the mandatory lint:workflows path; not a platform sandbox. read-only stays
// best-effort (readonly-reviewer holds Bash). Self-checked at end of file.
function entryAgentErrors(src) {
  const out = []
  const sf = ts.createSourceFile('entry.mjs', src, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.JS)
  const loc = (node) => `L${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
  const push = (node, msg) => out.push(`${loc(node)}: ${msg}`)
  const isAgent = (n) => !!n && ts.isIdentifier(n) && n.text === 'agent'
  const isNamed = (n, name) => !!n && ts.isIdentifier(n) && n.text === name
  const okCallees = new Set() // `agent` identifiers that ARE a valid direct-call callee
  let callCount = 0

  // `id` is the declared NAME of a binding -> shadows the injected `agent`
  function isShadowDecl(id) {
    const p = id.parent
    if (!p) return false
    if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) ||
         ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) ||
         ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportSpecifier(p)) && p.name === id) return true
    if (ts.isCatchClause(p) && p.variableDeclaration && p.variableDeclaration.name === id) return true
    return false
  }

  // validate the 2nd positional argument of a direct agent(...) call (A'-6/7/8 + schema)
  function validateCall(call) {
    callCount++
    const args = call.arguments
    if (args.length !== 2) { push(call, `agent() must be agent(prompt, { agentType: 'readonly-reviewer', schema }) -- got ${args.length} arg(s)`); return }
    const opt = args[1]
    if (!ts.isObjectLiteralExpression(opt)) { push(call, `agent() 2nd argument must be a single inline object literal (not a variable/expression)`); return }
    let agentTypeCount = 0, agentTypeOk = false, hasSchema = false
    for (const prop of opt.properties) {
      if (ts.isSpreadAssignment(prop)) { push(prop, `agent() options: spread is not allowed (could override agentType)`); continue }
      const nameNode = prop.name
      if (nameNode && ts.isComputedPropertyName(nameNode)) { push(prop, `agent() options: computed keys are not allowed`); continue }
      const keyText = nameNode && (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) ? nameNode.text : null
      if (keyText === 'agentType') {
        agentTypeCount++
        const val = ts.isPropertyAssignment(prop) ? prop.initializer : null
        if (val && ts.isStringLiteral(val) && val.text === 'readonly-reviewer') agentTypeOk = true
      } else if (keyText === 'schema') {
        hasSchema = true
      }
    }
    if (agentTypeCount === 0) push(opt, `agent() options must set agentType: 'readonly-reviewer'`)
    else if (agentTypeCount > 1) push(opt, `agent() options: duplicate agentType is not allowed`)
    else if (!agentTypeOk) push(opt, `agent() options: agentType must be the string literal 'readonly-reviewer'`)
    if (!hasSchema) push(opt, `agent() options must include a schema`)
  }

  function visit(node) {
    if (isAgent(node) && isShadowDecl(node)) push(node, `'agent' must not be shadowed (declaration / parameter / import / destructure named 'agent')`)
    // unwrap parens: `(eval)(...)` is still a direct eval (retains lexical scope) -- skipParentheses
    // so the parenthesized form cannot evade the eval/Function check (F1).
    if (ts.isCallExpression(node) && (isNamed(ts.skipParentheses(node.expression), 'eval') || isNamed(ts.skipParentheses(node.expression), 'Function'))) push(node, `eval / Function (incl. parenthesized) is not allowed in a workflow entry`)
    if (ts.isNewExpression(node) && node.expression && isNamed(ts.skipParentheses(node.expression), 'Function')) push(node, `new Function is not allowed in a workflow entry`)
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'agent') push(node, `'agent' must not be used as a member (obj.agent) -- only a direct call is allowed`)
    if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const a = node.argumentExpression // catch string- and template-literal keys ('agent' / `agent`)
      if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text === 'agent') push(node, `'agent' must not be accessed via computed property (x['agent'])`)
    }
    if (ts.isCallExpression(node) && isAgent(node.expression)) {
      okCallees.add(node.expression)
      if (node.questionDotToken) push(node, `'agent' optional call (agent?.()) is not allowed -- use a direct call`)
      else validateCall(node)
    }
    // any OTHER reference to the `agent` binding (alias / pass-as-value / shorthand capture / `.bind` / ...)
    if (isAgent(node) && !okCallees.has(node)) {
      const p = node.parent
      // a member name (obj.agent), an object KEY (`agent: v`), or a declaration name is NOT a read of
      // the binding -> skip (handled by the member / shadow guards). But a SHORTHAND `{ agent }` and an
      // un-renamed re-export `export { agent }` ARE reads of the binding, so they are NOT name slots.
      const isNameSlot = !!p && p.name === node && !ts.isShorthandPropertyAssignment(p) &&
        !(ts.isExportSpecifier(p) && !p.propertyName)
      if (!isNameSlot) push(node, `'agent' may only appear as a direct call agent(prompt, {...}); other references (alias / pass-as-value / shorthand capture / .bind / etc.) are forbidden`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // fail loud on an unparseable entry (don't silently report a malformed entry as clean -- F4)
  if (sf.parseDiagnostics && sf.parseDiagnostics.length) out.push(`entry is not syntactically valid (${sf.parseDiagnostics.length} parse diagnostic(s))`)
  if (callCount === 0) out.push('workflow entry has no direct agent() call')
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
    // Agent() invocation discipline -- delegated to entryAgentErrors() (AST-based; owner ruling A').
    // The injected `agent` binding may appear ONLY as the callee of a direct call agent(prompt,
    // { agentType: 'readonly-reviewer', schema }); aliasing, pass-as-value, .bind, optional / member /
    // computed access, shadowing the name `agent`, and eval / Function are all rejected. Binds the
    // no-haiku invariant per call (the agent-DEF validator below proves readonly-reviewer carries no
    // model pin). 'Explore' is the hazard (/agents pins it to haiku). NB: read-only ITSELF is not
    // mechanically enforced -- readonly-reviewer holds Bash, so its read-only posture is best-effort.
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

// The readonly-reviewer agent DEFINITION must be repo-local + correctly configured under a STRICT
// frontmatter grammar. Without this the "no haiku downgrade" invariant is only string-deep: a fresh
// clone has no agent (runtime `agent type not found`), or a drifted agent (a `model:` pin in ANY YAML
// form, wrong tools) silently re-breaks it. No YAML parser is available (no new dependency allowed), so
// validate fail-closed: every non-blank frontmatter line MUST be one of exactly the UNQUOTED keys
// name/description/tools as `key: value`, each exactly once. This rejects quoted (`"model": haiku`),
// indented, explicit (`? model`), merge/anchor, duplicate, and any unexpected key -- closing the
// quoted-key `model` bypass (Codex Code Gate 2026-06-22; originally added 2026-06-21).
function agentDefErrors(raw) {
  const out = []
  const fm = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)
  if (!fm) { out.push('missing YAML frontmatter'); return out }
  const body = fm[1]
  const ALLOWED = ['name', 'description', 'tools']
  const seen = Object.create(null)
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue
    const m = line.match(/^(name|description|tools): (.+)$/)
    if (!m) { out.push(`frontmatter line outside the strict grammar (only unquoted name:/description:/tools: 'key: value' allowed): ${JSON.stringify(line)}`); continue }
    seen[m[1]] = (seen[m[1]] || 0) + 1
  }
  for (const k of ALLOWED) {
    if (!seen[k]) out.push(`frontmatter missing required key '${k}'`)
    else if (seen[k] > 1) out.push(`frontmatter key '${k}' must appear exactly once (got ${seen[k]})`)
  }
  if (!/^name: readonly-reviewer$/m.test(body)) out.push("name must be exactly 'readonly-reviewer'")
  const toolsM = body.match(/^tools: (.+)$/m)
  const tools = toolsM ? toolsM[1].split(',').map((s) => s.trim()).filter(Boolean).sort() : []
  const EXPECTED_TOOLS = ['Bash', 'Glob', 'Grep', 'Read']
  if (JSON.stringify(tools) !== JSON.stringify(EXPECTED_TOOLS)) out.push(`tools must be exactly Read/Grep/Glob/Bash (got: [${tools.join(', ')}])`)
  return out
}
const AGENT_PATH = '.claude/agents/readonly-reviewer.md'
try {
  for (const e of agentDefErrors(readFileSync(AGENT_PATH, 'utf8'))) err(AGENT_PATH, e)
} catch (e) {
  err(AGENT_PATH, `repo-local agent definition missing/unreadable (committed workflows depend on it at runtime): ${e.message}`)
}

// self-check (locks the agent-DEF grammar; closes the quoted-key `model` bypass Codex Code Gate found).
const AGENT_DEF_CHECKS = [
  ['good', `---\nname: readonly-reviewer\ndescription: x\ntools: Read, Grep, Glob, Bash\n---\n`, false],
  ['quoted-model', `---\nname: readonly-reviewer\ndescription: x\n"model": haiku\ntools: Read, Grep, Glob, Bash\n---\n`, true],
  ['bare-model', `---\nname: readonly-reviewer\ndescription: x\nmodel: haiku\ntools: Read, Grep, Glob, Bash\n---\n`, true],
  ['indented-model', `---\nname: readonly-reviewer\ndescription: x\n  model: haiku\ntools: Read, Grep, Glob, Bash\n---\n`, true],
  ['explicit-key-model', `---\nname: readonly-reviewer\ndescription: x\n? model\n: haiku\ntools: Read, Grep, Glob, Bash\n---\n`, true],
  ['duplicate-name', `---\nname: readonly-reviewer\nname: evil\ndescription: x\ntools: Read, Grep, Glob, Bash\n---\n`, true],
  ['extra-tool', `---\nname: readonly-reviewer\ndescription: x\ntools: Read, Grep, Glob, Bash, Write\n---\n`, true],
  ['wrong-name', `---\nname: explorer\ndescription: x\ntools: Read, Grep, Glob, Bash\n---\n`, true],
  ['missing-tools', `---\nname: readonly-reviewer\ndescription: x\n---\n`, true],
  ['missing-description', `---\nname: readonly-reviewer\ntools: Read, Grep, Glob, Bash\n---\n`, true],
  ['no-frontmatter', `name: readonly-reviewer\n`, true],
]
for (const [nm, raw, expectFlagged] of AGENT_DEF_CHECKS) {
  const flagged = agentDefErrors(raw).length > 0
  if (flagged !== expectFlagged) err('lint-workflows agent-def self-check', `agentDefErrors[${nm}] expected ${expectFlagged ? 'FLAGGED' : 'clean'}, got ${flagged ? 'FLAGGED' : 'clean'} (${JSON.stringify(agentDefErrors(raw))})`)
}

// self-check (locks the AST validator): every indirect-invocation / forbidden-shape MUST be flagged and
// clean entries MUST pass. The textual scanner this replaced leaked indirect agentType then aliasing
// (two Codex Plan Gate REJECTs 2026-06-22); these fixtures lock those + the wider family. [name, src, expectFlagged]
const SELF_CHECKS = [
  // valid shapes -> must PASS
  ['clean', `await agent(p1, { agentType: 'readonly-reviewer', schema: S1 })\nawait agent(p2, { agentType: 'readonly-reviewer', phase: 'Find', label: \`x:\${d}\`, schema: S2 })`, false],
  ['clean-double-quote-agentType', `await agent(p, { agentType: "readonly-reviewer", schema: S })`, false],
  // forbidden agentType value / options shape -> must FLAG
  ['literal-Explore', `await agent(p, { agentType: 'Explore', schema: S })`, true],
  ['comment-masked-Explore', `await agent(p, { agentType: 'Explore', schema: S }) // agentType: 'readonly-reviewer'`, true],
  ['indirect-agentType', `const _t = 'Explore'\nawait agent(p, { agentType: _t, schema: S })`, true],
  ['indirect+note-padding', `const _t = 'Explore'\nawait agent(p, { agentType: _t, note: "agentType: 'readonly-reviewer'", schema: S })`, true],
  ['absent-agentType', `await agent(p, { schema: S })`, true],
  ['missing-schema', `await agent(p, { agentType: 'readonly-reviewer' })`, true],
  ['duplicate-agentType', `await agent(p, { agentType: 'readonly-reviewer', agentType: 'Explore', schema: S })`, true],
  ['template-agentType', `await agent(p, { agentType: \`readonly-reviewer\`, schema: S })`, true],
  ['spread-options', `await agent(p, { ...override, agentType: 'readonly-reviewer', schema: S })`, true],
  ['computed-key', `await agent(p, { ['agentType']: 'readonly-reviewer', schema: S })`, true],
  // forbidden 2nd-arg shape -> must FLAG
  ['expression-2nd-arg', `await agent(p, ro && explore)`, true],
  ['variable-2nd-arg', `await agent(p, optsVar)`, true],
  ['decoy-3rd-arg', `await agent(prompt, runtimeOpts, { agentType: 'readonly-reviewer', schema: S })`, true],
  ['object-in-prompt', `await agent({ agentType: 'readonly-reviewer', schema: S }, optsVar)`, true],
  ['no-options-arg', `await agent(prompt)`, true],
  // forbidden indirect invocation / shadow / dynamic -> must FLAG
  ['alias-binding', `const _invoke = agent\n_invoke(p, { agentType: 'Explore', schema: S })`, true],
  ['pass-as-value', `pipeline(agent)`, true],
  ['agent-bind', `const f = agent.bind(null)`, true],
  ['optional-call', `await agent?.(p, { agentType: 'readonly-reviewer', schema: S })`, true],
  ['member-call', `await obj.agent(p, { agentType: 'readonly-reviewer', schema: S })`, true],
  ['computed-access', `const f = globalThis['agent']`, true],
  ['shadow-const', `const agent = x\nawait agent(p, { agentType: 'readonly-reviewer', schema: S })`, true],
  ['shadow-param', `[].forEach((agent) => agent(p, { agentType: 'readonly-reviewer', schema: S }))`, true],
  ['eval', `eval("agent(p, { agentType: 'Explore', schema: S })")`, true],
  ['new-Function', `const f = new Function("return 1")`, true],
  // no direct agent() call at all -> must FLAG
  ['no-agent-call', `const x = 1`, true],
  // isolating fixtures (F3): pair the forbidden construct with a VALID direct call so ONLY the targeted
  // guard fires (not "no-direct-call") -- deleting that single guard must flip the fixture to clean.
  ['iso-member', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nobj.agent(q, { agentType: 'readonly-reviewer', schema: S })`, true],
  ['iso-optional', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nagent?.(q, { agentType: 'readonly-reviewer', schema: S })`, true],
  ['iso-computed-access', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nconst f = globalThis['agent']`, true],
  ['iso-computed-key', `await agent(p, { agentType: 'readonly-reviewer', ['x']: 1, schema: S })`, true],
  ['iso-eval', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\neval("x")`, true],
  ['iso-paren-eval', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\n(eval)("q")`, true],
  ['iso-new-Function', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nconst g = new Function("return 1")`, true],
  ['iso-stray-ref', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nconst h = agent`, true],
  ['iso-shorthand-capture', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nconst o = { agent }`, true],
  ['iso-arg-count', `await agent(p, { agentType: 'readonly-reviewer', schema: S }, extra)`, true],
  ['iso-parse-error', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nconst broken = (`, true],
  // the exact round-5 bypass: shorthand capture + template-literal computed key -> invoke with Explore
  ['shorthand+computed-capture-chain', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\n({agent})[\`agent\`](q, { agentType: 'Explore', schema: S })`, true],
  ['export-named-capture', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nexport { agent }`, true],
  ['iso-computed-access-template', `await agent(p, { agentType: 'readonly-reviewer', schema: S });\nconst f = globalThis[\`agent\`]`, true],
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
