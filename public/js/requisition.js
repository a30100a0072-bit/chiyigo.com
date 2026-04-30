// ── block 1/2 ──
// ── Form submission ──────────────────────────────────
const form      = document.getElementById('contact-form');
const formError = document.getElementById('form-error');
const submitBtn = document.getElementById('submit-btn');
const btnText   = submitBtn?.querySelector('.btn-text');
const btnLoad   = submitBtn?.querySelector('.btn-loading');
const btnIcon   = submitBtn?.querySelector('.btn-icon');
const formSucc  = document.getElementById('form-success');

function setLoading(on) {
  if (!submitBtn || !btnText || !btnLoad || !btnIcon) return;
  submitBtn.toggleAttribute('disabled', on);
  btnText.hidden = on;
  btnLoad.hidden = !on;
  btnIcon.hidden = on;
}
function showErr(msg) { if (formError) { formError.textContent = msg; formError.classList.add('visible'); } }
function clearErr()   { if (formError) { formError.textContent = '';  formError.classList.remove('visible'); } }

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr();

  let ok = true;
  form.querySelectorAll('[required]').forEach(el => {
    if (el.value.trim()) { el.classList.remove('field-error'); }
    else { el.classList.add('field-error'); ok = false; }
  });
  if (!ok) {
    showErr('// error: 請填寫所有必填欄位');
    form.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const contactEl = form.querySelector('[name="contact"]');
  if (contactEl) {
    const v = contactEl.value.trim();
    if (!/.+@.+\..+/.test(v) && !/^09\d{8}$/.test(v) && !/^[a-zA-Z0-9._\-@]{4,}$/.test(v)) {
      contactEl.classList.add('field-error');
      showErr('// error: 請填寫有效的聯絡方式（Email / LINE ID / 手機號碼）');
      contactEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  setLoading(true);
  try {
    const payload = {
      name:         form.querySelector('[name="name"]').value.trim(),
      company:      form.querySelector('[name="company"]').value.trim(),
      contact:      form.querySelector('[name="contact"]').value.trim(),
      service_type: form.querySelector('[name="service_type"]').value,
      budget:       form.querySelector('[name="budget"]').value,
      timeline:     form.querySelector('[name="timeline"]').value,
      message:      form.querySelector('[name="message"]').value.trim(),
    };
    const _token = sessionStorage.getItem('access_token');
    const fetchHeaders = { 'Content-Type': 'application/json' };
    if (_token) fetchHeaders['Authorization'] = 'Bearer ' + _token;
    const res = await fetch('/api/requisition', {
      method:  'POST',
      headers: fetchHeaders,
      body:    JSON.stringify(payload),
    });
    if (res.status === 401) {
      sessionStorage.removeItem('access_token');
      showErr('// error: 認證失敗，請重新整理後再試');
      setLoading(false);
      return;
    }
    if (res.status === 429) {
      const d = await res.json().catch(() => ({}));
      showErr('// error: ' + (d.error ?? '今日提單次數已達上限'));
      setLoading(false);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const json = await res.json();
    setLoading(false);
    if (form) form.style.display = 'none';
    if (formSucc) formSucc.classList.add('visible');
    const ref = document.getElementById('success-ref');
    if (ref && json.id) ref.textContent = `// ref: #${json.id}`;
  } catch (err) {
    showErr('// error: 送出失敗，請稍後再試，或直接 LINE / Email 聯絡我');
    setLoading(false);
  }
});

form?.addEventListener('input', (e) => { e.target?.classList.remove('field-error'); });

// ── Mobile overlay ──────────────────────────────────
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');

function openMenu() {
  hamBtn?.setAttribute('aria-expanded', 'true');
  hamBtn?.classList.add('is-open');
  overlay?.classList.add('is-open');
  overlay?.removeAttribute('aria-hidden');
  topbar?.classList.add('menu-open');
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  hamBtn?.setAttribute('aria-expanded', 'false');
  hamBtn?.classList.remove('is-open');
  overlay?.classList.remove('is-open');
  overlay?.setAttribute('aria-hidden', 'true');
  topbar?.classList.remove('menu-open');
  document.body.style.overflow = '';
}
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── Drag-to-close (bottom sheet swipe down) ──────────
;(function () {
  const THRESHOLD = 110
  let startY = 0, lastY = 0, active = false
  document.addEventListener('touchstart', function (e) {
    const ov = document.getElementById('m-overlay')
    if (!ov || !ov.classList.contains('is-open')) return
    const wrap = ov.querySelector('.m-ov-wrap')
    if (!wrap) return
    const t = e.touches[0], r = wrap.getBoundingClientRect()
    if (t.clientY < r.top || t.clientY > r.bottom) return
    const nav = wrap.querySelector('.m-ov-nav')
    if (nav && nav.scrollTop > 0) {
      const nr = nav.getBoundingClientRect()
      if (t.clientY >= nr.top && t.clientY <= nr.bottom) return
    }
    startY = t.clientY; lastY = startY; active = true
    wrap.style.transition = 'none'
  }, { passive: true })
  document.addEventListener('touchmove', function (e) {
    if (!active) return
    lastY = e.touches[0].clientY
    const dy = lastY - startY
    if (dy <= 0) return
    const ov = document.getElementById('m-overlay')
    const wrap = ov && ov.querySelector('.m-ov-wrap')
    if (!wrap) return
    wrap.style.transform = `translateY(${dy}px)`
    const ratio = Math.max(0, 1 - dy / wrap.offsetHeight * 1.5)
    ov.style.background = `rgba(10,12,28,${(0.32 * ratio).toFixed(3)})`
    e.preventDefault()
  }, { passive: false })
  document.addEventListener('touchend', function () {
    if (!active) return
    active = false
    const ov = document.getElementById('m-overlay')
    const wrap = ov && ov.querySelector('.m-ov-wrap')
    if (!wrap) { startY = 0; lastY = 0; return }
    const dy = lastY - startY
    ov.style.background = ''
    if (dy > THRESHOLD) {
      wrap.style.transition = 'transform .26s ease'
      wrap.style.transform = 'translateY(100%)'
      setTimeout(() => {
        wrap.style.transform = ''; wrap.style.transition = ''
        ov.classList.remove('is-open')
        ov.setAttribute('aria-hidden', 'true')
        const btn = document.getElementById('m-ham-btn')
        btn?.classList.remove('is-open')
        btn?.setAttribute('aria-expanded', 'false')
        document.getElementById('m-topbar')?.classList.remove('menu-open')
        document.body.style.overflow = ''
      }, 260)
    } else {
      wrap.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1)'
      wrap.style.transform = ''
      setTimeout(() => { wrap.style.transition = '' }, 420)
    }
    startY = 0; lastY = 0
  }, { passive: true })
})()

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
    if (sun)  sun.hidden = dark;
    if (moon) moon.hidden = !dark;
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
const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","cta_q":"準備好開始專案了嗎？","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","login":"會員登入","status_open":"接案中","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","req_eyebrow":"// 接案諮詢","req_h1":"把你的想法","req_h2":"告訴我","req_sub":"填寫以下表單，我會在 1–2 個工作天內回覆。","avail_text":"接受新專案洽談中","req_name_lbl":"你的名字","req_name_ph":"陳小明","req_company_lbl":"公司 / 品牌","req_company_ph":"Acme Inc.（選填）","req_contact_lbl":"聯絡方式","req_contact_hint":"Line ID / Email / 手機，擇一填寫即可","req_contact_ph":"you@example.com 或 LINE ID 或手機號碼","req_svctype_lbl":"需求類型","req_budget_lbl":"預算區間","req_timeline_lbl":"預計時程","req_message_lbl":"需求簡述","req_message_ph":"描述你的需求、目前的痛點、希望的成效…","sel_placeholder":"— 請選擇 —","svc_opt_system":"系統開發 / 內部工具","svc_opt_web":"網站建置 / Landing Page","svc_opt_game":"遊戲開發 / Unity・Web Game","svc_opt_integration":"第三方串接 / 自動化流程","svc_opt_interactive":"互動體驗 / 品牌活動","svc_opt_branding":"品牌識別 / 視覺設計","svc_opt_marketing":"數位行銷 / SEO","svc_opt_other":"其他 / 不確定，想先聊聊","budget_u30k":"30,000 以下","budget_30_80k":"30,000 – 80,000","budget_80_200k":"80,000 – 200,000","budget_200k_1m":"200,000 – 1,000,000","budget_flex":"預算彈性，視方案而定","tl_asap":"越快越好（1 個月內）","tl_1_3m":"1–3 個月","tl_3_6m":"3–6 個月","tl_flex":"時程彈性","req_submit":"送出諮詢","req_sending":"傳送中…","req_success_title":"收到了，謝謝你","req_success_body":"我會在 1–2 個工作天內回覆你。若有急件，請直接 LINE / Email 聯絡我。","info_direct_contact":"// 直接聯絡","info_response_time":"// 回覆時效","stat_unit_days":"工作天","stat_free_val":"免費","stat_unit_consult":"初步諮詢","info_current_status":"// 目前狀態","footer_contact_title":"聯絡我們","member_center":"會員中心","logout":"登出","ai_helper_btn":"用 AI 需求單助手快速生成","ai_helper_desc":"先和 AI 對話釐清需求，再自動產出表單。","ai_helper_badge":"需會員登入"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","cta_q":"Ready to Start a Project?","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","login":"Member Login","status_open":"Open for Work","tooltip_theme":"Toggle Theme","tooltip_lang":"Switch Language","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","req_eyebrow":"// Hire Me","req_h1":"Share Your Ideas","req_h2":"With Me","req_sub":"Fill out the form below. I'll reply within 1–2 business days.","avail_text":"Open for New Projects","req_name_lbl":"Your Name","req_name_ph":"Jane Smith","req_company_lbl":"Company / Brand","req_company_ph":"Acme Inc. (optional)","req_contact_lbl":"Contact","req_contact_hint":"Line ID / Email / Phone — any one is fine","req_contact_ph":"you@example.com or LINE ID or phone","req_svctype_lbl":"Service Type","req_budget_lbl":"Budget Range","req_timeline_lbl":"Timeline","req_message_lbl":"Brief Description","req_message_ph":"Describe your needs, current pain points, and desired outcomes…","sel_placeholder":"— Select —","svc_opt_system":"System Development / Internal Tools","svc_opt_web":"Website / Landing Page","svc_opt_game":"Game Development / Unity・Web Game","svc_opt_integration":"API Integration / Automation","svc_opt_interactive":"Interactive Experience / Brand Events","svc_opt_branding":"Brand Identity / Visual Design","svc_opt_marketing":"Digital Marketing / SEO","svc_opt_other":"Other / Not Sure — Let's Chat","budget_u30k":"Under 30,000","budget_30_80k":"30,000 – 80,000","budget_80_200k":"80,000 – 200,000","budget_200k_1m":"200,000 – 1,000,000","budget_flex":"Flexible — depends on scope","tl_asap":"ASAP (within 1 month)","tl_1_3m":"1–3 months","tl_3_6m":"3–6 months","tl_flex":"Flexible","req_submit":"Submit Request","req_sending":"Sending…","req_success_title":"Got it — thank you!","req_success_body":"I'll reply within 1–2 business days. For urgent matters, contact me directly via LINE / Email.","info_direct_contact":"// Direct Contact","info_response_time":"// Response Time","stat_unit_days":"Business Days","stat_free_val":"Free","stat_unit_consult":"Initial Consult","info_current_status":"// Current Status","footer_contact_title":"Contact Us","member_center":"Member Center","logout":"Sign Out","ai_helper_btn":"Use the AI Requisition Assistant","ai_helper_desc":"Chat with AI to clarify your needs, then auto-fill the form.","ai_helper_badge":"Login required"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"開発プロセス","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_q":"プロジェクトを始めませんか？","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","login":"ログイン","status_open":"受注中","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","req_eyebrow":"// お問い合わせ","req_h1":"アイデアを","req_h2":"聞かせてください","req_sub":"以下のフォームを送信してください。1〜2 営業日以内に返信します。","avail_text":"新規案件受付中","req_name_lbl":"お名前","req_name_ph":"山田 太郎","req_company_lbl":"会社 / ブランド","req_company_ph":"Acme Inc.（任意）","req_contact_lbl":"連絡先","req_contact_hint":"LINE ID / メール / 電話番号、いずれか一つ","req_contact_ph":"you@example.com または LINE ID または電話番号","req_svctype_lbl":"ご依頼の種類","req_budget_lbl":"予算規模","req_timeline_lbl":"希望納期","req_message_lbl":"ご要望の概要","req_message_ph":"ご要望・現在の課題・期待する成果をご記入ください…","sel_placeholder":"— 選択してください —","svc_opt_system":"システム開発 / 社内ツール","svc_opt_web":"ウェブサイト / ランディングページ","svc_opt_game":"ゲーム開発 / Unity・Webゲーム","svc_opt_integration":"API連携 / 自動化","svc_opt_interactive":"インタラクティブ体験 / ブランドイベント","svc_opt_branding":"ブランドアイデンティティ / ビジュアルデザイン","svc_opt_marketing":"デジタルマーケティング / SEO","svc_opt_other":"その他 / 未定（まずはご相談）","budget_u30k":"30,000円以下","budget_30_80k":"30,000～80,000円","budget_80_200k":"80,000～200,000円","budget_200k_1m":"200,000～1,000,000円","budget_flex":"予算は柔軟に対応","tl_asap":"できるだけ早く（1ヶ月以内）","tl_1_3m":"1〜3ヶ月","tl_3_6m":"3〜6ヶ月","tl_flex":"柔軟に対応可","req_submit":"送信する","req_sending":"送信中…","req_success_title":"受け付けました。ありがとうございます","req_success_body":"1〜2営業日以内にご返信します。お急ぎの場合はLINE / メールで直接ご連絡ください。","info_direct_contact":"// 直接連絡","info_response_time":"// 返信目安","stat_unit_days":"営業日","stat_free_val":"無料","stat_unit_consult":"初回相談","info_current_status":"// 現在の状況","footer_contact_title":"お問い合わせ","member_center":"メンバーセンター","logout":"ログアウト","ai_helper_btn":"AI依頼アシスタントで素早く作成","ai_helper_desc":"AIと対話して要望を整理してからフォームに自動反映。","ai_helper_badge":"ログインが必要"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"진행 과정","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_q":"프로젝트를 시작할 준비가 되셨나요?","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","login":"회원 로그인","status_open":"수주 중","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","req_eyebrow":"// 프로젝트 문의","req_h1":"아이디어를","req_h2":"알려주세요","req_sub":"아래 양식을 작성해 주세요. 1–2 영업일 내에 답변드립니다.","avail_text":"새 프로젝트 수주 중","req_name_lbl":"이름","req_name_ph":"홍길동","req_company_lbl":"회사 / 브랜드","req_company_ph":"Acme Inc.（선택사항）","req_contact_lbl":"연락처","req_contact_hint":"LINE ID / 이메일 / 전화번호 중 하나","req_contact_ph":"you@example.com 또는 LINE ID 또는 전화번호","req_svctype_lbl":"서비스 유형","req_budget_lbl":"예산 범위","req_timeline_lbl":"예상 일정","req_message_lbl":"요구사항 요약","req_message_ph":"필요한 것, 현재 고민, 원하는 성과를 설명해 주세요…","sel_placeholder":"— 선택하세요 —","svc_opt_system":"시스템 개발 / 내부 툴","svc_opt_web":"웹사이트 / 랜딩페이지","svc_opt_game":"게임 개발 / Unity・Web Game","svc_opt_integration":"API 연동 / 자동화","svc_opt_interactive":"인터랙티브 경험 / 브랜드 이벤트","svc_opt_branding":"브랜드 아이덴티티 / 비주얼 디자인","svc_opt_marketing":"디지털 마케팅 / SEO","svc_opt_other":"기타 / 미정 — 먼저 상담해요","budget_u30k":"30,000원 미만","budget_30_80k":"30,000 – 80,000원","budget_80_200k":"80,000 – 200,000원","budget_200k_1m":"200,000 – 1,000,000원","budget_flex":"예산 유동적","tl_asap":"최대한 빨리（1개월 이내）","tl_1_3m":"1–3개월","tl_3_6m":"3–6개월","tl_flex":"일정 유연","req_submit":"문의 제출","req_sending":"전송 중…","req_success_title":"접수되었습니다. 감사합니다","req_success_body":"1–2 영업일 내에 답변드립니다. 급한 경우 LINE / 이메일로 직접 연락해 주세요.","info_direct_contact":"// 직접 연락","info_response_time":"// 응답 시간","stat_unit_days":"영업일","stat_free_val":"무료","stat_unit_consult":"초기 상담","info_current_status":"// 현재 상태","footer_contact_title":"연락하기","member_center":"회원 센터","logout":"로그아웃","ai_helper_btn":"AI 요청서 도우미로 빠르게 작성","ai_helper_desc":"AI와 대화하며 요구를 정리한 후 자동으로 폼에 입력합니다.","ai_helper_badge":"로그인 필요"}};
let curLangI = localStorage.getItem('lang') || 'zh-TW';
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLangI = lang;
  const t = LANGS_I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (t[k] !== undefined) el.placeholder = t[k]; });
  const tBtn = document.getElementById('theme-toggle-btn');
  const lBtn = document.getElementById('lang-toggle-btn');
  if (tBtn) { tBtn.title = t.tooltip_theme; tBtn.setAttribute('aria-label', t.tooltip_theme); }
  if (lBtn) { lBtn.title = t.tooltip_lang; lBtn.setAttribute('aria-label', t.tooltip_lang); }
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
}
const langTogBtnI = document.getElementById('lang-toggle-btn');
const langDropI   = document.getElementById('lang-dropdown');
langTogBtnI?.addEventListener('click', e => { e.stopPropagation(); langDropI?.classList.toggle('open'); });
document.addEventListener('click', () => { langDropI?.classList.remove('open'); document.getElementById('m-top-lang-drop')?.classList.remove('open'); });
langDropI?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDropI.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); });
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLangI(curLangI);

// ── Reveal animation ──────────────────────────────
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ── Contact: Email (L2 obfuscation — no plaintext mailto in DOM) ──
document.getElementById('btn-contact-email')?.addEventListener('click', function () {
  var u = ['chiyigo', '20201208'].join('');
  var d = ['gmail', 'com'].join('.');
  var el = document.createElement('a');
  el.setAttribute('href', 'mailto:' + u + '\x40' + d);
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
});

// ── Contact: LINE (Worker redirect — no raw LINE URL in frontend) ──
document.getElementById('btn-contact-line')?.addEventListener('click', function () {
  window.open('/api/redirect/line', '_blank', 'noopener,noreferrer');
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

// ── Phase C-3 m-lang-btn wire ──
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);
