# CHIYIGO.COM 建構計畫

**架構**：MPA + Cloudflare Pages Functions + D1 SQLite  
**風格**：Arshire Style — Tailwind CSS + Vanilla JS，零框架  
**IAM 定位**：全端跨平台統一身份中心（Web / Unity / Unreal / iOS / Android）

---

## 整體進度快照（2026-04-23 更新）

| 模組 | 狀態 |
|------|------|
| 靜態站 + SEO | ✅ 完成 |
| D1 Schema（全量） | ✅ 已部署至 `chiyigo_db` |
| Auth 核心（註冊/登入/2FA） | ✅ 完成，線上測試通過 |
| ES256 JWT + JWKS | ✅ 完成 |
| Refresh Token 輪換 | ✅ 完成，Replay 防護通過 |
| Discord OAuth | ✅ 完成 |
| CORS 防禦層 | ✅ 完成 |
| Admin API（封禁/解封/列表） | ✅ 完成 |
| **Logout / Revoke Token** | ❌ 待實作 |
| **PKCE 跨平台 OAuth** | ❌ 待實作（Stage 13）|
| Universal Link / App Link | 🔒 待辦（需 Apple Developer $99/yr）|

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

## 階段十三：PKCE 跨平台 OAuth（待實作）

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

- [ ] 13.1 `GET /api/auth/oauth/authorize`（生成 state + PKCE challenge → 重導至 login.html）
- [ ] 13.2 `POST /api/auth/oauth/token`（code + code_verifier 換發 token，DELETE RETURNING 防重放）
- [ ] 13.3 `redirect_uri` 白名單驗證（允許 https:// + chiyigo:// + loopback）
- [ ] 13.4 `login.html` 支援 PKCE 模式（偵測 `?response_type=code`，登入後附 code 重導）
- [ ] 13.5 `/.well-known/apple-app-site-association`（iOS Universal Link）🔒 需 Apple Developer
- [ ] 13.6 `/.well-known/assetlinks.json`（Android App Link）

---

## 階段十四：Logout（待實作）

> **動機**：目前用戶只能清除 sessionStorage（本地登出），refresh_token 在伺服器端仍有效。
> 真正的登出需要撤銷 refresh_token。

- [ ] 14.1 `POST /api/auth/logout`（撤銷指定 refresh_token，等同伺服器端登出）
- [ ] 14.2 `auth-ui.js` 新增登出按鈕（清除 sessionStorage + 呼叫 logout API）

---

## 已知問題 / 技術債

| 項目 | 說明 | 優先度 |
|------|------|--------|
| register.js 未回傳 refresh_token | 註冊後只有 access_token（15分鐘後到期需重登入）；login.js 有回傳 | 低 |
| chiyigo-db（13ecc734...） | 誤建的第二個 D1 實例，可至 Cloudflare Dashboard 刪除 | 低 |
| www.chiyigo.com 重導向 | 等待 Cloudflare DNS 驗證通過後自動生效 | 自動 |

---

## 測試清單 T1–T8（線上驗證）

| 編號 | 測試項目 | 狀態 | 備註 |
|------|---------|------|------|
| T1 | JWKS 公鑰端點 | ✅ 通過 | `/.well-known/jwks.json` |
| T2 | 遊戲端 SSO URL | ⬜ 待測 | `GET /api/auth/game/login?platform=pc&port=12345` |
| T3 | 帳號註冊 | ✅ 通過 | 201 + access_token，Replay 回 409 |
| T4 | 帳號登入 | ✅ 通過 | 200 + access_token + refresh_token |
| T5 | /me 即時狀態 | ✅ 通過 | 回傳 role/status/identities |
| T6 | Refresh Token 輪換 | ✅ 通過 | 輪換成功，舊 token 重放回 401 |
| T7 | Discord OAuth（瀏覽器） | ⬜ 待測 | 需手動開瀏覽器測試 |
| T8 | Admin API | ⬜ 待測 | 需先手動升 role='admin' |

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
| Web | `sessionStorage` | `sessionStorage` |
| iOS | Keychain（`kSecClassGenericPassword`） | Keychain |
| Android | EncryptedSharedPreferences / Keystore | Keystore |
| Unity | PlayerPrefs 加密 / 平台 Keychain plugin | 同左 |

### TTL 策略
| 客戶端類型 | Access Token | Refresh Token |
|-----------|-------------|---------------|
| Web 瀏覽器 | 15 分鐘 | 7 天 |
| iOS / Android | 15 分鐘 | 30 天 |
| Unity / Unreal | 15 分鐘 | 90 天 |
