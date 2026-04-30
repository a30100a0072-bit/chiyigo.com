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

// ── Drag-to-close ──────────────────────────────────────────
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

// ── i18n（共用導覽 / footer + 頁面內容）──────────
const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","cta_q":"準備好開始專案了嗎？","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","login":"會員登入","status_open":"接案中","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","footer_contact_title":"聯絡我們","cs_badge":"系統案例 · 活動互動","cs_h1_a":"把音樂會現場，","cs_h1_b":"變成觀眾的互動舞台","cs_hero_desc":"觀眾入場配戴 NFC 手環，主持人後台一鍵切換互動模式，全場即時抽獎逐位揭曉、任務智慧分配。不需下載 App，不需操作手冊，掃描手環就進場，現場氣氛由你掌控。","cs_hero_btn1":"為您的活動規劃互動方案","cs_hero_btn2":"查看功能","cs_pain_label":"活動主辦常見困擾","cs_pain_h2":"現場互動，說難不難，但容易出亂子","cs_pain1_t":"互動橋段難以協調","cs_pain1_d":"主持人要同時顧台上節目、呼叫工作人員、確認觀眾反應，現場一忙起來互動橋段很容易走樣。","cs_pain2_t":"抽獎缺乏公信力","cs_pain2_d":"現場抽號碼牌或舉手投票，容易被質疑不公平，觀眾對結果缺乏信任感，現場反應冷淡。","cs_pain3_t":"任務分配耗費人力","cs_pain3_d":"需要把觀眾分成不同任務組，靠工作人員口頭通知費時費力，觀眾也常搞不清楚自己要做什麼。","cs_pain4_t":"觀眾不知道該做什麼","cs_pain4_d":"主持人在台上說，觀眾在台下聽不清楚或忘記，互動指令無法精準傳達到每一位觀眾手中。","cs_sol_label":"我們的做法","cs_sol_h2":"一套系統，主持人一鍵掌控全場","cs_sol_lead":"把互動指令直接推送到每一位觀眾的手機上，主持人不用開口，觀眾已知道該做什麼。","cs_sol1_t":"手環取代傳統抽籤道具","cs_sol1_d":"觀眾入場時配戴 NFC 手環，感應後自動完成報到並進入互動系統，不需輸入資料、不需下載 App。","cs_sol2_t":"後台切換即全場同步","cs_sol2_d":"主持人後台一鍵切換互動模式，所有觀眾的手機畫面幾秒內同步變換，現場節奏完全在主持人手上。","cs_sol3_t":"逐位揭曉製造現場張力","cs_sol3_d":"抽獎結果由主持人逐一揭曉，中獎者手機才亮起，第三位揭曉瞬間全場同步顯示結果，驚喜感最大化。","cs_sol4_t":"任務指令直達觀眾手機","cs_sol4_d":"系統自動按比例分配三種任務，每位觀眾的手機直接顯示專屬指令，不再靠工作人員逐一通知。","cs_feat_label":"系統功能","cs_feat_h2":"四個互動模式，現場流程全覆蓋","cs_feat1_t":"NFC 手環走到底","cs_feat1_d":"手環不只可以報到，觀眾感應後還可以進入互動系統。主持人切換模式，手機畫面跟著變；不需換連結，不需重新感應。","cs_feat2_t":"即時抽獎逐位揭曉","cs_feat2_d":"全場抽出 3 位，主持人按下揭曉後中獎者手機即時顯示，第三位揭曉瞬間其餘所有人同步看到結果，抽獎過程完全透明、現場反應最強烈。","cs_feat3_t":"任務智慧分配","cs_feat3_d":"主持人一鍵按下，系統自動洗牌分配三種任務：打拍子、搖手電筒、傳遞快樂。每位觀眾手機直接顯示專屬指令，不再靠廣播通知。","cs_feat4_t":"主持人後台遙控器","cs_feat4_d":"完全針對 iPhone 單手操作設計，大按鈕、Tab 切換、重要操作二次確認。抽獎可逐位揭曉、單獨重抽，任務可一鍵重新分配，現場突發狀況都能應對。","cs_proc_label":"導入步驟","cs_proc_h2":"四步驟，活動互動就緒","cs_proc_lead":"從名單建立到活動當天，整個準備流程清楚分工，不需現場臨時應變。","cs_proc1_t":"建立觀眾名單，燒錄 NFC 手環","cs_proc1_d":"上傳觀眾名單後，系統自動為每位觀眾產生唯一識別碼，並寫入 NFC 手環網址。每條手環對應一個座位，方便現場對號入座。","cs_proc2_t":"入場時發放手環，感應即報到","cs_proc2_d":"觀眾入場領取手環，感應後自動完成報到並進入系統待機畫面，顯示節目單導聆。整個流程不需工作人員逐一操作，一人即可顧好整個入場動線。","cs_proc3_t":"活動進行中，主持人一鍵切換模式","cs_proc3_d":"到抽獎環節，後台切換至「抽獎模式」，全場手機畫面同步變換。抽出名單後，主持人逐位揭曉，現場製造最大張力。到任務環節，一鍵分配，每位觀眾手機即時顯示專屬任務。","cs_proc4_t":"活動結束，中獎紀錄自動歸檔","cs_proc4_d":"抽獎結果自動同步寫回 Google 試算表，中獎者座位與識別碼完整留存，方便事後核對與禮品發送，不需手動整理。","cs_trust_label":"為什麼可以信任這套系統","cs_trust_h2":"現場活動，容不下任何意外","cs_trust1_t":"觀眾無需下載 App","cs_trust1_d":"感應手環即開啟網頁，Android 與 iPhone 均支援，不受裝置限制，不怕觀眾說「我不會下載」。","cs_trust2_t":"3 秒內全場畫面同步","cs_trust2_d":"系統採用動態輪詢策略，互動模式下 3 秒更新一次，確保主持人按下去的那一刻，全場觀眾幾乎同時看到畫面變化。","cs_trust3_t":"支援千人同時在線","cs_trust3_d":"後端架設在 Cloudflare 全球邊緣網路，天生支援高並發，千人同時輪詢狀態也不卡頓。","cs_trust4_t":"後台防呆，現場不誤觸","cs_trust4_d":"模式切換有二次確認彈窗，重要操作需長按確認，讓主持人在台上緊張操作時也不怕手殘按錯。","cs_cta_title":"想為您的活動加入互動體驗？","cs_cta_text":"告訴我們您的活動規模與互動需求，我們提供客製化評估，從場景設計到系統部署全程支援。","cs_cta_btn1":"立即諮詢","cs_cta_btn2":"查看更多案例"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","cta_q":"Ready to Start a Project?","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","login":"Member Login","status_open":"Open for Work","tooltip_theme":"Toggle Theme","tooltip_lang":"Switch Language","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","footer_contact_title":"Contact Us","cs_badge":"Case Study · Live Interaction","cs_h1_a":"Turn your concert","cs_h1_b":"into an interactive stage.","cs_hero_desc":"Audience members wear NFC wristbands; the host switches interaction modes from a single dashboard. Live drawings reveal winners one by one, tasks are smartly distributed — no app, no manual, just tap and play.","cs_hero_btn1":"Plan Interaction for Your Event","cs_hero_btn2":"See Features","cs_pain_label":"Common pain points for organizers","cs_pain_h2":"On-site interaction — easy in theory, messy in practice","cs_pain1_t":"Interaction segments are hard to coordinate","cs_pain1_d":"Hosts juggle the show, the staff, and audience reactions all at once — the moment things get busy, interactive segments fall apart.","cs_pain2_t":"Drawings lack credibility","cs_pain2_d":"Paper tickets or hand-raising votes invite fairness complaints — audiences distrust the result and the room goes flat.","cs_pain3_t":"Task assignment drains manpower","cs_pain3_d":"Splitting the crowd into task groups by word of mouth takes time and energy, and audiences still get confused about what to do.","cs_pain4_t":"Audiences don't know what to do","cs_pain4_d":"Hosts give instructions on stage, but the audience can't always hear or remember them — directions never reach everyone clearly.","cs_sol_label":"Our approach","cs_sol_h2":"One system. The host runs the whole room with a tap.","cs_sol_lead":"Push instructions straight to every audience member's phone — the host doesn't need to say a word for the audience to know what to do.","cs_sol1_t":"Wristbands replace lottery props","cs_sol1_d":"Audiences wear an NFC wristband at the door — one tap checks them in and unlocks the interactive flow. No forms, no apps.","cs_sol2_t":"Switch a mode, the whole room follows","cs_sol2_d":"When the host flips a mode, every audience phone updates within seconds — the pace of the room stays in the host's hands.","cs_sol3_t":"Reveal one-by-one for max suspense","cs_sol3_d":"Winners are revealed one at a time — only the chosen phone lights up. The third reveal flashes the result to the entire room at once.","cs_sol4_t":"Tasks delivered straight to phones","cs_sol4_d":"The system auto-distributes three task types in proportion; each phone shows its own instruction — no more relay-by-staff.","cs_feat_label":"System features","cs_feat_h2":"Four interaction modes that cover every part of the event","cs_feat1_t":"NFC wristband, end to end","cs_feat1_d":"The wristband is more than a check-in — once tapped, it carries the audience through every interaction mode. No new links, no re-tapping.","cs_feat2_t":"Live drawing, one-by-one reveal","cs_feat2_d":"Three winners are drawn from the room. The host reveals each in turn — only that winner's phone lights up. At the third reveal, the result flashes to everyone. Fully transparent, maximally dramatic.","cs_feat3_t":"Smart task distribution","cs_feat3_d":"One tap and the system shuffles three tasks across the room — clap the beat, wave the flashlight, pass the joy. Each phone displays its own instruction; no more PA announcements.","cs_feat4_t":"Host dashboard, made for one hand","cs_feat4_d":"Designed for one-handed iPhone use: big buttons, tab navigation, double-confirm on critical actions. Reveal winners one at a time, redraw individually, redistribute tasks in one tap — built to handle anything that goes sideways.","cs_proc_label":"Onboarding steps","cs_proc_h2":"Four steps to ready your interactive event","cs_proc_lead":"From building the guest list to the day of the event, every step is well-defined — no scrambling on-site.","cs_proc1_t":"Build the audience list, write the wristbands","cs_proc1_d":"Upload the audience list and the system generates a unique ID per attendee and writes the URL onto each wristband. One band per seat, ready for assigned seating.","cs_proc2_t":"Hand out wristbands at the door — tap to check in","cs_proc2_d":"Audiences pick up a wristband at entry; one tap checks them in and lands them on a standby screen with the program guide. One staffer can run the whole entry line.","cs_proc3_t":"During the show, the host switches modes with a tap","cs_proc3_d":"When it's time for the drawing, switch to \"Drawing Mode\" — every phone in the room updates at once. The host reveals winners one by one for maximum tension. For task moments, one tap distributes — each phone shows its assignment instantly.","cs_proc4_t":"After the show, results are auto-archived","cs_proc4_d":"Drawing results sync back to a Google Sheet automatically — winner seats and IDs are kept intact for reconciliation and prize delivery. No manual cleanup.","cs_trust_label":"Why this system holds up live","cs_trust_h2":"Live events leave no room for surprises","cs_trust1_t":"No app for the audience","cs_trust1_d":"Tap the wristband, open the web page — works on both Android and iPhone. No device lock-in, no \"I don't know how to download\".","cs_trust2_t":"Whole-room sync in 3 seconds","cs_trust2_d":"A dynamic polling strategy refreshes every 3 seconds in interaction mode — when the host taps, the whole room sees it almost simultaneously.","cs_trust3_t":"Built for thousand-person crowds","cs_trust3_d":"The backend runs on Cloudflare's global edge — high concurrency is the default. A thousand simultaneous polls won't slow it down.","cs_trust4_t":"Foolproof dashboard for live use","cs_trust4_d":"Mode switches require a confirmation modal; critical actions need a long-press to confirm — even nervous taps on stage won't fire the wrong thing.","cs_cta_title":"Want to bring this kind of interaction to your event?","cs_cta_text":"Tell us your event size and what you want the audience to feel — we'll do a custom assessment, from scene design to deployment, end to end.","cs_cta_btn1":"Get in Touch","cs_cta_btn2":"See More Cases"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"開発プロセス","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_q":"プロジェクトを始めませんか？","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","login":"ログイン","status_open":"受注中","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","footer_contact_title":"お問い合わせ","cs_badge":"事例 · ライブインタラクション","cs_h1_a":"コンサート会場を、","cs_h1_b":"観客が参加する舞台に","cs_hero_desc":"観客はNFCリストバンドを装着し、司会者はダッシュボードからワンタップでモード切替。抽選結果は一人ずつ発表、タスクは自動配分。アプリ不要、マニュアル不要、タップだけで参加。","cs_hero_btn1":"イベント企画を相談","cs_hero_btn2":"機能を見る","cs_pain_label":"主催者がよく抱える悩み","cs_pain_h2":"現場のインタラクションは、簡単そうで意外と乱れやすい","cs_pain1_t":"インタラクションの段取りが難しい","cs_pain1_d":"司会者は進行・スタッフ・観客対応を同時にこなすため、忙しくなるとインタラクションが崩れがちです。","cs_pain2_t":"抽選の公平性に疑問","cs_pain2_d":"紙のチケットや挙手投票は不公平を疑われやすく、観客の信頼を得にくく、会場の反応も冷めがち。","cs_pain3_t":"タスク配布に人手を取られる","cs_pain3_d":"観客をグループに分けて口頭で伝える方法は時間も人手もかかり、観客側も混乱しがちです。","cs_pain4_t":"観客が何をすべきか分からない","cs_pain4_d":"司会者が舞台で説明しても、観客には届きづらく忘れられがちで、指示を全員に正確に届けられません。","cs_sol_label":"私たちのアプローチ","cs_sol_h2":"一つのシステム、ワンタップで会場全体を掌握","cs_sol_lead":"指示は観客全員のスマホに直接プッシュ、司会者が話さなくても観客は何をすべきか分かります。","cs_sol1_t":"リストバンドが従来の抽選道具を代替","cs_sol1_d":"入場時にNFCリストバンドを装着、タップだけでチェックインしてインタラクションへ。入力もアプリも不要。","cs_sol2_t":"管理画面で切替、会場全体が同期","cs_sol2_d":"司会者がモードを切り替えると、観客全員のスマホ画面が数秒で同期。テンポは完全にコントロール下。","cs_sol3_t":"一人ずつ発表で会場のテンションMAX","cs_sol3_d":"当選者は一人ずつ発表、当選者のスマホだけが点灯。3人目が発表された瞬間、全観客に同時表示。","cs_sol4_t":"タスク指示は観客のスマホへ直送","cs_sol4_d":"システムが3種類のタスクを自動配分、各スマホに個別指示を表示。スタッフの一斉伝達は不要。","cs_feat_label":"システム機能","cs_feat_h2":"4つのインタラクションモードで現場フロー全網羅","cs_feat1_t":"NFCリストバンド一本で完結","cs_feat1_d":"リストバンドはチェックインだけでなく、タップ後はインタラクション全モードに対応。リンク変更も再タップも不要。","cs_feat2_t":"ライブ抽選、一人ずつ発表","cs_feat2_d":"会場から3人を抽選。司会者が発表すると当選者のスマホだけ点灯、3人目発表の瞬間に全員へ同時表示。完全透明で盛り上がり最大。","cs_feat3_t":"タスクの自動配分","cs_feat3_d":"ワンタップで3種類のタスク（手拍子・ライト振り・幸せをつなぐ）を自動シャッフル。各スマホに個別指示。","cs_feat4_t":"司会者用ダッシュボード、片手操作","cs_feat4_d":"iPhone片手操作専用設計。大きなボタン、タブ切替、重要操作は二重確認。一人ずつ発表・個別再抽選・タスク再配分にもワンタップ対応。","cs_proc_label":"導入ステップ","cs_proc_h2":"4ステップでインタラクティブな本番準備完了","cs_proc_lead":"名簿作成から当日まで、準備の役割分担が明確。当日対応に追われません。","cs_proc1_t":"観客名簿を作成、NFCリストバンドに書込","cs_proc1_d":"観客名簿をアップロードすると、各観客にユニークIDを自動生成し、リストバンドにURLを書込。一つのバンドが一席に対応。","cs_proc2_t":"入場時にリストバンドを配布、タップでチェックイン","cs_proc2_d":"入場時にリストバンドを配布、タップでチェックイン完了し、待機画面と公演ガイドを表示。スタッフ一人で導線全体を捌けます。","cs_proc3_t":"公演中、司会者がワンタップでモード切替","cs_proc3_d":"抽選パートでは「抽選モード」に切替、会場全体が同期。当選者を一人ずつ発表しテンションMAX。タスクはワンタップで配分、各スマホに即時表示。","cs_proc4_t":"終了後、当選記録は自動アーカイブ","cs_proc4_d":"抽選結果はGoogleスプレッドシートに自動連携、当選者の座席とIDが完全保存され、後の照合や賞品発送が容易。","cs_trust_label":"なぜこのシステムを信頼できるか","cs_trust_h2":"ライブ会場に「想定外」の余地はない","cs_trust1_t":"観客はアプリ不要","cs_trust1_d":"リストバンドをタップでWebが開く、Android・iPhone両対応。「ダウンロードできない」も心配無用。","cs_trust2_t":"3秒以内に会場全体が同期","cs_trust2_d":"動的ポーリングでインタラクション中は3秒ごとに更新、司会者の操作とほぼ同時に全観客に反映。","cs_trust3_t":"千人同時接続にも対応","cs_trust3_d":"バックエンドはCloudflareのグローバルエッジ上、高並列処理が標準仕様。千人同時でも遅延なし。","cs_trust4_t":"誤操作防止のダッシュボード","cs_trust4_d":"モード切替は二重確認、重要操作は長押し必須。緊張下の誤操作も防止。","cs_cta_title":"あなたのイベントにこのインタラクションを？","cs_cta_text":"規模とご要望をお聞かせください、シーン設計からシステム導入まで、カスタム提案でフル支援します。","cs_cta_btn1":"今すぐ相談","cs_cta_btn2":"他の事例を見る"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"진행 과정","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_q":"프로젝트를 시작할 준비가 되셨나요?","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","login":"회원 로그인","status_open":"수주 중","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","footer_contact_title":"연락하기","cs_badge":"사례 · 라이브 인터랙션","cs_h1_a":"콘서트 현장을,","cs_h1_b":"관객 참여 무대로","cs_hero_desc":"관객은 NFC 손목밴드를 착용하고, 진행자는 대시보드에서 한 번에 모드를 전환합니다. 추첨은 한 명씩 공개, 과제는 자동 배분 — 앱 다운로드도 매뉴얼도 필요 없습니다.","cs_hero_btn1":"이벤트 인터랙션 상담","cs_hero_btn2":"기능 보기","cs_pain_label":"주최자가 흔히 겪는 문제","cs_pain_h2":"현장 인터랙션 — 쉬워 보여도 쉽게 흐트러집니다","cs_pain1_t":"인터랙션 진행 조율이 어려움","cs_pain1_d":"진행자는 무대·스태프·관객 반응을 동시에 챙겨야 해, 바빠지면 인터랙션이 무너지기 쉽습니다.","cs_pain2_t":"추첨의 공정성 의심","cs_pain2_d":"종이 추첨이나 거수 투표는 공정성 의심을 받기 쉽고, 관객이 결과를 신뢰하지 못해 분위기가 식습니다.","cs_pain3_t":"과제 배분에 인력 낭비","cs_pain3_d":"관객을 조별로 나눠 말로 전달하면 시간과 인력이 들고, 관객도 자신이 무엇을 해야 하는지 헷갈립니다.","cs_pain4_t":"관객이 무엇을 해야 할지 모름","cs_pain4_d":"진행자가 무대에서 안내해도 관객이 잘 듣지 못하거나 잊어버려, 지시가 모든 관객에게 정확히 전달되지 않습니다.","cs_sol_label":"우리의 방식","cs_sol_h2":"하나의 시스템, 진행자가 한 번의 클릭으로 전체 통제","cs_sol_lead":"지시를 관객 전원의 휴대폰으로 직접 전송 — 진행자가 말하지 않아도 관객이 행동할 수 있습니다.","cs_sol1_t":"손목밴드가 기존 추첨 도구를 대체","cs_sol1_d":"입장 시 NFC 손목밴드를 착용 — 태그 한 번으로 체크인과 인터랙션 진입. 입력도 앱도 필요 없습니다.","cs_sol2_t":"관리자 전환 즉시 전체 동기화","cs_sol2_d":"진행자가 모드를 전환하면 관객 전원의 화면이 몇 초 내에 동기화 — 진행 템포를 완벽히 장악합니다.","cs_sol3_t":"한 명씩 공개해 긴장감 극대화","cs_sol3_d":"당첨자를 한 명씩 공개해 당첨자의 화면만 켜집니다. 세 번째 공개 순간 전체 관객에게 동시 표시됩니다.","cs_sol4_t":"과제 지시를 관객 휴대폰으로 직접 전달","cs_sol4_d":"시스템이 세 종류의 과제를 자동 비율 배분 — 각 휴대폰에 전용 지시 표시, 스태프가 일일이 전달할 필요 없음.","cs_feat_label":"시스템 기능","cs_feat_h2":"네 가지 인터랙션 모드, 현장 전 과정을 커버","cs_feat1_t":"NFC 손목밴드 하나로 끝","cs_feat1_d":"손목밴드는 체크인만이 아니라 태그 후 모든 인터랙션 모드까지 이어집니다. 새 링크도 재태그도 필요 없습니다.","cs_feat2_t":"실시간 추첨, 한 명씩 공개","cs_feat2_d":"전체 관객 중 3명 추첨. 진행자가 한 명씩 공개하면 당첨자 화면만 켜지고, 세 번째 공개 순간 전원에게 동시 표시. 완전 투명하고 임팩트 최대.","cs_feat3_t":"스마트 과제 배분","cs_feat3_d":"한 번의 탭으로 세 가지 과제(박수·플래시 흔들기·행복 전달)를 자동 섞어 배분. 각 휴대폰에 개별 지시 표시.","cs_feat4_t":"진행자 대시보드, 한 손 조작","cs_feat4_d":"iPhone 한 손 조작 전용 설계. 큰 버튼·탭 전환·중요 작업 이중 확인. 한 명씩 공개·개별 재추첨·과제 재배분도 한 번의 탭.","cs_proc_label":"도입 단계","cs_proc_h2":"네 단계로 인터랙티브 이벤트 준비 완료","cs_proc_lead":"명단 작성부터 행사 당일까지 역할 분담이 명확 — 현장에서 허둥대지 않습니다.","cs_proc1_t":"관객 명단 작성, NFC 손목밴드에 기록","cs_proc1_d":"관객 명단을 업로드하면 각 관객에게 고유 ID가 자동 생성되어 손목밴드 URL이 기록됩니다. 손목밴드 하나가 좌석 하나에 대응.","cs_proc2_t":"입장 시 손목밴드 배포 — 태그하면 체크인","cs_proc2_d":"관객이 입장할 때 손목밴드를 받고 태그 한 번으로 체크인되어 대기 화면과 프로그램 가이드가 표시됩니다. 스태프 한 명이 전체 입장 동선을 운영 가능.","cs_proc3_t":"공연 중, 진행자가 한 번의 탭으로 모드 전환","cs_proc3_d":"추첨 시 \"추첨 모드\"로 전환하면 전체 화면이 동기화됩니다. 진행자가 한 명씩 공개해 임팩트를 극대화. 과제는 한 번의 탭으로 배분되고 각 화면에 즉시 표시됩니다.","cs_proc4_t":"행사 종료 후 당첨 기록 자동 보관","cs_proc4_d":"추첨 결과는 Google 스프레드시트에 자동 동기화되어 당첨자 좌석과 ID가 완벽히 보존됩니다. 사후 대조와 경품 발송이 손쉽고 수작업이 필요 없습니다.","cs_trust_label":"이 시스템을 신뢰할 수 있는 이유","cs_trust_h2":"현장 행사에는 의외 변수가 들어설 자리가 없습니다","cs_trust1_t":"관객은 앱 다운로드 불필요","cs_trust1_d":"손목밴드 태그로 웹 페이지가 열립니다. Android·iPhone 모두 지원, \"앱을 못 깔겠다\" 걱정 끝.","cs_trust2_t":"3초 이내 전체 화면 동기화","cs_trust2_d":"동적 폴링으로 인터랙션 모드에서는 3초마다 갱신 — 진행자의 조작과 거의 동시에 모든 관객 화면에 반영됩니다.","cs_trust3_t":"천 명 동시 접속 지원","cs_trust3_d":"백엔드는 Cloudflare 글로벌 엣지에서 작동해 고동시성이 기본 — 천 명이 동시에 폴링해도 느려지지 않습니다.","cs_trust4_t":"오작동 방지 대시보드","cs_trust4_d":"모드 전환은 이중 확인 팝업, 중요 작업은 길게 눌러 확인 — 무대 위 긴장 상태의 오조작도 방지합니다.","cs_cta_title":"이런 인터랙션을 행사에 도입하시겠어요?","cs_cta_text":"행사 규모와 인터랙션 요구를 알려주세요. 시나리오 설계부터 시스템 배포까지 맞춤 평가와 전 과정을 지원합니다.","cs_cta_btn1":"지금 상담","cs_cta_btn2":"더 많은 사례 보기"}};
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
