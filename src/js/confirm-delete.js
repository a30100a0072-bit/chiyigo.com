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

// ── 刪除帳號流程 ─────────────────────────────────────────────
const token = new URLSearchParams(location.search).get('token') ?? ''

if (!token) showPanel('panel-invalid')

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box')
  if (!text) { box.style.display = 'none'; box.textContent = ''; return }
  box.textContent = text
  box.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success')
  box.style.display = 'block'
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
