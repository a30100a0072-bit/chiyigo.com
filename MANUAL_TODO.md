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

## 3. Phase 0 Migrations 套用到 D1 ✅ 已完成（2026-05-03）

- 0015 `oauth_clients` ✅（表已存在 schema drift，IF NOT EXISTS 安全跑過）
- 0016 `revoked_jti` ✅ 新建成功（含 index）
- 0017 `audit_log` ✅（表已存在 schema drift，IF NOT EXISTS 安全跑過）
- 0018 `users.public_sub` ✅（欄位已存在，ALTER 安全跑過）

---

## 4. Cron — D1 Cleanup ✅ 已完成（2026-05-03）

- `CRON_SECRET` 已設於 Pages env var（Production，encrypted）與 GitHub repo secret（兩端一致）
- endpoint `/api/admin/cron/cleanup` 已串通，GitHub Actions workflow `Cron — D1 Cleanup` 可正常執行

<details>
<summary>原始設定步驟（保留供未來重建參考）</summary>

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

</details>

---

## 5. Cloudflare Access — Admin 保護 ✅ 已完成（2026-05-03）

- App `chiyigo-admin` 建立，保護 `chiyigo.com/admin*`
- Policy `Allow owner`：email `a30100a0072@gmail.com`
- `/api/admin/cron/*` 開頭是 `/api/` 不符合 `/admin*`，無需 Bypass policy

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
| 2026-05-03 | Cron ✅ 完成、Access ✅ 完成；剩 Migrations |
| 2026-05-03 | Migrations 0015–0018 ✅ 全部完成 → MANUAL_TODO 全項打勾 |
