# CHIYIGO.COM 建構計畫

**架構**：MPA + Cloudflare Pages Functions + D1 SQLite  
**風格**：Arshire Style — Tailwind CSS + Vanilla JS，零框架  
**IAM 定位**：全端跨平台統一身份中心（Web / Unity / Unreal / iOS / Android）

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
- [ ] 7.2 www.chiyigo.com 重導向至 chiyigo.com（等待 Cloudflare DNS 自動 active）
- [x] 7.3 填入 Cloudflare Web Analytics token（三個 HTML 頁面）
- [x] 7.4 製作並上傳 OG 封面圖（public/images/chiyigo.jpg）
- [x] 7.5 提交 sitemap 至 Google Search Console（2 頁已收錄）
- [x] 7.6 設定 GitHub → Cloudflare Pages 自動部署（CI/CD）
- [ ] 7.7 Google Search Console 搜尋流量數據（約 1–3 天後出現）

---

## 進度記錄

| 步驟 | 狀態 | 完成時間 | 備註 |
|------|------|----------|------|
| 1.1 目錄結構 | ✅ 完成 | 2026-04-22 | `public/`, `functions/api/` |
| 1.2 wrangler.toml | ✅ 完成 | 2026-04-22 | D1 binding = `chiyigo_db` |
| 1.3 schema.sql | ✅ 完成 | 2026-04-22 | portfolio + requisition 表，含範例資料 |
| 1.4 tailwind.config.js | ✅ 完成 | 2026-04-22 | brand 色系、fadeUp 動畫、Inter + Noto Sans TC |
| 2.1 index.html | ✅ 完成 | 2026-04-22 | Hero + 服務卡片 + CTA，IntersectionObserver 漸顯 |
| 2.2 portfolio.html | ✅ 完成 | 2026-04-22 | fetch `/api/portfolio`，Skeleton + 分類篩選 |
| 2.3 requisition.html | ✅ 完成 | 2026-04-22 | POST `/api/requisition`，表單驗證 + 成功畫面 |
| 3.1 portfolio.js | ✅ 完成 | 2026-04-22 | GET D1，60s Cache-Control |
| 3.2 requisition.js | ✅ 完成 | 2026-04-22 | POST D1 + Telegram `waitUntil` 非阻塞通知 |
| 4.1 .gitignore | ✅ 完成 | 2026-04-22 | 排除 node_modules, .wrangler, .dev.vars, .claude |
| 5.1 portfolio-add.mjs | ✅ 完成 | 2026-04-22 | 互動式 CLI 新增作品集 |
| 5.2 portfolio-list.mjs | ✅ 完成 | 2026-04-22 | 列出 / 刪除作品集，支援 `delete <id>` |
| 5.3 portfolio-remote.sql | ✅ 完成 | 2026-04-22 | 遠端 D1 CRUD SQL 範本 |
| 6.1 OG / Twitter Card | ✅ 完成 | 2026-04-22 | 三頁面，requisition 設 noindex |
| 6.2 sitemap.xml | ✅ 完成 | 2026-04-22 | 含 / 和 /portfolio |
| 6.3 robots.txt | ✅ 完成 | 2026-04-22 | 禁止索引 requisition & api |
| 6.4 Cloudflare Analytics | ✅ 完成 | 2026-04-22 | token be8c93... 已填入三個頁面 |
| A.1 GitHub repo 建立 | ✅ 完成 | 2026-04-22 | github.com/a30100a0072-bit/chiyigo.com |
| A.2 推送至 GitHub | ✅ 完成 | 2026-04-22 | branch: main |
| A.3 Cloudflare Pages 部署 | ✅ 完成 | 2026-04-22 | wrangler CLI 直接部署 |
| A.4 Telegram secrets 設定 | ✅ 完成 | 2026-04-22 | TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID 已上傳 |
| A.5 D1 binding（production） | ✅ 完成 | 2026-04-22 | chiyigo_db 綁定，/api/portfolio 線上測試通過 |
| A.6 自訂網域 chiyigo.com | ✅ Active | 2026-04-22 | SSL enabled |
| A.7 自訂網域 www.chiyigo.com | 🔄 等待中 | — | Cloudflare DNS 驗證後自動 active，重導向至主網域 |
| 7.6 GitHub Actions CI/CD | ✅ 完成 | 2026-04-22 | deploy.yml + CLOUDFLARE_API_TOKEN secret 已設定 |
| 7.3 Cloudflare Web Analytics | ✅ 完成 | 2026-04-22 | token be8c93... 已填入三個頁面 |
| 7.4 OG 封面圖 | ✅ 完成 | 2026-04-22 | public/images/chiyigo.jpg 24KB |
| 7.5 Google Search Console | ✅ 完成 | 2026-04-22 | 驗證網域 + 提交 sitemap，2 頁已收錄 |
| 7.7 Search Console 流量數據 | 🔄 等待中 | — | 約 1–3 天後出現，確認後打勾 |
| **階段九：ES256 安全升級（已完成）** | | | |
| 9.1.1 jwt.js（ES256 模組） | ✅ 完成 | 2026-04-23 | 模組級金鑰快取 |
| 9.1.2 generate-jwt-keys.mjs | ✅ 完成 | 2026-04-23 | 一次性金鑰對生成腳本 |
| 9.2.x 所有端點改用 ES256 | ✅ 完成 | 2026-04-23 | register / login / verify |
| 9.3.1 .well-known/jwks.json.js | ✅ 完成 | 2026-04-23 | RFC 7517，CORS 全開 |
| **階段十：遊戲平台擴充（已完成）** | | | |
| 10.1 schema role/status | ✅ 完成 | 2026-04-23 | user_identities 含遊戲平台欄位 |
| 10.2-5 JWT payload 擴充 | ✅ 完成 | 2026-04-23 | role + status 全端點 |
| 10.6 /api/auth/me.js | ✅ 完成 | 2026-04-23 | 即時 DB 封禁查詢 |
| **階段十一～十四：跨平台（待執行）** | | | |
| 11.1.1 Schema 遷移 | ✅ 完成 | 2026-04-23 | device_uuid / platform / client_callback |
| 11.1.2 discord/init.js | ✅ 完成 | 2026-04-23 | PKCE + platform routing + Discord 重導向 |
| 11.1.3 discord/callback.js | ✅ 完成 | 2026-04-23 | 原子 state 核銷 + Upsert + JWT + 三平台分流 |
| 11.1.4 Discord Dev Portal 設定 | ✅ 完成 | 2026-04-23 | Redirect URI + Client ID/Secret 已配置 |
| 11.1.5 Cloudflare env vars | ✅ 完成 | 2026-04-23 | DISCORD_CLIENT_ID/SECRET + IAM_BASE_URL |
| 11.2.1 login.js refresh_token | ✅ 完成 | 2026-04-23 | login + 2fa/verify 同步簽發 refresh_token |
| 11.2.2 auth/refresh.js | ✅ 完成 | 2026-04-23 | device_uuid 驗證 + Rotation 原子輪換 |
| 11.3.1 game/login.js | ✅ 完成 | 2026-04-23 | JSON 回傳 SSO URL，遊戲端開系統瀏覽器用 |
| 12.x CORS 防禦層 | ⬜ 待執行 | — | 所有 auth 端點 |
| 13.x PKCE 完整 OAuth | ⬜ 待執行 | — | Universal Link / App Link |
| 14.x 管理員 API | ⬜ 待執行 | — | ban / unban / 角色驗證 |

---

## 階段八：零依賴高安規全端認證系統（Auth System）

> **架構**：Cloudflare Pages Functions + D1 + Web Crypto API + jose + otpauth  
> **目標**：100% 資料主權，支援訪客模式 (Lazy Registration)、PBKDF2 密碼、TOTP 2FA、JWT 無狀態驗證

### Step 1：環境依賴與資料庫初始化
- [x] 8.1.1 建立 `package.json` 並執行 `npm install jose otpauth`
- [x] 8.1.2 建立 `/database/schema_auth.sql`（users, local_accounts, backup_codes, user_identities, email_verifications, password_resets, refresh_tokens, oauth_states）

### Step 2：密碼與資安引擎 (Utils)
- [x] 8.2.1 建立 `/functions/utils/crypto.js`
- [x] 8.2.2 實作 PBKDF2 `hashPassword()` / `verifyPassword()`（10 萬次迭代 + Salt）
- [x] 8.2.3 實作一次性救援碼強亂數生成邏輯

### Step 3：後端 API 核心（註冊 / 訪客綁定 / 登入）
- [x] 8.3.1 建立 `/functions/api/auth/local/register.js`（email + password + guest_id 綁定 Transaction）
- [x] 8.3.2 建立 `/functions/api/auth/local/login.js`（密碼驗證 + totp_enabled 分支 + JWT 簽發）

### Step 4：後端 API 擴充（2FA 與合規刪除）
- [x] 8.4.1 建立 `/functions/api/auth/2fa/setup.js`（產生 TOTP Secret）
- [x] 8.4.2 建立 `/functions/api/auth/2fa/activate.js`（驗證首發 OTP + 啟用 + 生成備用碼）
- [x] 8.4.3 建立 `/functions/api/auth/delete.js`（驗密碼 + Soft/Hard Delete Transaction）

### Step 5：前端獨立登入視圖
- [x] 8.5.1 建立 `/public/login.html`（全螢幕 Arshire 風格，含返回首頁連結）
- [x] 8.5.2 建立 `/public/js/auth-ui.js`（密碼 10 秒自動隱藏、guest_id LocalStorage、JWT 存儲與跳轉）
- [x] 8.5.3 補建 `/functions/api/auth/2fa/verify.js`（登入時 TOTP + 備用碼核銷）

---

## 階段九：零信任微服務安全升級（ES256 + JWKS）

> **目標**：禁用 HS256 共用密鑰，改採 ES256 非對稱加密。  
> IAM 作為公鑰分發中心，內部子系統透過 Service Bindings 取得公鑰自行驗證 JWT，  
> 無需任何私鑰外流。

### Step 1：升級 Crypto 模組
- [x] 9.1.1 建立 `/functions/utils/jwt.js`（ES256 簽發 / 驗證，模組級金鑰快取）
- [x] 9.1.2 建立 `/scripts/generate-jwt-keys.mjs`（一次性金鑰對生成輔助腳本）

### Step 2：更新所有 JWT 簽發端點
- [x] 9.2.1 `functions/utils/auth.js` — 改用 ES256 公鑰驗證
- [x] 9.2.2 `functions/api/auth/local/register.js` — 改用 signJwt()
- [x] 9.2.3 `functions/api/auth/local/login.js` — 改用 signJwt()
- [x] 9.2.4 `functions/api/auth/2fa/verify.js` — 改用 signJwt()

### Step 3：建立 JWKS 公鑰分發端點
- [x] 9.3.1 建立 `/functions/.well-known/jwks.json.js`（RFC 7517，CORS 允許跨域讀取）

---

## 階段十：遊戲平台擴充（Game Auth Extension）

> **目標**：IAM 升級為全平台統一身份中心，支援遊戲伺服器無狀態鑑權與即時封禁。

### 變更清單
- [x] 10.1 `schema_auth.sql` — users 新增 `role` / `status`；user_identities 新增 `display_name` / `avatar_url` / `metadata`（支援 Steam / Discord / Epic）
- [x] 10.2 `utils/auth.js` — requireAuth 新增 banned 攔截（403 ACCOUNT_BANNED）
- [x] 10.3 `auth/local/login.js` — 封禁帳號拒絕簽發 token；JWT payload 加入 role / status
- [x] 10.4 `auth/local/register.js` — JWT payload 加入 role / status（預設 player / active）
- [x] 10.5 `auth/2fa/verify.js` — JWT payload 加入 role / status
- [x] 10.6 建立 `/api/auth/me.js` — 即時 DB 狀態查詢，提供即時封禁可觀察點

---

## 階段十一：遊戲端登入與裝置綁定擴充（Game Auth Expansion）

> **目標**：Discord OAuth MVP + 硬體裝置 UUID 綁定 Refresh Token + 遊戲端 PKCE 統整入口

### 對齊決策記錄
| 問題 | 決策 |
|------|------|
| PC/Desktop 喚醒方式 | Loopback `http://127.0.0.1:PORT/callback`（RFC 8252 推薦）|
| Mobile 喚醒方式 | Custom URI Scheme `chiyigo://auth/callback` |
| 裝置綁定欄位 | `device_uuid`（取代 `device_info`），由遊戲引擎傳入 |
| Discord redirect_uri | 永遠指向 IAM 伺服器端點，平台差異在最終 client_callback 處理 |
| 第三方平台優先順序 | Discord MVP 實作；Steam / Epic 僅預留 DB 欄位 |

### Schema 遷移（執行前先套用）
```bash
# device_uuid 綁定
npx wrangler d1 execute chiyigo_db --remote --command \
  "ALTER TABLE refresh_tokens ADD COLUMN device_uuid TEXT;"

# oauth_states 新增 platform 與 client_callback
npx wrangler d1 execute chiyigo_db --remote --command \
  "ALTER TABLE oauth_states ADD COLUMN platform TEXT NOT NULL DEFAULT 'web';"
npx wrangler d1 execute chiyigo_db --remote --command \
  "ALTER TABLE oauth_states ADD COLUMN client_callback TEXT;"
```

### Step 1：Discord 登入 MVP
- [x] 11.1.1 Schema 遷移：oauth_states + refresh_tokens 新欄位
- [x] 11.1.2 建立 `/functions/api/auth/discord/init.js`（生成 PKCE + 重導向至 Discord）
- [x] 11.1.3 建立 `/functions/api/auth/discord/callback.js`（換 token、Upsert 用戶、簽發 JWT）

### Step 2：硬體綁定 Refresh Token
- [ ] 11.2.1 更新 `login.js` + `2fa/verify.js`：登入成功時同步簽發 refresh_token（含 device_uuid）
- [ ] 11.2.2 建立 `/functions/api/auth/refresh.js`：device_uuid 驗證 + token 輪換

### Step 3：遊戲端 PKCE 統整入口
- [ ] 11.3.1 建立 `/functions/api/auth/game/login.js`：依平台回傳正確 SSO URL

---

## 階段十二：跨平台 CORS 防禦層（Web / Mobile / Game Client）

> **動機**：iOS / Android / Unity / Unreal 客戶端發出的 HTTP 請求會觸發跨域限制。  
> 目前只有 JWKS 端點有 CORS，所有 `/api/auth/*` 端點均缺少必要標頭。

### 已完成
- [x] 12.1 建立 `/functions/utils/cors.js` — 統一 CORS helper，支援 env.ALLOWED_ORIGINS 白名單
- [x] 12.2 建立 `/functions/api/auth/_middleware.js` — 自動攔截 /api/auth/* 全路由，OPTIONS preflight + CORS 標頭附加
- [x] 12.3 `.dev.vars` 新增 `ALLOWED_ORIGINS=http://localhost:8788,...`

---

## 階段十二：Refresh Token API（長效 Session，Mobile 必需）

> **動機**：Access token TTL=15m 對 Web 可接受，但行動 / 遊戲客戶端需要長效 session，  
> 不可要求用戶每 15 分鐘重新登入。`refresh_tokens` 表已存在，缺少操作端點。

### TTL 建議策略
| 客戶端類型 | Access Token | Refresh Token |
|-----------|-------------|---------------|
| Web 瀏覽器 | 15 分鐘 | 7 天 |
| iOS / Android | 15 分鐘 | 30 天 |
| Unity / Unreal | 15 分鐘 | 90 天 |

### 待執行
- [ ] 12.1 修改 `login.js` + `2fa/verify.js`：登入成功時同步簽發並儲存 refresh_token（附 device_info）
- [ ] 12.2 建立 `POST /api/auth/token/refresh`：以 refresh_token 換發新 access_token（自動輪換 token）
- [ ] 12.3 建立 `POST /api/auth/token/revoke`：撤銷 refresh_token（等同登出）
- [ ] 12.4 `schema_auth.sql` 確認 `refresh_tokens` 表含 `device_info` 欄位（已存在，確認即可）

---

## 階段十三：PKCE 跨平台 OAuth 授權流程

> **動機**：Unity / Unreal / iOS / Android 原生 App 需透過 PKCE 授權碼流程喚起 IAM 登入頁，  
> 登入後將 code 透過 Custom URI Scheme (`chiyigo://`) 回傳 App，換取 token。  
> 純公開客戶端（無 Client Secret），安全性由 PKCE code_verifier 保證。

### 跨平台 redirect_uri 支援矩陣
| 客戶端 | redirect_uri 格式 | 說明 |
|--------|-----------------|------|
| Web SPA | `https://chiyigo.com/callback` | 標準 HTTPS |
| iOS (Universal Link) | `https://chiyigo.com/app/callback` | Apple 驗證域 |
| Android (App Link) | `https://chiyigo.com/app/callback` | Google 驗證域 |
| Unity / Unreal | `chiyigo://auth/callback` | Custom URI Scheme |
| Desktop Launcher | `http://127.0.0.1:PORT/callback` | Loopback |

### 待執行
- [ ] 13.1 建立 `GET /api/auth/oauth/authorize`：生成 state + PKCE challenge，儲存 `oauth_states`，重導至 login.html
- [ ] 13.2 建立 `POST /api/auth/oauth/token`：以 `code` + `code_verifier` 換發 access_token + refresh_token（`DELETE ... RETURNING` 防重放）
- [ ] 13.3 `redirect_uri` 白名單驗證：允許 `https://` 與 `chiyigo://` 與 loopback，拒絕其他 scheme
- [ ] 13.4 `login.html` 支援 PKCE 模式：偵測 `?response_type=code` 參數，登入後重導 + 附上 code
- [ ] 13.5 建立 `/.well-known/apple-app-site-association`（iOS Universal Link）
- [ ] 13.6 建立 `/.well-known/assetlinks.json`（Android App Link）

---

## 階段十四：管理員 API（封禁管理 + 角色授權）

> **動機**：role='admin' 的管理員需要能即時封禁 / 解封玩家，並且端點需要有 role 驗證中介軟體。

### 待執行
- [ ] 14.1 建立 `functions/utils/requireRole.js`：requireRole('admin') 中介軟體
- [ ] 14.2 建立 `POST /api/admin/users/[id]/ban`：封禁帳號 + 撤銷所有 refresh_token
- [ ] 14.3 建立 `POST /api/admin/users/[id]/unban`：解封帳號
- [ ] 14.4 建立 `GET /api/admin/users`：查詢用戶列表（分頁 + 狀態篩選）

---

## 架構對齊備忘（iOS / Android 接入注意事項）

### Token 儲存規範（客戶端責任）
| 平台 | Access Token | Refresh Token |
|------|-------------|---------------|
| Web | `sessionStorage`（已實作） | `sessionStorage` |
| iOS | Keychain（`kSecClassGenericPassword`） | Keychain |
| Android | EncryptedSharedPreferences / Keystore | Keystore |
| Unity | PlayerPrefs 加密 / 平台 Keychain plugin | 同左 |

### Schema 對齊說明
- 現有 `database/schema_auth.sql`：含累積 ALTER TABLE 遷移，適用於**既有 D1 實例**
- 待建 `database/schema_iam.sql`：乾淨的全量建表 SQL，適用於**新環境初始化**（將於階段十五整理）

### 待釐清事項（對齊後執行）
- [ ] Q1：Unity / Unreal 是否使用 Custom URI `chiyigo://` 或改用 Loopback？
- [ ] Q2：iOS / Android 是否需要 Universal Link / App Link（需設定 Apple Developer / Google Play）？
- [ ] Q3：Refresh token 裝置綁定策略：是否需要 device fingerprint 防止 token 被盜用？
- [ ] Q4：是否計畫接入 Steam / Discord / Epic 的 OAuth（需向各平台申請 Client ID）？

---

## 認證系統進度記錄

| 步驟 | 狀態 | 完成時間 | 備註 |
|------|------|----------|------|
| **階段八～十：IAM 核心（已完成）** | | | |
| 8.1.1 package.json + npm install | ✅ 完成 | 2026-04-23 | jose + otpauth |
| 8.1.2 schema_auth.sql | ✅ 完成 | 2026-04-23 | 8 張資安合規表 |
| 8.2.1-3 crypto.js | ✅ 完成 | 2026-04-23 | PBKDF2 + 救援碼 |
| 8.3.1 register.js | ✅ 完成 | 2026-04-23 | 含 guest_id Transaction |
| 8.3.2 login.js | ✅ 完成 | 2026-04-23 | 密碼 + 2FA 分支 + fakeHashDelay |
| 8.4.1 2fa/setup.js | ✅ 完成 | 2026-04-23 | TOTP Secret 生成 |
| 8.4.2 2fa/activate.js | ✅ 完成 | 2026-04-23 | 驗 OTP + 備用碼 |
| 8.4.3 delete.js | ✅ 完成 | 2026-04-23 | 合規 Soft/Hard Delete |
| 8.5.1 login.html | ✅ 完成 | 2026-04-23 | Arshire 全螢幕視圖 |
| 8.5.2 auth-ui.js | ✅ 完成 | 2026-04-23 | 密碼隱藏 + JWT 流程 |
| 8.5.3 2fa/verify.js | ✅ 完成 | 2026-04-23 | TOTP + 備用碼原子核銷 |

---

## 上線後維護備忘

### 新增作品集
```bash
node scripts/portfolio-add.mjs
```

### 查看 / 刪除作品集
```bash
node scripts/portfolio-list.mjs
node scripts/portfolio-list.mjs delete <id>
```

### 查看收到的需求表單
```bash
npx wrangler d1 execute chiyigo_db --remote --command "SELECT * FROM requisition ORDER BY created_at DESC LIMIT 20;"
```

### 本機開發預覽
```bash
npx wrangler pages dev public --d1 chiyigo_db
# 重新啟動後需執行一次：
node scripts/seed-local.mjs
```

### 部署（推送至 GitHub 即自動觸發）
```bash
git push origin main
```

---

## 基礎設施資訊

| 項目 | 值 |
|------|-----|
| D1 database_id | `59f73214-1203-44b7-840f-86cb3998fbb6` |
| D1 binding name | `chiyigo_db` |
| Cloudflare Pages project | `chiyigo-com` |
| GitHub repo | https://github.com/a30100a0072-bit/chiyigo.com |
| Cloudflare Analytics token | `be8c93305dda4f16b57c925bc681b2f6` |
