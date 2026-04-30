# CHIYIGO.COM 建構計畫

**架構**：MPA + Cloudflare Pages Functions + D1 SQLite  
**設計系統**：Arshire Style — CSS Custom Properties + Vanilla JS，零框架  
**IAM 定位**：全端跨平台統一身份中心（Web / Unity / Unreal / iOS / Android）

---

## 近期重大進度（2026-04-30）

### IAM 安全控制面強化 — 5 個 PR 完工（commits `9a0bbc9`→`4c799c2`，加 deploy hotfix `0c3b1c8` `a744d26`）

對照 GPT《Edge Auth 強化報告》逐項落地，補齊 P0/P1：

| Commit | PR | 主題 |
|---|---|---|
| `9a0bbc9` | PR-A | `users.token_version` 全域 revoke 機制（含 JWT `ver` claim） |
| `eaab248` | PR-B | OAuth/OIDC nonce 驗證（Apple / LINE id_token 防 replay） |
| `7405626` | PR-C | `login_attempts.kind` 統一限流（2FA / email_send / oauth_init） |
| `31fa0f8` | PR-D | `admin_audit_log` hash chain 防竄改 |
| `4c799c2` | PR-E | JWKS 多 key 驗證能力（rotation 預備） |

**migration**：0009-0012（生產 D1 已套用；0004-0008 補登 `d1_migrations` 因過去用 `schema_iam_fresh.sql` bootstrap）

**核心成果**：
- 強制下線即時生效（修密碼 / 停 2FA / 封禁 / 刪帳 → access token 立即失效，不必等 15min 過期）
- OAuth id_token replay 防禦（Apple/LINE nonce 比對；LINE 同步收緊驗簽 try/catch 容錯）
- 統一限流表 `login_attempts` + `kind` 欄位：2FA per-user 5min×5、oauth_init per-IP 1min×10、email_send per-IP 1min×3
- audit log 雜湊鏈（prev_hash + row_hash），中間列竄改 / 刪除可被偵測
- JWKS 端點回 `{ keys: [...] }`，子系統 talo 原生支援多 key 切換、mbti 走 introspection 不受影響

**驗證**：登入 → access_token 含 `ver: 0`、kid 配對成功；75 unit + 85 integration 全綠。

### 部署期 Hotfix：JWT_PRIVATE_KEY kid 前導空格 bug

舊 secret `JWT_PRIVATE_KEY` 內 `"kid":"  Yfl05aZg"`（兩個前導空格）→ JWT header.kid 跟 JWKS 公開的 `Yfl05aZg` 不一致 → talo 子系統 `keys.find(k => k.kid === ...)` 配對失敗。

**修法**：`wrangler pages secret put JWT_PRIVATE_KEY` 重設正確 JWK；之後解出來的 token header 確認 `kid: "Yfl05aZg"` 無空格。

### Talo Cross-App SSO Phase 1+2 強化（chiyigo IAM + talo 雙端完工 + 部署）

| Commit | 內容 |
|---|---|
| `9133d02` | JWT 永遠帶 `iss=https://chiyigo.com` + 新增 `audience` 選項（`signJwt` 第 4 參數） |
| `4cd6fb0` | 各簽發點依 redirect/origin 簽 `aud`；新增 `resolveAud()` 白名單對照（talo/mbti/chiyigo） |
| `fa599e8` | 跨站 redirect token 從 query 改 fragment（不進 Referer / log）；登入 fetch body 帶 aud |
| `3df9f41` | `/api/auth/refresh` & `/logout` 加 credentials CORS + OPTIONS preflight + aud 透傳 |
| `04698a6` | hotfix：`functions/api/auth/_middleware.js` OPTIONS short-circuit 改用 `getCorsHeadersForCredentials`，解決 route-level `onRequestOptions` 被 middleware 吃掉的問題 |

**talo 端對應 commit（已部署）**：
- `a5f5fd1`（worker）：強制 `payload.iss === "https://chiyigo.com"` + `payload.aud` 含或等於 `"talo"`
- `d3ce145`（web）：access token 只放 memory、apiFetch 401 → in-flight refresh promise 重試、登出呼叫 chiyigo logout、清除舊 localStorage.mbti_jwt_token

**部署**：talo-worker（`wrangler deploy`）+ talo-web Pages（`--branch=main`）+ chiyigo Pages（git push 自動）+ mbti Pages（fragment 雙讀相容）

### P2 技術債歸零（commits `09e13ae` `020068d` `5a1a1ae`）

| Task | Commit | 說明 |
|---|---|---|
| Migration 0001-0008 down.sql + smoke test | `09e13ae` | 8 個 down.sql + `migrations/_base.sql` + `tests/integration/migrations.test.js` workerd D1 跑 _base→up→down→re-up；CI 自動把關 |
| Test coverage 80% threshold | `020068d` | 加 @vitest/coverage-v8、`vitest.config.js` 80% threshold（`functions/utils/*`）；新增 50 個單元測試（cors 12 / oauth-providers 13 / auth 17 / email 8）；實際 99.69% Stmts；CI 改跑 `npm run test:cov` |
| `data-i18n-html` 全清 | `5a1a1ae` | dashboard `tfa_backup_warn` split _pre/_em/_post + 結構 HTML；forgot/reset 改 `\n` + `whitespace-pre-line`；3 支 JS 移除 `[data-i18n-html]` 迴圈；全站零 innerHTML 注入 |

### Dead code 清理（commit `fced26b`）

- 12 個 i18n JSON 移 `cta_q` + login.json 移 `sb_cta_q`（4 lang × N keys）
- 12 個 src/css 移 `.sb-cta-icon` / `.sb-cta-icon svg` / `.sb-cta-q` 三條 rule
- 48 files changed, +12 / -142 行；起源是 CSP Phase D 1e6cff6 sidebar CTA 卡片精簡的殘留

### 測試規模

- 單元：78（+3 JWKS 多 key + 1 ver claim）
- 整合：85（+6 token-version + 8 oauth-nonce + 7 rate-limit + 6 audit-log）
- 總計：163，全綠

---

## 整體進度快照（2026-04-26 更新）

### Cross-App SSO

| 子網域 | 狀態 | 說明 |
|--------|------|------|
| mbti.chiyigo.com | ✅ 整合 + Phase 1 強化 | 共用 chiyigo.com IAM ES256 JWT；PKCE 完整替換；fragment 雙讀相容 |
| talo.chiyigo.com | ✅ 整合 + Phase 1+2 強化 | redirect SSO 模式；access token memory-only + 401 自動 refresh + iss/aud 強制檢查 |

**SSO 流程**：子網域 → `chiyigo.com/login.html?redirect=ORIGIN&aud=talo` → 登入後帶 JWT 走 fragment 跳回（`#mbti_token=...`，避免 Referer / log）  
**JWT claims**：`iss=https://chiyigo.com`（永遠）+ `aud='talo'/'mbti'/'chiyigo'`（依來源） + `kid`（依 JWK）  
**白名單**（`auth-ui.js` `_CROSS_APP_WHITELIST` + `_ORIGIN_TO_AUD`）：`talo.chiyigo.com`→`talo`、`mbti.chiyigo.com`→`mbti`  
**CORS**（`functions/utils/cors.js`）：`DEFAULT_ORIGINS` 含兩子網域；`getCorsHeadersForCredentials()` 給 `/api/auth/*` 帶 `Allow-Credentials: true`  
**Refresh 機制**：`refresh_tokens` 表 + rotation；`/api/auth/refresh` & `/logout` 跨子網域 OPTIONS preflight 已支援  
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
| Facebook OAuth | ✅ 後端 + 隱私政策頁 + Meta App + Cloudflare env + login.html 按鈕全部就緒（2026-04-26）|

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
| AI 需求單助手頁面 `/ai-assistant.html`（會員專屬，sessionStorage redirect、4 語系、Workers AI 結構化輸出 + 多維限流 + ai_audit）| ✅ 2026-04-27 |

### 案例作品（D1 現有資料）

| id | 標題 | 分類 |
|----|------|------|
| 5 | 電商網站開發 | Web（網站設計）|
| 7 | MBTI 認知幾何模型 | System（系統設計）|
| 4 | AI 需求單助手（demo: `/ai-assistant.html`）| AI（AI解決方案）|
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

| 項目 | 優先 | 說明 |
|------|---|------|
| **JWT key rotation（含 kid 換新）** | 🔴 1 週內 | 2026-04-30 修 kid bug 時對話誤貼 `d` 私鑰分量，需 rotate；步驟見 memory `project_jwt_key_rotation_pending.md`（3-Phase：雙鑰並存 → 切 active → 7 天後清退）。利用 PR-E 多 key 機制無縫切換 |
| **JWKS rotation 腳本** | 🟡 P2 | `scripts/rotate-jwt-keys.mjs` — 生新 keypair、輸出供 wrangler secret 用、更新 `JWT_PUBLIC_KEYS` 陣列；rotate 時減少手工錯誤 |
| **觀測性 metrics** | 🟡 P2 | login success rate / refresh count / 2FA fail ratio / oauth_init 限流命中率，從 `login_attempts` + `_middleware` log 萃取上 Logpush |
| **E2E（Playwright）** | 🟢 P3 | OAuth 完整流程 + 2FA 鎖定 + token revoke 立即生效 + admin ban 後 access token 失效 |
| 作品集圖片（非 MBTI 項目）| | 提供截圖後依相同流程更新 |
| iOS Universal Link | | 需 Apple Developer 帳號（$99/yr）|
| ~~Facebook OAuth~~ | | ✅ 完成（移至核心系統）|
| www.chiyigo.com 重導向 | | Cloudflare DNS 驗證後自動生效 |
| Android App Link SHA-256 | | 待 App 建立後更新 |
| Cloudflare Turnstile（AI 助手）| | 設 `TURNSTILE_SECRET`（Pages env）+ 在 `ai-assistant.html` 填 `TURNSTILE_SITEKEY`，目前條件式跳過 |

### 安全待辦（Security Backlog，2026-04-25 審查）

| 嚴重度 | 項目 | 檔案 | 狀態 |
|--------|------|------|------|
| 🔴 Critical | 登入失敗無 Rate Limiting → 暴力破解 | `functions/api/auth/local/login.js` | ✅ 已修復 |
| 🔴 Critical | OAuth Callback provider 路徑反射 XSS | `functions/api/auth/oauth/[provider]/callback.js` | ✅ 已修復 |
| 🟠 High | POST 端點缺 Content-Type 驗證（潛在 CSRF 面） | 全部 POST API | ✅ 已修復 |
| 🟠 High | 刪帳未二次 Email OTP 確認 | `functions/api/auth/delete.js` | ✅ 已修復 |
| 🟡 Medium | Email 發送無 IP 全域限流 | register / forgot-password | ✅ 已修復 |
| 🟡 Medium | Admin ban/unban 無操作稽核日誌 | `functions/api/admin/` | ✅ 已修復 |
| 🟡 Medium | 2FA 備用碼無 UI 重新生成 | `functions/api/auth/2fa/` | ✅ 已修復 |

> 全部 7 項安全待辦已於 2026-04-25 修復完畢。`migrations/0003_admin_audit_log.sql` 已於 2026-04-25 套用至正式 D1。

### 安全控制面強化（2026-04-30，對照 GPT《Edge Auth 強化報告》）

| 嚴重度 | 項目 | 解法 | 狀態 |
|--------|------|------|------|
| 🔴 P0 | JWT 無 revoke 機制 → 被盜 token 15min 內全有效 | PR-A `users.token_version` + `bumpTokenVersion` 在密碼變更 / 2FA 停用 / 封禁 / 刪帳事件觸發 | ✅ |
| 🔴 P0 | OAuth id_token replay（Apple/LINE 缺 nonce） | PR-B `oauth_states.nonce` + init.js 注入 + callback 比對 | ✅ |
| 🔴 P0 | 2FA verify 端缺 rate limit → pre_auth 5min 內可暴力試 | PR-C `login_attempts.kind='2fa'` per-user 5min×5 | ✅ |
| 🟡 P1 | admin_audit_log 可被竄改 | PR-D `prev_hash + row_hash` 雜湊鏈 + `verifyAuditChain()` | ✅ |
| 🟡 P1 | JWKS rotation 能力（多 key 驗證） | PR-E `JWT_PUBLIC_KEYS` 陣列 + 依 kid 查找 | ✅ |
| 🟡 P1 | email send / oauth init 缺限流 | PR-C 統一限流框架補上 | ✅ |
| 🔧 Ops | `JWT_PRIVATE_KEY` secret kid 前導空格 | wrangler secret put 重設 | ✅ 2026-04-30 |

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
| Web (chiyigo dashboard) | `sessionStorage` | HttpOnly Cookie（Server 管理）| 15 min / 7 天 |
| Web (talo subdomain) | **memory only**（XSS 偷不到）| chiyigo .chiyigo.com HttpOnly Cookie + 401 自動 refresh | 15 min / 7 天 |
| iOS / Android | Keychain / Keystore | 同左 | 15 min / 30 天 |
| Unity / Unreal | PlayerPrefs 加密 | 同左 | 15 min / 90 天 |

### Web vs App 請求判斷
```
Web  → 無 device_uuid 且（無 platform 或 platform='web'）→ Set-Cookie HttpOnly
App  → 有 device_uuid → JSON body refresh_token
```
