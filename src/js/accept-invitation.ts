// accept-invitation.ts — 組織邀請接受頁（PR4 invitation accept flow 前端）
//
// CSP：外部 classic script（無 inline）；i18n sentinel 由 build 注入。
// 依賴 /js/api.js（window.apiFetch / window.silentRefresh）— HTML 必須在本檔之前載入 api.js。
//
// 設計重點（why）：
//   - 點擊才 POST，不在載入時自動核銷：避免郵件代理 / 預載提前消耗一次性邀請 token。
//   - 未登入 → 把回跳路徑寫進 sessionStorage('auth_redirect') 後導去「乾淨的」/login.html，
//     token 不放進 login URL：登入頁會載第三方資源（CF beacon / Fonts / Turnstile），
//     不該讓 bearer-like 邀請 token 出現在那頁的 URL（history / access log 足跡）。
//     auth-ui.ts redirectAfterAuth() 會優先讀 auth_redirect 回跳本頁。
//   - accept 需登入態（後端 requireRegularAccessToken）：用 window.apiFetch（沿用其內建
//     silent-refresh→retry，與全站一致）。session 終局失效時 apiFetch 會清 token 並導去 /login.html；
//     因已預先寫好 auth_redirect，使用者登入後會回到本頁繼續接受（避免「邀請走丟」），故不自管 retry。
//   - 後端 error code → 本頁自有 i18n 字典（不動 shared api.ts 全站錯誤字典，縮小 blast radius）。
//
// Stage 5：page entry 必 IIFE 包頂層（classic module:"none" + moduleDetection:"auto" 下避免全域撞名）。
;(function () {
// ── i18n ─────────────────────────────────────────────────────
const I18N = /*@i18n@*/{};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

function applyLang(lang) {
  try { localStorage.setItem('lang', lang) } catch {}
  document.documentElement.lang = lang;
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (k && dict[k] != null) el.textContent = dict[k];
  });
  document.querySelectorAll<HTMLElement>('.lang-opt,.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  // theme/lang 切換交給 sidebar-auth.js + 下方 IIFE
});

// ── 接受邀請流程 ─────────────────────────────────────────────
(function () {
  const params = new URLSearchParams(location.search)
  const token  = params.get('token')

  const panels = {
    loading: document.getElementById('panel-loading'),
    confirm: document.getElementById('panel-confirm'),
    login:   document.getElementById('panel-login'),
    success: document.getElementById('panel-success'),
    error:   document.getElementById('panel-error'),
  }
  function show(name: string) {
    Object.values(panels).forEach(p => { if (p) p.classList.remove('active') })
    const el = panels[name]; if (el) el.classList.add('active')
  }
  function setError(msg: string) {
    const el = document.getElementById('err-msg'); if (el) el.textContent = msg
    show('error')
  }

  // 後端 res({ code }) → 本頁 i18n key。未對應的 code fallback 後端 message，再 fallback 通用句。
  const CODE_KEY: Record<string, string> = {
    INVITATION_NOT_FOUND:   'err_not_found',
    INVITATION_EXPIRED:     'err_expired',
    INVITE_EMAIL_MISMATCH:  'err_email_mismatch',
    MEMBERSHIP_NOT_ACTIVE:  'err_membership_inactive',
    INVITATION_NOT_PENDING: 'err_not_pending',
    ALREADY_MEMBER:         'err_already_member',
    TENANT_INELIGIBLE:      'err_tenant_ineligible',
    RATE_LIMITED:           'err_rate_limited',
    ERR_VALIDATION:         'err_validation',
    INVALID_JSON:           'err_validation',
  }

  // ApiError 結構窄化（不用 instanceof / any：prod tsconfig types:[] 下保持穩健）
  function statusOf(e: unknown): number | null {
    if (e && typeof e === 'object' && 'status' in e) {
      const s = (e as { status?: unknown }).status
      return typeof s === 'number' ? s : null
    }
    return null
  }
  function messageFor(e: unknown): string {
    let code = ''
    if (e && typeof e === 'object' && 'code' in e) {
      const c = (e as { code?: unknown }).code
      if (typeof c === 'string') code = c
    }
    const key = CODE_KEY[code]
    if (key) return T(key)
    if (e && typeof e === 'object' && 'message' in e) {
      const m = (e as { message?: unknown }).message
      if (typeof m === 'string' && m) return m
    }
    return T('err_default')
  }

  // 是否有有效登入態：sessionStorage 有 access_token，否則委派 window.silentRefresh（HttpOnly cookie）。
  // silentRefresh 由 api.js 提供且已 navigator.locks 去重，與 sidebar-auth.js 同時呼叫共用同一 inflight。
  async function ensureSession(): Promise<boolean> {
    try { if (sessionStorage.getItem('access_token')) return true } catch { /* storage blocked */ }
    if (typeof window.silentRefresh === 'function') {
      try { return await window.silentRefresh() } catch { return false }
    }
    return false
  }

  // 回跳脈絡：把本頁（含 token）寫進 same-origin sessionStorage('auth_redirect')；導去登入後
  // auth-ui.ts redirectAfterAuth() 會優先讀它回跳本頁。token 只進 sessionStorage、不進 login URL，
  // 避免在載第三方資源（CF beacon / Fonts / Turnstile）的登入頁留下 bearer-like token 足跡。
  function rememberReturn() {
    try { sessionStorage.setItem('auth_redirect', location.pathname + location.search) } catch { /* storage blocked */ }
  }
  function clearReturn() {
    try { sessionStorage.removeItem('auth_redirect') } catch { /* storage blocked */ }
  }
  function goLogin() {
    // 先清掉本分頁（可能是錯帳號）的 access_token，否則 /login.html 的 login-boot 看到 token 仍在，
    // 會直接讀 auth_redirect 並 location.replace 回本頁 → accept→login→accept 迴圈，永遠換不了帳號。
    // 只清 per-tab sessionStorage token（不碰 refresh cookie / 不跨分頁）：login 頁因此顯示表單。
    try { sessionStorage.removeItem('access_token') } catch { /* storage blocked */ }
    rememberReturn()
    location.href = '/login.html'
  }

  async function doAccept(): Promise<void> {
    if (typeof window.apiFetch !== 'function') { setError(T('err_network')); return }
    show('loading')
    // 預先記回跳：session 失效時 apiFetch 會清 token 並導去 /login.html，auth_redirect 讓使用者
    // 登入後回到本頁繼續接受（避免「邀請走丟」）。沿用 apiFetch 內建 silent-refresh→retry，
    // 與全站一致；不自管 retry（會撞上 silentRefresh 對既有 token 的 short-circuit guard）。
    rememberReturn()
    try {
      await window.apiFetch('/api/invitations/accept', {
        method: 'POST',
        body:   JSON.stringify({ token }),
      })
    } catch (e) {
      // 終局 401：apiFetch 已 refresh 失敗並正在導向 /login.html（auth_redirect 回跳本頁）；不蓋 error 面板。
      if (statusOf(e) === 401) return
      clearReturn()
      setError(messageFor(e)); return
    }
    clearReturn()
    show('success')
  }

  // 按鈕先綁（即使缺 token：dashboard / 重新登入按鈕仍須可用，不留 dead button）。
  document.getElementById('btn-accept')?.addEventListener('click', () => { void doAccept() })
  document.getElementById('btn-login')?.addEventListener('click', goLogin)
  document.getElementById('btn-relogin')?.addEventListener('click', goLogin)

  // 缺 token：直接錯誤態，不進登入閘門。
  if (!token) { setError(T('err_missing')); return }

  // 初始閘門：已登入 → 顯示「接受」面板；未登入 → 顯示「先登入」面板。
  void ensureSession().then(loggedIn => { show(loggedIn ? 'confirm' : 'login') })
})();

// ── Mobile overlay (m-ham-btn / m-overlay open-close) ──
(function () {
  const hamBtn  = document.getElementById('m-ham-btn');
  const overlay = document.getElementById('m-overlay');
  const topbar  = document.getElementById('m-topbar');
  function openMenu() {
    hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open');
    overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden');
    topbar?.classList.add('menu-open'); document.body.classList.add('body-lock');
  }
  function closeMenu() {
    hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open');
    overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
    topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock');
  }
  hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
  overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });
})();

// ── theme toggle + lang dropdown (sidebar / mobile topbar) ──
(function () {
  function applyTheme(dark) {
    document.documentElement.classList.toggle('theme-dark', dark);
    document.documentElement.classList.toggle('theme-light', !dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  }
  const toggleTheme = () => applyTheme(!document.documentElement.classList.contains('theme-dark'));
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
  document.getElementById('m-theme-btn')?.addEventListener('click', toggleTheme);

  const langDrop  = document.getElementById('lang-dropdown');
  const mLangDrop = document.getElementById('m-top-lang-drop');
  document.getElementById('lang-toggle-btn')?.addEventListener('click', e => {
    e.stopPropagation(); langDrop?.classList.toggle('open'); mLangDrop?.classList.remove('open');
  });
  document.getElementById('m-lang-btn')?.addEventListener('click', e => {
    e.stopPropagation(); mLangDrop?.classList.toggle('open'); langDrop?.classList.remove('open');
  });
  document.addEventListener('click', () => {
    langDrop?.classList.remove('open');
    mLangDrop?.classList.remove('open');
  });
  langDrop?.addEventListener('click', e => {
    const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang); langDrop.classList.remove('open');
  });
  mLangDrop?.addEventListener('click', e => {
    const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang); mLangDrop.classList.remove('open');
  });
  document.querySelector('.m-ov-lang-row')?.addEventListener('click', e => {
    const opt = (e.target as Element | null)?.closest<HTMLElement>('.m-ov-lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang);
  });
})();
})();
