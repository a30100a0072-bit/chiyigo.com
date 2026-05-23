# R2 Retention Lock Behavior — audit cold archive

F-3 Phase 2 PR 0.2c-pre-1b — real-world R2 lock contract（從 preview spike 凍結 fixture 取得）+ 0.2c prod lock 前置 runbook + recovery / break-glass。

> 本文取代 `docs/AUDIT_RETENTION_PLAN.md` §「R2 lock enforcement 風險記錄」段落（PR 0.2a smoke 暫定結論：lock 不 enforce）。本文以 PR 1b spike 結果為準。

## TL;DR

- ✅ R2 retention lock **enforce same-prefix DELETE + same-key PUT-overwrite via S3 API + limited token**（PR 1b spike 親驗）
- ✅ Locked prefix 內 **PUT new key 仍 200** → PR 1a write-once R2 key 設計成立
- ✅ Error shape (S3 path)：HTTP `409` + XML body `<Code>ObjectLockedByBucketPolicy</Code>`
- ❌ PR 0.2a smoke 暫定結論「lock 不 enforce」**已被推翻** — 那次很可能是 wrangler r2 owner-level / bypass 路徑造成（非本文 limited-token spike 路徑）
- 🔴 **GATE for PR 0.2c prod lock enablement**：**Worker R2 binding path canary 必須在 prod lock 上線前完成**。本 1b spike 只證 S3 sigv4 + limited token path enforce；prod cron `env.AUDIT_ARCHIVE_BUCKET.put(...)` 走 worker binding（account-level，等同 owner/wrangler 那條被推翻路徑的權限位階）— **沒有直接證據顯示 binding path 一樣 enforce**。若 binding 也 bypass，prod cron same-key overwrite / DELETE 在 lock 下其實都通，classifier 也不會 throw → 防線形同空轉。**Codex r1 P1 點明此 gap**。

## Spike 結果（2026-05-23）

詳細 fixture：`docs/fixtures/r2-lock-spike-2026-05-23.json`

| Operation | HTTP | Behavior | Cron 路徑對應 |
|---|---|---|---|
| `PUT same key + same body` | **409** | BLOCKED | recovery 路徑 PUT data（key_scheme=2 已走 HEAD pre-check + sha verify skip） |
| `PUT same key + different body` | **409** | BLOCKED | 不該發生 — 同 key 不同內容違反 content-addressed sha；發生 = 嚴重 bug |
| `PUT new key in locked prefix` | **200** | ALLOWED | write-once manifest state transition（每 state 自己的 key） |
| `DELETE same key` | **409** | BLOCKED | force_purge（PR 0.2c-pre-2 + PR 2.3） |

Blocked 操作的 XML body 完全一致：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>ObjectLockedByBucketPolicy</Code>
  <Message>The object is locked by the bucket policy.</Message>
</Error>
```

## isR2LockError classifier 對齊狀態

`functions/utils/audit-archive.ts#isR2LockError`（PR 1a + 1b tighten）：

- **Fast-path**：`code === 'ObjectLockedByBucketPolicy'` → 直接 `true`（spike-frozen high-confidence S3 code，[[feedback_r2_lock_overwrite_design]] 不可猜原則 — 加新 code 必同步加 fixture + unit test）
- **Fallback dual condition**：HTTP status `(409|412)` AND error message/code/name 含 lock-related marker → `true`
- **Nested**：走一層 `error.cause` 鏈（防 worker binding wrap）

正向 / 負向 regression：`tests/audit-archive.test.ts` describe = `PR 0.2c-pre-1a：isR2LockError 保守 detector`。

### 🔴 GATE：Worker binding canary 未驗 — prod lock 上線前必補

Spike 走 S3 sigv4 fetch（response.status 409 + XML body）。**Prod cron 走 worker binding**（`env.AUDIT_ARCHIVE_BUCKET.put(...)`），它的 enforcement 與 error shape **都尚無 direct 觀察**。

**Codex r1 P1 點明的關鍵 risk**：

1. **不只是 shape 未知 — enforcement 本身可能不一樣**：PR 0.2a smoke 結論「lock 不 enforce」被本 spike 推翻的原因正是「owner/wrangler bypass」假設。Worker binding 是 account-level token，**與 wrangler 同位階**。若 binding 也 bypass，prod cron same-key overwrite / DELETE 在 lock 下其實都 200/204 通過，沒 throw → classifier 永遠不會被呼叫 → r2_lock_detected 永遠不 emit → 防線空轉，資料完整性假象。
2. **若 binding throw 但 shape 不含 marker**：classifier 漏判 → `audit.archive.upload_failed` critical 仍 emit 但 `audit.archive.r2_lock_detected` critical 不會 emit → 告警語義失真但有保底訊號。
3. **若 binding 完全沒 throw + 也沒 propagate response error**：最糟場景 — 連 upload_failed 都不會 emit，prod 完全靜默。

**Gate procedure（PR 0.2c 上 prod retention lock 前必跑）**：

1. Preview bucket 仍有 active lock prefix (1b spike 留下、24-48hr 自動清前可直接用) 或重設一個 throwaway prefix
2. 部署一個臨時 `/api/admin/cron/r2-binding-canary` Pages Function endpoint：
   - Auth: `CRON_SECRET`
   - Body: `{ prefix, key, body, op: 'put_overwrite' | 'put_new' | 'delete' }`
   - 用 `env.AUDIT_ARCHIVE_BUCKET.put/get/delete` 對 preview bucket 試
   - 捕捉 binding 拋的 Error（含 name/message/code/status/cause chain）
   - 對 status=200 success / throw 的 case 都 JSON 回傳
3. Curl 該 endpoint，跑 3 個 op，capture binding 真實 error shape（或證 binding 一樣 bypass）
4. 結果寫進 `docs/fixtures/r2-lock-binding-canary-<date>.json`
5. **必 1 of 2 outcome**：
   - **(a) Binding 也 enforce + classifier 命中**：proceed prod lock
   - **(b) Binding bypass / classifier 不命中**：**reject prod lock**，先補：(i) 改 binding wrapper 加 explicit lock check（或） (ii) 改用 S3 sigv4 fetch path（cron handler 改寫，cost 大） (iii) 等 Cloudflare R2 binding 行為調整
6. 臨時 endpoint 在 gate 完成後同 PR 移除（避免遺留 prod-touching surface）

該 gate 由 **PR 0.2c-pre-1c**（或專屬 PR 0.2c-pre-1b.1，視 1c scope 而定）執行。

**Why not now**：本 PR (1b) 範圍是 S3 limited-token spike + classifier tighten + docs；binding canary 牽涉部署臨時 prod endpoint，是不同 risk profile 的工作（user 在 1b 啟動時拍板 X 路徑 = local sigv4 script，明確 reject 了 Y endpoint）。binding canary 必走 endpoint 路徑（binding 只在 worker runtime 存在），自然落在 1c 或 1b.1 範圍。

## PR 0.2c prod lock 上線前置 checklist

> ⚠️ **R2 retention lock 不可逆**：`--retention-days 2555` 設下去 7 年內無法 DELETE（即便 admin / root token）。誤設只能等過期。

### 必驗（gate items）
- [ ] 所有既存 audit_log archive chunks 都已升 `purged`（terminal）— 否則 legacy key_scheme=1 chunks 進 locked prefix 後其 single manifest key 在 state transition 會被擋住卡死
- [ ] 所有未來 cron run 一律走 key_scheme=2（runFreshChunkPipeline 已硬寫死 `KEY_SCHEME_WRITE_ONCE`，PR 1a deploy 之後 prod 已生效）
- [ ] **🔴 Worker R2 binding canary 已親驗 enforce + capture 真實 error shape**（PR 0.2c-pre-1c 或 0.2c-pre-1b.1；見上方「GATE：Worker binding canary」段 — 沒這條就不能 proceed prod lock，因為 S3 sigv4 spike 不代表 binding path 同樣行為）
- [ ] Aggregate worker (audit-aggregate-archive-runner.ts) 也已平行 write-once refactor（**PR 0.2c-pre-1c follow-up**；R2 lock 上 aggregate prefix `audit-log-aggregate-{telemetry,debug}/` 前必做）
- [ ] force_purge endpoint 已 catch lock 423 LOCKED（**PR 0.2c-pre-2** — PR 1a 已留 placeholder catch；1b 後續完善）
- [x] Preview bucket S3 sigv4 path lock canary 已親驗 enforce（**本 1b spike 完成** — 但只證 S3 path、不代表 binding path）
- [ ] 演練 break-glass：spike prefix 在 retention 過期後 wrangler 移 lock + DELETE 路徑
- [ ] 1b spike 期間 leaked `cfat_*` Bearer token 已 Rolled 失效（[[user 補做]]；audit-archive-writer Pages secret 同步更新）

### Lock rule 指令清單

詳細 36 條 lock + 36 條 lifecycle 指令在 `docs/AUDIT_RETENTION_PLAN.md` PR 0.2c runbook 段（v8.3 Step 0.2c）。執行順序原則：
1. 先設 lifecycle（無 retention enforce，只是過期清理）
2. 後設 lock（不可逆）
3. 每組 lock 設完 sleep 10s + canary PUT 驗 propagation（[[feedback_r2_lock_propagation_canary]]）

### Rollback / break-glass

Lock 設下後 retention 期內**沒有 rollback**。唯一逃生門：
1. **等過期**（最久 7 年 — immutable / security_critical / admin_audit_log）
2. **聯絡 Cloudflare support 申請 lock 移除**（compliance/legal 場景才會被受理）
3. **改 cold_class 路徑**（新 PR 寫入不同 prefix → 不解鎖既有；舊 prefix 等過期）

### 觀測

`audit.archive.r2_lock_detected` critical event 是首要告警訊號。Pages secret 不含 `AUDIT_ARCHIVE_PURGE_ENABLED` 之類的 kill switch（PR 2.3 force_purge 走 endpoint env gate），lock 上線後 R2 PUT 異常一律靠：
- chunks.state→failed + retry_count++
- `audit.archive.upload_failed` critical（最後一輪 attempt）
- `audit.archive.r2_lock_detected` critical（classifier 命中）

兩者並存 = lock 命中；只有 upload_failed 而無 r2_lock_detected = 非 lock 的 R2 持續錯誤（檢查 status、429 quota、Cloudflare incident）。

## Spike 環境（cleanup）

PR 1b spike 留下：
- preview bucket lock rule：`spike-r2-lock-20260523-140148-d3ad83`（after 1 day 過期）
- preview bucket lifecycle rule：`spike-r2-lock-20260523-140148-d3ad83-cleanup`（expire after 2 days）
- preview bucket object：`spike/r2-lock/20260523-140148-d3ad83/` 內 2 個物件（control.txt + newkey-XXXX.txt）

24-48hr 後 lifecycle 自動清空 prefix 物件 + lock 過期。手動移 rule：
```bash
npx wrangler r2 bucket lock remove chiyigo-audit-archive-preview spike-r2-lock-20260523-140148-d3ad83
npx wrangler r2 bucket lifecycle remove chiyigo-audit-archive-preview spike-r2-lock-20260523-140148-d3ad83-cleanup
```

## 重 spike 流程

未來 R2 平台行為若疑似改變（例如 lock 不再 enforce、error code 改名），重跑：
1. 從 1Password 取 audit-archive-writer S3 credentials（或 Roll 新組）
2. 設 secert 檔案（gitignored）為 3-line `KEY=VALUE` 格式
3. `node scripts/spike-r2-lock.mjs --phase=setup > spike-setup.json`
4. 驗 `ready_for_lock: true` → 跑 `next_step.wrangler_lock`
5. Sleep 10s → `node scripts/spike-r2-lock.mjs --phase=test --prefix=<setup 給的> > spike-test.json`
6. 對齊 sha + commit fixture 進 `docs/fixtures/r2-lock-spike-<DATE>.json`
7. 更新本文 + isR2LockError 對齊新 shape
