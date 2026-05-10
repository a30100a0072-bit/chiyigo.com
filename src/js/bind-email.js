// ── i18n ─────────────────────────────────────────────────────
const I18N = /*@i18n@*/{};

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

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  // theme/lang 切換交給 sidebar-auth.js
});

// ── 補填信箱流程 ─────────────────────────────────────────────
const bindToken = new URLSearchParams(location.search).get('token')

if (!bindToken) showPanel('panel-invalid')

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function showMsg(text, isError = true) {
  const box = document.getElementById('msg-box')
  box.textContent = text
  box.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success')
  box.style.display = 'block'
}

async function handleSubmit(e) {
  e.preventDefault()
  const btn   = document.getElementById('submit-btn')
  const email = document.getElementById('email-input').value.trim()

  btn.disabled    = true
  btn.textContent = T('loading')

  try {
    const res  = await fetch('/api/auth/oauth/bind-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: bindToken, email }),
    })
    const data = await res.json()

    if (!res.ok) {
      if (res.status === 401 || res.status === 410) {
        showPanel('panel-invalid')
        return
      }
      showMsg(data.error ?? T('err_default'))
      return
    }

    try { sessionStorage.setItem('access_token', data.access_token) } catch (_) {}
    location.replace('/dashboard.html')

  } catch {
    showMsg(T('err_network'))
  } finally {
    btn.disabled    = false
    btn.textContent = T('btn_submit')
  }
}

// ── Phase C-3 listener wiring ──
document.getElementById('panel-form')?.addEventListener('submit', handleSubmit);
