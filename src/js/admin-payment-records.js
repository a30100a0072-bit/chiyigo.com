// admin-payment-records.js — read-only 充值紀錄頁
// 走既有 /api/admin/payments/intents 但鎖 status=succeeded；無 delete/refund UI

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
function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function formatAmount(row) {
  if (row.amount_subunit != null) return `${Number(row.amount_subunit).toLocaleString()} ${esc(row.currency || 'TWD')}`;
  if (row.amount_raw)             return `${esc(row.amount_raw)} ${esc(row.currency || '')}`;
  return '—';
}

let currentPage = 1;
const filters = { user_id:'', vendor:'', from:'', to:'' };

document.getElementById('f-apply').addEventListener('click', () => {
  filters.user_id = document.getElementById('f-user-id').value.trim();
  filters.vendor  = document.getElementById('f-vendor').value;
  filters.from    = document.getElementById('f-from').value;
  filters.to      = document.getElementById('f-to').value;
  currentPage = 1;
  load();
});
document.getElementById('f-clear').addEventListener('click', () => {
  ['f-user-id','f-vendor','f-from','f-to'].forEach(id => { document.getElementById(id).value = ''; });
  for (const k of Object.keys(filters)) filters[k] = '';
  currentPage = 1;
  load();
});
document.getElementById('f-export').addEventListener('click', exportCsv);

function showError(msg) {
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = false;
  document.getElementById('error-text').textContent = `// error: ${msg}`;
}

function buildQs(page, limit) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit), status: 'succeeded' });
  for (const [k, v] of Object.entries(filters)) { if (v) qs.set(k, v); }
  return qs;
}

async function load() {
  document.getElementById('loading').hidden = false;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = true;
  let data;
  try {
    data = await apiFetch(`/api/admin/payments/intents?${buildQs(currentPage, 50)}`);
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
  renderTotals(data.total, data.totals);
  renderTable(data.rows);
  renderCards(data.rows);
  renderPagination(data.total, data.page, data.limit);
}

function renderTotals(total, totals) {
  const sumLabel = (totals?.sum_subunit_succeeded ?? 0).toLocaleString();
  document.getElementById('totals').innerHTML = `
    <div class="totals-cell"><span class="lbl">本頁查到 (succeeded)</span><span class="val">${total}</span></div>
    <div class="totals-cell"><span class="lbl">合計金額 (TWD subunit)</span><span class="val accent">${sumLabel}</span></div>
  `;
}

function reqCell(r) {
  if (r.requisition_id) {
    return `<a class="mono" href="/admin-requisitions.html#req-${r.requisition_id}" style="color:var(--accent);text-decoration:none">#${r.requisition_id}</a>`;
  }
  return '<span class="mono" style="color:#6b7280">—</span>';
}

function renderTable(rows) {
  const body = document.getElementById('table-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">// 沒有符合條件的紀錄</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td class="id">${r.id}</td>
      <td>${esc(r.user_id ?? '—')}</td>
      <td class="mono">${esc(r.vendor)}</td>
      <td class="mono">${esc(r.vendor_intent_id)}</td>
      <td class="mono">${formatAmount(r)}</td>
      <td>${reqCell(r)}</td>
      <td class="mono">${esc(formatDate(r.created_at))}</td>
    </tr>
  `).join('');
}

function renderCards(rows) {
  const c = document.getElementById('cards-container');
  if (!rows.length) { c.innerHTML = ''; return; }
  c.innerHTML = rows.map(r => `
    <div class="req-card">
      <div class="card-head">
        <span class="card-id">#${r.id}</span>
        <span class="mono" style="font-size:.75rem;color:#9aa0aa">${esc(r.vendor)}</span>
      </div>
      <div class="card-row"><span class="lbl">User</span><span>${esc(r.user_id ?? '—')}</span></div>
      <div class="card-row"><span class="lbl">流水號</span><span class="mono" style="font-size:.7rem">${esc(r.vendor_intent_id)}</span></div>
      <div class="card-row"><span class="lbl">金額</span><span class="mono">${formatAmount(r)}</span></div>
      <div class="card-row"><span class="lbl">需求單</span><span>${reqCell(r)}</span></div>
      <div class="card-row"><span class="lbl">時間</span><span class="mono" style="font-size:.7rem">${esc(formatDate(r.created_at))}</span></div>
    </div>
  `).join('');
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
    // T9: 後端直接產 CSV，避免前端跑分頁迴圈撞 401 / OOM
    const qs = buildQs(1, 50000);
    qs.set('format', 'csv');
    const tok = sessionStorage.getItem('access_token');
    const r = await fetch(`/api/admin/payments/intents?${qs}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      credentials: 'include',
    });
    if (r.status === 401) {
      // 用 silent refresh 補一次
      const ok = window.silentRefresh ? await window.silentRefresh() : false;
      if (!ok) { location.href = '/login.html'; return; }
      const r2 = await fetch(`/api/admin/payments/intents?${qs}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('access_token')}` },
        credentials: 'include',
      });
      if (!r2.ok) { alert('匯出失敗：' + r2.status); return; }
      return triggerDownload(await r2.blob(), `payment-records-${new Date().toISOString().slice(0,10)}.csv`);
    }
    if (!r.ok) { alert('匯出失敗：' + r.status); return; }
    triggerDownload(await r.blob(), `payment-records-${new Date().toISOString().slice(0,10)}.csv`);
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

// ── Aggregate report (P3-1) ───────────────────────────────
let aggPeriod = 'monthly';
async function loadAgg() {
  const wrap = document.getElementById('agg-table-wrap');
  const ld   = document.getElementById('agg-loading');
  if (!wrap) return;
  ld.hidden = false;
  let data;
  try {
    data = await apiFetch(`/api/admin/payments/aggregate?period=${aggPeriod}&status=succeeded`);
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return;
    wrap.innerHTML = `<p style="font-size:.78rem;color:var(--text-dim)">${esc(e?.message || '載入失敗')}</p>`;
    ld.hidden = true; return;
  }
  ld.hidden = true;
  const buckets = data?.buckets ?? [];
  if (!buckets.length) { wrap.innerHTML = '<p style="font-size:.78rem;color:var(--text-dim)">無資料</p>'; return; }
  const rows = buckets.map(b => `
    <tr>
      <td>${esc(b.bucket)}</td>
      <td class="num">${b.count.toLocaleString()}</td>
      <td class="num">${b.sum_subunit.toLocaleString()}</td>
      <td class="num refund">${b.refunded_count.toLocaleString()}</td>
      <td class="num refund">${b.refunded_sum_subunit.toLocaleString()}</td>
      <td class="num net">${(b.sum_subunit - b.refunded_sum_subunit).toLocaleString()}</td>
    </tr>`).join('');
  wrap.innerHTML = `
    <table class="agg-table">
      <thead><tr>
        <th>${aggPeriod === 'daily' ? '日期' : '月份'}</th>
        <th class="num">充值筆數</th>
        <th class="num">充值金額</th>
        <th class="num">退款筆數</th>
        <th class="num">退款金額</th>
        <th class="num">淨額</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
document.querySelectorAll('.agg-period').forEach(b => {
  b.addEventListener('click', () => {
    aggPeriod = b.dataset.period;
    document.querySelectorAll('.agg-period').forEach(x => x.classList.toggle('active', x === b));
    loadAgg();
  });
});
loadAgg();
