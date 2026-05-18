#!/usr/bin/env node
/**
 * Keeps Cloudflare deploy and Miniflare test compatibility dates aligned.
 *
 * Wrangler reads wrangler.toml for deploy/bundle behavior, but Miniflare's
 * Vitest config needs an explicit compatibilityDate. If one changes without
 * the other, tests can silently run under a different runtime contract.
 */

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const WRANGLER_TOML = path.join(ROOT, 'wrangler.toml')
const VITEST_WORKERS_CONFIG = path.join(ROOT, 'vitest.workers.config.js')

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    console.error(`[lint:compat-date] failed to read ${path.relative(ROOT, file)}: ${e.message}`)
    process.exit(2)
  }
}

function extractSingleDate(source, regex, label) {
  const matches = [...source.matchAll(regex)]
  if (matches.length !== 1) {
    console.error(`[lint:compat-date] expected exactly one ${label}; found ${matches.length}`)
    process.exit(2)
  }
  return matches[0][1]
}

const wranglerDate = extractSingleDate(
  readText(WRANGLER_TOML),
  /^compatibility_date\s*=\s*["'](\d{4}-\d{2}-\d{2})["']\s*(?:#.*)?$/gm,
  'wrangler.toml compatibility_date',
)

const vitestDate = extractSingleDate(
  readText(VITEST_WORKERS_CONFIG),
  /\bcompatibilityDate\s*:\s*["'](\d{4}-\d{2}-\d{2})["']/g,
  'vitest.workers.config.js compatibilityDate',
)

if (wranglerDate !== vitestDate) {
  console.error('[lint:compat-date] compatibility date drift detected')
  console.error(`  wrangler.toml compatibility_date: ${wranglerDate}`)
  console.error(`  vitest.workers.config.js compatibilityDate: ${vitestDate}`)
  console.error('  Keep deploy and Miniflare test runtimes aligned, or change this lint rule with rationale.')
  process.exit(1)
}

console.log(`[lint:compat-date] ok - compatibility date ${wranglerDate}`)
