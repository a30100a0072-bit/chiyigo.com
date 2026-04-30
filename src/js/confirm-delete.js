// ── i18n ─────────────────────────────────────────────────────
const I18N = {
  'zh-TW': {
    back_login:'返回登入',
    title:'刪除帳號確認',
    subtitle:'此操作不可逆，請謹慎確認',
    danger_title:'以下資料將被永久刪除：',
    danger_li1:'帳號登入資訊與密碼',
    danger_li2:'雙重驗證設定與備用碼',
    danger_li3:'OAuth 第三方綁定',
    danger_li4:'所有個人資料與登入記錄',
    btn_confirm:'確認永久刪除我的帳號',
    btn_cancel:'取消，返回帳號設定',
    success_title:'帳號已刪除',
    success_desc:'你的帳號與個人資料已永久移除。感謝你使用 CHIYIGO。',
    countdown_suffix:' 秒後自動跳轉…',
    invalid_title:'連結無效或已過期',
    invalid_desc:'刪除確認連結僅能使用一次，且有效期為 15 分鐘。',
    btn_back_settings:'返回帳號設定',
    footer_note:'若非本人操作，請忽略此頁面，你的帳號不會有任何變動。',
    loading:'處理中…',
    err_default:'發生錯誤，請稍後再試。',
    err_network:'網路錯誤，請檢查連線後重試。',
  },
  en: {
    back_login:'Back to login',
    title:'Confirm Account Deletion',
    subtitle:'This action is irreversible. Please confirm carefully.',
    danger_title:'The following data will be permanently deleted:',
    danger_li1:'Account credentials and password',
    danger_li2:'Two-factor authentication and backup codes',
    danger_li3:'Third-party OAuth bindings',
    danger_li4:'All personal data and sign-in records',
    btn_confirm:'Permanently delete my account',
    btn_cancel:'Cancel and return to account settings',
    success_title:'Account deleted',
    success_desc:'Your account and personal data have been permanently removed. Thank you for using CHIYIGO.',
    countdown_suffix:' seconds until redirect…',
    invalid_title:'Link invalid or expired',
    invalid_desc:'The deletion link can only be used once, and is valid for 15 minutes.',
    btn_back_settings:'Back to account settings',
    footer_note:'If this was not you, please ignore this page — your account will remain unchanged.',
    loading:'Processing…',
    err_default:'An error occurred. Please try again later.',
    err_network:'Network error, please check your connection and retry.',
  },
  ja: {
    back_login:'ログインに戻る',
    title:'アカウント削除の確認',
    subtitle:'この操作は元に戻せません。慎重に確認してください。',
    danger_title:'以下のデータは完全に削除されます：',
    danger_li1:'アカウント認証情報とパスワード',
    danger_li2:'二段階認証とバックアップコード',
    danger_li3:'OAuth 第三者連携',
    danger_li4:'すべての個人データとログイン履歴',
    btn_confirm:'アカウントを完全に削除する',
    btn_cancel:'キャンセルしてアカウント設定に戻る',
    success_title:'アカウントを削除しました',
    success_desc:'アカウントと個人データは完全に削除されました。CHIYIGO をご利用いただきありがとうございました。',
    countdown_suffix:' 秒後に自動的にリダイレクトします…',
    invalid_title:'リンクが無効または期限切れです',
    invalid_desc:'削除確認リンクは1回のみ使用でき、有効期限は15分です。',
    btn_back_settings:'アカウント設定に戻る',
    footer_note:'本人による操作でない場合、このページを無視してください。アカウントには影響しません。',
    loading:'処理中…',
    err_default:'エラーが発生しました。しばらくしてからお試しください。',
    err_network:'ネットワークエラーです。接続を確認してください。',
  },
  ko: {
    back_login:'로그인으로 돌아가기',
    title:'계정 삭제 확인',
    subtitle:'이 작업은 되돌릴 수 없습니다. 신중하게 확인해 주세요.',
    danger_title:'다음 데이터가 영구적으로 삭제됩니다：',
    danger_li1:'계정 인증 정보 및 비밀번호',
    danger_li2:'2단계 인증 및 백업 코드',
    danger_li3:'OAuth 제3자 연동',
    danger_li4:'모든 개인 데이터 및 로그인 기록',
    btn_confirm:'내 계정을 영구적으로 삭제',
    btn_cancel:'취소하고 계정 설정으로 돌아가기',
    success_title:'계정이 삭제되었습니다',
    success_desc:'계정과 개인 데이터가 영구적으로 삭제되었습니다. CHIYIGO를 이용해 주셔서 감사합니다.',
    countdown_suffix:'초 후 자동으로 이동합니다…',
    invalid_title:'링크가 유효하지 않거나 만료됨',
    invalid_desc:'삭제 확인 링크는 한 번만 사용할 수 있으며, 유효 기간은 15분입니다.',
    btn_back_settings:'계정 설정으로 돌아가기',
    footer_note:'본인이 한 작업이 아니라면 이 페이지를 무시하세요. 계정에는 변동이 없습니다.',
    loading:'처리 중…',
    err_default:'오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    err_network:'네트워크 오류입니다. 연결을 확인해 주세요.',
  },
};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

function applyLang(lang) {
  try { localStorage.setItem('lang', lang) } catch {}
  document.documentElement.lang = lang;
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (dict[k] != null) el.textContent = dict[k];
  });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

function applyTheme(isLight) {
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-dark', !isLight);
  try { localStorage.setItem('theme', isLight ? 'light' : 'dark') } catch {}
  document.getElementById('theme-icon-dark').classList.toggle('hidden', isLight);
  document.getElementById('theme-icon-light').classList.toggle('hidden', !isLight);
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  applyTheme(document.documentElement.classList.contains('theme-light'));

  document.getElementById('theme-btn').addEventListener('click', () => {
    applyTheme(!document.documentElement.classList.contains('theme-light'));
  });
  const langMenu = document.getElementById('lang-menu');
  document.getElementById('lang-btn').addEventListener('click', e => {
    e.stopPropagation(); langMenu.classList.toggle('open');
  });
  langMenu.querySelectorAll('.lang-opt').forEach(opt => {
    opt.addEventListener('click', () => { applyLang(opt.dataset.lang); langMenu.classList.remove('open'); });
  });
  document.addEventListener('click', () => langMenu.classList.remove('open'));
});

// ── 刪除帳號流程 ─────────────────────────────────────────────
const token = new URLSearchParams(location.search).get('token') ?? ''

if (!token) showPanel('panel-invalid')

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box')
  if (!text) { box.classList.add('hidden'); return }
  box.textContent = text
  box.className = type === 'error'
    ? 'mb-5 px-4 py-3 rounded-lg text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400'
    : 'mb-5 px-4 py-3 rounded-lg text-sm font-medium bg-green-500/10 border border-green-500/20 text-green-400'
}

async function confirmDelete() {
  const btn = document.getElementById('confirm-btn')
  btn.disabled = true
  btn.textContent = T('loading')
  setMsg('')

  try {
    const res  = await fetch('/api/auth/delete/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      showPanel('panel-success')
      startCountdown()
      return
    }

    if (res.status === 400) {
      showPanel('panel-invalid')
      return
    }

    setMsg(data.error ?? T('err_default'))
  } catch {
    setMsg(T('err_network'))
  } finally {
    if (!document.getElementById('panel-success').classList.contains('active') &&
        !document.getElementById('panel-invalid').classList.contains('active')) {
      btn.disabled = false
      btn.textContent = T('btn_confirm')
    }
  }
}

function startCountdown() {
  let sec = 5
  const el = document.getElementById('countdown')
  const iv = setInterval(() => {
    sec--
    el.textContent = sec
    if (sec <= 0) { clearInterval(iv); location.href = '/login.html' }
  }, 1000)
}

// ── Phase C-3 listener wiring ──
document.getElementById('confirm-btn')?.addEventListener('click', confirmDelete);
