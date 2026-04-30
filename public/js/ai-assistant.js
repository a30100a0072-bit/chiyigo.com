// ── block 1/2 ──
// ── 顯示/語系/主題等共用邏輯（與 requisition.html 對齊） ───────────
const TOKEN_KEY = 'access_token';

// ── Mobile overlay ──────────────────────────────────
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu()  { hamBtn?.setAttribute('aria-expanded','true');  hamBtn?.classList.add('is-open');    overlay?.classList.add('is-open');    overlay?.removeAttribute('aria-hidden');  topbar?.classList.add('menu-open');    document.body.style.overflow='hidden'; }
function closeMenu() { hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.style.overflow=''; }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── Theme toggle ──────────────────────────────────
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun  = btn.querySelector('.icon-sun');
    const moon = btn.querySelector('.icon-moon');
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? ''     : 'none';
  });
}
applyTheme(localStorage.getItem('theme') !== 'light');
const doToggle = () => {
  const isDark = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  applyTheme(isDark);
};
themeBtn?.addEventListener('click', doToggle);
mThemeBtn?.addEventListener('click', doToggle);

// ── i18n ──────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","cta_q":"準備好開始專案了嗎？","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","login":"會員登入","status_open":"接案中","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","footer_contact_title":"聯絡我們","ai_back":"返回案例作品","ai_eyebrow":"// AI 需求單助手","ai_h1":"用一句話","ai_h2":"告訴我你想做什麼","ai_sub":"AI 會自動幫你拆解成需求單欄位，省下重複填表時間。","ai_step1":"Step 1 — 描述你的需求","ai_input_ph":"例：我有一個 50 人的補習班，想做一個讓家長線上看孩子點名與成績的系統，希望兩個月內上線，預算大約 15 萬。","ai_input_hint":"// 請以平實中文描述，避免貼入指令格式","ai_btn_analyze":"AI 解析需求","ai_btn_manual":"改用手動填表","ai_step2":"Step 2 — 確認 AI 拆解結果","ai_field_service":"服務類型","ai_field_budget":"預算","ai_field_timeline":"時程","ai_field_summary":"摘要","ai_disclaimer":"// 若有不準確之處請改用手動填表；送出後會以你登入的 Email 為聯絡方式","ai_btn_confirm":"確認送出諮詢","ai_btn_redo":"重新描述","ai_success_title":"收到了，謝謝你","ai_success_body":"我會在 1–2 個工作天內回覆你。若有急件請直接 LINE / Email 聯絡我。","ai_btn_back_portfolio":"返回案例作品","err_too_long":"輸入超過 500 字上限","err_blocked":"輸入內容包含不允許的指令樣式","err_rate_limit":"今日 AI 助手呼叫次數已達上限，請稍後再試","err_ai":"AI 服務暫時不可用，請稍後再試","err_network":"網路錯誤，請稍後再試","err_auth":"登入已過期，請重新登入","err_submit":"送出失敗，請稍後再試或改用手動填表","sv_system":"系統開發 / 內部工具","sv_web":"網站建置 / Landing Page","sv_game":"遊戲開發 / Unity・Web Game","sv_integration":"第三方串接 / 自動化流程","sv_interactive":"互動體驗 / 品牌活動","sv_branding":"品牌識別 / 視覺設計","sv_marketing":"數位行銷 / SEO","sv_other":"其他 / 不確定","bg_under30k":"30,000 以下","bg_30k_80k":"30,000 – 80,000","bg_80k_200k":"80,000 – 200,000","bg_200k_1m":"200,000 – 1,000,000","bg_flexible":"預算彈性","tl_asap":"越快越好（1 個月內）","tl_1_3m":"1–3 個月","tl_3_6m":"3–6 個月","tl_flexible":"時程彈性","member_center":"會員中心","logout":"登出"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","cta_q":"Ready to Start a Project?","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","login":"Member Login","status_open":"Open for Work","tooltip_theme":"Toggle Theme","tooltip_lang":"Switch Language","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","footer_contact_title":"Contact Us","ai_back":"Back to Portfolio","ai_eyebrow":"// AI Requirement Assistant","ai_h1":"Just describe","ai_h2":"what you want to build","ai_sub":"AI will auto-extract the requisition fields so you skip the form filling.","ai_step1":"Step 1 — Describe Your Needs","ai_input_ph":"e.g. I run a 50-student tutoring center and want a system where parents can check attendance and grades online. Need it live in 2 months, budget around NT$150k.","ai_input_hint":"// Plain language works best — avoid pasting prompt-style instructions","ai_btn_analyze":"Analyze with AI","ai_btn_manual":"Switch to manual form","ai_step2":"Step 2 — Review AI Output","ai_field_service":"Service Type","ai_field_budget":"Budget","ai_field_timeline":"Timeline","ai_field_summary":"Summary","ai_disclaimer":"// Inaccurate? Switch to manual. We will use your login email as the contact.","ai_btn_confirm":"Confirm & Submit","ai_btn_redo":"Re-describe","ai_success_title":"Got it — thank you!","ai_success_body":"I'll reply within 1–2 business days. For urgent matters, contact me via LINE / Email.","ai_btn_back_portfolio":"Back to Portfolio","err_too_long":"Input exceeds 500 characters","err_blocked":"Input contains disallowed instruction patterns","err_rate_limit":"Today's AI quota reached, please try again later","err_ai":"AI service temporarily unavailable","err_network":"Network error, please retry","err_auth":"Session expired, please log in again","err_submit":"Submit failed, please retry or use manual form","sv_system":"System Development / Internal Tools","sv_web":"Website / Landing Page","sv_game":"Game Development / Unity・Web Game","sv_integration":"API Integration / Automation","sv_interactive":"Interactive Experience / Brand Events","sv_branding":"Brand Identity / Visual Design","sv_marketing":"Digital Marketing / SEO","sv_other":"Other / Not Sure","bg_under30k":"Under 30,000","bg_30k_80k":"30,000 – 80,000","bg_80k_200k":"80,000 – 200,000","bg_200k_1m":"200,000 – 1,000,000","bg_flexible":"Flexible","tl_asap":"ASAP (within 1 month)","tl_1_3m":"1–3 months","tl_3_6m":"3–6 months","tl_flexible":"Flexible","member_center":"Member Center","logout":"Sign Out"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"開発プロセス","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_q":"プロジェクトを始めませんか？","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","login":"ログイン","status_open":"受注中","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","footer_contact_title":"お問い合わせ","ai_back":"実績に戻る","ai_eyebrow":"// AI 要件アシスタント","ai_h1":"一言で","ai_h2":"やりたいことを教えて","ai_sub":"AI が要件フォームを自動入力します。再入力の手間を省けます。","ai_step1":"Step 1 — 要件を入力","ai_input_ph":"例：50名規模の塾で、保護者がオンラインで出席と成績を確認できるシステムを作りたい。2ヶ月以内に公開、予算は約15万円。","ai_input_hint":"// プロンプト形式は避け、自然な日本語で入力してください","ai_btn_analyze":"AI で解析","ai_btn_manual":"手動入力に切替","ai_step2":"Step 2 — AI 結果を確認","ai_field_service":"サービス種別","ai_field_budget":"予算","ai_field_timeline":"工期","ai_field_summary":"概要","ai_disclaimer":"// 不正確な場合は手動入力へ。連絡先はログイン中のメールを使用します。","ai_btn_confirm":"確認して送信","ai_btn_redo":"入力し直す","ai_success_title":"受け付けました。ありがとうございます","ai_success_body":"1〜2 営業日以内にご返信します。お急ぎの場合は LINE / メールで直接ご連絡ください。","ai_btn_back_portfolio":"実績に戻る","err_too_long":"500文字を超えています","err_blocked":"許可されない命令パターンが含まれています","err_rate_limit":"本日の AI 利用上限に達しました","err_ai":"AI サービスが一時的にご利用いただけません","err_network":"ネットワークエラー、再試行してください","err_auth":"セッションが切れました。再ログインしてください","err_submit":"送信に失敗しました。手動入力をお試しください","sv_system":"システム開発 / 社内ツール","sv_web":"ウェブサイト / ランディングページ","sv_game":"ゲーム開発 / Unity・Webゲーム","sv_integration":"API連携 / 自動化","sv_interactive":"インタラクティブ体験 / ブランドイベント","sv_branding":"ブランドアイデンティティ","sv_marketing":"デジタルマーケティング","sv_other":"その他","bg_under30k":"30,000円以下","bg_30k_80k":"30,000～80,000円","bg_80k_200k":"80,000～200,000円","bg_200k_1m":"200,000～1,000,000円","bg_flexible":"柔軟","tl_asap":"できるだけ早く（1ヶ月以内）","tl_1_3m":"1〜3ヶ月","tl_3_6m":"3〜6ヶ月","tl_flexible":"柔軟に対応","member_center":"メンバーセンター","logout":"ログアウト"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"진행 과정","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_q":"프로젝트를 시작할 준비가 되셨나요?","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","login":"회원 로그인","status_open":"수주 중","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","footer_contact_title":"연락하기","ai_back":"포트폴리오로 돌아가기","ai_eyebrow":"// AI 요구사항 도우미","ai_h1":"한 문장으로","ai_h2":"무엇을 만들고 싶은지 알려주세요","ai_sub":"AI가 요구사항 양식을 자동 작성합니다. 재입력 시간을 아껴드립니다.","ai_step1":"Step 1 — 요구사항 입력","ai_input_ph":"예: 50명 규모의 학원에서 학부모가 온라인으로 출석과 성적을 확인할 수 있는 시스템을 만들고 싶습니다. 2개월 내 오픈, 예산은 약 15만원.","ai_input_hint":"// 프롬프트 형식은 피하고 자연스러운 한국어로 작성","ai_btn_analyze":"AI 분석","ai_btn_manual":"수동 입력으로","ai_step2":"Step 2 — AI 결과 확인","ai_field_service":"서비스 유형","ai_field_budget":"예산","ai_field_timeline":"일정","ai_field_summary":"요약","ai_disclaimer":"// 정확하지 않다면 수동 입력으로. 연락처는 로그인 이메일을 사용합니다.","ai_btn_confirm":"확인 후 제출","ai_btn_redo":"다시 작성","ai_success_title":"접수되었습니다. 감사합니다","ai_success_body":"1–2 영업일 내에 답변드립니다. 급한 경우 LINE / 이메일로 직접 연락해 주세요.","ai_btn_back_portfolio":"포트폴리오로 돌아가기","err_too_long":"500자 제한을 초과했습니다","err_blocked":"허용되지 않는 명령 패턴이 포함되어 있습니다","err_rate_limit":"오늘의 AI 사용 한도에 도달했습니다","err_ai":"AI 서비스가 일시적으로 사용 불가입니다","err_network":"네트워크 오류, 다시 시도하세요","err_auth":"세션이 만료되었습니다","err_submit":"제출 실패, 수동 입력을 시도하세요","sv_system":"시스템 개발 / 내부 툴","sv_web":"웹사이트 / 랜딩페이지","sv_game":"게임 개발 / Unity・Web Game","sv_integration":"API 연동 / 자동화","sv_interactive":"인터랙티브 경험","sv_branding":"브랜드 아이덴티티","sv_marketing":"디지털 마케팅","sv_other":"기타","bg_under30k":"30,000원 미만","bg_30k_80k":"30,000 – 80,000원","bg_80k_200k":"80,000 – 200,000원","bg_200k_1m":"200,000 – 1,000,000원","bg_flexible":"유동적","tl_asap":"최대한 빨리（1개월 이내）","tl_1_3m":"1–3개월","tl_3_6m":"3–6개월","tl_flexible":"유연","member_center":"회원 센터","logout":"로그아웃"}};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function applyLang(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = LANGS_I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (t[k] !== undefined) el.placeholder = t[k]; });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  // 若 result 已顯示，重新渲染欄位中文
  if (window._lastAiResult) renderResult(window._lastAiResult);
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => { langDrop?.classList.remove('open'); document.getElementById('m-top-lang-drop')?.classList.remove('open'); });
langDrop?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); langDrop.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); });
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLang(curLang);

// ── Reveal animation ──────────────────────────────
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ──────────────────────────────────────────────────────
// ── AI assistant logic ────────────────────────────────
// ──────────────────────────────────────────────────────

// 簡易瀏覽器指紋（canvas + UA）— 不存任何 PII，僅用於限流維度
function fpHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function getFingerprint() {
  try {
    const c = document.createElement('canvas'); c.width = 200; c.height = 30;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top'; ctx.font = '14px Arial'; ctx.fillStyle = '#069';
    ctx.fillText('chiyigo-ai-' + navigator.platform, 2, 2);
    const data = c.toDataURL();
    return fpHash(data + '|' + navigator.userAgent + '|' + navigator.language + '|' + screen.width + 'x' + screen.height);
  } catch { return fpHash(navigator.userAgent + '|' + navigator.language); }
}
function getSessionId() {
  const KEY = 'ai_session_id';
  let s = null;
  try { s = sessionStorage.getItem(KEY); } catch {}
  if (!s) {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    s = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem(KEY, s); } catch {}
  }
  return s;
}

// Cloudflare Turnstile — 部署後在此填入 sitekey 即啟用 widget
const TURNSTILE_SITEKEY = '';
let _turnstileToken = '';
function renderTurnstile() {
  if (!TURNSTILE_SITEKEY || !window.turnstile) return;
  window.turnstile.render('#turnstile-wrap', {
    sitekey: TURNSTILE_SITEKEY,
    callback: tok => { _turnstileToken = tok; },
    'error-callback': () => { _turnstileToken = ''; },
    'expired-callback': () => { _turnstileToken = ''; },
  });
}
window.onloadTurnstileCallback = renderTurnstile;
if (window.turnstile && TURNSTILE_SITEKEY) renderTurnstile();

const inputEl   = document.getElementById('ai-input');
const countEl   = document.getElementById('ai-count');
const errEl     = document.getElementById('ai-error');
const errEl2    = document.getElementById('ai-confirm-error');
const btnAnal   = document.getElementById('btn-analyze');
const btnConf   = document.getElementById('btn-confirm');
const btnRedo   = document.getElementById('btn-redo');
const cardRes   = document.getElementById('ai-result');
const cardSucc  = document.getElementById('ai-success');
const succRef   = document.getElementById('ai-success-ref');

inputEl?.addEventListener('input', () => {
  const len = inputEl.value.length;
  if (countEl) {
    countEl.textContent = len + ' / 500';
    countEl.classList.toggle('over', len > 500);
  }
});

function showErr(target, key) {
  const t = LANGS_I18N[curLang] || LANGS_I18N['zh-TW'];
  target.textContent = '// error: ' + (t[key] ?? key);
  target.classList.add('show');
}
function clearErr(target) { target.textContent = ''; target.classList.remove('show'); }

async function authedFetch(url, opts) {
  let token = sessionStorage.getItem(TOKEN_KEY);
  const doFetch = (tok) => fetch(url, {
    ...opts,
    credentials: 'include',
    headers: { ...(opts?.headers || {}), 'Content-Type': 'application/json', ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}) },
  });
  let res = await doFetch(token);
  if (res.status === 401) {
    // try refresh once
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      if (d.access_token) {
        sessionStorage.setItem(TOKEN_KEY, d.access_token);
        res = await doFetch(d.access_token);
      }
    }
  }
  return res;
}

let _lastResult = null;

function labelMap(field, value) {
  const t = LANGS_I18N[curLang] || LANGS_I18N['zh-TW'];
  const prefix = field === 'service' ? 'sv_'
               : field === 'budget'  ? 'bg_'
               : field === 'timeline'? 'tl_'
               : null;
  if (!prefix || !value) return value;
  const key = prefix + String(value).replace(/-/g, '_');
  return t[key] ?? value;
}

function renderResult(r) {
  window._lastAiResult = r;
  document.getElementById('r-service').textContent  = labelMap('service',  r.service_type);
  document.getElementById('r-budget').textContent   = labelMap('budget',   r.budget);
  document.getElementById('r-timeline').textContent = labelMap('timeline', r.timeline);
  document.getElementById('r-summary').textContent  = r.summary;
}

btnAnal?.addEventListener('click', async () => {
  clearErr(errEl);
  const prompt = (inputEl.value || '').trim();
  if (!prompt) return;
  if (prompt.length > 500) { showErr(errEl, 'err_too_long'); return; }

  btnAnal.classList.add('is-loading'); btnAnal.disabled = true;
  try {
    const res = await authedFetch('/api/ai/assist', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        fingerprint: getFingerprint(),
        session_id:  getSessionId(),
        turnstile_token: _turnstileToken,
      }),
    });

    if (res.status === 401) { showErr(errEl, 'err_auth'); setTimeout(() => location.replace('/login.html'), 1200); return; }
    if (res.status === 429) { showErr(errEl, 'err_rate_limit'); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'TOO_LONG')         showErr(errEl, 'err_too_long');
      else if (data.code === 'BLOCKED')     showErr(errEl, 'err_blocked');
      else if (data.code === 'AI_ERROR')    showErr(errEl, 'err_ai');
      else if (data.code === 'INVALID_OUTPUT') showErr(errEl, 'err_ai');
      else showErr(errEl, data.error || 'err_network');
      return;
    }
    _lastResult = data;
    renderResult(data);
    cardRes.classList.add('show');
    cardRes.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    showErr(errEl, 'err_network');
  } finally {
    btnAnal.classList.remove('is-loading'); btnAnal.disabled = false;
  }
});

btnRedo?.addEventListener('click', () => {
  cardRes.classList.remove('show');
  _lastResult = null;
  inputEl.focus();
});

btnConf?.addEventListener('click', async () => {
  clearErr(errEl2);
  if (!_lastResult) return;

  // 取得 user email 作為 contact，name 預設用 email 前段
  let me = null;
  try {
    const r = await authedFetch('/api/auth/me', { method: 'GET' });
    if (r.ok) me = await r.json();
  } catch {}
  if (!me?.email) { showErr(errEl2, 'err_auth'); return; }

  btnConf.classList.add('is-loading'); btnConf.disabled = true;
  try {
    const payload = {
      name:         me.email.split('@')[0],
      contact:      me.email,
      service_type: _lastResult.service_type,
      budget:       _lastResult.budget,
      timeline:     _lastResult.timeline,
      message:      'AI 助手生成：\n' + _lastResult.summary + '\n\n[原始輸入]\n' + (inputEl.value || '').trim(),
    };
    const res = await authedFetch('/api/requisition', { method: 'POST', body: JSON.stringify(payload) });
    if (res.status === 401) { showErr(errEl2, 'err_auth'); return; }
    if (res.status === 429) {
      const d = await res.json().catch(() => ({}));
      errEl2.textContent = '// error: ' + (d.error ?? '今日提單次數已達上限');
      errEl2.classList.add('show');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showErr(errEl2, data.error || 'err_submit'); return; }

    // 成功
    cardRes.classList.remove('show');
    cardSucc.classList.add('show');
    if (succRef && data.id) succRef.textContent = '// ref: #' + data.id;
    cardSucc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    showErr(errEl2, 'err_submit');
  } finally {
    btnConf.classList.remove('is-loading'); btnConf.disabled = false;
  }
});

// ── block 2/2 ──
(function () {
  const canvas = document.getElementById('neural-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let W = 0, H = 0, nodes = [];
  const DIST = 155;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  function initNodes() {
    const n = W < 768 ? 48 : 115;
    nodes = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28,
      r: Math.random() * 1.1 + .4, pulse: Math.random() * Math.PI * 2,
    }));
  }
  const mouse = { x: -9999, y: -9999 };
  document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  let cfg = { r: '108', g: '110', b: '229', no: .22, lo: .09 };
  function syncCfg() {
    const s = getComputedStyle(document.documentElement);
    cfg = {
      r:  s.getPropertyValue('--neural-r').trim()            || '108',
      g:  s.getPropertyValue('--neural-g').trim()            || '110',
      b:  s.getPropertyValue('--neural-b').trim()            || '229',
      no: parseFloat(s.getPropertyValue('--neural-node-opacity').trim() || '.22'),
      lo: parseFloat(s.getPropertyValue('--neural-line-opacity').trim() || '.09'),
    };
  }
  syncCfg();
  new MutationObserver(syncCfg).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const { r, g, b, no, lo } = cfg;
    for (const n of nodes) {
      const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 16900) { const d = Math.sqrt(d2); n.vx += dx / d * .055; n.vy += dy / d * .055; }
      n.vx *= .982; n.vy *= .982;
      n.x += n.vx; n.y += n.vy;
      if (n.x < -12) n.x = W + 12; else if (n.x > W + 12) n.x = -12;
      if (n.y < -12) n.y = H + 12; else if (n.y > H + 12) n.y = -12;
      n.pulse += .011;
      const p = Math.sin(n.pulse) * .25 + .75;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * p, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${no * p})`; ctx.fill();
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy;
        if (d2 < DIST * DIST) {
          const a = (1 - Math.sqrt(d2) / DIST) * lo;
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(${r},${g},${b},${a})`; ctx.lineWidth = .5; ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  resize(); initNodes(); draw();
  window.addEventListener('resize', () => { resize(); initNodes(); });
})();
