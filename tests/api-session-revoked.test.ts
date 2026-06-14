/**
 * SEC-REFRESH-REUSE (OD-SR-B / §10 前端) — focused api.js test：apiFetch 只對 code==='SESSION_REVOKED' 的 401 硬登出
 * （清 access_token + 導 /login），且**在 silent-refresh 分支之前** detect；generic 401 / 403 / 429 / network /
 * malformed 一律不清不導（C3 hard lock：防誤登出）。
 *
 * 為何用 vm 而非 import：repo 無前端測試框架（tests project typecheck 走 WebWorker lib，無 DOM，無 jsdom）。直接
 * import `src/js/api.ts` 會讓 WebWorker-lib typecheck 在 window / sessionStorage / location 上爆。改把【已 build 的】
 * 出貨 classic bundle `public/js/api.js` 當字串讀進來，用 vm.compileFunction 注入受控的 browser global stub
 * （window / sessionStorage / location / fetch）後執行；其餘（Response / Headers / Map / setTimeout）走 node 內建。
 * 測的是真正出貨的 bundle，且該字串永不進 typecheck。注意：本測試依賴 build 產物 — 改 api.ts 後須先 build:partials。
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

const API_JS = readFileSync(fileURLToPath(new URL('../public/js/api.js', import.meta.url)), 'utf8')

interface MemStore {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}
function memStore(init: Record<string, string> = {}): MemStore {
  const m = new Map<string, string>(Object.entries(init))
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
}

type ApiFetch = (input: string, init?: { skipRefresh?: boolean }) => Promise<unknown>
interface LoadedApi { apiFetch: ApiFetch; sessionStorage: MemStore; location: { pathname: string; href: string } }

// Run the shipped classic bundle in a sandbox with injected browser stubs; window.apiFetch lands on the win stub.
// A fresh load per test = fresh module closure (no _refreshInflight / token state leak across cases).
function loadApi(fetchImpl: () => Promise<Response>, opts: { token?: string | null; pathname?: string } = {}): LoadedApi {
  const win: Record<string, unknown> = {}
  const sessionStorage = memStore(opts.token === null ? {} : { access_token: opts.token ?? 'tok-123' })
  // a valid `chiyigo.device_uuid` so _doRefreshOnce's read-only device gate passes when the silent-refresh path runs.
  const localStorage = memStore({ 'chiyigo.device_uuid': 'web-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
  const location = { pathname: opts.pathname ?? '/dashboard.html', href: '' }
  const navigator = {}  // no .locks → silent-refresh would fall to _doRefreshOnce (never reached in these tests)
  const run = compileFunction(API_JS, ['window', 'sessionStorage', 'localStorage', 'location', 'navigator', 'fetch'])
  run(win, sessionStorage, localStorage, location, navigator, fetchImpl)
  return { apiFetch: win.apiFetch as ApiFetch, sessionStorage, location }
}

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('apiFetch — SEC-REFRESH-REUSE SESSION_REVOKED handling (OD-SR-B / C3)', () => {
  it('(a) 401 SESSION_REVOKED → clears token + redirects /login + throws SESSION_REVOKED, BEFORE any silent-refresh', async () => {
    const fetchMock = vi.fn(async () => jsonResp(401, { error: 'Session has been revoked', code: 'SESSION_REVOKED' }))
    const { apiFetch, sessionStorage, location } = loadApi(fetchMock)
    await expect(apiFetch('/api/foo')).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' })
    expect(sessionStorage.getItem('access_token')).toBeNull()   // cleared
    expect(location.href).toBe('/login.html')                   // redirected
    expect(fetchMock).toHaveBeenCalledTimes(1)                  // detected BEFORE silent-refresh — no /api/auth/refresh round-trip
  })

  it('(b) generic 401 (no SESSION_REVOKED) → does NOT clear / redirect', async () => {
    const fetchMock = vi.fn(async () => jsonResp(401, { error: 'Unauthorized', code: 'UNAUTHORIZED' }))
    const { apiFetch, sessionStorage, location } = loadApi(fetchMock)
    await expect(apiFetch('/api/foo', { skipRefresh: true })).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
    expect(sessionStorage.getItem('access_token')).toBe('tok-123')
    expect(location.href).toBe('')
  })

  it('(c) 403 / 429 → never clear / redirect', async () => {
    for (const status of [403, 429]) {
      const fetchMock = vi.fn(async () => jsonResp(status, { error: 'x', code: status === 403 ? 'FORBIDDEN' : 'RATE_LIMITED' }))
      const { apiFetch, sessionStorage, location } = loadApi(fetchMock)
      await expect(apiFetch('/api/foo', { skipRefresh: true })).rejects.toMatchObject({ status })
      expect(sessionStorage.getItem('access_token')).toBe('tok-123')
      expect(location.href).toBe('')
    }
  })

  it('(c2) network error (fetch rejects) → NETWORK_ERROR, no clear / redirect', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const { apiFetch, sessionStorage, location } = loadApi(fetchMock as unknown as () => Promise<Response>)
    await expect(apiFetch('/api/foo', { skipRefresh: true })).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(sessionStorage.getItem('access_token')).toBe('tok-123')
    expect(location.href).toBe('')
  })

  it('(d) malformed (non-JSON) 401 + code-less JSON 401 → not treated as SESSION_REVOKED, no clear', async () => {
    // non-JSON body → res.clone().json() throws → revokedCode null → not SESSION_REVOKED
    {
      const fetchMock = vi.fn(async () => new Response('not-json', { status: 401, headers: { 'Content-Type': 'text/plain' } }))
      const { apiFetch, sessionStorage, location } = loadApi(fetchMock)
      await expect(apiFetch('/api/foo', { skipRefresh: true })).rejects.toMatchObject({ status: 401 })
      expect(sessionStorage.getItem('access_token')).toBe('tok-123')
      expect(location.href).toBe('')
    }
    // JSON 401 with NO code field → revokedCode null → not SESSION_REVOKED
    {
      const fetchMock = vi.fn(async () => jsonResp(401, { error: 'nope' }))
      const { apiFetch, sessionStorage, location } = loadApi(fetchMock)
      await expect(apiFetch('/api/foo', { skipRefresh: true })).rejects.toMatchObject({ status: 401 })
      expect(sessionStorage.getItem('access_token')).toBe('tok-123')
      expect(location.href).toBe('')
    }
  })

  it('(e) generic 401 → silent-refresh succeeds → RETRY returns 401 SESSION_REVOKED → clears + redirects with SESSION_REVOKED code', async () => {
    // family revoked in the refresh→retry window: the retry-401 must be detected as SESSION_REVOKED (correct code),
    // not the generic SESSION_EXPIRED. Routes through the real silent-refresh path (no skipRefresh).
    let mainCalls = 0
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes('/api/auth/refresh')) return jsonResp(200, { access_token: 'refreshed-tok' })
      mainCalls++
      return mainCalls === 1
        ? jsonResp(401, { error: 'expired', code: 'UNAUTHORIZED' })   // initial → generic 401 → triggers refresh
        : jsonResp(401, { error: 'revoked', code: 'SESSION_REVOKED' }) // retry → family revoked
    })
    const { apiFetch, sessionStorage, location } = loadApi(fetchMock as unknown as () => Promise<Response>)
    await expect(apiFetch('/api/foo')).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' })
    expect(sessionStorage.getItem('access_token')).toBeNull()   // cleared (NOT the refreshed token)
    expect(location.href).toBe('/login.html')                   // redirected
  })
})
