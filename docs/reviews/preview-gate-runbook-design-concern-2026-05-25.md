# Preview Gate Runbook — wrangler OAuth owner bypass 設計疑慮

**作者**：Claude（main HEAD `40162c4`，2026-05-25，fresh session deep review）
**目的**：請 codex review — Preview Gate Runbook（`docs/PREVIEW_GATE_RUNBOOK.md`）Layer 1 用 wrangler CLI 跑 PUT-overwrite / DELETE 測試，疑似會被 wrangler OAuth 的 owner privilege bypass，產生 false-positive Layer 1 FAIL CRITICAL 訊號。
**請決定**：runbook 是否要重設計？或是論述上能不能成立？
**不可逆度**：runbook 本身執行會在 prod bucket `chiyigo-audit-archive` 設 24h sacrificial lock（誤跑後不可手動 unlock，要等 24h 過期，sacrificial prefix rule entry 也會殘留 ~48h 後手動清）。

---

## 1. 待 review 的 runbook（current `docs/PREVIEW_GATE_RUNBOOK.md`）

關鍵段落（line 96–98）：

> ## Layer 1（必做）：Lock infra on prod bucket
>
> **目的**：驗證 CF R2 retention lock 平台行為在 prod bucket `chiyigo-audit-archive` 跟 1b spike 在 preview bucket 觀察到的行為一致（PUT-overwrite blocked / DELETE blocked / new key in locked prefix allowed）。
>
> **執行身分**：wrangler CLI（OAuth token，account-level，**與 prod cron 走的 worker binding 同位階**）

Layer 1 六步全用 `npx wrangler r2 object put/delete/get` 對 sacrificial prefix 操作，期待 Step 1.4（overwrite）+ Step 1.5（DELETE）throw 含 `ObjectLockedByBucketPolicy` / `10069` 等 marker 的 error。任一 step success（沒 throw）= runbook line 176–180 判 `Layer 1 FAIL CRITICAL`，要求 user 開 CF support ticket 並阻擋 prod lock 上線。

---

## 2. 衝突證據鏈

### 證據 A：`docs/AUDIT_RETENTION_PLAN.md` v11（line 14–22）

R2 平台限制盤點表：

| 預期能力 | 平台實況 | 證據 |
|---|---|---|
| **Bucket Lock 擋 owner DELETE** | **❌ owner always bypass** | smoke：lock add 後 wrangler delete 立即成功 |

這條來自 PR 0.2a smoke（2026-05-10 前後），用的就是 wrangler OAuth + Account ID 同一條認證。

### 證據 B：`docs/fixtures/r2-lock-spike-2026-05-23.json` (line 20)

PR 0.2c-pre-1b 親驗：

```json
"note": "Contradicts PR 0.2a smoke result (lock did not appear to enforce). 0.2a used
         wrangler r2 (account-level / owner) which may have bypassed; this spike uses
         limited Object Read & Write token via S3 sigv4 → lock IS enforced."
```

→ 用 S3 sigv4 + limited token（不是 wrangler）才看到 lock enforce；wrangler 那條被歸因為「owner bypass」。

### 證據 C：`docs/AUDIT_ARCHIVE_LOCK_BEHAVIOR.md` (line 12 + 102)

Line 12 explicit 推翻 0.2a 結論：

> ❌ PR 0.2a smoke 暫定結論「lock 不 enforce」**已被推翻** — 那次很可能是 wrangler r2 owner-level / bypass 路徑造成（非本文 limited-token spike 路徑）

Line 102（1b.1 binding canary 後 codex r1 P1 點明的 risk）：

> **不只是 shape 未知 — enforcement 本身可能不一樣**：PR 0.2a smoke 結論「lock 不 enforce」被本 spike 推翻的原因正是「owner/wrangler bypass」假設。Worker binding 是 account-level token，**與 wrangler 同位階**。若 binding 也 bypass，prod cron same-key overwrite / DELETE 在 lock 下其實都 200/204 通過 ...

注意：line 102 把「binding 是 account-level、與 wrangler 同位階」當作待驗的 **風險假設**；後續 PR 0.2c-pre-1b.1 binding canary fixture 證明 binding 在 preview bucket 真的擋（即便 account-level）。也就是說 binding ≠ wrangler 在 lock enforcement 上的行為 — binding 擋、wrangler 過。

### 證據 D：`docs/fixtures/r2-lock-binding-canary-2026-05-24.json`

1b.1 binding canary（preview bucket）`ops[1] put_overwrite`：

```json
"outcome": "thrown",
"thrown": {
  "name": "Error",
  "message": "put: The object is locked by the bucket policy. (10069)",
  ...
}
```

→ Worker binding 真擋。但本 fixture 用的是 `env.AUDIT_ARCHIVE_BUCKET_PREVIEW.put(...)`，不是 wrangler CLI。

---

## 3. Runbook 隱含前提 vs 既有 doc

Runbook line 98 寫「wrangler CLI ≡ worker binding 同位階」當前提，但：

- **證據 A** 用 wrangler，lock 沒 enforce（0.2a smoke）
- **證據 B + C** 把 0.2a 的「沒 enforce」歸因於 wrangler owner bypass
- **證據 D** 用 binding（不是 wrangler），lock 真擋

→ 三份既有 doc 一致指向「wrangler ≠ binding」for lock enforcement，與 runbook 前提衝突。

---

## 4. 預測 Layer 1 真實 outcome（若 runbook 照跑）

| Step | Runbook 預期 | 基於 0.2a + 1b fixture 預測 |
|---|---|---|
| 1.2 lock add | success | success（與 0.2a 一致） |
| 1.3 control PUT new key | success | success（new key 進 locked prefix 一律 200，1b 親驗） |
| 1.4 wrangler PUT overwrite | **fail (blocked)** | **success（wrangler owner bypass，與 0.2a 一致）** → runbook 判 `FAIL CRITICAL` ❌ |
| 1.5 wrangler DELETE | **fail (blocked)** | **success（wrangler owner bypass，與 0.2a 一致）** → runbook 判 `FAIL CRITICAL` ❌ |
| 1.6 GET control | body match | possibly body mismatch（1.4 過了就被改了）→ runbook throw `body mismatch` |

→ 高機率產生 false-positive FAIL CRITICAL 訊號，user 會被嚇到開 CF support ticket。

實際 prod cron 走 worker binding，binding 的 lock 行為已由 PR 0.2c-pre-1b.1 親驗（preview bucket binding canary fixture, 證據 D）→ prod lock 上線決策不該被 wrangler test 結果阻擋。

---

## 5. 環境快照（2026-05-25 deep review 當下）

- main HEAD: `40162c4`（working tree clean）
- wrangler version: `4.87.0`（CLI 提示 update available `4.94.0`）
- CF account: `a30100a0072@gmail.com` / Account ID `2d2c4b4ddbddec1a5d045533c01d715f`
- OAuth scopes：含 `pages (write)` / `d1 (write)` / `workers* (write)` 等，**不含明列 `r2` scope** — 但 `wrangler r2 bucket list` + `bucket lock list` + `bucket lifecycle list` 都通，R2 access 走 account-level OAuth implicit grant
- prod bucket `chiyigo-audit-archive`：0 lock rule、1 lifecycle（系統預設 Multipart Abort），無命名衝突
- archive worker prefix 全限定（`audit-log/`、`audit-log-dryrun/`、`manifest/`、`manifest-dryrun/`、`audit-log-aggregate-{telemetry|debug}[-dryrun]/`）— sacrificial prefix 不會被 cron 觸到
- `event_type NOT LIKE 'audit.archive.%'` filter 也擋 self-recursion 噬配額

---

## 6. 提給 codex 的 review 問題

1. **設計疑慮是否成立**：runbook 用 wrangler CLI 跑 Layer 1 的 PUT-overwrite / DELETE 測試，鑑於三份既有 doc 一致指向 wrangler owner bypass，是否會產生 false-positive `FAIL CRITICAL` 訊號？
2. **若成立**，下一步建議：
   - **(a) 廢除 Layer 1，直接信任 1b.1 binding canary fixture**：binding 真擋 + classifier 已對齊（1b.2）+ codex 5 輪 Approve → 接受 preview bucket binding canary 外推 prod bucket，直接進 PR 0.2c 36 lock + 36 lifecycle 上線（風險：跳過一層 prod bucket-specific 驗證）
   - **(b) 重新部署 1b.1 binding canary endpoint pattern 但指向 prod bucket**：Layer 2 既有設計，1–2 小時 + Pages deploy two-commit chain，技術上唯一能取代 Layer 1 給真信號的方法
   - **(c) Layer 1 改用 S3 sigv4 + limited token**：對齊 1b spike 取得的 enforce 路徑（不是 binding，但至少不是 wrangler owner）；需用 `audit-archive-writer` token 重跑 `scripts/spike-r2-lock.mjs` 但 bucket 改 prod；風險仍是「S3 sigv4 ≠ worker binding，只能反推不是直接驗 binding」
   - **(d) 其他方案**：codex 是否看到我漏掉的途徑？
3. **若不成立**（runbook 沒問題），請說明為何 wrangler OAuth 在 2026-05 當下不再 owner bypass，或 0.2a 結論被推翻的方式不適用此 runbook。

---

## 7. Claude 自己的傾向

- **不建議 (a)**：跳過 prod bucket-specific 驗證的代價是「prod bucket 跟 preview bucket 在 lock 平台行為上萬一不同」的盲點打開，與 [[project_audit_phase2]] 累計 6 個 PR + 5 輪 codex Approve 的謹慎度不符
- **建議 (b)**：與既有 1b.1 pattern 一致、binding canary 是 prod cron 真實會用的 code path、Layer 2 早就在 runbook 預留作為 fallback 設計
- **(c) 是 (b) 的較輕量版本**：但價值較低，因為 prod cron 不會走 S3 sigv4，驗 S3 等於驗了第三條跟 prod 無關的路徑

不可逆度提醒：(b) 若決定執行，第一個動作（lock 設下 prod bucket sacrificial prefix）仍是 24h 不可逆，仍要 walk-through 安全護欄段落（runbook line 11–35）— 但這次手段對齊 prod cron，verdict 才有意義。

---

**請 codex 給 verdict**：上面的設計疑慮成立嗎？選 (a) / (b) / (c) / (d)？或論述某段不準。
