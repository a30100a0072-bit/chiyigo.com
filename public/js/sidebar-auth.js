// 公開頁 sidebar 底部「會員登入 / 會員中心 / 登出」三態切換 + 跨分頁登入狀態同步。
//
// 三層機制：
//   1. sessionStorage.access_token 為主要狀態來源（per-tab）
//   2. 開新分頁無 token 時 → 自動 /api/auth/refresh（HttpOnly cookie 跨分頁有效）→ 拿回 token
//      用 navigator.locks 防 race（多分頁同時 refresh 會 revoke 第一個之後的）
//   3. BroadcastChannel 'chiyigo-auth' — 任一分頁拿到 token / 登出 → 即時廣播給其他分頁，
//      不必等到下次 storage 事件或 reload
//
// guest:  <a data-auth="guest"> 會員登入
// member: <a data-auth="member"> 會員中心 + <button data-auth="member" data-logout> 登出
(function () {
  'use strict';

  var TOKEN_KEY    = 'access_token';
  var CHANNEL_NAME = 'chiyigo-auth';
  var LOCK_NAME    = 'chiyigo-auth-refresh';

  var _channel = null;
  try { _channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_NAME) : null; }
  catch (_) { _channel = null; }

  function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch (_) { return null; }
  }
  function writeToken(t) {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else   sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  }

  function applyAuthState() {
    var hasTok = !!readToken();
    document.querySelectorAll('[data-auth="guest"]').forEach(function (el) {
      el.hidden = hasTok;
    });
    document.querySelectorAll('[data-auth="member"]').forEach(function (el) {
      el.hidden = !hasTok;
    });
  }

  function broadcastLogin(token) {
    if (!_channel) return;
    try { _channel.postMessage({ type: 'login', token: token }); } catch (_) {}
  }
  function broadcastLogout() {
    if (!_channel) return;
    try { _channel.postMessage({ type: 'logout' }); } catch (_) {}
  }

  // 跑一次 /api/auth/refresh；成功 → 寫 token + 廣播 + re-apply UI
  async function doRefresh() {
    try {
      var r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!r.ok) return false;
      var data = await r.json();
      if (!data || !data.access_token) return false;
      writeToken(data.access_token);
      broadcastLogin(data.access_token);
      applyAuthState();
      return true;
    } catch (_) { return false; }
  }

  // 入口：sessionStorage 沒 token 時試一次 refresh；用 navigator.locks 序列化避免多分頁同時 rotate
  async function silentRefreshIfNeeded() {
    if (readToken()) return;
    if ('locks' in navigator) {
      try {
        await navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, async function () {
          // 進到 lock 後再檢一次：別的分頁可能在我等 lock 時已 broadcast token 過來
          if (readToken()) { applyAuthState(); return; }
          await doRefresh();
        });
        return;
      } catch (_) { /* fallthrough to no-lock path */ }
    }
    // navigator.locks 不支援 → 直接打（接受少量 race 風險，僅影響同時開多分頁的瞬間）
    await doRefresh();
  }

  // OIDC RP-Initiated Logout：跳 chiyigo end_session_endpoint，
  // 它會撤所有 refresh + 嵌 iframe 同步登出 mbti / talo（front-channel logout）
  // 沒有 id_token_hint 也能跑（cookie token 還是會被撤）
  function doLogout() {
    writeToken(null);
    broadcastLogout();
    var url = '/api/auth/oauth/end-session?post_logout_redirect_uri=' +
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
    if (_channel) {
      _channel.addEventListener('message', function (e) {
        if (!e.data) return;
        if (e.data.type === 'login' && e.data.token) {
          writeToken(e.data.token);
          applyAuthState();
        } else if (e.data.type === 'logout') {
          writeToken(null);
          applyAuthState();
        }
      });
    }

    // localStorage 跨分頁同步 fallback（舊瀏覽器 / BroadcastChannel disabled）
    // 也監聽 OIDC Front-Channel Logout 訊號（其他子站登出 → 同源主頁分頁立刻清狀態）
    window.addEventListener('storage', function (e) {
      if (e.key === 'oidc_logout_at') {
        writeToken(null);
        applyAuthState();
        return;
      }
      if (e.key === TOKEN_KEY || e.key === null) applyAuthState();
    });

    // 進站時 sessionStorage 為空 → 試 silent refresh（HttpOnly cookie 跨分頁有效）
    silentRefreshIfNeeded();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
