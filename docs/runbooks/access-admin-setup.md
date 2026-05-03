# Cloudflare Access — Admin 路徑保護

**目的**：用 Cloudflare Access（Zero Trust 免費層 50 user）把 `/admin*` 鎖在 SSO + MFA 後面，而非單純依賴 app 內 RBAC。
**成本**：$0/月（50 user 以下免費）
**適用範圍**：`chiyigo.com/admin*`、`chiyigo.com/api/admin/*`（**例外** `/api/admin/cron/cleanup`，已自帶 bearer auth 給 GitHub Actions cron 用）

---

## 1. 為什麼加 Access

| 不加 Access 的風險 | 加上 Access 後 |
|---|---|
| 任何人能戳 `/admin*` URL | 無 Access SSO 直接 403，連登入頁都看不到 |
| admin 被盜帳號 = 整站失守 | 多一層 Cloudflare 自家 MFA |
| RBAC bug 直接暴露 admin endpoint | 兩層獨立認證 |

---

## 2. 一次性設定步驟

### 2.1 開啟 Zero Trust（如未開啟）
1. Cloudflare Dashboard → 左上「Account Home」
2. 左側選單 → **Zero Trust**
3. 首次進入會要求建立 team domain（例：`chiyigo.cloudflareaccess.com`）
4. 選 Free 方案

### 2.2 建立 Access Application
1. Zero Trust → **Access** → **Applications** → **Add an application**
2. 選 **Self-hosted**
3. 設定：
   - **Application name**：`chiyigo-admin`
   - **Session duration**：`24 hours`（依習慣調）
   - **Application domain**：
     - subdomain: `chiyigo`
     - domain: `chiyigo.com`
     - path: `/admin*`
4. （可選）再加一個 application 給 API：
   - path: `/api/admin/*`
   - **但要設例外** `/api/admin/cron/*`（cron 自帶 bearer auth）
   - 做法：Access policy 不能 bypass 子路徑，所以另外建一個 Bypass policy
     for `/api/admin/cron/*`，放在主 policy 之前

### 2.3 設 Identity Providers
1. Zero Trust → **Settings** → **Authentication**
2. 加 **Login methods**：
   - Google（最快）
   - 或 One-time PIN（純 email magic link，零依賴）
3. 啟用 **Require purpose justification** = OFF（個人專案不必）

### 2.4 設 Policy
1. 回到 application → **Policies** → **Add a policy**
2. 設定：
   - **Policy name**：`admin-allowlist`
   - **Action**：`Allow`
   - **Configure rules**：
     - **Include** → **Emails** → `a3010030100a@gmail.com`（只放白名單，不用 group）
3. 儲存

---

## 3. 驗證
1. 開無痕視窗訪問 `https://chiyigo.com/admin-requisitions.html`
2. 應該被導到 `chiyigo.cloudflareaccess.com` 登入頁
3. 用白名單 email 登入 → magic link / Google → 通過
4. 進到 admin 頁；同時 app 內 RBAC 仍會驗一次（雙層）

---

## 4. Cron endpoint 例外處理

`POST /api/admin/cron/cleanup` 由 GitHub Actions 排程呼叫，沒有瀏覽器 cookie。
若 `/api/admin/*` 套了 Access，會被 Access 擋掉。

**解法**：
- Application 套用範圍**不要包含** `/api/admin/cron/*`
- 或建一個 path 為 `/api/admin/cron/*` 的 Bypass policy，先於主 application

實際操作：
1. Application **chiyigo-admin** 的 application domain 填 `/admin*`（不含 `/api/`）
2. 另建 Application **chiyigo-admin-api**：
   - path: `/api/admin/*`
   - Policies：
     - Policy 1（順序在前）：**Bypass** for path `/api/admin/cron/*`
     - Policy 2：**Allow** with email allowlist

---

## 5. 緊急失效處理

如果你的 Cloudflare 帳號被鎖、Access 故障，admin 路徑會 403 進不去：

- 暫時 workaround：Cloudflare Dashboard → Pages → chiyigo-com → Settings → Functions → 改 routing rules 暫繞過 `/admin*`
- 永久方案：另外綁一個非 root domain 的 admin（例：`admin-emergency.chiyigo.com`）只開給特定 IP，不接 Access

---

## 6. 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | 初版（規格）|
