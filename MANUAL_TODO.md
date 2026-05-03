# Manual TODO — 只能手動完成的 Cloudflare 設定

這份檔案列出**只有你能在 Cloudflare / GitHub Dashboard 操作的步驟**。
程式碼已部署，但需要這些設定才會真正生效。

未配置時的 graceful degradation：
- KV：`functions/utils/kv.js` 在 binding 未設時 fallback 為 cache miss（不破流程）
- Turnstile：secret 未設時 `verifyTurnstile()` 會 skip（不破流程，但無防護）
- Cron：`CRON_SECRET` 未設時 endpoint 回 500 + workflow 失敗（看得見，不會悄悄壞）
- Access：完全選擇性，不影響 app 行為

---

## 1. KV Namespace 建立 ⚠ 中等優先

**現況**：`wrangler.toml` 已加 binding 但 `id = "PLACEHOLDER_FILL_AFTER_WRANGLER_CREATE"`
**用途**：JWKS / revoked_jti / oauth_clients lookup 快取

### 步驟

```bash
# 1. 建 namespace
wrangler kv namespace create CHIYIGO_KV

# 回傳會像：
# 🌀 Creating namespace with title "chiyigo-com-CHIYIGO_KV"
# ✨ Success!
# Add the following to your configuration file:
# id = "abcd1234..."
```

```toml
# 2. 把 id 填回 wrangler.toml
[[kv_namespaces]]
binding = "CHIYIGO_KV"
id      = "abcd1234..."     # ← 填上面拿到的
```

```
3. Cloudflare Pages dashboard 同步綁定
   chiyigo-com → Settings → Functions → KV namespace bindings
   - Variable name: CHIYIGO_KV
   - KV namespace: 選剛建的 chiyigo-com-CHIYIGO_KV
   （Pages Direct Upload 模式 wrangler.toml + dashboard 都要設）
```

---

## 2. Turnstile（反 bot 驗證）⚠ 高優先

**現況**：login / register / forgot-password 三個端點已串好 widget + 後端驗證
**目前狀態**：用 Cloudflare 測試 sitekey（永遠通過）→ 視覺有 captcha 但實際零防護

### 步驟

#### 2.1 建立 Turnstile widget
1. Cloudflare Dashboard → 左下 **Turnstile** → **Add site**
2. 設定：
   - Site name: `chiyigo`
   - Domain: `chiyigo.com`（含子網域可加 `mbti.chiyigo.com` `talo.chiyigo.com`）
   - Widget Mode: **Managed**（推薦，CF 自動判斷顯示哪種挑戰）
3. 拿到兩把 key：
   - **Site Key**（公開）：`0x4AAAAA...`
   - **Secret Key**（保密）：`0x4AAAAA...`

#### 2.2 替換前端 sitekey
全文搜尋並替換 `1x00000000000000000000AA`：

```bash
# 應該找到 3 處（login.html × 2 + forgot-password.html × 1）
grep -rn "1x00000000000000000000AA" public/
```

把它們改為你拿到的 site key。

#### 2.3 設定後端 secret
Cloudflare Pages dashboard → chiyigo-com → Settings → Environment variables → **Production**：
- 新增 `TURNSTILE_SECRET_KEY` = 你的 secret key
- 標記為 **Encrypt**（不可見）

設了之後：`functions/utils/turnstile.js` 會自動啟動驗證；之前的 graceful skip 失效。

---

## 3. Cron — D1 Cleanup ⚠ 高優先

**現況**：endpoint `/api/admin/cron/cleanup` 已寫，GitHub Actions workflow 已加
**目前狀態**：CRON_SECRET 未設 → endpoint 回 500、workflow 會 fail（看得見的失敗）

### 步驟

```bash
# 1. 產生隨機 secret（複雜度 ≥ 32 字元）
openssl rand -hex 32
# 或在 PowerShell：
# [Convert]::ToHexString((1..32 | %{[byte](Get-Random -Max 256)}))
```

#### 3.1 設定 Pages env var
Cloudflare Pages dashboard → chiyigo-com → Settings → Environment variables → Production：
- 新增 `CRON_SECRET` = 上面產的 hex
- 標記為 **Encrypt**

#### 3.2 設定 GitHub repo secret
GitHub repo → Settings → Secrets and variables → Actions → New repository secret：
- Name: `CRON_SECRET`
- Value: **同一個 hex**（兩邊必須一致）

#### 3.3 驗證
1. Push commits → GitHub Actions tab 看 `Cron — D1 Cleanup` workflow
2. Run manually 一次：Actions → Cron — D1 Cleanup → **Run workflow**
3. 看 log，正常會看到：
   ```
   Status: 200
   Body: {"ok":true,"totalDeleted":N,"results":[...]}
   ```

---

## 4. Cloudflare Access — Admin 保護 🟡 中等優先

詳細步驟見 `docs/runbooks/access-admin-setup.md`

**重點**：
- 免費 50 user 額度
- 套到 `/admin*` 路徑
- **務必** 設 `/api/admin/cron/*` Bypass policy（否則 GitHub Actions cron 會被擋）
- 白名單 email：`a3010030100a@gmail.com`

---

## 5. Phase 0 Migrations 套用到 D1 ⚠ 高優先

**現況**：Migrations 0015–0018 已 commit 但**還沒跑**到 prod D1

### 步驟

```bash
# 對 production D1 套用
wrangler d1 execute chiyigo_db --remote --file=migrations/0015_oauth_clients.sql
wrangler d1 execute chiyigo_db --remote --file=migrations/0016_revoked_jti.sql
wrangler d1 execute chiyigo_db --remote --file=migrations/0017_audit_log.sql
wrangler d1 execute chiyigo_db --remote --file=migrations/0018_users_public_sub.sql
```

驗證：
```bash
wrangler d1 execute chiyigo_db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
# 應該看到 oauth_clients / revoked_jti / audit_log
```

---

## 6. 完成後可以刪掉這份檔

全部設好 + 驗證通過 → `git rm MANUAL_TODO.md`

或保留作為 onboarding 文件（未來重建環境時參考）。

---

## 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | 初版（KV / Turnstile / Cron / Access / Migration 5 項）|
