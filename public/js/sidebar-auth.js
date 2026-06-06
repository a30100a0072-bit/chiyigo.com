(function () {
    'use strict';
    const win = window;
    // refresh 路徑專用：只讀「既有」device id（read-only，不 get-or-create）。refresh token 綁登入時的
    // device id；refresh 帶不符值（含新生 UUID）→ 後端 device_mismatch、撤整個 device family（refresh.ts:131）。
    // 故缺/不合法時回 null，由呼叫端 fail-closed（不打 refresh）。創建路徑（login）才 get-or-create（在 auth-ui.ts）。
    function readDeviceUuidForRefresh() {
        const KEY = 'chiyigo.device_uuid';
        const RE = /^web-[0-9a-f-]{36}$/i;
        try {
            const v = localStorage.getItem(KEY);
            if (v && RE.test(v))
                return v;
        }
        catch (_) { /* localStorage blocked */ }
        const mem = win.__chiyigoMemoryDeviceUuid;
        if (mem && RE.test(mem))
            return mem;
        return null;
    }
    const TOKEN_KEY = 'access_token';
    const CHANNEL_NAME = 'chiyigo-auth';
    const LOCK_NAME = 'chiyigo-auth-refresh';
    // 持 chiyigo-auth-refresh 鎖的「持鎖上限」(ms)。逾時只放鎖、不 abort in-flight rotation
    // （abort 一個已在 server 端 commit 的 rotation 會在 client 留下已撤銷 cookie）；refresh 在背景
    // 跑完、晚到的成功由 authEpoch guard 把關。bound 的是「持鎖時間」，不是 fetch 本身。
    const RAW_REFRESH_LOCK_BUDGET_MS = 10000;
    // 登出/登入世代計數：本分頁每觀察到 logout / front-channel logout / 外部登入即 +1。doRawRefresh
    // 發 fetch 前捕捉當下世代、套用結果前比對；世代已變 → 不以晚到的 refresh 結果做 JS 端 writeToken /
    // broadcastLogin（避免覆蓋較新的登入 token、或視覺上復活已登出 session）。
    // ⚠ 此 guard 僅擋「JS 端晚寫」；對「已送出 fetch 的晚到 Set-Cookie」cookie-side race 無能為力，
    //   那需後端 rotation grace window（Fork 2 follow-up）才能根治。
    let authEpoch = 0;
    let channel = null;
    try {
        channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_NAME) : null;
    }
    catch (_) {
        channel = null;
    }
    function readToken() {
        try {
            return sessionStorage.getItem(TOKEN_KEY);
        }
        catch (_) {
            return null;
        }
    }
    function writeToken(t) {
        try {
            if (t)
                sessionStorage.setItem(TOKEN_KEY, t);
            else
                sessionStorage.removeItem(TOKEN_KEY);
        }
        catch (_) { /* storage blocked */ }
    }
    function applyAuthState() {
        const hasTok = !!readToken();
        document.querySelectorAll('[data-auth="guest"]').forEach(function (el) {
            el.hidden = hasTok;
        });
        document.querySelectorAll('[data-auth="member"]').forEach(function (el) {
            el.hidden = !hasTok;
        });
    }
    function broadcastLogin(token) {
        if (!channel)
            return;
        try {
            channel.postMessage({ type: 'login', token: token });
        }
        catch (_) { /* channel closed */ }
    }
    function broadcastLogout() {
        if (!channel)
            return;
        try {
            channel.postMessage({ type: 'logout' });
        }
        catch (_) { /* channel closed */ }
    }
    // 直接打 /api/auth/refresh 換 token；成功 → 寫 token + 廣播 + re-apply UI。
    // 關鍵：本 helper 永不委派 win.silentRefresh —— 它是給 fallback 的 navigator.locks
    // exclusive lock callback 內部用的。lock 內若委派 api.js 的 window.silentRefresh
    // （api.ts 會重取同名 chiyigo-auth-refresh exclusive lock，Web Locks 不可重入），會 re-entrant 死結。
    // 「lock 內絕不委派」這條不變量由本 helper 從結構上保證，不靠 doRefresh 的動態 win.silentRefresh 檢查。
    async function doRawRefresh() {
        const startEpoch = authEpoch;
        try {
            const devId = readDeviceUuidForRefresh();
            if (!devId)
                return false; // 缺既有 device id → fail-closed，不打 refresh
            const hdrs = { 'Content-Type': 'application/json', 'X-Device-Id': devId };
            const r = await fetch('/api/auth/refresh', {
                method: 'POST',
                credentials: 'include',
                headers: hdrs,
                body: '{}',
            });
            if (!r.ok)
                return false;
            const data = await r.json();
            if (!data || !data.access_token)
                return false;
            // 世代已變（fetch 期間發生 logout / 外部登入）→ 不做 JS 端晚寫，避免復活已登出 session
            // 或覆蓋較新的登入 token。
            if (authEpoch !== startEpoch)
                return false;
            writeToken(data.access_token);
            broadcastLogin(data.access_token);
            applyAuthState();
            return true;
        }
        catch (_) {
            return false;
        }
    }
    // 跑一次 /api/auth/refresh；成功 → 寫 token + 廣播 + re-apply UI
    // P0-11：有 api.js 時委派 window.silentRefresh（含 navigator.locks）；成功後自己讀回 token
    // 廣播 + 套 UI。無 api.js 時走 doRawRefresh()。
    // 注意：本函式會「動態委派」win.silentRefresh，故只能在「未持 chiyigo-auth-refresh 鎖」的路徑
    // 呼叫（top-level 委派 path / navigator.locks 不支援的 tail）；fallback 的 lock callback 內
    // 必走 doRawRefresh()（見上），不可走本函式。
    async function doRefresh() {
        if (typeof win.silentRefresh === 'function') {
            const ok = await win.silentRefresh();
            if (ok) {
                const t = readToken();
                if (t) {
                    broadcastLogin(t);
                    applyAuthState();
                    return true;
                }
            }
            return false;
        }
        // fallback（罕見：api.js 未 load）
        return doRawRefresh();
    }
    // 入口：sessionStorage 沒 token 時試一次 refresh；用 navigator.locks 序列化避免多分頁同時 rotate
    async function silentRefreshIfNeeded() {
        if (readToken())
            return;
        // api.js 的 window.silentRefresh 自己用 navigator.locks(chiyigo-auth-refresh) 協調 → 有它就「直接委派」、
        // 不要再包一層同名 exclusive lock。否則：本函式先持鎖，doRefresh 又透過 window.silentRefresh 重取同一把
        // exclusive lock → re-entrant 死結（同時載入 sidebar-auth.js + api.js 且無 token 的頁面穩定踩到：
        // accept-invitation / login / admin-* 的 no-token 進入）。lock ownership 收斂回單一 owner（api.js）。
        if (typeof win.silentRefresh === 'function') {
            await doRefresh(); // doRefresh 內部即委派 win.silentRefresh，由 api.js 獨佔該鎖
            return;
        }
        // legacy fallback：api.js 未載入時，由本檔自己用 navigator.locks 序列化直接 fetch，避免多分頁同時 rotate。
        if ('locks' in navigator) {
            try {
                await navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, async function () {
                    // 進到 lock 後再檢一次：別的分頁可能在我等 lock 時已 broadcast token 過來
                    if (readToken()) {
                        applyAuthState();
                        return;
                    }
                    // 持鎖中絕不委派 win.silentRefresh —— api.js 會重取同名 exclusive lock → re-entrant 死結。
                    // 故走 doRawRefresh()（永不委派），不走 doRefresh()。
                    // bound 的是「持鎖時間」非 fetch：race 一個 lock-budget timeout；逾時 → 退出 callback、放掉
                    // chiyigo-auth-refresh 鎖，讓 in-flight rotation 在背景跑完（從不 abort → 不會留下已撤銷
                    // cookie），避免「卡死的 refresh」starve 其他同鎖 refresher。晚到成功由 doRawRefresh 內
                    // authEpoch guard 把關。注意：本 PR 只 bound 公開 sidebar fallback 路徑；api.ts 與
                    // ai-assistant.html 的同鎖路徑仍 unbounded（residual / follow-up）。
                    let timer = null;
                    const lockBudget = new Promise(function (resolve) {
                        timer = setTimeout(resolve, RAW_REFRESH_LOCK_BUDGET_MS);
                    });
                    try {
                        // doRawRefresh 內部 try/catch 永不 reject；.catch 防衛吞掉任何意外 rejection，避免 detached
                        // 後成為 unhandled rejection。
                        await Promise.race([doRawRefresh().catch(function () { return false; }), lockBudget]);
                    }
                    finally {
                        if (timer !== null)
                            clearTimeout(timer);
                    }
                });
                return;
            }
            catch (_) { /* fallthrough to no-lock path */ }
        }
        // navigator.locks 不支援 → 直接打（接受少量 race 風險，僅影響同時開多分頁的瞬間）
        await doRefresh();
    }
    // OIDC RP-Initiated Logout：跳 chiyigo end_session_endpoint，
    // 它會撤所有 refresh + 嵌 iframe 同步登出 mbti / talo（front-channel logout）
    // 沒有 id_token_hint 也能跑（cookie token 還是會被撤）
    function doLogout() {
        authEpoch++; // 登出 → 作廢任何 in-flight raw refresh 的晚寫
        writeToken(null);
        broadcastLogout();
        const url = '/api/auth/oauth/end-session?post_logout_redirect_uri=' +
            encodeURIComponent('https://chiyigo.com/');
        location.href = url;
    }
    function init() {
        applyAuthState();
        // 登出按鈕綁定（支援動態 partial）
        document.querySelectorAll('[data-logout]').forEach(function (btn) {
            btn.addEventListener('click', doLogout);
        });
        // BroadcastChannel：另一個分頁登入 / 登出 → 即時同步本分頁 UI
        if (channel) {
            channel.addEventListener('message', function (e) {
                const data = e.data;
                if (!data)
                    return;
                if (data.type === 'login' && data.token) {
                    authEpoch++; // 外部登入較新 → 作廢 in-flight raw refresh 的晚寫，不覆蓋較新 token
                    writeToken(data.token);
                    applyAuthState();
                }
                else if (data.type === 'logout') {
                    authEpoch++;
                    writeToken(null);
                    applyAuthState();
                    // P0-12：私密頁要立刻跳 login，避免連鎖 401（公開頁僅切 UI）
                    const path = location.pathname;
                    const isPublic = path === '/' || path === '' || path.startsWith('/login') ||
                        path.startsWith('/index') || path.startsWith('/forgot-password') ||
                        path.startsWith('/reset-password') || path.startsWith('/verify-email');
                    if (!isPublic)
                        location.replace('/login.html?logout=other_tab');
                }
            });
        }
        // localStorage 跨分頁同步 fallback（舊瀏覽器 / BroadcastChannel disabled）
        // 也監聽 OIDC Front-Channel Logout 訊號（其他子站登出 → 同源主頁分頁立刻清狀態）
        window.addEventListener('storage', function (e) {
            if (e.key === 'oidc_logout_at') {
                authEpoch++;
                writeToken(null);
                applyAuthState();
                return;
            }
            if (e.key === TOKEN_KEY || e.key === null)
                applyAuthState();
        });
        // 進站時 sessionStorage 為空 → 試 silent refresh（HttpOnly cookie 跨分頁有效）
        void silentRefreshIfNeeded();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    }
    else {
        init();
    }
})();
