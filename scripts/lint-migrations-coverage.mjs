#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const MIG_DIR = path.join(ROOT, 'migrations')
const TEST_FILE = path.join(ROOT, 'tests', 'integration', 'migrations.test.ts')

let violations = 0

function pad(n) {
  return String(n).padStart(4, '0')
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/')
}

function lineOf(src, index) {
  return src.slice(0, index).split(/\r?\n/).length
}

function summarize(items) {
  return items.length ? items.join(', ') : '(none)'
}

function duplicates(values) {
  const seen = new Set()
  const dupes = new Set()
  for (const value of values) {
    if (seen.has(value)) dupes.add(value)
    seen.add(value)
  }
  return [...dupes].sort((a, b) => a - b)
}

function fail(rule, { line = null, expected, actual, note = null }) {
  violations++
  const where = line == null ? '' : ` at ${rel(TEST_FILE)}:${line}`
  console.error(`[lint-migrations-coverage] rule ${rule} failed${where}`)
  console.error(`  expected: ${expected}`)
  console.error(`  actual:   ${actual}`)
  if (note) console.error(`  note:     ${note}`)
}

function collectMigrationNumbers() {
  if (!fs.existsSync(MIG_DIR)) {
    fail('M', {
      expected: 'migrations/ directory exists',
      actual: `${rel(MIG_DIR)} is missing`,
    })
    return { max: 0, expectedNums: [] }
  }

  const files = fs.readdirSync(MIG_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => /^\d{4}_.*\.sql$/.test(name))
    .filter(name => !name.startsWith('0000_'))

  const nums = files.map(name => Number.parseInt(name.slice(0, 4), 10))
  if (nums.length === 0) {
    fail('M', {
      expected: 'at least one numbered migration after 0000_base.sql',
      actual: 'no migrations matched /^\\d{4}_.*\\.sql$/',
    })
    return { max: 0, expectedNums: [] }
  }

  const max = Math.max(...nums)
  const expectedNums = Array.from({ length: max }, (_, i) => i + 1)
  const present = new Set(nums)
  const missing = expectedNums.filter(n => !present.has(n))
  const dupes = duplicates(nums)

  if (missing.length || dupes.length) {
    fail('M', {
      expected: `migrations 0001..${pad(max)} with no gaps or duplicates`,
      actual: `missing ${summarize(missing.map(pad))}; duplicates ${summarize(dupes.map(pad))}`,
      note: 'only top-level migrations/*.sql are scanned; migrations/down/ is intentionally ignored',
    })
  }

  return { max, expectedNums }
}

function compareNumberSet(rule, actualNums, expectedNums, lineForNum = new Map()) {
  const expectedSet = new Set(expectedNums)
  const actualSet = new Set(actualNums)
  const missing = expectedNums.filter(n => !actualSet.has(n))
  const unexpected = [...actualSet].filter(n => !expectedSet.has(n)).sort((a, b) => a - b)
  const dupes = duplicates(actualNums)

  if (actualNums.length !== expectedNums.length || missing.length || unexpected.length || dupes.length) {
    const firstProblem = [...missing, ...unexpected, ...dupes].find(n => lineForNum.has(n))
    fail(rule, {
      line: firstProblem == null ? null : lineForNum.get(firstProblem),
      expected: `up0001..up${pad(expectedNums.at(-1))} (${expectedNums.length} import(s))`,
      actual: `${actualNums.length} import(s); missing ${summarize(missing.map(pad))}; unexpected ${summarize(unexpected.map(pad))}; duplicates ${summarize(dupes.map(pad))}`,
    })
  }
}

const { max: N, expectedNums } = collectMigrationNumbers()
if (N === 0) process.exit(1)

const NNNN = pad(N)
if (!fs.existsSync(TEST_FILE)) {
  fail('M', {
    expected: `${rel(TEST_FILE)} exists`,
    actual: 'migration integration test file is missing',
  })
  process.exit(1)
}

const src = fs.readFileSync(TEST_FILE, 'utf8')

const importMatches = [...src.matchAll(/^import\s+up(\d{4})\b/gm)]
const importNums = []
const importLineByNum = new Map()
for (const match of importMatches) {
  const num = Number.parseInt(match[1], 10)
  importNums.push(num)
  if (!importLineByNum.has(num)) importLineByNum.set(num, lineOf(src, match.index))
}
compareNumberSet('A', importNums, expectedNums, importLineByNum)

const allUpsMatch = /const\s+ALL_UPS\s*=\s*\[([\s\S]*?)\]/.exec(src)
if (!allUpsMatch) {
  fail('B', {
    expected: 'const ALL_UPS = [...] block exists',
    actual: 'ALL_UPS block not found',
  })
} else {
  const blockStart = allUpsMatch.index
  const bodyStart = blockStart + allUpsMatch[0].indexOf('[') + 1
  const tokenMatches = [...allUpsMatch[1].matchAll(/\bup(\d{4})\b/g)]
  const tokens = tokenMatches.map(match => ({
    name: `up${match[1]}`,
    line: lineOf(src, bodyStart + match.index),
  }))
  const last = tokens.at(-1)

  if (tokens.length !== N || last?.name !== `up${NNNN}`) {
    fail('B', {
      line: last?.line ?? lineOf(src, blockStart),
      expected: `ALL_UPS has ${N} token(s) and ends with up${NNNN}`,
      actual: `ALL_UPS has ${tokens.length} token(s) and ends with ${last?.name ?? '(none)'}`,
    })
  }
}

const expectedTitle = `'full forward chain 0001..${NNNN} vs prod snapshot'`
if (!src.includes(expectedTitle)) {
  const titleMatches = [...src.matchAll(/describe\('full forward chain 0001\.\.(\d{4}) vs prod snapshot'/g)]
  fail('C', {
    line: titleMatches[0] ? lineOf(src, titleMatches[0].index) : null,
    expected: expectedTitle,
    actual: titleMatches.length
      ? summarize(titleMatches.map(match => `'full forward chain 0001..${match[1]} vs prod snapshot'`))
      : '(missing)',
  })
}

const rangeMatches = [...src.matchAll(/\b0001\.\.(\d{4})\b/g)]
const staleRanges = rangeMatches
  .filter(match => match[1] !== NNNN)
  .map(match => `line ${lineOf(src, match.index)}: 0001..${match[1]}`)

if (staleRanges.length) {
  fail('D', {
    line: Number(staleRanges[0].match(/^line (\d+):/)?.[1] ?? null),
    expected: `all 0001..NNNN references end with ${NNNN}`,
    actual: summarize(staleRanges),
  })
}

if (violations > 0) {
  console.error(`[lint-migrations-coverage] ${violations} violation(s); expected migration coverage through ${NNNN}`)
  process.exit(1)
}

console.log(`[lint-migrations-coverage] OK (N=${NNNN}, 4 rules passed)`)
