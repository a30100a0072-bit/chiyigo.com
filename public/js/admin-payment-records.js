// admin-payment-records.js — read-only 充值紀錄頁
// 走既有 /api/admin/payments/intents 但鎖 status=succeeded；無 delete/refund UI

// ── i18n ───────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"page_title":"充值紀錄","page_desc":"永久保留的成功充值憑證；本頁僅供查閱與匯出，無編輯動作。","page_meta":"// admin panel · read-only","nav_requisitions":"接案諮詢","nav_refund_requests":"退款申請","nav_payment_records":"充值紀錄","nav_deals":"成交紀錄","nav_payments":"金流對帳","nav_member":"會員中心","logout":"登出","loading":"// 載入中…","relogin":"→ 重新登入","filter_vendor_all":"所有 vendor","filter_user_id_ph":"user_id","filter_apply":"套用","filter_clear":"清除","filter_export":"↓ CSV","filter_export_title":"匯出當前篩選的所有頁","totals_count_succeeded":"本頁查到 (succeeded)","totals_sum_subunit":"合計金額 (TWD subunit)","col_user":"使用者","col_vendor":"Vendor","col_vendor_intent_id":"Vendor 流水號","col_amount":"金額","col_requisition":"關聯需求單","col_created":"建立時間","empty_text":"// 沒有符合條件的紀錄","agg_title":"📊 報表（充值統計）","agg_period_daily":"日","agg_period_monthly":"月","agg_loading":"載入中…","agg_empty":"無資料","agg_col_bucket_daily":"日期","agg_col_bucket_monthly":"月份","agg_col_count":"充值筆數","agg_col_sum":"充值金額","agg_col_refund_count":"退款筆數","agg_col_refund_sum":"退款金額","agg_col_net":"淨額","pager_prev":"← 上一頁","pager_next":"下一頁 →"},"en":{"page_title":"Payment Records","page_desc":"Permanent record of successful top-ups. Read-only — no edits possible.","page_meta":"// admin panel · read-only","nav_requisitions":"Inquiries","nav_refund_requests":"Refund Requests","nav_payment_records":"Payment Records","nav_deals":"Deals","nav_payments":"Reconciliation","nav_member":"Member","logout":"Log out","loading":"// loading…","relogin":"→ Sign in again","filter_vendor_all":"All vendors","filter_user_id_ph":"user_id","filter_apply":"Apply","filter_clear":"Clear","filter_export":"↓ CSV","filter_export_title":"Export all matching rows","totals_count_succeeded":"Found (succeeded)","totals_sum_subunit":"Total amount (TWD subunit)","col_user":"User","col_vendor":"Vendor","col_vendor_intent_id":"Vendor Intent ID","col_amount":"Amount","col_requisition":"Linked Inquiry","col_created":"Created","empty_text":"// no matching records","agg_title":"📊 Report (Top-ups)","agg_period_daily":"Daily","agg_period_monthly":"Monthly","agg_loading":"loading…","agg_empty":"no data","agg_col_bucket_daily":"Date","agg_col_bucket_monthly":"Month","agg_col_count":"Count","agg_col_sum":"Amount","agg_col_refund_count":"Refund Count","agg_col_refund_sum":"Refund Amount","agg_col_net":"Net","pager_prev":"← Prev","pager_next":"Next →"},"ja":{"page_title":"入金記録","page_desc":"成功した入金の永久記録。閲覧と書き出しのみ、編集不可。","page_meta":"// admin panel · read-only","nav_requisitions":"案件相談","nav_refund_requests":"返金申請","nav_payment_records":"入金記録","nav_deals":"成約記録","nav_payments":"決済照合","nav_member":"会員","logout":"ログアウト","loading":"// 読み込み中…","relogin":"→ 再ログイン","filter_vendor_all":"すべての vendor","filter_user_id_ph":"user_id","filter_apply":"適用","filter_clear":"クリア","filter_export":"↓ CSV","filter_export_title":"現在の条件で全件書き出し","totals_count_succeeded":"件数 (succeeded)","totals_sum_subunit":"合計金額 (TWD subunit)","col_user":"ユーザー","col_vendor":"Vendor","col_vendor_intent_id":"Vendor 番号","col_amount":"金額","col_requisition":"関連案件","col_created":"作成日時","empty_text":"// 条件に合うデータがありません","agg_title":"📊 レポート（入金統計）","agg_period_daily":"日次","agg_period_monthly":"月次","agg_loading":"読み込み中…","agg_empty":"データなし","agg_col_bucket_daily":"日付","agg_col_bucket_monthly":"月","agg_col_count":"入金件数","agg_col_sum":"入金額","agg_col_refund_count":"返金件数","agg_col_refund_sum":"返金額","agg_col_net":"純額","pager_prev":"← 前へ","pager_next":"次へ →"},"ko":{"page_title":"입금 기록","page_desc":"성공한 입금의 영구 기록. 조회와 내보내기만 가능, 편집 불가.","page_meta":"// admin panel · read-only","nav_requisitions":"프로젝트 상담","nav_refund_requests":"환불 신청","nav_payment_records":"입금 기록","nav_deals":"성사 기록","nav_payments":"결제 대사","nav_member":"회원","logout":"로그아웃","loading":"// 로딩 중…","relogin":"→ 다시 로그인","filter_vendor_all":"모든 vendor","filter_user_id_ph":"user_id","filter_apply":"적용","filter_clear":"초기화","filter_export":"↓ CSV","filter_export_title":"현재 조건으로 전체 내보내기","totals_count_succeeded":"건수 (succeeded)","totals_sum_subunit":"합계 금액 (TWD subunit)","col_user":"사용자","col_vendor":"Vendor","col_vendor_intent_id":"Vendor 번호","col_amount":"금액","col_requisition":"관련 요청","col_created":"생성일시","empty_text":"// 일치하는 기록이 없습니다","agg_title":"📊 리포트 (입금 통계)","agg_period_daily":"일별","agg_period_monthly":"월별","agg_loading":"로딩 중…","agg_empty":"데이터 없음","agg_col_bucket_daily":"날짜","agg_col_bucket_monthly":"월","agg_col_count":"입금 건수","agg_col_sum":"입금액","agg_col_refund_count":"환불 건수","agg_col_refund_sum":"환불액","agg_col_net":"순액","pager_prev":"← 이전","pager_next":"다음 →"}};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function T() { return LANGS_I18N[curLang] || LANGS_I18N['zh-TW'] || {}; }
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = T();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { const k = el.dataset.i18nTitle; if (typeof t[k] === 'string') el.title = t[k]; });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  // 重新 render 表格 + agg（含動態文字）
  if (typeof renderAll === 'function' && window._lastData) renderAll(window._lastData);
  if (typeof loadAgg === 'function') loadAgg();
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => langDrop?.classList.remove('open'));
langDrop?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDrop.classList.remove('open'); });
applyLangI(curLang);

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
  const t = T();
  const sumLabel = (totals?.sum_subunit_succeeded ?? 0).toLocaleString();
  document.getElementById('totals').innerHTML = `
    <div class="totals-cell"><span class="lbl">${esc(t.totals_count_succeeded || '本頁查到 (succeeded)')}</span><span class="val">${total}</span></div>
    <div class="totals-cell"><span class="lbl">${esc(t.totals_sum_subunit || '合計金額 (TWD subunit)')}</span><span class="val accent">${sumLabel}</span></div>
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
    body.innerHTML = `<tr><td colspan="7" class="empty">${esc(T().empty_text || '// 沒有符合條件的紀錄')}</td></tr>`;
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
  const t = T();
  pag.innerHTML = `
    <button ${page<=1?'disabled':''} data-act="prev">${esc(t.pager_prev || '← 上一頁')}</button>
    <span class="page-info">${page} / ${totalPages}</span>
    <button ${page>=totalPages?'disabled':''} data-act="next">${esc(t.pager_next || '下一頁 →')}</button>
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
  const t = T();
  if (!buckets.length) { wrap.innerHTML = `<p style="font-size:.78rem;color:var(--text-dim)">${esc(t.agg_empty || '無資料')}</p>`; return; }
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
        <th>${esc(aggPeriod === 'daily' ? (t.agg_col_bucket_daily || '日期') : (t.agg_col_bucket_monthly || '月份'))}</th>
        <th class="num">${esc(t.agg_col_count || '充值筆數')}</th>
        <th class="num">${esc(t.agg_col_sum || '充值金額')}</th>
        <th class="num">${esc(t.agg_col_refund_count || '退款筆數')}</th>
        <th class="num">${esc(t.agg_col_refund_sum || '退款金額')}</th>
        <th class="num">${esc(t.agg_col_net || '淨額')}</th>
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
