# CHIYIGO.COM 建構計畫

**架構**：MPA + Cloudflare Pages Functions + D1 SQLite  
**風格**：Arshire Style — Tailwind CSS + Vanilla JS，零框架  
**IAM 定位**：全端跨平台統一身份中心（Web / Unity / Unreal / iOS / Android）

---

## 整體進度快照（2026-04-25 更新）

| 模組 | 狀態 |
|------|------|
| 靜態站 + SEO | ✅ 完成（全站 Sidebar 統一 6 項、預設深色主題、2026-04-25）|
| D1 Schema（全量） | ✅ 已部署至 `chiyigo_db`（含 pkce_sessions + auth_codes）|
| Auth 核心（註冊/登入/2FA） | ✅ 完成，遠端 DB 驗證通過 2026-04-23 |
| ES256 JWT + JWKS | ✅ 完成 |
| Refresh Token 輪換 | ✅ 完成，Replay 防護通過 |
| Discord OAuth | ✅ 完成，線上測試通過 2026-04-23 |
| CORS 防禦層 | ✅ 完成 |
| Admin API（封禁/解封/列表） | ✅ 完成，線上測試通過 2026-04-23 |
| Logout / Revoke Token | ✅ 完成 |
| PKCE 跨平台 OAuth（authorize/code/token） | ✅ 完成 |
| Android App Link（assetlinks.json） | ✅ 完成，package_name 佔位符待 App 建立後更新 |
| 使用者儀表板（dashboard.html） | ✅ 完成，線上驗證通過 2026-04-23 |
| HttpOnly Cookie 雙軌制（Web XSS 防禦） | ✅ 完成，密碼 + Discord 登入均驗證通過 2026-04-23 |
| D1 垃圾回收 Cron Trigger | ✅ 完成（GitHub Actions `cleanup.yml`，每日 UTC 03:00）|
| Discord 登入按鈕（login.html UI） | ✅ 完成 2026-04-23（登入 + 註冊分頁均已加入）|
| Dashboard UX 強化（bfcache 防禦 + 靜默刷新） | ✅ 完成 2026-04-23 |
| Email 驗證 + 忘記密碼 | ✅ 完成（Stage 17，2026-04-24）|
| 動態 OAuth 路由（Google/LINE/FB） | ✅ 完成（Stage 18；Google ✅ LINE ✅ 碰撞防禦 ✅；Facebook 暫緩——目標用戶以遊戲玩家為主，Discord/Google/LINE 已足夠）|
| 首頁重設計（新設計系統） | ✅ 完成（Stage 19，2026-04-25）|
| login.html / portfolio.html 風格同步 | ✅ 完成（2026-04-25；mobile overlay 統一 is-open、6 項導覽、接案中徽章）|
| LINE OAuth Published | ✅ 完成（2026-04-25；LINE Developers Console → Published，全用戶可用）|
| 全站 Logo 可點擊（回首頁） | ✅ 完成（2026-04-25；所有頁面 sidebar .sb-brand 改為 `<a href="/">`）|
| 會員登入入口 | ✅ 完成（2026-04-25；Sidebar 底部「👤 會員登入」連結 + Mobile TopBar 人像圖示，5 頁全覆蓋）|
| Mobile overlay 手勢 + Bug 修復 | ✅ 完成（2026-04-25；向下拖曳關閉；about.html overlay nav 補齊 6 項 + 修正「聯絡我們」→「接案諮詢」；about/portfolio/requisition 補 backdrop click 關閉）|
| mbti.chiyigo.com IAM 整合 | ✅ 完成（2026-04-25；Method A — 完整 PKCE 替換；chiyigo.com 側 3 個端點更新 + mbti 側 15 個檔案更新）|
| mbti.chiyigo.com 加入作品集 | ✅ 完成（2026-04-25；D1 portfolio 表 id=7 插入，category=System，sort_order=0，tags: Cloudflare Workers/D1 SQLite/OAuth PKCE/MBTI/認知評估）|
| iOS Universal Link（apple-app-site-association） | 🔒 待辦（需 Apple Developer $99/yr）|

---

## 建構步驟

### 階段一：專案骨架
- [x] 1.1 建立目錄結構（public/, functions/api/）
- [x] 1.2 建立 `wrangler.toml`（Cloudflare Pages 設定）
- [x] 1.3 建立 D1 Schema（`schema.sql`）
- [x] 1.4 建立 `tailwind.config.js`

### 階段二：前端頁面
- [x] 2.1 `index.html` — 靜態首頁（Hero + 服務 + CTA）
- [x] 2.2 `portfolio.html` — 動態作品集（fetch GET /api/portfolio）
- [x] 2.3 `requisition.html` — 需求表單（POST /api/requisition）

### 階段三：後端 API（Cloudflare Pages Functions）
- [x] 3.1 `functions/api/portfolio.js` — GET，查詢 D1
- [x] 3.2 `functions/api/requisition.js` — POST，寫入 D1 + Telegram 警報

### 階段四：部署準備
- [x] 4.1 建立 `.gitignore`
- [x] 4.2 驗證 wrangler 設定
- [x] 4.3 部署至 Cloudflare Pages（wrangler CLI）

### 階段五：內容管理工具
- [x] 5.1 `scripts/portfolio-add.mjs` — 互動式新增作品集（Node CLI）
- [x] 5.2 `scripts/portfolio-list.mjs` — 列出 / 刪除作品（Node CLI）
- [x] 5.3 `scripts/portfolio-remote.sql` — 遠端 D1 管理 SQL 範本

### 階段六：SEO 與效能
- [x] 6.1 Open Graph / Twitter Card meta — 三頁面
- [x] 6.2 `sitemap.xml`
- [x] 6.3 `robots.txt`（requisition & api 禁止索引）
- [x] 6.4 Cloudflare Web Analytics（token be8c93... 已填入三頁面）

### 階段七：上線後收尾
- [x] 7.1 chiyigo.com DNS 驗證完成，SSL 啟用
- [ ] 7.2 www.chiyigo.com 重導向（等待 Cloudflare DNS 自動 active）
- [x] 7.3 Cloudflare Web Analytics token 填入三頁面
- [x] 7.4 製作並上傳 OG 封面圖（public/images/chiyigo.jpg）
- [x] 7.5 提交 sitemap 至 Google Search Console（已收錄）
- [x] 7.6 GitHub Actions CI/CD（deploy.yml + CLOUDFLARE_API_TOKEN）
- [ ] 7.7 Search Console 搜尋流量數據（約 1–3 天後出現，確認後打勾）

---

## 階段二十：網站維護補強（2026-04-25）

### P1 — 功能修正

| 項目 | 狀態 | 說明 |
|------|------|------|
| P1.1 nav 標籤同步 | ✅ 完成 | `index.html` sidebar/overlay "聯絡我們"→"接案諮詢"；overlay 狀態文字"接受需求中"→"接案中"；補上缺少的 mobile overlay close handler |
| P1.2 light mode 輸入框 hover | ✅ 完成 | `requisition.html` field-input/select hover/focus 背景從硬編碼 `#080c14`（dark）改為 `var(--bg-elevated)`；dark mode 以 `.theme-dark` selector 保留原樣 |

### P2 — 功能優化

| 項目 | 狀態 | 說明 |
|------|------|------|
| P2.1 service_type 選項 | ✅ 完成 | 新增「品牌識別 / 視覺設計」`branding` 與「數位行銷 / SEO」`marketing` 兩個選項 |
| P2.2 關於我們頁面 | ✅ 完成 | 建立 `public/about.html`（含簡介、統計數字、技術棧、合作理念、CTA）；全站 sidebar + mobile overlay 新增「關於我們」導覽項 |
| P2.3 後台諮詢紀錄 | ✅ 完成 | 建立 `GET /api/admin/requisitions`（admin 權限，支援分頁+關鍵字搜尋）；建立 `public/admin-requisitions.html`（JWT auth，表格 + 詳情 Modal） |

---

## 階段八：零依賴高安規全端認證系統

> **架構**：Cloudflare Pages Functions + D1 + Web Crypto API + jose + otpauth

- [x] 8.1 `package.json` + `npm install jose otpauth`
- [x] 8.2 `database/schema_auth.sql`（8 張資安合規表）
- [x] 8.3 `functions/utils/crypto.js`（PBKDF2 10萬次 + Salt + 救援碼）
- [x] 8.4 `functions/api/auth/local/register.js`（含 guest_id 綁定 Transaction）
- [x] 8.5 `functions/api/auth/local/login.js`（密碼驗證 + 2FA 分支 + fakeHashDelay）
- [x] 8.6 `functions/api/auth/2fa/setup.js`（產生 TOTP Secret）
- [x] 8.7 `functions/api/auth/2fa/activate.js`（驗 OTP + 啟用 + 備用碼）
- [x] 8.8 `functions/api/auth/2fa/verify.js`（登入時 TOTP + 備用碼原子核銷）
- [x] 8.9 `functions/api/auth/delete.js`（合規 Soft/Hard Delete）
- [x] 8.10 `public/login.html`（Arshire 全螢幕視圖，確認密碼欄位）
- [x] 8.11 `public/js/auth-ui.js`（密碼 10 秒自動隱藏、guest_id、JWT 流程）

---

## 階段九：ES256 零信任安全升級

> **目標**：禁用 HS256 共用密鑰，改採 ES256 非對稱加密，IAM 作為公鑰分發中心。

- [x] 9.1 `functions/utils/jwt.js`（ES256 signJwt / verifyJwt，模組級金鑰快取）
- [x] 9.2 `scripts/generate-jwt-keys.mjs`（一次性金鑰對生成腳本）
- [x] 9.3 `functions/utils/auth.js` — ES256 公鑰驗證
- [x] 9.4 register.js / login.js / 2fa/verify.js 全部改用 signJwt()
- [x] 9.5 `functions/.well-known/jwks.json.js`（RFC 7517，CORS 全開）

---

## 階段十：遊戲平台 JWT 擴充

> **目標**：JWT payload 加入 role / status，支援遊戲伺服器無狀態鑑權與即時封禁。

- [x] 10.1 `schema_auth.sql` — users 新增 `role`/`status`；user_identities 新增遊戲平台欄位
- [x] 10.2 `auth.js` — requireAuth 新增 banned 攔截（403 ACCOUNT_BANNED）
- [x] 10.3 login.js / register.js / 2fa/verify.js — JWT payload 加入 role / status
- [x] 10.4 `functions/api/auth/me.js` — 即時 DB 狀態查詢

---

## 階段十一：遊戲端登入 + 裝置綁定 + Discord OAuth

> **目標**：Discord OAuth MVP + 硬體 device_uuid 綁定 Refresh Token + 遊戲端 PKCE 統整入口

### 對齊決策記錄
| 問題 | 決策 |
|------|------|
| PC/Desktop 喚醒方式 | Loopback `http://127.0.0.1:PORT/callback`（RFC 8252）|
| Mobile 喚醒方式 | Custom URI Scheme `chiyigo://auth/callback` |
| 裝置綁定欄位 | `device_uuid`（由遊戲引擎傳入）|
| Discord redirect_uri | 永遠指向 IAM 伺服器，平台差異在 client_callback 處理 |

- [x] 11.1 `database/schema_iam_fresh.sql`（全量建表，含 device_uuid / platform / client_callback）
- [x] 11.2 `functions/api/auth/discord/init.js`（PKCE + platform routing + Discord 重導向）
- [x] 11.3 `functions/api/auth/discord/callback.js`（原子 state 核銷 + Upsert + JWT + 三平台分流）
- [x] 11.4 Discord Dev Portal 設定（Redirect URI + Client ID/Secret）
- [x] 11.5 Cloudflare 環境變數（DISCORD_CLIENT_ID/SECRET + IAM_BASE_URL）
- [x] 11.6 `functions/api/auth/local/login.js` — 登入同步簽發 refresh_token（含 device_uuid）
- [x] 11.7 `functions/api/auth/2fa/verify.js` — 同步簽發 refresh_token
- [x] 11.8 `functions/api/auth/refresh.js`（device_uuid 驗證 + token 輪換原子操作）
- [x] 11.9 `functions/api/auth/game/login.js`（依平台回傳 SSO URL，遊戲端開系統瀏覽器用）

---

## 階段十二：CORS 防禦層 + Admin API

- [x] 12.1 `functions/utils/cors.js`（統一 CORS helper，支援 env.ALLOWED_ORIGINS 白名單）
- [x] 12.2 `functions/api/auth/_middleware.js`（/api/auth/* 全路由 CORS + OPTIONS preflight）
- [x] 12.3 `functions/api/admin/_middleware.js`（/api/admin/* 同上）
- [x] 12.4 `functions/utils/requireRole.js`（角色層級中介軟體，player<moderator<admin<developer）
- [x] 12.5 `POST /api/admin/users/[id]/ban`（封禁 + 原子撤銷所有 refresh_token + 角色保護）
- [x] 12.6 `POST /api/admin/users/[id]/unban`（解封 + 角色保護）
- [x] 12.7 `GET /api/admin/users`（分頁列表 + status / role / email 篩選）

---

## 階段十三：PKCE 跨平台 OAuth

> **動機**：Unity / Unreal / iOS / Android 原生 App 透過 PKCE 授權碼流程喚起 IAM 登入頁，
> 登入後將 code 透過 Custom URI Scheme 回傳 App 換取 token。

### 跨平台 redirect_uri 矩陣
| 客戶端 | redirect_uri | 說明 |
|--------|-------------|------|
| Web SPA | `https://chiyigo.com/callback` | 標準 HTTPS |
| iOS (Universal Link) | `https://chiyigo.com/app/callback` | 需 Apple Developer |
| Android (App Link) | `https://chiyigo.com/app/callback` | Google 驗證域 |
| Unity / Unreal | `chiyigo://auth/callback` | Custom URI Scheme |
| Desktop Launcher | `http://127.0.0.1:PORT/callback` | Loopback |

- [x] 13.1 `GET /api/auth/oauth/authorize`（驗參數 → 存 pkce_session → 302 login.html?pkce_key=）
- [x] 13.2 `POST /api/auth/oauth/code`（登入後由 login.html 呼叫，生成一次性 auth code）
- [x] 13.3 `POST /api/auth/oauth/token`（code + code_verifier → token，DELETE RETURNING 防重放）
- [x] 13.4 `redirect_uri` 白名單（https://chiyigo.com/ + chiyigo:// + loopback）
- [x] 13.5 `login.html` PKCE 模式（偵測 ?pkce_key=，顯示 App 授權提示，登入後跳回 App）
- [x] 13.6 `utils/crypto.js` 新增 `pkceVerify()`（BASE64URL SHA-256 驗證）
- [x] 13.7 DB 新增 `pkce_sessions` + `auth_codes` 兩張表，已部署至 chiyigo_db
- [ ] 13.8 `/.well-known/apple-app-site-association`（iOS Universal Link）🔒 需 Apple Developer
- [x] 13.9 `/.well-known/assetlinks.json`（Android App Link，佔位符已建立，待填入真實 SHA-256）

### Unity / Unreal 接入步驟（SDK 文件）
```
1. 生成 code_verifier（32 bytes random hex）
2. code_challenge = BASE64URL(SHA256(code_verifier))
3. GET /api/auth/oauth/authorize?response_type=code
       &redirect_uri=chiyigo://auth/callback
       &code_challenge=<challenge>
       &code_challenge_method=S256
       &state=<random>
4. 監聽 chiyigo://auth/callback?code=...&state=... 回傳
5. POST /api/auth/oauth/token { code, code_verifier, redirect_uri }
6. 取得 access_token + refresh_token（30 天）
```

---

## 階段十四：Logout（已完成）

- [x] 14.1 `POST /api/auth/logout`（撤銷 refresh_token，冪等設計，無需 access_token）
- [x] 14.2 `auth-ui.js` — 存 refresh_token 到 sessionStorage；`logout()` 函數撤銷後清除本地 session
- [x] 14.3 `register.js` — 補上 refresh_token 回傳（與 login.js 對齊）
- [x] 14.4 登出按鈕整合至 dashboard.html（Stage 15 已完成）

---

## 已知問題 / 技術債

| 項目 | 說明 | 優先度 |
|------|------|--------|
| ~~登出後按瀏覽器上一頁顯示 dashboard~~ | ✅ 已修復 2026-04-23（`pagehide` 重置 UI 至 spinner，`pageshow` 重驗證；消除 bfcache 閃爍與靜默刷新）| — |
| ~~HttpOnly Cookie 密碼登入回歸~~ | ✅ 已修復 2026-04-23（commit `63b2dfe`：`new Response(body, response)` 還原法，消除 getAll 相容性風險）| — |
| ~~Discord OAuth HttpOnly Cookie 未儲存~~ | ✅ 已修復 2026-04-23，與密碼登入同一根因 | — |
| ~~register.js 未回傳 refresh_token~~ | ✅ 已修復 2026-04-23 | — |
| ~~chiyigo-db（13ecc734...）~~ | ✅ 已刪除 2026-04-23 | — |
| www.chiyigo.com 重導向 | 等待 Cloudflare DNS 驗證通過後自動生效 | 自動 |
| ~~2FA setup 1101 錯誤~~ | ✅ 已修復 2026-04-24（`Secret.generate()` CF Workers 相容性問題，改用 Web Crypto base32 自生成）| — |
| ~~註冊失敗~~ | ✅ 已修復 2026-04-24（`register.js` batch INSERT 缺少 `token_type`，Stage 17 schema 加了 NOT NULL 欄位後 constraint violation）| — |
| ~~登入後按上一頁顯示帳密 / 停在 2FA 面板~~ | ✅ 已修復 2026-04-24（`pageshow` bfcache 還原：有 token → 跳回 dashboard；無 token → 清空欄位並重置至登入分頁）| — |
| ~~遠端 DB 缺少 Auth schema~~ | ✅ 已部署 2026-04-23，14 張資料表全部到位 | — |
| ~~schema_iam_fresh.sql 未同步~~ | ✅ pkce_sessions + auth_codes 已加入 2026-04-23 | — |
| ~~登出按鈕 UI~~ | ✅ 已整合至 dashboard.html，Header + 底部按鈕均已完成 2026-04-23 | — |

---

## 測試清單 T1–T17（線上驗證）

| 編號 | 測試項目 | 狀態 | 備註 |
|------|---------|------|------|
| T1 | JWKS 公鑰端點 | ✅ 通過 | `/.well-known/jwks.json` |
| T2 | 遊戲端 SSO URL | ✅ 通過 | pc/mobile/web 正常；port 缺失/provider 不支援/平台無效均正確回 400，2026-04-23 |
| T3 | 帳號註冊 | ✅ 通過 | 201 + access_token + refresh_token，遠端 DB 驗證 2026-04-23 |
| T4 | 帳號登入 | ✅ 通過 | 200 + access_token + refresh_token，遠端 DB 驗證 2026-04-23 |
| T5 | /me 即時狀態 | ✅ 通過 | 回傳 role/status/identities |
| T6 | Refresh Token 輪換 | ✅ 通過 | 輪換成功，舊 token 重放回 401 |
| T7 | Discord OAuth（瀏覽器） | ✅ 通過 | client_id 正確，授權後 JWT 回傳至 login.html，2026-04-23 |
| T8 | Admin API | ✅ 通過 | 列表/ban/unban 邏輯全通過，自封禁與角色保護正常 2026-04-23 |
| T9 | PKCE 完整流程 | ✅ 通過 | authorize→code→token，重放攻擊防護通過 |
| T10 | Logout 撤銷 | ✅ 通過 | 撤銷後 refresh 回 401，冪等 200 |
| T11 | 發送驗證信 | ✅ 通過 | 200 送出成功；60 秒冷卻 429；無 token 401，2026-04-24 |
| T12 | Email 驗證確認 | ✅ 通過 | 核銷成功跳轉 login.html 綠色 banner；重放回 400，2026-04-24 |
| T13 | 忘記密碼（防枚舉） | ✅ 通過 | 存在/不存在信箱均回 200 同一訊息，2026-04-24 |
| T14 | 重設密碼（無 2FA） | ✅ 通過 | reset token 流程完整，3 秒跳轉 + 綠色 banner，2026-04-24 |
| T15 | 重設密碼（有 2FA） | ✅ 通過 | 403 動態出現 TOTP 輸入框，通過後撤銷所有 session，2026-04-24 |
| T16 | Dashboard Email 驗證 UI | ✅ 通過 | amber banner / 重發按鈕 / 60s 倒數正常，2026-04-24 |
| T17 | 2FA 設定端點 | ✅ 通過 | setup + activate 成功，備用碼產生，2026-04-24 |

### T2 測試指令
```bash
curl "https://chiyigo.com/api/auth/game/login?platform=pc&port=12345"
# 預期：{"provider":"discord","platform":"pc","url":"https://chiyigo.com/api/auth/discord/init?platform=pc&port=12345"}
```

### T8 測試指令（先升 admin）
```bash
# 1. 先用瀏覽器或 curl 建立帳號，取得 email
# 2. 手動升為 admin
npx wrangler d1 execute chiyigo_db --remote --command "UPDATE users SET role='admin' WHERE email='你的email';"
# 3. 登入取得 JWT 後測試
curl https://chiyigo.com/api/admin/users -H "Authorization: Bearer <admin_jwt>"
```

---

## 階段十五：待辦（優先序）

| 優先度 | 項目 | 說明 |
|--------|------|------|
| ~~高~~ | ~~T2 — 遊戲端 SSO 測試~~ | ✅ 通過 2026-04-23（pc/mobile/web + 錯誤情境全通過）|
| ~~高~~ | ~~T7 — Discord OAuth 測試~~ | ✅ 通過 2026-04-23 |
| ~~高~~ | ~~T8 — Admin API 測試~~ | ✅ 通過 2026-04-23 |
| ~~中~~ | ~~13.9 Android App Link~~ | ✅ 完成 2026-04-23（SHA-256 待 App 建立後更新）|
| ~~中~~ | ~~受保護頁面 / 使用者儀表板~~ | ✅ dashboard.html 完成，無限重導向 bug 已修 2026-04-23 |
| ~~低~~ | ~~schema_iam_fresh.sql 同步~~ | ✅ 已完成 2026-04-23 |
| ~~低~~ | ~~刪除 chiyigo-db（13ecc734...）~~ | ✅ 已刪除 2026-04-23 |
| 🔒 | 13.8 iOS Universal Link | 需 Apple Developer 帳號（$99/yr）|
| ~~中~~ | ~~Stage 17 — Email 驗證~~ | ✅ 完成 2026-04-24（Resend，send-verification + verify 端點）|
| ~~中~~ | ~~Stage 17 — 忘記密碼~~ | ✅ 完成 2026-04-24（forgot-password + reset-password + 2FA 閉環）|
| 🔄 | Stage 18 — 動態 OAuth 路由 | Google：18.8 完成、T18 等待 Google 傳播（⏳ 建立於 2026-04-25 06:24，傳播中）；LINE/FB：OAuth App 尚未建立 |
| ~~中~~ | ~~T14/T15 — 重設密碼完整測試~~ | ✅ 通過 2026-04-24（T14 無 2FA + T15 有 2FA 閉環均驗證通過）|
| ~~中~~ | ~~Dashboard 2FA 管理 UI~~ | ✅ 完成 2026-04-25（setup QR flow + backup codes + disable with OTP）|
| ~~低~~ | ~~login.html 忘記密碼入口~~ | ✅ 完成 2026-04-24（登入按鈕右下角加「忘記密碼？」連結）|
| 高 | Stage 19 — 首頁重設計 | 套用新設計系統（CSS Variables、SaaS Dashboard 版面、Neural Canvas、亮暗主題）|
| ~~待考慮~~ | ~~首頁統計數字區塊~~ | ✅ 完成 2026-04-24（50+ 完成專案 / 98% 客戶滿意度 / 5yr+ 開發經驗 / 24/7 技術支援，數字 count-up 動畫）|
| ✅ 完成 | 安全掃描修補（2026-04-25） | CRITICAL×2 + MEDIUM×2 + HIGH×1 共 5 項漏洞修補完成（見下方安全補強記錄）|
| 待討論 | 會員頁面重設計 | login.html / dashboard.html 等頁面套用新設計系統，討論後再動 |
| 🔒 | Apple Sign In | 需 Apple Developer 帳號（$99/yr），Stage 18 預留架構 |

---

## 階段十六：安全防禦補強（Security & DevOps Patch）

> **動機**：Web 端 Refresh Token 存於 sessionStorage 有 XSS 竊取風險；D1 狀態表無限膨脹需自動清理。

### Step 1：Web 端 HttpOnly Cookie 雙軌制（✅ 完成 2026-04-23）

> **偵測邏輯**：`!device_uuid && (!platform || platform==='web')` → Web 模式；App 傳入 `device_uuid` 則走 JSON 模式。

| 子項目 | 說明 |
|--------|------|
| 16.1 | ✅ `login.js` — Web 端回傳 `Set-Cookie: chiyigo_refresh; HttpOnly; Secure; Path=/api/auth`，JSON 不含 refresh_token |
| 16.2 | ✅ `discord/callback.js` — Web 平台建立 refresh_token，回傳 200 HTML + Set-Cookie（改 302 以繞過 CDN 過濾），JS 寫 sessionStorage 後跳轉 dashboard |
| 16.3 | ✅ `refresh.js` — 優先讀 Cookie，其次讀 body；回傳時同步輪換 Cookie 或 JSON |
| 16.4 | ✅ `auth-ui.js` v6 — 移除 REFRESH_TOKEN_KEY / saveRefreshToken / getRefreshToken；logout 改用 `credentials: 'include'` |
| 16.5 | ✅ `logout.js` — 讀 Cookie 或 body；回傳 `Set-Cookie: Max-Age=0` 清除 Cookie；冪等 200 |
| 16.9 | ✅ `login.html` 補上 Discord 登入 / 繼續按鈕（登入 + 註冊兩個分頁均已加入）|

**SameSite 變更（2026-04-23）**
> 所有 `refreshCookie()` helper 從 `SameSite=Strict` 改為 `SameSite=Lax`。
> 原因：Discord OAuth 為跨站頂層導航（discord.com → chiyigo.com），Strict 在部分 Chrome 版本可能阻擋 cookie 儲存。

**_middleware.js Set-Cookie 根因分析與修復歷程**

| commit | 內容 | 結果 |
|--------|------|------|
| `e7d0a44` | 初始實作：`new Response(response.body, response)` — 直接複製 Response 繼承原生 Set-Cookie | ✅ 正常（22bdecd 驗證）|
| `466d0f5` | 改為 `new Headers(response.headers)` + `getAll()` — 根本不需要改，反而引入 `getAll` 相容性風險 | 密碼 ✅，Discord ❌ |
| `4cd7511` | `for...of` + `getAll()` — CF Workers `for...of` 包含 set-cookie，造成雙重添加 | 密碼 ❌（回歸），Discord ❌ |
| `a2ac5a1` | 明確 skip set-cookie + 僅靠 `getAll()` 添加 | 密碼 ❌，Discord ❌ |
| `63b2dfe` | **✅ 最終修復**：還原至 `new Response(body, response)` 原始做法，消除所有 Header 手動解構 | 密碼 ✅，Discord ✅ |

**根本原因**：`getAll('set-cookie')` 在部分 CF Workers Pages Functions 環境回傳空陣列，導致 Set-Cookie 被靜默丟棄。`new Response(body, response)` 在 CF Workers runtime 層正確繼承 Set-Cookie，是 W3C 對齊的最小干涉解法。

**測試結果（2026-04-23 線上驗證通過）**
- [x] Test A：密碼登入後 Application → Cookies 顯示 `chiyigo_refresh` ✅
- [x] Test B：登出後 Cookie 清除 ✅
- [x] Test C：Discord 登入後 Application → Cookies 顯示 `chiyigo_refresh` ✅

**架構備忘**
```
Web 請求判斷條件：
  - 無 device_uuid，且（無 platform 或 platform = 'web'）

App/遊戲端（保持 JSON body）：
  - 傳入 device_uuid（遊戲引擎綁定硬體識別碼）
```

### Step 2：D1 垃圾回收排程（✅ 完成 2026-04-23）

> **架構備忘**：Cloudflare Pages Functions 不支援 cron triggers；獨立 Worker 需要 Workers Scripts Write 權限（現有 token 無此權限）。
> 改採 GitHub Actions `schedule` cron，直接跑 `wrangler d1 execute --remote` — 完全相容現有 D1 Write token。

| 子項目 | 說明 |
|--------|------|
| 16.6 | ✅ `.github/workflows/cleanup.yml` — 每日 UTC 03:00 觸發，清理三張表（auth_codes / pkce_sessions / refresh_tokens）|
| 16.7 | ✅ 支援 `workflow_dispatch` 手動觸發，方便臨時清理 |

**清理 SQL**
```sql
DELETE FROM auth_codes        WHERE expires_at < datetime('now');
DELETE FROM pkce_sessions     WHERE expires_at < datetime('now');
DELETE FROM email_verifications WHERE expires_at < datetime('now');
DELETE FROM refresh_tokens    WHERE expires_at < datetime('now');
```

> **注意**：`email_verifications` 表目前尚未建立（Email 驗證流程未實作），排程函式需用 `IF EXISTS` 或 try/catch 保護。

---

## 階段十七：Email 驗證與高安規密碼重設（Option B）

> **前置條件**：串接 **Resend**（免費層 100 封/天，CF Workers 相容，原生 fetch 呼叫，無需 SDK）。
> **核心目標**：防範信箱遭駭帳號劫持 + 密碼重設端點帳號枚舉 + 2FA 被繞過三大威脅。

### 架構設計

| 功能 | 端點 | 說明 |
|------|------|------|
| 發送驗證信 | `POST /api/auth/email/send-verification` | 60 秒冷卻 → 生成 token → 存 D1 Hash → 發信（1hr TTL）|
| 確認驗證 | `GET /api/auth/email/verify?token=` | 原子核銷 token → 更新 `email_verified=1` |
| 忘記密碼 | `POST /api/auth/local/forgot-password` | 帳號不存在仍回 200（防枚舉）→ 生成 reset token → 發信 |
| 重設密碼（Option B） | `POST /api/auth/local/reset-password` | 驗 token → **2FA 閉環** → PBKDF2 更新 → 撤銷所有 refresh_tokens |

### D1 Schema（email_verifications）
```sql
CREATE TABLE IF NOT EXISTS email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  type        TEXT    NOT NULL CHECK(type IN ('verify_email','reset_password')),
  ip_address  TEXT,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_verif_hash ON email_verifications(token_hash);
```

### 安全規範（Security Compliance）

| 規則 | 說明 |
|------|------|
| Token 強度 | 32 bytes `crypto.getRandomValues` → hex；**DB 只存 SHA-256 hash**（與 refresh_token 同模式）|
| 發信冷卻 | 每次發信前查詢 60 秒內是否有同 user_id + type 紀錄，有則回 429 |
| 防帳號枚舉 | `forgot-password` 無論信箱是否存在，一律回 200；使用 `fakeHashDelay` 對齊響應時間 |
| 2FA 重設閉環 | `reset-password` 若 `totp_enabled=1` 且無 `totp_code`/`backup_code`，回傳 `403 {"requires_2fa": true}` |
| 重設副作用 | 密碼更新成功後，`DELETE FROM refresh_tokens WHERE user_id=?`（登出所有裝置）|
| 原子核銷 | `UPDATE ... SET used_at WHERE token_hash AND used_at IS NULL AND expires_at > now RETURNING id`（防重放）|

### Option B 重設密碼流程圖
```
[用戶] POST /forgot-password {email}
  → 找不到帳號 → 靜默回 200（防枚舉）
  → 找到帳號   → 寫 DB + 寄 Reset Email

[用戶] POST /reset-password {token, new_password}
  → 查 token（過期/用過 → 400）
  → 查 user.totp_enabled
      ├─ totp_enabled=0 → 直接更新密碼
      └─ totp_enabled=1
            ├─ 無 totp_code/backup_code → 403 {requires_2fa: true}
            └─ 有代碼 → 2FA 模組校驗
                  ├─ 失敗 → 401
                  └─ 通過 → 更新密碼 + 核銷 token + 撤銷所有 refresh_tokens
```

### 前端互動（reset-password.html）
```
1. 頁面載入讀取 URL ?token=
2. 提交 → POST /reset-password {token, new_password}
3. 若收到 403 {requires_2fa: true}
   → 動態顯示 TOTP 輸入框
   → 再次提交 {token, new_password, totp_code}
4. 成功 → 跳轉 login.html
```

### 待辦子項目
- [x] 17.1 建立 `database/schema_email.sql`，部署至 D1 本地與遠端（2026-04-23，舊版 3 欄位表已替換為 8 欄位完整 schema）
- [x] 17.2 設定 `RESEND_API_KEY` 環境變數（Cloudflare Pages 後台 + .dev.vars）✅ 金鑰已於 2026-04-25 輪換（舊：re_MqU7...，新：re_5uYc...）
- [x] 17.3 `functions/utils/email.js` — `sendVerificationEmail` / `sendPasswordResetEmail`（原生 fetch，無 SDK）
- [x] 17.4 `POST /api/auth/email/send-verification` — 60 秒冷卻 + 生成 token + 發信
- [x] 17.5 `GET /api/auth/email/verify` — 原子核銷 + 更新 email_verified
- [x] 17.6 `POST /api/auth/local/forgot-password` — 防枚舉設計（無論帳號存在與否回 200）
- [x] 17.7 `POST /api/auth/local/reset-password` — **2FA 閉環**核心邏輯 + 密碼更新 + 撤銷所有 session
- [x] 17.8 `public/forgot-password.html` — 信箱輸入頁
- [x] 17.9 `public/reset-password.html` + JS — 讀 `?token=`、攔截 403 動態顯示 2FA 輸入框
- [x] 17.10 更新 `dashboard.html` — 顯示 email_verified 狀態，提供「重發驗證信」按鈕
- [x] 17.11 `cleanup.yml` 新增 `email_verifications` 清理步驟（每日 UTC 03:00 自動執行）

---

## 階段十八：動態 OAuth 路由與第三方平台大一統

> **架構**：Cloudflare Pages Functions + 策略模式（Strategy Pattern）
> **目標**：將硬編碼的 Discord OAuth 升級為動態參數路由 `[provider]`，
> 依序實作 Google、LINE、Facebook，並為 Apple 預留底層架構。

### 安全規範

| 規則 | 說明 |
|------|------|
| 信箱碰撞（Email Collision） | Google `trustEmail: true` → 靜默綁定；FB/LINE `trustEmail: false` → 403 阻擋，提示改用密碼登入後綁定 |
| 無信箱防禦（Missing Email） | FB/LINE 可能不回傳 email → 生成短效 `temp_bind_token` → 302 跳轉 `/bind-email.html?token=` → 手動填信箱驗證後才建立帳號 |
| Apple form_post | callback 同時 export `onRequestGet` + `onRequestPost`，支援 URL Params 與 FormData 提取 code/state |

### 待辦子項目

- [x] 18.1 `functions/utils/oauth-providers.js` — Provider 設定檔（discord/google/line/facebook/apple，含 trustEmail、env key 對應、normalizeProfile）
- [x] 18.2 `functions/api/auth/oauth/[provider]/init.js` — 動態授權網址生成（PKCE 支援 discord/google/line；Facebook 僅 state；Apple 預留 503）
- [x] 18.3 `functions/api/auth/oauth/[provider]/callback.js` — 動態 callback（同時 export GET/POST；token 換取；統一 profile 格式）
- [x] 18.4 信箱碰撞 + 無信箱安防邏輯（DB 寫入 / 綁定 / 403 阻擋 / temp_bind_token）
- [x] 18.5 刪除舊的 `functions/api/auth/discord/init.js` 與 `callback.js`（整合進動態路由後移除）
- [x] 18.6 `public/bind-email.html` — 無信箱補填頁（表單 + 提交驗證 token）
- [x] 18.7 更新 `login.html` — 新增 Google、LINE、Facebook 登入按鈕，指向 `/api/auth/oauth/{provider}/init`
- [x] 18.8 Cloudflare Pages 設定環境變數（`GOOGLE_CLIENT_ID/SECRET` 已完成 2026-04-25；`LINE_CLIENT_ID/SECRET` 已完成 2026-04-25；`FACEBOOK_CLIENT_ID/SECRET` 待辦）
- [x] 18.9 各平台 OAuth App redirect_uri（Google：`https://chiyigo.com/api/auth/oauth/google/callback` ✅；LINE：`https://chiyigo.com/api/auth/oauth/line/callback` ✅；Facebook 待辦）
- [x] 18.10 T18–T21 線上測試（部分通過 2026-04-25）
  - T18 Google 登入：✅ 通過（新帳號建立 + dashboard 跳轉正常）
  - T19 LINE 登入（無信箱補填）：✅ 通過（跳轉 bind-email.html，temp_bind_token 正確產生）
  - T20 Facebook 登入：⏳ 暫緩（目標用戶以遊戲玩家為主，Facebook 使用率低；需隱私政策頁面才能上線，日後有需求再補）
  - T21 Email 碰撞防禦：✅ 通過（LINE bind-email 填入已存在信箱 → 403 阻擋 + 正確提示訊息）

---

## 階段十九：首頁重設計（Homepage Redesign）

> 套用新設計系統，對齊 chiyigo-website.pages.dev 設計稿。
> 技術棧：Vanilla CSS（CSS Custom Properties）+ Vanilla JS，不使用 Tailwind。
> 功能邏輯（functions/）完全不動。

### 待辦子項目

- [x] 19.1 `public/index.html` — 套用新設計系統（CSS Variables 亮暗雙主題、SaaS Dashboard 版面）
- [x] 19.2 神經網路背景動畫（Canvas JS，顏色跟隨主題 CSS 變數自動切換）
- [x] 19.3 亮色 / 暗色主題切換（`<html>` class 切換，localStorage 記憶，防閃白 inline script）
- [x] 19.4 流程區塊（需求溝通 → 策略規劃 → 落地執行 三步驟）
- [x] 19.5 桌面版：左側 Sidebar 導覽 + IntersectionObserver 自動 highlight active section
- [x] 19.6 行動版：固定 TopBar + 底部 BottomSheet 導覽
- [x] 19.7 Logo 圖片接入（`public/images/logo-light.png` + `logo-dark.png`，亮暗自動切換）
- [x] 統計數字區塊（50+ 完成專案、98% 客戶滿意度、5yr+ 開發經驗、24/7 技術支援服務，count-up 動畫）
- [x] 19.8 `login.html` 套用新設計系統（sidebar、CSS 變數、mobile overlay 同步為 is-open pattern、接案中徽章、Escape 鍵關閉、backdrop 點擊關閉）
- [x] 19.9 `portfolio.html` mobile overlay 補齊 6 項導覽（首頁、服務項目、案例作品、服務流程、關於我們、接案諮詢）並修正「聯絡我們」→「接案諮詢」標籤

---

## 安全補強記錄（2026-04-25）

| 嚴重度 | 檔案 | 問題 | 修法 |
|---|---|---|---|
| CRITICAL | `2fa/disable.js` | 備用碼用 DB hash 直查，未使用常時性比較 | 改用 `verifyBackupCode()` 逐一常時比對 |
| CRITICAL | `oauth/[provider]/callback.js` | LINE `id_token` 只 base64 decode，未驗 HS256 簽名 | 新增 `verifyLineIdToken()` 以 channel secret 驗 HMAC-SHA256 |
| MEDIUM | `oauth/authorize.js` | `redirect_uri` 白名單用 regex 允許 chiyigo.com 任意路徑 | 改為 Set 明確列舉 + loopback regex |
| MEDIUM | `admin/users.js` | LIKE 搜尋未 escape `%` `_`，可被利用作帳號列舉 | 加 ESCAPE 子句並 escape 特殊字元 |
| MEDIUM | `email/send-verification.js` | 冷卻只查 `verify_email` type，可搭配 reset_password 繞過 | 改為不分 token_type 統一 60 秒冷卻 |

暫緩項目（真實利用條件嚴苛）：device_uuid 空字串邊界、PC port 高位驗證、Cookie regex 尾部空格、bind-email 競態條件。

---

## 維護指令速查

### 新增作品集
```bash
node scripts/portfolio-add.mjs
```

### 查看需求表單
```bash
npx wrangler d1 execute chiyigo_db --remote --command "SELECT * FROM requisition ORDER BY created_at DESC LIMIT 20;"
```

### 查看用戶列表
```bash
npx wrangler d1 execute chiyigo_db --remote --command "SELECT id, email, role, status, created_at FROM users ORDER BY created_at DESC;"
```

### 本機開發預覽
```bash
npx wrangler pages dev public --d1 chiyigo_db
```

### 部署（推送至 GitHub 即自動觸發）
```bash
git push origin main
```

---

## 階段二十一：mbti.chiyigo.com IAM 整合（Method A — 完整 PKCE 替換）

> **決策**：採方案 A（全面替換），放棄舊帳號讓用戶重新以 chiyigo.com 帳號登入。
> **完成日期**：2026-04-25

### 整合範圍

| 項目 | 狀態 | 說明 |
|------|------|------|
| authorize.js whitelist | ✅ 完成 | 新增 `https://mbti.chiyigo.com/login.html` |
| cors.js DEFAULT_ORIGINS | ✅ 完成 | 新增 `https://mbti.chiyigo.com` |
| token.js CORS | ✅ 完成 | OPTIONS preflight + getCorsHeaders 於所有回應 |
| mbti auth.js | ✅ 完成 | 完整 PKCE 客戶端：verifier/challenge → chiyigo.com → callback 換 token |
| mbti login.html | ✅ 完成 | 移除舊登入表單，改為「使用 Chiyigo.com 帳號登入」按鈕 |
| mbti dashboard.js | ✅ 完成 | token key `localStorage.mbti_jwt_token` → `sessionStorage.chiyigo_access_token` |
| mbti dashboard.html | ✅ 完成 | 內聯 script 同步更新 |
| mbti api.js | ✅ 完成 | proceedToResultAPI token key 更新 |
| mbti script.js | ✅ 完成 | initApp login-wall + goToTalo SSO token key 更新 |
| mbti 全站 HTML（8 頁） | ✅ 完成 | assessment/beebe-model/index/jung-theory/mbti-stats/mbti-types/reset-password/type-detail |
| mbti src/index.ts | ✅ 完成 | `verifyChiyigoJWT()` 呼叫 chiyigo.com `/api/auth/me` (Token Introspection)；3 處保護路由由 HS256 換為 ES256 代理驗證 |

### Token 儲存（mbti 端）
| 項目 | 儲存位置 | TTL |
|------|---------|-----|
| access_token（ES256） | `sessionStorage.chiyigo_access_token` | 15 分鐘 |
| refresh_token | `localStorage.chiyigo_refresh_token` | 30 天 |

### mbti 部署指令（無 git remote，需手動執行）
```bash
# 在 C:\Users\User\Desktop\mental-modeling-assessment-v1 目錄執行：
# 1. 更新 Worker（後端 API）
npx wrangler deploy

# 2. 更新靜態檔案（前端 HTML/JS/CSS）
npx wrangler pages deploy public/ --project-name mental-modeling-assessment-v1
```

### 線上驗證結果（2026-04-25）
| 項目 | 狀態 | 說明 |
|------|------|------|
| login.html PKCE 重導向 | ✅ 通過 | 點擊按鈕 → chiyigo.com 登入 → 回到 mbti dashboard |
| dashboard 資料載入 | ✅ 通過 | Token Introspection 驗證成功，歷史紀錄正常顯示 |
| portfolio 項目新增（D1） | ✅ 完成 | `INSERT INTO portfolio ... id=7`；`wrangler d1 execute --remote` 確認 `changes=1` |

### 技術備忘：Token Introspection 模式
> 原本設計使用 JWKS + crypto.subtle 手刻 ES256 驗證，但實作複雜且難除錯。
> 最終改為 mbti Worker → `GET https://chiyigo.com/api/auth/me` (Bearer token)。
> chiyigo.com 用 `jose` 正確驗證 ES256 + 即時查 DB 封禁狀態，回傳 `user_id`。
> Server-to-Server 請求無 CORS 限制，簡單可靠。

---

## 基礎設施資訊

| 項目 | 值 |
|------|-----|
| D1 database_id（正式） | `59f73214-1203-44b7-840f-86cb3998fbb6` |
| D1 binding name | `chiyigo_db` |
| D1 database_id（誤建，可刪） | `13ecc734-ee46-4f15-8509-d4e7f0b906b7` |
| Cloudflare Pages project | `chiyigo-com` |
| GitHub repo | https://github.com/a30100a0072-bit/chiyigo.com |
| Cloudflare Analytics token | `be8c93305dda4f16b57c925bc681b2f6` |

---

## 架構對齊備忘（iOS / Android 接入注意事項）

### Token 儲存規範（客戶端責任）
| 平台 | Access Token | Refresh Token |
|------|-------------|---------------|
| Web | `sessionStorage` | HttpOnly Cookie（`chiyigo_refresh`，由 Server 管理）|
| iOS | Keychain（`kSecClassGenericPassword`） | Keychain |
| Android | EncryptedSharedPreferences / Keystore | Keystore |
| Unity | PlayerPrefs 加密 / 平台 Keychain plugin | 同左 |

### TTL 策略
| 客戶端類型 | Access Token | Refresh Token |
|-----------|-------------|---------------|
| Web 瀏覽器 | 15 分鐘 | 7 天 |
| iOS / Android | 15 分鐘 | 30 天 |
| Unity / Unreal | 15 分鐘 | 90 天 |
