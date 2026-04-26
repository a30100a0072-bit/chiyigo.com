# chiyigo.com 程式碼審計報告

**審計日期**：2026-04-26
**範圍**：functions/、public/、migrations/、database/、schema.sql、wrangler.toml
**驗證程度**：Agent 探索 + 主對話交叉驗證關鍵發現

---

## 修復進度（2026-04-26 同日）

| ID | 狀態 | 說明 |
| --- | --- | --- |
| C1 | ✅ 已修 | `migrations/0004_oauth_states_audit.sql` 已套用 prod；`database/schema_auth.sql` 同步至 prod 實際結構（email_verifications 含 token_type/used_at/ip_address/created_at；oauth_states 新增 created_at/ip_address；password_resets 標 LEGACY） |
| C2 | ✅ 已修 | `callback.js:194-211` 雙重守門：必須 `cfg.trustEmail && email_verified` 才靜默綁定，否則 403 阻擋；綁定成功後直接標記 email_verified=1 |
| C4 | ✅ 已修 | `callback.js` 新增 `escapeHtml()`，所有 `htmlError(message)` 內 message 經 escape，移除潛在 reflected XSS（`err.message` 來自第三方 IdP） |
| 額外 | ✅ | `init.js:125-135` 寫入 IP（migration 已加欄位） |
| H1 | ✅ 已修 | `.github/workflows/cleanup.yml` 增 oauth_states / password_resets / login_attempts 排程清理（每日 UTC 03:00） |
| H2 | ✅ 已修 | `cors.js:isAllowedOrigin` 改為僅 `env.ENVIRONMENT === 'development'` 才放行 localhost；`wrangler.toml` 新增 `[vars] ENVIRONMENT = "production"`（dev 端請於 `.dev.vars` 加 `ENVIRONMENT=development`） |
| H5 | ✅ 已修 | `register.js` 改用 `ctx.waitUntil(sendVerificationEmail(...))` 寄信，移除 TODO；無 `RESEND_API_KEY` 時跳過 |
| M1 | ✅ 已修 | 新增 `functions/utils/password.js` 共用 `validatePassword()`（≥12 或 ≥8 含 3 類字元），register / reset-password 已替換 |
| M2 | ✅ 已修 | `migrations/0005_pkce_sessions_audit.sql` 為 pkce_sessions 加 created_at/ip_address；authorize.js INSERT 帶入 IP；schema_iam_fresh.sql 同步 |
| M4 | ✅ 已修 | `auth.js` Bearer token `slice(7).trim()`，空值直接回 401 |
| M5 | ✅ 已修 | `public/_headers` 加 HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy / CSP（白名單 Tailwind CDN / jsdelivr / CF Insights / Google Fonts） |
| M6 | ✅ 已修 | `register.js` 訪客轉正加 `AND owner_user_id IS NULL` 保險，避免覆蓋已綁定紀錄 |
| M3 | ✅ 已修 | email 驗證信改指 `/verify-email.html?token=...`；新建前端確認頁，token 核銷只走 POST，避免郵件代理預載；舊 GET link 自動 redirect 至確認頁向後相容 |
| M7 | N/A | 驗證後 `login.js` INSERT login_attempts 僅在密碼/帳號失敗的兩個分支執行（無誤報） |
| M8 | ✅ 已修 | migration 0006 為 requisition 加 `source_ip`；POST 加 per-IP 3 單/日上限；TG 訊息對使用者輸入做 HTML escape；移除 `console.error` 殘留 |
| L1 | ✅ 已修 | 刪除根目錄過時 `schema.sql`；新建 `database/README.md` 明示 migrations 為 SoT、`database/*.sql` 僅為 reference |
| L2 | ✅ 已修 | `email.js` BASE_URL/FROM_ADDRESS 改從 `env.IAM_BASE_URL` / `env.MAIL_FROM_ADDRESS` 讀；4 個呼叫端皆傳入 env |
| L3 | ✅ 已修 | `wrangler.toml` 加 `[vars]` 預設與 `[env.preview.vars]` 區段；IAM_BASE_URL / MAIL_FROM_ADDRESS 改用 vars 管控 |
| L9 | ✅ 已修 | `callback.js` 全新用戶建立改用 `last_row_id` 取代 batch + SELECT，避免 D1 batch 跨語句可見性風險 |
| L8 | ✅ 已修 | bind/forgot/reset-password、login、admin-requisitions、dashboard 所有 form input 補 `<label for>` 或 `aria-label`（confirm-delete / verify-email 純按鈕無 input） |
| dashboard 主題 | ✅ 已修 | dashboard 加回光/暗模式切換按鈕（與 login.html 同款式），新增 `.theme-light` CSS 反轉，沿用 `localStorage.theme` 預載（line 9 IIFE）避免登入後重置為暗模式 |
| L4 | ✅ 已修 | 引入 vitest（unit 20 tests）+ `@cloudflare/vitest-pool-workers`（integration 16 tests，workerd + miniflare D1）；reset-password 全分支覆蓋（非 2FA / TOTP / backup code / OAuth-only / **並發重放原子性**），CI 三階段執行（lint → unit → integration） |
| L5 | ✅ 已修 | 新增 `.github/workflows/ci.yml`：PR/push 跑 `npm ci` + `npm run lint` + `npm test` + `npm audit --omit=dev --audit-level=high`（生產依賴 0 漏洞） |
| L6 | ✅ 已修 | ESLint v9 flat config (`eslint.config.js`)，functions / tests 分區、僅基礎正確性規則；`npm run lint` 加入 CI；目前 0 errors / 6 warnings |
| L7 | ✅ 已修 | `auth-ui.js` ERROR_ZH → ERROR_I18N（4 語）+ 新增 UI_I18N 字典（14 keys × 4 語）+ `getLang()` / `uiT()`；所有內嵌 zh-TW showMsg / btn label 改為 i18n 查詢；dashboard / login / reset-password 既有 data-i18n 架構不變 |

### 部署驗證 — 2026-04-26

- **Production active**：`eef12dbe.chiyigo-com.pages.dev`（commit `5181d63`）
- **失敗歷史**：commit `84114aa` 因 `wrangler.toml` 加入 `IAM_BASE_URL` / `MAIL_FROM_ADDRESS` 與 Pages dashboard env vars 衝突 → `5181d63` 回退至僅保留 `[vars] ENVIRONMENT="production"` 後重新成功部署。
- **手動煙霧測試**：
  - 登入流程 → 密碼正確 → `POST /api/auth/local/login` 回 **403 `{ code: "TOTP_REQUIRED" }`** 觸發 2FA 畫面 ✅（設計如此，非 bug）
  - Console 無 CSP violation、無 CORS 錯誤
- **`.md` 雙檔架構**：`BUILD_PLAN.md`（產品路線圖）+ `AUDIT.md`（安全/技術債檢查）職責分離，標準作法，不需合併。

**勘誤（驗證後）**：
- `email_verifications` 在 prod **已有** 完整欄位（token_type/used_at/ip_address/created_at），原報告 C1 誇大為「程式會立刻崩潰」實為「schema 來源真相不一致」。已透過同步 schema_auth.sql 修正。
- `password_resets` 表雖然 schema 中存在，但實際所有流程改走 `email_verifications + token_type='reset_password'`；該舊表僅在 `delete/confirm.js` 做防禦性 DELETE。標 LEGACY 不再寫入。

---

## 嚴重度總覽

| 等級 | 數量 | 處理時程 |
| --- | --- | --- |
| CRITICAL | 4 | 立即 |
| HIGH | 5 | 1 週內 |
| MEDIUM | 8 | 2-4 週 |
| LOW / 技術債 | 9 | 排入 backlog |

---

## CRITICAL — 必須立即處理

### C1. Schema drift：`database/schema_auth.sql` 與生產實際結構不一致

**檔案**：`database/schema_auth.sql:62-73, 85-91`

**問題**：
程式碼大量使用 `email_verifications.token_type / used_at / ip_address / created_at`、`password_resets.used_at`、`oauth_states.created_at` 等欄位（見下方引用），但 `schema_auth.sql` 中對應 CREATE TABLE 完全沒有這些欄位。生產 D1 應為手動 ALTER（commit 5c4f01d 顯示 0003 已套用，但 0001~0003 都沒有對 email_verifications 增欄位的 migration）。

引用程式：
- `functions/api/auth/email/verify.js:23-28` — `WHERE token_type='verify_email' AND used_at IS NULL`
- `functions/api/auth/email/send-verification.js:33-37, 74-80` — `INSERT (..., token_type, ip_address, ...)`、`WHERE ip_address=? AND created_at>...`
- `functions/api/auth/local/reset-password.js:42-50, 113-121` — `token_type='reset_password' AND used_at IS NULL`

**影響**：
1. 任何用 `wrangler d1 execute --file=database/schema_auth.sql` 重建的環境（CI、新人 onboarding、災難恢復）會立即崩潰。
2. 程式碼與 schema 來源真相不一致，未來不可審計。
3. 與另兩套 SQL（`migrations/`、根目錄 `schema.sql`）形成「三套不同步 schema」。

**Debug 步驟**：
1. 先確認生產 D1 實際結構：
   ```bash
   wrangler d1 execute chiyigo_db --remote \
     --command="SELECT sql FROM sqlite_master WHERE name IN ('email_verifications','password_resets','oauth_states');"
   ```
2. 建立 `migrations/0004_auth_token_columns.sql`，把生產上手動 ALTER 過的欄位補成正式 migration：
   ```sql
   -- email_verifications
   ALTER TABLE email_verifications ADD COLUMN token_type TEXT NOT NULL DEFAULT 'verify_email';
   ALTER TABLE email_verifications ADD COLUMN used_at    TEXT;
   ALTER TABLE email_verifications ADD COLUMN ip_address TEXT;
   ALTER TABLE email_verifications ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
   CREATE INDEX IF NOT EXISTS idx_email_verifications_user    ON email_verifications(user_id);
   CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);
   CREATE INDEX IF NOT EXISTS idx_email_verifications_ip      ON email_verifications(ip_address, created_at);

   -- password_resets（若仍在使用；若已併入 email_verifications，移除此表）
   ALTER TABLE password_resets ADD COLUMN used_at TEXT;

   -- oauth_states
   ALTER TABLE oauth_states ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));
   ALTER TABLE oauth_states ADD COLUMN ip_address TEXT;
   ```
3. 同步更新 `database/schema_auth.sql` 的 CREATE TABLE 定義與索引，使之等於 migrations 累計後的最終狀態。
4. 用 `IF NOT EXISTS` 守衛或寫 idempotent migration runner 確認對生產執行不會壞。
5. 決定 schema 管理單一真相：建議只保留 `migrations/`，刪除根目錄 `schema.sql`，`database/*.sql` 改成「快照（reference only）」並標註不可直接執行。

---

### C2. OAuth 信箱碰撞會在未驗證信箱情況下靜默接管帳號

**檔案**：`functions/api/auth/oauth/[provider]/callback.js:200-217`

**問題**：
```js
if (existingUser) {
  if (!cfg.trustEmail) { return htmlError(...) }
  // trustEmail=true（Discord / Google）→ 靜默綁定
  userId = existingUser.id
  await db.prepare(`INSERT OR IGNORE INTO user_identities ...`)...

  if (email_verified) {
    await db.prepare(`UPDATE users SET email_verified = 1 ...`)...
  }
}
```
`trustEmail` 是 provider 層級旗標（信任該 IdP **本身**），但程式並沒檢查單次回傳 `email_verified` 是否為 true 就進行綁定。Discord 雖然要求帳號 email 驗證，但 `verified` 欄位在某些情境（OAuth scope 不含 `email`、provider 改 API）可能缺漏；Google 雖通常給 `email_verified=true`，仍應作為前置條件。

**影響**：
- 攻擊者 Google 帳號改成受害者 email（在某些舊 IdP 配置下可能不需驗證即可改）→ 用該 Google 登入 chiyigo → 自動綁定到受害者本地帳號 → 從此可用 Google 登入受害者帳號。
- 即使 Google/Discord 嚴守 verified，也是**單一外部廠商安全假設**，破口風險高。

**Debug 步驟**：
1. 在 callback.js:200 增加守門：
   ```js
   if (existingUser) {
     if (!cfg.trustEmail || !email_verified) {
       // 改走 bind-email 流程：發 temp_bind JWT 跳轉 bind-email.html，要求對方輸入密碼或驗證 email
       const tempToken = await signJwt({
         sub: provider_id, provider, name, avatar,
         pending_email: emailLower,
         scope: 'temp_bind',
       }, TEMP_BIND_TTL, env)
       return Response.redirect(`${baseUrl}/bind-email.html?token=${encodeURIComponent(tempToken)}&collision=1`, 302)
     }
     // 後續綁定流程...
   }
   ```
2. 確認 bind-email.html 流程能在 collision=1 時要求輸入既有帳號密碼或進行 email 二次驗證再綁定。
3. 對既有的 user_identities 做一次清查：
   ```sql
   SELECT u.email, ui.provider, ui.created_at
   FROM user_identities ui JOIN users u ON u.id = ui.user_id
   WHERE ui.created_at > '2026-04-01'
   ORDER BY ui.created_at DESC;
   ```
   若發現可疑綁定（同 email 多 provider 短時間建立），通知該使用者並提供解綁。

---

### C3. 密碼重設流程允許「OAuth-only 帳號」設定密碼，等同新增登入路徑

**檔案**：`functions/api/auth/local/reset-password.js:138-149`（程式註解明寫「OAuth-only 用戶首次建立密碼」）

**問題**：
```js
await db.prepare(`
  INSERT INTO local_accounts (user_id, password_hash, password_salt, totp_enabled)
  VALUES (?, ?, ?, 0)
  ON CONFLICT(user_id) DO UPDATE SET
    password_hash = excluded.password_hash, password_salt = excluded.password_salt
`).bind(userId, newHash, newSalt).run()
```
但啟動 reset 流程的 `forgot-password.js` 只要 email 存在就會發 reset token。對純 OAuth 用戶（無 local_accounts）這代表：

1. 攻擊者在登入頁輸入受害者 email → 受害者收到「重設密碼」信。
2. 如果受害者郵箱被劫持（弱信箱密碼、SIM swap、IdP 端漏洞）→ 攻擊者用 token 為一個原本「沒有密碼登入路徑」的帳號**新建密碼**，從此可繞過 OAuth 直接登入。
3. 純 OAuth 用戶平常不預期收到重設密碼信，社工釣魚成本低。

**影響**：橫向擴張的帳號接管面，使原本「我家沒裝門鎖（沒設密碼）」的房子被陌生人裝鎖。

**Debug 步驟**：
1. **方案 A（推薦，安全優先）**：限制 reset 只對已有密碼帳號開放：
   - `forgot-password.js`：在發 token 前 `SELECT password_hash FROM local_accounts WHERE user_id=?`，無紀錄時靜默回覆「若該信箱存在我們會寄信」（避免帳號枚舉），但實際不發信。
   - `reset-password.js:138-149`：把 `ON CONFLICT … DO UPDATE` 改成只 UPDATE，無紀錄則回 400。
2. **方案 B（保留功能但加守門）**：reset-password 對無 local_accounts 的用戶在 `forgot-password.js` 改寄一封「設定密碼」確認信，文案明確告知「您目前以 Google/LINE 登入，是否要新增密碼登入？」並要求二次點擊；同時在 user_identities 紀錄此次操作，登入時 push 通知到既有 IdP email。
3. 加入單元測試覆蓋兩條路徑（已有密碼 / OAuth-only）。

---

### C4. `htmlError()` 將訊息直接插入 HTML 模板，未來新增動態錯誤訊息會出現 XSS

**檔案**：`functions/api/auth/oauth/[provider]/callback.js:308-320`（檔尾 `htmlError`）

**問題**：
```js
function htmlError(message, status = 400) {
  return new Response(
    `<!DOCTYPE html>...<p>${message}</p>...`,
    { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  )
}
```
目前所有呼叫站皆傳入靜態字串，**現階段不可被利用**。但這是「未來注入點」：日後若有人加 `htmlError(\`${provider} 失敗\`)` 把 URL 來的 `provider` 傳進來，立刻變成 reflected XSS。

**影響**：技術債性質的隱形地雷，code review 容易漏放行。

**Debug 步驟**：
1. 立即加上 escape：
   ```js
   function escapeHtml(s) {
     return String(s).replace(/[&<>"']/g, c => ({
       '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
     }[c]))
   }
   function htmlError(message, status = 400) {
     return new Response(
       `<!DOCTYPE html>...<p>${escapeHtml(message)}</p>...`,
       ...
     )
   }
   ```
2. 加 CSP header（見 M5）。
3. 同時檢查 `bind-email.html`、`reset-password.html` 等頁面是否將 query string 直接 innerHTML 化（`public/js/auth-ui.js` 已查過為 hard-coded SVG，安全）。

---

## HIGH — 一週內處理

### H1. `email_verifications` 缺定期清理，表會無上限增長

**檔案**：`functions/api/auth/email/send-verification.js`、`forgot-password.js`、`delete.js` 持續 INSERT，無 DELETE。
**影響**：D1 storage 隨時間單調上升，rate limit 查詢效能下降。
**Debug 步驟**：
1. 加排程清理：用 Cloudflare Cron Trigger 或在 admin endpoint 提供：
   ```sql
   DELETE FROM email_verifications WHERE expires_at < datetime('now', '-7 days');
   DELETE FROM password_resets    WHERE expires_at < datetime('now', '-7 days');
   DELETE FROM login_attempts     WHERE created_at < datetime('now', '-1 day');
   DELETE FROM oauth_states       WHERE expires_at < datetime('now');
   ```
2. 寫成 `functions/api/admin/maintenance/cleanup.js`，加 `requireRole('admin')`，由 admin UI 觸發或 Cron 排程。

---

### H2. CORS 在生產環境仍允許 `localhost`／`127.0.0.1`

**檔案**：`functions/utils/cors.js:18-22`
```js
return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
```
**影響**：使用者本機開發伺服器若被惡意頁面誘導訪問，可能因 CORS 通過導致 CSRF（雖然 cookie 是 SameSite=Lax，仍應防）。
**Debug 步驟**：
1. 加環境守衛：
   ```js
   const isDev = env.ENVIRONMENT === 'development' || env.NODE_ENV === 'development'
   if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin)) return true
   ```
2. 在 `wrangler.toml` 設 `[vars] ENVIRONMENT = "production"`，dev 時由 `.dev.vars` 覆蓋成 `development`。

---

### H3. `refreshCookie` 用 `Path=/api/auth`，限制過寬

**檔案**：`functions/api/auth/local/login.js`、`refresh.js`、`callback.js` 中的 `refreshCookie`
**問題**：refresh token cookie 在所有 `/api/auth/*` 路徑（含 me、logout 以外的端點）都會被瀏覽器送出。雖 HttpOnly+Secure，但暴露面比必要大。
**修復**：縮到 `Path=/api/auth/refresh`（與 logout 兩條路徑），其他端點不需要 refresh cookie。
```js
return `chiyigo_refresh=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/refresh; Max-Age=${maxAge}`
```
若 logout 也需，可額外設一個 same-name cookie 或讓 logout 改靠 access token。

---

### H4. `console.error(e)` 在 `functions/api/requisition.js:131` 等處殘留

**Debug 步驟**：
1. `grep -n 'console\.\(log\|error\|warn\|debug\)' functions/`（請手動跑）。
2. 移除 debug 用的 `console.log`；保留 `console.error` 但確認不會把使用者輸入或敏感欄位帶入。
3. 包一個 `logError(env, e, ctx)` 幫手，在 prod 時可決定是否寫到 KV/Logpush。

---

### H5. 註冊流程 TODO 未實現：未發送驗證信

**檔案**：`functions/api/auth/local/register.js:116`
```js
// 生產環境應在此發送驗證信（TODO: Cloudflare Email Worker / SendGrid）
```
**影響**：使用者註冊後 `email_verified=0`，但永遠收不到驗證信（除非主動到 dashboard 點「重發」）。新註冊使用者體驗破洞，且 IAM 規格名義上要求 verify 卻沒落地。
**Debug 步驟**：
1. 註冊成功後直接呼叫 `sendVerificationEmail`（已存在於 `utils/email.js`），失敗也不阻塞註冊（fire-and-forget + log）。
2. 移除 TODO，在前端註冊頁顯示「請至 email 收驗證信」。

---

## MEDIUM — 2-4 週內處理

### M1. 密碼強度只檢查長度
**檔案**：`functions/api/auth/local/register.js:32-33`、`reset-password.js:30-31`
**修復**：抽 `validatePassword(pw)` 共用工具，要求 ≥8 + 至少含 3 類（大寫/小寫/數字/符號），或 ≥12 寬鬆。

### M2. PKCE / oauth_states 缺 IP 紀錄
**檔案**：`functions/api/auth/oauth/authorize.js`、`utils/oauth-providers.js` 對 oauth_states 的 INSERT
**修復**：見 C1 migration 補欄位後，於 INSERT 帶入 `CF-Connecting-IP`，便於日後審計。

### M3. 邮件模板使用 GET 傳 token，瀏覽器/掃描器可能預載觸發
**檔案**：`functions/utils/email.js`、`functions/api/auth/email/verify.js`
**修復**：mail link 指到 `/verify-email.html?token=...` 前端頁，按下「確認」才送 POST `/api/auth/email/verify`。同樣處理 reset-password、confirm-delete（後者已經是前端頁面，OK）。

### M4. `auth.js` 對 Authorization header 切片不 trim
**檔案**：`functions/utils/auth.js:22-28`
**修復**：
```js
const token = authHeader.slice(7).trim()
if (!token) return { user: null, error: res({ error: 'Unauthorized' }, 401) }
```

### M5. 缺 CSP/HSTS/X-Frame-Options 安全 header
**修復**：在 `functions/api/_middleware.js` 或 Pages 的 `_headers` 檔加：
```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.tailwindcss.com https://static.cloudflareinsights.com 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://chiyigo.com; ...
```
（`unsafe-inline` 只是過渡，最終目標是搬走 inline script）。

### M6. `register.js` 的 guest_id 轉正使用 try-catch 吞例外
**檔案**：`functions/api/auth/local/register.js:73-88`
**修復**：guest_id schema 若已穩定，移除 try-catch 並在沒 update 到時記 log；同時加 `LIMIT` 防多列被誤動。

### M7. login.js rate limit 邏輯：成功登入也算入計數
**檔案**：`functions/api/auth/local/login.js`（INSERT login_attempts 的位置）
**問題**：要確認失敗才 INSERT；目前看似為失敗才寫入但要再核對全部分支。
**修復**：審視所有 INSERT 點，確認不會在密碼正確且 2FA 未要求時誤寫。

### M8. `requisition.js` 公開 POST 端點僅靠 turnstile/captcha？需確認
**修復**：檢查是否有 anti-bot、是否有 IP/email 速率限制（與 login 對齊）。若無，新增 hourly cap。

---

## LOW / 技術債

### L1. 三套 SQL 並存（schema.sql / database/ / migrations/）
建議只保留 `migrations/`，根 `schema.sql` 標 `LEGACY` 或刪。

### L2. 硬編碼常數（FROM_ADDRESS、BASE_URL）
`functions/utils/email.js:2-3` 應從 `env` 讀，避免 staging 寄到 chiyigo.com 信箱。

### L3. `wrangler.toml` 缺 `[env.production]` / `[env.staging]` 區段
未來上 staging 時必須補。

### L4. ~~沒有任何測試~~ ✅ 已修（2026-04-26）
- **Unit tests**（vitest，Node runtime）
  - `tests/password.test.js`：5 tests — validatePassword 各分支
  - `tests/crypto.test.js`：12 tests — salt/token 隨機性、PBKDF2 roundtrip、hashToken 確定性、PKCE RFC 7636 vector、備用碼產生與驗證
  - `tests/jwt.test.js`：3 tests — ES256 sign/verify roundtrip、tampered token 拒絕、getPublicJwk 不外洩 d
- **Integration tests**（@cloudflare/vitest-pool-workers，workerd runtime + miniflare D1）— 共 **16 tests**
  - `tests/integration/reset-password.test.js`（9）：happy path（密碼換新 + token 核銷 + refresh_tokens 清空）、過期/已用/未知 token、弱密碼、缺欄位（無 token / 無 new_password）、Invalid JSON、軟刪除帳號
  - `tests/integration/reset-password-2fa.test.js`（7）：2FA 啟用 + 未帶 OTP → 403、錯 OTP → 401、正確 TOTP → 200、正確 backup code → 200（標 used）、已用 backup code → 401、OAuth-only 首次設密碼 → 新建 local_accounts、**並發重放：同 token 兩請求 → 1×200 + 1×400**（驗證 atomic UPDATE...RETURNING）
  - 設定：`vitest.workers.config.js`（pool-workers + d1Databases:['chiyigo_db'] + bindings）
  - schema：`tests/integration/_setup.sql`（users / local_accounts / backup_codes / email_verifications / refresh_tokens 真實 schema 子集，`IF NOT EXISTS` idempotent）
  - helpers：`_helpers.js` 提供 `resetDb()` / `seedUser()` / `seedOauthOnlyUser()` / `seedResetToken()` / `enableTotp()` / `seedBackupCode()` / `callFunction()` / `jsonPost()`
- **scripts**：`npm test`（unit 快）/ `npm run test:int`（integration 慢）/ `npm run test:all`
- **CI**：兩階段都跑（lint → unit → integration）

### L5. ~~無 CI~~ ✅ 已修（2026-04-26）
- 新增 `.github/workflows/ci.yml`：PR + push to main 觸發
- Node 20，`npm ci` → `npm test`（vitest）→ `npm audit --omit=dev --audit-level=high`（只審生產依賴的 high+ 漏洞）
- ESLint 留待 L6 完成後再加 lint step

### L6. ~~`package.json` 無 lint / format script~~ ✅ 已修（2026-04-26）
- ESLint v9 flat config（`eslint.config.js`），分 functions（Workers globals）/ tests（Node globals）兩塊
- 規則僅啟基礎正確性檢查（no-undef / no-unused-vars / prefer-const / eqeqeq），不引入 prettier 避免大規模 diff
- `npm run lint` script 加入 CI workflow（lint 階段）
- 目前 0 errors / 6 warnings（皆為 catch err 未用，留待之後逐一清理）

### L7. ~~i18n 不完整~~ ✅ 已修（2026-04-26）
- `public/js/auth-ui.js`：將 `ERROR_ZH` 升級為 `ERROR_I18N`（4 語），新增 `UI_I18N`（loading / btn_login/register/verify、密碼/驗證碼錯誤、網路錯誤、註冊成功、PKCE 錯誤共 14 keys × 4 語）
- 新增 `getLang()` 讀 `localStorage.lang`、`uiT(key)` 查詢函式
- 所有內嵌 zh-TW alert / showMsg / btn label 換成 `uiT()` 呼叫
- TAB_CONFIG 預設仍為 zh-TW（first-paint），login.html `applyLangI` 載入後即時 patch（既有架構，per memory note 為設計）
- dashboard.html / register（login.html 內含）/ reset-password.html 早已實作 `data-i18n` + `LANGS_*` 字典（見 memory project_i18n.md），本次補完僅 auth-ui.js 動態字串部分

### L8. ~~`confirm-delete.html`、`bind-email.html` 等頁面缺 a11y 標籤~~ ✅ 已修（2026-04-26）
- bind-email / forgot-password / reset-password：`<label>` 補 `for=` 綁定對應 input id
- login.html：login-email/password、reg-email/password/confirm、totp-code 6 個 label 補 `for=`
- admin-requisitions.html：search-input 補 `aria-label`
- dashboard.html：tfa-otp-input、tfa-disable-input 補 `aria-label`
- confirm-delete.html、verify-email.html：純按鈕無 input，無需處理

### L9. `db.batch([...])` 中 `INSERT INTO users` 後接 `INSERT INTO user_identities ... SELECT id FROM users WHERE email=?`
**檔案**：`callback.js:230-238`
**問題**：D1 batch 是否保證原子可見性？若 batch 中第二條 SELECT 拿不到第一條 INSERT 的 row（取決於 D1 實作），會導致 user_identities 沒寫入。
**修復**：改用 `last_insert_rowid()` 或先 INSERT users 拿 id 再 INSERT identities（兩個獨立 prepare）。需查 D1 文件確認 batch 語意。

---

## 完整 Debug 步驟流程（依序執行）

```
[今天]
1. 跑 wrangler d1 execute --remote --command "SELECT sql FROM sqlite_master ..."
   → 把實際 schema 寫進 0004 migration
   → 同步 database/schema_auth.sql → COMMIT
2. 修 callback.js OAuth 信箱碰撞守門（C2）→ COMMIT
3. 修 reset-password 對 OAuth-only 帳號的處理（C3，先選方案 A）→ COMMIT
4. htmlError 加 escape（C4）→ COMMIT

[本週]
5. 排程 cleanup endpoint（H1）
6. CORS localhost 加環境守衛（H2）
7. refresh cookie Path 收緊（H3）
8. 移除 console.* 殘留（H4）
9. register 補發驗證信（H5）

[兩週內]
10. 密碼強度（M1）、PKCE IP 紀錄（M2）、auth header trim（M4）
11. _headers 加 CSP/HSTS（M5）
12. email link 改 POST（M3）

[排入 backlog]
13. 統一三套 SQL → migrations 為單一真相（L1）
14. 抽常數到 env（L2）、加 staging env 區段（L3）
15. 寫 unit test（L4）+ CI（L5）+ ESLint（L6）
16. i18n 補齊（L7）+ a11y 巡檢（L8）
17. callback.js batch 改寫為兩段（L9）
```

---

## 已驗證為**誤判**或**已實現**之項目（不需處理）

| Agent 報告 | 實際情況 |
| --- | --- |
| 「2FA disable 缺驗證」 | 已實現完整 OTP / backup code 驗證（`2fa/disable.js:34-73`） |
| 「auth-ui.js innerHTML 是 XSS」 | 內容為 hard-coded SVG，無使用者輸入流入 |
| 「Cloudflare Insights token 洩漏」 | 該 token 設計上即為 public beacon，非機密 |
| 「migrations/0003 缺 reason 欄位」 | 是設計選擇而非 bug；可列為 nice-to-have |

---

**建議**：先解 C1～C4 再做後續任何 feature。若需要，我可以協助直接實作 C1 的 0004 migration、C2 callback patch 與 C4 escape。
