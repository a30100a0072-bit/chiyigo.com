# Manual TODO — 只能手動完成的 Cloudflare 設定

這份檔案列出**只有你能在 Cloudflare / GitHub Dashboard 操作的步驟**。
程式碼已部署，但需要這些設定才會真正生效。

未配置時的 graceful degradation：
- KV：`functions/utils/kv.js` 在 binding 未設時 fallback 為 cache miss（不破流程）
- Turnstile：secret 未設時 `verifyTurnstile()` 會 skip（不破流程，但無防護）
- Cron：`CRON_SECRET` 未設時 endpoint 回 500 + workflow 失敗（看得見，不會悄悄壞）
- Access：完全選擇性，不影響 app 行為

---

## 1. KV Namespace ✅ 已完成（2026-05-03）

- 已建 `CHIYIGO_KV`（id: `e3ca0c13ce5a4ec9aee7d550b0596e04`）
- wrangler.toml binding 已生效（dashboard binding 不需要）
- 驗證通過：`/api/admin/kv-test` 回 `bound: true, writeReadOk: true`（端點已刪）

---

## 2. Turnstile（反 bot 驗證）✅ 已完成（2026-05-03）

- Widget `chiyigo` 建立完成（hostname: chiyigo.com，mode: Managed）
- Site key `0x4AAAAAADISz6kSGZRC94TQ` 已替換到 login.html / forgot-password.html
- Secret key 已存 Pages env var `TURNSTILE_SECRET_KEY`（encrypted）
- 已串：`/api/auth/local/login` / `/register` / `/forgot-password`
- 本機 dev：`.dev.vars` 用 always-pass `1x0000000000000000000000000000000AA`

> 驗證最終：實際登入一次成功 → Turnstile 全鏈路通

---

## 3. Phase 0 Migrations 套用到 D1 ⚠ 高優先（待做）

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

## 4. Cron — D1 Cleanup ⚠ 高優先（待做）

**現況**：endpoint `/api/admin/cron/cleanup` 已寫，GitHub Actions workflow 已加
**目前狀態**：CRON_SECRET 未設 → endpoint 回 500、workflow 會 fail（看得見的失敗）

### 步驟

```bash
# 1. 產生隨機 secret（複雜度 ≥ 32 字元）
openssl rand -hex 32
# 或在 PowerShell：
# [Convert]::ToHexString((1..32 | %{[byte](Get-Random -Max 256)}))
```

#### 4.1 設定 Pages env var
Cloudflare Pages dashboard → chiyigo-com → Settings → Environment variables → Production：
- 新增 `CRON_SECRET` = 上面產的 hex
- 標記為 **Encrypt**

#### 4.2 設定 GitHub repo secret
GitHub repo → Settings → Secrets and variables → Actions → New repository secret：
- Name: `CRON_SECRET`
- Value: **同一個 hex**（兩邊必須一致）

#### 4.3 驗證
1. Push commits → GitHub Actions tab 看 `Cron — D1 Cleanup` workflow
2. Run manually 一次：Actions → Cron — D1 Cleanup → **Run workflow**
3. 看 log，正常會看到：
   ```
   Status: 200
   Body: {"ok":true,"totalDeleted":N,"results":[...]}
   ```

---

## 5. Cloudflare Access — Admin 保護 🟡 中等優先（待做）

詳細步驟見 `docs/runbooks/access-admin-setup.md`

**重點**：
- 免費 50 user 額度
- 套到 `/admin*` 路徑
- **務必** 設 `/api/admin/cron/*` Bypass policy（否則 GitHub Actions cron 會被擋）
- 白名單 email：`a3010030100a@gmail.com`

---

## 6. 完成後可以刪掉這份檔

全部設好 + 驗證通過 → `git rm MANUAL_TODO.md`

或保留作為 onboarding 文件（未來重建環境時參考）。

---

## 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | 初版（KV / Turnstile / Cron / Access / Migration 5 項）|
| 2026-05-03 | KV ✅ 完成、Turnstile ✅ 完成；剩 Migrations / Cron / Access |
