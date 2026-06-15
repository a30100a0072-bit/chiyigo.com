// Unit tests for the asset-versioning SSOT helper (content-hash cache-bust).
// Pure-function + tmp-fixture tests; no git/build. The two-pass build graph and the
// verifier's end-to-end stale-detection are exercised by `npm run build` +
// `verify:browser-pipeline` in CI — here we lock the shared helper the SSOT both rely on.
// See docs/plans/asset-versioning-hardening-plan.md §2 / §4.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assetVersion,
  resolveAssetPath,
  normalizeLF,
  injectCacheBust,
  extractAssetRefs,
  AssetVersionError,
  HASH_LEN,
} from '../scripts/lib/asset-versioning.mjs'

let PUBLIC: string
beforeAll(() => {
  PUBLIC = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-versioning-'))
  fs.mkdirSync(path.join(PUBLIC, 'css'), { recursive: true })
  fs.mkdirSync(path.join(PUBLIC, 'js'), { recursive: true })
})
afterAll(() => {
  fs.rmSync(PUBLIC, { recursive: true, force: true })
})

describe('normalizeLF — byte-level CRLF→LF, keep lone CR', () => {
  it('collapses CRLF to LF', () => {
    expect(normalizeLF(Buffer.from('a\r\nb\r\n')).toString()).toBe('a\nb\n')
  })
  it('keeps a lone CR (matches git eol=lf, NOT tr -d \\r)', () => {
    expect(normalizeLF(Buffer.from('a\rb')).toString()).toBe('a\rb')
  })
  it('is a no-op on already-LF content', () => {
    expect(normalizeLF(Buffer.from('a\nb\n')).toString()).toBe('a\nb\n')
  })
})

describe('assetVersion — LF-normalized content hash, 12 hex, fail-closed', () => {
  it('CRLF and LF of the same content hash identically (cross-platform)', () => {
    fs.writeFileSync(path.join(PUBLIC, 'css', 'crlf.css'), 'body{}\r\na{}\r\n')
    fs.writeFileSync(path.join(PUBLIC, 'css', 'lf.css'), 'body{}\na{}\n')
    const h1 = assetVersion(resolveAssetPath('/css/crlf.css', PUBLIC))
    const h2 = assetVersion(resolveAssetPath('/css/lf.css', PUBLIC))
    expect(h1).toBe(h2)
  })
  it('produces a 12-hex hash', () => {
    fs.writeFileSync(path.join(PUBLIC, 'js', 'a.js'), 'console.log(1)\n')
    const h = assetVersion(resolveAssetPath('/js/a.js', PUBLIC))
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(h.length).toBe(HASH_LEN)
  })
  it('different content → different hash', () => {
    fs.writeFileSync(path.join(PUBLIC, 'js', 'b.js'), 'console.log(2)\n')
    const ha = assetVersion(resolveAssetPath('/js/a.js', PUBLIC))
    const hb = assetVersion(resolveAssetPath('/js/b.js', PUBLIC))
    expect(ha).not.toBe(hb)
  })
  it('missing file → AssetVersionError (fail-closed, no fallback)', () => {
    expect(() => assetVersion(path.join(PUBLIC, 'js', 'nope.js'))).toThrow(AssetVersionError)
    expect(() => assetVersion(path.join(PUBLIC, 'js', 'nope.js'))).toThrow(/ASSET_MISSING/)
  })
})

describe('resolveAssetPath — containment, fail-closed (H2)', () => {
  it('accepts /js/*.js and /css/*.css resolved under PUBLIC', () => {
    expect(resolveAssetPath('/js/x.js', PUBLIC)).toBe(path.resolve(PUBLIC, 'js/x.js'))
    expect(resolveAssetPath('/css/x.css', PUBLIC)).toBe(path.resolve(PUBLIC, 'css/x.css'))
  })
  it('rejects path traversal', () => {
    expect(() => resolveAssetPath('/js/../../secret.js', PUBLIC)).toThrow(/TRAVERSAL/)
  })
  it('rejects encoded traversal (%2e%2e)', () => {
    expect(() => resolveAssetPath('/js/%2e%2e/secret.js', PUBLIC)).toThrow(/TRAVERSAL/)
  })
  it('rejects protocol-relative //', () => {
    expect(() => resolveAssetPath('//cdn/x.js', PUBLIC)).toThrow(/NOT_LOCAL/)
  })
  it('rejects unsupported roots (/images/*, /js/*.mjs not enabled in v1)', () => {
    expect(() => resolveAssetPath('/images/x.js', PUBLIC)).toThrow(/UNSUPPORTED_ROOT/)
    expect(() => resolveAssetPath('/js/x.mjs', PUBLIC)).toThrow(/UNSUPPORTED_ROOT/)
  })
  it('rejects non-root-relative paths', () => {
    expect(() => resolveAssetPath('relative/x.js', PUBLIC)).toThrow(/NOT_LOCAL/)
  })
})

describe('injectCacheBust — query/fragment rule (M1 option A) + external skip', () => {
  const ver = (p: string) => 'V' + p.replace(/[^a-z]/g, '')

  it('no query → appends ?v=', () => {
    expect(injectCacheBust('<link href="/css/x.css">', ver)).toContain('href="/css/x.css?v=Vcssxcss"')
  })
  it('v-only query → replaced', () => {
    const out = injectCacheBust('<script src="/js/a.js?v=old"></script>', ver)
    expect(out).toContain('src="/js/a.js?v=Vjsajs"')
    expect(out).not.toContain('v=old')
  })
  it('fragment is preserved', () => {
    expect(injectCacheBust('<link href="/css/x.css?v=old#top">', ver)).toContain('href="/css/x.css?v=Vcssxcss#top"')
  })
  it('non-v query → fail-closed (no silent passthrough)', () => {
    expect(() => injectCacheBust('<script src="/js/a.js?foo=1"></script>', ver)).toThrow(/QUERY_UNSUPPORTED/)
    expect(() => injectCacheBust('<script src="/js/a.js?foo=1&v=x"></script>', ver)).toThrow(/QUERY_UNSUPPORTED/)
  })
  it('protocol-relative // is left untouched (external)', () => {
    const html = '<script src="//cdn.example/a.js"></script>'
    expect(injectCacheBust(html, ver)).toBe(html)
  })
  it('https:// external is not matched / unchanged', () => {
    const html = '<script src="https://cdn.example/a.js"></script>'
    expect(injectCacheBust(html, ver)).toBe(html)
  })
})

describe('extractAssetRefs — verifier input extraction', () => {
  it('extracts local refs with current ?v=, skips external', () => {
    const html =
      '<link href="/css/x.css?v=abc"><script src="/js/a.js"></script><script src="https://cdn/a.js"></script>'
    expect(extractAssetRefs(html)).toEqual([
      { attr: 'href', assetPath: '/css/x.css', version: 'abc' },
      { attr: 'src', assetPath: '/js/a.js', version: null },
    ])
  })
  it('version is null when a non-v query is present (verifier → mismatch)', () => {
    expect(extractAssetRefs('<script src="/js/a.js?foo=1"></script>')[0].version).toBe(null)
  })
  it('non-v query is rejected even alongside a valid v (mirrors producer fail-closed)', () => {
    // pre-fix this returned 'abc' (verifier would accept what injectCacheBust refuses); now null → fail
    expect(extractAssetRefs('<script src="/js/a.js?foo=1&v=abc"></script>')[0].version).toBe(null)
  })
})

describe('verifier core — stale ?v= is detectable via the shared helper', () => {
  it('committed ?v= equal to content-hash passes; a stale one differs', () => {
    fs.writeFileSync(path.join(PUBLIC, 'js', 'c.js'), 'STABLE\n')
    const real = assetVersion(resolveAssetPath('/js/c.js', PUBLIC))
    const good = extractAssetRefs(`<script src="/js/c.js?v=${real}"></script>`)[0]
    expect(good.version).toBe(real)
    const stale = extractAssetRefs('<script src="/js/c.js?v=deadbeef0000"></script>')[0]
    expect(stale.version).not.toBe(real)
  })
})
