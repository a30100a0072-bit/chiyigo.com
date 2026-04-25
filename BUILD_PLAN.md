# CHIYIGO.COM 建構計畫

**架構**：MPA + Cloudflare Pages Functions + D1 SQLite  
**設計系統**：Arshire Style — CSS Custom Properties + Vanilla JS，零框架  
**IAM 定位**：全端跨平台統一身份中心（Web / Unity / Unreal / iOS / Android）

---

## 整體進度快照（2026-04-25 更新）

### Cross-App SSO

| 子網域 | 狀態 | 說明 |
|--------|------|------|
| mbti.chiyigo.com | ✅ 整合 | 共用 chiyigo.com IAM ES256 JWT；PKCE 完整替換 |
| talo.chiyigo.com | ✅ 整合 | redirect SSO 模式；login.html?redirect=ORIGIN |

**SSO 流程**：子網域 → `chiyigo.com/login.html?redirect=ORIGIN` → 登入後帶 JWT 跳回  
**白名單**（`auth-ui.js` `_CROSS_APP_WHITELIST`）：`talo.chiyigo.com`、`mbti.chiyigo.com`  
**CORS**（`functions/utils/cors.js` `DEFAULT_ORIGINS`）：已加入兩個子網域  
**OAuth 支援**：登入前將 `_crossAppOrigin` 存入 sessionStorage；callback bridge 讀取後直接跳回子網域

---

### 核心系統

| 模組 | 狀態 |
|------|------|
| D1 Schema 全量（含 pkce_sessions / auth_codes / email_verifications） | ✅ |
| Auth 核心（本地登入 / 2FA / ES256 JWT / Refresh Token 輪換） | ✅ |
| OAuth 動態路由 [provider]（Discord / Google / LINE） | ✅ |
| PKCE 跨平台授權流程（authorize / code / token） | ✅ |
| CORS 防禦層 + Admin API（ban / unban / 列表） | ✅ |
| Email 驗證 + 忘記密碼 + 2FA 閉環重設 | ✅ |
| D1 垃圾回收 Cron（GitHub Actions，每日 UTC 03:00） | ✅ |
| Web HttpOnly Cookie 雙軌制（有 device_uuid → JSON；無 → Cookie）| ✅ |
| Android App Link（SHA-256 待 App 建立後填入）| ✅ |
| iOS Universal Link | 🔒 需 Apple Developer $99/yr |
| Facebook OAuth | ⏳ 暫緩（需隱私政策頁面）|

### 前端 UI

| 模組 | 狀態 |
|------|------|
| 全站設計系統（Arshire，亮暗雙主題，SaaS Dashboard 版面）| ✅ |
| 全站 Sidebar 6 項 + Mobile Overlay（手勢下滑關閉）| ✅ |
| 首頁（Hero / 服務項目 / 服務流程 / 統計數字 count-up / CTA）| ✅ |
| 案例作品（動態 D1 / filter 固定順序 / URL ?filter= / i18n）| ✅ |
| 關於我們 | ✅ |
| 接案諮詢（防爬蟲 email & LINE / 服務類型）| ✅ |
| 全站 i18n（繁體中文 / English / 日本語 / 한국어，localStorage 持久化；全站 data-i18n + 手機版語言切換器 2026-04-25）| ✅ |
| 全站主題切換一致（dark mode → 🌙，已修正 index.html 反轉 bug）| ✅ |
| 使用者儀表板 + 2FA 管理 UI | ✅ |
| Login / Forgot-password / Reset-password / Bind-email 頁面 | ✅ |

### 案例作品（D1 現有資料）

| id | 標題 | 分類 |
|----|------|------|
| 5 | 電商網站開發 | Web（網站設計）|
| 7 | MBTI 認知幾何模型 | System（系統設計）|
| 4 | AI 智能客服系統 | AI（AI解決方案）|
| 6 | 量化數據分析儀表板 | Analytics（量化數據分析）|
| 8 | 健身紀錄 APP | App（APP設計）|
| 9 | ERP 企業系統整合 | Integration（企業應用整合）|

### 需求工單系統升級（2026-04-25）

| 模組 | 狀態 |
|------|------|
| D1 Migration 0001：requisition 新增 user_id / tg_message_id / status / deleted_at | ✅ |
| POST /api/requisition：requireAuth + 每日 3 單限流（UTC+8）+ TG message_id 回寫 | ✅ |
| POST /api/requisition/revoke：IDOR 防禦 + 狀態機鎖定 + Telegram editMessageText | ✅ |
| GET /api/requisition/me：回傳當前用戶所有單（含已撤銷） | ✅ |
| requisition.html：訪客可直接提單（user_id=NULL），登入用戶帶 JWT（rate limit 各別）| ✅ |
| Dashboard「我的需求單」區塊：狀態顯示 + pending 單顯示撤銷按鈕 + Toast 回饋 | ✅ |

### IAM 身分橋接與邊界防禦（2026-04-25）

| 模組 | 狀態 |
|------|------|
| reset-password UPSERT（OAuth 用戶首次建立密碼）| ✅ |
| `/api/auth/identity/bind` — 通用綁定 API（JWT 保護）| ✅ |
| `/api/auth/identity/unbind` — 防自殺解綁 API（最後登入方式保護）| ✅ |
| OAuth init `is_binding=true` — 綁定模式 JSON 回傳 redirect_url | ✅ |
| OAuth callback 綁定分支（`binding:USER_ID` 前綴，CSRF 由 state 原子核銷保護）| ✅ |
| Dashboard 帳號綁定 UI（Google/Discord/LINE/Facebook 動態顯示，4 語言 i18n）| ✅ |

### 待辦

| 項目 | 說明 |
|------|------|
| 作品集圖片（非 MBTI 項目）| 提供截圖後依相同流程更新 |
| iOS Universal Link | 需 Apple Developer 帳號（$99/yr）|
| Facebook OAuth | 需隱私政策頁面 |
| www.chiyigo.com 重導向 | Cloudflare DNS 驗證後自動生效 |
| Android App Link SHA-256 | 待 App 建立後更新 |

---

## 線上測試（全通過）

| 範圍 | 結果 |
|------|------|
| JWKS / 帳號註冊 / 登入 / Refresh 輪換 | ✅ T1–T6 |
| Discord OAuth / Admin API / PKCE / Logout | ✅ T7–T10 |
| Email 驗證 / 忘記密碼 / 重設密碼（含 2FA 閉環）| ✅ T11–T15 |
| Dashboard Email 驗證 UI / 2FA 設定 | ✅ T16–T17 |
| Google OAuth / LINE OAuth（無信箱補填）/ Email 碰撞防禦 | ✅ T18–T21（FB 暫緩）|
| mbti.chiyigo.com PKCE 整合 | ✅ |

---

## 安全補強（2026-04-25）

| 嚴重度 | 問題 | 狀態 |
|--------|------|------|
| CRITICAL | `2fa/disable.js` 備用碼未常時比較 | ✅ |
| CRITICAL | LINE `id_token` 未驗 HMAC-SHA256 | ✅ |
| MEDIUM | `redirect_uri` 白名單 regex 過寬 | ✅ 改 Set 明確列舉 |
| MEDIUM | Admin LIKE 搜尋未 escape | ✅ |
| MEDIUM | Email 冷卻只查單一 type | ✅ 統一 60 秒不分類型 |

---

## 基礎設施

| 項目 | 值 |
|------|-----|
| D1 database_id | `59f73214-1203-44b7-840f-86cb3998fbb6`（binding: `chiyigo_db`）|
| Cloudflare Pages project | `chiyigo-com` |
| GitHub repo | https://github.com/a30100a0072-bit/chiyigo.com |
| Cloudflare Analytics token | `be8c93305dda4f16b57c925bc681b2f6` |

---

## 維護指令

### 部署（git push 僅更新 GitHub，上線需執行 wrangler）
```bash
npx wrangler pages deploy public --project-name=chiyigo-com --commit-message="fix: description in ASCII"
```
> ⚠️ commit message 含中文會導致 Cloudflare API error 8000111，請使用 ASCII 訊息。

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

### 手動升 admin
```bash
npx wrangler d1 execute chiyigo_db --remote --command "UPDATE users SET role='admin' WHERE email='你的email';"
```

### 本機開發預覽
```bash
npx wrangler pages dev public --d1 chiyigo_db
```

### mbti.chiyigo.com 部署（在 mental-modeling-assessment-v1 目錄執行）
```bash
npx wrangler deploy                                                              # Worker 後端
npx wrangler pages deploy public/ --project-name mental-modeling-assessment-v1  # 靜態前端
```

---

## 架構備忘

### PKCE Unity / Unreal 接入步驟
```
1. 生成 code_verifier（32 bytes random hex）
2. code_challenge = BASE64URL(SHA256(code_verifier))
3. GET /api/auth/oauth/authorize?response_type=code
       &redirect_uri=chiyigo://auth/callback
       &code_challenge=<challenge>&code_challenge_method=S256&state=<random>
4. 監聽 chiyigo://auth/callback?code=...&state=... 回傳
5. POST /api/auth/oauth/token { code, code_verifier, redirect_uri }
6. 取得 access_token（15 min）+ refresh_token（90 天）
```

### 跨平台 redirect_uri

| 客戶端 | redirect_uri |
|--------|-------------|
| Web SPA | `https://chiyigo.com/callback` |
| iOS Universal Link | `https://chiyigo.com/app/callback` 🔒 |
| Android App Link | `https://chiyigo.com/app/callback` |
| Unity / Unreal | `chiyigo://auth/callback` |
| Desktop Launcher | `http://127.0.0.1:PORT/callback` |

### Token 儲存規範

| 平台 | Access Token | Refresh Token | TTL |
|------|-------------|---------------|-----|
| Web | `sessionStorage` | HttpOnly Cookie（Server 管理）| 15 min / 7 天 |
| iOS / Android | Keychain / Keystore | 同左 | 15 min / 30 天 |
| Unity / Unreal | PlayerPrefs 加密 | 同左 | 15 min / 90 天 |

### Web vs App 請求判斷
```
Web  → 無 device_uuid 且（無 platform 或 platform='web'）→ Set-Cookie HttpOnly
App  → 有 device_uuid → JSON body refresh_token
```
