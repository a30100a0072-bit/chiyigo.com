// admin-deals.js — 成交紀錄頁

const ACCESS_TOKEN_KEY = 'access_token';
const getToken = () => sessionStorage.getItem(ACCESS_TOKEN_KEY);

async function logout() {
  const tok = getToken();
  if (tok) await fetch('/api/auth/logout', { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${tok}` } }).catch(() => {});
  sessionStorage.clear();
  location.href = '/login.html';
}
document.getElementById('logout-btn')?.addEventListener('click', logout);

const themeBtn = document.getElementById('theme-toggle-btn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  const sun  = themeBtn?.querySelector('.icon-sun');
  const moon = themeBtn?.querySelector('.icon-moon');
  if (sun)  sun.hidden = dark;
  if (moon) moon.hidden = !dark;
}
applyTheme(localStorage.getItem('theme') !== 'light');
themeBtn?.addEventListener('click', () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function fmtMoney(subunit, currency) {
  if (subunit == null) return '—';
  return `${Number(subunit).toLocaleString()} ${esc(currency || 'TWD')}`;
}
function parseIntentIds(json) {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a : []; } catch { return []; }
}

let currentPage = 1;
const filters = { q:'', user_id:'', from:'', to:'' };

document.getElementById('f-apply').addEventListener('click', () => {
  filters.q       = document.getElementById('f-q').value.trim();
  filters.user_id = document.getElementById('f-user-id').value.trim();
  filters.from    = document.getElementById('f-from').value;
  filters.to      = document.getElementById('f-to').value;
  currentPage = 1; load();
});
document.getElementById('f-clear').addEventListener('click', () => {
  ['f-q','f-user-id','f-from','f-to'].forEach(id => { document.getElementById(id).value = ''; });
  for (const k of Object.keys(filters)) filters[k] = '';
  currentPage = 1; load();
});
document.getElementById('f-export').addEventListener('click', exportCsv);

function showError(msg) {
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = false;
  document.getElementById('error-text').textContent = `// error: ${msg}`;
}
function buildQs(page, limit) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const [k, v] of Object.entries(filters)) { if (v) qs.set(k, v); }
  return qs;
}

async function load() {
  document.getElementById('loading').hidden = false;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = true;
  let data;
  try {
    data = await apiFetch(`/api/admin/deals?${buildQs(currentPage, 50)}`);
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return;
    if (e?.status === 403) return showError('權限不足');
    return showError(e?.message || '網路錯誤');
  }
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = false;
  renderAll(data);
}

function renderAll(data) {
  renderTotals(data.totals);
  renderTable(data.rows);
  renderCards(data.rows);
  renderPagination(data.total, data.page, data.limit);
}

function renderTotals(t) {
  if (!t) { document.getElementById('totals').innerHTML = ''; return; }
  const net = (Number(t.sum_total_subunit) - Number(t.sum_refunded_subunit)).toLocaleString();
  document.getElementById('totals').innerHTML = `
    <div class="totals-cell"><span class="lbl">成交筆數</span><span class="val">${t.count}</span></div>
    <div class="totals-cell"><span class="lbl">總收</span><span class="val accent">${Number(t.sum_total_subunit).toLocaleString()}</span></div>
    <div class="totals-cell"><span class="lbl">總退</span><span class="val">${Number(t.sum_refunded_subunit).toLocaleString()}</span></div>
    <div class="totals-cell"><span class="lbl">淨收 (subunit)</span><span class="val accent">${net}</span></div>
  `;
}

function intentLinks(ids) {
  if (!ids.length) return '<span class="mono" style="color:#6b7280">—</span>';
  return ids.map(id => `<a class="mono" href="/admin-payment-records.html?intent=${id}" style="color:var(--accent);text-decoration:none;font-size:.72rem;margin-right:.4rem">#${id}</a>`).join('');
}

function reqLink(id) {
  if (!id) return '<span class="mono" style="color:#6b7280">已刪</span>';
  return `<a class="mono" href="/admin-requisitions.html#req-${id}" style="color:var(--accent);text-decoration:none">#${id}</a>`;
}

function renderTable(rows) {
  const body = document.getElementById('table-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="empty">// 沒有符合條件的成交紀錄</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => {
    const ids = parseIntentIds(r.payment_intent_ids);
    return `
      <tr>
        <td class="id">${r.id}</td>
        <td>${esc(r.customer_name)}${r.customer_company ? `<br><span style="font-size:.7rem;color:#9aa0aa">${esc(r.customer_company)}</span>` : ''}</td>
        <td class="mono" style="font-size:.78rem">${esc(r.customer_contact)}</td>
        <td>${esc(r.service_type || '—')}${r.budget ? `<br><span style="font-size:.7rem;color:#9aa0aa">${esc(r.budget)}</span>` : ''}</td>
        <td class="mono">${fmtMoney(r.total_amount_subunit, r.currency)}</td>
        <td class="mono" style="color:${r.refunded_amount_subunit > 0 ? '#fdba74' : '#9aa0aa'}">${fmtMoney(r.refunded_amount_subunit, r.currency)}</td>
        <td>${intentLinks(ids)}</td>
        <td>${reqLink(r.source_requisition_id)}</td>
        <td class="mono" style="font-size:.72rem">${esc(fmtDate(r.saved_at))}</td>
      </tr>
    `;
  }).join('');
}

function renderCards(rows) {
  const c = document.getElementById('cards-container');
  if (!rows.length) { c.innerHTML = ''; return; }
  c.innerHTML = rows.map(r => {
    const ids = parseIntentIds(r.payment_intent_ids);
    return `
      <div class="req-card">
        <div class="card-head">
          <span class="card-id">#${r.id}</span>
          <span class="mono" style="font-size:.7rem;color:#9aa0aa">${esc(fmtDate(r.saved_at))}</span>
        </div>
        <div class="card-row"><span class="lbl">客戶</span><span>${esc(r.customer_name)}${r.customer_company?` · ${esc(r.customer_company)}`:''}</span></div>
        <div class="card-row"><span class="lbl">聯絡</span><span class="mono" style="font-size:.72rem">${esc(r.customer_contact)}</span></div>
        <div class="card-row"><span class="lbl">需求</span><span>${esc(r.service_type || '—')}</span></div>
        <div class="card-row"><span class="lbl">已收 / 已退</span><span class="mono">${fmtMoney(r.total_amount_subunit, r.currency)} / ${fmtMoney(r.refunded_amount_subunit, r.currency)}</span></div>
        <div class="card-row"><span class="lbl">Intents</span><span>${intentLinks(ids)}</span></div>
        <div class="card-row"><span class="lbl">原單</span><span>${reqLink(r.source_requisition_id)}</span></div>
      </div>
    `;
  }).join('');
}

function renderPagination(total, page, limit) {
  const pag = document.getElementById('pagination');
  const totalPages = Math.max(1, Math.ceil((total || 0) / limit));
  if (totalPages <= 1) { pag.innerHTML = ''; return; }
  pag.innerHTML = `
    <button ${page<=1?'disabled':''} data-act="prev">← 上一頁</button>
    <span class="page-info">${page} / ${totalPages}</span>
    <button ${page>=totalPages?'disabled':''} data-act="next">下一頁 →</button>
  `;
  pag.querySelector('[data-act=prev]')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; load(); } });
  pag.querySelector('[data-act=next]')?.addEventListener('click', () => { currentPage++; load(); });
}

async function exportCsv() {
  const btn = document.getElementById('f-export');
  btn.disabled = true; const orig = btn.textContent; btn.textContent = '匯出中…';
  try {
    const qs = buildQs(1, 50000);
    qs.set('format', 'csv');
    const tok = sessionStorage.getItem('access_token');
    let r = await fetch(`/api/admin/deals?${qs}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      credentials: 'include',
    });
    if (r.status === 401) {
      const ok = window.silentRefresh ? await window.silentRefresh() : false;
      if (!ok) { location.href = '/login.html'; return; }
      r = await fetch(`/api/admin/deals?${qs}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('access_token')}` },
        credentials: 'include',
      });
    }
    if (!r.ok) { alert('匯出失敗：' + r.status); return; }
    triggerDownload(await r.blob(), `deals-${new Date().toISOString().slice(0,10)}.csv`);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

load();
