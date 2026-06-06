// ── case-platform — CHIYIGO 會員系統 互動式架構 ──
// 同一支同時服務兩個入口：
//   - /case-platform.html（standalone）：完整跑全部（widget + hamburger + theme + neural canvas + lang dropdown）
//   - /index.html 嵌入區（embed）：只跑 widget；host 頁 index.js 處理 theme/lang/hamburger/canvas
// 用 DOM 偵測模式：`#cp-arch-embed` 存在 = embed。
//
// 整支必須包 IIFE：index.js / index.ts 也宣告了 top-level `const NODES`（neural canvas），
// 同 global scope 會 SyntaxError「Identifier 'NODES' has already been declared」。
// 教訓：feedback_embed_js_iife_wrap.md / [[feedback_stage5_page_entry_iife_required]]
//
// Stage 5 PR-5r (2026-05-22)：
//   - 原 .js 已天生 IIFE wrap（line 11/393）— Stage 5 不再加外層，沿用既有結構
//   - producer side `window.cpArchSetLang = ...` 走 WindowWithCpArchEmbed type-alias
//     cast pattern（per PR-5q index.ts 立樁的 WindowWithArchEmbed consumer side
//     反向對齊）；保留 optional property 讓 consumer load-order tolerant
//   - cleanup：移除 dead code `window.toggleTopLangDrop = toggleTopLangDrop`
//     （per [[project_js_to_ts_stage5_plan]] portfolio.ts PR-5i precedent；
//     原為 inline onclick="toggleTopLangDrop(event)" HTML 殘骸，CSP D 後已禁
//     inline handler，grep 顯示無任何 external `window.toggleTopLangDrop`
//     caller — 兄弟頁 erp-architecture / erp-architecture-3d 仍 .js 同款待清）
//   - DOM narrow 風格：non-null assertion 保留原 .js throw 語意（zero-drift；
//     避免引入 `?.` 進 Stage 5 zero-drift sweep backlog）
(function () {
    const isEmbed = !!document.getElementById('cp-arch-embed');
    const NODES = [
        // x/y 為 stage 百分比；環繞核心成橢圓。
        // 左右 ≥17% margin 給長標籤（Token / Session / Revoke、Email 驗證/重設密碼）。
        { id: 'login', x: 22, y: 12, tag: 'AUTH' },
        { id: 'oauth', x: 50, y: 6, tag: 'AUTH' },
        { id: 'email', x: 78, y: 12, tag: 'AUTH' },
        { id: 'mfa', x: 17, y: 30, tag: 'SECURITY' },
        { id: 'device', x: 83, y: 30, tag: 'SECURITY' },
        { id: 'token', x: 17, y: 58, tag: 'CORE' },
        { id: 'audit', x: 83, y: 58, tag: 'OPS' },
        { id: 'kyc', x: 30, y: 82, tag: 'COMPLIANCE' },
        { id: 'payment', x: 70, y: 82, tag: 'BUSINESS' },
        { id: 'wallet', x: 50, y: 92, tag: 'SECURITY' },
    ];
    const CORE = { x: 50, y: 50 };
    const EDGES = [
        ['login', 'token'], ['oauth', 'token'],
        ['login', 'mfa'], ['mfa', 'token'],
        ['token', 'device'],
        ['payment', 'kyc'], ['payment', 'audit'],
        ['mfa', 'payment'],
        ['wallet', 'login'], ['wallet', 'payment'], ['wallet', 'audit'],
    ];
    const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目與流程","nav_process":"服務流程","nav_portfolio":"chiyigo作品","nav_tools":"Tools 工具","nav_fun":"Fun 娛樂","nav_about":"關於我們","nav_contact":"需求諮詢","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","status_open":"接案中","cta_btn_m":"開始諮詢 →","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","member_center":"會員中心","logout":"登出","eyebrow":"// 平台案例","title1":"不只是登入頁","title2":"CHIYIGO 會員系統","subtitle":"整合 OAuth、2FA/Passkey、KYC、金流、裝置管理、SIWE 錢包綁定與 Audit 的金融級身份平台。每一個方塊都是一個可獨立運作的子系統。","stat_phases":"IAM Phase","stat_endpoints":"API endpoints","stat_audit":"Audit 事件類型","stat_oauth":"OAuth flow","arch_title":"// 互動式系統架構","arch_hint":"點擊任一節點，查看模組細節 →","panel_hint":"選擇左側任一節點，這裡會顯示功能用途、使用者流程、後端 API、安全設計與技術亮點。","picker_label":"快速選擇模組","picker_placeholder":"— 選擇模組 —","lab_purpose":"功能用途","lab_flow":"使用者流程","lab_api":"後端 API / 資料表","lab_security":"安全設計","lab_tech":"技術亮點","stack_title":"// Tech Stack","stack_edge":"Edge / Frontend","stack_data":"Data","stack_auth":"Auth / Crypto","stack_payment":"Payment / Risk","node_login":"登入 / 註冊","node_oauth":"OAuth / 第三方","node_email":"Email 驗證 / 重設密碼","node_mfa":"2FA / Passkey","node_device":"裝置管理","node_token":"Token / Session / Revoke","node_audit":"Admin / Audit Log","node_kyc":"KYC 身分驗證","node_payment":"金流 / 訂單 / 退款","node_wallet":"SIWE 錢包綁定","details":{"login":{"purpose":"帳號註冊、登入、忘記密碼、Email 驗證的入口。支援風險評分、brute-force 防禦與 Turnstile 機器人攔截。","flow":["填寫表單 → Turnstile challenge","送 POST /api/auth/local/login（含 device_uuid）","後端 risk score (4 signal)：country / UA / time / fails","分數 ≥ 70 拒絕並 email 通知；30–70 警告 + audit；其他發 access + refresh","新裝置 → email 警示 + audit critical"],"api":["POST /api/auth/local/login","POST /api/auth/local/register","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: users / login_attempts / risk_audit"],"security":["login 5/IP/min rate limit (D1)","24hr IP 黑名單階梯式 cooldown","password Argon2 hash + pepper","登入後 IP 跳國家 → audit critical + email"],"tech":["Cloudflare Pages Functions","D1 atomic UPDATE...RETURNING","Turnstile","Discord critical webhook"]},"oauth":{"purpose":"Google / LINE / Facebook 第三方登入；同時是 chiyigo 對外的 OIDC Provider，給 mbti / talo / sport-app 等子站 SSO。","flow":["點 Google → GET /api/auth/oauth/google/init","PKCE + state + nonce 寫入 pkce_sessions","callback 換 code → 換 id_token → 驗 sig/iss/aud/nonce","找/建本地 user → bind oauth_account → 發 chiyigo 自家 token","子站走 GET /api/auth/oauth/authorize：cookie session + prompt=none/login + max_age + RP registry"],"api":["GET  /api/auth/oauth/[provider]/init","GET  /api/auth/oauth/[provider]/callback","GET  /api/auth/oauth/authorize","POST /api/auth/oauth/token","POST /api/auth/oauth/end-session","POST /api/auth/oauth/code","POST /api/admin/oauth-clients (RP CRUD)","D1: oauth_accounts / oauth_clients / pkce_sessions / auth_codes"],"security":["ES256 JWK 非對稱簽章","aud 白名單 (talo/mbti/chiyigo/sport-app)","iss/aud/kid/nonce/fragment 五層驗證","RP Registry CRUD：新 RP 不必 deploy","Backchannel logout：sid 索引 + 三向 single sign-out"],"tech":["jose (JWT)","OIDC discovery","PKCE S256","Dynamic Client Registry"]},"email":{"purpose":"Email 驗證、密碼重設、bind email 流程。所有 token 走「一次性核銷 atomic UPDATE...RETURNING」防重放。","flow":["送 POST /api/auth/local/forgot-password","後端發 jti 進 email_tokens（hash 存）","使用者點信件連結 → POST /api/auth/local/reset-password","UPDATE email_tokens SET used_at=? WHERE jti=? AND used_at IS NULL RETURNING ...","RETURNING 為 0 → token 已用過或不存在 → 拒絕"],"api":["POST /api/auth/email/send-verification","POST /api/auth/email/verify","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: email_tokens (jti, hash, used_at, expires_at)"],"security":["atomic 核銷防 race condition","token 只存 hash，DB 外洩無效","15 min TTL","已登入者對自己 email reset 不要 captcha；他人仍要","Resend API + 多金鑰輪換"],"tech":["Resend","jti 一次性 token","D1 atomic write"]},"mfa":{"purpose":"TOTP 2FA + WebAuthn / Passkey + 高權限操作 step-up。disable 2FA 時主動清 token + 跳 login.html?tfa_disabled=1。","flow":["啟用：dashboard 顯 QR → otpauth URI → 驗 6 碼 OTP","登入：通過密碼後 → 額外送 OTP / passkey assertion","step-up：金流 / 改密碼前要求重新 2FA","發 elevated:* scope 短效 (5 min) 一次性 token","操作完即 revoke"],"api":["POST /api/auth/2fa/setup","POST /api/auth/2fa/activate","POST /api/auth/2fa/verify","POST /api/auth/2fa/disable","POST /api/auth/2fa/backup-codes/regenerate","POST /api/auth/webauthn/register-options","POST /api/auth/webauthn/register-verify","POST /api/auth/webauthn/login-options","POST /api/auth/webauthn/login-verify","GET  /api/auth/webauthn/credentials","POST /api/auth/step-up","D1: user_2fa / webauthn_credentials"],"security":["otpauth secret 加密存 D1","WebAuthn challenge 一次性","step-up token TTL 5 min + jti","disable 2FA → bumpTokenVersion + graceful logout","requireStepUp middleware"],"tech":["otpauth","@simplewebauthn/server","elevated:* scope claim","token version bump"]},"device":{"purpose":"每瀏覽器 web-<uuid> 存 localStorage；refresh token 強綁 device；mismatch 就撤整個 device 家族。","flow":["第一次開頁 → 生 web-<uuid> 寫 localStorage","refresh token 換發必帶 X-Device-Id header","後端比對：不符 → revoke 所有此 user_id+device_id 的 refresh","Dashboard 顯示所有 active 裝置","user 可單個 revoke 或一鍵全撤"],"api":["GET    /api/auth/devices","POST   /api/auth/devices/logout","POST   /api/auth/refresh (X-Device-Id required)","D1: refresh_tokens (user_id, device_id, family_id, revoked_at)"],"security":["device binding：refresh 不可跨裝置使用","異常裝置 → email + audit critical","country jump audit","passkey 綁定特定裝置","rename 顯示更友善的裝置名"],"tech":["localStorage UUID","family-based revocation","X-Device-Id header"]},"token":{"purpose":"JWT (ES256) + refresh token 雙軌。jti 進 D1 黑名單即時撤銷；scope catalog 細粒度控制；token version bump 全家族失效。","flow":["登入成功 → 簽 access (15 min) + refresh (30 day)","API 收 access：verifyJwt → 查 jti 黑名單 → buildTokenScope","refresh 換新：rotation + 舊的進 revoked","requireScope(\"payment.write\") 失敗 → 401","關鍵改動 → bumpTokenVersion → 所有 token 立即失效"],"api":["POST /api/auth/refresh","POST /api/auth/logout","POST /api/admin/revoke","GET  /api/auth/me","GET  /api/auth/userinfo","D1: refresh_tokens / revoked_jtis / token_versions"],"security":["ES256 非對稱 JWK","jti 黑名單立即生效","scope catalog 細粒度 (payment/admin/audit/elevated)","token version bump = 全裝置 logout","refresh rotation + reuse detection"],"tech":["jose ES256","D1 jti index","scope-based authz","version bump cascade"]},"audit":{"purpose":"Admin 後台 + 22 種 audit 事件 + 結構化 log + traceId 中介層 + Discord critical 告警 + F-3 Phase 2 冷封存（chunk + manifest 寫 R2，三態 state_history 防篡改）。","flow":["每個 endpoint → 中介層自動發 audit_log","分級：info / warn / critical","critical → 同步 Discord webhook","Admin Dashboard 可篩 user_id / event / time / severity","可清理白名單事件（payment/refund 不可清）","冷封存 job：D1 chunk + R2 manifest 寫入 → chunk_verified + verified_at 驗章 → state_history 三態追蹤"],"api":["GET    /api/admin/audit","DELETE /api/admin/audit/[id]","POST   /api/admin/cron/audit-archive (cron-triggered)","GET    /api/admin/users","POST   /api/admin/users/[id]/ban","POST   /api/admin/users/[id]/unban","GET/POST/PATCH/DELETE /api/admin/oauth-clients","GET    /api/admin/metrics","D1: audit_log / audit_archive (chunk + manifest)","R2: audit-archive bucket"],"security":["critical 事件不可刪","admin scope: admin.read / admin.write","step-up 必經 2FA","所有 admin 動作自身亦寫 audit","observability traceId 全鏈路追蹤","冷封存 manifest immutable，state_history append-only 防回溯改寫"],"tech":["Cloudflare Real-time logs","traceId middleware","Discord webhook","admin RBAC","R2 cold archive","Phase F-3 Phase 2 manifest state_history"]},"kyc":{"purpose":"KYC 身分驗證 vendor-agnostic adapter。schema 不綁特定 vendor，可隨時切換 (Sumsub / Onfido / Persona / 國產)。","flow":["使用者進 dashboard /kyc → 上傳證件","後端呼 vendor adapter（目前 mock）","vendor 回 webhook → POST /api/webhooks/kyc/[vendor] 更新狀態","GET /api/auth/kyc/status 取狀態","status=approved → 解鎖金流出金限額"],"api":["GET  /api/auth/kyc/status","POST /api/webhooks/kyc/[vendor]","D1: kyc_sessions / kyc_documents"],"security":["vendor adapter pattern","webhook 驗簽","PII 欄位加密","金流出金前必驗 KYC"],"tech":["Phase F-1","adapter pattern","encrypt-at-rest"]},"payment":{"purpose":"F-2 wave 1-7：充值 / 退款 / 對帳 / step-up / 退款審核兩段式。已串綠界 ECPay AIO + CheckMacValue + 信用卡實機驗。","flow":["user 點充值 → POST /api/auth/payments/intents","POST /api/auth/payments/checkout/ecpay 取 ECPay form","綠界回 webhook → POST /api/webhooks/payments/ecpay 驗 CheckMacValue","退款申請：POST /api/payments/intents/[id]/refund-request","admin 審核 (step-up + 2FA) → POST /api/admin/payments/intents/[id]/refund","對帳：cron 比對 ECPay vs D1（/api/admin/payments/aggregate）"],"api":["POST   /api/auth/payments/intents","GET    /api/auth/payments/intents/[id]","POST   /api/auth/payments/checkout/ecpay","POST   /api/payments/intents/[id]/refund-request","POST   /api/webhooks/payments/[vendor]","POST   /api/admin/payments/intents/[id]/refund","POST   /api/admin/payments/intents/[id]/delete","GET    /api/admin/payments/intents","GET    /api/admin/payments/aggregate","GET    /api/admin/payments/webhook-dlq","D1: payment_intents / refund_requests"],"security":["CheckMacValue 雙向驗","amount subunit/raw 雙欄位防誤算","退款 step-up + 2FA OTP","intent hard delete + audit 白名單","webhook idempotency + DLQ"],"tech":["ECPay AIO","CheckMacValue","D1 cron 對帳","step-up scope"]},"wallet":{"purpose":"EIP-4361 Sign-In with Ethereum 錢包綁定。MetaMask 連線 → 簽 SIWE 訊息 → 後端 @noble/curves ecrecover 自實作驗章 → 寫 user_wallets。Phase F-3。","flow":["Dashboard → Connect MetaMask → eth_requestAccounts 拿 address","GET /api/auth/wallet/nonce 拿一次性 nonce（綁定當前 user + address）","前端組 EIP-4361 message（domain / chain_id / nonce / issued_at）→ personal_sign","POST /api/auth/wallet/verify 帶 message + signature","後端 secp256k1 ecrecover + keccak256 自實作 recoverAddress + 比對 nonce.user_id / nonce.address → INSERT user_wallets","解綁 DELETE /api/auth/wallet/[id] → critical audit"],"api":["GET    /api/auth/wallet/nonce","POST   /api/auth/wallet/verify","GET    /api/auth/wallet（列表）","DELETE /api/auth/wallet/[id]","D1: user_wallets / wallet_nonces"],"security":["nonce 一次性消耗 + atomic UPDATE...RETURNING 防 replay","nonce.user_id 必驗等於當前 user，防中間人換綁","nonce.address 必驗等於 SIWE message address，防換 address","domain + chain_id 寫入 SIWE message 防 cross-site / cross-chain replay","綁定/解綁皆寫 critical audit（金流前置）","UNIQUE (user_id, address) 撞 409"],"tech":["EIP-4361 SIWE","@noble/curves secp256k1","keccak256 自實作 ecrecover","MetaMask provider","Phase F-3"]}}},"en":{"nav_home":"Home","nav_services":"Services & Process","nav_process":"Process","nav_portfolio":"chiyigo Portfolio","nav_tools":"Tools","nav_fun":"Fun","nav_about":"About","nav_contact":"Inquiry","tooltip_theme":"Toggle Theme","tooltip_lang":"Switch Language","status_open":"Open for Work","cta_btn_m":"Get in Touch →","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","member_center":"Member Center","logout":"Sign Out","eyebrow":"// platform case","title1":"Not just a login page","title2":"CHIYIGO Identity Platform","subtitle":"A finance-grade identity platform integrating OAuth, 2FA/Passkey, KYC, payments, device management, SIWE wallet binding and audit. Each block is a fully-functional sub-system.","stat_phases":"IAM Phases","stat_endpoints":"API endpoints","stat_audit":"Audit event types","stat_oauth":"OAuth flows","arch_title":"// Interactive Architecture","arch_hint":"Click any node to see module details →","panel_hint":"Pick a node on the left — this panel shows purpose, user flow, backend APIs, security and tech highlights.","lab_purpose":"Purpose","lab_flow":"User Flow","lab_api":"Backend API / Tables","lab_security":"Security","lab_tech":"Tech Highlights","stack_title":"// Tech Stack","stack_edge":"Edge / Frontend","stack_data":"Data","stack_auth":"Auth / Crypto","stack_payment":"Payment / Risk","node_login":"Login / Signup","node_oauth":"OAuth / Federation","node_email":"Email Verify / Reset","node_mfa":"2FA / Passkey","node_device":"Device Mgmt","node_token":"Token / Session / Revoke","node_audit":"Admin / Audit Log","node_kyc":"KYC","node_payment":"Payment / Refund","node_wallet":"SIWE Wallet Binding","details":{"login":{"purpose":"Entry point for sign-up, login, password reset and email verification. Backed by risk scoring, brute-force protection and Turnstile bot challenge.","flow":["Submit form → Turnstile challenge","POST /api/auth/local/login (with device_uuid)","Server-side risk score (4 signals): country / UA / time / fails","Score ≥ 70 → reject + email; 30–70 → audit warn; else → issue access + refresh","New device → email alert + audit critical"],"api":["POST /api/auth/local/login","POST /api/auth/local/register","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: users / login_attempts / risk_audit"],"security":["login 5/IP/min rate-limit (D1)","24-hr IP blocklist with cooldown ladder","Argon2 password hash + pepper","Country-jump after login → audit critical + email"],"tech":["Cloudflare Pages Functions","D1 atomic UPDATE...RETURNING","Turnstile","Discord critical webhook"]},"oauth":{"purpose":"Federated login (Google / LINE / Facebook) AND chiyigo as an OIDC Provider for sub-sites (mbti / talo / sport-app) via SSO.","flow":["Click Google → GET /api/auth/oauth/google/init","PKCE + state + nonce → pkce_sessions","Callback exchanges code → id_token → verify sig/iss/aud/nonce","Find/create local user → bind oauth_account → issue chiyigo tokens","Sub-site SSO: GET /api/auth/oauth/authorize, cookie session + prompt=none/login + RP Registry"],"api":["GET  /api/auth/oauth/[provider]/init","GET  /api/auth/oauth/[provider]/callback","GET  /api/auth/oauth/authorize","POST /api/auth/oauth/token","POST /api/auth/oauth/end-session","POST /api/auth/oauth/code","POST /api/admin/oauth-clients (RP CRUD)","D1: oauth_accounts / oauth_clients / pkce_sessions / auth_codes"],"security":["ES256 JWK asymmetric signing","Audience whitelist (talo/mbti/chiyigo/sport-app)","5-layer verification: iss/aud/kid/nonce/fragment","RP Registry CRUD: new RP without redeploy","Backchannel logout: sid index + 3-way single sign-out"],"tech":["jose (JWT)","OIDC discovery","PKCE S256","Dynamic Client Registry"]},"email":{"purpose":"Email verification, password reset, email binding. All tokens use atomic UPDATE...RETURNING for one-shot consumption — no replay.","flow":["POST /api/auth/local/forgot-password","Server stores jti hash in email_tokens","User clicks link → POST /api/auth/local/reset-password","UPDATE email_tokens SET used_at=? WHERE jti=? AND used_at IS NULL RETURNING ...","If RETURNING is empty → token used/missing → reject"],"api":["POST /api/auth/email/send-verification","POST /api/auth/email/verify","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: email_tokens (jti, hash, used_at, expires_at)"],"security":["Atomic consumption prevents race conditions","Tokens stored hashed only","15-min TTL","Self-reset skips captcha; foreign-email reset still requires it","Resend API with multi-key rotation"],"tech":["Resend","One-shot jti tokens","D1 atomic writes"]},"mfa":{"purpose":"TOTP 2FA + WebAuthn/Passkey + step-up auth for high-privilege ops. Disabling 2FA actively clears tokens and redirects to login.html?tfa_disabled=1.","flow":["Enable: dashboard shows QR → otpauth URI → verify 6-digit OTP","Login: after password → additional OTP / passkey assertion","Step-up: re-MFA before payments / password change","Issue elevated:* scope, short-lived (5 min) one-shot token","Revoke immediately after operation"],"api":["POST /api/auth/2fa/setup","POST /api/auth/2fa/activate","POST /api/auth/2fa/verify","POST /api/auth/2fa/disable","POST /api/auth/2fa/backup-codes/regenerate","POST /api/auth/webauthn/register-options","POST /api/auth/webauthn/register-verify","POST /api/auth/webauthn/login-options","POST /api/auth/webauthn/login-verify","GET  /api/auth/webauthn/credentials","POST /api/auth/step-up","D1: user_2fa / webauthn_credentials"],"security":["otpauth secret encrypted at rest","WebAuthn challenges single-use","Step-up token TTL 5 min + jti","Disable 2FA → bumpTokenVersion + graceful logout","requireStepUp middleware"],"tech":["otpauth","@simplewebauthn/server","elevated:* scope claim","token-version bump"]},"device":{"purpose":"Each browser stores web-<uuid> in localStorage; refresh tokens are bound to the device; mismatch revokes the entire device family.","flow":["First load → generate web-<uuid> → localStorage","Refresh requires X-Device-Id header","Server checks: mismatch → revoke ALL refresh tokens for this user_id+device_id","Dashboard lists active devices","User can revoke single or all-at-once"],"api":["GET    /api/auth/devices","POST   /api/auth/devices/logout","POST   /api/auth/refresh (X-Device-Id required)","D1: refresh_tokens (user_id, device_id, family_id, revoked_at)"],"security":["Device binding prevents cross-device refresh","Anomalous device → email + audit critical","Country-jump audit","Passkeys bound to specific devices","Rename for friendlier device names"],"tech":["localStorage UUID","Family-based revocation","X-Device-Id header"]},"token":{"purpose":"Dual-track JWT (ES256) access + refresh. jti blocklist in D1 enables instant revocation; scope catalog for fine-grained authz; token-version bump cascades to entire family.","flow":["Login success → sign access (15 min) + refresh (30 day)","API receives access: verifyJwt → check jti blocklist → buildTokenScope","Refresh: rotation + old jti revoked","requireScope(\"payment.write\") fails → 401","Critical change → bumpTokenVersion → all tokens invalidated"],"api":["POST /api/auth/refresh","POST /api/auth/logout","POST /api/admin/revoke","GET  /api/auth/me","GET  /api/auth/userinfo","D1: refresh_tokens / revoked_jtis / token_versions"],"security":["ES256 asymmetric JWK","Instant jti blocklist","Fine-grained scope catalog (payment/admin/audit/elevated)","Token-version bump = global logout","Refresh rotation + reuse detection"],"tech":["jose ES256","D1 jti index","Scope-based authz","Version-bump cascade"]},"audit":{"purpose":"Admin console + 22 audit event types + structured logs + traceId middleware + Discord critical alerts + F-3 Phase 2 cold archive (chunks + manifest pushed to R2 with tamper-evident state_history).","flow":["Every endpoint → middleware emits audit_log","Severity: info / warn / critical","Critical → synchronous Discord webhook","Admin dashboard filters: user_id / event / time / severity","Whitelisted events purgeable; payment/refund are immutable","Cold archive job: write D1 chunk + R2 manifest → chunk_verified + verified_at → state_history three-state tracking"],"api":["GET    /api/admin/audit","DELETE /api/admin/audit/[id]","POST   /api/admin/cron/audit-archive (cron-triggered)","GET    /api/admin/users","POST   /api/admin/users/[id]/ban","POST   /api/admin/users/[id]/unban","GET/POST/PATCH/DELETE /api/admin/oauth-clients","GET    /api/admin/metrics","D1: audit_log / audit_archive (chunk + manifest)","R2: audit-archive bucket"],"security":["Critical events undeletable","admin scope: admin.read / admin.write","Step-up requires 2FA","All admin actions self-audited","Observability traceId end-to-end","Cold archive manifests immutable; state_history is append-only — no retro-rewrites"],"tech":["Cloudflare Real-time logs","traceId middleware","Discord webhook","admin RBAC","R2 cold archive","Phase F-3 Phase 2 manifest state_history"]},"kyc":{"purpose":"Vendor-agnostic KYC adapter. Schema is not coupled to a specific vendor — Sumsub / Onfido / Persona swap is one adapter file.","flow":["User opens dashboard /kyc → uploads documents","Server calls vendor adapter (currently mock)","Vendor webhook → POST /api/webhooks/kyc/[vendor] updates state","GET /api/auth/kyc/status returns current state","status=approved → unlocks payment withdrawal limits"],"api":["GET  /api/auth/kyc/status","POST /api/webhooks/kyc/[vendor]","D1: kyc_sessions / kyc_documents"],"security":["Vendor adapter pattern","Webhook signature verification","PII fields encrypted","KYC required before payment withdrawal"],"tech":["Phase F-1","Adapter pattern","Encrypt-at-rest"]},"payment":{"purpose":"F-2 wave 1-7: top-up / refund / reconciliation / step-up / two-stage refund review. ECPay AIO + CheckMacValue verified end-to-end with real credit card.","flow":["User clicks top-up → POST /api/auth/payments/intents","POST /api/auth/payments/checkout/ecpay → ECPay form","Webhook → POST /api/webhooks/payments/ecpay → verify CheckMacValue","Refund request: POST /api/payments/intents/[id]/refund-request","Admin review (step-up + 2FA) → POST /api/admin/payments/intents/[id]/refund","Reconciliation: cron compares ECPay vs D1 (/api/admin/payments/aggregate)"],"api":["POST   /api/auth/payments/intents","GET    /api/auth/payments/intents/[id]","POST   /api/auth/payments/checkout/ecpay","POST   /api/payments/intents/[id]/refund-request","POST   /api/webhooks/payments/[vendor]","POST   /api/admin/payments/intents/[id]/refund","POST   /api/admin/payments/intents/[id]/delete","GET    /api/admin/payments/intents","GET    /api/admin/payments/aggregate","GET    /api/admin/payments/webhook-dlq","D1: payment_intents / refund_requests"],"security":["Two-way CheckMacValue verification","subunit/raw dual-amount columns avoid rounding bugs","Refund step-up + 2FA OTP","Hard-delete with audit whitelist","Webhook idempotency + DLQ"],"tech":["ECPay AIO","CheckMacValue","D1 cron reconciliation","step-up scope"]},"wallet":{"purpose":"EIP-4361 Sign-In with Ethereum wallet binding. MetaMask connect → sign SIWE message → server-side ecrecover (self-implemented with @noble/curves) → INSERT user_wallets. Phase F-3.","flow":["Dashboard → Connect MetaMask → eth_requestAccounts to get address","GET /api/auth/wallet/nonce for a single-use nonce bound to (user, address)","Frontend builds EIP-4361 message (domain / chain_id / nonce / issued_at) → personal_sign","POST /api/auth/wallet/verify with message + signature","Server: self-implemented secp256k1 ecrecover + keccak256 → nonce.user_id match + nonce.address match → INSERT user_wallets","Unbind: DELETE /api/auth/wallet/[id] → critical audit"],"api":["GET    /api/auth/wallet/nonce","POST   /api/auth/wallet/verify","GET    /api/auth/wallet (list)","DELETE /api/auth/wallet/[id]","D1: user_wallets / wallet_nonces"],"security":["Nonce single-use, consumed via atomic UPDATE...RETURNING — no replay","nonce.user_id MUST equal current user — blocks MITM rebind","nonce.address MUST equal SIWE message address — blocks address swap","domain + chain_id in SIWE message prevent cross-site / cross-chain replay","Bind & unbind both write critical audit (wallet is a payment prerequisite)","UNIQUE (user_id, address) → 409 on duplicate"],"tech":["EIP-4361 SIWE","@noble/curves secp256k1","Self-implemented keccak256 ecrecover","MetaMask provider","Phase F-3"]}},"picker_label":"Quick pick module","picker_placeholder":"— Select module —"},"ja":{"nav_home":"ホーム","nav_services":"サービスとプロセス","nav_process":"開発プロセス","nav_portfolio":"chiyigoの実績","nav_tools":"ツール","nav_fun":"エンタメ","nav_about":"私たちについて","nav_contact":"お問い合わせ","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","status_open":"受注中","cta_btn_m":"相談する →","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","member_center":"メンバーセンター","logout":"ログアウト","eyebrow":"// プラットフォーム事例","title1":"ログインページだけではない","title2":"CHIYIGO IDプラットフォーム","subtitle":"OAuth・2FA/Passkey・KYC・決済・デバイス管理・SIWEウォレット連携・監査を統合した金融グレードのIDプラットフォーム。各ブロックは独立稼働可能なサブシステムです。","stat_phases":"IAMフェーズ","stat_endpoints":"APIエンドポイント","stat_audit":"監査イベント種類","stat_oauth":"OAuthフロー","arch_title":"// インタラクティブ設計図","arch_hint":"ノードをクリックしてモジュール詳細を表示 →","panel_hint":"左のノードを選ぶと、用途・ユーザーフロー・API・セキュリティ・技術ポイントが表示されます。","lab_purpose":"用途","lab_flow":"ユーザーフロー","lab_api":"API / テーブル","lab_security":"セキュリティ","lab_tech":"技術ハイライト","stack_title":"// 技術スタック","stack_edge":"エッジ / フロント","stack_data":"データ","stack_auth":"認証 / 暗号","stack_payment":"決済 / リスク","node_login":"ログイン / 登録","node_oauth":"OAuth / 連携","node_email":"メール認証 / リセット","node_mfa":"2FA / Passkey","node_device":"デバイス管理","node_token":"Token / Session","node_audit":"Admin / 監査","node_kyc":"KYC 本人確認","node_payment":"決済 / 返金","node_wallet":"SIWE ウォレット連携","details":{"login":{"purpose":"サインアップ・ログイン・パスワードリセット・メール認証の入口。リスクスコアリング、ブルートフォース防御、Turnstileのbot防止を備えています。","flow":["フォーム送信 → Turnstileチャレンジ","POST /api/auth/local/login（device_uuid付き）","サーバー側リスクスコア（4シグナル：国 / UA / 時間 / 失敗回数）","スコア≥70は拒否+メール通知；30–70は警告+audit；それ以外はaccess+refresh発行","新規デバイス → メール警告 + audit critical"],"api":["POST /api/auth/local/login","POST /api/auth/local/register","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: users / login_attempts / risk_audit"],"security":["login 5/IP/分のレート制限（D1）","24時間IPブロックリスト＋段階的クールダウン","Argon2パスワードハッシュ + pepper","ログイン後の国跳び → audit critical + メール"],"tech":["Cloudflare Pages Functions","D1 atomic UPDATE...RETURNING","Turnstile","Discord critical webhook"]},"oauth":{"purpose":"Google / LINE / Facebook ソーシャルログイン；同時にchiyigoはOIDC ProviderとしてmbtiやtaloなどサブサイトのSSOを提供。","flow":["Google選択 → GET /api/auth/oauth/google/init","PKCE + state + nonce → pkce_sessions","Callbackでcode交換 → id_token → sig/iss/aud/nonce検証","ローカルユーザー検索/作成 → oauth_account紐付け → chiyigoトークン発行","サブサイトSSO：GET /api/auth/oauth/authorize、cookieセッション + prompt=none/login + RP Registry"],"api":["GET  /api/auth/oauth/[provider]/init","GET  /api/auth/oauth/[provider]/callback","GET  /api/auth/oauth/authorize","POST /api/auth/oauth/token","POST /api/auth/oauth/end-session","POST /api/auth/oauth/code","POST /api/admin/oauth-clients (RP CRUD)","D1: oauth_accounts / oauth_clients / pkce_sessions / auth_codes"],"security":["ES256 JWK 非対称署名","aud ホワイトリスト（talo/mbti/chiyigo/sport-app）","5層検証：iss/aud/kid/nonce/fragment","RP Registry CRUD：新規RP登録に再デプロイ不要","Backchannel logout：sidインデックス + 三方向single sign-out"],"tech":["jose (JWT)","OIDC discovery","PKCE S256","Dynamic Client Registry"]},"email":{"purpose":"メール認証、パスワードリセット、メール紐付けフロー。すべてのトークンは atomic UPDATE...RETURNING による一回限り消費でリプレイ防止。","flow":["POST /api/auth/local/forgot-password","サーバーがjtiハッシュをemail_tokensに保存","ユーザーがリンクをクリック → POST /api/auth/local/reset-password","UPDATE email_tokens SET used_at=? WHERE jti=? AND used_at IS NULL RETURNING ...","RETURNINGが空 → 使用済み/不在 → 拒否"],"api":["POST /api/auth/email/send-verification","POST /api/auth/email/verify","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: email_tokens (jti, hash, used_at, expires_at)"],"security":["原子的消費でレース条件防止","トークンはハッシュのみ保存","15分TTL","自分のメールに対するリセットはcaptcha不要、他人なら必須","Resend API + 複数キーローテーション"],"tech":["Resend","ワンショットjtiトークン","D1 atomic write"]},"mfa":{"purpose":"TOTP 2FA + WebAuthn/Passkey + 高権限操作のstep-up。2FA無効化時はトークン即時クリア+login.html?tfa_disabled=1へリダイレクト。","flow":["有効化：dashboardでQR表示 → otpauth URI → 6桁OTP検証","ログイン：パスワード後 → OTP / passkey assertion追加","Step-up：決済 / パスワード変更前に再MFA","elevated:* scope の短命（5分）一回限りトークン発行","操作完了後即revoke"],"api":["POST /api/auth/2fa/setup","POST /api/auth/2fa/activate","POST /api/auth/2fa/verify","POST /api/auth/2fa/disable","POST /api/auth/2fa/backup-codes/regenerate","POST /api/auth/webauthn/register-options","POST /api/auth/webauthn/register-verify","POST /api/auth/webauthn/login-options","POST /api/auth/webauthn/login-verify","GET  /api/auth/webauthn/credentials","POST /api/auth/step-up","D1: user_2fa / webauthn_credentials"],"security":["otpauth secret 暗号化保存","WebAuthn challenge 一回限り","Step-up token TTL 5分 + jti","2FA無効化 → bumpTokenVersion + graceful logout","requireStepUp ミドルウェア"],"tech":["otpauth","@simplewebauthn/server","elevated:* scope claim","token-version bump"]},"device":{"purpose":"ブラウザごとにweb-<uuid>をlocalStorageに保存；refresh tokenをデバイスに強紐付け；不一致なら家族全体をrevoke。","flow":["初回ロード → web-<uuid>生成 → localStorage","Refresh は X-Device-Id ヘッダ必須","サーバーで照合：不一致 → user_id+device_id の全refreshをrevoke","Dashboardでアクティブデバイス一覧","ユーザーは個別 / 一括revoke可能"],"api":["GET    /api/auth/devices","POST   /api/auth/devices/logout","POST   /api/auth/refresh (X-Device-Id required)","D1: refresh_tokens (user_id, device_id, family_id, revoked_at)"],"security":["デバイス紐付けでクロスデバイスrefresh防止","異常デバイス → メール + audit critical","国跳び audit","Passkeyを特定デバイスに紐付け","リネームで認識しやすく"],"tech":["localStorage UUID","family-based revocation","X-Device-Id header"]},"token":{"purpose":"JWT (ES256) access + refresh の二重構成。jti ブロックリスト（D1）で即時失効；scope catalogで細粒度認可；token-version bumpでファミリー全体を無効化。","flow":["ログイン成功 → access (15分) + refresh (30日) 発行","APIがaccess受信：verifyJwt → jtiブロックリスト確認 → buildTokenScope","Refresh：ローテーション + 旧jtiをrevoked","requireScope(\"payment.write\") 失敗 → 401","クリティカルな変更 → bumpTokenVersion → 全トークン即無効"],"api":["POST /api/auth/refresh","POST /api/auth/logout","POST /api/admin/revoke","GET  /api/auth/me","GET  /api/auth/userinfo","D1: refresh_tokens / revoked_jtis / token_versions"],"security":["ES256 非対称JWK","jti ブロックリスト即時反映","scope catalog（payment/admin/audit/elevated）","Token-version bump = 全デバイスログアウト","Refresh rotation + 再利用検知"],"tech":["jose ES256","D1 jti index","scope-based authz","version-bump cascade"]},"audit":{"purpose":"管理コンソール + 22種類のauditイベント + 構造化ログ + traceIdミドルウェア + Discord critical アラート + F-3 Phase 2 コールドアーカイブ（chunk + manifest を R2 に保存、state_history 三状態で改ざん検知）。","flow":["全endpoint → ミドルウェアが audit_log を発行","重要度：info / warn / critical","critical → 同期Discord webhook","管理ダッシュボードでフィルタ：user_id / event / 時間 / severity","ホワイトリストイベントは削除可、payment/refundは不変","コールドアーカイブジョブ：D1 chunk + R2 manifest 書き込み → chunk_verified + verified_at 検証 → state_history 三状態管理"],"api":["GET    /api/admin/audit","DELETE /api/admin/audit/[id]","POST   /api/admin/cron/audit-archive (cron-triggered)","GET    /api/admin/users","POST   /api/admin/users/[id]/ban","POST   /api/admin/users/[id]/unban","GET/POST/PATCH/DELETE /api/admin/oauth-clients","GET    /api/admin/metrics","D1: audit_log / audit_archive (chunk + manifest)","R2: audit-archive bucket"],"security":["Criticalイベント削除不可","admin scope: admin.read / admin.write","Step-up は2FA必須","管理操作も自身をaudit","Observability traceId 全リンク追跡","コールドアーカイブの manifest は不変、state_history は append-only で遡及改ざん不可"],"tech":["Cloudflare Real-time logs","traceId middleware","Discord webhook","admin RBAC","R2 cold archive","Phase F-3 Phase 2 manifest state_history"]},"kyc":{"purpose":"ベンダー非依存のKYCアダプター。スキーマは特定ベンダーに結合せず、Sumsub / Onfido / Persona の差し替えはアダプター1ファイルで完結。","flow":["dashboard /kyc → 書類アップロード","サーバーがベンダーアダプター呼び出し（現在モック）","ベンダーwebhook → POST /api/webhooks/kyc/[vendor] で状態更新","GET /api/auth/kyc/status で状態取得","status=approved → 出金限度解放"],"api":["GET  /api/auth/kyc/status","POST /api/webhooks/kyc/[vendor]","D1: kyc_sessions / kyc_documents"],"security":["ベンダーアダプターパターン","Webhook 署名検証","PII フィールド暗号化","出金前KYC必須"],"tech":["Phase F-1","Adapter pattern","Encrypt-at-rest"]},"payment":{"purpose":"F-2 wave 1-7：チャージ / 返金 / 突合 / step-up / 二段階返金審査。ECPay AIO + CheckMacValue + 実機クレカでEnd-to-End検証済み。","flow":["ユーザーがチャージ → POST /api/auth/payments/intents","POST /api/auth/payments/checkout/ecpay → ECPay form","Webhook → POST /api/webhooks/payments/ecpay → CheckMacValue検証","返金申請：POST /api/payments/intents/[id]/refund-request","管理者審査（step-up + 2FA） → POST /api/admin/payments/intents/[id]/refund","突合：cron で ECPay vs D1 を比較（/api/admin/payments/aggregate）"],"api":["POST   /api/auth/payments/intents","GET    /api/auth/payments/intents/[id]","POST   /api/auth/payments/checkout/ecpay","POST   /api/payments/intents/[id]/refund-request","POST   /api/webhooks/payments/[vendor]","POST   /api/admin/payments/intents/[id]/refund","POST   /api/admin/payments/intents/[id]/delete","GET    /api/admin/payments/intents","GET    /api/admin/payments/aggregate","GET    /api/admin/payments/webhook-dlq","D1: payment_intents / refund_requests"],"security":["双方向 CheckMacValue 検証","subunit/raw 二重金額カラムで丸めバグ防止","返金 step-up + 2FA OTP","ハードデリート + audit ホワイトリスト","Webhook idempotency + DLQ"],"tech":["ECPay AIO","CheckMacValue","D1 cron 突合","step-up scope"]},"wallet":{"purpose":"EIP-4361 Sign-In with Ethereum によるウォレット連携。MetaMask 接続 → SIWE メッセージ署名 → サーバー側で @noble/curves による自前 ecrecover 検証 → user_wallets に INSERT。Phase F-3。","flow":["Dashboard → Connect MetaMask → eth_requestAccounts で address 取得","GET /api/auth/wallet/nonce で一回限りの nonce 取得（user + address に紐付け）","フロントで EIP-4361 メッセージ（domain / chain_id / nonce / issued_at）組立 → personal_sign","POST /api/auth/wallet/verify に message + signature を送信","サーバー：自前実装の secp256k1 ecrecover + keccak256 → nonce.user_id 一致 + nonce.address 一致 → user_wallets に INSERT","解除：DELETE /api/auth/wallet/[id] → critical audit"],"api":["GET    /api/auth/wallet/nonce","POST   /api/auth/wallet/verify","GET    /api/auth/wallet（一覧）","DELETE /api/auth/wallet/[id]","D1: user_wallets / wallet_nonces"],"security":["nonce は atomic UPDATE...RETURNING で一回限り消費、リプレイ防止","nonce.user_id は現在ユーザー必須一致、MITM 連携乗っ取り防止","nonce.address は SIWE メッセージ address 必須一致、address 差替え防止","domain + chain_id をメッセージに含め、cross-site / cross-chain リプレイ防止","連携・解除はいずれも critical audit（決済の前提条件）","UNIQUE (user_id, address) 衝突 → 409"],"tech":["EIP-4361 SIWE","@noble/curves secp256k1","自前実装 keccak256 ecrecover","MetaMask provider","Phase F-3"]}},"picker_label":"モジュール選択","picker_placeholder":"— モジュールを選ぶ —"},"ko":{"nav_home":"홈","nav_services":"서비스 & 프로세스","nav_process":"진행 과정","nav_portfolio":"chiyigo 포트폴리오","nav_tools":"도구","nav_fun":"재미","nav_about":"소개","nav_contact":"문의하기","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","status_open":"수주 중","cta_btn_m":"상담 시작 →","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","member_center":"회원 센터","logout":"로그아웃","eyebrow":"// 플랫폼 사례","title1":"단순 로그인 페이지가 아닙니다","title2":"CHIYIGO ID 플랫폼","subtitle":"OAuth、2FA/Passkey、KYC、결제, 디바이스 관리, SIWE 지갑 연결, 감사를 통합한 금융 등급 ID 플랫폼. 각 블록은 독립적으로 작동하는 서브시스템입니다.","stat_phases":"IAM 단계","stat_endpoints":"API 엔드포인트","stat_audit":"감사 이벤트 종류","stat_oauth":"OAuth 플로우","arch_title":"// 인터랙티브 아키텍처","arch_hint":"노드를 클릭하면 모듈 상세가 표시됩니다 →","panel_hint":"왼쪽 노드를 선택하면 목적、사용자 플로우、API、보안、기술 포인트가 표시됩니다.","lab_purpose":"용도","lab_flow":"사용자 플로우","lab_api":"API / 테이블","lab_security":"보안 설계","lab_tech":"기술 하이라이트","stack_title":"// 기술 스택","stack_edge":"Edge / Frontend","stack_data":"Data","stack_auth":"Auth / Crypto","stack_payment":"Payment / Risk","node_login":"로그인 / 가입","node_oauth":"OAuth / 연동","node_email":"이메일 인증 / 재설정","node_mfa":"2FA / Passkey","node_device":"디바이스 관리","node_token":"Token / Session","node_audit":"Admin / 감사","node_kyc":"KYC","node_payment":"결제 / 환불","node_wallet":"SIWE 지갑 연결","details":{"login":{"purpose":"회원가입, 로그인, 비밀번호 재설정, 이메일 인증의 진입점. 위험 점수 평가, brute-force 방어, Turnstile 봇 차단을 지원합니다.","flow":["폼 제출 → Turnstile 챌린지","POST /api/auth/local/login (device_uuid 포함)","서버 측 위험 점수 (4가지 신호: 국가 / UA / 시간 / 실패횟수)","점수 ≥ 70은 거부 + 이메일; 30–70은 audit warn; 그 외 access + refresh 발급","신규 디바이스 → 이메일 알림 + audit critical"],"api":["POST /api/auth/local/login","POST /api/auth/local/register","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: users / login_attempts / risk_audit"],"security":["login 5/IP/분 rate-limit (D1)","24시간 IP 차단 + 단계적 cooldown","Argon2 password hash + pepper","로그인 후 국가 점프 → audit critical + 이메일"],"tech":["Cloudflare Pages Functions","D1 atomic UPDATE...RETURNING","Turnstile","Discord critical webhook"]},"oauth":{"purpose":"Google / LINE / Facebook 소셜 로그인; 동시에 chiyigo가 OIDC Provider로서 mbti / talo / sport-app 등 서브사이트에 SSO 제공.","flow":["Google 선택 → GET /api/auth/oauth/google/init","PKCE + state + nonce → pkce_sessions","Callback에서 code 교환 → id_token → sig/iss/aud/nonce 검증","로컬 사용자 조회/생성 → oauth_account 연결 → chiyigo 토큰 발급","서브사이트 SSO: GET /api/auth/oauth/authorize, cookie session + prompt=none/login + RP Registry"],"api":["GET  /api/auth/oauth/[provider]/init","GET  /api/auth/oauth/[provider]/callback","GET  /api/auth/oauth/authorize","POST /api/auth/oauth/token","POST /api/auth/oauth/end-session","POST /api/auth/oauth/code","POST /api/admin/oauth-clients (RP CRUD)","D1: oauth_accounts / oauth_clients / pkce_sessions / auth_codes"],"security":["ES256 JWK 비대칭 서명","aud 화이트리스트 (talo/mbti/chiyigo/sport-app)","5계층 검증: iss/aud/kid/nonce/fragment","RP Registry CRUD: 신규 RP 재배포 불필요","Backchannel logout: sid 인덱스 + 3방향 single sign-out"],"tech":["jose (JWT)","OIDC discovery","PKCE S256","Dynamic Client Registry"]},"email":{"purpose":"이메일 인증, 비밀번호 재설정, 이메일 연결. 모든 토큰은 atomic UPDATE...RETURNING으로 일회성 소비 — 재생 방지.","flow":["POST /api/auth/local/forgot-password","서버가 jti hash를 email_tokens에 저장","사용자가 링크 클릭 → POST /api/auth/local/reset-password","UPDATE email_tokens SET used_at=? WHERE jti=? AND used_at IS NULL RETURNING ...","RETURNING이 비어있음 → 사용됨/없음 → 거부"],"api":["POST /api/auth/email/send-verification","POST /api/auth/email/verify","POST /api/auth/local/forgot-password","POST /api/auth/local/reset-password","D1: email_tokens (jti, hash, used_at, expires_at)"],"security":["원자적 소비로 race condition 방지","토큰은 해시만 저장","15분 TTL","본인 이메일 재설정은 captcha 불필요, 타인은 필수","Resend API + 다중 키 로테이션"],"tech":["Resend","One-shot jti 토큰","D1 atomic write"]},"mfa":{"purpose":"TOTP 2FA + WebAuthn/Passkey + 고권한 작업 step-up. 2FA 비활성화 시 토큰 즉시 정리 + login.html?tfa_disabled=1 리디렉트.","flow":["활성화: dashboard에서 QR 표시 → otpauth URI → 6자리 OTP 검증","로그인: 비밀번호 후 → OTP / passkey assertion 추가","Step-up: 결제 / 비밀번호 변경 전 재MFA","elevated:* scope 단명 (5분) 일회성 토큰 발급","작업 완료 후 즉시 revoke"],"api":["POST /api/auth/2fa/setup","POST /api/auth/2fa/activate","POST /api/auth/2fa/verify","POST /api/auth/2fa/disable","POST /api/auth/2fa/backup-codes/regenerate","POST /api/auth/webauthn/register-options","POST /api/auth/webauthn/register-verify","POST /api/auth/webauthn/login-options","POST /api/auth/webauthn/login-verify","GET  /api/auth/webauthn/credentials","POST /api/auth/step-up","D1: user_2fa / webauthn_credentials"],"security":["otpauth secret 암호화 저장","WebAuthn challenge 일회성","Step-up token TTL 5분 + jti","2FA disable → bumpTokenVersion + graceful logout","requireStepUp 미들웨어"],"tech":["otpauth","@simplewebauthn/server","elevated:* scope claim","token-version bump"]},"device":{"purpose":"각 브라우저는 web-<uuid>를 localStorage에 저장; refresh token을 디바이스에 강제 결합; 불일치 시 디바이스 family 전체 revoke.","flow":["최초 로드 → web-<uuid> 생성 → localStorage","Refresh는 X-Device-Id 헤더 필수","서버 비교: 불일치 → user_id+device_id의 모든 refresh를 revoke","Dashboard에서 활성 디바이스 표시","사용자는 개별 / 전체 revoke 가능"],"api":["GET    /api/auth/devices","POST   /api/auth/devices/logout","POST   /api/auth/refresh (X-Device-Id required)","D1: refresh_tokens (user_id, device_id, family_id, revoked_at)"],"security":["디바이스 결합으로 cross-device refresh 차단","비정상 디바이스 → 이메일 + audit critical","국가 점프 audit","Passkey를 특정 디바이스에 결합","Rename으로 친숙한 이름 표시"],"tech":["localStorage UUID","family-based revocation","X-Device-Id header"]},"token":{"purpose":"JWT (ES256) access + refresh 듀얼 트랙. jti 블록리스트 (D1)로 즉시 무효화; scope catalog 세분화 인가; token-version bump으로 family 전체 캐스케이드 무효화.","flow":["로그인 성공 → access (15분) + refresh (30일) 서명","API access 수신: verifyJwt → jti 블록리스트 확인 → buildTokenScope","Refresh: 로테이션 + 이전 jti revoked","requireScope(\"payment.write\") 실패 → 401","Critical 변경 → bumpTokenVersion → 모든 토큰 즉시 무효화"],"api":["POST /api/auth/refresh","POST /api/auth/logout","POST /api/admin/revoke","GET  /api/auth/me","GET  /api/auth/userinfo","D1: refresh_tokens / revoked_jtis / token_versions"],"security":["ES256 비대칭 JWK","jti 블록리스트 즉시 적용","세분화된 scope catalog (payment/admin/audit/elevated)","Token-version bump = 전 디바이스 logout","Refresh rotation + reuse detection"],"tech":["jose ES256","D1 jti index","scope-based authz","version-bump cascade"]},"audit":{"purpose":"관리자 콘솔 + 22가지 audit 이벤트 + 구조화 로그 + traceId 미들웨어 + Discord critical 경고 + F-3 Phase 2 콜드 아카이브 (chunk + manifest를 R2에 저장, state_history 3단계로 변조 감지).","flow":["모든 endpoint → 미들웨어가 audit_log 발행","심각도: info / warn / critical","critical → 동기 Discord webhook","Admin Dashboard 필터: user_id / event / 시간 / severity","화이트리스트 이벤트만 삭제 가능, payment/refund는 불변","콜드 아카이브 job: D1 chunk + R2 manifest 작성 → chunk_verified + verified_at 검증 → state_history 3단계 추적"],"api":["GET    /api/admin/audit","DELETE /api/admin/audit/[id]","POST   /api/admin/cron/audit-archive (cron-triggered)","GET    /api/admin/users","POST   /api/admin/users/[id]/ban","POST   /api/admin/users/[id]/unban","GET/POST/PATCH/DELETE /api/admin/oauth-clients","GET    /api/admin/metrics","D1: audit_log / audit_archive (chunk + manifest)","R2: audit-archive bucket"],"security":["Critical 이벤트 삭제 불가","admin scope: admin.read / admin.write","Step-up은 2FA 필수","모든 admin 작업도 audit","Observability traceId 전체 추적","콜드 아카이브 manifest는 불변, state_history는 append-only로 소급 변조 불가"],"tech":["Cloudflare Real-time logs","traceId middleware","Discord webhook","admin RBAC","R2 cold archive","Phase F-3 Phase 2 manifest state_history"]},"kyc":{"purpose":"벤더 비종속 KYC 어댑터. 스키마는 특정 벤더에 결합되지 않으며 Sumsub / Onfido / Persona 교체는 어댑터 1파일로 완료.","flow":["dashboard /kyc → 서류 업로드","서버가 벤더 어댑터 호출 (현재 mock)","벤더 webhook → POST /api/webhooks/kyc/[vendor] 상태 업데이트","GET /api/auth/kyc/status로 상태 조회","status=approved → 출금 한도 해제"],"api":["GET  /api/auth/kyc/status","POST /api/webhooks/kyc/[vendor]","D1: kyc_sessions / kyc_documents"],"security":["벤더 어댑터 패턴","Webhook 서명 검증","PII 필드 암호화","출금 전 KYC 필수"],"tech":["Phase F-1","Adapter pattern","Encrypt-at-rest"]},"payment":{"purpose":"F-2 wave 1-7: 충전 / 환불 / 정산 / step-up / 2단계 환불 심사. ECPay AIO + CheckMacValue + 실기 신용카드로 End-to-End 검증 완료.","flow":["사용자 충전 → POST /api/auth/payments/intents","POST /api/auth/payments/checkout/ecpay → ECPay form","Webhook → POST /api/webhooks/payments/ecpay → CheckMacValue 검증","환불 신청: POST /api/payments/intents/[id]/refund-request","관리자 심사 (step-up + 2FA) → POST /api/admin/payments/intents/[id]/refund","정산: cron으로 ECPay vs D1 비교 (/api/admin/payments/aggregate)"],"api":["POST   /api/auth/payments/intents","GET    /api/auth/payments/intents/[id]","POST   /api/auth/payments/checkout/ecpay","POST   /api/payments/intents/[id]/refund-request","POST   /api/webhooks/payments/[vendor]","POST   /api/admin/payments/intents/[id]/refund","POST   /api/admin/payments/intents/[id]/delete","GET    /api/admin/payments/intents","GET    /api/admin/payments/aggregate","GET    /api/admin/payments/webhook-dlq","D1: payment_intents / refund_requests"],"security":["양방향 CheckMacValue 검증","subunit/raw 듀얼 금액 컬럼으로 반올림 버그 방지","환불 step-up + 2FA OTP","Hard delete + audit 화이트리스트","Webhook idempotency + DLQ"],"tech":["ECPay AIO","CheckMacValue","D1 cron 정산","step-up scope"]},"wallet":{"purpose":"EIP-4361 Sign-In with Ethereum 지갑 연결. MetaMask 연결 → SIWE 메시지 서명 → 서버에서 @noble/curves 기반 자체 구현 ecrecover 검증 → user_wallets INSERT. Phase F-3.","flow":["Dashboard → Connect MetaMask → eth_requestAccounts로 address 획득","GET /api/auth/wallet/nonce로 일회성 nonce 발급 (user + address 바인딩)","프론트에서 EIP-4361 메시지 (domain / chain_id / nonce / issued_at) 조립 → personal_sign","POST /api/auth/wallet/verify에 message + signature 전송","서버: 자체 구현 secp256k1 ecrecover + keccak256 → nonce.user_id 일치 + nonce.address 일치 → user_wallets INSERT","해제: DELETE /api/auth/wallet/[id] → critical audit"],"api":["GET    /api/auth/wallet/nonce","POST   /api/auth/wallet/verify","GET    /api/auth/wallet (목록)","DELETE /api/auth/wallet/[id]","D1: user_wallets / wallet_nonces"],"security":["nonce는 atomic UPDATE...RETURNING으로 일회성 소비, replay 방지","nonce.user_id는 현재 user와 일치 필수, MITM 재바인딩 차단","nonce.address는 SIWE 메시지 address와 일치 필수, address 교체 차단","domain + chain_id를 SIWE 메시지에 포함, cross-site / cross-chain replay 차단","바인딩/해제 모두 critical audit 작성 (결제 전제 조건)","UNIQUE (user_id, address) 충돌 → 409"],"tech":["EIP-4361 SIWE","@noble/curves secp256k1","자체 구현 keccak256 ecrecover","MetaMask provider","Phase F-3"]}},"picker_label":"모듈 선택","picker_placeholder":"— 모듈 선택 —"}};
    const STAGE = document.getElementById('cp-stage');
    const SVG = document.getElementById('cp-lines');
    const PANEL = document.getElementById('cp-panel');
    const PANEL_EMPTY = document.getElementById('cp-panel-empty');
    const PANEL_BODY = document.getElementById('cp-panel-body');
    const PANEL_TAG = document.getElementById('cp-panel-tag');
    const PANEL_TITLE = document.getElementById('cp-panel-title');
    const PANEL_PURPOSE = document.getElementById('cp-panel-purpose');
    const PANEL_FLOW = document.getElementById('cp-panel-flow');
    const PANEL_API = document.getElementById('cp-panel-api');
    const PANEL_SECURITY = document.getElementById('cp-panel-security');
    const PANEL_TECH = document.getElementById('cp-panel-tech');
    const PANEL_CLOSE = document.getElementById('cp-panel-close');
    const PICKER = document.getElementById('cp-domain-select');
    const PICKER_LABEL = document.querySelector(isEmbed ? '#cp-arch-embed .cp-panel-picker-label' : '.cp-panel-picker-label');
    let activeId = null;
    let curLang = localStorage.getItem('lang') || 'zh-TW';
    const isMobile = () => window.matchMedia('(max-width: 960px)').matches;
    const tDict = () => LANGS_I18N[curLang] || LANGS_I18N['en'] || {};
    const tFallback = () => LANGS_I18N['en'] || LANGS_I18N['zh-TW'] || {};
    const nodeLabel = n => {
        const t = tDict(), fb = tFallback();
        return t['node_' + n.id] || fb['node_' + n.id] || n.id;
    };
    const getDetails = id => {
        const t = tDict(), fb = tFallback();
        return (t.details && t.details[id]) || (fb.details && fb.details[id]) || null;
    };
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    function buildNodes() {
        if (!STAGE)
            return;
        STAGE.querySelectorAll('.cp-node').forEach(el => el.remove());
        const core = document.createElement('button');
        core.type = 'button';
        core.className = 'cp-node cp-node-core';
        core.dataset.id = 'core';
        core.style.left = CORE.x + '%';
        core.style.top = CORE.y + '%';
        core.innerHTML = `<span class="cp-node-dot"></span><span>CHIYIGO 會員系統<span class="cp-node-core-sub">// IAM Platform</span></span>`;
        STAGE.appendChild(core);
        for (const n of NODES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cp-node';
            btn.dataset.id = n.id;
            btn.style.left = n.x + '%';
            btn.style.top = n.y + '%';
            btn.innerHTML = `<span class="cp-node-dot"></span><span class="cp-node-label">${nodeLabel(n)}</span>`;
            STAGE.appendChild(btn);
        }
    }
    function buildLines() {
        if (!STAGE || !SVG)
            return;
        if (isMobile()) {
            SVG.innerHTML = '';
            return;
        }
        const w = STAGE.clientWidth, h = STAGE.clientHeight;
        SVG.setAttribute('viewBox', `0 0 ${w} ${h}`);
        SVG.innerHTML = '';
        const cx = CORE.x / 100 * w, cy = CORE.y / 100 * h;
        for (const n of NODES) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(cx));
            line.setAttribute('y1', String(cy));
            line.setAttribute('x2', String(n.x / 100 * w));
            line.setAttribute('y2', String(n.y / 100 * h));
            line.dataset.from = 'core';
            line.dataset.to = n.id;
            SVG.appendChild(line);
        }
        for (const [a, b] of EDGES) {
            const na = NODES.find(x => x.id === a), nb = NODES.find(x => x.id === b);
            if (!na || !nb)
                continue;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(na.x / 100 * w));
            line.setAttribute('y1', String(na.y / 100 * h));
            line.setAttribute('x2', String(nb.x / 100 * w));
            line.setAttribute('y2', String(nb.y / 100 * h));
            line.dataset.from = a;
            line.dataset.to = b;
            line.setAttribute('stroke-dasharray', '3 4');
            SVG.appendChild(line);
        }
    }
    // renderPanel / clearPanel：原 .js 不對 PANEL_EMPTY/PANEL_BODY/PANEL_TAG/... 做 null
    // guard，直接 dereference；標準頁面 markup 全含這些 ID。用非空斷言保留原 throw 語意。
    function renderPanel(id) {
        const n = NODES.find(x => x.id === id);
        const d = getDetails(id);
        if (!n || !d)
            return;
        PANEL_EMPTY.hidden = true;
        PANEL_BODY.hidden = false;
        PANEL_TAG.textContent = n.tag;
        PANEL_TITLE.textContent = nodeLabel(n);
        PANEL_PURPOSE.textContent = d.purpose;
        PANEL_FLOW.innerHTML = d.flow.map(s => `<li>${esc(s)}</li>`).join('');
        PANEL_API.innerHTML = d.api.map(s => `<li>${esc(s)}</li>`).join('');
        PANEL_SECURITY.innerHTML = d.security.map(s => `<li>${esc(s)}</li>`).join('');
        PANEL_TECH.innerHTML = d.tech.map(s => `<span>${esc(s)}</span>`).join('');
    }
    function clearPanel() {
        PANEL_BODY.hidden = true;
        PANEL_EMPTY.hidden = false;
    }
    function buildPicker() {
        if (!PICKER)
            return;
        const t = tDict(), fb = tFallback();
        PICKER.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = t.picker_placeholder || fb.picker_placeholder || '— —';
        PICKER.appendChild(ph);
        for (const n of NODES) {
            const opt = document.createElement('option');
            opt.value = n.id;
            opt.textContent = nodeLabel(n);
            PICKER.appendChild(opt);
        }
        PICKER.value = activeId || '';
        if (PICKER_LABEL) {
            const lbl = t.picker_label || fb.picker_label || '';
            if (lbl) {
                PICKER_LABEL.textContent = lbl;
                PICKER.setAttribute('aria-label', lbl);
            }
        }
    }
    function isConnected(a, b) {
        if (a === b)
            return true;
        return EDGES.some(e => (e[0] === a && e[1] === b) || (e[1] === a && e[0] === b));
    }
    function setActive(id) {
        if (id === 'core')
            id = null;
        activeId = id;
        STAGE.querySelectorAll('.cp-node').forEach(el => {
            const eid = el.dataset.id;
            el.classList.toggle('active', eid === id);
            el.classList.toggle('dim', !!id && eid !== id && eid !== 'core' && !isConnected(id, eid));
        });
        SVG?.querySelectorAll('line').forEach(l => {
            const isHit = id && (l.dataset.from === id || l.dataset.to === id);
            l.classList.toggle('active', !!isHit);
            l.classList.toggle('dim', !!id && !isHit);
        });
        if (id)
            renderPanel(id);
        else
            clearPanel();
        if (PICKER)
            PICKER.value = id || '';
        // 手機板：只在 panel 還不在視窗內時才滾動，避免每次切節點都被往下拉
        if (id && isMobile() && PANEL) {
            const r = PANEL.getBoundingClientRect();
            const inView = r.top < window.innerHeight && r.bottom > 0;
            if (!inView)
                setTimeout(() => PANEL.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        }
    }
    if (STAGE) {
        STAGE.addEventListener('click', e => {
            const btn = e.target?.closest('.cp-node');
            if (!btn)
                return;
            const id = btn.dataset.id;
            if (id === 'core') {
                setActive(null);
                return;
            }
            if (id === activeId)
                setActive(null);
            else
                setActive(id);
        });
        PANEL_CLOSE?.addEventListener('click', () => setActive(null));
        PICKER?.addEventListener('change', e => setActive(e.target?.value || null));
        let resizeT;
        window.addEventListener('resize', () => {
            clearTimeout(resizeT);
            resizeT = setTimeout(() => buildLines(), 120);
        });
    }
    // ── 共用：套用語言到 widget（節點 label + 面板 + embed [data-i18n]） ──
    function applyArchLang(lang) {
        if (!LANGS_I18N[lang])
            return;
        curLang = lang;
        STAGE?.querySelectorAll('.cp-node').forEach(el => {
            const id = el.dataset.id;
            if (id === 'core')
                return;
            const n = NODES.find(x => x.id === id);
            if (n) {
                const lbl = el.querySelector('.cp-node-label');
                if (lbl)
                    lbl.textContent = nodeLabel(n);
            }
        });
        if (activeId)
            renderPanel(activeId);
        buildPicker();
        // embed 模式：init + 切換都走這條，避免首訪非 zh-TW 卡 HTML 預設
        if (isEmbed) {
            const t = LANGS_I18N[lang];
            document.querySelectorAll('#cp-arch-embed [data-i18n]').forEach(el => {
                const k = el.dataset.i18n;
                if (k && t[k] !== undefined)
                    el.textContent = t[k];
            });
        }
    }
    // embed 模式：暴露給 host (index.ts) 在 applyLangI 結尾呼叫
    // 走 WindowWithCpArchEmbed alias（per PR-5q index.ts WindowWithArchEmbed consumer 反向對齊）
    window.cpArchSetLang = function (lang) { applyArchLang(lang); };
    // ── Init widget ──
    if (STAGE) {
        buildNodes();
        buildLines();
        applyArchLang(curLang);
        // standalone 預設選 login；embed 預設空 panel 讓 hint 誘導
        if (!isEmbed && !isMobile())
            setActive('login');
    }
    // ──────────────────────────────────────────────────────────────
    // 以下為 standalone (case-platform.html) 專屬：
    // embed 模式下 index.ts 已處理同樣行為，跳過避免重複綁。
    // ──────────────────────────────────────────────────────────────
    if (isEmbed) {
        return;
    }
    // ── i18n（standalone full applyLang） ──
    function applyLang(lang) {
        if (!LANGS_I18N[lang])
            return;
        const t = LANGS_I18N[lang];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const k = el.dataset.i18n;
            if (k && t[k] !== undefined)
                el.textContent = t[k];
        });
        const tBtn = document.getElementById('theme-toggle-btn');
        const mTBtn = document.getElementById('m-theme-btn');
        const lBtn = document.getElementById('lang-toggle-btn');
        if (tBtn) {
            tBtn.title = t.tooltip_theme;
            tBtn.setAttribute('aria-label', t.tooltip_theme);
        }
        if (mTBtn)
            mTBtn.title = t.tooltip_theme;
        if (lBtn) {
            lBtn.title = t.tooltip_lang;
            lBtn.setAttribute('aria-label', t.tooltip_lang);
        }
        document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
        document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
        localStorage.setItem('lang', lang);
        applyArchLang(lang);
    }
    const langToggleBtn = document.getElementById('lang-toggle-btn');
    const langDropdown = document.getElementById('lang-dropdown');
    langToggleBtn?.addEventListener('click', e => { e.stopPropagation(); langDropdown?.classList.toggle('open'); });
    document.addEventListener('click', () => langDropdown?.classList.remove('open'));
    langDropdown?.addEventListener('click', e => {
        const opt = e.target?.closest('.lang-opt');
        if (!opt)
            return;
        applyLang(opt.dataset.lang);
        langDropdown.classList.remove('open');
    });
    document.getElementById('m-overlay')?.addEventListener('click', e => {
        const opt = e.target?.closest('.m-ov-lang-opt');
        if (!opt)
            return;
        applyLang(opt.dataset.lang);
    });
    function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop')?.classList.toggle('open'); }
    // Stage 5 PR-5r cleanup：移除 `window.toggleTopLangDrop = toggleTopLangDrop;`
    // ← 原為 inline onclick="toggleTopLangDrop(event)" HTML 殘骸（CSP D 後已禁 inline
    //   handler）；grep 顯示無任何 external caller 讀 `window.toggleTopLangDrop`，
    //   函式本檔 standalone 區段內透過下方 #m-lang-btn 直接 wire，不必經 window 中介。
    //   同 [[project_js_to_ts_stage5_plan]] portfolio.ts PR-5i 立樁的 cleanup 路徑。
    document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
    document.getElementById('m-top-lang-drop')?.addEventListener('click', e => {
        const opt = e.target?.closest('.lang-opt');
        if (!opt)
            return;
        applyLang(opt.dataset.lang);
        document.getElementById('m-top-lang-drop').classList.remove('open');
    });
    document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);
    applyLang(curLang);
    // ── Mobile overlay / drag-close ──（與 portfolio.ts 同款）
    const hamBtn = document.getElementById('m-ham-btn');
    const overlay = document.getElementById('m-overlay');
    const topbar = document.getElementById('m-topbar');
    function openMenu() { hamBtn?.setAttribute('aria-expanded', 'true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
    function closeMenu() { hamBtn?.setAttribute('aria-expanded', 'false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden', 'true'); topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
    hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
    overlay?.addEventListener('click', e => { if (e.target === overlay)
        closeMenu(); });
    overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open'))
        closeMenu(); });
    ;
    (function () {
        const THRESHOLD = 110;
        let startY = 0, lastY = 0, active = false;
        document.addEventListener('touchstart', e => {
            const ov = document.getElementById('m-overlay');
            if (!ov || !ov.classList.contains('is-open'))
                return;
            const wrap = ov.querySelector('.m-ov-wrap');
            if (!wrap)
                return;
            const t = e.touches[0], r = wrap.getBoundingClientRect();
            if (t.clientY < r.top || t.clientY > r.bottom)
                return;
            const nav = wrap.querySelector('.m-ov-nav');
            if (nav && nav.scrollTop > 0) {
                const nr = nav.getBoundingClientRect();
                if (t.clientY >= nr.top && t.clientY <= nr.bottom)
                    return;
            }
            startY = t.clientY;
            lastY = startY;
            active = true;
            wrap.style.transition = 'none';
        }, { passive: true });
        document.addEventListener('touchmove', e => {
            if (!active)
                return;
            lastY = e.touches[0].clientY;
            const dy = lastY - startY;
            if (dy <= 0)
                return;
            const ov = document.getElementById('m-overlay');
            const wrap = ov && ov.querySelector('.m-ov-wrap');
            if (!wrap || !ov)
                return;
            wrap.style.transform = `translateY(${dy}px)`;
            const ratio = Math.max(0, 1 - dy / wrap.offsetHeight * 1.5);
            ov.style.background = `rgba(10,12,28,${(0.32 * ratio).toFixed(3)})`;
            e.preventDefault();
        }, { passive: false });
        document.addEventListener('touchend', () => {
            if (!active)
                return;
            active = false;
            const ov = document.getElementById('m-overlay');
            const wrap = ov && ov.querySelector('.m-ov-wrap');
            if (!wrap || !ov) {
                startY = 0;
                lastY = 0;
                return;
            }
            const dy = lastY - startY;
            ov.style.background = '';
            if (dy > THRESHOLD) {
                wrap.style.transition = 'transform .26s ease';
                wrap.style.transform = 'translateY(100%)';
                setTimeout(() => { wrap.style.transform = ''; wrap.style.transition = ''; ov.classList.remove('is-open'); ov.setAttribute('aria-hidden', 'true'); const btn = document.getElementById('m-ham-btn'); btn?.classList.remove('is-open'); btn?.setAttribute('aria-expanded', 'false'); document.getElementById('m-topbar')?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }, 260);
            }
            else {
                wrap.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1)';
                wrap.style.transform = '';
                setTimeout(() => { wrap.style.transition = ''; }, 420);
            }
            startY = 0;
            lastY = 0;
        }, { passive: true });
    })();
    // ── Theme toggle ──
    const themeBtn = document.getElementById('theme-toggle-btn');
    const mThemeBtn = document.getElementById('m-theme-btn');
    function applyTheme(dark) {
        document.documentElement.classList.toggle('theme-dark', dark);
        document.documentElement.classList.toggle('theme-light', !dark);
        [themeBtn, mThemeBtn].forEach(btn => {
            if (!btn)
                return;
            const sun = btn.querySelector('.icon-sun'), moon = btn.querySelector('.icon-moon');
            if (sun)
                sun.hidden = dark;
            if (moon)
                moon.hidden = !dark;
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
    // ── Reveal animation ──
    const osContent = document.getElementById('os-content');
    const revRoot = window.innerWidth > 768 ? osContent : null;
    const revObs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) {
            e.target.classList.add('revealed');
            revObs.unobserve(e.target);
        } });
    }, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));
    // ── Neural canvas (與 portfolio.ts 同款；尊重 prefers-reduced-motion) ──
    (function () {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
            return;
        const canvas = document.getElementById('neural-canvas');
        if (!canvas)
            return;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        let W = 0, H = 0, nodes = [];
        const DIST = 155;
        function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
        function initNodes() { const n = W < 768 ? 48 : 115; nodes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28, r: Math.random() * 1.1 + .4, pulse: Math.random() * Math.PI * 2 })); }
        const mouse = { x: -9999, y: -9999 };
        document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
        let cfg = { r: '108', g: '110', b: '229', no: .22, lo: .09 };
        function syncCfg() { const s = getComputedStyle(document.documentElement); cfg = { r: s.getPropertyValue('--neural-r').trim() || '108', g: s.getPropertyValue('--neural-g').trim() || '110', b: s.getPropertyValue('--neural-b').trim() || '229', no: parseFloat(s.getPropertyValue('--neural-node-opacity').trim() || '.22'), lo: parseFloat(s.getPropertyValue('--neural-line-opacity').trim() || '.09') }; }
        syncCfg();
        new MutationObserver(syncCfg).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        function draw() {
            ctx.clearRect(0, 0, W, H);
            const { r, g, b, no, lo } = cfg;
            for (const n of nodes) {
                const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
                if (d2 < 16900) {
                    const d = Math.sqrt(d2);
                    n.vx += dx / d * .055;
                    n.vy += dy / d * .055;
                }
                n.vx *= .982;
                n.vy *= .982;
                n.x += n.vx;
                n.y += n.vy;
                if (n.x < -12)
                    n.x = W + 12;
                else if (n.x > W + 12)
                    n.x = -12;
                if (n.y < -12)
                    n.y = H + 12;
                else if (n.y > H + 12)
                    n.y = -12;
                n.pulse += .011;
                const p = Math.sin(n.pulse) * .25 + .75;
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.r * p, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${r},${g},${b},${no * p})`;
                ctx.fill();
            }
            for (let i = 0; i < nodes.length; i++)
                for (let j = i + 1; j < nodes.length; j++) {
                    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy;
                    if (d2 < DIST * DIST) {
                        const a = (1 - Math.sqrt(d2) / DIST) * lo;
                        ctx.beginPath();
                        ctx.moveTo(nodes[i].x, nodes[i].y);
                        ctx.lineTo(nodes[j].x, nodes[j].y);
                        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
                        ctx.lineWidth = .5;
                        ctx.stroke();
                    }
                }
            requestAnimationFrame(draw);
        }
        resize();
        initNodes();
        draw();
        window.addEventListener('resize', () => { resize(); initNodes(); });
    })();
})();
