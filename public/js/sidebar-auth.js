// 公開頁 sidebar 底部「會員登入 / 會員中心 / 登出」三態切換。
// 依 sessionStorage.access_token 顯示 guest 或 member 區塊。
// guest: <a data-auth="guest"> 會員登入
// member: <a data-auth="member"> 會員中心 + <button data-auth="member" data-logout> 登出
(function () {
  function applyAuthState() {
    var hasTok = false;
    try { hasTok = !!sessionStorage.getItem('access_token'); } catch (_) {}
    document.querySelectorAll('[data-auth="guest"]').forEach(function (el) {
      el.hidden = hasTok;
    });
    document.querySelectorAll('[data-auth="member"]').forEach(function (el) {
      el.hidden = !hasTok;
    });
  }

  async function doLogout() {
    var token = null;
    try { token = sessionStorage.getItem('access_token'); } catch (_) {}
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
      });
    } catch (_) {}
    try { sessionStorage.removeItem('access_token'); } catch (_) {}
    location.href = '/';
  }

  // 登出按鈕紅色樣式改由 /css/sidebar-auth.css 提供 (CSP style-src 收緊後不能動態 inject style)

  function init() {
    applyAuthState();
    document.querySelectorAll('[data-logout]').forEach(function (btn) {
      btn.addEventListener('click', doLogout);
    });
    // 跨分頁同步：其他分頁登入/登出時即時更新
    window.addEventListener('storage', function (e) {
      if (e.key === 'access_token' || e.key === null) applyAuthState();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
