/**
 * apiFetch — 包一層 fetch，把後端觀測性接好：
 *   - 自動帶 Authorization: Bearer <access_token>（從 sessionStorage）
 *   - 自動帶 Content-Type: application/json（POST/PUT/DELETE 且有 body）
 *   - credentials: 'include'（讓 refresh cookie 帶上）
 *   - 失敗時拋 ApiError({ status, traceId, code, message, body })
 *   - window.__lastTraceId 永遠保留最近一次回應的 X-Request-Id（給錯誤回報附帶）
 *
 * 用法：
 *   import 不用，直接 <script src="/js/api.js"></script> 後 window.apiFetch / window.ApiError
 *
 *   try {
 *     const data = await apiFetch('/api/auth/me')
 *   } catch (e) {
 *     // e.traceId 可給用戶回報
 *     showToast(`${e.message}（編號 ${e.traceId ?? '—'}）`)
 *   }
 *
 * 漸進遷移：頁面原有 fetch 不必馬上換，需要錯誤可追溯時再改用 apiFetch。
 */
;(function () {
  'use strict'

  // 同 auth-ui.js：每瀏覽器一次性 web-<uuid>，給 /api/auth/refresh X-Device-Id 用
  function _chiyigoGetDeviceUuid() {
    var KEY = 'chiyigo.device_uuid'
    try {
      var v = localStorage.getItem(KEY)
      if (v && /^web-[0-9a-f-]{36}$/i.test(v)) return v
    } catch (_) {}
    if (window.__chiyigoMemoryDeviceUuid) return window.__chiyigoMemoryDeviceUuid
    var uuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID() : null
    if (!uuid) return null
    var fullUuid = 'web-' + uuid
    try { localStorage.setItem(KEY, fullUuid) }
    catch (_) { window.__chiyigoMemoryDeviceUuid = fullUuid }
    return fullUuid
  }

  class ApiError extends Error {
    constructor({ status, traceId, code, message, body }) {
      super(message || `HTTP ${status}`)
      this.name    = 'ApiError'
      this.status  = status
      this.traceId = traceId ?? null
      this.code    = code    ?? null
      this.body    = body    ?? null
    }
  }

  function getAccessToken() {
    try { return sessionStorage.getItem('access_token') } catch { return null }
  }

  // 內部 silent refresh：用 HttpOnly cookie 換新 access_token；
  // P0-11：全站收斂到此單一 implementation —
  //   1. tab 內 _refreshInflight 共用同一 Promise（thundering herd）
  //   2. 跨 tab 用 navigator.locks('chiyigo-auth-refresh')，避免多分頁同時 rotate
  //      導致第一個 refresh 拿到的 token 被第二個請求 revoke（device-bound rotation）
  // 公開為 window.silentRefresh，auth-ui.js / sidebar-auth.js / dashboard.js 全走這個。
  const LOCK_NAME = 'chiyigo-auth-refresh'
  let _refreshInflight = null

  async function _doRefreshOnce() {
    try {
      const _devId = _chiyigoGetDeviceUuid()
      const r = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include',
        headers: Object.assign({ 'Content-Type': 'application/json' }, _devId ? { 'X-Device-Id': _devId } : {}),
        body: '{}',
      })
      if (!r.ok) return false
      const data = await r.json().catch(() => null)
      if (data?.access_token) {
        try { sessionStorage.setItem('access_token', data.access_token) } catch { /* ignore */ }
        return true
      }
      return false
    } catch { return false }
  }

  async function _silentRefresh() {
    if (_refreshInflight) return _refreshInflight
    _refreshInflight = (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.locks) {
          // 進到 lock 後再檢一次：別的分頁可能在我等 lock 時已 rotate 並把 token broadcast 過來
          return await navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, async () => {
            try {
              const tok = sessionStorage.getItem('access_token')
              if (tok) return true
            } catch { /* ignore */ }
            return _doRefreshOnce()
          })
        }
        return await _doRefreshOnce()
      } finally { setTimeout(() => { _refreshInflight = null }, 0) }
    })()
    return _refreshInflight
  }

  function _redirectToLogin() {
    try { sessionStorage.removeItem('access_token') } catch { /* ignore */ }
    // 防 redirect loop：本身就在 login 頁不再跳
    if (!/\/login(\.html)?$/.test(location.pathname)) {
      location.href = '/login.html'
    }
  }

  async function _doFetch(url, init) {
    const opts = { ...init }
    opts.headers = new Headers(opts.headers || {})
    opts.credentials = opts.credentials ?? 'include'

    // 自動 Authorization（不覆寫 caller 已給的；step-up token 會手動帶就跳過自動帶）
    if (!opts.headers.has('Authorization')) {
      const tok = getAccessToken()
      if (tok) opts.headers.set('Authorization', 'Bearer ' + tok)
    }

    // 有 body 但沒 Content-Type → 預設 JSON
    if (opts.body && !opts.headers.has('Content-Type')) {
      opts.headers.set('Content-Type', 'application/json')
    }

    return fetch(url, opts)
  }

  async function apiFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const skipRefresh = init?.skipRefresh === true  // step-up / refresh / login 自己呼叫不走 retry

    let res
    try {
      res = await _doFetch(url, init)
    } catch (netErr) {
      throw new ApiError({
        status: 0, traceId: null, code: 'NETWORK_ERROR',
        message: netErr?.message || 'Network error',
      })
    }

    // 401 → silent refresh → retry 一次；refresh 失敗或 retry 還 401 → redirect login
    if (res.status === 401 && !skipRefresh) {
      const refreshed = await _silentRefresh()
      if (!refreshed) {
        _redirectToLogin()
        throw new ApiError({ status: 401, traceId: res.headers.get('X-Request-Id'), code: 'SESSION_EXPIRED', message: 'Session expired' })
      }
      try { res = await _doFetch(url, init) } catch (netErr) {
        throw new ApiError({ status: 0, traceId: null, code: 'NETWORK_ERROR', message: netErr?.message || 'Network error' })
      }
      if (res.status === 401) {
        _redirectToLogin()
        throw new ApiError({ status: 401, traceId: res.headers.get('X-Request-Id'), code: 'SESSION_EXPIRED', message: 'Session expired' })
      }
    }

    const traceId = res.headers.get('X-Request-Id')
    if (traceId) {
      try { window.__lastTraceId = traceId } catch { /* ignore */ }
    }

    // 嘗試解析 JSON（失敗就回 text）
    const ct = res.headers.get('Content-Type') || ''
    let body = null
    if (ct.includes('application/json')) {
      try { body = await res.json() } catch { body = null }
    } else {
      try { body = await res.text() } catch { body = null }
    }

    if (!res.ok) {
      throw new ApiError({
        status:  res.status,
        traceId,
        code:    body?.code    ?? null,
        message: body?.error   ?? body?.message ?? `HTTP ${res.status}`,
        body,
      })
    }

    return body
  }

  // ── API 錯誤 i18n（code-based，全站共用）─────────────────────
  // 後端 res({ error, code, ... }) 的 code 對應到此處 → 4 語翻譯。
  // 動態欄位用 {name} 模板，從 e.body 取（例：COOLDOWN 的 {retry_after}）。
  // 漸進遷移：handler 未附 code 時，BACKEND_ERR_LEGACY_MAP 把舊英文 string 映射到 code。
  // Phase A 種子：dashboard 舊 8 碼 + auth-ui 舊 12 碼 + 2026-05-12 prod 驗到的 RISK_BLOCKED / COOLDOWN。
  const API_ERROR_I18N = {
    'zh-TW': {
      INVALID_OTP:               '驗證碼錯誤',
      TOTP_REQUIRED:             '需要兩步驟驗證碼',
      TOKEN_REVOKED:             '登入狀態已失效，請重新登入',
      SESSION_EXPIRED:           '登入狀態已失效，請重新登入',
      UNAUTHORIZED:              '未授權，請重新登入',
      RATE_LIMITED:              '請求次數過多，請稍後再試',
      ACCOUNT_BANNED:            '此帳號已被停用，請聯繫客服',
      BAD_PASSWORD:              '密碼錯誤',
      USER_NOT_FOUND:            '找不到帳號',
      INVALID_CREDENTIALS:       '帳號或密碼錯誤',
      CAPTCHA_FAILED:            '人機驗證失敗，請重新整理頁面再試',
      LOCAL_ACCOUNT_NOT_FOUND:   '此帳號無法使用密碼登入',
      INVALID_EMAIL:             '信箱格式不正確',
      EMAIL_ALREADY_REGISTERED:  '此信箱已被註冊，請直接登入',
      PASSWORD_TOO_SHORT:        '密碼至少需要 8 個字元',
      WEAK_PASSWORD:             '密碼長度需 ≥12 字元，或 ≥8 字元並包含「大寫字母 / 小寫字母 / 數字 / 符號」其中 3 類。',
      TFA_ALREADY_ENABLED:       '雙重驗證已啟用',
      INVALID_REQUEST:           '請求無效，請重新登入',
      PKCE_EXPIRED:              '授權階段已失效或過期，請重新登入',
      RISK_BLOCKED:              '登入風險過高，已暫時封鎖。請查看 email 取得詳細說明。',
      COOLDOWN:                  '請稍候 {retry_after} 秒後再試。',
      NETWORK_ERROR:             '網路錯誤，請檢查連線後重試',
      INVALID_JSON:              '請求格式錯誤，請重新整理頁面再試',
      EMAIL_REQUIRED:            '請輸入信箱',
      EMAIL_PASSWORD_REQUIRED:   '請輸入信箱與密碼',
      INVALID_EMAIL_FORMAT:      '信箱格式不正確',
      TOKEN_AND_PASSWORD_REQUIRED: '連結無效，請重新發起密碼重設',
      TOKEN_INVALID_OR_EXPIRED:  '連結已失效或過期，請重新發起密碼重設',
      ACCOUNT_NOT_FOUND:         '找不到帳號',
      TFA_VERIFICATION_REQUIRED: '請輸入兩步驟驗證碼',
    },
    en: {
      INVALID_OTP:               'Invalid code, please try again',
      TOTP_REQUIRED:             'Two-factor verification required',
      TOKEN_REVOKED:             'Session expired, please log in again',
      SESSION_EXPIRED:           'Session expired, please log in again',
      UNAUTHORIZED:              'Unauthorized, please log in again',
      RATE_LIMITED:              'Too many requests, please try again later',
      ACCOUNT_BANNED:            'This account has been suspended, please contact support',
      BAD_PASSWORD:              'Incorrect password',
      USER_NOT_FOUND:            'Account not found',
      INVALID_CREDENTIALS:       'Invalid email or password',
      CAPTCHA_FAILED:            'Captcha verification failed, please refresh the page and try again',
      LOCAL_ACCOUNT_NOT_FOUND:   'This account cannot log in with password',
      INVALID_EMAIL:             'Invalid email format',
      EMAIL_ALREADY_REGISTERED:  'Email already registered, please log in',
      PASSWORD_TOO_SHORT:        'Password must be at least 8 characters',
      WEAK_PASSWORD:             'Password must be ≥12 chars, or ≥8 chars and contain 3 of: uppercase / lowercase / digit / symbol.',
      TFA_ALREADY_ENABLED:       'Two-factor authentication is already enabled',
      INVALID_REQUEST:           'Invalid request, please log in again',
      PKCE_EXPIRED:              'Authorization session is invalid or expired, please log in again',
      RISK_BLOCKED:              'Login blocked due to high risk. Please check your email for details.',
      COOLDOWN:                  'Please wait {retry_after} seconds before retrying.',
      NETWORK_ERROR:             'Network error, please check your connection and retry',
      INVALID_JSON:              'Invalid request format, please refresh the page and try again',
      EMAIL_REQUIRED:            'Email is required',
      EMAIL_PASSWORD_REQUIRED:   'Email and password are required',
      INVALID_EMAIL_FORMAT:      'Invalid email format',
      TOKEN_AND_PASSWORD_REQUIRED: 'Invalid link, please request a new password reset',
      TOKEN_INVALID_OR_EXPIRED:  'Link is invalid or expired, please request a new password reset',
      ACCOUNT_NOT_FOUND:         'Account not found',
      TFA_VERIFICATION_REQUIRED: 'Two-factor verification code required',
    },
    ja: {
      INVALID_OTP:               '認証コードが正しくありません',
      TOTP_REQUIRED:             '二段階認証コードが必要です',
      TOKEN_REVOKED:             'セッションの有効期限が切れました。再度ログインしてください',
      SESSION_EXPIRED:           'セッションの有効期限が切れました。再度ログインしてください',
      UNAUTHORIZED:              '認証されていません。再度ログインしてください',
      RATE_LIMITED:              'リクエストが多すぎます。しばらくしてから再度お試しください',
      ACCOUNT_BANNED:            'このアカウントは停止されています。サポートまでご連絡ください',
      BAD_PASSWORD:              'パスワードが正しくありません',
      USER_NOT_FOUND:            'アカウントが見つかりません',
      INVALID_CREDENTIALS:       'メールアドレスまたはパスワードが正しくありません',
      CAPTCHA_FAILED:            'ボット認証に失敗しました。ページを再読み込みしてからお試しください',
      LOCAL_ACCOUNT_NOT_FOUND:   'このアカウントはパスワードログインに対応していません',
      INVALID_EMAIL:             'メールアドレスの形式が正しくありません',
      EMAIL_ALREADY_REGISTERED:  'このメールアドレスは既に登録されています。ログインしてください',
      PASSWORD_TOO_SHORT:        'パスワードは8文字以上で入力してください',
      WEAK_PASSWORD:             'パスワードは12文字以上、または8文字以上で「大文字 / 小文字 / 数字 / 記号」のうち3種を含めてください。',
      TFA_ALREADY_ENABLED:       '2段階認証は既に有効です',
      INVALID_REQUEST:           'リクエストが無効です。再度ログインしてください',
      PKCE_EXPIRED:              '認可セッションが無効または期限切れです。再度ログインしてください',
      RISK_BLOCKED:              'リスクが高いためログインをブロックしました。詳細はメールをご確認ください。',
      COOLDOWN:                  '{retry_after} 秒後に再度お試しください。',
      NETWORK_ERROR:             'ネットワークエラーです。接続を確認してもう一度お試しください',
      INVALID_JSON:              'リクエスト形式が無効です。ページを再読み込みしてからお試しください',
      EMAIL_REQUIRED:            'メールアドレスを入力してください',
      EMAIL_PASSWORD_REQUIRED:   'メールアドレスとパスワードを入力してください',
      INVALID_EMAIL_FORMAT:      'メールアドレスの形式が正しくありません',
      TOKEN_AND_PASSWORD_REQUIRED: 'リンクが無効です。パスワードの再設定をやり直してください',
      TOKEN_INVALID_OR_EXPIRED:  'リンクの有効期限が切れています。パスワードの再設定をやり直してください',
      ACCOUNT_NOT_FOUND:         'アカウントが見つかりません',
      TFA_VERIFICATION_REQUIRED: '二段階認証コードを入力してください',
    },
    ko: {
      INVALID_OTP:               '인증 코드가 올바르지 않습니다',
      TOTP_REQUIRED:             '2단계 인증 코드가 필요합니다',
      TOKEN_REVOKED:             '세션이 만료되었습니다. 다시 로그인해주세요',
      SESSION_EXPIRED:           '세션이 만료되었습니다. 다시 로그인해주세요',
      UNAUTHORIZED:              '인증되지 않았습니다. 다시 로그인해주세요',
      RATE_LIMITED:              '요청이 너무 많습니다. 잠시 후 다시 시도해주세요',
      ACCOUNT_BANNED:            '이 계정은 정지되었습니다. 고객센터로 문의해주세요',
      BAD_PASSWORD:              '비밀번호가 올바르지 않습니다',
      USER_NOT_FOUND:            '계정을 찾을 수 없습니다',
      INVALID_CREDENTIALS:       '이메일 또는 비밀번호가 올바르지 않습니다',
      CAPTCHA_FAILED:            '봇 검증에 실패했습니다. 페이지를 새로고침한 후 다시 시도하세요',
      LOCAL_ACCOUNT_NOT_FOUND:   '이 계정은 비밀번호 로그인을 지원하지 않습니다',
      INVALID_EMAIL:             '이메일 형식이 올바르지 않습니다',
      EMAIL_ALREADY_REGISTERED:  '이미 등록된 이메일입니다. 로그인해주세요',
      PASSWORD_TOO_SHORT:        '비밀번호는 8자 이상이어야 합니다',
      WEAK_PASSWORD:             '비밀번호는 12자 이상, 또는 8자 이상이며 대문자 / 소문자 / 숫자 / 기호 중 3종을 포함해야 합니다.',
      TFA_ALREADY_ENABLED:       '2단계 인증이 이미 활성화되어 있습니다',
      INVALID_REQUEST:           '요청이 유효하지 않습니다. 다시 로그인해주세요',
      PKCE_EXPIRED:              '인증 세션이 유효하지 않거나 만료되었습니다. 다시 로그인해주세요',
      RISK_BLOCKED:              '위험도가 높아 로그인이 차단되었습니다. 이메일을 확인해주세요.',
      COOLDOWN:                  '{retry_after}초 후에 다시 시도해주세요.',
      NETWORK_ERROR:             '네트워크 오류입니다. 연결을 확인하고 다시 시도해주세요',
      INVALID_JSON:              '요청 형식이 잘못되었습니다. 페이지를 새로고침하고 다시 시도해주세요',
      EMAIL_REQUIRED:            '이메일을 입력해주세요',
      EMAIL_PASSWORD_REQUIRED:   '이메일과 비밀번호를 입력해주세요',
      INVALID_EMAIL_FORMAT:      '이메일 형식이 올바르지 않습니다',
      TOKEN_AND_PASSWORD_REQUIRED: '링크가 유효하지 않습니다. 비밀번호 재설정을 다시 요청해주세요',
      TOKEN_INVALID_OR_EXPIRED:  '링크가 만료되었거나 유효하지 않습니다. 비밀번호 재설정을 다시 요청해주세요',
      ACCOUNT_NOT_FOUND:         '계정을 찾을 수 없습니다',
      TFA_VERIFICATION_REQUIRED: '2단계 인증 코드를 입력해주세요',
    },
  }

  // 後端尚未附 code: 的 handler，用英文 string 映射回 code（漸進遷移用）
  const BACKEND_ERR_LEGACY_MAP = {
    'Invalid OTP code':                       'INVALID_OTP',
    'Invalid OTP or backup code':             'INVALID_OTP',
    'Token revoked':                          'TOKEN_REVOKED',
    'Unauthorized':                           'UNAUTHORIZED',
    'Too many requests':                      'RATE_LIMITED',
    'Too many requests. Please try again later.': 'RATE_LIMITED',
    'Account is banned':                      'ACCOUNT_BANNED',
    'Incorrect password':                     'BAD_PASSWORD',
    'Account not found':                      'USER_NOT_FOUND',
    'captcha_failed':                         'CAPTCHA_FAILED',
    'Invalid credentials':                    'INVALID_CREDENTIALS',
    'Local account not found':                'LOCAL_ACCOUNT_NOT_FOUND',
    'Invalid email format':                   'INVALID_EMAIL',
    'Email already registered':               'EMAIL_ALREADY_REGISTERED',
    'Password must be at least 8 characters': 'PASSWORD_TOO_SHORT',
    'Password must be ≥12 chars, or ≥8 chars with 3 of: uppercase / lowercase / digit / symbol': 'WEAK_PASSWORD',
    '2FA is already enabled':                 'TFA_ALREADY_ENABLED',
    'Invalid request':                        'INVALID_REQUEST',
    'Invalid or expired PKCE session':        'PKCE_EXPIRED',
  }

  function _getLang() {
    try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' }
  }

  // 後端 ApiError → 在地化字串。優先順位：
  //   1. e.code → API_ERROR_I18N[lang][code]
  //   2. e.body.error 英文 string → BACKEND_ERR_LEGACY_MAP → API_ERROR_I18N
  //   3. e.message（後端原文）
  //   4. fallback 參數
  // 動態欄位 {name} 從 e.body 取值替換。
  // 非 ApiError 或 status === 0（network error）→ 直接回 fallback。
  function tApiError(e, fallback) {
    if (!(e instanceof ApiError) || e.status === 0) return fallback
    const dict = API_ERROR_I18N[_getLang()] || API_ERROR_I18N['zh-TW']
    const code = e.code || BACKEND_ERR_LEGACY_MAP[e.body?.error] || null
    let base = (code && dict[code]) || e.message || fallback
    if (code && dict[code]) {
      base = base.replace(/\{(\w+)\}/g, (_, k) => e.body?.[k] ?? '')
    }
    return e.traceId ? `${base}（#${e.traceId}）` : base
  }

  // 給 raw fetch（非 apiFetch）後拿到的 { error, code, ... } 物件用 — 同樣的 mapping 邏輯。
  // auth-ui.js 的 login/register/2fa 走 raw fetch，沒有 ApiError instance，用這個。
  function tApiErrorData(data, fallback) {
    if (!data) return fallback
    const dict = API_ERROR_I18N[_getLang()] || API_ERROR_I18N['zh-TW']
    const code = data.code || BACKEND_ERR_LEGACY_MAP[data.error] || null
    if (code && dict[code]) {
      return dict[code].replace(/\{(\w+)\}/g, (_, k) => data[k] ?? '')
    }
    return data.error || fallback
  }

  // 向後相容：原 formatApiError 對 ApiError 也走新 mapping
  function formatApiError(e, fallback = 'Something went wrong') {
    return tApiError(e, fallback)
  }

  // 對外暴露 silent refresh — 用在 step-up 等需要先確認 token 還有效的流程
  // （step-up 自己 call 用 raw fetch，不走 apiFetch retry，避免遞迴）
  window.apiFetch         = apiFetch
  window.ApiError         = ApiError
  window.tApiError        = tApiError
  window.tApiErrorData    = tApiErrorData
  window.formatApiError   = formatApiError
  window.silentRefresh    = _silentRefresh
  window.__apiErrorI18n   = API_ERROR_I18N
})()
