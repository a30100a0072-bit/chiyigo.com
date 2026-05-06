// admin-deals.js — 成交紀錄頁

// ── i18n ───────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"page_title":"成交紀錄","page_desc":"所有 admin 從接案諮詢「保存」轉檔的成交資料；含付款摘要與客戶當下快照。","page_meta":"// admin panel","nav_requisitions":"接案諮詢","nav_refund_requests":"退款申請","nav_payment_records":"充值紀錄","nav_deals":"成交紀錄","nav_payments":"金流對帳","nav_member":"會員中心","logout":"登出","loading":"// 載入中…","relogin":"→ 重新登入","filter_q_ph":"搜尋客戶名稱/聯絡/公司","filter_user_id_ph":"user_id","filter_apply":"套用","filter_clear":"清除","filter_export":"↓ CSV","totals_count":"成交筆數","totals_sum_total":"總收","totals_sum_refunded":"總退","totals_net":"淨收 (subunit)","col_customer":"客戶","col_contact":"聯絡","col_service":"需求/預算","col_received":"已收","col_refunded":"已退","col_intents":"付款 intents","col_source_req":"原單","col_saved_at":"成交時間","empty_text":"// 沒有符合條件的成交紀錄","agg_title":"📊 報表（成交統計）","agg_period_daily":"日","agg_period_monthly":"月","agg_loading":"載入中…","agg_empty":"無資料","agg_col_bucket_daily":"日期","agg_col_bucket_monthly":"月份","agg_col_count":"成交筆數","agg_col_total":"總收","agg_col_refunded":"已退","agg_col_net":"淨收","pager_prev":"← 上一頁","pager_next":"下一頁 →","deleted_req":"已刪"},"en":{"page_title":"Deals","page_desc":"Closed deals saved by admin from inquiries; includes payment summary and customer snapshot.","page_meta":"// admin panel","nav_requisitions":"Inquiries","nav_refund_requests":"Refund Requests","nav_payment_records":"Payment Records","nav_deals":"Deals","nav_payments":"Reconciliation","nav_member":"Member","logout":"Log out","loading":"// loading…","relogin":"→ Sign in again","filter_q_ph":"Search customer / contact / company","filter_user_id_ph":"user_id","filter_apply":"Apply","filter_clear":"Clear","filter_export":"↓ CSV","totals_count":"Deal count","totals_sum_total":"Total received","totals_sum_refunded":"Total refunded","totals_net":"Net (subunit)","col_customer":"Customer","col_contact":"Contact","col_service":"Service / Budget","col_received":"Received","col_refunded":"Refunded","col_intents":"Payment Intents","col_source_req":"Origin","col_saved_at":"Closed at","empty_text":"// no matching deals","agg_title":"📊 Report (Deals)","agg_period_daily":"Daily","agg_period_monthly":"Monthly","agg_loading":"loading…","agg_empty":"no data","agg_col_bucket_daily":"Date","agg_col_bucket_monthly":"Month","agg_col_count":"Deals","agg_col_total":"Received","agg_col_refunded":"Refunded","agg_col_net":"Net","pager_prev":"← Prev","pager_next":"Next →","deleted_req":"deleted"},"ja":{"page_title":"成約記録","page_desc":"管理者が案件相談から「保存」した成約データ。決済サマリーと顧客スナップショットを含む。","page_meta":"// admin panel","nav_requisitions":"案件相談","nav_refund_requests":"返金申請","nav_payment_records":"入金記録","nav_deals":"成約記録","nav_payments":"決済照合","nav_member":"会員","logout":"ログアウト","loading":"// 読み込み中…","relogin":"→ 再ログイン","filter_q_ph":"顧客名/連絡先/会社で検索","filter_user_id_ph":"user_id","filter_apply":"適用","filter_clear":"クリア","filter_export":"↓ CSV","totals_count":"成約件数","totals_sum_total":"総入金","totals_sum_refunded":"総返金","totals_net":"純額 (subunit)","col_customer":"顧客","col_contact":"連絡先","col_service":"要件/予算","col_received":"入金","col_refunded":"返金","col_intents":"決済 intents","col_source_req":"元案件","col_saved_at":"成約日時","empty_text":"// 該当する成約がありません","agg_title":"📊 レポート（成約統計）","agg_period_daily":"日次","agg_period_monthly":"月次","agg_loading":"読み込み中…","agg_empty":"データなし","agg_col_bucket_daily":"日付","agg_col_bucket_monthly":"月","agg_col_count":"成約件数","agg_col_total":"入金","agg_col_refunded":"返金","agg_col_net":"純額","pager_prev":"← 前へ","pager_next":"次へ →","deleted_req":"削除済"},"ko":{"page_title":"성사 기록","page_desc":"관리자가 프로젝트 상담에서 '저장'한 성사 데이터. 결제 요약과 고객 스냅샷 포함.","page_meta":"// admin panel","nav_requisitions":"프로젝트 상담","nav_refund_requests":"환불 신청","nav_payment_records":"입금 기록","nav_deals":"성사 기록","nav_payments":"결제 대사","nav_member":"회원","logout":"로그아웃","loading":"// 로딩 중…","relogin":"→ 다시 로그인","filter_q_ph":"고객명/연락처/회사 검색","filter_user_id_ph":"user_id","filter_apply":"적용","filter_clear":"초기화","filter_export":"↓ CSV","totals_count":"성사 건수","totals_sum_total":"총 수령","totals_sum_refunded":"총 환불","totals_net":"순액 (subunit)","col_customer":"고객","col_contact":"연락처","col_service":"요청/예산","col_received":"수령","col_refunded":"환불","col_intents":"결제 intents","col_source_req":"원 요청","col_saved_at":"성사 시간","empty_text":"// 일치하는 성사 기록이 없습니다","agg_title":"📊 리포트 (성사 통계)","agg_period_daily":"일별","agg_period_monthly":"월별","agg_loading":"로딩 중…","agg_empty":"데이터 없음","agg_col_bucket_daily":"날짜","agg_col_bucket_monthly":"월","agg_col_count":"성사 건수","agg_col_total":"수령","agg_col_refunded":"환불","agg_col_net":"순액","pager_prev":"← 이전","pager_next":"다음 →","deleted_req":"삭제됨"}};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function T() { return LANGS_I18N[curLang] || LANGS_I18N['zh-TW'] || {}; }
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = T();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
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

function renderTotals(totals) {
  if (!totals) { document.getElementById('totals').innerHTML = ''; return; }
  const tt = T();
  const net = (Number(totals.sum_total_subunit) - Number(totals.sum_refunded_subunit)).toLocaleString();
  document.getElementById('totals').innerHTML = `
    <div class="totals-cell"><span class="lbl">${esc(tt.totals_count || '成交筆數')}</span><span class="val">${totals.count}</span></div>
    <div class="totals-cell"><span class="lbl">${esc(tt.totals_sum_total || '總收')}</span><span class="val accent">${Number(totals.sum_total_subunit).toLocaleString()}</span></div>
    <div class="totals-cell"><span class="lbl">${esc(tt.totals_sum_refunded || '總退')}</span><span class="val">${Number(totals.sum_refunded_subunit).toLocaleString()}</span></div>
    <div class="totals-cell"><span class="lbl">${esc(tt.totals_net || '淨收 (subunit)')}</span><span class="val accent">${net}</span></div>
  `;
}

function intentLinks(ids) {
  if (!ids.length) return '<span class="mono" style="color:#6b7280">—</span>';
  return ids.map(id => `<a class="mono" href="/admin-payment-records.html?intent=${id}" style="color:var(--accent);text-decoration:none;font-size:.72rem;margin-right:.4rem">#${id}</a>`).join('');
}

function reqLink(id) {
  if (!id) return `<span class="mono" style="color:#6b7280">${esc(T().deleted_req || '已刪')}</span>`;
  return `<a class="mono" href="/admin-requisitions.html#req-${id}" style="color:var(--accent);text-decoration:none">#${id}</a>`;
}

function renderTable(rows) {
  const body = document.getElementById('table-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="empty">${esc(T().empty_text || '// 沒有符合條件的成交紀錄')}</td></tr>`;
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

// ── Aggregate report (P3-1) ───────────────────────────────
let aggPeriod = 'monthly';
async function loadAgg() {
  const wrap = document.getElementById('agg-table-wrap');
  const ld   = document.getElementById('agg-loading');
  if (!wrap) return;
  ld.hidden = false;
  let data;
  try {
    data = await apiFetch(`/api/admin/deals/aggregate?period=${aggPeriod}`);
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return;
    wrap.innerHTML = `<p style="font-size:.78rem;color:var(--text-dim)">${esc(e?.message || '載入失敗')}</p>`;
    ld.hidden = true; return;
  }
  ld.hidden = true;
  const buckets = data?.buckets ?? [];
  const tt = T();
  if (!buckets.length) { wrap.innerHTML = `<p style="font-size:.78rem;color:var(--text-dim)">${esc(tt.agg_empty || '無資料')}</p>`; return; }
  const rows = buckets.map(b => `
    <tr>
      <td>${esc(b.bucket)}</td>
      <td class="num">${b.count.toLocaleString()}</td>
      <td class="num">${b.sum_total_subunit.toLocaleString()}</td>
      <td class="num refund">${b.sum_refunded_subunit.toLocaleString()}</td>
      <td class="num net">${b.net_subunit.toLocaleString()}</td>
    </tr>`).join('');
  wrap.innerHTML = `
    <table class="agg-table">
      <thead><tr>
        <th>${esc(aggPeriod === 'daily' ? (tt.agg_col_bucket_daily || '日期') : (tt.agg_col_bucket_monthly || '月份'))}</th>
        <th class="num">${esc(tt.agg_col_count || '成交筆數')}</th>
        <th class="num">${esc(tt.agg_col_total || '總收')}</th>
        <th class="num">${esc(tt.agg_col_refunded || '已退')}</th>
        <th class="num">${esc(tt.agg_col_net || '淨收')}</th>
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
