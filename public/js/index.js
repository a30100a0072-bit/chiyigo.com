// ── Theme ──
function syncThemeIcons() {
  const dark = document.documentElement.classList.contains('theme-dark')
  document.querySelectorAll('.icon-moon').forEach(el => el.style.display = dark ? '' : 'none')
  document.querySelectorAll('.icon-sun' ).forEach(el => el.style.display = dark ? 'none' : '')
}
function toggleTheme() {
  const html = document.documentElement
  const dark = html.classList.contains('theme-dark')
  html.classList.replace(dark ? 'theme-dark' : 'theme-light', dark ? 'theme-light' : 'theme-dark')
  localStorage.setItem('theme', dark ? 'light' : 'dark')
  syncThemeIcons()
  updateCanvasColors()
}
syncThemeIcons()
document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme)
document.getElementById('m-theme-btn')?.addEventListener('click', toggleTheme)

// ── i18n ──────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","cta_q":"準備好開始專案了嗎？","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","login":"會員登入","status_open":"接案中","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","hero_eyebrow":"客製化系統開發專家","hero_h1":"打造專屬於你的","hero_h2":"數位解決方案","hero_desc":"從需求釐清到系統上線，我們提供一站式客製化服務，協助企業提升效率、優化流程、創造更大價值。","hero_btn1":"探索解決方案 →","hero_btn2":"觀看案例 ▷","trust_projects":"完成專案","trust_satisfaction":"客戶滿意度","trust_experience":"開發經驗","svc_title":"服務項目","svc1_title":"網站設計","svc1_desc":"高效能靜態網站與 Serverless 後端，快速、安全、易於維護，讓第一印象成為持久印象。","svc2_title":"系統設計","svc2_desc":"從架構規劃到資料庫設計，打造穩健可擴展的系統，確保每個環節都對齊商業目標。","svc3_title":"AI 解決方案","svc3_desc":"將 AI 能力整合進你的工作流程，自動化重複任務，讓團隊專注在真正有價值的事情上。","svc4_title":"量化數據分析","svc4_desc":"以數據驅動決策，打通數據管道、建立儀表板，讓每個商業決策都有根據。","svc5_title":"App 設計","svc5_desc":"iOS / Android 原生體驗設計，從線框圖到互動原型，確保產品上線即可用。","svc6_title":"企業應用整合","svc6_desc":"串接 ERP、CRM、電商平台等既有系統，消弭資料孤島，提升整體營運效率。","process_title":"服務流程","proc1_title":"需求溝通","proc1_desc":"深入了解你的業務目標與痛點，制定清晰的專案藍圖與成功標準。","proc2_title":"策略規劃","proc2_desc":"結合設計美學與技術實踐，提供完整的執行方案、技術選型與時程規劃。","proc3_title":"落地執行","proc3_desc":"高效開發與設計，確保每個細節都對齊商業目標，準時交付可用的系統。","cta_badge":"接受新專案中","cta_title":"準備好開始了嗎？","cta_main_sub":"告訴我們你的需求，我們在 48 小時內回覆。","feat1":"免費初步諮詢","feat2":"48 小時內回覆","feat3":"客製化解決方案","cta_action_btn":"立即提交需求 →","action_note":"無需簽約承諾","footer_contact_title":"聯絡我們","member_center":"會員中心","logout":"登出"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","cta_q":"Ready to Start a Project?","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","login":"Member Login","status_open":"Open for Work","tooltip_theme":"Toggle Theme","tooltip_lang":"Switch Language","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","hero_eyebrow":"Custom System Development Expert","hero_h1":"Build Your Exclusive","hero_h2":"Digital Solution","hero_desc":"From requirements to launch, we provide one-stop custom services to help businesses boost efficiency, optimize processes, and create greater value.","hero_btn1":"Explore Solutions →","hero_btn2":"View Cases ▷","trust_projects":"Projects Done","trust_satisfaction":"Client Satisfaction","trust_experience":"Dev Experience","svc_title":"Services","svc1_title":"Web Design","svc1_desc":"High-performance static sites with Serverless backend — fast, secure, and maintainable, making first impressions last.","svc2_title":"System Design","svc2_desc":"From architecture to database design, we build robust, scalable systems aligned with your business goals.","svc3_title":"AI Solutions","svc3_desc":"Integrate AI into your workflow to automate repetitive tasks and let your team focus on what truly matters.","svc4_title":"Data Analytics","svc4_desc":"Data-driven decisions through connected pipelines and dashboards — every business choice backed by evidence.","svc5_title":"App Design","svc5_desc":"Native iOS / Android experience design, from wireframes to interactive prototypes, ready to ship.","svc6_title":"Enterprise Integration","svc6_desc":"Connect ERP, CRM, and e-commerce platforms to eliminate data silos and boost operational efficiency.","process_title":"Our Process","proc1_title":"Requirements","proc1_desc":"Deep-dive into your business goals and pain points to define a clear project blueprint and success criteria.","proc2_title":"Strategy","proc2_desc":"Combine design aesthetics with technical best practices to deliver a complete plan, tech stack, and timeline.","proc3_title":"Execution","proc3_desc":"Efficient development and design, aligning every detail with business goals and delivering on time.","cta_badge":"Open for New Projects","cta_title":"Ready to Start?","cta_main_sub":"Tell us your needs — we reply within 48 hours.","feat1":"Free Initial Consultation","feat2":"Reply Within 48 Hours","feat3":"Custom-Tailored Solutions","cta_action_btn":"Submit Your Request →","action_note":"No commitment required","footer_contact_title":"Contact Us","member_center":"Member Center","logout":"Sign Out"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"開発プロセス","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_q":"プロジェクトを始めませんか？","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","login":"ログイン","status_open":"受注中","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","hero_eyebrow":"カスタムシステム開発のエキスパート","hero_h1":"あなた専用の","hero_h2":"デジタルソリューションを","hero_desc":"要件定義からシステム稼働まで、ワンストップのカスタムサービスで企業の効率化・プロセス最適化・価値創造を支援します。","hero_btn1":"ソリューションを探る →","hero_btn2":"事例を見る ▷","trust_projects":"完了案件","trust_satisfaction":"顧客満足度","trust_experience":"開発経験","svc_title":"サービス","svc1_title":"Webデザイン","svc1_desc":"高性能な静的サイトとServerlessバックエンドで、速く・安全・保守しやすいウェブサイトを実現します。","svc2_title":"システム設計","svc2_desc":"アーキテクチャ設計からDB設計まで、ビジネス目標に沿った堅牢でスケーラブルなシステムを構築します。","svc3_title":"AIソリューション","svc3_desc":"AIをワークフローに統合し、繰り返し作業を自動化。チームが本当に重要なことに集中できます。","svc4_title":"データ分析","svc4_desc":"データパイプラインとダッシュボードで意思決定をデータドリブンに。すべてのビジネス判断に根拠を。","svc5_title":"アプリ設計","svc5_desc":"iOS/Androidネイティブ体験設計。ワイヤーフレームからインタラクティブプロトタイプまで対応します。","svc6_title":"システム連携","svc6_desc":"ERP・CRM・ECプラットフォームを連携し、データサイロを解消して業務効率を向上させます。","process_title":"開発プロセス","proc1_title":"要件定義","proc1_desc":"ビジネス目標と課題を深く理解し、明確なプロジェクト計画と成功基準を策定します。","proc2_title":"戦略立案","proc2_desc":"デザインと技術を融合し、完全な実行計画・技術選定・スケジュールを提供します。","proc3_title":"実装・納品","proc3_desc":"効率的な開発・デザインで、すべての細部をビジネス目標に沿わせ、期限通りに納品します。","cta_badge":"新規案件受付中","cta_title":"始める準備はできましたか？","cta_main_sub":"ご要望をお聞かせください。48 時間以内に返信します。","feat1":"無料初回相談","feat2":"48時間以内返信","feat3":"カスタムソリューション","cta_action_btn":"今すぐ依頼する →","action_note":"契約不要","footer_contact_title":"お問い合わせ","member_center":"メンバーセンター","logout":"ログアウト"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"진행 과정","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_q":"프로젝트를 시작할 준비가 되셨나요?","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","login":"회원 로그인","status_open":"수주 중","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","hero_eyebrow":"맞춤형 시스템 개발 전문가","hero_h1":"당신만을 위한","hero_h2":"디지털 솔루션 구축","hero_desc":"요구사항 정의부터 시스템 출시까지, 원스톱 맞춤 서비스로 기업의 효율 향상, 프로세스 최적화, 가치 창출을 지원합니다.","hero_btn1":"솔루션 탐색 →","hero_btn2":"사례 보기 ▷","trust_projects":"완료 프로젝트","trust_satisfaction":"고객 만족도","trust_experience":"개발 경력","svc_title":"서비스","svc1_title":"웹 디자인","svc1_desc":"고성능 정적 사이트와 Serverless 백엔드로 빠르고 안전하며 유지보수하기 쉬운 웹사이트를 제공합니다.","svc2_title":"시스템 설계","svc2_desc":"아키텍처 설계부터 DB 설계까지, 비즈니스 목표에 맞는 견고하고 확장 가능한 시스템을 구축합니다.","svc3_title":"AI 솔루션","svc3_desc":"AI를 워크플로에 통합해 반복 작업을 자동화하고, 팀이 진짜 중요한 일에 집중할 수 있게 합니다.","svc4_title":"데이터 분석","svc4_desc":"데이터 파이프라인과 대시보드로 데이터 기반 의사결정을 실현합니다.","svc5_title":"앱 디자인","svc5_desc":"iOS/Android 네이티브 경험 설계. 와이어프레임부터 인터랙티브 프로토타입까지 대응합니다.","svc6_title":"엔터프라이즈 통합","svc6_desc":"ERP, CRM, 이커머스 플랫폼을 연동해 데이터 사일로를 없애고 운영 효율을 높입니다.","process_title":"진행 과정","proc1_title":"요구사항 파악","proc1_desc":"비즈니스 목표와 핵심 과제를 파악해 명확한 프로젝트 청사진과 성공 기준을 수립합니다.","proc2_title":"전략 수립","proc2_desc":"디자인 미학과 기술을 결합해 완전한 실행 방안, 기술 선택, 일정을 제공합니다.","proc3_title":"개발 & 납품","proc3_desc":"효율적인 개발과 디자인으로 모든 세부 사항을 비즈니스 목표에 맞추고 제때 납품합니다.","cta_badge":"새 프로젝트 수주 중","cta_title":"시작할 준비가 되셨나요?","cta_main_sub":"필요한 것을 알려주세요 — 48시간 내에 답변드립니다.","feat1":"무료 초기 상담","feat2":"48시간 내 답변","feat3":"맞춤형 솔루션","cta_action_btn":"지금 의뢰하기 →","action_note":"계약 불필요","footer_contact_title":"연락하기","member_center":"회원 센터","logout":"로그아웃"}};
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
// Mobile topbar lang dropdown
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLangI(curLangI);

// ── Mobile overlay ──
function toggleOverlay() {
  const ov  = document.getElementById('m-overlay')
  const btn = document.getElementById('m-ham-btn')
  const open = ov.classList.contains('is-open')
  if (open) closeOverlay()
  else {
    ov.classList.add('is-open')
    btn.classList.add('is-open')
    btn.setAttribute('aria-expanded','true')
    document.body.style.overflow = 'hidden'
  }
}
function closeOverlay() {
  const ov  = document.getElementById('m-overlay')
  const btn = document.getElementById('m-ham-btn')
  ov.classList.remove('is-open')
  btn.classList.remove('is-open')
  btn.setAttribute('aria-expanded','false')
  document.body.style.overflow = ''
}
function handleOverlayClick(e) {
  if (e.target === document.getElementById('m-overlay')) closeOverlay()
}
document.getElementById('m-ham-btn')?.addEventListener('click', toggleOverlay)
document.getElementById('m-overlay')?.addEventListener('click', handleOverlayClick)
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('m-overlay')?.classList.contains('is-open')) closeOverlay() })

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

// ── Scroll reveal ──
const revealObs = new IntersectionObserver(
  es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('revealed'); revealObs.unobserve(e.target) } }),
  { threshold: 0.1 }
)
document.querySelectorAll('[data-reveal]').forEach(el => revealObs.observe(el))

// ── Sidebar active ──
const sectionObs = new IntersectionObserver(
  es => es.forEach(e => {
    if (!e.isIntersecting) return
    document.querySelectorAll('#sidebar-nav .sb-item[data-section]').forEach(a => a.classList.remove('active'))
    const hit = document.querySelector(`#sidebar-nav [data-section="${e.target.id}"]`)
    if (hit) hit.classList.add('active')
  }),
  { threshold: 0.45 }
)
;['hero','services','process','cta'].forEach(id => { const el = document.getElementById(id); if(el) sectionObs.observe(el) })

// ── Neural canvas ──
const cvs = document.getElementById('neural-canvas')
const ctx = cvs.getContext('2d')
const NODES=55, MAXDIST=145, SPEED=0.28, pts=[]
let cc={}
function updateCanvasColors() {
  const s = getComputedStyle(document.documentElement)
  cc = { r: s.getPropertyValue('--neural-r').trim()||'108', g: s.getPropertyValue('--neural-g').trim()||'110', b: s.getPropertyValue('--neural-b').trim()||'229', node: parseFloat(s.getPropertyValue('--neural-node-opacity'))||0.22, line: parseFloat(s.getPropertyValue('--neural-line-opacity'))||0.09 }
}
function resizeCvs() { cvs.width=window.innerWidth; cvs.height=window.innerHeight }
function initPts() { pts.length=0; for(let i=0;i<NODES;i++) pts.push({x:Math.random()*cvs.width,y:Math.random()*cvs.height,vx:(Math.random()-.5)*SPEED*2,vy:(Math.random()-.5)*SPEED*2,r:Math.random()*1.5+1}) }
function draw() {
  ctx.clearRect(0,0,cvs.width,cvs.height)
  const {r,g,b,node:nop,line:lop}=cc
  for(const p of pts){ p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>cvs.width)p.vx*=-1; if(p.y<0||p.y>cvs.height)p.vy*=-1 }
  for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<MAXDIST){ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle=`rgba(${r},${g},${b},${lop*(1-d/MAXDIST)})`;ctx.lineWidth=0.75;ctx.stroke()}}
  for(const p of pts){ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},${nop})`;ctx.fill()}
  requestAnimationFrame(draw)
}
updateCanvasColors(); resizeCvs(); initPts(); draw()
window.addEventListener('resize',resizeCvs)

// ── Phase C-3 listener wiring ──
document.querySelectorAll('.m-ov-item, .m-ov-cta-btn').forEach(el => {
  el.addEventListener('click', closeOverlay)
})

// ── Phase C-3 m-lang-btn wire ──
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);
