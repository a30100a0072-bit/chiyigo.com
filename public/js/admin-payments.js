// ── i18n ───────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"page_title":"金流對帳","page_desc":"payment_intents — 含 ECPay / mock vendor 全部交易","nav_requisitions":"接案諮詢","nav_payments":"金流對帳","nav_member":"會員中心","logout":"登出","loading":"// 載入中…","relogin":"→ 重新登入","err_login_required":"請先登入","err_forbidden":"權限不足（需要 admin:payments）","err_network":"網路錯誤","filter_status_all":"所有狀態","filter_vendor_all":"所有 vendor","filter_user_id_ph":"user_id","filter_from_aria":"起始日期","filter_to_aria":"結束日期","filter_apply":"套用","filter_clear":"清除","totals_total":"符合筆數","totals_succeeded":"已成功","totals_pending":"等待付款","totals_processing":"處理中","totals_failed":"失敗","totals_refunded":"已退款","totals_sum":"成功總金額（最小單位）","col_user":"User ID","col_vendor":"Vendor","col_kind":"類型","col_amount":"金額","col_status":"狀態","col_created":"建立時間","col_actions":"操作","status_pending":"等待付款","status_processing":"處理中","status_succeeded":"已成功","status_failed":"失敗","status_canceled":"已取消","status_refunded":"已退款","kind_deposit":"充值","kind_subscription":"訂閱","kind_withdraw":"提款","kind_refund":"退款","action_refund":"退款","empty_text":"// 無符合的交易","pager_prev":"← 上一頁","pager_next":"下一頁 →","pager_stat":"第 {p} / {t} 頁","modal_detail_title":"交易詳情","detail_id":"編號","detail_user":"User ID","detail_vendor":"Vendor","detail_kind":"類型","detail_status":"狀態","detail_amount":"金額","detail_failure":"失敗原因","detail_created":"建立時間","detail_updated":"更新時間","detail_requisition":"對應接案","detail_payment_info":"繳款資訊","detail_atm_bank":"銀行代號","detail_atm_account":"虛擬帳號","detail_cvs_no":"超商代碼","detail_barcode":"三段條碼","detail_expire":"繳費期限","modal_refund_title":"退款確認","refund_summary":"將對 #{id}（user {user}）退款 {amount}","refund_otp_label":"請輸入 6 位 2FA 驗證碼以執行退款（會記錄至 audit_log）","refund_reason_ph":"退款原因（選填）","refund_cancel":"取消","refund_confirm":"確認退款","refund_step_up":"驗證 2FA…","refund_calling":"呼叫綠界退款 API…","refund_success":"✓ 退款成功","refund_err_otp":"請輸入 6 位數字 2FA","refund_err_no_intent":"找不到交易","refund_err_no_stepup":"step-up token 缺失"},"en":{"page_title":"Payment Reconciliation","page_desc":"payment_intents — all ECPay / mock transactions","nav_requisitions":"Requisitions","nav_payments":"Payments","nav_member":"Account","logout":"Log out","loading":"// loading…","relogin":"→ Re-login","err_login_required":"Please log in","err_forbidden":"Forbidden (admin:payments required)","err_network":"Network error","filter_status_all":"All status","filter_vendor_all":"All vendors","filter_user_id_ph":"user_id","filter_from_aria":"From date","filter_to_aria":"To date","filter_apply":"Apply","filter_clear":"Clear","totals_total":"Matched","totals_succeeded":"Succeeded","totals_pending":"Pending","totals_processing":"Processing","totals_failed":"Failed","totals_refunded":"Refunded","totals_sum":"Sum (succeeded, subunit)","col_user":"User ID","col_vendor":"Vendor","col_kind":"Kind","col_amount":"Amount","col_status":"Status","col_created":"Created","col_actions":"Actions","status_pending":"Pending","status_processing":"Processing","status_succeeded":"Succeeded","status_failed":"Failed","status_canceled":"Canceled","status_refunded":"Refunded","kind_deposit":"Deposit","kind_subscription":"Subscription","kind_withdraw":"Withdraw","kind_refund":"Refund","action_refund":"Refund","empty_text":"// no matching transactions","pager_prev":"← Prev","pager_next":"Next →","pager_stat":"Page {p} / {t}","modal_detail_title":"Transaction details","detail_id":"ID","detail_user":"User ID","detail_vendor":"Vendor","detail_kind":"Kind","detail_status":"Status","detail_amount":"Amount","detail_failure":"Failure","detail_created":"Created","detail_updated":"Updated","detail_requisition":"Requisition","detail_payment_info":"Payment info","detail_atm_bank":"Bank code","detail_atm_account":"Virtual account","detail_cvs_no":"CVS code","detail_barcode":"Barcode","detail_expire":"Expires","modal_refund_title":"Confirm refund","refund_summary":"Refund #{id} (user {user}) for {amount}","refund_otp_label":"Enter your 6-digit 2FA code to authorize the refund (will be audited)","refund_reason_ph":"Reason (optional)","refund_cancel":"Cancel","refund_confirm":"Confirm refund","refund_step_up":"Verifying 2FA…","refund_calling":"Calling ECPay refund API…","refund_success":"✓ Refund succeeded","refund_err_otp":"Enter 6-digit 2FA code","refund_err_no_intent":"Transaction not found","refund_err_no_stepup":"step-up token missing"},"ja":{"page_title":"決済照合","page_desc":"payment_intents — ECPay / mock の全取引","nav_requisitions":"案件問い合わせ","nav_payments":"決済照合","nav_member":"会員センター","logout":"ログアウト","loading":"// 読み込み中…","relogin":"→ 再ログイン","err_login_required":"ログインしてください","err_forbidden":"権限不足 (admin:payments 必要)","err_network":"ネットワークエラー","filter_status_all":"全ステータス","filter_vendor_all":"全 vendor","filter_user_id_ph":"user_id","filter_from_aria":"開始日","filter_to_aria":"終了日","filter_apply":"適用","filter_clear":"クリア","totals_total":"件数","totals_succeeded":"成功","totals_pending":"支払い待ち","totals_processing":"処理中","totals_failed":"失敗","totals_refunded":"返金済み","totals_sum":"成功合計（最小単位）","col_user":"User ID","col_vendor":"Vendor","col_kind":"種類","col_amount":"金額","col_status":"ステータス","col_created":"作成日時","col_actions":"操作","status_pending":"支払い待ち","status_processing":"処理中","status_succeeded":"成功","status_failed":"失敗","status_canceled":"キャンセル","status_refunded":"返金済み","kind_deposit":"チャージ","kind_subscription":"サブスク","kind_withdraw":"出金","kind_refund":"返金","action_refund":"返金","empty_text":"// 一致する取引なし","pager_prev":"← 前へ","pager_next":"次へ →","pager_stat":"{p} / {t} ページ","modal_detail_title":"取引詳細","detail_id":"ID","detail_user":"User ID","detail_vendor":"Vendor","detail_kind":"種類","detail_status":"ステータス","detail_amount":"金額","detail_failure":"失敗理由","detail_created":"作成","detail_updated":"更新","detail_requisition":"対応案件","detail_payment_info":"支払情報","detail_atm_bank":"銀行コード","detail_atm_account":"仮想口座","detail_cvs_no":"コンビニコード","detail_barcode":"バーコード","detail_expire":"支払期限","modal_refund_title":"返金確認","refund_summary":"#{id} (user {user}) を {amount} 返金します","refund_otp_label":"返金実行に 2FA 6 桁コードを入力（audit_log に記録）","refund_reason_ph":"理由（任意）","refund_cancel":"キャンセル","refund_confirm":"返金実行","refund_step_up":"2FA 検証中…","refund_calling":"ECPay 返金 API 呼び出し中…","refund_success":"✓ 返金成功","refund_err_otp":"6 桁の 2FA を入力","refund_err_no_intent":"取引が見つかりません","refund_err_no_stepup":"step-up token が不足"},"ko":{"page_title":"결제 대사","page_desc":"payment_intents — ECPay / mock 모든 거래","nav_requisitions":"의뢰 문의","nav_payments":"결제 대사","nav_member":"회원 센터","logout":"로그아웃","loading":"// 불러오는 중…","relogin":"→ 다시 로그인","err_login_required":"로그인이 필요합니다","err_forbidden":"권한 부족 (admin:payments 필요)","err_network":"네트워크 오류","filter_status_all":"전체 상태","filter_vendor_all":"전체 vendor","filter_user_id_ph":"user_id","filter_from_aria":"시작일","filter_to_aria":"종료일","filter_apply":"적용","filter_clear":"초기화","totals_total":"건수","totals_succeeded":"성공","totals_pending":"결제 대기","totals_processing":"처리 중","totals_failed":"실패","totals_refunded":"환불됨","totals_sum":"성공 합계（최소 단위）","col_user":"User ID","col_vendor":"Vendor","col_kind":"종류","col_amount":"금액","col_status":"상태","col_created":"생성 시간","col_actions":"작업","status_pending":"결제 대기","status_processing":"처리 중","status_succeeded":"성공","status_failed":"실패","status_canceled":"취소됨","status_refunded":"환불됨","kind_deposit":"충전","kind_subscription":"구독","kind_withdraw":"출금","kind_refund":"환불","action_refund":"환불","empty_text":"// 일치하는 거래 없음","pager_prev":"← 이전","pager_next":"다음 →","pager_stat":"{p} / {t} 페이지","modal_detail_title":"거래 상세","detail_id":"ID","detail_user":"User ID","detail_vendor":"Vendor","detail_kind":"종류","detail_status":"상태","detail_amount":"금액","detail_failure":"실패 사유","detail_created":"생성","detail_updated":"갱신","detail_requisition":"대응 의뢰","detail_payment_info":"결제 정보","detail_atm_bank":"은행 코드","detail_atm_account":"가상 계좌","detail_cvs_no":"편의점 코드","detail_barcode":"바코드","detail_expire":"납부 기한","modal_refund_title":"환불 확인","refund_summary":"#{id} (user {user}) {amount} 환불","refund_otp_label":"환불 실행을 위해 2FA 6자리 코드 입력 (audit_log 기록됨)","refund_reason_ph":"사유 (선택)","refund_cancel":"취소","refund_confirm":"환불 실행","refund_step_up":"2FA 검증 중…","refund_calling":"ECPay 환불 API 호출 중…","refund_success":"✓ 환불 성공","refund_err_otp":"6자리 2FA 입력","refund_err_no_intent":"거래를 찾을 수 없습니다","refund_err_no_stepup":"step-up token 누락"}};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function T() { return LANGS_I18N[curLang] || LANGS_I18N['zh-TW']; }
function fmt(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }

function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = T();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { const k = el.dataset.i18nAria; if (typeof t[k] === 'string') el.setAttribute('aria-label', t[k]); });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  if (window._lastData) renderAll(window._lastData);
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => langDrop?.classList.remove('open'));
langDrop?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDrop.classList.remove('open'); });
applyLangI(curLang);

// ── theme ──────────────────────────────────────────────
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

// ── auth / fetch helpers ───────────────────────────────
const ACCESS_TOKEN_KEY = 'access_token';
function getToken() { return sessionStorage.getItem(ACCESS_TOKEN_KEY); }

async function logout() {
  const tok = getToken();
  if (tok) await fetch('/api/auth/logout', { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${tok}` } }).catch(() => {});
  sessionStorage.clear();
  location.href = '/login.html';
}
document.getElementById('logout-btn').addEventListener('click', logout);

function showError(msg) {
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = false;
  document.getElementById('error-text').textContent = `// error: ${msg}`;
}

// ── State + filters ────────────────────────────────────
let currentPage = 1;
const filters = { status:'', vendor:'', user_id:'', from:'', to:'' };

document.getElementById('f-apply').addEventListener('click', () => {
  filters.status  = document.getElementById('f-status').value;
  filters.vendor  = document.getElementById('f-vendor').value;
  filters.user_id = document.getElementById('f-user-id').value.trim();
  filters.from    = document.getElementById('f-from').value;
  filters.to      = document.getElementById('f-to').value;
  currentPage = 1;
  load();
});
document.getElementById('f-clear').addEventListener('click', () => {
  ['f-status','f-vendor','f-user-id','f-from','f-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el.tagName === 'SELECT') el.value = '';
    else el.value = '';
  });
  for (const k of Object.keys(filters)) filters[k] = '';
  currentPage = 1;
  load();
});

// ── Format helpers ─────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const localeMap = { 'zh-TW':'zh-TW', en:'en-US', ja:'ja-JP', ko:'ko-KR' };
  return d.toLocaleString(localeMap[curLang] || 'zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function formatAmount(row) {
  if (row.amount_subunit != null) return `${Number(row.amount_subunit).toLocaleString()} ${esc(row.currency || 'TWD')}`;
  if (row.amount_raw)             return `${esc(row.amount_raw)} ${esc(row.currency || '')}`;
  return '—';
}
function parseMeta(row) {
  if (!row.metadata) return null;
  if (typeof row.metadata === 'object') return row.metadata;
  try { return JSON.parse(row.metadata); } catch { return null; }
}

// ── Load + render ──────────────────────────────────────
async function load() {
  const tok = getToken();
  const t   = T();
  if (!tok) { showError(t.err_login_required); return; }

  document.getElementById('loading').hidden = false;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = true;

  const qs = new URLSearchParams({ page: String(currentPage), limit: '50' });
  for (const [k, v] of Object.entries(filters)) { if (v) qs.set(k, v); }

  let data;
  try {
    data = await apiFetch(`/api/admin/payments/intents?${qs.toString()}`);
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return; // apiFetch 已 redirect
    if (e?.status === 403) return showError(t.err_forbidden);
    return showError(window.formatApiError ? formatApiError(e, t.err_network) : (e?.message || t.err_network));
  }
  window._lastData = data;
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = false;
  renderAll(data);
}

function renderAll(data) {
  renderTotals(data.totals, data.total);
  renderTable(data.rows);
  renderCards(data.rows);
  renderPagination(data.total, data.page, data.limit);
}

function renderTotals(totals, total) {
  const t = T();
  const sumLabel = (totals?.sum_subunit_succeeded ?? 0).toLocaleString();
  const counts = totals?.count_by_status ?? {};
  const cells = [
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_total)}</span><span class="val">${total}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_succeeded)}</span><span class="val accent">${counts.succeeded ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_pending)}</span><span class="val">${counts.pending ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_processing)}</span><span class="val">${counts.processing ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_failed)}</span><span class="val">${counts.failed ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_refunded)}</span><span class="val">${counts.refunded ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_sum)}</span><span class="val accent">${sumLabel}</span></div>`,
  ].join('');
  document.getElementById('totals').innerHTML = cells;
}

function renderTable(rows) {
  const t = T();
  const body = document.getElementById('table-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">${esc(t.empty_text)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => {
    const status = String(r.status);
    const kindLabel = t['kind_' + r.kind] || r.kind;
    const isRefundPending = r.refund_request_status === 'pending';
    // user 已申請退款 → admin 不該再點直接退款（要走 /admin-refund-requests 審核）
    const canRefund = status === 'succeeded' && r.vendor === 'ecpay' && !isRefundPending;
    const refundBtn = canRefund
      ? `<button class="pay-action-btn" data-action="open-refund" data-intent-id="${r.id}">${esc(t.action_refund)}</button>`
      : '';
    // refunded = 金流憑證最終態 + 申請退款中也鎖住（必須由審核流程處理）
    const delBtn = (status === 'refunded' || isRefundPending)
      ? ''
      : `<button class="pay-action-btn pay-action-danger" data-action="open-delete" data-intent-id="${r.id}">強制刪除 / Anonymize</button>`;
    // succeeded + 有 pending refund_request → 蓋掉「已成功」pill 顯示「申請退款」
    const refundReqAt = r.refund_request_created_at ? formatDate(r.refund_request_created_at) : '';
    const statusCell = isRefundPending
      ? `<span class="pay-badge refund-pending" title="申請時間：${esc(refundReqAt)}">申請退款</span>`
      : `<span class="pay-badge ${status}">${esc(t['status_' + status] || status)}</span>`;
    return `
      <tr data-action="open-detail" data-intent-id="${r.id}">
        <td class="id">${r.id}</td>
        <td>${esc(r.user_id)}</td>
        <td class="mono">${esc(r.vendor)}</td>
        <td>${esc(kindLabel)}</td>
        <td class="mono">${formatAmount(r)}</td>
        <td>${statusCell}</td>
        <td class="mono">${esc(formatDate(r.created_at))}</td>
        <td>${refundBtn}${delBtn}</td>
      </tr>`;
  }).join('');
}

function renderCards(rows) {
  const t = T();
  const c = document.getElementById('cards-container');
  if (!rows.length) { c.innerHTML = `<div class="empty">${esc(t.empty_text)}</div>`; return; }
  c.innerHTML = rows.map(r => {
    const status = String(r.status);
    const isRefundPending = r.refund_request_status === 'pending';
    const canRefund = status === 'succeeded' && r.vendor === 'ecpay' && !isRefundPending;
    const actions = canRefund
      ? `<button class="pay-action-btn" data-action="open-refund" data-intent-id="${r.id}" style="margin-top:.6rem">${esc(t.action_refund)}</button>`
      : '';
    const statusBadge = isRefundPending
      ? `<span class="pay-badge refund-pending">申請退款</span>`
      : `<span class="pay-badge ${status}">${esc(t['status_' + status] || status)}</span>`;
    return `
      <div class="req-card" data-action="open-detail" data-intent-id="${r.id}">
        <div class="row">
          <div>
            <span class="name">#${r.id} · user ${esc(r.user_id)}</span>
            <span class="company">${esc(r.vendor)}</span>
          </div>
          ${statusBadge}
        </div>
        <div class="row" style="font-family:var(--font-mono);font-size:.78rem">${formatAmount(r)}</div>
        <div class="when">${esc(formatDate(r.created_at))}</div>
        ${actions}
      </div>`;
  }).join('');
}

function renderPagination(total, page, limit) {
  const t = T();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pager = document.getElementById('pagination');
  pager.innerHTML = `
    <button data-action="prev" ${page <= 1 ? 'disabled' : ''}>${esc(t.pager_prev)}</button>
    <span class="stat">${fmt(t.pager_stat, { p: page, t: totalPages })}</span>
    <button data-action="next" ${page >= totalPages ? 'disabled' : ''}>${esc(t.pager_next)}</button>`;
}

document.getElementById('pagination').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'prev') currentPage--;
  if (btn.dataset.action === 'next') currentPage++;
  load();
});

// ── Modal helpers ──────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  const closer = e.target.closest('[data-modal-close]');
  if (closer) closeModal(closer.dataset.modalClose);
  // 點 backdrop 關閉
  document.querySelectorAll('.modal-bd.open').forEach(m => {
    if (e.target === m) m.classList.remove('open');
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-bd.open').forEach(m => m.classList.remove('open'));
});

// ── Detail / refund table click delegation ────────────
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action][data-intent-id]');
  if (!t) return;
  const id = Number(t.dataset.intentId);
  if (t.dataset.action === 'open-detail') {
    // 不要在 refund/delete button 上 trigger detail
    if (e.target.closest('.pay-action-btn')) return;
    openDetail(id);
  } else if (t.dataset.action === 'open-refund') {
    e.stopPropagation();
    openRefund(id);
  } else if (t.dataset.action === 'open-delete') {
    e.stopPropagation();
    openAdminDelete(id);
  }
});

function openDetail(id) {
  const row = window._lastData?.rows?.find(r => r.id === id);
  if (!row) return;
  const t = T();
  const meta = parseMeta(row);
  let metaHtml = '';
  const requisitionId = row.requisition_id ?? meta?.requisition_id;
  if (requisitionId) {
    metaHtml += `<div class="modal-row"><span class="lbl">${esc(t.detail_requisition)}</span><span class="val mono">#${esc(requisitionId)}</span></div>`;
  }
  if (meta?.payment_info) {
    const info = meta.payment_info;
    let lines = '';
    if (info.method === 'atm') {
      lines = `<div class="info-line"><span class="k">${esc(t.detail_atm_bank)}</span><span class="v">${esc(info.bank_code)}</span></div>`
            + `<div class="info-line"><span class="k">${esc(t.detail_atm_account)}</span><span class="v">${esc(info.v_account)}</span></div>`;
    } else if (info.method === 'cvs') {
      lines = `<div class="info-line"><span class="k">${esc(t.detail_cvs_no)}</span><span class="v">${esc(info.payment_no)}</span></div>`;
    } else if (info.method === 'barcode') {
      lines = `<div class="info-line"><span class="k">${esc(t.detail_barcode)}</span><span class="v">${esc(info.barcode_1)}<br>${esc(info.barcode_2)}<br>${esc(info.barcode_3)}</span></div>`;
    }
    if (info.expire_date) lines += `<div class="info-line"><span class="k">${esc(t.detail_expire)}</span><span class="v">${esc(info.expire_date)}</span></div>`;
    if (lines) metaHtml += `<div class="modal-row"><span class="lbl">${esc(t.detail_payment_info)}</span><div class="val"><div class="modal-info-block">${lines}</div></div></div>`;
  }
  document.getElementById('modal-detail-body').innerHTML = `
    <div class="modal-row"><span class="lbl">${esc(t.detail_id)}</span><span class="val mono">#${row.id}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_user)}</span><span class="val mono">${esc(row.user_id)}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_vendor)}</span><span class="val mono">${esc(row.vendor)} / ${esc(row.vendor_intent_id)}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_kind)}</span><span class="val">${esc(t['kind_' + row.kind] || row.kind)}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_status)}</span><span class="val"><span class="pay-badge ${row.status}">${esc(t['status_' + row.status] || row.status)}</span></span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_amount)}</span><span class="val mono">${formatAmount(row)}</span></div>
    ${row.failure_reason ? `<div class="modal-row"><span class="lbl">${esc(t.detail_failure)}</span><span class="val">${esc(row.failure_reason)}</span></div>` : ''}
    <div class="modal-row"><span class="lbl">${esc(t.detail_created)}</span><span class="val mono">${esc(formatDate(row.created_at))}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_updated)}</span><span class="val mono">${esc(formatDate(row.updated_at))}</span></div>
    ${metaHtml}`;
  openModal('modal-detail');
}

// ── Refund flow ────────────────────────────────────────
let refundIntentId = null;

function openRefund(id) {
  const row = window._lastData?.rows?.find(r => r.id === id);
  if (!row) return;
  const t = T();
  refundIntentId = id;
  document.getElementById('refund-summary').textContent =
    fmt(t.refund_summary, { id: row.id, amount: formatAmount(row), user: row.user_id });
  document.getElementById('refund-otp').value = '';
  document.getElementById('refund-reason').value = '';
  setRefundMsg('', '');
  openModal('modal-refund');
  setTimeout(() => document.getElementById('refund-otp')?.focus(), 50);
}

function setRefundMsg(text, type) {
  const el = document.getElementById('refund-msg');
  el.textContent = text || '';
  el.className = 'refund-msg' + (type ? ' ' + type : '');
}

document.getElementById('refund-confirm-btn').addEventListener('click', async () => {
  const t = T();
  const otp = document.getElementById('refund-otp').value.trim();
  const reason = document.getElementById('refund-reason').value.trim();
  if (!/^\d{6}$/.test(otp)) { setRefundMsg(t.refund_err_otp, 'err'); return; }
  if (!refundIntentId) { setRefundMsg(t.refund_err_no_intent, 'err'); return; }

  const btn = document.getElementById('refund-confirm-btn');
  btn.disabled = true;
  setRefundMsg(t.refund_step_up, '');

  // 1) step-up（apiFetch 自帶 401 silent refresh）
  let step_up_token;
  try {
    const su = await apiFetch('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope:'elevated:payment', for_action:'refund_payment', otp_code: otp }),
    });
    step_up_token = su?.step_up_token;
    if (!step_up_token) { setRefundMsg(t.refund_err_no_stepup, 'err'); btn.disabled = false; return; }
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return;
    setRefundMsg(e?.message || `step-up ${e?.status ?? ''}`, 'err');
    btn.disabled = false; return;
  }

  // 2) refund
  setRefundMsg(t.refund_calling, '');
  const r = await fetch(`/api/admin/payments/intents/${refundIntentId}/refund`, {
    method:  'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${step_up_token}` },
    body:    JSON.stringify({ reason }),
  }).catch(() => null);
  if (!r) { setRefundMsg(t.err_network, 'err'); btn.disabled = false; return; }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    setRefundMsg(j.rtn_msg || j.error || `refund ${r.status}`, 'err');
    btn.disabled = false; return;
  }
  setRefundMsg(t.refund_success, 'ok');
  setTimeout(() => { closeModal('modal-refund'); load(); btn.disabled = false; }, 1200);
});

// ── Admin force-delete flow（兩段式確認 + step-up OTP）──
// step-up 等同 refund 的 elevated:payment scope（避免另開 scope）
function openAdminDelete(id) {
  const row = window._lastData?.rows?.find(r => r.id === id);
  if (!row) return;
  document.getElementById('admin-del-modal')?.remove();
  const isHard = ['pending','failed','canceled'].includes(row.status);
  const modeText = isHard
    ? '此操作會永久從 D1 刪除此筆 intent。'
    : `此 intent 為 <b>${esc(row.status)}</b>，將執行 <b>anonymize</b>（保留金流憑證骨幹，清空 metadata 與 failure_reason）。row 不會被刪除。`;
  const m = document.createElement('div');
  m.id = 'admin-del-modal';
  m.className = 'modal-bd open';
  m.innerHTML = `
    <div class="modal-card" style="max-width:440px">
      <div class="modal-head">
        <h2>${isHard ? '強制刪除' : 'Anonymize'} #${row.id}</h2>
        <button class="modal-close" data-action="admin-del-cancel" aria-label="close">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body refund-modal-body">
        <p class="msg-block">user ${esc(row.user_id)} · ${esc(row.vendor)} · ${formatAmount(row)} · <b>${esc(row.status)}</b></p>
        <p class="msg-label" style="color:#dc2626">${modeText} audit log 會留 critical 記錄。</p>
        <input id="admin-del-otp" type="text" inputmode="numeric" maxlength="6" placeholder="6 位 2FA OTP" autocomplete="one-time-code">
        <p id="admin-del-msg" class="refund-msg"></p>
        <div class="refund-actions">
          <button class="cancel" data-action="admin-del-cancel">取消</button>
          <button id="admin-del-go" class="confirm" data-armed="0" data-id="${row.id}">${isHard ? '強制刪除' : '執行 Anonymize'}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
  setTimeout(() => document.getElementById('admin-del-otp')?.focus(), 50);
  m.addEventListener('click', e => { if (e.target === m) closeAdminDelete(); });
}
function closeAdminDelete() { document.getElementById('admin-del-modal')?.remove(); }
function setAdminDelMsg(text, type) {
  const el = document.getElementById('admin-del-msg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('err', 'ok');
  if (type === 'err') el.classList.add('err');
  else if (type === 'ok') el.classList.add('ok');
}
let _adminDelArmTimer = null;
async function adminDelGo() {
  const btn = document.getElementById('admin-del-go');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    const orig = btn.textContent;
    btn.dataset.origText = orig;
    btn.textContent = '再點一次確認';
    btn.classList.add('armed');
    if (_adminDelArmTimer) clearTimeout(_adminDelArmTimer);
    _adminDelArmTimer = setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.origText || '強制刪除';
      btn.classList.remove('armed');
    }, 4000);
    return;
  }
  if (_adminDelArmTimer) { clearTimeout(_adminDelArmTimer); _adminDelArmTimer = null; }
  const otp = document.getElementById('admin-del-otp')?.value.trim() ?? '';
  if (!/^\d{6}$/.test(otp)) { setAdminDelMsg('請輸入 6 位數字 2FA', 'err'); return; }
  btn.disabled = true; setAdminDelMsg('驗證 2FA…', '');

  // step-up 走 apiFetch 自帶 401 → silent refresh → retry
  let stepUpToken;
  try {
    const su = await apiFetch('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope:'elevated:payment', for_action:'delete_payment', otp_code: otp }),
    });
    stepUpToken = su?.step_up_token;
    if (!stepUpToken) throw new Error('missing step_up_token');
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return; // apiFetch 已 redirect
    setAdminDelMsg(e?.message || 'step-up 失敗', 'err');
    btn.disabled = false; return;
  }

  setAdminDelMsg('呼叫刪除…', '');
  // 強制刪除走 step-up token，不能讓 apiFetch 用 access_token 蓋過去 → 手動帶 Authorization
  const r = await fetch(`/api/admin/payments/intents/${id}/delete`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${stepUpToken}` },
  }).catch(() => null);
  if (!r || !r.ok) {
    const j = r ? await r.json().catch(() => ({})) : {};
    setAdminDelMsg(j.error || `delete ${r?.status ?? 'network'}`, 'err');
    btn.disabled = false; return;
  }
  const j = await r.json().catch(() => ({}));
  setAdminDelMsg(j.mode === 'anonymize' ? '✓ 已 anonymize' : '✓ 已刪除', 'ok');
  setTimeout(() => { closeAdminDelete(); load(); }, 800);
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]')?.dataset?.action;
  if (a === 'admin-del-cancel') return closeAdminDelete();
  if (e.target.id === 'admin-del-go') return adminDelGo();
});

// ── Init ───────────────────────────────────────────────
load();
