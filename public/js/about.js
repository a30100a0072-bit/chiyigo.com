// ── block 1/2 ──
// ── Mobile overlay ──────────────────────────────────────────
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');

function openMenu() {
  hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open');
  overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden');
  topbar?.classList.add('menu-open'); document.body.style.overflow='hidden';
}
function closeMenu() {
  hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open');
  overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
  topbar?.classList.remove('menu-open'); document.body.style.overflow='';
}
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

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

// ── Theme toggle ──────────────────────────────────────────
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');

function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun = btn.querySelector('.icon-sun'), moon = btn.querySelector('.icon-moon');
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? ''     : 'none';
  });
}
applyTheme(localStorage.getItem('theme') !== 'light');
const doToggle = () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
};
themeBtn?.addEventListener('click', doToggle);
mThemeBtn?.addEventListener('click', doToggle);

// ── i18n ──────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","cta_q":"準備好開始專案了嗎？","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","login":"會員登入","status_open":"接案中","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","ab_role":"獨立系統開發者","ab_headline1":"把需求變成","ab_headline2":"真正能用的系統","ab_desc":"我是一位全端獨立開發者，專注於系統設計、客製化開發與 AI 整合。從需求釐清、架構規劃到系統上線，提供一站式的數位解決方案。","ab_stat_projects":"完成專案","ab_stat_experience":"開發經驗","ab_stat_satisfaction":"客戶滿意度","ab_cta":"開始合作 →","section_history":"// 經歷","section_values":"// 工作理念","section_values_sub":"我怎麼看待每一個專案","section_skills":"// 技術堆疊","section_skills_sub":"使用的工具與技術","tl_2019":"開始接案，主要以網站設計與前端開發為主","tl_2020":"擴展至後端系統開發，首個企業後台管理系統上線","tl_2021":"導入 React Native，開始承接 iOS/Android 雙平台開發","tl_2022":"整合 AI 技術，完成多個 ChatGPT 商業應用專案","tl_2023":"累積超過 50 個完成專案，專注於系統整合與自動化流程","tl_2024":"持續精進，專注打造能真正解決業務問題的數位系統","tl_2025":"正式推出 CHIYIGO IAM 跨平台身份認證服務，Serverless 架構整合 OAuth 社群登入與多站台授權","val1_title":"需求優先","val1_text":"不賣技術，賣解法。每個功能都對應真實的業務需求，沒有多餘的複雜度。","val2_title":"可維護性","val2_text":"交付的程式碼必須易於理解、擴展與維護，不製造技術債。","val3_title":"準時交付","val3_text":"時程透明、進度即時同步，不讓客戶在等待中產生焦慮。","val4_title":"長期關係","val4_text":"不是做完就消失。上線後的問題同樣重要，維護與迭代才是真正的服務。","skill1_name":"前端開發","skill2_name":"後端開發","skill3_name":"行動應用","skill4_name":"AI / 整合","skill5_name":"雲端 / DevOps","footer_contact_title":"聯絡我們","member_center":"會員中心","logout":"登出"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","cta_q":"Ready to Start a Project?","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","login":"Member Login","status_open":"Open for Work","tooltip_theme":"Toggle Theme","tooltip_lang":"Switch Language","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","ab_role":"Full-Stack Independent Developer","ab_headline1":"Turn Your Requirements Into","ab_headline2":"Systems That Actually Work","ab_desc":"I'm a full-stack independent developer focused on system design, custom development, and AI integration. From requirements to launch — end-to-end digital solutions.","ab_stat_projects":"Projects Done","ab_stat_experience":"Dev Experience","ab_stat_satisfaction":"Client Satisfaction","ab_cta":"Start Collaboration →","section_history":"// Experience","section_values":"// Philosophy","section_values_sub":"How I approach every project","section_skills":"// Tech Stack","section_skills_sub":"Tools & technologies","tl_2019":"Started freelancing, focusing on web design and front-end development.","tl_2020":"Expanded into back-end systems; first enterprise admin dashboard launched.","tl_2021":"Adopted React Native and began taking on iOS/Android dual-platform projects.","tl_2022":"Integrated AI — delivered multiple ChatGPT-powered business applications.","tl_2023":"Surpassed 50 completed projects; specializing in system integration and automation.","tl_2024":"Continued growth, focused on building digital systems that truly solve business problems.","tl_2025":"Launched CHIYIGO IAM — cross-platform identity service with Serverless architecture, OAuth social login, and multi-site authorization.","val1_title":"Requirements First","val1_text":"We sell solutions, not technology. Every feature maps to a real business need — no unnecessary complexity.","val2_title":"Maintainability","val2_text":"Delivered code must be easy to understand, extend, and maintain — no technical debt.","val3_title":"On-Time Delivery","val3_text":"Transparent timelines and real-time progress updates — no anxiety-inducing waiting.","val4_title":"Long-Term Partnership","val4_text":"We don't disappear after launch. Post-release issues matter just as much — maintenance and iteration are the real service.","skill1_name":"Front-End","skill2_name":"Back-End","skill3_name":"Mobile Apps","skill4_name":"AI / Integration","skill5_name":"Cloud / DevOps","footer_contact_title":"Contact Us","member_center":"Member Center","logout":"Sign Out"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"開発プロセス","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_q":"プロジェクトを始めませんか？","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","login":"ログイン","status_open":"受注中","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","ab_role":"フルスタック独立開発者","ab_headline1":"要件を","ab_headline2":"本当に使えるシステムへ","ab_desc":"システム設計・カスタム開発・AI 統合に特化したフルスタック独立開発者。要件定義から本番稼働まで、ワンストップで提供します。","ab_stat_projects":"完了案件","ab_stat_experience":"開発経験","ab_stat_satisfaction":"顧客満足度","ab_cta":"コラボを始める →","section_history":"// 経歴","section_values":"// 理念","section_values_sub":"すべてのプロジェクトへのアプローチ","section_skills":"// 技術スタック","section_skills_sub":"使用ツールと技術","tl_2019":"フリーランスを開始。主にWebデザインとフロントエンド開発を担当。","tl_2020":"バックエンド開発に拡張。初の企業向け管理システムをリリース。","tl_2021":"React Nativeを導入し、iOS/Android 両対応のアプリ開発を開始。","tl_2022":"AI技術を統合し、複数のChatGPTビジネスアプリを納品。","tl_2023":"完了案件50件超。システム連携と自動化に注力。","tl_2024":"成長を続け、本当にビジネス課題を解決するデジタルシステムに集中。","tl_2025":"CHIYIGO IAM（クロスプラットフォームID認証サービス）を正式リリース。ServerlessアーキテクチャでOAuth連携と多拠点認証を実現。","val1_title":"要件優先","val1_text":"技術ではなく解決策を提供します。すべての機能は実際のビジネスニーズに対応し、無駄な複雑さはありません。","val2_title":"保守性","val2_text":"納品するコードは理解・拡張・保守しやすくなければなりません。技術的負債は作りません。","val3_title":"期限厳守","val3_text":"スケジュールは透明で、進捗はリアルタイムに共有。お客様を不安にさせません。","val4_title":"長期的な関係","val4_text":"リリース後も消えません。公開後の問題も同様に重要であり、保守と改善が本当のサービスです。","skill1_name":"フロントエンド","skill2_name":"バックエンド","skill3_name":"モバイルアプリ","skill4_name":"AI / 連携","skill5_name":"クラウド / DevOps","footer_contact_title":"お問い合わせ","member_center":"メンバーセンター","logout":"ログアウト"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"진행 과정","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_q":"프로젝트를 시작할 준비가 되셨나요?","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","login":"회원 로그인","status_open":"수주 중","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","ab_role":"풀스택 독립 개발자","ab_headline1":"요구사항을","ab_headline2":"실제로 작동하는 시스템으로","ab_desc":"시스템 설계, 맞춤 개발, AI 통합에 특화된 풀스택 독립 개발자입니다. 요구사항 정의부터 시스템 출시까지 원스톱 솔루션을 제공합니다.","ab_stat_projects":"완료 프로젝트","ab_stat_experience":"개발 경력","ab_stat_satisfaction":"고객 만족도","ab_cta":"협업 시작하기 →","section_history":"// 경력","section_values":"// 철학","section_values_sub":"모든 프로젝트에 대한 접근 방식","section_skills":"// 기술 스택","section_skills_sub":"사용 도구 및 기술","tl_2019":"프리랜서 시작. 주로 웹 디자인과 프론트엔드 개발 담당.","tl_2020":"백엔드 개발로 확장. 첫 기업용 관리 시스템 런칭.","tl_2021":"React Native 도입, iOS/Android 양 플랫폼 개발 수주 시작.","tl_2022":"AI 기술 통합, 다수의 ChatGPT 비즈니스 앱 납품.","tl_2023":"완료 프로젝트 50개 돌파, 시스템 통합 및 자동화에 집중.","tl_2024":"지속 성장, 실제 비즈니스 문제를 해결하는 디지털 시스템 구축에 집중.","tl_2025":"CHIYIGO IAM 정식 출시 — Serverless 아키텍처로 OAuth 소셜 로그인과 멀티사이트 인증 통합.","val1_title":"요구사항 우선","val1_text":"기술이 아닌 해결책을 제공합니다. 모든 기능은 실제 비즈니스 필요에 대응하며 불필요한 복잡성이 없습니다.","val2_title":"유지보수성","val2_text":"납품 코드는 이해·확장·유지보수가 쉬워야 합니다. 기술 부채를 만들지 않습니다.","val3_title":"납기 준수","val3_text":"일정은 투명하고 진행 상황은 실시간으로 공유합니다. 고객을 기다림 속에 불안하게 하지 않습니다.","val4_title":"장기적 관계","val4_text":"런칭 후 사라지지 않습니다. 출시 후 문제도 동일하게 중요하며, 유지보수와 반복 개선이 진정한 서비스입니다.","skill1_name":"프론트엔드","skill2_name":"백엔드","skill3_name":"모바일 앱","skill4_name":"AI / 통합","skill5_name":"클라우드 / DevOps","footer_contact_title":"연락하기","member_center":"회원 센터","logout":"로그아웃"}};
let curLangI = localStorage.getItem('lang') || 'zh-TW';
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLangI = lang;
  const t = LANGS_I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k]; });
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
document.addEventListener('click', () => langDropI?.classList.remove('open'));
langDropI?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDropI.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); });
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLangI(curLangI);

// ── Reveal animation ──────────────────────────────────────
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ── Timeline staggered reveal ──────────────────────────────
const tlWrap = document.getElementById('ab-timeline');
if (tlWrap) {
  const tlRoot = window.innerWidth > 768 ? osContent : null;
  const tlObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        tlWrap.querySelectorAll('.tl-row').forEach((row, i) => {
          setTimeout(() => row.classList.add('revealed'), i * 80);
        });
        tlObs.unobserve(e.target);
      }
    });
  }, { root: tlRoot, threshold: 0.1 });
  tlObs.observe(tlWrap);
}

// ── block 2/2 ──
(function(){
  const canvas=document.getElementById('neural-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  let W=0,H=0,nodes=[];const DIST=155;
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
  function initNodes(){const n=W<768?48:115;nodes=Array.from({length:n},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.1+.4,pulse:Math.random()*Math.PI*2}))}
  const mouse={x:-9999,y:-9999};document.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});
  let cfg={r:'108',g:'110',b:'229',no:.22,lo:.09};
  function syncCfg(){const s=getComputedStyle(document.documentElement);cfg={r:s.getPropertyValue('--neural-r').trim()||'108',g:s.getPropertyValue('--neural-g').trim()||'110',b:s.getPropertyValue('--neural-b').trim()||'229',no:parseFloat(s.getPropertyValue('--neural-node-opacity').trim()||'.22'),lo:parseFloat(s.getPropertyValue('--neural-line-opacity').trim()||'.09')}}
  syncCfg();new MutationObserver(syncCfg).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  function draw(){ctx.clearRect(0,0,W,H);const{r,g,b,no,lo}=cfg;
    for(const n of nodes){const dx=n.x-mouse.x,dy=n.y-mouse.y,d2=dx*dx+dy*dy;if(d2<16900){const d=Math.sqrt(d2);n.vx+=dx/d*.055;n.vy+=dy/d*.055}n.vx*=.982;n.vy*=.982;n.x+=n.vx;n.y+=n.vy;if(n.x<-12)n.x=W+12;else if(n.x>W+12)n.x=-12;if(n.y<-12)n.y=H+12;else if(n.y>H+12)n.y=-12;n.pulse+=.011;const p=Math.sin(n.pulse)*.25+.75;ctx.beginPath();ctx.arc(n.x,n.y,n.r*p,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},${no*p})`;ctx.fill()}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=dx*dx+dy*dy;if(d2<DIST*DIST){const a=(1-Math.sqrt(d2)/DIST)*lo;ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.strokeStyle=`rgba(${r},${g},${b},${a})`;ctx.lineWidth=.5;ctx.stroke()}}
    requestAnimationFrame(draw)}
  resize();initNodes();draw();window.addEventListener('resize',()=>{resize();initNodes()});
})();

// ── Phase C-3 m-lang-btn wire ──
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);
