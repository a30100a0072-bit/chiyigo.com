/**
 * SEC-FACTOR-ADD Stage 1 — dashboard factor-add caller wiring test (ChatGPT Arch Gate C2).
 *
 * Locks the root cause: addPasskey / addWallet / bindProvider previously called
 * register-verify / wallet/verify / init?is_binding with NO X-Factor-Add-Grant header
 * (the SEC-FACTOR-ADD-A series never shipped a frontend-wiring PR), so all three 403'd in
 * prod since #78. Here we assert, at the apiFetch REQUEST BOUNDARY, that each caller
 *   (1) first mints a grant via /elevation/{totp,password} with the CORRECT action, and
 *   (2) sends that grant on the factor-add request via the X-Factor-Add-Grant header.
 * OAuth-only (no TOTP, no password) -> guidance only, no elevation / factor-add call.
 *
 * Harness mirrors tests/api-session-revoked.test.ts: vm.compileFunction over the SHIPPED
 * bundle public/js/dashboard.js with injected browser-global stubs (no jsdom). loadProfile()
 * bails immediately because sessionStorage has no access_token (and it uses raw fetch, not
 * window.apiFetch), so load-time does no network / rendering and the apiFetch spy is hit
 * ONLY by the callers. Depends on the build artifact — run build:partials after editing src.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

const DASHBOARD_JS = readFileSync(fileURLToPath(new URL('../public/js/dashboard.js', import.meta.url)), 'utf8')

const GRANT = 'grant-token-XYZ'
const ADDR = '0x' + 'a'.repeat(40)

interface ReqInit { method?: string; headers?: Record<string, string>; body?: string }
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
    getContext() { return null },   // canvas init bails on null 2d context
    click() { el.emit('click', { target: el }) },
  }
  return el
}

/** A synthetic click target whose .closest() routes the dashboard delegated click handler. */
function clickTarget(props: { id?: string; dataset?: Record<string, string> }): StubEl {
  const el = makeEl(props.id ?? '')
  Object.assign(el.dataset, props.dataset ?? {})
  // handler first probes '[data-toggle-pwd]' (must miss), then the routing selector (must hit).
  el.closest = (sel: string) => (sel.includes('toggle-pwd') ? null : el)
  return el
}

interface Loaded {
  els: Record<string, StubEl>
  calls: Array<{ url: string; init: ReqInit }>
  loc: { href: string; protocol: string; search: string; replace(u: string): void; assign(u: string): void }
  storageWrites: Array<{ key: string; value: string }>
  dispatchClick(target: StubEl): void
}

function loadDashboard(opts: { totp: boolean; hasPw: boolean }): Loaded {
  const els: Record<string, StubEl> = {}
  const getEl = (id: string): StubEl => (els[id] ||= makeEl(id))
  const calls: Array<{ url: string; init: ReqInit }> = []

  const apiFetch = async (url: string, init?: ReqInit): Promise<unknown> => {
    calls.push({ url, init: init ?? {} })
    if (url.startsWith('/api/auth/elevation/')) return { grant_token: GRANT, expires_in: 300 }
    if (url.includes('register-options')) return { challenge: 'AAAA', user: { id: 'AAAA', name: 'a', displayName: 'a' }, rp: { id: 'r', name: 'r' }, pubKeyCredParams: [], excludeCredentials: [] }
    if (url.includes('register-verify')) return { id: 1, created_at: 'now' }
    if (url.includes('wallet/nonce')) return { domain: 'chiyigo.com', uri: 'https://chiyigo.com', chain_id: 1, nonce: 'nonce123', expires_at: '2099-01-01 00:00:00', address: ADDR }
    if (url.includes('wallet/verify')) return { id: 1, address: ADDR, chain_id: 1 }
    if (url.includes('/init?is_binding')) return { redirect_url: 'https://provider.example/oauth' }
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

  const loc = { href: '', protocol: 'https:', search: '', replace() {}, assign() {} }
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

  // NOTE: __totpEnabled / __hasPassword are intentionally absent during load — on the real site
  // they are undefined until loadProfile() resolves, so applyLangD()'s `typeof __hasPassword !==
  // 'undefined'` guard skips the render path at load. We set them AFTER run() (below).
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
  const recordSet = (key: string, value: string) => { storageWrites.push({ key, value }) }
  const sessionStorage = { getItem: (): string | null => null, setItem: recordSet, removeItem() {} }
  const localStorage = { getItem: (): string | null => null, setItem: recordSet, removeItem() {} }
  const history = { replaceState() {}, pushState() {} }
  const getComputedStyle = () => ({ getPropertyValue: () => '' })
  class MutationObserver { observe() {} disconnect() {} takeRecords(): unknown[] { return [] } }

  // run the shipped bundle with injected stubs (free identifiers window/document/... bind to params).
  const run = compileFunction(DASHBOARD_JS, ['window', 'document', 'location', 'navigator', 'history', 'sessionStorage', 'localStorage', 'getComputedStyle', 'MutationObserver'])
  run(win, doc, loc, navigator, history, sessionStorage, localStorage, getComputedStyle, MutationObserver)

  // post-load: set the account-capability hints the callers branch on (as loadProfile would).
  win.__totpEnabled = opts.totp
  win.__hasPassword = opts.hasPw

  return { els, calls, loc, storageWrites, dispatchClick: (target) => { for (const fn of clickHandlers) fn({ target }) } }
}

const tick = (): Promise<void> => new Promise(r => { setTimeout(r, 0) })
async function flush(): Promise<void> { for (let i = 0; i < 6; i++) await tick() }

/** openElevationModal builds its DOM synchronously in the Promise executor, so the submit
 * handler is already registered by the time dispatchClick returns. Fill the input + fire it. */
async function driveModalSubmit(d: Loaded, code = '123456'): Promise<void> {
  const submitEl = d.els['elevation-submit']
  if (!submitEl) throw new Error('elevation modal did not open (no #elevation-submit)')
  const input = d.els['elevation-input']
  if (input) input.value = code
  const handler = submitEl.listeners['click']?.[0]
  if (typeof handler !== 'function') throw new Error('elevation submit handler not registered')
  await handler()
  await flush()
}

function bodyAction(call: { init: ReqInit }): string | undefined {
  return (JSON.parse(call.init.body ?? '{}') as { action?: string }).action
}

describe('dashboard factor-add caller wiring (SEC-FACTOR-ADD Stage 1, Arch Gate C2)', () => {
  it('add_passkey: mints grant (action=add_passkey) then sends X-Factor-Add-Grant on register-verify', async () => {
    const d = loadDashboard({ totp: true, hasPw: true })
    d.dispatchClick(clickTarget({ id: 'passkey-add-btn' }))
    await driveModalSubmit(d)

    const elev = d.calls.find(c => c.url.startsWith('/api/auth/elevation/'))
    if (!elev) throw new Error('no elevation call')
    expect(elev.url).toBe('/api/auth/elevation/totp')
    expect(bodyAction(elev)).toBe('add_passkey')

    const verify = d.calls.find(c => c.url.includes('register-verify'))
    if (!verify) throw new Error('register-verify was not called (ceremony did not complete)')
    expect(verify.init.headers?.['X-Factor-Add-Grant']).toBe(GRANT)
  })

  it('bind_wallet: mints grant (action=bind_wallet) then sends X-Factor-Add-Grant on wallet/verify', async () => {
    const d = loadDashboard({ totp: true, hasPw: true })
    d.dispatchClick(clickTarget({ id: 'wallet-add-btn' }))
    await driveModalSubmit(d)

    const elev = d.calls.find(c => c.url.startsWith('/api/auth/elevation/'))
    if (!elev) throw new Error('no elevation call')
    expect(bodyAction(elev)).toBe('bind_wallet')

    const verify = d.calls.find(c => c.url.includes('wallet/verify'))
    if (!verify) throw new Error('wallet/verify was not called')
    expect(verify.init.headers?.['X-Factor-Add-Grant']).toBe(GRANT)
  })

  it('bind_identity: mints grant (action=bind_identity), sends header on init?is_binding, then navigates', async () => {
    const d = loadDashboard({ totp: true, hasPw: true })
    d.dispatchClick(clickTarget({ dataset: { bind: 'discord' } }))
    await driveModalSubmit(d)

    const elev = d.calls.find(c => c.url.startsWith('/api/auth/elevation/'))
    if (!elev) throw new Error('no elevation call')
    expect(bodyAction(elev)).toBe('bind_identity')

    const init = d.calls.find(c => c.url.includes('/init?is_binding'))
    if (!init) throw new Error('init?is_binding was not called')
    expect(init.url).toBe('/api/auth/oauth/discord/init?is_binding=true')
    expect(init.init.headers?.['X-Factor-Add-Grant']).toBe(GRANT)
    // C1 transport: header rode the apiFetch; navigation is the separate window.location.href step.
    expect(d.loc.href).toBe('https://provider.example/oauth')
  })

  it('OAuth-only (no TOTP, no password): shows guidance, makes NO elevation / factor-add call', async () => {
    const d = loadDashboard({ totp: false, hasPw: false })
    d.dispatchClick(clickTarget({ dataset: { bind: 'discord' } }))
    await flush()

    expect(d.calls.some(c => c.url.startsWith('/api/auth/elevation/'))).toBe(false)
    expect(d.calls.some(c => c.url.includes('/init?is_binding'))).toBe(false)
    // guidance toast was rendered (factor_add_no_channel)
    expect(d.els['bind-toast']?.textContent).toBeTruthy()
  })

  it('grant_token never leaks to storage / console / the DOM (SR #3)', async () => {
    const d = loadDashboard({ totp: true, hasPw: true })
    const spies = (['warn', 'log', 'error'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      d.dispatchClick(clickTarget({ id: 'passkey-add-btn' }))
      await driveModalSubmit(d)
    } finally {
      for (const s of spies) s.mockRestore()
    }
    // sanity: the flow really ran end-to-end (grant was sent on the factor-add request)
    expect(d.calls.some(c => c.url.includes('register-verify') && c.init.headers?.['X-Factor-Add-Grant'] === GRANT)).toBe(true)
    // the one-time grant must never be persisted, logged, or rendered (XSS / extension / log exfil)
    expect(d.storageWrites.some(w => w.value.includes(GRANT))).toBe(false)
    const consoleOut = spies.flatMap(s => s.mock.calls).flat().map(a => String(a)).join(' ')
    expect(consoleOut.includes(GRANT)).toBe(false)
    expect(Object.values(d.els).some(el => [el.textContent, el.innerHTML, el.value].some(s => s.includes(GRANT)))).toBe(false)
  })
})
