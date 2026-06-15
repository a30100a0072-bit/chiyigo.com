/**
 * SEC-FACTOR-ADD Stage 2 — OAuth-only OAuth-reauth elevation wiring test.
 *
 * Stage 1 wired TOTP/password elevation. Stage 2 wires the OAuth-only path:
 *   OAuth-only click -> reauth modal -> /init?purpose=elevation -> full-page redirect ->
 *   callback 5a -> #elev_exchange=<code> -> /elevation/exchange -> resume the original ceremony.
 *
 * Locks (vs a recurrence of the Stage 1 root cause "all-green PR ships a broken ceremony"):
 *   - OUTBOUND: OAuth-only caller mints NOTHING until a reauth provider is chosen; on choose it
 *     persists ONLY non-sensitive routing context (action [+ targetProvider]), calls init with the
 *     correct action + encoded provider, then navigates. No grant/code ever in storage.
 *   - RESUME: #elev_exchange -> POST /elevation/exchange with skipRefresh:true (HR-F3) -> the
 *     resumed factor-add request carries X-Factor-Add-Grant. Tampered/stale/missing context fails closed.
 *   - elev_error full set clears pending + strips the URL (the Stage 2 delta over the old
 *     reverification_required-only branch).
 *
 * Harness mirrors tests/dashboard-factor-add-wiring.test.ts: vm.compileFunction over the SHIPPED
 * bundle public/js/dashboard.js with injected browser-global stubs (no jsdom). loadProfile() bails
 * (no access_token, raw fetch) so the apiFetch spy is hit only by the Stage 2 flows. Depends on the
 * build artifact -- run build:partials after editing src.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

const DASHBOARD_JS = readFileSync(fileURLToPath(new URL('../public/js/dashboard.js', import.meta.url)), 'utf8')

const GRANT = 'grant-token-XYZ'
const CODE = 'exch-code-ABC'
const ADDR = '0x' + 'a'.repeat(40)
const ELEV_REDIRECT = 'https://provider.example/oauth-elev'
const PENDING_KEY = 'factor_add_reauth_pending'

interface ReqInit { method?: string; headers?: Record<string, string>; body?: string; skipRefresh?: boolean }
type Handler = (ev?: unknown) => unknown

interface StubEl {
  id: string; value: string; textContent: string; innerHTML: string; className: string
  disabled: boolean; hidden: boolean; isConnected: boolean
  dataset: Record<string, string>; style: Record<string, string>
  classList: { add(...c: string[]): void; remove(...c: string[]): void; contains(c: string): boolean; toggle(c: string): void }
  listeners: Record<string, Handler[]>
  addEventListener(type: string, fn: Handler): void
  removeEventListener(type: string, fn: Handler): void
  emit(type: string, ev?: unknown): void
  focus(): void; blur(): void; remove(): void
  appendChild(c: StubEl): StubEl
  setAttribute(k: string, v: string): void; removeAttribute(k: string): void; getAttribute(k: string): string | null
  querySelector(sel: string): StubEl; querySelectorAll(sel: string): StubEl[]
  closest(sel: string): StubEl | null
  matches(sel: string): boolean
  getContext(type: string): null
  click(): void
}

function makeEl(id = ''): StubEl {
  const listeners: Record<string, Handler[]> = {}
  const el: StubEl = {
    id, value: '', textContent: '', innerHTML: '', className: '',
    disabled: false, hidden: false, isConnected: true,
    dataset: {}, style: {},
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    listeners,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    removeEventListener() {},
    emit(type, ev) { for (const fn of listeners[type] ?? []) fn(ev) },
    focus() {}, blur() {}, remove() {},
    appendChild(c) { return c },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null },
    querySelector() { return makeEl() }, querySelectorAll() { return [] },
    closest() { return null }, matches() { return false },
    getContext() { return null },
    click() { el.emit('click', { target: el }) },
  }
  return el
}

function clickTarget(props: { id?: string; dataset?: Record<string, string> }): StubEl {
  const el = makeEl(props.id ?? '')
  Object.assign(el.dataset, props.dataset ?? {})
  el.closest = (sel: string) => (sel.includes('toggle-pwd') ? null : el)
  return el
}

interface LoadOpts {
  totp?: boolean; hasPw?: boolean
  reauthProviders?: string[]
  hash?: string
  search?: string
  pending?: { action?: string; targetProvider?: string; ts?: number } | string | null
  exchangeFail?: boolean       // /elevation/exchange returns {} (no grant_token)
  initFail?: boolean           // /init?purpose=elevation returns {} (no redirect_url)
  failPersist?: boolean        // sessionStorage.setItem(PENDING_KEY) throws
}

interface Loaded {
  els: Record<string, StubEl>
  calls: Array<{ url: string; init: ReqInit }>
  loc: { href: string; protocol: string; search: string; hash: string; replace(u: string): void; assign(u: string): void }
  storageWrites: Array<{ key: string; value: string }>
  storageRemoves: string[]
  readonly replaceStateCalls: number
  dispatchClick(target: StubEl): void
}

function loadDashboard(opts: LoadOpts): Loaded {
  const els: Record<string, StubEl> = {}
  const getEl = (id: string): StubEl => (els[id] ||= makeEl(id))
  const calls: Array<{ url: string; init: ReqInit }> = []

  const apiFetch = async (url: string, init?: ReqInit): Promise<unknown> => {
    calls.push({ url, init: init ?? {} })
    if (url.includes('/init?purpose=elevation')) return opts.initFail ? {} : { redirect_url: ELEV_REDIRECT }
    if (url.includes('/elevation/exchange')) return opts.exchangeFail ? {} : { grant_token: GRANT, expires_in: 300 }
    if (url.startsWith('/api/auth/elevation/')) return { grant_token: GRANT, expires_in: 300 }
    if (url.includes('register-options')) return { challenge: 'AAAA', user: { id: 'AAAA', name: 'a', displayName: 'a' }, rp: { id: 'r', name: 'r' }, pubKeyCredParams: [], excludeCredentials: [] }
    if (url.includes('register-verify')) return { id: 1, created_at: 'now' }
    if (url.includes('wallet/nonce')) return { domain: 'chiyigo.com', uri: 'https://chiyigo.com', chain_id: 1, nonce: 'nonce123', expires_at: '2099-01-01 00:00:00', address: ADDR }
    if (url.includes('wallet/verify')) return { id: 1, address: ADDR, chain_id: 1 }
    if (url.includes('/init?is_binding')) return { redirect_url: 'https://provider.example/oauth-bind' }
    return { credentials: [], wallets: [], identities: [], rows: [], devices: [] }
  }

  const clickHandlers: Handler[] = []
  const doc = {
    getElementById: (id: string) => getEl(id),
    createElement: (_t: string) => makeEl(),
    documentElement: makeEl('html'),
    body: makeEl('body'),
    head: makeEl('head'),
    addEventListener: (type: string, fn: Handler) => { if (type === 'click') clickHandlers.push(fn) },
    removeEventListener() {},
    querySelector: () => makeEl(),
    querySelectorAll: (): StubEl[] => [],
  }

  const loc = { href: '', protocol: 'https:', search: opts.search ?? '', hash: opts.hash ?? '', replace() {}, assign() {} }
  const fakeBuf = (): ArrayBuffer => new ArrayBuffer(8)
  const navigator = {
    credentials: {
      create: async () => ({
        id: 'cred-id', type: 'public-key', rawId: fakeBuf(),
        response: { clientDataJSON: fakeBuf(), attestationObject: fakeBuf(), getTransports: () => ['internal'] },
        getClientExtensionResults: () => ({}), authenticatorAttachment: 'platform',
      }),
    },
  }

  const win: Record<string, unknown> = {
    apiFetch,
    tApiError: (_e: unknown, fallback?: string) => fallback ?? '',
    location: loc,
    PublicKeyCredential: function PublicKeyCredential() {},
    ethereum: { request: async (req: { method: string }) => (req.method === 'eth_requestAccounts' ? [ADDR] : '0xSIGNATURE') },
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1024, innerHeight: 768,
  }

  const storageWrites: Array<{ key: string; value: string }> = []
  const storageRemoves: string[] = []
  const pendingRaw = opts.pending == null ? null : (typeof opts.pending === 'string' ? opts.pending : JSON.stringify(opts.pending))
  const sessionStorage = {
    getItem: (k: string): string | null => (k === PENDING_KEY ? pendingRaw : null),
    setItem: (key: string, value: string) => {
      if (key === PENDING_KEY && opts.failPersist) throw new Error('storage blocked')
      storageWrites.push({ key, value })
    },
    removeItem: (k: string) => { storageRemoves.push(k) },
  }
  const localStorage = { getItem: (): string | null => null, setItem: (key: string, value: string) => storageWrites.push({ key, value }), removeItem() {} }
  let replaceStateCalls = 0
  const history = { replaceState() { replaceStateCalls++ }, pushState() {} }
  const getComputedStyle = () => ({ getPropertyValue: () => '' })
  class MutationObserver { observe() {} disconnect() {} takeRecords(): unknown[] { return [] } }

  const run = compileFunction(DASHBOARD_JS, ['window', 'document', 'location', 'navigator', 'history', 'sessionStorage', 'localStorage', 'getComputedStyle', 'MutationObserver'])
  run(win, doc, loc, navigator, history, sessionStorage, localStorage, getComputedStyle, MutationObserver)

  win.__totpEnabled = opts.totp ?? false
  win.__hasPassword = opts.hasPw ?? false
  win.__reauthProviders = opts.reauthProviders

  return {
    els, calls, loc, storageWrites, storageRemoves,
    get replaceStateCalls() { return replaceStateCalls },
    dispatchClick: (target) => { for (const fn of clickHandlers) fn({ target }) },
  }
}

const tick = (): Promise<void> => new Promise(r => { setTimeout(r, 0) })
async function flush(): Promise<void> { for (let i = 0; i < 8; i++) await tick() }
const realWait = (ms: number): Promise<void> => new Promise(r => { setTimeout(r, ms) })

/** Click a reauth-modal provider button (id reauth-elev-btn-<p>) and await its async handler. */
async function driveReauthProvider(d: Loaded, provider: string): Promise<void> {
  const btn = d.els['reauth-elev-btn-' + provider]
  if (!btn) throw new Error(`reauth modal did not open (no #reauth-elev-btn-${provider})`)
  const handler = btn.listeners['click']?.[0]
  if (typeof handler !== 'function') throw new Error('reauth provider handler not registered')
  await handler()
  await flush()
}

// ── OUTBOUND: OAuth-only -> reauth modal -> init?purpose=elevation -> persist + navigate ──

describe('Stage 2 outbound (OAuth-only OAuth-reauth start)', () => {
  it('O1 add_passkey: reauth via discord -> init action=add_passkey, persist {add_passkey}, navigate', async () => {
    const d = loadDashboard({ totp: false, hasPw: false, reauthProviders: ['discord'] })
    d.dispatchClick(clickTarget({ id: 'passkey-add-btn' }))
    await flush()
    await driveReauthProvider(d, 'discord')

    const init = d.calls.find(c => c.url.includes('/init?purpose=elevation'))
    if (!init) throw new Error('elevation init not called')
    expect(init.url).toBe('/api/auth/oauth/discord/init?purpose=elevation&action=add_passkey')
    const persisted = d.storageWrites.find(w => w.key === PENDING_KEY)
    if (!persisted) throw new Error('pending context not persisted')
    const ctx = JSON.parse(persisted.value) as { action: string; targetProvider?: string; ts: number }
    expect(ctx.action).toBe('add_passkey')
    expect(ctx.targetProvider).toBeUndefined()
    expect(typeof ctx.ts).toBe('number')
    expect(d.loc.href).toBe(ELEV_REDIRECT)
  })

  it('O2 bind_identity target=google: candidates exclude google; reauth via discord persists target', async () => {
    const d = loadDashboard({ totp: false, hasPw: false, reauthProviders: ['discord'] })
    d.dispatchClick(clickTarget({ dataset: { bind: 'google' } }))
    await flush()
    // google must NOT be offered as a reauth candidate (you can't reauth with the provider you're binding)
    expect(d.els['reauth-elev-btn-google']).toBeUndefined()
    await driveReauthProvider(d, 'discord')

    const init = d.calls.find(c => c.url.includes('/init?purpose=elevation'))
    if (!init) throw new Error('elevation init not called')
    expect(init.url).toBe('/api/auth/oauth/discord/init?purpose=elevation&action=bind_identity')
    const ctx = JSON.parse(d.storageWrites.find(w => w.key === PENDING_KEY)!.value) as { action: string; targetProvider?: string }
    expect(ctx.action).toBe('bind_identity')
    expect(ctx.targetProvider).toBe('google')
    expect(d.loc.href).toBe(ELEV_REDIRECT)
  })

  it('O3 no candidate (empty reauthProviders): guidance, no init, no persist, no navigate', async () => {
    const d = loadDashboard({ totp: false, hasPw: false, reauthProviders: [] })
    d.dispatchClick(clickTarget({ id: 'passkey-add-btn' }))
    await flush()
    expect(d.calls.some(c => c.url.includes('/init?purpose=elevation'))).toBe(false)
    expect(d.storageWrites.some(w => w.key === PENDING_KEY)).toBe(false)
    expect(d.loc.href).not.toBe(ELEV_REDIRECT)
    expect(d.els['bind-toast']?.textContent).toBeTruthy()
  })

  it('O4 init fails (no redirect_url): error shown, no persist, no navigate', async () => {
    const d = loadDashboard({ totp: false, hasPw: false, reauthProviders: ['discord'], initFail: true })
    d.dispatchClick(clickTarget({ id: 'wallet-add-btn' }))
    await flush()
    await driveReauthProvider(d, 'discord')
    expect(d.calls.some(c => c.url.includes('/init?purpose=elevation'))).toBe(true)
    expect(d.storageWrites.some(w => w.key === PENDING_KEY)).toBe(false)
    expect(d.loc.href).not.toBe(ELEV_REDIRECT)   // did NOT navigate
  })

  it('O5 persist fails (storage blocked, A2): no navigate', async () => {
    const d = loadDashboard({ totp: false, hasPw: false, reauthProviders: ['discord'], failPersist: true })
    d.dispatchClick(clickTarget({ id: 'passkey-add-btn' }))
    await flush()
    await driveReauthProvider(d, 'discord')
    expect(d.calls.some(c => c.url.includes('/init?purpose=elevation'))).toBe(true)
    expect(d.loc.href).not.toBe(ELEV_REDIRECT)
  })

  it('O6 known reauth candidate -> button rendered, encoded provider path used', async () => {
    const d = loadDashboard({ totp: false, hasPw: false, reauthProviders: ['discord'] })
    d.dispatchClick(clickTarget({ id: 'passkey-add-btn' }))
    await flush()
    expect(d.els['reauth-elev-btn-discord']).toBeDefined()
    await driveReauthProvider(d, 'discord')
    const init = d.calls.find(c => c.url.includes('/init?purpose=elevation'))
    expect(init?.url).toBe('/api/auth/oauth/discord/init?purpose=elevation&action=add_passkey')
  })

  it('O7 dismiss (cancel) while init in-flight -> no navigate, no persist (RACE-3)', async () => {
    const d = loadDashboard({ totp: false, hasPw: false, reauthProviders: ['discord'] })
    d.dispatchClick(clickTarget({ id: 'passkey-add-btn' }))
    await flush()
    const handler = d.els['reauth-elev-btn-discord']?.listeners['click']?.[0]
    if (typeof handler !== 'function') throw new Error('reauth provider handler not registered')
    const p = handler()                                   // provider click -> init apiFetch in-flight (not yet resolved)
    const cancel = d.els['reauth-elev-cancel']?.listeners['click']?.[0]
    if (typeof cancel === 'function') cancel()            // user dismisses (finish(null) -> settled=true) before init resolves
    await p
    await flush()
    expect(d.calls.some(c => c.url.includes('/init?purpose=elevation'))).toBe(true)   // init did fire...
    expect(d.loc.href).not.toBe(ELEV_REDIRECT)            // ...but post-cancel we must NOT navigate
    expect(d.storageWrites.some(w => w.key === PENDING_KEY)).toBe(false)              // and must NOT persist
  })
})

// ── RESUME: #elev_exchange -> exchange -> resume ceremony with the grant ──

describe('Stage 2 resume (#elev_exchange -> /elevation/exchange -> ceremony)', () => {
  it('R1 add_passkey: exchange then register-verify carries X-Factor-Add-Grant; fragment stripped, pending cleared', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'add_passkey', ts: Date.now() } })
    await flush()
    const exch = d.calls.find(c => c.url.includes('/elevation/exchange'))
    if (!exch) throw new Error('exchange not called')
    expect((JSON.parse(exch.init.body ?? '{}') as { code?: string }).code).toBe(CODE)
    expect(exch.init.skipRefresh).toBe(true)   // HR-F3
    const verify = d.calls.find(c => c.url.includes('register-verify'))
    if (!verify) throw new Error('register-verify not called (resume did not complete)')
    expect(verify.init.headers?.['X-Factor-Add-Grant']).toBe(GRANT)
    expect(d.replaceStateCalls).toBeGreaterThan(0)        // fragment stripped
    expect(d.storageRemoves).toContain(PENDING_KEY)       // pending cleared
  })

  it('R2 bind_identity: exchange then bindProvider(target) init?is_binding carries header + navigates', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'bind_identity', targetProvider: 'google', ts: Date.now() } })
    await flush()
    expect(d.calls.some(c => c.url.includes('/elevation/exchange'))).toBe(true)
    const init = d.calls.find(c => c.url.includes('/init?is_binding'))
    if (!init) throw new Error('binding init not called')
    expect(init.url).toBe('/api/auth/oauth/google/init?is_binding=true')
    expect(init.init.headers?.['X-Factor-Add-Grant']).toBe(GRANT)
    expect(d.loc.href).toBe('https://provider.example/oauth-bind')
  })

  it('R3 fragment present but no pending context: resume-lost, NO exchange call', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: null })
    await flush()
    expect(d.calls.some(c => c.url.includes('/elevation/exchange'))).toBe(false)
    expect(d.els['bind-toast']?.textContent).toBeTruthy()
  })

  it('R4 exchange returns no grant_token: fail-closed, no factor-add call', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'add_passkey', ts: Date.now() }, exchangeFail: true })
    await flush()
    expect(d.calls.some(c => c.url.includes('/elevation/exchange'))).toBe(true)
    expect(d.calls.some(c => c.url.includes('register-verify'))).toBe(false)
    expect(d.els['bind-toast']?.textContent).toBeTruthy()
  })

  it('R5 tampered action (not a FactorAddAction): resume-lost, NO exchange', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'bogus', ts: Date.now() } })
    await flush()
    expect(d.calls.some(c => c.url.includes('/elevation/exchange'))).toBe(false)
    expect(d.els['bind-toast']?.textContent).toBeTruthy()
  })

  it('R6 stale pending (ts beyond TTL): treated as absent -> resume-lost, NO exchange', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'add_passkey', ts: Date.now() - 11 * 60 * 1000 } })
    await flush()
    expect(d.calls.some(c => c.url.includes('/elevation/exchange'))).toBe(false)
    expect(d.els['bind-toast']?.textContent).toBeTruthy()
  })

  it('R7 bind_identity with targetProvider not in BIND_PROVIDERS: exchange happens but NO bindProvider dispatch', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'bind_identity', targetProvider: 'evil', ts: Date.now() } })
    await flush()
    expect(d.calls.some(c => c.url.includes('/elevation/exchange'))).toBe(true)   // action valid -> exchange runs
    expect(d.calls.some(c => c.url.includes('/init?is_binding'))).toBe(false)      // unknown target -> not dispatched
    expect(d.els['bind-toast']?.textContent).toBeTruthy()
  })

  it('R8 exchange uses skipRefresh:true (HR-F3)', async () => {
    const d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'bind_wallet', ts: Date.now() } })
    await flush()
    const exch = d.calls.find(c => c.url.includes('/elevation/exchange'))
    expect(exch?.init.skipRefresh).toBe(true)
  })

  it('L1 grant_token / exchange code never leak to storage / console / DOM', async () => {
    const spies = (['warn', 'log', 'error'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
    let d: Loaded
    try {
      d = loadDashboard({ hash: `#elev_exchange=${CODE}`, pending: { action: 'add_passkey', ts: Date.now() } })
      await flush()
    } finally {
      for (const s of spies) s.mockRestore()
    }
    // sanity: resume ran end-to-end
    expect(d!.calls.some(c => c.url.includes('register-verify') && c.init.headers?.['X-Factor-Add-Grant'] === GRANT)).toBe(true)
    // grant + code must never be persisted, logged, or rendered
    expect(d!.storageWrites.some(w => w.value.includes(GRANT) || w.value.includes(CODE))).toBe(false)
    const consoleOut = spies.flatMap(s => s.mock.calls).flat().map(a => String(a)).join(' ')
    expect(consoleOut.includes(GRANT)).toBe(false)
    expect(consoleOut.includes(CODE)).toBe(false)
    expect(Object.values(d!.els).some(el => [el.textContent, el.innerHTML, el.value].some(s => s.includes(GRANT) || s.includes(CODE)))).toBe(false)
  })
})

// ── elev_error full set (callback failure -> ?elev_error=) clears pending + strips URL ──

describe('Stage 2 elev_error full-set handling (checkBindResult)', () => {
  // Stage 2 delta: the old code only handled reverification_required. Each value must now strip the
  // URL (replaceState) AND clear stale pending context (removeItem) -- the regression-critical
  // effects. The localized toast is deferred (setTimeout 600) and i18n-covered; one comparison case
  // below proves distinct ELEV_ERR_KEY mapping.
  const cases = ['provider_mismatch', 'rate_limited', 'invalid_state', 'reverification_required', 'somethingunknown']
  for (const code of cases) {
    it(`E:${code} -> URL stripped + pending cleared`, () => {
      const d = loadDashboard({ search: `?elev_error=${code}`, pending: { action: 'add_passkey', ts: Date.now() } })
      expect(d.replaceStateCalls).toBeGreaterThan(0)
      expect(d.storageRemoves).toContain(PENDING_KEY)
    })
  }

  it('E:distinct keys (provider_mismatch vs rate_limited) fire different localized toast text', async () => {
    const dA = loadDashboard({ search: '?elev_error=provider_mismatch' })
    const dB = loadDashboard({ search: '?elev_error=rate_limited' })
    await realWait(700)   // toast is showBindToast(..., 600ms)
    const a = dA.els['bind-toast']?.textContent ?? ''
    const b = dB.els['bind-toast']?.textContent ?? ''
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)   // distinct ELEV_ERR_KEY mapping (not all collapsing to one)
  })
})
