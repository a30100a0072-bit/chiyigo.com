/**
 * asset-versioning.mjs — SSOT for content-hash cache-bust `?v=` on local assets.
 *
 * Why: the previous `?v=<git short HEAD>` scheme orphaned on every squash-merge
 * (a feature-branch hash lands in committed HTML, then squash creates a new HEAD)
 * and had no CI guard, so an asset could change without its HTML `?v=` bumping
 * (the split-brain that #89 stopgapped). Per-file content hashing decouples the
 * version token from git entirely: it changes iff the asset bytes change.
 *
 * This module is the single source of truth shared by:
 *   - scripts/build-partials.js  (injects `?v=` at build time)
 *   - scripts/verify-browser-pipeline.mjs (re-derives expected `?v=` in CI)
 * so the matcher and the hash algorithm can never diverge between produce and verify.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** Thrown on any unsupported / unsafe asset reference — always fail-closed (never silent). */
export class AssetVersionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AssetVersionError'
  }
}

/**
 * SSOT regex for versionable local asset references in HTML.
 * Captures: 1=attr(src|href), 2=path(/...js|css|mjs), 3=optional ?query, 4=optional #fragment.
 * Note: `https://…` never matches (does not start with `/` after `="`); protocol-relative
 * `//…` DOES match group 2 and is filtered out as external inside injectCacheBust/verify.
 */
export const ASSET_RE = /\b(src|href)="(\/[^"#?]+\.(?:js|css|mjs))(\?[^"#]*)?(#[^"]*)?"/g

/** 12 hex of sha256 — collision-safe for cache-busting, short enough for readable URLs. */
export const HASH_LEN = 12

// v1 allowlist (H2): only these repo-local public roots are versioned. `.mjs` is intentionally
// NOT enabled — the pre-impl inventory found no `.mjs` references; enabling it needs owner ruling.
const ALLOWED_ROOTS = [
  { prefix: '/js/', ext: '.js' },
  { prefix: '/css/', ext: '.css' },
]

/** True for protocol-relative URLs (`//cdn/…`) — external, must not be versioned. */
export function isProtocolRelative(urlPath) {
  return urlPath.startsWith('//')
}

/**
 * Resolve a matched asset URL to an absolute path under `publicDir`, or throw (H2 containment).
 * Safety boundary lives HERE, not in the regex: root-relative only, no protocol-relative,
 * decoded, normalized, and the resolved path must stay inside publicDir. Anything else
 * (traversal, encoded traversal, unsupported root) fails closed.
 */
export function resolveAssetPath(urlPath, publicDir) {
  if (typeof urlPath !== 'string' || urlPath.length === 0) {
    throw new AssetVersionError(`ASSET_PATH_INVALID: ${JSON.stringify(urlPath)}`)
  }
  if (!urlPath.startsWith('/') || isProtocolRelative(urlPath)) {
    throw new AssetVersionError(`ASSET_PATH_NOT_LOCAL: not a root-relative local path: ${urlPath}`)
  }
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    throw new AssetVersionError(`ASSET_PATH_BAD_ENCODING: ${urlPath}`)
  }
  if (decoded.includes('\0')) throw new AssetVersionError(`ASSET_PATH_NUL_BYTE: ${urlPath}`)
  // Re-check after decode so encoded traversal (e.g. %2e%2e) cannot smuggle past the literal check.
  if (decoded.includes('..')) throw new AssetVersionError(`ASSET_PATH_TRAVERSAL: ${urlPath}`)

  const onAllowedRoot = ALLOWED_ROOTS.some((r) => decoded.startsWith(r.prefix) && decoded.endsWith(r.ext))
  if (!onAllowedRoot) {
    throw new AssetVersionError(`ASSET_PATH_UNSUPPORTED_ROOT: ${urlPath} (v1 allows /js/*.js, /css/*.css)`)
  }

  const pubResolved = path.resolve(publicDir)
  const abs = path.resolve(pubResolved, '.' + decoded)
  if (abs !== pubResolved && !abs.startsWith(pubResolved + path.sep)) {
    throw new AssetVersionError(`ASSET_PATH_ESCAPE: ${urlPath} resolves outside PUBLIC`)
  }
  return abs
}

/**
 * Byte-level CRLF→LF normalization (F1). Operates on the raw Buffer so the hash matches the
 * git `text=auto eol=lf` blob — i.e. the bytes Cloudflare actually serves — regardless of the
 * local working-tree EOL (Windows builds may write CRLF). Only `CRLF` (0x0D 0x0A) collapses to
 * `LF`; a lone CR is left untouched, exactly as git's eol=lf does (NOT `tr -d '\r'`).
 */
export function normalizeLF(buf) {
  const out = Buffer.allocUnsafe(buf.length)
  let j = 0
  for (let i = 0; i < buf.length; i++) {
    // Drop CR only when it is immediately followed by LF.
    if (buf[i] === 0x0d && i + 1 < buf.length && buf[i + 1] === 0x0a) continue
    out[j++] = buf[i]
  }
  return out.subarray(0, j)
}

/** Content hash of an asset file: LF-normalized sha256, first HASH_LEN hex. Missing file → throw. */
export function assetVersion(absPath) {
  let buf
  try {
    buf = fs.readFileSync(absPath)
  } catch {
    throw new AssetVersionError(`ASSET_MISSING: ${absPath}`)
  }
  return crypto.createHash('sha256').update(normalizeLF(buf)).digest('hex').slice(0, HASH_LEN)
}

/**
 * Parse the raw `?query` capture (incl. leading `?`, or undefined) under the conservative
 * rule (M1, option A): a local asset may carry no query, or a query whose ONLY params are
 * `v=…`. Any other query param fails closed — we never silently preserve unknown query state.
 * Returns nothing; throws on violation. (Fragment handled by the caller.)
 */
function assertQuerySupported(rawQuery, assetPath) {
  if (!rawQuery) return
  const params = rawQuery.slice(1).split('&').filter((s) => s.length > 0)
  const nonV = params.filter((s) => !/^v=/.test(s))
  if (nonV.length > 0) {
    throw new AssetVersionError(
      `ASSET_QUERY_UNSUPPORTED: ${assetPath} has non-v query ${JSON.stringify(rawQuery)} ` +
        `(v1 supports only no-query or v=…)`,
    )
  }
}

/**
 * Rewrite every local asset `?v=` in `html` to `?v=<resolveVer(path)>`.
 * - protocol-relative `//…` is left untouched (external).
 * - existing `v=` is replaced; fragment is preserved; non-v query fails closed (M1-A).
 * - `resolveVer(assetPath)` returns the version string for that path (build passes content
 *   hashes; the Tailwind two-pass passes a sentinel for `/css/tailwind.css`, patched later).
 */
export function injectCacheBust(html, resolveVer) {
  return html.replace(ASSET_RE, (full, attr, assetPath, rawQuery, frag) => {
    if (isProtocolRelative(assetPath)) return full // external, do not version
    assertQuerySupported(rawQuery, assetPath)
    const ver = resolveVer(assetPath)
    return `${attr}="${assetPath}?v=${ver}${frag || ''}"`
  })
}

/**
 * Extract every versionable local asset reference from `html` (for the CI verifier).
 * Returns array of { attr, assetPath, version|null, frag }, skipping protocol-relative externals.
 * `version` is the current `?v=` value in the HTML (null if absent / non-v query present —
 * the verifier treats both as a mismatch against the expected content hash).
 */
export function extractAssetRefs(html) {
  const refs = []
  for (const m of html.matchAll(ASSET_RE)) {
    const [, attr, assetPath, rawQuery] = m
    if (isProtocolRelative(assetPath)) continue
    let version = null
    if (rawQuery) {
      // Mirror the producer's conservative rule (assertQuerySupported): a query with ANY non-v
      // param is unsupported, so the verifier treats it as "no valid version" → mismatch/fail,
      // rejecting exactly what injectCacheBust refuses to produce (no produce/verify asymmetry).
      const params = rawQuery.slice(1).split('&').filter((s) => s.length > 0)
      const hasNonV = params.some((s) => !/^v=/.test(s))
      if (!hasNonV) {
        const mv = rawQuery.match(/[?&]v=([^&]*)/)
        version = mv ? mv[1] : null
      }
    }
    refs.push({ attr, assetPath, version })
  }
  return refs
}
