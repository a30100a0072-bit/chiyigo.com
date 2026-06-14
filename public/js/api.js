class ApiError extends Error {
    status;
    traceId;
    code;
    body;
    constructor(payload) {
        super(payload.message || `HTTP ${payload.status}`);
        this.name = 'ApiError';
        this.status = payload.status;
        this.traceId = payload.traceId ?? null;
        this.code = payload.code ?? null;
        this.body = payload.body ?? null;
    }
}
;
(function () {
    'use strict';
    // refresh 路徑專用：只讀「既有」device id（read-only，不 get-or-create）。refresh token 綁登入時的
    // device id；refresh 帶不符值（含新生 UUID）→ 後端 device_mismatch、撤整個 device family（refresh.ts:131）。
    // 故缺/不合法時回 null，由呼叫端 fail-closed（不打 refresh）。login/register/OAuth 創建路徑才 get-or-create
    // （在 auth-ui.ts）；api.ts 無創建路徑，僅此 read-only。
    function _readDeviceUuidForRefresh() {
        const KEY = 'chiyigo.device_uuid';
        const RE = /^web-[0-9a-f-]{36}$/i;
        try {
            const v = localStorage.getItem(KEY);
            if (v && RE.test(v))
                return v;
        }
        catch (_) { /* localStorage blocked */ }
        const mem = window.__chiyigoMemoryDeviceUuid;
        if (mem && RE.test(mem))
            return mem;
        return null;
    }
    function getAccessToken() {
        try {
            return sessionStorage.getItem('access_token');
        }
        catch {
            return null;
        }
    }
    // 內部 silent refresh：用 HttpOnly cookie 換新 access_token；
    // P0-11：全站收斂到此單一 implementation —
    //   1. tab 內 _refreshInflight 共用同一 Promise（thundering herd）
    //   2. 跨 tab 用 navigator.locks('chiyigo-auth-refresh')，避免多分頁同時 rotate
    //      導致第一個 refresh 拿到的 token 被第二個請求 revoke（device-bound rotation）
    // 公開為 window.silentRefresh，auth-ui.js / sidebar-auth.js / dashboard.js 全走這個。
    const LOCK_NAME = 'chiyigo-auth-refresh';
    let _refreshInflight = null;
    async function _doRefreshOnce() {
        // refresh 必帶「既有」device id；缺則 fail-closed（見 _readDeviceUuidForRefresh）。
        const _devId = _readDeviceUuidForRefresh();
        if (!_devId)
            return false;
        try {
            const r = await fetch('/api/auth/refresh', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-Device-Id': _devId },
                body: '{}',
            });
            // SEC-REFRESH-REUSE (OD-SR-3)：/api/auth/refresh 本身回 401 SESSION_REVOKED（family-revoke 觸發點）= SESSION_
            // REVOKED 最常見來源（victim 拿被撤 token 走 silent-refresh）。在 `!r.ok → false`（會被上層折成 SESSION_EXPIRED）
            // 之前先硬登出（正確 code）。_throwSessionRevoked 清 token + 導 login + throw，往上傳到 apiFetch。
            if (r.status === 401 && await _peekErrorCode(r) === 'SESSION_REVOKED')
                _throwSessionRevoked(r);
            if (!r.ok)
                return false;
            const data = await r.json().catch(() => null);
            if (data?.access_token) {
                try {
                    sessionStorage.setItem('access_token', data.access_token);
                }
                catch { /* ignore */ }
                return true;
            }
            return false;
        }
        catch (e) {
            // 不可吞 SESSION_REVOKED 硬登出（_throwSessionRevoked 丟的 ApiError）→ rethrow 讓 apiFetch 以正確 code 結束；
            // 其餘（網路錯 / parse 錯）維持原本 fail-soft return false（silent-refresh 失敗 → 上層走 SESSION_EXPIRED）。
            if (e instanceof ApiError && e.code === 'SESSION_REVOKED')
                throw e;
            return false;
        }
    }
    async function _silentRefresh() {
        if (_refreshInflight)
            return _refreshInflight;
        _refreshInflight = (async () => {
            try {
                if (typeof navigator !== 'undefined' && navigator.locks) {
                    // 進到 lock 後再檢一次：別的分頁可能在我等 lock 時已 rotate 並把 token broadcast 過來
                    return await navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, async () => {
                        try {
                            const tok = sessionStorage.getItem('access_token');
                            if (tok)
                                return true;
                        }
                        catch { /* ignore */ }
                        return _doRefreshOnce();
                    });
                }
                return await _doRefreshOnce();
            }
            finally {
                setTimeout(() => { _refreshInflight = null; }, 0);
            }
        })();
        return _refreshInflight;
    }
    // SEC-REFRESH-REUSE：window.silentRefresh 對外保持 Promise<boolean> 契約。外部 caller（auth-ui / sidebar-auth /
    // dashboard / admin-* / ai-assistant / accept-invitation）寫 `const ok = await silentRefresh(); if (!ok) → login`。
    // SESSION_REVOKED 已在 _doRefreshOnce 內硬登出（_redirectToLogin 導頁），故對外 caller 吸收該 throw → 回 false
    // （導頁已發生，false 觸發的 redirect 同址冪等）。apiFetch 直接用 _silentRefresh（會 throw），以正確 SESSION_REVOKED
    // code 結束 —— 兩條路徑分離：內部 throw 給 apiFetch、對外 boolean 給其餘 caller。
    async function _silentRefreshBoolean() {
        try {
            return await _silentRefresh();
        }
        catch (e) {
            if (e instanceof ApiError && e.code === 'SESSION_REVOKED')
                return false;
            throw e;
        }
    }
    function _redirectToLogin() {
        try {
            sessionStorage.removeItem('access_token');
        }
        catch { /* ignore */ }
        // 防 redirect loop：本身就在 login 頁不再跳
        if (!/\/login(\.html)?$/.test(location.pathname)) {
            location.href = '/login.html';
        }
    }
    // SEC-REFRESH-REUSE (OD-SR-3)：peek 一個 401 response 的 `code`，讀 body clone（**不**消耗原 body，原 body 仍由下方
    // 解析成 thrown ApiError）。供「初次 401（silent-refresh 之前）」與「refresh 後 retry 仍 401」兩處共用同一判斷。
    async function _peekErrorCode(r) {
        try {
            const b = await r.clone().json();
            return b?.code ?? null;
        }
        catch {
            return null;
        } // 非 JSON / malformed body → 視為非 SESSION_REVOKED
    }
    // SEC-REFRESH-REUSE：SESSION_REVOKED 401 = 後端 refresh reuse 偵測已撤掉整個 session family → 立即硬登出（清
    // access_token + 導 /login）並丟出該 distinct code。**只**此 code 清/導（防誤登出）。永遠 throw（回傳 never）。
    function _throwSessionRevoked(r) {
        _redirectToLogin();
        throw new ApiError({ status: 401, traceId: r.headers.get('X-Request-Id'), code: 'SESSION_REVOKED', message: 'Session revoked' });
    }
    async function _doFetch(url, init) {
        const opts = { ...init };
        const headers = new Headers(opts.headers || {});
        opts.headers = headers;
        opts.credentials = opts.credentials ?? 'include';
        // 自動 Authorization（不覆寫 caller 已給的；step-up token 會手動帶就跳過自動帶）
        if (!headers.has('Authorization')) {
            const tok = getAccessToken();
            if (tok)
                headers.set('Authorization', 'Bearer ' + tok);
        }
        // 有 body 但沒 Content-Type → 預設 JSON
        if (opts.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        return fetch(url, opts);
    }
    async function apiFetch(input, init = {}) {
        const url = input;
        const skipRefresh = init?.skipRefresh === true; // step-up / refresh / login 自己呼叫不走 retry
        let res;
        try {
            res = await _doFetch(url, init);
        }
        catch (netErr) {
            throw new ApiError({
                status: 0, traceId: null, code: 'NETWORK_ERROR',
                message: (netErr instanceof Error ? netErr.message : null) || 'Network error',
            });
        }
        // SEC-REFRESH-REUSE (OD-SR-3 hard lock)：code==='SESSION_REVOKED' 的 401 = 後端偵測到 refresh reuse 已把整個
        // session family 撤掉。silent-refresh 已無意義（family 已死），必須立即硬登出。**在 silent-refresh 分支之前**
        // detect（該分支對任何 401 都觸發，且早於下方 body parse，會白白燒一輪 refresh）。**只**此 code 清 token+導 login；
        // generic 401 / 403 / 429 / network / malformed 一律不清不導（防誤登出）。skipRefresh 不影響此判斷（語意即硬登出）。
        if (res.status === 401 && await _peekErrorCode(res) === 'SESSION_REVOKED')
            _throwSessionRevoked(res);
        // 401 → silent refresh → retry 一次；refresh 失敗或 retry 還 401 → redirect login
        if (res.status === 401 && !skipRefresh) {
            const refreshed = await _silentRefresh();
            if (!refreshed) {
                _redirectToLogin();
                throw new ApiError({ status: 401, traceId: res.headers.get('X-Request-Id'), code: 'SESSION_EXPIRED', message: 'Session expired' });
            }
            try {
                res = await _doFetch(url, init);
            }
            catch (netErr) {
                throw new ApiError({ status: 0, traceId: null, code: 'NETWORK_ERROR', message: (netErr instanceof Error ? netErr.message : null) || 'Network error' });
            }
            if (res.status === 401) {
                // retry 仍 401：refresh→retry 窗內若 family 被撤 → SESSION_REVOKED 也要以正確 code 硬登出（否則丟錯 code）；
                // 其餘 401 = session expired 硬停。
                if (await _peekErrorCode(res) === 'SESSION_REVOKED')
                    _throwSessionRevoked(res);
                _redirectToLogin();
                throw new ApiError({ status: 401, traceId: res.headers.get('X-Request-Id'), code: 'SESSION_EXPIRED', message: 'Session expired' });
            }
        }
        const traceId = res.headers.get('X-Request-Id');
        if (traceId) {
            try {
                window.__lastTraceId = traceId;
            }
            catch { /* ignore */ }
        }
        // 嘗試解析 JSON（失敗就回 text）
        const ct = res.headers.get('Content-Type') || '';
        let body = null;
        if (ct.includes('application/json')) {
            try {
                body = await res.json();
            }
            catch {
                body = null;
            }
        }
        else {
            try {
                body = await res.text();
            }
            catch {
                body = null;
            }
        }
        if (!res.ok) {
            const bodyShape = (body && typeof body === 'object' ? body : null);
            throw new ApiError({
                status: res.status,
                traceId,
                code: bodyShape?.code ?? null,
                message: bodyShape?.error ?? bodyShape?.message ?? `HTTP ${res.status}`,
                body,
            });
        }
        return body;
    }
    // ── API 錯誤 i18n（code-based，全站共用）─────────────────────
    // 後端 res({ error, code, ... }) 的 code 對應到此處 → 4 語翻譯。
    // 動態欄位用 {name} 模板，從 e.body 取（例：COOLDOWN 的 {retry_after}）。
    // 漸進遷移：handler 未附 code 時，BACKEND_ERR_LEGACY_MAP 把舊英文 string 映射到 code。
    // Phase A 種子：dashboard 舊 8 碼 + auth-ui 舊 12 碼 + 2026-05-12 prod 驗到的 RISK_BLOCKED / COOLDOWN。
    const API_ERROR_I18N = {
        'zh-TW': {
            INVALID_OTP: '驗證碼錯誤',
            TOTP_REQUIRED: '需要兩步驟驗證碼',
            TOKEN_REVOKED: '登入狀態已失效，請重新登入',
            SESSION_EXPIRED: '登入狀態已失效，請重新登入',
            SESSION_REVOKED: '登入狀態已失效，請重新登入',
            UNAUTHORIZED: '未授權，請重新登入',
            RATE_LIMITED: '請求次數過多，請稍後再試',
            ACCOUNT_BANNED: '此帳號已被停用，請聯繫客服',
            BAD_PASSWORD: '密碼錯誤',
            USER_NOT_FOUND: '找不到帳號',
            INVALID_CREDENTIALS: '帳號或密碼錯誤',
            CAPTCHA_FAILED: '人機驗證失敗，請重新整理頁面再試',
            WRONG_TOKEN_SCOPE: 'Token 權限範圍錯誤',
            PRE_AUTH_TOKEN_FORBIDDEN: 'Token 權限不足，請先完成兩步驟驗證',
            WEBHOOK_VALIDATION_FAILED: 'Webhook 驗證失敗',
            UNKNOWN_KYC_VENDOR: '未知的 KYC 廠商：{vendor}',
            UNKNOWN_PAYMENT_VENDOR: '未知的金流廠商：{vendor}',
            INVALID_TARGET: '操作對象格式錯誤',
            INVALID_CLIENT_BODY: '請求內容格式錯誤',
            INVALID_REQUISITION_BODY: '需求單內容格式錯誤',
            LOCAL_ACCOUNT_NOT_FOUND: '此帳號無法使用密碼登入',
            INVALID_EMAIL: '信箱格式不正確',
            EMAIL_ALREADY_REGISTERED: '此信箱已被註冊，請直接登入',
            PASSWORD_TOO_SHORT: '密碼至少需要 8 個字元',
            WEAK_PASSWORD: '密碼長度需 ≥12 字元，或 ≥8 字元並包含「大寫字母 / 小寫字母 / 數字 / 符號」其中 3 類。',
            TFA_ALREADY_ENABLED: '雙重驗證已啟用',
            INVALID_REQUEST: '請求無效，請重新登入',
            PKCE_EXPIRED: '授權階段已失效或過期，請重新登入',
            RISK_BLOCKED: '登入風險過高，已暫時封鎖。請查看 email 取得詳細說明。',
            COOLDOWN: '請稍候 {retry_after} 秒後再試。',
            NETWORK_ERROR: '網路錯誤，請檢查連線後重試',
            INVALID_JSON: '請求格式錯誤，請重新整理頁面再試',
            EMAIL_REQUIRED: '請輸入信箱',
            EMAIL_PASSWORD_REQUIRED: '請輸入信箱與密碼',
            INVALID_EMAIL_FORMAT: '信箱格式不正確',
            TOKEN_AND_PASSWORD_REQUIRED: '連結無效，請重新發起密碼重設',
            TOKEN_INVALID_OR_EXPIRED: '連結已失效或過期，請重新發起密碼重設',
            ACCOUNT_NOT_FOUND: '找不到帳號',
            TFA_VERIFICATION_REQUIRED: '請輸入兩步驟驗證碼',
            OTP_CODE_REQUIRED: '請輸入驗證碼',
            OTP_CODE_INVALID_FORMAT: '驗證碼必須為 6 位數字',
            OTP_OR_BACKUP_CODE_REQUIRED: '請輸入驗證碼或備用救援碼',
            TFA_SETUP_REQUIRED: '請先完成兩步驟驗證設定',
            TFA_NOT_ENABLED: '尚未啟用兩步驟驗證',
            INVALID_OR_USED_BACKUP_CODE: '備用救援碼無效或已使用',
            INVALID_OTP_OR_BACKUP_CODE: '驗證碼或備用救援碼錯誤',
            BACKUP_CODE_FAIL_TOKEN_CONSUMED: '備用碼錯誤，連結已失效，請重新發起密碼重設',
            PASSWORD_REQUIRED: '請輸入密碼',
            PASSWORD_NOT_SET: '此帳號尚未設定登入密碼，請先設定密碼',
            BAD_OTP: '驗證碼錯誤',
            AUDIT_CHAIN_FAILED: 'Audit log 寫入失敗，請稍後再試',
            INVALID_STATUS: '操作狀態不允許',
            REFUND_ALREADY_PENDING: '此筆充值已申請退款，請等候管理員審核',
            UNKNOWN_TARGET_ROLE: '目標使用者角色不明，為安全已拒絕操作',
            ALREADY_BOUND: '已綁定，不可重複綁定',
            INSUFFICIENT_SCOPE: '權限不足（缺 {required} 授權範圍）',
            INTENT_RACE_CONFLICT: '此付款正在處理中或狀態已變更',
            KYC_LEVEL_INSUFFICIENT: '需要完成進階 KYC 驗證',
            KYC_REQUIRED: '需要先完成 KYC 驗證',
            REASON_REQUIRED: '請填寫原因',
            REFUND_PENDING_RECONCILIATION: '退款已送出但網路異常，請等候對帳結果',
            STATUS_LOCKED: '此狀態為金流憑證最終態，不可刪除或匿名化',
            AI_ERROR: 'AI 服務暫時不可用，請稍後再試或直接填寫表單',
            AMOUNT_OVERFLOW: '金額超出範圍',
            BLOCKED: '輸入內容包含不允許的指令樣式',
            CHUNK_NOT_FOUND: '找不到 archive chunk',
            CHUNK_STATE_MISMATCH: 'archive chunk 狀態不符，無法執行此操作',
            CLIENT_ID_TAKEN: '此 client_id 已被使用',
            DEAL_INSERT_FAILED: '建立 deal 紀錄失敗，請稍後再試',
            EVENT_NOT_DELETABLE: '此事件類型不可刪除',
            HAS_UNREFUNDED_PAYMENT: '此需求單仍有未退款的成功付款，請先退款再刪除',
            INSUFFICIENT_ROLE: '權限不足',
            INTENT_INVALID_STATUS: '關聯付款單狀態不符，無法繼續',
            INVALID_AMOUNT: '金額無效（需介於 {min}–{max}）',
            INVALID_OUTPUT: 'AI 回傳格式異常，請改用人工填寫',
            IP_BLOCKED: '此 IP 因可疑活動被暫時封鎖',
            MIXED_CURRENCY: '此需求單包含多種幣別，請先處理後再保存',
            MUST_REVOKE_FIRST: '請先撤銷後再執行此操作',
            NOT_IMPLEMENTED: '此功能尚未實作',
            PAYMENT_VENDOR_MISCONFIGURED: '金流供應商設定異常，請聯繫客服',
            SAVE_RACE_CONFLICT: '此需求單已被其他管理員保存或刪除',
            SIGNATURE_INVALID: '錢包簽章驗證失敗',
            STEP_UP_ACTION_MISMATCH: 'Step-up 驗證對應的操作不符，請重新驗證',
            STEP_UP_REQUIRED: '需要重新驗證身份才能執行此操作',
            STEP_UP_REQUIRES_2FA: '請先啟用兩步驟驗證後再進行此操作',
            STEP_UP_REVOKED: 'Step-up 驗證已失效，請重新驗證',
            STEP_UP_ROLE_DRIFT: '驗證後角色已變更，請重新登入',
            STEP_UP_USER_GONE: '帳號不存在或已刪除',
            TOO_LONG: '輸入內容超過長度上限',
            TURNSTILE_FAILED: '人機驗證失敗，請重試',
            TURNSTILE_REQUIRED: '請完成人機驗證',
            UNKNOWN_ACTOR_ROLE: '帳號角色不明，請重新登入',
            // ── B-1c：OAuth / WebAuthn / Wallet ─────────────────────
            UNSUPPORTED_PROVIDER: '不支援的登入方式',
            PROVIDER_NOT_CONFIGURED: '此登入方式尚未設定，請稍後再試',
            APPLE_LOGIN_NOT_AVAILABLE: 'Apple 登入尚未開放',
            INVALID_PLATFORM: 'platform 必須為 web、pc 或 mobile',
            OAUTH_STATE_SAVE_FAILED: 'OAuth 狀態儲存失敗，請重試',
            OAUTH_UNSUPPORTED_RESPONSE_TYPE: '僅支援 response_type=code',
            OAUTH_AUTHORIZE_REQUIRED_FIELDS: '請提供 redirect_uri、code_challenge、state',
            OAUTH_UNSUPPORTED_PKCE_METHOD: '僅支援 code_challenge_method=S256',
            REDIRECT_URI_NOT_ALLOWED: 'redirect_uri 未在允許清單內',
            INVALID_REQUEST_FORMAT: '無效的請求格式',
            MISSING_REQUIRED_FIELD: '缺少必要欄位',
            LINK_INVALID_OR_EXPIRED: '連結無效或已過期，請重新登入',
            LINK_TYPE_INVALID: '連結類型錯誤',
            TOKEN_DATA_INCOMPLETE: 'Token 資料不完整',
            EMAIL_USED_BIND_AFTER_LOGIN: '此信箱已被既有帳號使用，請改用既有方式登入後在帳號設定中綁定 {provider}',
            ACCOUNT_LOOKUP_FAILED_AFTER_CREATE: '帳號建立後無法查詢，請稍後重試',
            ACCOUNT_DISABLED: '此帳號已被停用',
            PKCE_KEY_REQUIRED: '請提供 pkce_key',
            INVALID_PKCE_SESSION: 'PKCE Session 無效或已過期',
            OAUTH_CODE_REQUIRED_FIELDS: '請提供 code、code_verifier、redirect_uri',
            INVALID_AUTHORIZATION_CODE: '授權碼無效或已過期',
            REDIRECT_URI_MISMATCH: 'redirect_uri 不符',
            PKCE_VERIFICATION_FAILED: 'PKCE 驗證失敗',
            INVALID_ID: '識別碼格式錯誤',
            WALLET_NOT_FOUND: '找不到錢包',
            INVALID_WALLET_ADDRESS: '錢包地址格式錯誤',
            WALLET_MESSAGE_SIGNATURE_REQUIRED: '請提供 message 與 signature',
            NONCE_INVALID_OR_EXPIRED: 'Nonce 無效或已過期',
            NONCE_MISMATCH: 'Nonce 不符',
            WALLET_ADDRESS_MISMATCH: '錢包地址與 nonce 不符',
            INVALID_NICKNAME: '暱稱格式錯誤（需為非空字串且不超過上限）',
            CREDENTIAL_NOT_FOUND: '找不到憑證',
            RESPONSE_REQUIRED: '請提供驗證資料',
            INVALID_CLIENT_DATA: 'clientDataJSON 格式錯誤',
            CHALLENGE_INVALID_OR_EXPIRED: 'Challenge 無效或已過期',
            CHALLENGE_MISMATCH: 'Challenge 不符',
            WEBAUTHN_VERIFICATION_FAILED: 'WebAuthn 驗證失敗',
            WEBAUTHN_VERIFICATION_INCOMPLETE: 'WebAuthn 驗證資料不完整',
            CREDENTIAL_ALREADY_REGISTERED: '此憑證已註冊',
            INTERNAL_ERROR: '系統錯誤，請稍後再試',
            INCORRECT_PASSWORD: '密碼錯誤',
            EMAIL_SEND_FAILED: '寄送 Email 失敗，請稍後再試',
            TOKEN_REQUIRED: '請提供 Token',
            INVALID_DELETION_TOKEN: '刪除帳號 Token 無效或已過期',
            EMAIL_ALREADY_VERIFIED: 'Email 已驗證',
            PC_PORT_REQUIRED: '桌面登入需提供有效 port（4-5 位數字）',
            PROVIDER_REQUIRED: '請選擇登入方式',
            LAST_AUTH_METHOD: '無法移除最後一個登入方式',
            PROVIDER_NOT_BOUND: '尚未綁定此登入方式',
            REFRESH_TOKEN_REQUIRED: '請提供 refresh_token',
            INVALID_REFRESH_TOKEN: 'Refresh Token 無效或已過期',
            REFRESH_TOKEN_REVOKED: '登入憑證已失效，請重新登入',
            DEVICE_MISMATCH: '裝置不符，請從原裝置操作',
            INVALID_SCOPE: 'scope 參數無效',
            INVALID_FOR_ACTION: 'for_action 格式錯誤',
            INVALID_TOKEN_SUBJECT: 'Token subject 無效',
            // ── B-1e：Dashboard（change-password / devices logout / payment intent）─
            NEW_PASSWORD_REQUIRED: '請輸入新密碼',
            INVALID_DEVICE_UUID: '裝置識別碼格式錯誤',
            DEVICE_NOT_FOUND: '找不到此裝置',
            INTENT_NOT_FOUND: '找不到付款單',
            // ── B-1f：Requisition / AI ─
            PROMPT_REQUIRED: '請輸入問題內容',
            AI_DAILY_LIMIT: '今日 AI 助手呼叫次數已達上限，請稍後再試或直接填寫表單',
            REQUISITION_DAILY_LIMIT: '今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們',
            REQUISITION_NOT_FOUND: '找不到該需求單',
            REQUISITION_ID_REQUIRED: '請提供需求單編號',
            REQUISITION_IN_PROCESS: '此單已在處理中，無法撤銷',
            // ── B-1g：Admin audit / cron / deals / oauth-clients ─
            INVALID_SEVERITY: 'severity 必須為 info / warn / critical',
            FROM_DATE_INVALID: '起始日期格式錯誤（需為 ISO 8601）',
            TO_DATE_INVALID: '結束日期格式錯誤（需為 ISO 8601）',
            AUDIT_NOT_FOUND: '找不到稽核紀錄',
            CRON_SECRET_NOT_CONFIGURED: '排程密鑰未設定',
            USER_ID_INVALID: 'user_id 格式錯誤（需為數字）',
            CLIENT_NOT_FOUND: '找不到應用程式',
            NO_UPDATABLE_FIELDS: '沒有可更新的欄位',
            CLIENT_ALREADY_DISABLED: '應用程式已被停用',
            INVALID_ACTION: 'action 參數無效',
            // ── B-1h：Admin payments / requisition-refund / requisitions / revoke / users ─
            REFUND_REQUEST_NOT_FOUND: '找不到退款申請',
            ECPAY_REFUND_FAILED: '綠界退款失敗',
            REFUND_NOT_IMPLEMENTED: '此金流供應商尚未支援退款',
            TRADE_NO_NOT_FOUND: '找不到交易序號，無法執行退款',
            CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE: '無法對同等或更高權限的使用者執行此操作',
            CANNOT_TARGET_SELF: '無法對自己執行此操作',
            DEVICE_UUID_REQUIRED: '請提供 device_uuid',
            INTENT_ID_REQUIRED: '請提供 intent_id',
            INVALID_MODE: 'mode 參數無效',
            JTI_REQUIRED: '請提供 jti',
            LINKED_INTENT_NOT_FOUND: '找不到關聯的付款單',
            USER_ALREADY_BANNED: '此使用者已被停用',
            USER_NOT_BANNED: '此使用者並未被停用',
            // OD-3 credential requires_reverification（登入被擋 + 會員中心自助 reverify）
            CREDENTIAL_REVERIFICATION_REQUIRED: '此登入方式需重新驗證後才能使用，請改用其他方式登入並至會員中心完成驗證',
            CREDENTIAL_NOT_FLAGGED: '此項目目前不需重新驗證',
            CREDENTIAL_REVERIFICATION_HIGH_RISK: '此項目需由客服審查或移除，無法自助重新驗證',
            CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL: '目前沒有可用的驗證管道，請先設定密碼或聯絡客服',
            CREDENTIAL_REVERIFICATION_PROOF_FAILED: '驗證失敗，請確認驗證碼或密碼是否正確',
        },
        en: {
            INVALID_OTP: 'Invalid code, please try again',
            TOTP_REQUIRED: 'Two-factor verification required',
            TOKEN_REVOKED: 'Session expired, please log in again',
            SESSION_EXPIRED: 'Session expired, please log in again',
            SESSION_REVOKED: 'Session expired, please log in again',
            UNAUTHORIZED: 'Unauthorized, please log in again',
            RATE_LIMITED: 'Too many requests, please try again later',
            ACCOUNT_BANNED: 'This account has been suspended, please contact support',
            BAD_PASSWORD: 'Incorrect password',
            USER_NOT_FOUND: 'Account not found',
            INVALID_CREDENTIALS: 'Invalid email or password',
            CAPTCHA_FAILED: 'Captcha verification failed, please refresh the page and try again',
            WRONG_TOKEN_SCOPE: 'Token scope is invalid for this request',
            PRE_AUTH_TOKEN_FORBIDDEN: 'Insufficient token privilege; please complete two-step verification first',
            WEBHOOK_VALIDATION_FAILED: 'Webhook validation failed',
            UNKNOWN_KYC_VENDOR: 'Unknown KYC vendor: {vendor}',
            UNKNOWN_PAYMENT_VENDOR: 'Unknown payment vendor: {vendor}',
            INVALID_TARGET: 'Invalid target format',
            INVALID_CLIENT_BODY: 'Invalid request body',
            INVALID_REQUISITION_BODY: 'Invalid requisition body',
            LOCAL_ACCOUNT_NOT_FOUND: 'This account cannot log in with password',
            INVALID_EMAIL: 'Invalid email format',
            EMAIL_ALREADY_REGISTERED: 'Email already registered, please log in',
            PASSWORD_TOO_SHORT: 'Password must be at least 8 characters',
            WEAK_PASSWORD: 'Password must be ≥12 chars, or ≥8 chars and contain 3 of: uppercase / lowercase / digit / symbol.',
            TFA_ALREADY_ENABLED: 'Two-factor authentication is already enabled',
            INVALID_REQUEST: 'Invalid request, please log in again',
            PKCE_EXPIRED: 'Authorization session is invalid or expired, please log in again',
            RISK_BLOCKED: 'Login blocked due to high risk. Please check your email for details.',
            COOLDOWN: 'Please wait {retry_after} seconds before retrying.',
            NETWORK_ERROR: 'Network error, please check your connection and retry',
            INVALID_JSON: 'Invalid request format, please refresh the page and try again',
            EMAIL_REQUIRED: 'Email is required',
            EMAIL_PASSWORD_REQUIRED: 'Email and password are required',
            INVALID_EMAIL_FORMAT: 'Invalid email format',
            TOKEN_AND_PASSWORD_REQUIRED: 'Invalid link, please request a new password reset',
            TOKEN_INVALID_OR_EXPIRED: 'Link is invalid or expired, please request a new password reset',
            ACCOUNT_NOT_FOUND: 'Account not found',
            TFA_VERIFICATION_REQUIRED: 'Two-factor verification code required',
            OTP_CODE_REQUIRED: 'Verification code is required',
            OTP_CODE_INVALID_FORMAT: 'Verification code must be 6 digits',
            OTP_OR_BACKUP_CODE_REQUIRED: 'Verification code or backup code is required',
            TFA_SETUP_REQUIRED: 'Please complete two-factor setup first',
            TFA_NOT_ENABLED: 'Two-factor authentication is not enabled',
            INVALID_OR_USED_BACKUP_CODE: 'Invalid or already used backup code',
            INVALID_OTP_OR_BACKUP_CODE: 'Invalid verification code or backup code',
            BACKUP_CODE_FAIL_TOKEN_CONSUMED: 'Invalid backup code; reset link has been consumed, please request a new password reset',
            PASSWORD_REQUIRED: 'Password is required',
            PASSWORD_NOT_SET: 'No login password set on this account, please set a password first',
            BAD_OTP: 'Invalid verification code',
            AUDIT_CHAIN_FAILED: 'Failed to write audit log, please try again later',
            INVALID_STATUS: 'Operation not allowed in the current status',
            REFUND_ALREADY_PENDING: 'A refund has already been requested for this payment, awaiting admin review',
            UNKNOWN_TARGET_ROLE: 'Target user has an unknown role; refused for safety',
            ALREADY_BOUND: 'Already bound, cannot bind again',
            INSUFFICIENT_SCOPE: 'Insufficient permission (requires {required} scope)',
            INTENT_RACE_CONFLICT: 'This payment is being processed or its status has changed',
            KYC_LEVEL_INSUFFICIENT: 'Enhanced KYC verification required',
            KYC_REQUIRED: 'KYC verification required',
            REASON_REQUIRED: 'Please provide a reason',
            REFUND_PENDING_RECONCILIATION: 'Refund sent but the network failed, awaiting reconciliation',
            STATUS_LOCKED: 'This is a final payment state and cannot be deleted or anonymized',
            AI_ERROR: 'AI service is temporarily unavailable, please try again or fill in the form manually',
            AMOUNT_OVERFLOW: 'Amount is out of range',
            BLOCKED: 'Input contains disallowed instruction patterns',
            CHUNK_NOT_FOUND: 'Archive chunk not found',
            CHUNK_STATE_MISMATCH: 'Archive chunk state mismatch, cannot perform this action',
            CLIENT_ID_TAKEN: 'This client_id is already in use',
            DEAL_INSERT_FAILED: 'Failed to create deal record, please try again later',
            EVENT_NOT_DELETABLE: 'This event type cannot be deleted',
            HAS_UNREFUNDED_PAYMENT: 'This requisition still has unrefunded successful payments, please refund first',
            INSUFFICIENT_ROLE: 'Insufficient role permission',
            INTENT_INVALID_STATUS: 'Linked payment status mismatch, cannot proceed',
            INVALID_AMOUNT: 'Invalid amount (must be between {min} and {max})',
            INVALID_OUTPUT: 'AI returned invalid format, please use manual entry',
            IP_BLOCKED: 'Your IP is temporarily blocked due to suspicious activity',
            MIXED_CURRENCY: 'This requisition contains multiple currencies, please handle them first',
            MUST_REVOKE_FIRST: 'Please revoke first before performing this action',
            NOT_IMPLEMENTED: 'This feature is not implemented yet',
            PAYMENT_VENDOR_MISCONFIGURED: 'Payment vendor is misconfigured, please contact support',
            SAVE_RACE_CONFLICT: 'This requisition was saved or deleted by another admin',
            SIGNATURE_INVALID: 'Wallet signature verification failed',
            STEP_UP_ACTION_MISMATCH: 'Step-up token does not match the required action, please re-authenticate',
            STEP_UP_REQUIRED: 'Re-authentication required to perform this action',
            STEP_UP_REQUIRES_2FA: 'Two-factor authentication must be enabled before step-up',
            STEP_UP_REVOKED: 'Step-up token has been revoked, please re-authenticate',
            STEP_UP_ROLE_DRIFT: 'Your role changed since step-up, please log in again',
            STEP_UP_USER_GONE: 'Account does not exist or was deleted',
            TOO_LONG: 'Input exceeds length limit',
            TURNSTILE_FAILED: 'Captcha verification failed, please try again',
            TURNSTILE_REQUIRED: 'Please complete the captcha',
            UNKNOWN_ACTOR_ROLE: 'Account role is unknown, please log in again',
            // ── B-1c：OAuth / WebAuthn / Wallet ─────────────────────
            UNSUPPORTED_PROVIDER: 'Unsupported sign-in provider',
            PROVIDER_NOT_CONFIGURED: 'This sign-in provider is not configured yet, please try again later',
            APPLE_LOGIN_NOT_AVAILABLE: 'Apple sign-in is not available yet',
            INVALID_PLATFORM: 'platform must be one of: web, pc, mobile',
            OAUTH_STATE_SAVE_FAILED: 'Failed to save OAuth state, please retry',
            OAUTH_UNSUPPORTED_RESPONSE_TYPE: 'Only response_type=code is supported',
            OAUTH_AUTHORIZE_REQUIRED_FIELDS: 'redirect_uri, code_challenge, and state are required',
            OAUTH_UNSUPPORTED_PKCE_METHOD: 'Only code_challenge_method=S256 is supported',
            REDIRECT_URI_NOT_ALLOWED: 'redirect_uri is not allowed',
            INVALID_REQUEST_FORMAT: 'Invalid request format',
            MISSING_REQUIRED_FIELD: 'Missing required field',
            LINK_INVALID_OR_EXPIRED: 'Link is invalid or expired, please sign in again',
            LINK_TYPE_INVALID: 'Invalid link type',
            TOKEN_DATA_INCOMPLETE: 'Token data is incomplete',
            EMAIL_USED_BIND_AFTER_LOGIN: 'This email is already used by an existing account. Please sign in with the existing method and bind {provider} from account settings.',
            ACCOUNT_LOOKUP_FAILED_AFTER_CREATE: 'Account created but lookup failed, please retry',
            ACCOUNT_DISABLED: 'This account has been disabled',
            PKCE_KEY_REQUIRED: 'pkce_key is required',
            INVALID_PKCE_SESSION: 'Invalid or expired PKCE session',
            OAUTH_CODE_REQUIRED_FIELDS: 'code, code_verifier, and redirect_uri are required',
            INVALID_AUTHORIZATION_CODE: 'Invalid or expired authorization code',
            REDIRECT_URI_MISMATCH: 'redirect_uri mismatch',
            PKCE_VERIFICATION_FAILED: 'PKCE verification failed',
            INVALID_ID: 'Invalid id format',
            WALLET_NOT_FOUND: 'Wallet not found',
            INVALID_WALLET_ADDRESS: 'Invalid Ethereum address',
            WALLET_MESSAGE_SIGNATURE_REQUIRED: 'message and signature are required',
            NONCE_INVALID_OR_EXPIRED: 'Nonce is invalid or expired',
            NONCE_MISMATCH: 'Nonce mismatch',
            WALLET_ADDRESS_MISMATCH: 'Wallet address does not match the nonce',
            INVALID_NICKNAME: 'Invalid nickname (must be non-empty and within length limit)',
            CREDENTIAL_NOT_FOUND: 'Credential not found',
            RESPONSE_REQUIRED: 'Verification response is required',
            INVALID_CLIENT_DATA: 'Invalid clientDataJSON',
            CHALLENGE_INVALID_OR_EXPIRED: 'Challenge is invalid or expired',
            CHALLENGE_MISMATCH: 'Challenge mismatch',
            WEBAUTHN_VERIFICATION_FAILED: 'WebAuthn verification failed',
            WEBAUTHN_VERIFICATION_INCOMPLETE: 'WebAuthn verification produced incomplete credential',
            CREDENTIAL_ALREADY_REGISTERED: 'This credential is already registered',
            INTERNAL_ERROR: 'Server error, please try again later',
            INCORRECT_PASSWORD: 'Incorrect password',
            EMAIL_SEND_FAILED: 'Failed to send email, please try again later',
            TOKEN_REQUIRED: 'Token is required',
            INVALID_DELETION_TOKEN: 'Invalid or expired deletion token',
            EMAIL_ALREADY_VERIFIED: 'Email already verified',
            PC_PORT_REQUIRED: 'Desktop login requires a valid port (4-5 digits)',
            PROVIDER_REQUIRED: 'Please select a sign-in provider',
            LAST_AUTH_METHOD: 'Cannot remove the last authentication method',
            PROVIDER_NOT_BOUND: 'This provider is not bound to your account',
            REFRESH_TOKEN_REQUIRED: 'refresh_token is required',
            INVALID_REFRESH_TOKEN: 'Invalid or expired refresh token',
            REFRESH_TOKEN_REVOKED: 'Refresh token has been revoked, please sign in again',
            DEVICE_MISMATCH: 'Device mismatch, please use the original device',
            INVALID_SCOPE: 'Invalid scope parameter',
            INVALID_FOR_ACTION: 'Invalid for_action format',
            INVALID_TOKEN_SUBJECT: 'Invalid token subject',
            // ── B-1e：Dashboard ─
            NEW_PASSWORD_REQUIRED: 'New password is required',
            INVALID_DEVICE_UUID: 'Invalid device identifier format',
            DEVICE_NOT_FOUND: 'Device not found',
            INTENT_NOT_FOUND: 'Payment intent not found',
            // ── B-1f：Requisition / AI ─
            PROMPT_REQUIRED: 'Please enter your question',
            AI_DAILY_LIMIT: 'AI assistant daily limit reached. Please try later or fill out the form directly.',
            REQUISITION_DAILY_LIMIT: 'Daily requisition submission limit reached. For urgent matters, please call or contact us via LINE.',
            REQUISITION_NOT_FOUND: 'Requisition not found',
            REQUISITION_ID_REQUIRED: 'requisition_id is required',
            REQUISITION_IN_PROCESS: 'This requisition is already in process and cannot be revoked',
            // ── B-1g：Admin audit / cron / deals / oauth-clients ─
            INVALID_SEVERITY: 'severity must be info, warn, or critical',
            FROM_DATE_INVALID: 'Invalid from date (must be ISO 8601)',
            TO_DATE_INVALID: 'Invalid to date (must be ISO 8601)',
            AUDIT_NOT_FOUND: 'Audit record not found',
            CRON_SECRET_NOT_CONFIGURED: 'CRON_SECRET is not configured',
            USER_ID_INVALID: 'Invalid user_id (must be a number)',
            CLIENT_NOT_FOUND: 'Client not found',
            NO_UPDATABLE_FIELDS: 'No updatable fields provided',
            CLIENT_ALREADY_DISABLED: 'Client is already disabled',
            INVALID_ACTION: 'Invalid action parameter',
            // ── B-1h：Admin payments / requisition-refund / requisitions / revoke / users ─
            REFUND_REQUEST_NOT_FOUND: 'Refund request not found',
            ECPAY_REFUND_FAILED: 'ECPay refund failed',
            REFUND_NOT_IMPLEMENTED: 'Refund is not supported for this payment vendor',
            TRADE_NO_NOT_FOUND: 'TradeNo not found; cannot call refund API',
            CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE: 'Cannot perform this action on a user with equal or higher role',
            CANNOT_TARGET_SELF: 'Cannot perform this action on yourself',
            DEVICE_UUID_REQUIRED: 'device_uuid is required',
            INTENT_ID_REQUIRED: 'intent_id is required',
            INVALID_MODE: 'Invalid mode parameter',
            JTI_REQUIRED: 'jti is required',
            LINKED_INTENT_NOT_FOUND: 'Linked payment intent not found',
            USER_ALREADY_BANNED: 'User is already banned',
            USER_NOT_BANNED: 'User is not banned',
            // OD-3 credential requires_reverification
            CREDENTIAL_REVERIFICATION_REQUIRED: 'This login method needs re-verification before it can be used. Please log in another way and complete re-verification in your account settings.',
            CREDENTIAL_NOT_FLAGGED: 'This item does not currently need re-verification.',
            CREDENTIAL_REVERIFICATION_HIGH_RISK: 'This item requires support review or removal and cannot be self-reverified.',
            CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL: 'No trusted verification channel is available. Please set a password or contact support.',
            CREDENTIAL_REVERIFICATION_PROOF_FAILED: 'Verification failed. Please check your code or password.',
        },
        ja: {
            INVALID_OTP: '認証コードが正しくありません',
            TOTP_REQUIRED: '二段階認証コードが必要です',
            TOKEN_REVOKED: 'セッションの有効期限が切れました。再度ログインしてください',
            SESSION_EXPIRED: 'セッションの有効期限が切れました。再度ログインしてください',
            SESSION_REVOKED: 'セッションの有効期限が切れました。再度ログインしてください',
            UNAUTHORIZED: '認証されていません。再度ログインしてください',
            RATE_LIMITED: 'リクエストが多すぎます。しばらくしてから再度お試しください',
            ACCOUNT_BANNED: 'このアカウントは停止されています。サポートまでご連絡ください',
            BAD_PASSWORD: 'パスワードが正しくありません',
            USER_NOT_FOUND: 'アカウントが見つかりません',
            INVALID_CREDENTIALS: 'メールアドレスまたはパスワードが正しくありません',
            CAPTCHA_FAILED: 'ボット認証に失敗しました。ページを再読み込みしてからお試しください',
            WRONG_TOKEN_SCOPE: 'トークンの権限範囲が正しくありません',
            PRE_AUTH_TOKEN_FORBIDDEN: 'トークンの権限が不足しています。先に二段階認証を完了してください',
            WEBHOOK_VALIDATION_FAILED: 'Webhook の検証に失敗しました',
            UNKNOWN_KYC_VENDOR: '不明な KYC ベンダー：{vendor}',
            UNKNOWN_PAYMENT_VENDOR: '不明な決済ベンダー：{vendor}',
            INVALID_TARGET: '対象の形式が正しくありません',
            INVALID_CLIENT_BODY: 'リクエスト形式が正しくありません',
            INVALID_REQUISITION_BODY: '依頼内容の形式が正しくありません',
            LOCAL_ACCOUNT_NOT_FOUND: 'このアカウントはパスワードログインに対応していません',
            INVALID_EMAIL: 'メールアドレスの形式が正しくありません',
            EMAIL_ALREADY_REGISTERED: 'このメールアドレスは既に登録されています。ログインしてください',
            PASSWORD_TOO_SHORT: 'パスワードは8文字以上で入力してください',
            WEAK_PASSWORD: 'パスワードは12文字以上、または8文字以上で「大文字 / 小文字 / 数字 / 記号」のうち3種を含めてください。',
            TFA_ALREADY_ENABLED: '2段階認証は既に有効です',
            INVALID_REQUEST: 'リクエストが無効です。再度ログインしてください',
            PKCE_EXPIRED: '認可セッションが無効または期限切れです。再度ログインしてください',
            RISK_BLOCKED: 'リスクが高いためログインをブロックしました。詳細はメールをご確認ください。',
            COOLDOWN: '{retry_after} 秒後に再度お試しください。',
            NETWORK_ERROR: 'ネットワークエラーです。接続を確認してもう一度お試しください',
            INVALID_JSON: 'リクエスト形式が無効です。ページを再読み込みしてからお試しください',
            EMAIL_REQUIRED: 'メールアドレスを入力してください',
            EMAIL_PASSWORD_REQUIRED: 'メールアドレスとパスワードを入力してください',
            INVALID_EMAIL_FORMAT: 'メールアドレスの形式が正しくありません',
            TOKEN_AND_PASSWORD_REQUIRED: 'リンクが無効です。パスワードの再設定をやり直してください',
            TOKEN_INVALID_OR_EXPIRED: 'リンクの有効期限が切れています。パスワードの再設定をやり直してください',
            ACCOUNT_NOT_FOUND: 'アカウントが見つかりません',
            TFA_VERIFICATION_REQUIRED: '二段階認証コードを入力してください',
            OTP_CODE_REQUIRED: '認証コードを入力してください',
            OTP_CODE_INVALID_FORMAT: '認証コードは6桁の数字で入力してください',
            OTP_OR_BACKUP_CODE_REQUIRED: '認証コードまたはバックアップコードを入力してください',
            TFA_SETUP_REQUIRED: '先に二段階認証の設定を完了してください',
            TFA_NOT_ENABLED: '二段階認証は有効になっていません',
            INVALID_OR_USED_BACKUP_CODE: 'バックアップコードが無効か、使用済みです',
            INVALID_OTP_OR_BACKUP_CODE: '認証コードまたはバックアップコードが正しくありません',
            BACKUP_CODE_FAIL_TOKEN_CONSUMED: 'バックアップコードが無効です。リンクの有効期限が切れたため、パスワードの再設定をやり直してください',
            PASSWORD_REQUIRED: 'パスワードを入力してください',
            PASSWORD_NOT_SET: 'このアカウントにはログインパスワードが未設定です。先にパスワードを設定してください',
            BAD_OTP: '認証コードが正しくありません',
            AUDIT_CHAIN_FAILED: '監査ログの書き込みに失敗しました。しばらくしてから再度お試しください',
            INVALID_STATUS: '現在のステータスではこの操作は許可されていません',
            REFUND_ALREADY_PENDING: 'この決済は既に返金申請が出されています。管理者の審査をお待ちください',
            UNKNOWN_TARGET_ROLE: '対象ユーザーのロールが不明のため、安全のため拒否しました',
            ALREADY_BOUND: '既に紐付け済みのため、再度の紐付けはできません',
            INSUFFICIENT_SCOPE: '権限が不足しています（{required} スコープが必要）',
            INTENT_RACE_CONFLICT: 'この決済は処理中またはステータスが変更されました',
            KYC_LEVEL_INSUFFICIENT: '上位レベルの本人確認が必要です',
            KYC_REQUIRED: '本人確認が必要です',
            REASON_REQUIRED: '理由を入力してください',
            REFUND_PENDING_RECONCILIATION: '返金は送信されましたがネットワーク異常のため、照合をお待ちください',
            STATUS_LOCKED: '決済証憑の最終ステータスのため、削除や匿名化はできません',
            AI_ERROR: 'AI サービスが一時的に利用できません。後ほど再度お試しいただくか、フォームに直接ご記入ください',
            AMOUNT_OVERFLOW: '金額が範囲を超えています',
            BLOCKED: '入力内容に許可されていないコマンドパターンが含まれています',
            CHUNK_NOT_FOUND: 'アーカイブチャンクが見つかりません',
            CHUNK_STATE_MISMATCH: 'アーカイブチャンクの状態が一致しません。この操作はできません',
            CLIENT_ID_TAKEN: 'この client_id は既に使用されています',
            DEAL_INSERT_FAILED: '案件レコードの作成に失敗しました。しばらくしてから再度お試しください',
            EVENT_NOT_DELETABLE: 'このイベントタイプは削除できません',
            HAS_UNREFUNDED_PAYMENT: 'この依頼には未返金の成功した決済があります。先に返金してください',
            INSUFFICIENT_ROLE: 'ロール権限が不足しています',
            INTENT_INVALID_STATUS: '関連する決済のステータスが一致せず、続行できません',
            INVALID_AMOUNT: '金額が無効です（{min}〜{max} の範囲内で入力してください）',
            INVALID_OUTPUT: 'AI の応答形式が異常です。手動入力に切り替えてください',
            IP_BLOCKED: '不審なアクティビティのため、この IP は一時的にブロックされています',
            MIXED_CURRENCY: 'この依頼には複数の通貨が含まれています。先に処理してください',
            MUST_REVOKE_FIRST: '先に撤回してからこの操作を実行してください',
            NOT_IMPLEMENTED: 'この機能は未実装です',
            PAYMENT_VENDOR_MISCONFIGURED: '決済ベンダーの設定に異常があります。サポートにお問い合わせください',
            SAVE_RACE_CONFLICT: 'この依頼は他の管理者により保存または削除されました',
            SIGNATURE_INVALID: 'ウォレット署名の検証に失敗しました',
            STEP_UP_ACTION_MISMATCH: 'Step-up 認証と必要な操作が一致しません。再認証してください',
            STEP_UP_REQUIRED: 'この操作を実行するには再認証が必要です',
            STEP_UP_REQUIRES_2FA: 'Step-up の前に二段階認証を有効にしてください',
            STEP_UP_REVOKED: 'Step-up 認証は無効になりました。再認証してください',
            STEP_UP_ROLE_DRIFT: '認証後にロールが変更されました。再ログインしてください',
            STEP_UP_USER_GONE: 'アカウントが存在しないか削除されています',
            TOO_LONG: '入力内容が長さ制限を超えています',
            TURNSTILE_FAILED: 'ボット認証に失敗しました。再度お試しください',
            TURNSTILE_REQUIRED: 'ボット認証を完了してください',
            UNKNOWN_ACTOR_ROLE: 'アカウントのロールが不明です。再ログインしてください',
            // ── B-1c：OAuth / WebAuthn / Wallet ─────────────────────
            UNSUPPORTED_PROVIDER: 'サポートされていないログイン方式です',
            PROVIDER_NOT_CONFIGURED: 'このログイン方式は未設定です。しばらくしてから再度お試しください',
            APPLE_LOGIN_NOT_AVAILABLE: 'Apple ログインはまだ利用できません',
            INVALID_PLATFORM: 'platform は web、pc、mobile のいずれかを指定してください',
            OAUTH_STATE_SAVE_FAILED: 'OAuth ステートの保存に失敗しました。再度お試しください',
            OAUTH_UNSUPPORTED_RESPONSE_TYPE: 'response_type=code のみサポートしています',
            OAUTH_AUTHORIZE_REQUIRED_FIELDS: 'redirect_uri、code_challenge、state は必須です',
            OAUTH_UNSUPPORTED_PKCE_METHOD: 'code_challenge_method=S256 のみサポートしています',
            REDIRECT_URI_NOT_ALLOWED: 'redirect_uri は許可されていません',
            INVALID_REQUEST_FORMAT: 'リクエスト形式が無効です',
            MISSING_REQUIRED_FIELD: '必須項目が不足しています',
            LINK_INVALID_OR_EXPIRED: 'リンクが無効か期限切れです。再ログインしてください',
            LINK_TYPE_INVALID: 'リンクの種類が正しくありません',
            TOKEN_DATA_INCOMPLETE: 'トークンデータが不完全です',
            EMAIL_USED_BIND_AFTER_LOGIN: 'このメールアドレスは既存アカウントで使用されています。既存の方法でログイン後、アカウント設定で {provider} を紐付けてください。',
            ACCOUNT_LOOKUP_FAILED_AFTER_CREATE: 'アカウント作成後の照会に失敗しました。しばらくしてから再度お試しください',
            ACCOUNT_DISABLED: 'このアカウントは停止されています',
            PKCE_KEY_REQUIRED: 'pkce_key を指定してください',
            INVALID_PKCE_SESSION: 'PKCE セッションが無効か期限切れです',
            OAUTH_CODE_REQUIRED_FIELDS: 'code、code_verifier、redirect_uri は必須です',
            INVALID_AUTHORIZATION_CODE: '認可コードが無効か期限切れです',
            REDIRECT_URI_MISMATCH: 'redirect_uri が一致しません',
            PKCE_VERIFICATION_FAILED: 'PKCE 検証に失敗しました',
            INVALID_ID: 'ID の形式が正しくありません',
            WALLET_NOT_FOUND: 'ウォレットが見つかりません',
            INVALID_WALLET_ADDRESS: 'Ethereum アドレスが無効です',
            WALLET_MESSAGE_SIGNATURE_REQUIRED: 'message と signature は必須です',
            NONCE_INVALID_OR_EXPIRED: 'Nonce が無効か期限切れです',
            NONCE_MISMATCH: 'Nonce が一致しません',
            WALLET_ADDRESS_MISMATCH: 'ウォレットアドレスが nonce と一致しません',
            INVALID_NICKNAME: 'ニックネームの形式が正しくありません（空欄不可・上限あり）',
            CREDENTIAL_NOT_FOUND: '認証情報が見つかりません',
            RESPONSE_REQUIRED: '検証データが必要です',
            INVALID_CLIENT_DATA: 'clientDataJSON の形式が正しくありません',
            CHALLENGE_INVALID_OR_EXPIRED: 'Challenge が無効か期限切れです',
            CHALLENGE_MISMATCH: 'Challenge が一致しません',
            WEBAUTHN_VERIFICATION_FAILED: 'WebAuthn 検証に失敗しました',
            WEBAUTHN_VERIFICATION_INCOMPLETE: 'WebAuthn 検証結果が不完全です',
            CREDENTIAL_ALREADY_REGISTERED: 'この認証情報は既に登録されています',
            INTERNAL_ERROR: 'サーバーエラーです。しばらくしてから再度お試しください',
            INCORRECT_PASSWORD: 'パスワードが正しくありません',
            EMAIL_SEND_FAILED: 'メールの送信に失敗しました。しばらくしてから再度お試しください',
            TOKEN_REQUIRED: 'トークンを指定してください',
            INVALID_DELETION_TOKEN: '削除用トークンが無効か期限切れです',
            EMAIL_ALREADY_VERIFIED: 'メールはすでに認証済みです',
            PC_PORT_REQUIRED: 'デスクトップログインには有効な port (4-5桁) が必要です',
            PROVIDER_REQUIRED: 'ログイン方法を選択してください',
            LAST_AUTH_METHOD: '最後のログイン方法は削除できません',
            PROVIDER_NOT_BOUND: 'このログイン方法は紐付けられていません',
            REFRESH_TOKEN_REQUIRED: 'refresh_token を指定してください',
            INVALID_REFRESH_TOKEN: 'Refresh Token が無効か期限切れです',
            REFRESH_TOKEN_REVOKED: 'Refresh Token は失効しました。再度ログインしてください',
            DEVICE_MISMATCH: 'デバイスが一致しません。元のデバイスから操作してください',
            INVALID_SCOPE: 'scope パラメーターが無効です',
            INVALID_FOR_ACTION: 'for_action の形式が正しくありません',
            INVALID_TOKEN_SUBJECT: 'Token subject が無効です',
            // ── B-1e：Dashboard ─
            NEW_PASSWORD_REQUIRED: '新しいパスワードを入力してください',
            INVALID_DEVICE_UUID: 'デバイス識別子の形式が正しくありません',
            DEVICE_NOT_FOUND: 'デバイスが見つかりません',
            INTENT_NOT_FOUND: '決済情報が見つかりません',
            // ── B-1f：Requisition / AI ─
            PROMPT_REQUIRED: 'ご質問内容を入力してください',
            AI_DAILY_LIMIT: '本日の AI アシスタント利用上限に達しました。後ほどお試しいただくか、フォームから直接お問い合わせください',
            REQUISITION_DAILY_LIMIT: '本日のお問い合わせ送信上限に達しました。お急ぎの場合はお電話または LINE でご連絡ください',
            REQUISITION_NOT_FOUND: 'お問い合わせが見つかりません',
            REQUISITION_ID_REQUIRED: 'requisition_id を指定してください',
            REQUISITION_IN_PROCESS: 'このお問い合わせは処理中のため取り消せません',
            // ── B-1g：Admin audit / cron / deals / oauth-clients ─
            INVALID_SEVERITY: 'severity は info / warn / critical のいずれかを指定してください',
            FROM_DATE_INVALID: '開始日の形式が正しくありません（ISO 8601 形式）',
            TO_DATE_INVALID: '終了日の形式が正しくありません（ISO 8601 形式）',
            AUDIT_NOT_FOUND: '監査ログが見つかりません',
            CRON_SECRET_NOT_CONFIGURED: 'CRON_SECRET が設定されていません',
            USER_ID_INVALID: 'user_id の形式が正しくありません（数値が必要）',
            CLIENT_NOT_FOUND: 'クライアントが見つかりません',
            NO_UPDATABLE_FIELDS: '更新可能な項目がありません',
            CLIENT_ALREADY_DISABLED: 'クライアントは既に無効化されています',
            INVALID_ACTION: 'action パラメーターが無効です',
            // ── B-1h：Admin payments / requisition-refund / requisitions / revoke / users ─
            REFUND_REQUEST_NOT_FOUND: '返金申請が見つかりません',
            ECPAY_REFUND_FAILED: 'ECPay の返金に失敗しました',
            REFUND_NOT_IMPLEMENTED: 'この決済プロバイダーは返金に対応していません',
            TRADE_NO_NOT_FOUND: '取引番号が見つかりません。返金処理を実行できません',
            CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE: '同等または上位の権限を持つユーザーに対してこの操作はできません',
            CANNOT_TARGET_SELF: '自分自身に対してこの操作はできません',
            DEVICE_UUID_REQUIRED: 'device_uuid を指定してください',
            INTENT_ID_REQUIRED: 'intent_id を指定してください',
            INVALID_MODE: 'mode パラメーターが無効です',
            JTI_REQUIRED: 'jti を指定してください',
            LINKED_INTENT_NOT_FOUND: '関連する決済情報が見つかりません',
            USER_ALREADY_BANNED: 'このユーザーは既に停止されています',
            USER_NOT_BANNED: 'このユーザーは停止されていません',
            // OD-3 credential requires_reverification
            CREDENTIAL_REVERIFICATION_REQUIRED: 'このログイン方法は再認証が必要です。別の方法でログインし、アカウント設定で再認証を完了してください',
            CREDENTIAL_NOT_FLAGGED: 'この項目は現在、再認証の必要はありません',
            CREDENTIAL_REVERIFICATION_HIGH_RISK: 'この項目はサポートによる審査または削除が必要で、セルフ再認証はできません',
            CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL: '利用可能な認証手段がありません。パスワードを設定するか、サポートにお問い合わせください',
            CREDENTIAL_REVERIFICATION_PROOF_FAILED: '認証に失敗しました。コードまたはパスワードを確認してください',
        },
        ko: {
            INVALID_OTP: '인증 코드가 올바르지 않습니다',
            TOTP_REQUIRED: '2단계 인증 코드가 필요합니다',
            TOKEN_REVOKED: '세션이 만료되었습니다. 다시 로그인해주세요',
            SESSION_EXPIRED: '세션이 만료되었습니다. 다시 로그인해주세요',
            SESSION_REVOKED: '세션이 만료되었습니다. 다시 로그인해주세요',
            UNAUTHORIZED: '인증되지 않았습니다. 다시 로그인해주세요',
            RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요',
            ACCOUNT_BANNED: '이 계정은 정지되었습니다. 고객센터로 문의해주세요',
            BAD_PASSWORD: '비밀번호가 올바르지 않습니다',
            USER_NOT_FOUND: '계정을 찾을 수 없습니다',
            INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않습니다',
            CAPTCHA_FAILED: '봇 검증에 실패했습니다. 페이지를 새로고침한 후 다시 시도하세요',
            WRONG_TOKEN_SCOPE: '토큰 권한 범위가 올바르지 않습니다',
            PRE_AUTH_TOKEN_FORBIDDEN: '토큰 권한이 부족합니다. 2단계 인증을 먼저 완료해주세요',
            WEBHOOK_VALIDATION_FAILED: 'Webhook 검증에 실패했습니다',
            UNKNOWN_KYC_VENDOR: '알 수 없는 KYC 공급자: {vendor}',
            UNKNOWN_PAYMENT_VENDOR: '알 수 없는 결제 공급자: {vendor}',
            INVALID_TARGET: '대상 형식이 올바르지 않습니다',
            INVALID_CLIENT_BODY: '요청 형식이 올바르지 않습니다',
            INVALID_REQUISITION_BODY: '의뢰 내용 형식이 올바르지 않습니다',
            LOCAL_ACCOUNT_NOT_FOUND: '이 계정은 비밀번호 로그인을 지원하지 않습니다',
            INVALID_EMAIL: '이메일 형식이 올바르지 않습니다',
            EMAIL_ALREADY_REGISTERED: '이미 등록된 이메일입니다. 로그인해주세요',
            PASSWORD_TOO_SHORT: '비밀번호는 8자 이상이어야 합니다',
            WEAK_PASSWORD: '비밀번호는 12자 이상, 또는 8자 이상이며 대문자 / 소문자 / 숫자 / 기호 중 3종을 포함해야 합니다.',
            TFA_ALREADY_ENABLED: '2단계 인증이 이미 활성화되어 있습니다',
            INVALID_REQUEST: '요청이 유효하지 않습니다. 다시 로그인해주세요',
            PKCE_EXPIRED: '인증 세션이 유효하지 않거나 만료되었습니다. 다시 로그인해주세요',
            RISK_BLOCKED: '위험도가 높아 로그인이 차단되었습니다. 이메일을 확인해주세요.',
            COOLDOWN: '{retry_after}초 후에 다시 시도해주세요.',
            NETWORK_ERROR: '네트워크 오류입니다. 연결을 확인하고 다시 시도해주세요',
            INVALID_JSON: '요청 형식이 잘못되었습니다. 페이지를 새로고침하고 다시 시도해주세요',
            EMAIL_REQUIRED: '이메일을 입력해주세요',
            EMAIL_PASSWORD_REQUIRED: '이메일과 비밀번호를 입력해주세요',
            INVALID_EMAIL_FORMAT: '이메일 형식이 올바르지 않습니다',
            TOKEN_AND_PASSWORD_REQUIRED: '링크가 유효하지 않습니다. 비밀번호 재설정을 다시 요청해주세요',
            TOKEN_INVALID_OR_EXPIRED: '링크가 만료되었거나 유효하지 않습니다. 비밀번호 재설정을 다시 요청해주세요',
            ACCOUNT_NOT_FOUND: '계정을 찾을 수 없습니다',
            TFA_VERIFICATION_REQUIRED: '2단계 인증 코드를 입력해주세요',
            OTP_CODE_REQUIRED: '인증 코드를 입력해주세요',
            OTP_CODE_INVALID_FORMAT: '인증 코드는 6자리 숫자여야 합니다',
            OTP_OR_BACKUP_CODE_REQUIRED: '인증 코드 또는 백업 코드를 입력해주세요',
            TFA_SETUP_REQUIRED: '2단계 인증 설정을 먼저 완료해주세요',
            TFA_NOT_ENABLED: '2단계 인증이 활성화되어 있지 않습니다',
            INVALID_OR_USED_BACKUP_CODE: '백업 코드가 유효하지 않거나 이미 사용되었습니다',
            INVALID_OTP_OR_BACKUP_CODE: '인증 코드 또는 백업 코드가 올바르지 않습니다',
            BACKUP_CODE_FAIL_TOKEN_CONSUMED: '백업 코드가 잘못되어 링크가 만료되었습니다. 비밀번호 재설정을 다시 요청해주세요',
            PASSWORD_REQUIRED: '비밀번호를 입력해주세요',
            PASSWORD_NOT_SET: '이 계정에 로그인 비밀번호가 설정되지 않았습니다. 먼저 비밀번호를 설정해주세요',
            BAD_OTP: '인증 코드가 올바르지 않습니다',
            AUDIT_CHAIN_FAILED: '감사 로그 기록에 실패했습니다. 잠시 후 다시 시도해주세요',
            INVALID_STATUS: '현재 상태에서는 이 작업을 수행할 수 없습니다',
            REFUND_ALREADY_PENDING: '이 결제는 이미 환불 신청 중입니다. 관리자 검토를 기다려주세요',
            UNKNOWN_TARGET_ROLE: '대상 사용자의 역할을 알 수 없어 안전을 위해 거부되었습니다',
            ALREADY_BOUND: '이미 연결되어 중복으로 연결할 수 없습니다',
            INSUFFICIENT_SCOPE: '권한이 부족합니다 ({required} 권한 범위 필요)',
            INTENT_RACE_CONFLICT: '이 결제는 처리 중이거나 상태가 변경되었습니다',
            KYC_LEVEL_INSUFFICIENT: '추가 KYC 인증이 필요합니다',
            KYC_REQUIRED: 'KYC 인증이 필요합니다',
            REASON_REQUIRED: '사유를 입력해주세요',
            REFUND_PENDING_RECONCILIATION: '환불이 전송되었으나 네트워크 오류로 인해 대사 결과를 기다려주세요',
            STATUS_LOCKED: '결제 증빙의 최종 상태이므로 삭제하거나 익명화할 수 없습니다',
            AI_ERROR: 'AI 서비스가 일시적으로 사용 불가능합니다. 나중에 다시 시도하거나 직접 양식을 작성해주세요',
            AMOUNT_OVERFLOW: '금액이 범위를 초과했습니다',
            BLOCKED: '입력 내용에 허용되지 않는 명령 패턴이 포함되어 있습니다',
            CHUNK_NOT_FOUND: '아카이브 청크를 찾을 수 없습니다',
            CHUNK_STATE_MISMATCH: '아카이브 청크 상태가 일치하지 않아 이 작업을 수행할 수 없습니다',
            CLIENT_ID_TAKEN: '이 client_id는 이미 사용 중입니다',
            DEAL_INSERT_FAILED: '거래 기록 생성에 실패했습니다. 잠시 후 다시 시도해주세요',
            EVENT_NOT_DELETABLE: '이 이벤트 유형은 삭제할 수 없습니다',
            HAS_UNREFUNDED_PAYMENT: '이 요청서에는 환불되지 않은 성공 결제가 있습니다. 먼저 환불해주세요',
            INSUFFICIENT_ROLE: '역할 권한이 부족합니다',
            INTENT_INVALID_STATUS: '연결된 결제 상태가 일치하지 않아 계속할 수 없습니다',
            INVALID_AMOUNT: '금액이 유효하지 않습니다 ({min}~{max} 범위 내로 입력)',
            INVALID_OUTPUT: 'AI 응답 형식이 비정상입니다. 수동 입력으로 변경해주세요',
            IP_BLOCKED: '의심스러운 활동으로 인해 이 IP가 일시적으로 차단되었습니다',
            MIXED_CURRENCY: '이 요청서에는 여러 통화가 포함되어 있습니다. 먼저 처리해주세요',
            MUST_REVOKE_FIRST: '먼저 철회한 후 이 작업을 수행해주세요',
            NOT_IMPLEMENTED: '이 기능은 아직 구현되지 않았습니다',
            PAYMENT_VENDOR_MISCONFIGURED: '결제 공급사 설정에 문제가 있습니다. 고객센터에 문의해주세요',
            SAVE_RACE_CONFLICT: '이 요청서는 다른 관리자에 의해 저장되거나 삭제되었습니다',
            SIGNATURE_INVALID: '지갑 서명 검증에 실패했습니다',
            STEP_UP_ACTION_MISMATCH: 'Step-up 인증이 필요한 작업과 일치하지 않습니다. 재인증해주세요',
            STEP_UP_REQUIRED: '이 작업을 수행하려면 재인증이 필요합니다',
            STEP_UP_REQUIRES_2FA: 'Step-up 전에 2단계 인증을 활성화해주세요',
            STEP_UP_REVOKED: 'Step-up 인증이 무효화되었습니다. 재인증해주세요',
            STEP_UP_ROLE_DRIFT: '인증 후 역할이 변경되었습니다. 다시 로그인해주세요',
            STEP_UP_USER_GONE: '계정이 존재하지 않거나 삭제되었습니다',
            TOO_LONG: '입력 내용이 길이 제한을 초과했습니다',
            TURNSTILE_FAILED: '봇 검증에 실패했습니다. 다시 시도해주세요',
            TURNSTILE_REQUIRED: '봇 검증을 완료해주세요',
            UNKNOWN_ACTOR_ROLE: '계정 역할을 알 수 없습니다. 다시 로그인해주세요',
            // ── B-1c：OAuth / WebAuthn / Wallet ─────────────────────
            UNSUPPORTED_PROVIDER: '지원하지 않는 로그인 방식입니다',
            PROVIDER_NOT_CONFIGURED: '이 로그인 방식이 아직 설정되지 않았습니다. 잠시 후 다시 시도해주세요',
            APPLE_LOGIN_NOT_AVAILABLE: 'Apple 로그인은 아직 사용할 수 없습니다',
            INVALID_PLATFORM: 'platform 은 web, pc, mobile 중 하나여야 합니다',
            OAUTH_STATE_SAVE_FAILED: 'OAuth 상태 저장에 실패했습니다. 다시 시도해주세요',
            OAUTH_UNSUPPORTED_RESPONSE_TYPE: 'response_type=code 만 지원합니다',
            OAUTH_AUTHORIZE_REQUIRED_FIELDS: 'redirect_uri, code_challenge, state 가 필요합니다',
            OAUTH_UNSUPPORTED_PKCE_METHOD: 'code_challenge_method=S256 만 지원합니다',
            REDIRECT_URI_NOT_ALLOWED: 'redirect_uri 가 허용 목록에 없습니다',
            INVALID_REQUEST_FORMAT: '요청 형식이 올바르지 않습니다',
            MISSING_REQUIRED_FIELD: '필수 항목이 누락되었습니다',
            LINK_INVALID_OR_EXPIRED: '링크가 유효하지 않거나 만료되었습니다. 다시 로그인해주세요',
            LINK_TYPE_INVALID: '링크 유형이 올바르지 않습니다',
            TOKEN_DATA_INCOMPLETE: '토큰 데이터가 불완전합니다',
            EMAIL_USED_BIND_AFTER_LOGIN: '이 이메일은 기존 계정에서 사용 중입니다. 기존 방식으로 로그인 후 계정 설정에서 {provider} 를 연결해주세요.',
            ACCOUNT_LOOKUP_FAILED_AFTER_CREATE: '계정 생성 후 조회에 실패했습니다. 잠시 후 다시 시도해주세요',
            ACCOUNT_DISABLED: '이 계정은 비활성화되었습니다',
            PKCE_KEY_REQUIRED: 'pkce_key 가 필요합니다',
            INVALID_PKCE_SESSION: 'PKCE 세션이 유효하지 않거나 만료되었습니다',
            OAUTH_CODE_REQUIRED_FIELDS: 'code, code_verifier, redirect_uri 가 필요합니다',
            INVALID_AUTHORIZATION_CODE: '인증 코드가 유효하지 않거나 만료되었습니다',
            REDIRECT_URI_MISMATCH: 'redirect_uri 가 일치하지 않습니다',
            PKCE_VERIFICATION_FAILED: 'PKCE 검증에 실패했습니다',
            INVALID_ID: 'ID 형식이 올바르지 않습니다',
            WALLET_NOT_FOUND: '지갑을 찾을 수 없습니다',
            INVALID_WALLET_ADDRESS: '유효하지 않은 Ethereum 주소입니다',
            WALLET_MESSAGE_SIGNATURE_REQUIRED: 'message 와 signature 가 필요합니다',
            NONCE_INVALID_OR_EXPIRED: 'Nonce 가 유효하지 않거나 만료되었습니다',
            NONCE_MISMATCH: 'Nonce 가 일치하지 않습니다',
            WALLET_ADDRESS_MISMATCH: '지갑 주소가 nonce 와 일치하지 않습니다',
            INVALID_NICKNAME: '닉네임 형식이 올바르지 않습니다 (빈 문자열 불가, 길이 제한 있음)',
            CREDENTIAL_NOT_FOUND: '인증 정보를 찾을 수 없습니다',
            RESPONSE_REQUIRED: '검증 데이터가 필요합니다',
            INVALID_CLIENT_DATA: 'clientDataJSON 형식이 올바르지 않습니다',
            CHALLENGE_INVALID_OR_EXPIRED: 'Challenge 가 유효하지 않거나 만료되었습니다',
            CHALLENGE_MISMATCH: 'Challenge 가 일치하지 않습니다',
            WEBAUTHN_VERIFICATION_FAILED: 'WebAuthn 검증에 실패했습니다',
            WEBAUTHN_VERIFICATION_INCOMPLETE: 'WebAuthn 검증 데이터가 불완전합니다',
            CREDENTIAL_ALREADY_REGISTERED: '이 인증 정보는 이미 등록되어 있습니다',
            INTERNAL_ERROR: '서버 오류입니다. 잠시 후 다시 시도해주세요',
            INCORRECT_PASSWORD: '비밀번호가 올바르지 않습니다',
            EMAIL_SEND_FAILED: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요',
            TOKEN_REQUIRED: '토큰이 필요합니다',
            INVALID_DELETION_TOKEN: '계정 삭제 토큰이 유효하지 않거나 만료되었습니다',
            EMAIL_ALREADY_VERIFIED: '이메일이 이미 인증되었습니다',
            PC_PORT_REQUIRED: '데스크톱 로그인에는 유효한 port (4-5자리) 가 필요합니다',
            PROVIDER_REQUIRED: '로그인 방법을 선택해주세요',
            LAST_AUTH_METHOD: '마지막 인증 방법은 제거할 수 없습니다',
            PROVIDER_NOT_BOUND: '이 로그인 방법이 연결되어 있지 않습니다',
            REFRESH_TOKEN_REQUIRED: 'refresh_token 이 필요합니다',
            INVALID_REFRESH_TOKEN: 'Refresh Token 이 유효하지 않거나 만료되었습니다',
            REFRESH_TOKEN_REVOKED: 'Refresh Token 이 폐기되었습니다. 다시 로그인해주세요',
            DEVICE_MISMATCH: '장치가 일치하지 않습니다. 원래 장치에서 시도해주세요',
            INVALID_SCOPE: 'scope 매개변수가 유효하지 않습니다',
            INVALID_FOR_ACTION: 'for_action 형식이 올바르지 않습니다',
            INVALID_TOKEN_SUBJECT: 'Token subject 가 유효하지 않습니다',
            // ── B-1e：Dashboard ─
            NEW_PASSWORD_REQUIRED: '새 비밀번호를 입력해주세요',
            INVALID_DEVICE_UUID: '장치 식별자 형식이 올바르지 않습니다',
            DEVICE_NOT_FOUND: '장치를 찾을 수 없습니다',
            INTENT_NOT_FOUND: '결제 정보를 찾을 수 없습니다',
            // ── B-1f：Requisition / AI ─
            PROMPT_REQUIRED: '질문 내용을 입력해주세요',
            AI_DAILY_LIMIT: '오늘 AI 어시스턴트 호출 한도에 도달했습니다. 나중에 다시 시도하거나 양식을 직접 작성해주세요',
            REQUISITION_DAILY_LIMIT: '오늘 문의 제출 한도에 도달했습니다. 긴급한 경우 전화 또는 LINE 으로 연락해주세요',
            REQUISITION_NOT_FOUND: '요청을 찾을 수 없습니다',
            REQUISITION_ID_REQUIRED: 'requisition_id가 필요합니다',
            REQUISITION_IN_PROCESS: '이 요청은 처리 중이므로 취소할 수 없습니다',
            // ── B-1g：Admin audit / cron / deals / oauth-clients ─
            INVALID_SEVERITY: 'severity 는 info / warn / critical 중 하나여야 합니다',
            FROM_DATE_INVALID: '시작일 형식이 올바르지 않습니다 (ISO 8601 형식)',
            TO_DATE_INVALID: '종료일 형식이 올바르지 않습니다 (ISO 8601 형식)',
            AUDIT_NOT_FOUND: '감사 기록을 찾을 수 없습니다',
            CRON_SECRET_NOT_CONFIGURED: 'CRON_SECRET 이 설정되지 않았습니다',
            USER_ID_INVALID: 'user_id 형식이 올바르지 않습니다 (숫자 필요)',
            CLIENT_NOT_FOUND: '클라이언트를 찾을 수 없습니다',
            NO_UPDATABLE_FIELDS: '업데이트 가능한 필드가 없습니다',
            CLIENT_ALREADY_DISABLED: '클라이언트가 이미 비활성화되었습니다',
            INVALID_ACTION: 'action 매개변수가 유효하지 않습니다',
            // ── B-1h：Admin payments / requisition-refund / requisitions / revoke / users ─
            REFUND_REQUEST_NOT_FOUND: '환불 요청을 찾을 수 없습니다',
            ECPAY_REFUND_FAILED: 'ECPay 환불에 실패했습니다',
            REFUND_NOT_IMPLEMENTED: '이 결제 공급자는 환불을 지원하지 않습니다',
            TRADE_NO_NOT_FOUND: '거래 번호를 찾을 수 없어 환불을 처리할 수 없습니다',
            CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE: '동등하거나 더 높은 권한을 가진 사용자에게 이 작업을 수행할 수 없습니다',
            CANNOT_TARGET_SELF: '자기 자신에게 이 작업을 수행할 수 없습니다',
            DEVICE_UUID_REQUIRED: 'device_uuid 를 입력해주세요',
            INTENT_ID_REQUIRED: 'intent_id 를 입력해주세요',
            INVALID_MODE: 'mode 매개변수가 유효하지 않습니다',
            JTI_REQUIRED: 'jti 를 입력해주세요',
            LINKED_INTENT_NOT_FOUND: '연결된 결제 정보를 찾을 수 없습니다',
            USER_ALREADY_BANNED: '이 사용자는 이미 정지되었습니다',
            USER_NOT_BANNED: '이 사용자는 정지되지 않았습니다',
            // OD-3 credential requires_reverification
            CREDENTIAL_REVERIFICATION_REQUIRED: '이 로그인 방법은 다시 인증해야 사용할 수 있습니다. 다른 방법으로 로그인한 뒤 회원 센터에서 재인증을 완료해 주세요',
            CREDENTIAL_NOT_FLAGGED: '이 항목은 현재 재인증이 필요하지 않습니다',
            CREDENTIAL_REVERIFICATION_HIGH_RISK: '이 항목은 고객센터 검토 또는 삭제가 필요하며 셀프 재인증을 할 수 없습니다',
            CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL: '사용 가능한 인증 수단이 없습니다. 비밀번호를 설정하거나 고객센터에 문의해 주세요',
            CREDENTIAL_REVERIFICATION_PROOF_FAILED: '인증에 실패했습니다. 코드 또는 비밀번호를 확인해 주세요',
        },
    };
    // 後端尚未附 code: 的 handler，用英文 string 映射回 code（漸進遷移用）
    const BACKEND_ERR_LEGACY_MAP = {
        'Invalid OTP code': 'INVALID_OTP',
        'Invalid OTP or backup code': 'INVALID_OTP',
        'Token revoked': 'TOKEN_REVOKED',
        'Unauthorized': 'UNAUTHORIZED',
        'Too many requests': 'RATE_LIMITED',
        'Too many requests. Please try again later.': 'RATE_LIMITED',
        'Account is banned': 'ACCOUNT_BANNED',
        'Incorrect password': 'BAD_PASSWORD',
        'Account not found': 'USER_NOT_FOUND',
        'captcha_failed': 'CAPTCHA_FAILED',
        'Invalid credentials': 'INVALID_CREDENTIALS',
        'Local account not found': 'LOCAL_ACCOUNT_NOT_FOUND',
        'Invalid email format': 'INVALID_EMAIL',
        'Email already registered': 'EMAIL_ALREADY_REGISTERED',
        'Password must be at least 8 characters': 'PASSWORD_TOO_SHORT',
        'Password must be ≥12 chars, or ≥8 chars with 3 of: uppercase / lowercase / digit / symbol': 'WEAK_PASSWORD',
        '2FA is already enabled': 'TFA_ALREADY_ENABLED',
        'Invalid request': 'INVALID_REQUEST',
        'Invalid or expired PKCE session': 'PKCE_EXPIRED',
    };
    function _getLang() {
        try {
            return localStorage.getItem('lang') || 'zh-TW';
        }
        catch {
            return 'zh-TW';
        }
    }
    // 後端 ApiError → 在地化字串。優先順位：
    //   1. e.code → API_ERROR_I18N[lang][code]
    //   2. e.body.error 英文 string → BACKEND_ERR_LEGACY_MAP → API_ERROR_I18N
    //   3. e.message（後端原文）
    //   4. fallback 參數
    // 動態欄位 {name} 從 e.body 取值替換。
    // 非 ApiError 或 status === 0（network error）→ 直接回 fallback。
    function tApiError(e, fallback) {
        if (!(e instanceof ApiError) || e.status === 0)
            return fallback ?? '';
        const dict = API_ERROR_I18N[_getLang()] || API_ERROR_I18N['zh-TW'];
        const bodyShape = (e.body && typeof e.body === 'object' ? e.body : null);
        const code = e.code || (bodyShape?.error ? BACKEND_ERR_LEGACY_MAP[bodyShape.error] : null) || null;
        let base = (code && dict[code]) || e.message || fallback || '';
        if (code && dict[code]) {
            base = base.replace(/\{(\w+)\}/g, (_, k) => {
                const v = bodyShape?.[k];
                return v == null ? '' : String(v);
            });
        }
        return e.traceId ? `${base}（#${e.traceId}）` : base;
    }
    // 給 raw fetch（非 apiFetch）後拿到的 { error, code, ... } 物件用 — 同樣的 mapping 邏輯。
    // auth-ui.js 的 login/register/2fa 走 raw fetch，沒有 ApiError instance，用這個。
    function tApiErrorData(data, fallback) {
        if (!data || typeof data !== 'object')
            return fallback ?? '';
        const shape = data;
        const dict = API_ERROR_I18N[_getLang()] || API_ERROR_I18N['zh-TW'];
        const code = shape.code || (shape.error ? BACKEND_ERR_LEGACY_MAP[shape.error] : null) || null;
        if (code && dict[code]) {
            return dict[code].replace(/\{(\w+)\}/g, (_, k) => {
                const v = shape[k];
                return v == null ? '' : String(v);
            });
        }
        return shape.error || fallback || '';
    }
    // 向後相容：原 formatApiError 對 ApiError 也走新 mapping
    function formatApiError(e, fallback = 'Something went wrong') {
        return tApiError(e, fallback);
    }
    // 對外暴露 silent refresh — 用在 step-up 等需要先確認 token 還有效的流程
    // （step-up 自己 call 用 raw fetch，不走 apiFetch retry，避免遞迴）
    window.apiFetch = apiFetch;
    window.ApiError = ApiError;
    window.tApiError = tApiError;
    window.tApiErrorData = tApiErrorData;
    window.formatApiError = formatApiError;
    window.silentRefresh = _silentRefreshBoolean;
    window.__apiErrorI18n = API_ERROR_I18N;
})();
