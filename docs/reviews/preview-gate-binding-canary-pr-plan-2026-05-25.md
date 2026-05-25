# Preview Gate (b) PR Plan — Worker R2 Binding Canary on Prod Bucket

**作者**：Claude（main HEAD `6945000`，2026-05-25，fresh session deep review）
**為何存在**：`docs/reviews/preview-gate-runbook-design-concern-2026-05-25.md` 經 codex review 後 verdict = **設計疑慮成立、選 (b) 並升格為 mandatory replacement**。本檔是 (b) PR 的完整 plan，給 codex 在 implementation 前先 review，避免實作中發現 gate semantics 還在變。
**範圍**：替換 wrangler-based Layer 1 為 worker R2 binding canary，指向 prod bucket。
**不可逆度**：執行階段（user 真跑 canary）會在 prod bucket `chiyigo-audit-archive` 設 24h sacrificial lock + control object。本 plan + 接續 PR code 都不會自動執行；明天 user 走完 walk-through 才動。
**請 codex review**：endpoint contract / fixture schema / PASS+FAIL judgment / cleanup / two-commit chain 是否凍結得夠緊；有沒有寫進新假設、漏掉 invariant、或 prod-touching surface 殘留風險。

---

## 0. 已完成 — Tiny safety patch（commit `6945000`）

- `docs/PREVIEW_GATE_RUNBOOK.md` 頂部加 🛑 DO NOT RUN banner + 標 `⛔ DEPRECATED`、註明 supersede 來源
- 修 line 346 `36 lock + 36 lifecycle` → `18 lock + 18 lifecycle = 36 rules total`（對齊 `docs/AUDIT_RETENTION_PLAN.md` line 906 SoT）
- 目的：fresh session 抓不到 review context 時阻擋誤跑

---

## 1. Codex verdict 接收要點

| 要求 | 落實位置 |
|---|---|
| 廢 wrangler-based Layer 1，改 binding canary 主路徑 | §4 endpoint contract + §10 新 runbook |
| Prefix 強制 `sacrificial/preview-gate-binding/<ts>-<rand>/` | §4 PREFIX_GUARD |
| Endpoint 只用 `env.AUDIT_ARCHIVE_BUCKET`，body 不接受 bucket name | §4 binding source-of-truth |
| Response 同時回 raw thrown shape + `isR2LockError(thrown)` verdict | §5 response shape |
| PASS 條件：overwrite/delete 都 throw **且** classifier 命中 | §7 PASS judgment |
| PASS/FAIL 都先寫 fixture | §6 fixture schema + §8 failure path |
| Two-commit chain：deploy → run → fixture → remove endpoint | §9 |
| S3 sigv4 (c) 只當 auxiliary | §11 non-goals |
| (a) 直接信 preview binding fixture 外推 — 不採 | §11 non-goals |

---

## 2. PR 編號 + branch strategy

- **PR 編號**：F-3 Phase 2 PR `0.2c-pre-3`（接續 `pre-2`，pre-1a/1b/1b.1/1b.2/1c/2 + pre-2 已過）
- **Branch**：直接走 main（與既有 PR cadence 一致；本 repo 沒 PR branch 慣例）
- **本 plan 自身**：在 main 上 commit + push 給 codex review；review 通過後再 fresh session 動 code

---

## 3. 在 1b.1 pattern 上的差異點（為什麼不能單純 copy）

1b.1 endpoint code 在 `git show 02af828:functions/api/admin/cron/r2-binding-canary.ts`。本 PR 對齊但**改 6 點**：

| 項目 | 1b.1 (preview) | 本 PR (prod) |
|---|---|---|
| binding | `env.AUDIT_ARCHIVE_BUCKET_PREVIEW`（optional） | `env.AUDIT_ARCHIVE_BUCKET`（已存在的 prod binding）|
| PREFIX_GUARD | `spike/binding-canary/` | `sacrificial/preview-gate-binding/`（與 wrangler runbook 不同 prefix，明確區別兩條 gate）|
| bucket 名 in response | hardcoded string `"chiyigo-audit-archive-preview"` | hardcoded string `"chiyigo-audit-archive"` |
| response 額外欄位 | 無 | **`classifier_verdict`**: `isR2LockError(thrown)` 的 boolean（thrown 才有；success 為 `null`） |
| wrangler.toml 改動 | 加 `AUDIT_ARCHIVE_BUCKET_PREVIEW` binding | **不改 wrangler.toml**（用已存在的 prod binding） |
| commit 2 cleanup 範圍 | endpoint + preview binding + types + tests | endpoint + tests（**不刪 prod binding**——本來就在用） |

---

## 4. Endpoint 完整 contract

### Path + method
`POST /api/admin/cron/r2-preview-gate-binding-canary`

**為什麼不重用 `r2-binding-canary.ts` 路徑**：1b.1 已 commit-2 移除；新檔名標示這是 prod 版（避免混淆 future grep / forensic 比對 fixture）。

### Auth
`Authorization: Bearer <CRON_SECRET>` — 同既有 audit-archive cron。

### Request body
```typescript
{
  op: 'setup_control' | 'put_overwrite' | 'put_new' | 'delete' | 'head',
  prefix: string,    // MUST start with PREFIX_GUARD
  key: string,       // MUST start with prefix
  body?: string,     // 對 setup_control / put_overwrite / put_new 才有意義
}
```

### 強制 invariant
- `PREFIX_GUARD = 'sacrificial/preview-gate-binding/'`（與 wrangler runbook 的 `sacrificial/preview-gate/` 不同字串）
- `prefix.startsWith(PREFIX_GUARD)` → 否則 `400 BAD_PREFIX`
- `key.startsWith(prefix)` → 否則 `400 BAD_KEY`
- `op` 限定 5 個 → 否則 `400 BAD_OP`
- **`body` 不接受 `bucket` 欄位**（codex 強調）— 任意 bucket 不可注入；binding 由 server-side 硬寫 `env.AUDIT_ARCHIVE_BUCKET`
- 不存在 query string / URL param 注入路徑

### Lint / discipline 互動
與 1b.1 同檔名模式：`scripts/_archive-lint-patterns.js` `FILE_PATTERN = /^audit-(aggregate-)?archive.*\.(js|ts)$/`。本檔名 `r2-preview-gate-binding-canary.ts` 不 match → 自動豁免 no-bare-put / no-delete archive discipline（gate 的 .delete 是測試本身）。

### Response shape
**所有 outcome 都回 HTTP 200**（為了 forensic capture）；auth / validation / binding-missing 才 4xx/5xx：

```typescript
{
  op: CanaryOp,
  prefix: string,
  key: string,
  bucket: 'chiyigo-audit-archive',   // hardcoded (not from body)
  outcome: 'success' | 'thrown',
  success_meta: { etag, httpEtag, size, version } | { deleted: true } | { etag, size } | null,
  thrown: ThrownShape | null,
  classifier_verdict: boolean | null,  // null when outcome === 'success'; boolean when 'thrown'
  classifier_paths_hit: string[] | null, // null when success; subset of ['fast_path_code', 'canonical_phrase', 'numeric_code', 'dual_condition'] when thrown — 跟 isR2LockError 三路對齊（debug 用）
  timing_ms: number,
}
```

`ThrownShape` 同 1b.1（`name / message / code / status / cause / stringified`）— fixture 比對相容。

**`classifier_paths_hit` 設計考量**：codex 強調「response 同時回 raw thrown shape + isR2LockError(thrown) verdict」。光是 boolean 不夠 forensic — 要知道是哪條 path 命中才能比對 S3 vs binding shape 差異。但 `isR2LockError` 目前只回 boolean，**需擴展 helper**（暴露 `classifyR2LockError(): { matched: boolean, paths: string[] }`，原 `isR2LockError` 內部呼叫之 + 對外保留 boolean signature 不破 caller）。

→ 額外 PR scope：`isR2LockError` 内部抽 helper 暴露 paths list；對外行為不變、既有 11 cases binding fixture wholesale regression 不破。

### File 觸點
- `functions/api/admin/cron/r2-preview-gate-binding-canary.ts`（新）
- `functions/utils/audit-archive.ts`（extend `classifyR2LockError` helper；`isR2LockError` 不變）
- `tests/r2-preview-gate-binding-canary.test.ts`（unit）
- `tests/integration/r2-preview-gate-binding-canary.test.ts`（int）
- `tests/audit-archive.test.ts`（`classifyR2LockError` 的 path-list 對齊 regression）
- **不改** `wrangler.toml`、**不改** `types/env.d.ts`、**不改** `vitest.workers.config.js`（prod binding 已存在）

---

## 5. Binding shape + classifier verdict 對齊

預期 prod bucket binding throw shape 與 1b.1 preview bucket fixture 一致（但這正是 gate 要驗證的；不要寫進 plan 當前提）：

| 欄位 | 預期值（基於 1b.1 fixture）| 若不同 → 訊號 |
|---|---|---|
| `name` | `"Error"`（generic） | 若不同：binding 平台行為跨 bucket 不一致，需 investigate |
| `message` | `"{op}: The object is locked by the bucket policy. (10069)"` | 若 wording 變了：canonical phrase 失敗、isR2LockError 漏判 — **reject prod lock**，補 classifier extend |
| `code` | `null` | 若有 code field：可能是 platform 行為改、可加進 fast-path |
| `status` | `null` | 若有 status：dual condition path 重新有效 |
| `cause` | `null` | 若有 cause：classifier nested check 命中 |

**classifier 接受度**：`isR2LockError(thrown) === true` 為 PASS 必要條件之一。若 `false` → PASS 失敗（即便 binding 真擋）— 因為 prod cron 的 putWithRetry / force_purge endpoint 都靠這個 classifier 判 lock，classifier 漏判 = 系統其他層失效。

---

## 6. Fixture schema（PASS + FAIL 都寫）

### Path
`docs/fixtures/preview-gate-binding-canary-<ts>.json`

**Why 不沿用 `r2-lock-binding-canary` 命名**：與 1b.1 preview fixture (`r2-lock-binding-canary-2026-05-24.json`) 明確區別 — 一個是 preview design proof、一個是 prod release gate。

### Schema（UTF-8 no BOM、`[ordered]@{}` key 順序穩定）

```json
{
  "gate": "preview-gate-binding-canary-prod",
  "date_utc": "YYYY-MM-DD",
  "ts": "yyyyMMdd-HHmmss",
  "pr": "0.2c-pre-3",
  "bucket": "chiyigo-audit-archive",
  "prefix": "sacrificial/preview-gate-binding/<ts>-<rand>/",
  "lock_rule_name": "preview-gate-binding-<ts>-<rand>",
  "lifecycle_rule_name": "preview-gate-binding-<ts>-<rand>-cleanup",
  "retention_days": 1,
  "lifecycle_expire_days": 2,
  "outcome": "PASS" | "FAIL_CRITICAL" | "FAIL_CLASSIFIER_MISS" | "FAIL_UNEXPECTED",
  "verdict_reason": "string — 人類可讀；對應下方 PASS/FAIL judgment",
  "wrangler_version": "4.87.0",
  "cf_account_id": "<masked first 8>...",
  "cf_account_email": "<masked>",

  "ops": [
    {
      "step": 1,
      "label": "setup_control",
      "expected_outcome": "success",
      "actual_outcome": "success" | "thrown",
      "response_body": { /* full endpoint response */ }
    },
    /* step 2 put_overwrite, 3 put_new, 4 delete, 5 head — 同 1b.1 順序 */
  ],

  "control_object": {
    "key": "<full key>",
    "expected_body_sha256": "<sha256 hex>",
    "head_after_delete": { /* op 5 response */ }
  },

  "summary": {
    "overwrite_blocked": boolean,        // op 2 outcome === 'thrown'
    "overwrite_classifier_hit": boolean, // op 2 classifier_verdict === true
    "overwrite_paths_hit": string[],     // op 2 classifier_paths_hit
    "delete_blocked": boolean,           // op 4 outcome === 'thrown'
    "delete_classifier_hit": boolean,    // op 4 classifier_verdict === true
    "delete_paths_hit": string[],        // op 4 classifier_paths_hit
    "new_key_allowed": boolean,          // op 3 outcome === 'success'
    "control_object_intact": boolean,    // op 5 size matches control_body_sha256 expected
    "binding_throw_shape_matches_1b1": boolean,  // diff against r2-lock-binding-canary-2026-05-24.json
    "binding_throw_shape_diff": object | null    // if !matches: diff summary
  },

  "next_steps_if_pass": ["proceed to PR 0.2c full prod lock — 18+18=36 rules"],
  "next_steps_if_fail": ["see PREVIEW_GATE_RUNBOOK_BINDING.md §failure-handling"],

  "notes": "string — anything notable from this run"
}
```

### FAIL 必含的額外欄位
- `lock_rule_name` / `lifecycle_rule_name` / `prefix` / `control_key`：給未來 cleanup 用
- `cleanup_status`: `"pending"` | `"manual_required"` | `"auto_via_lifecycle"`
- `cleanup_deadline_utc`: `ts + 48hr`（lifecycle 自動清的預期時間；超過要手動 verify）

---

## 7. PASS/FAIL judgment（嚴格）

### PASS（全 4 條 AND）
1. `overwrite_blocked === true` （op 2 thrown）
2. `overwrite_classifier_hit === true` （isR2LockError 命中）
3. `delete_blocked === true` （op 4 thrown）
4. `delete_classifier_hit === true` （isR2LockError 命中）

附加（**non-blocking 但記錄**）：
- `new_key_allowed === true`（op 3 success；若 false 表示 lock 連 new key 也擋，超出設計預期，但不 block PASS — 反向更安全）
- `control_object_intact === true`（op 5 head 仍回 success 且 etag 對齊 setup）
- `binding_throw_shape_matches_1b1 === true`（与 1b.1 preview fixture 對齊）

### FAIL 分類

| outcome 字串 | 觸發條件 | 處理 |
|---|---|---|
| `FAIL_CRITICAL` | op 2 OR op 4 `outcome === 'success'`（binding 真的沒擋）| **prod lock 上線 BLOCKED**；開 CF support ticket 問 prod bucket binding 與 preview bucket 是否平台行為不同；保留 sacrificial prefix 24h 作 forensic |
| `FAIL_CLASSIFIER_MISS` | op 2 / op 4 thrown 但 classifier_verdict === false（binding 擋了但 classifier 漏判） | **prod lock 上線 BLOCKED**；classifier extend PR + 補 fixture wholesale regression；保留 fixture forensic |
| `FAIL_UNEXPECTED` | endpoint 回 4xx/5xx (auth / validation / binding missing) / op 1 setup_control thrown | **prod lock 上線 BLOCKED**；停下 debug；保留 fixture |

---

## 8. Failure path — cleanup + metadata preservation

**Codex 點明的 gap**：current runbook 只在 PASS 後寫 fixture；FAIL 時最需要保留 sacrificial prefix / rule / controlKey metadata。本 PR 修正方式：

### Runbook 強制順序
1. 設 lifecycle add（先設無 retention enforce，安全）
2. 設 lock add（不可逆 24h）
3. **立刻** 寫初始 fixture entry（`outcome: "in_progress"`、含 prefix / lock_rule_name / lifecycle_rule_name）— 在跑任何 op 前
4. 跑 5 個 op，每跑完一條更新對應 entry
5. 5 個 op 結束後 finalize fixture（寫 summary / outcome / verdict_reason）
6. 不論 PASS / FAIL 都 `git add` + commit + push

### 為什麼 step 3 必須立刻寫
若 step 4 在跑 op 時 PowerShell session 掛掉 / network error / 中斷，sacrificial prefix 已設但 metadata 全在 terminal scrollback。Step 3 立刻寫 fixture（含 prefix + rule names）後就算 session 完全沒了，metadata 也在 disk + git working tree（即便沒 commit）。

### S3 後 48hr 自動 cleanup
1b spike S3 段已驗 lifecycle `--expire-days 2` 真的會清 sacrificial object。但 **lock rule + lifecycle rule entry 不會自動消** — 仍要手動移除：
```powershell
npx wrangler r2 bucket lock remove chiyigo-audit-archive $lock_rule_name
npx wrangler r2 bucket lifecycle remove chiyigo-audit-archive $lifecycle_rule_name
```

新 runbook S3 段加 **fixture path Read-Host fallback**（與 current runbook codex r4/r5 補完同 pattern）：
- 同 session 連續跑：vars 仍在
- 跨 session：從 fixture path 讀回 prefix / rule names / control_key

---

## 9. Two-commit chain

### Commit 1 — Deploy endpoint
**Subject**: `feat(audit-archive): PR 0.2c-pre-3 commit 1 — Worker R2 binding canary on prod bucket (TEMPORARY)`

**Files**:
- 新 `functions/api/admin/cron/r2-preview-gate-binding-canary.ts`
- 改 `functions/utils/audit-archive.ts`（extend `classifyR2LockError` helper）
- 新 `tests/r2-preview-gate-binding-canary.test.ts`（unit, 預估 19+ cases 同 1b.1）
- 新 `tests/integration/r2-preview-gate-binding-canary.test.ts`（int, 預估 4+ cases）
- 改 `tests/audit-archive.test.ts`（`classifyR2LockError` path-list regression — 預估 +5 cases）

**Baseline 要求**：
- typecheck 0 error 不退步
- npm test 增 +24 ish（新 unit + classifier regression）
- npm test:int 增 +4 ish
- build / lint:handlers / lint:archive-no-delete 不破
- ratchet:report 不退步

**Cache-bust**：commit 1 不動 frontend → 不必同步 ?v= bump（但 build pipeline 仍會跑；driver 上一篇是「backend commit 也必跟 cache-bust」memory 提醒）

### 中間：User 跑 canary
1. Pages deploy 完成 + 同步 deploy commit hash 對齊
2. user 跑 walk-through（fresh session 接手）
3. user 設 `wrangler r2 bucket lifecycle add` + `lock add`（沿用 wrangler，因為 setup 不在 lock semantics gate scope）
4. user `Invoke-RestMethod` 5 ops，每 op 立刻寫 fixture entry
5. fixture finalize + commit + push（這個 commit 是 plan 第三個，**不在 two-commit chain 內**，是 between-commits 的 forensic artifact）

### Commit 2 — Remove endpoint
**Subject**: `feat(audit-archive): PR 0.2c-pre-3 commit 2 — preview gate binding canary <PASS|FAIL> + endpoint removed`

**Files**:
- 刪 `functions/api/admin/cron/r2-preview-gate-binding-canary.ts`
- 刪 `tests/r2-preview-gate-binding-canary.test.ts`
- 刪 `tests/integration/r2-preview-gate-binding-canary.test.ts`
- 改 `docs/AUDIT_ARCHIVE_LOCK_BEHAVIOR.md`（紀錄 PR 0.2c-pre-3 outcome）
- 改 `docs/AUDIT_RETENTION_PLAN.md`（gate checklist tick / cross-tick）
- **保留**：`functions/utils/audit-archive.ts` 的 `classifyR2LockError` helper（給未來 forensic / debug 用，不算 prod-touching surface）

**Baseline 要求**：
- 同 commit 1 baseline
- test count 回到 commit 1 之前 + classifier regression（5 ish 增量留）

**重要**：commit 2 把臨時 prod-touching endpoint 從 prod 移除，避免遺留 surface（與 1b.1 commit 2 一致）。

---

## 10. 新 PREVIEW_GATE_RUNBOOK_BINDING.md 結構

**Path**: `docs/PREVIEW_GATE_RUNBOOK_BINDING.md`（新檔，不蓋舊 `PREVIEW_GATE_RUNBOOK.md` — 舊文留作 design history + DO NOT RUN reference）

**Sections**:

1. **🔴 安全護欄**（不可逆度 + prefix 強制 + retention 上限 + 不做的事 — 對齊舊 runbook §安全護欄）
2. **預備檢查** A1–A4（OAuth identity + CRON_SECRET 取得 + main HEAD 對齊 + Pages prod deploy 對齊）
3. **執行步驟（Layer 0 — 對齊 binding canary outcome 不是 wrangler lock semantics）**
   - Step 0.1 生 prefix + lock_rule_name + lifecycle_rule_name
   - Step 0.2 lifecycle add → lock add（用 wrangler；這部分 wrangler owner privilege 不影響）
   - Step 0.3 **立刻寫初始 fixture entry**（含 prefix / rule names / control_key tentative）
   - Step 0.4 lock propagation wait 10s（[[feedback_r2_lock_propagation_canary]]）
   - Step 0.5 `Invoke-RestMethod` op 1 setup_control（POST endpoint）→ 寫 fixture
   - Step 0.6 op 2 put_overwrite → 寫 fixture（驗 thrown + classifier_verdict）
   - Step 0.7 op 3 put_new → 寫 fixture（write-once design proof）
   - Step 0.8 op 4 delete → 寫 fixture（驗 thrown + classifier_verdict）
   - Step 0.9 op 5 head → 寫 fixture（驗 control intact）
   - Step 0.10 finalize fixture summary + outcome verdict
4. **PASS/FAIL judgment**（§7 完整搬入）
5. **成功收尾**（S1 fixture commit + push、S2 update GATE checklist `docs/AUDIT_ARCHIVE_LOCK_BEHAVIOR.md`、S3 48hr 後驗 lifecycle 自動清 + manual rule remove — 跨 session 從 fixture path recover）
6. **失敗處理**（§7 三種 FAIL 分類各自的處置）
7. **與 wrangler lock semantics 的關係**（明確說明：lock add 用 wrangler 但 gate 驗證**不**靠 wrangler put/delete；wrangler 仍是 lock infra 設定唯一管道）
8. **不可逆度提醒**（24h 內 control object 無法手動清；lock rule 過期但 entry 殘留要手動移）
9. **自我檢查 checklist**（user 跑前逐項勾選）

---

## 11. Non-goals（明確排除）

- (a) 「直接信 preview binding fixture 外推 prod bucket」— 跳過一層 prod bucket-specific 驗證；codex 不建議
- (c) S3 sigv4 + limited token 路徑 — auxiliary 可用，但 **本 PR 不實作**；若未來 binding 路徑出問題 + S3 也想驗，獨立 PR 處理
- prod cron behavior change：本 PR **完全不動** archive worker / aggregate worker / force_purge endpoint 邏輯
- prod bucket 36 lock + 36 lifecycle 上線：本 PR PASS 後，才 plan 下一個 PR 0.2c 真上線
- wrangler OAuth scope rotate / token 更換：與 gate semantics 無關

---

## 12. Memory updates needed

### Update after commit 1（implementation 期間）
- `project_audit_phase2.md`：current state「明天 user 跑 prod lock pre-flight Layer 1」改為「PR 0.2c-pre-3 commit 1 in progress（binding canary on prod bucket）」
- 新增 [[reference_r2_lock_gate_design_evolution]]：紀錄 wrangler-based → binding-based 設計演進 + 為何 0.2a/wrangler 路徑被拒；給未來類似 gate 設計參考

### Update after commit 2（PASS path）
- `project_audit_phase2.md`：「preview gate PASS + fixture 路徑」+ 「下一步 PR 0.2c 36 rules 上線」
- `docs/AUDIT_ARCHIVE_LOCK_BEHAVIOR.md` checklist 加新 tick

### Update after commit 2（FAIL path）
- `project_audit_phase2.md`：「preview gate FAIL — outcome `<FAIL_*>`」+ 「prod lock 上線 BLOCKED until <next action>」
- 不刪舊 memory entries（仍是 active state）

---

## 13. 風險表

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| Endpoint deploy 後 prod 殘留 surface | 低 | High（attack surface） | Two-commit chain；commit 2 必跟 + auth bearer + prefix lock + 不接受 bucket name 注入 |
| User 設 lock 時 typo `--retention-days` | 低 | High（7yr 卡 prod bucket） | Runbook 指令硬編；自我檢查清單明列「不要手改數字」 |
| 跑 op 時 PowerShell session 中斷 | 中 | Medium（metadata 散落） | Step 0.3 立刻寫初始 fixture entry；S3 段跨 session recovery 已 codex r4/r5 補完 |
| classifier_paths_hit helper extension 破 isR2LockError existing 11 binding fixture cases | 低 | High（baseline 退步） | 內部 helper 抽出後對外 boolean signature 不變；wholesale fixture regression 仍跑 |
| Endpoint URL 撞既有 cron alphabet collision | 低 | Medium | grep `r2-preview-gate-binding-canary` 確認新名；既有 cron 命名 audit-archive-* 為主 |
| Lock propagation 超過 10s | 中 | Low | Sleep 10s 後若 op 1 setup 失敗 reason=lock blocking，poll 多 10s 重試一次 |
| Prod bucket binding 與 preview bucket binding 平台行為不一致 | 低 | High（gate 真正要驗的事） | 這是 gate 存在的意義；FAIL_CRITICAL 流程處理 |

---

## 14. Open questions for codex

1. **PASS 判定是否漏了某條**：4 條 AND 是否夠？應該加 `binding_throw_shape_matches_1b1`（與 1b.1 preview fixture 形狀對齊）作硬性 PASS 條件？或保持為「non-blocking 但記錄」？
2. **新檔名是否 OK**：`r2-preview-gate-binding-canary.ts` 與 1b.1 `r2-binding-canary.ts`（已刪）名稱長近一倍，但意圖明確；codex 偏好較短名（e.g. `prod-gate-canary.ts`）還是現用？
3. **classifyR2LockError helper 抽法**：暴露 `paths: string[]` 給 endpoint 是否破 existing 11 cases wholesale regression？或要為新 helper 加額外 fixture entry？
4. **Commit 2 是否該保留 `classifyR2LockError` helper**：我 plan 保留作 forensic helper；codex 是否認為應該移除避免「extracted-for-canary-but-never-used」未來疑問？
5. **新 runbook 取名 `PREVIEW_GATE_RUNBOOK_BINDING.md`**：是否該直接覆寫舊 `PREVIEW_GATE_RUNBOOK.md`（保留 git history 即可）而非開新檔？
6. **Step 0.3 fixture early-write**：是否要寫 partial JSON 進 disk（git working tree 但未 commit），還是寫進獨立 `.tmp.json` 然後 finalize 時 rename？前者 simpler、後者 atomic（但 user 通常不會 mid-run crash）
7. **wrangler.toml 不動 / types/env.d.ts 不動的假設**：`env.AUDIT_ARCHIVE_BUCKET` binding 在 wrangler.toml 已配；本 PR 沒 binding 變動；type definition 也已存在。請 codex 確認無漏掉 contract 動作。

---

## 15. Tomorrow 動工順序

1. Fresh session 開始 → 讀 `MEMORY.md` + 本 plan + commit 1 task 細節
2. 寫 `r2-preview-gate-binding-canary.ts`（copy 1b.1 + §3 6 點 diff）
3. 寫 `classifyR2LockError` helper extension + 暴露 paths
4. 寫 unit tests（19+ cases）+ int tests（4+ cases）+ classifier regression（5+ cases）
5. typecheck / npm test / npm test:int / build / lint:handlers / lint:archive-no-delete / ratchet:report 全綠
6. Commit 1 + push
7. 等 codex review commit 1
8. Codex Approve 後 deploy + 對齊 Pages prod commit hash
9. User 走 walk-through 跑 canary（fresh session 接手 — Claude 帶 user 過 §10 runbook）
10. Fixture finalize + commit
11. Codex review fixture（PASS/FAIL outcome 判定）
12. Commit 2（PASS / FAIL 都做）
13. 等 codex review commit 2
14. Memory update + 結案

---

**請 codex 給 verdict**：本 plan 是否凍結得夠緊？§14 七個 open question 給答案？有沒有漏掉 invariant / 漏掉 prod-touching surface 風險 / 漏掉 cleanup 步驟？
