// Audit: find all res({ ... error: '...' ... }) calls in functions/ that LACK a `code:` field.
// Output: JSON to stdout. Read-only, no writes to source.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] || 'functions';
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (p.endsWith('.js') || p.endsWith('.ts')) files.push(p);
  }
}
walk(ROOT);

const results = [];
const warnings = [];
const withCode = [];  // 已有 code 的清單（給 render 跟 dict 對照，找漏譯）

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  // Find every occurrence of "res(" (not preceded by identifier char) and parse the {...} arg
  // Use a regex to scan, then bracket-match.
  const reCall = /\bres\s*\(/g;
  let m;
  while ((m = reCall.exec(src)) !== null) {
    // index of '(' is m.index + (m[0].length - 1)
    const openParenIdx = m.index + m[0].length - 1;
    // ensure prev char is not identifier-ish (avoid matching e.g. "fooRes(")
    const prev = src[m.index - 1] || ' ';
    if (/[A-Za-z0-9_$]/.test(prev)) continue;
    // Find first non-space after openParen
    let i = openParenIdx + 1;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '{') continue; // first arg not an object literal -> skip
    // bracket match
    let depth = 0;
    let j = i;
    let inStr = null;
    let escape = false;
    while (j < src.length) {
      const c = src[j];
      if (inStr) {
        if (escape) { escape = false; }
        else if (c === '\\') escape = true;
        else if (c === inStr) inStr = null;
      } else {
        if (c === '"' || c === "'" || c === '`') inStr = c;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
      }
      j++;
    }
    if (depth !== 0) continue;
    const objText = src.slice(i, j); // including { ... }
    // Quick filter: must contain "error:" inside this object literal
    // Avoid false positives like nested objects with error key inside -- accept all, since this is the res() call
    // Match error: 'string' OR error: "string" OR error: `string` ; capture string content
    const errMatches = [];
    const reErr = /\berror\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
    let em;
    while ((em = reErr.exec(objText)) !== null) {
      errMatches.push({ str: em[2], localIdx: em.index });
    }
    // Also detect non-string error: value (variable / expression)
    const reErrVar = /\berror\s*:\s*(?!['"`])([A-Za-z_$][\w$.?]*)\s*[,}\n]/g;
    const varMatches = [];
    let vm;
    while ((vm = reErrVar.exec(objText)) !== null) {
      varMatches.push({ expr: vm[1], localIdx: vm.index });
    }

    if (errMatches.length === 0 && varMatches.length === 0) continue;

    // Check for `code:` field at top-level of object literal
    // Simple: regex code: '...' or code: VAR ; consider only string for "has code"
    const codeStrMatch = /\bcode\s*:\s*(['"`])([A-Z][A-Z0-9_]*)\1/.exec(objText);

    // Compute line number of res(
    const lineNum = src.slice(0, m.index).split('\n').length;
    const rel = relative('.', file).replace(/\\/g, '/');

    if (codeStrMatch) {
      withCode.push({ file: rel, line: lineNum, code: codeStrMatch[2] });
      continue;
    }

    for (const e of errMatches) {
      results.push({
        file: rel,
        line: lineNum,
        errorStr: e.str,
      });
    }
    for (const v of varMatches) {
      warnings.push({
        file: rel,
        line: lineNum,
        expr: v.expr,
      });
    }
  }
}

console.log(JSON.stringify({ results, warnings, withCode }, null, 2));
