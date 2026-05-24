# F-3 Phase 2 — Preview Gate Runbook（prod lock 上線前最後一關）

**目的**：在 prod bucket `chiyigo-audit-archive` 真實驗證 R2 retention lock 平台行為 + 完整 code path（lock + binding + classifier + 423 endpoint），給 prod lock 上線（不可逆 7yr retention）綠燈或紅燈訊號。

**作者**：Claude（PR 0.2c-pre-2 codex r2 Approve 後產出，2026-05-24）
**執行**：明天（或之後 fresh session）由 user + Claude collab。
**預估時間**：Layer 1 約 30 分鐘 + 24-48hr auto-cleanup 觀察窗。Layer 2 視 Layer 1 結果決定。

---

## 🔴 安全護欄（執行前必讀）

### 不可逆度
**R2 retention lock 設下去 7 年內無法 DELETE，即便 admin / root token**。前面六 gate 出錯都能在 D1/test/preview bucket 補救，這條沒。

### Prefix 命名強制 invariant
- **必須含 `sacrificial/` segment 在開頭**（pattern: `sacrificial/preview-gate/<ts>-<rand>/`）
- **禁止任何 archive worker 實際會寫入的 prefix**（黑名單）：
  - `audit-log/` / `audit-log-dryrun/`
  - `audit-log-aggregate-telemetry/` / `audit-log-aggregate-telemetry-dryrun/`
  - `audit-log-aggregate-debug/` / `audit-log-aggregate-debug-dryrun/`
  - `manifest/` / `manifest-dryrun/`
- Lock 設前必 `cat` 一次確認 prefix 字串開頭是 `sacrificial/`。**若不是、stop**。

### Retention period 強制上限
- 預覽 gate 用 `--retention-days 1`（24h auto-expire）— **禁設任何 >1 day 值**
- Lifecycle 用 `--expire-days 2`（lock 過期 +1 day buffer auto-clean）
- 若打字錯設成 `--retention-days 7` 之類 → 必聯絡 CF support 處理（不能等）

### 不做的事
- ❌ 不在 prod bucket 跑 unlock→DELETE→relock 演練（user 拍板原則，[[project_audit_phase2]] v9）
- ❌ 不刻意製造 prod cron 觸發到 sacrificial prefix（cron 不寫此 prefix，安全）
- ❌ 不重新部署 1b.1 binding canary 臨時 endpoint（除非 Layer 1 surfaces 真實 issue 才考慮）

---

## 預備檢查（執行前 5 分鐘）

### A1. Wrangler auth 狀態
```powershell
# 確認當前 PowerShell session 無 CLOUDFLARE_API_TOKEN env var 殘留（OAuth 才能用）
$env:CLOUDFLARE_API_TOKEN
# 應印空白；若有值 → Remove-Item Env:CLOUDFLARE_API_TOKEN

npx wrangler whoami
# 應印 a30100a0072@gmail.com + Account ID
# 若 9109 invalid token → npx wrangler login（瀏覽器 OAuth flow）
```

### A2. CRON_SECRET 可取（Layer 2 才需）
```powershell
# 確認 .dev.vars 有 CRON_SECRET line
Select-String -Path .dev.vars -Pattern "^CRON_SECRET=" | Measure-Object | Select-Object -ExpandProperty Count
# 應印 1
# 若印 0 → 需重 rotate（見 .dev.vars 內 ops 紀錄）
```

### A3. main HEAD 對齊 0.2c-pre-2 完工
```powershell
git log --oneline -1
# 應印 afb07ef 或之後 commit（不會早於 PR 0.2c-pre-2 cache-bust 完工）
```

### A4. Pages prod 確認 deploy 是當前 main HEAD
- 瀏覽器開 Cloudflare dashboard → Workers & Pages → chiyigo-com → Deployments
- 最新 Production deployment commit 應對齊本機 `git rev-parse --short=8 HEAD`

---

## Layer 1（必做）：Lock infra on prod bucket

**目的**：驗證 CF R2 retention lock 平台行為在 prod bucket `chiyigo-audit-archive` 跟 1b spike 在 preview bucket 觀察到的行為一致（PUT-overwrite blocked / DELETE blocked / new key in locked prefix allowed）。

**執行身分**：wrangler CLI（OAuth token，account-level，與 prod cron 走的 worker binding 同位階）

### Step 1.1：生 sacrificial prefix + ruleName

```powershell
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$rand = -join ((0..5) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$prefix = "sacrificial/preview-gate/$ts-$rand/"
$ruleName = "preview-gate-$ts-$rand"
$lifecycleName = "$ruleName-cleanup"

# 印出來檢查（必含 sacrificial/）
"prefix     = $prefix"
"ruleName   = $ruleName"
"lifecycle  = $lifecycleName"
```

**驗證**：印出的 `$prefix` 必須以 `sacrificial/preview-gate/` 開頭。如果不是，立刻 abort 重跑。

### Step 1.2：設 lock + lifecycle（**動 prod bucket**）

```powershell
# 先設 lifecycle（安全，無 retention 強制；只是過期清理）
npx wrangler r2 bucket lifecycle add chiyigo-audit-archive --id $lifecycleName --prefix $prefix --expire-days 2

# 後設 lock（**不可逆 24h**）
npx wrangler r2 bucket lock add chiyigo-audit-archive $ruleName $prefix --retention-days 1 -y
```

**預期 output**：
- lifecycle add: `✨ Added lifecycle rule '...'`
- lock add: `✨ Added lock rule '...'`

**驗證**：
```powershell
npx wrangler r2 bucket lock list chiyigo-audit-archive | Select-String $ruleName
# 應印出 rule entry，retention=1 day
```

任一指令 fail → 立刻通報 Claude，**別繼續**（半設成的 lock 是危險狀態）。

### Step 1.3：Lock propagation wait + canary control PUT

```powershell
# 等 10s 讓 lock rule 對 prefix 真生效（[[feedback_r2_lock_propagation_canary]]：rule API 200 ≠ 立刻生效）
Start-Sleep -Seconds 10

# 用 wrangler r2 object put 寫一個 control 物件進 locked prefix
$controlKey = "${prefix}control-$rand.txt"
"sacrificial control object for preview gate $ts" | npx wrangler r2 object put "chiyigo-audit-archive/$controlKey" --pipe --content-type text/plain
```

**預期**：`✨ Successfully created object`（control 物件本身允許 PUT，因為它是新 key 進 locked prefix — 與 1b spike `PUT new key in locked prefix → 200` 對齊）

### Step 1.4：嘗試 overwrite control key（**應被擋**）

```powershell
"overwrite attempt — should fail" | npx wrangler r2 object put "chiyigo-audit-archive/$controlKey" --pipe --content-type text/plain
```

**預期**：指令 fail，回 error 含 `lock` / `bucket policy` 字眼（HTTP 409 + ObjectLockedByBucketPolicy；wrangler 可能換成自己的 error message wrap）。

**對照預期**：
- ✅ 指令 fail + 含 lock 字眼 → **Layer 1 PASS**：CF R2 lock 平台對 prod bucket 行為與 preview bucket 一致
- ❌ 指令 success（overwrite 過了）→ **Layer 1 FAIL CRITICAL**：prod bucket lock 不 enforce！立刻：
  1. 不要 proceed 到 Step 1.5 或 Layer 2
  2. 通報 Claude
  3. 不要 prod lock 上線
  4. 開 ticket 給 CF support 問 prod bucket lock 是否未啟用 retention policy enforcement

### Step 1.5：嘗試 DELETE control key（**應被擋**）

```powershell
npx wrangler r2 object delete "chiyigo-audit-archive/$controlKey"
```

**預期**：同 1.4 — fail + lock 字眼。
- ✅ fail → PASS
- ❌ success → FAIL CRITICAL，同 1.4 處理

### Step 1.6：驗 control 物件仍在

```powershell
npx wrangler r2 object get "chiyigo-audit-archive/$controlKey" --file=temp-canary.txt
Get-Content temp-canary.txt
Remove-Item temp-canary.txt
```

**預期**：印出 step 1.3 的內容 `sacrificial control object for preview gate ...`，證明 control 物件沒被 1.4/1.5 動到。

---

## Layer 1 結果判斷

| Step | 預期 outcome | Layer 1 verdict |
|---|---|---|
| 1.2 | lock + lifecycle add success | ✅ infra 配置 OK |
| 1.4 | overwrite throw lock error | ✅ PUT-overwrite enforce |
| 1.5 | delete throw lock error | ✅ DELETE enforce |
| 1.6 | control object 內容不變 | ✅ no silent overwrite |

**全 4 條 PASS → Layer 1 GREEN-LIGHT for prod lock**。直接進「成功收尾」段。

**任一 FAIL → Layer 1 RED-LIGHT**。不可 prod lock 上線；通報 Claude 評估是否要做 Layer 2 進一步 diagnosis。

---

## Layer 2（可選，只在 Layer 1 surfaces 問題時做）

**何時需要**：
- Layer 1 通過 = Layer 2 不必做（六 PR codex chain 已驗證 code path）
- Layer 1 失敗 + 想 diagnose 是平台 issue 還是 binding/classifier issue → 做 Layer 2

**Layer 2 需要**：
- 重新部署 1b.1 binding canary endpoint pattern，但指向 prod bucket（不是 preview bucket）
- 跟 1b.1 同樣的 commit/deploy/run/remove 兩 commit chain
- 估時：1-2 小時 + Pages deploy + auth 配合

**先別開動**。Layer 1 PASS 後此段歸 deferred；FAIL 後再回頭設計。

---

## 成功收尾（Layer 1 全 PASS 後）

### S1. 紀錄 Layer 1 結果
```powershell
# 把這次 sacrificial run 的 metadata 寫進 fixture（給未來 forensic 比對）
$fixtureBody = @{
  gate           = "preview-gate-layer-1"
  date_utc       = (Get-Date -Format "yyyy-MM-dd")
  ts             = $ts
  prefix         = $prefix
  rule_name      = $ruleName
  lifecycle_name = $lifecycleName
  outcome        = "PASS"
  control_key    = $controlKey
  notes          = "Layer 1 4/4 steps PASS — CF R2 lock enforces PUT-overwrite + DELETE on prod bucket chiyigo-audit-archive, behavior matches preview bucket 1b spike fixture."
} | ConvertTo-Json -Depth 5
$fixtureBody | Out-File -FilePath "docs/fixtures/preview-gate-layer-1-$ts.json" -Encoding utf8
git add "docs/fixtures/preview-gate-layer-1-$ts.json"
git commit -m "docs(audit-archive): preview gate Layer 1 PASS fixture ($ts)"
git push
```

### S2. Update GATE checklist

更新 `docs/AUDIT_ARCHIVE_LOCK_BEHAVIOR.md` 必驗 checklist 加：
```
- [x] **🔴 Preview gate Layer 1 on prod bucket PASS**（YYYY-MM-DD；sacrificial prefix
      <prefix>；CF R2 lock 對 prod bucket 真實 enforce PUT-overwrite + DELETE；
      fixture docs/fixtures/preview-gate-layer-1-<ts>.json）
```

### S3. 24-48hr 後驗 auto-cleanup
明天再隔一天（48hr 後）跑：
```powershell
# Lock 應該在 ts+24h 後過期；lifecycle 應在 ts+48h 後 auto-delete control object
npx wrangler r2 bucket lock list chiyigo-audit-archive | Select-String "preview-gate-$ts"
# 應該看不到 rule（lock 已 expire + 可能被 CF 自動清）
# 若 rule 仍在 → 手動移：
# npx wrangler r2 bucket lock remove chiyigo-audit-archive $ruleName
# npx wrangler r2 bucket lifecycle remove chiyigo-audit-archive $lifecycleName

# Control 物件應該被 lifecycle expire 清掉
npx wrangler r2 object get "chiyigo-audit-archive/$controlKey" 2>&1 | Select-String "exist"
# 應該 fail with "does not exist"
```

---

## 失敗 / 異常處理

### Lock 設成功但 Step 1.4 overwrite 也 success（lock 不 enforce）
- **這是 critical bug** — 整個 F-3 Phase 2 prod lock 設計假設失效
- 不要 prod lock 上線
- 開 CF support ticket：bucket=chiyigo-audit-archive、retention lock rule=<ruleName>、`PUT same key after lock` returns success expected failure
- 等 CF 回覆才知道下一步

### Lock 設失敗（Step 1.2）
- 看 error message：
  - `permission denied` → wrangler token 沒 R2 admin 權限 → 用 `wrangler login` 重 auth
  - `bucket not found` → typo，確認 `chiyigo-audit-archive`
  - `prefix already locked` → 該 sacrificial prefix 之前用過（不該發生，因為含 ts+rand）→ 重生 prefix 跑

### Lifecycle 設失敗但 lock 已成
- Lock 已生效，control 物件 24hr 內無法刪
- Lifecycle 可以晚補：`npx wrangler r2 bucket lifecycle add ...`
- 不影響 Layer 1 驗證；只影響 auto-cleanup 窗口

### 打字錯把 retention 設成 7yr（unrecoverable）
- 7 年內 control object 無法被刪、prefix 無法重用
- 不會影響 prod cron（cron 不寫 sacrificial prefix）
- 不會影響 prod 資料（control object 只是 sacrificial 內容）
- 但 sacrificial prefix 永遠留在 bucket size + listing → 找 CF support 申請手動移除
- 預防：Step 1.2 的指令是寫死 `--retention-days 1`，不要手動改

---

## 完整流程結束後

1. Layer 1 PASS → 通報 Claude，update memory `project_audit_phase2.md` 記 preview gate PASS + fixture 路徑
2. Next PR = **prod lock 上線**（PR 0.2c 真正執行體；36 lock + 36 lifecycle，按 `docs/AUDIT_RETENTION_PLAN.md` PR 0.2c runbook v8.3 Step 0.2c）
3. Prod lock 上線後 24hr watch：監控 `audit.archive.r2_lock_detected` + `audit.aggregate_archive.*.r2_lock_detected` + `*.force_purge_blocked_by_lock` 任一非零 emit
4. 連續 14 天 no incident → next PR = 2.1c endgame discard / 4a live flip

---

## 自我檢查（user 跑這 runbook 前）

- [ ] 讀完「🔴 安全護欄」段，理解不可逆度
- [ ] 確認時間充足（30 分鐘 + 48hr 觀察）
- [ ] 確認 Pages prod 是當前 main HEAD（A4）
- [ ] 確認 wrangler OAuth auth OK（A1）
- [ ] 心態：每一步 verify 完才下一步，**不批次**

跑前如果 unsure 任何一步 → ping Claude 先 walkthrough。
