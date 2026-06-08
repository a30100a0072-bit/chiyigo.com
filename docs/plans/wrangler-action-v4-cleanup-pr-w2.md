# PR-W2 — 刪除 stale 重複 D1 cleanup workflow

**決策**：廢棄原 PR-W2「升級 `cleanup.yml` 至 `wrangler-action@v4`」計劃，改為**刪除整個 `.github/workflows/cleanup.yml`**。

**承接**：[wrangler-action-v4-deploy-pr-w1.md](./wrangler-action-v4-deploy-pr-w1.md) 將 `cleanup.yml` 標為「Out → PR-W2」。本文 **supersede** 該描述：PR-W2 不再升級它，而是刪除它。Codex review 對方向 A（刪除）= Approve。

## 為何刪除而非升級

原計劃要把 `cleanup.yml` 從 `wrangler-action@v3` 升 `@v4` + pin `wrangler 4.87.0`。對抗式 review 揭露這是 **net-negative**：

1. **冗餘**：`cleanup.yml` 與 canonical `cron-cleanup.yml` 同一個 cron（`0 3 * * *`），兩條路徑都自動跑。
2. **retention 語意衝突（Tier 0 correctness / auth forensics）**：
   - `login_attempts`：`cleanup.yml` `> 1 day` 即刪 vs canonical `cleanup.ts` 保留 **90 天**（風控 / forensics）。
   - `refresh_tokens`：`cleanup.yml` `expires_at < now` 即刪 vs canonical `revoked_at IS NOT NULL OR expires_at < now-14days`（14 天 rotation grace + 刪 revoked，語意根本不同）。
3. **目前壞掉、因而無害**：`cleanup.yml` 連續 5+ 天 schedule `failure`。失敗機制：`wrangler-action@v3` fallback 裝 `wrangler@3.90.0`，在第一個 DELETE（`auth_codes`）的 CF API `/memberships` 預檢就 `ERROR ... failed` → exit 1。**account 預檢即掛，0 個 DELETE 落到 D1。**
4. **升級 = 復活破壞**：pin `wrangler 4.87.0`（deploy 已驗證可正常打 CF API）會修好 `/memberships` 預檢 → 7 個 DELETE 全部開始成功 → 每天破壞 canonical 想保留的 forensics / auth 資料。

刪除一次解決：冗餘 + 語意衝突 + destructive foot-gun + Node20 升級需求 + 歷史技術債。

## Governance receipt（刪除安全性證據）

- **canonical 路徑保留且健康**：`cron-cleanup.yml → POST /api/admin/cron/cleanup`（`functions/api/admin/cron/cleanup.ts`），**11 個 active TASK**，連續 5+ 天 schedule `success`（~8s）。涵蓋 `cleanup.yml` 的 6/7 表，retention 語意更正確。
- **`password_resets` write-dormant**：全 repo **0 個 `INSERT INTO password_resets`**（reset 流程早改走 `email_verifications`）；只剩 schema（`0000`/`0004`）、test、帳號刪除順手 DELETE（`confirm.ts`）的引用。表不增長 → 刪除 `cleanup.yml` 的 `password_resets` DELETE **零 GC 洞**。
- **`wrangler-action@v3` 歸零**：v3 僅存在於 `cleanup.yml`（7 處）；`deploy.yml` 已 `@v4`。刪除後 repo 內 v3 usage = 0，2026-06-16 Node20 deadline 對 wrangler-action 的待辦自動清空。
- **不動 `cleanup.ts`**：canonical retention 已正確（為金流 / forensics 上軌準備好的底層），無需改動。

## Scope

- **改動**：刪除 `.github/workflows/cleanup.yml`（唯一 destructive 改動）。新增本 plan doc。
- **不動**：`functions/api/admin/cron/cleanup.ts`、`cron-cleanup.yml`、任何 source / migration。

## Non-blocking follow-up（不在本 PR）

- canonical `cron-cleanup.yml` 目前主要靠 GitHub Actions 失敗可見性（cleanup.yml 連續失敗 5+ 天無告警即為例）。若日後視 cleanup 為 security / forensics-critical，值得補更強的 alerting。
