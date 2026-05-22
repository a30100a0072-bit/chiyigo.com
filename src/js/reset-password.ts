// Stage 5 PR-5e (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（getLang / T / applyLang / showPanel / setMsg /
// togglePwd / handlePasswordSubmit / handle2faSubmit / submitReset /
// startCountdown / tBackend / token / newPassword 等）在同 tsc program 全域
// scope 撞名 → TS2393。內層 mobile-overlay / theme-lang 既有 IIFE 維持不動。
// auth family 收尾（Stage 5 PR-5e）。
;(function () {
// ── i18n 字典 ────────────────────────────────────────────────
const I18N = /*@i18n@*/{};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

// 後端英文錯誤訊息 → 4 語對照（fallback 到原訊息）
const BACKEND_ERR = /*@i18n@*/{};
function tBackend(msg) {
  const e = BACKEND_ERR[msg]; if (!e) return msg;
  return e[getLang()] || e['zh-TW'] || msg;
}

function applyLang(lang) {
  try { localStorage.setItem('lang', lang) } catch {}
  document.documentElement.lang = lang;
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (k && dict[k] != null) el.textContent = dict[k];
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh; if (k && dict[k] != null) el.placeholder = dict[k];
  });
  document.querySelectorAll<HTMLElement>('.lang-opt,.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  // theme/lang 切換交給 sidebar-auth.js / 各頁 page JS（partial 提供 #theme-toggle-btn / #lang-toggle-btn / #lang-dropdown）
});

// ── 狀態 ─────────────────────────────────────────────────────
const token = new URLSearchParams(location.search).get('token') ?? '';
let newPassword = '';

if (!token) showPanel('panel-invalid');

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  setMsg('');
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box');
  if (!text) { box.style.display = 'none'; box.textContent = ''; return; }
  box.textContent = text;
  box.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success');
  box.style.display = 'block';
}

function togglePwd(inputId, iconId) {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const icon  = document.getElementById(iconId);
  if (!input || !icon) return;
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  icon.style.opacity = show ? '0.5' : '1';
}

async function handlePasswordSubmit(e) {
  e.preventDefault();
  const pwd     = (document.getElementById('new-password') as HTMLInputElement | null)?.value ?? '';
  const confirm = (document.getElementById('confirm-password') as HTMLInputElement | null)?.value ?? '';
  const btn     = document.getElementById('pwd-btn') as HTMLButtonElement | null;
  if (pwd !== confirm) { setMsg(T('err_pwd_mismatch')); return; }
  if (pwd.length < 8)  { setMsg(T('err_pwd_short')); return; }
  newPassword = pwd;
  await submitReset(btn, 'pwd-btn', null);
}

async function handle2faSubmit(e) {
  e.preventDefault();
  const code = (document.getElementById('totp-code') as HTMLInputElement | null)?.value.trim() ?? '';
  const btn  = document.getElementById('totp-btn') as HTMLButtonElement | null;
  if (!code) { setMsg(T('err_otp_empty')); return; }
  await submitReset(btn, 'totp-btn', code);
}

async function submitReset(btn, btnId, totpCode) {
  if (btn) { btn.disabled = true; btn.textContent = T('loading'); }
  setMsg('');

  const body: { token: string; new_password: string; totp_code?: string } = { token, new_password: newPassword };
  if (totpCode) body.totp_code = totpCode;

  try {
    const res  = await fetch('/api/auth/local/reset-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      // P1-22：成功 / 各種終止分支都要清掉 newPassword（敏感資料留 module scope 是 XSS 攻擊面）
      newPassword = '';
      // try/catch 包裹保留：缺 element 時 silent skip（與原 .js 行為等價）
      try { (document.getElementById('new-password') as HTMLInputElement).value = ''; (document.getElementById('confirm-password') as HTMLInputElement).value = ''; } catch {}
      showPanel('panel-success'); startCountdown(); return;
    }

    if (res.status === 403 && data.requires_2fa) {
      // 2FA 分支保留 newPassword（要送第二段）；其餘失敗一律清
      showPanel('panel-2fa');
      document.getElementById('totp-code')?.focus();
      return;
    }

    if (res.status === 400 && data.error?.includes('invalid or has expired')) {
      newPassword = '';
      showPanel('panel-invalid'); return;
    }

    // 其他錯誤（密碼太弱 / token 用過 / 5xx）— 清掉，user 重新輸入
    newPassword = '';
    setMsg(data.error ? tBackend(data.error) : T('err_generic'));
  } catch {
    newPassword = '';
    setMsg(T('err_network'));
  } finally {
    if (btn) {
      btn.disabled    = false;
      btn.textContent = btnId === 'pwd-btn' ? T('btn_reset') : T('btn_verify_reset');
    }
  }
}

function startCountdown() {
  let sec = 3;
  const el = document.getElementById('countdown');
  const iv = setInterval(() => {
    sec--;
    if (el) el.textContent = String(sec);
    if (sec <= 0) { clearInterval(iv); location.href = '/login.html?password_reset=1'; }
  }, 1000);
}

// ── Phase C-3 listener wiring ──
document.getElementById('panel-password')?.addEventListener('submit', handlePasswordSubmit);
document.getElementById('panel-2fa')?.addEventListener('submit', handle2faSubmit);
document.querySelectorAll<HTMLElement>('[data-toggle-pwd]').forEach(btn => {
  btn.addEventListener('click', () => togglePwd(btn.dataset.togglePwd, btn.dataset.toggleEye));
});
document.querySelectorAll<HTMLElement>('[data-show-panel]').forEach(btn => {
  btn.addEventListener('click', () => showPanel(btn.dataset.showPanel));
});

// Stage 5 PR-5e cleanup：移除 dead copy-paste / latent hazard
//   原：`document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);`
//   reset-password page 沒有 #form-forgot 且 handleSubmit 未定義 → TS2304；
//   optional chaining 在 null 時短路（無 runtime ReferenceError），但屬
//   forgot-password.js 複製殘骸，若日後 #form-forgot 出現立即爆。
//   （與 PR-5 verify-email / PR-5c confirm-delete 同款 cleanup）

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
