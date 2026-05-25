# Preview Gate (b) PR Plan — Worker R2 Binding Canary on Prod Bucket

**狀態**：**r4 — APPROVED by codex r4 (2026-05-26)**；applies codex r1 7 + r2 5 + r3 3 fixes（rounds 1→4 全收）
**作者**：Claude（plan first written at main HEAD `1bcf73b`，r4 fix landed at `41525a1`，2026-05-25 → 2026-05-26）
**為何存在**：`docs/reviews/preview-gate-runbook-design-concern-2026-05-25.md` 經 codex review 後 verdict = **設計疑慮成立、選 (b) 並升格為 mandatory replacement**。本檔是 (b) PR 的完整 plan，給 codex 在 implementation 前先 review，避免實作中發現 gate semantics 還在變。
**範圍**：替換 wrangler-based Layer 1 為 worker R2 binding canary，指向 prod bucket。
**不可逆度**：執行階段（user 真跑 canary）會在 prod bucket `chiyigo-audit-archive` 設 24h sacrificial lock + control object。本 plan + 接續 PR code 都不會自動執行；明天 user 走完 walk-through 才動。
**請 codex review**：endpoint contract / fixture schema / PASS+FAIL judgment / cleanup / two-commit chain 是否凍結得夠緊；有沒有寫進新假設、漏掉 invariant、或 prod-touching surface 殘留風險。

---

## Changelog: r1 → r2（2026-05-25 晚間）

Codex r1 verdict = **Reject plan as written; approve direction after below 7 fixes**。全 7 fix 已套用：

| # | r1 finding | 落實位置 |
|---|---|---|
| 1 | §7 PASS: `new_key_allowed` + `control_object_intact` 應 hard 不是 non-blocking | §7 升 7 條 HARD AND；fixture summary（§6）增 `setup_control_success` / `put_new_success` / `get_control_body_match` boolean；新增 FAIL_WRITE_BLOCKED + FAIL_STATE_BREACH 兩 FAIL 分類 |
| 2 | Fixture 寫 `expected_body_sha256` 但 ops 只有 head 無法驗 — 缺 `get_control` op | §4 op enum 加第 6 個 `get_control`；response shape 含 `body_sha256 + size`（**NEVER raw body**）；§6 fixture 加 op 6；§10 runbook step 0.10 加 |
| 3 | Cleanup commands 少 `--id` flag | §8 cleanup 兩條指令補 `--id` |
| 4 | Prefix guard 只 `startsWith` 太寬 → 升完整 regex | §4 升 `PREFIX_REGEX = /^sacrificial\/preview-gate-binding\/\d{8}-\d{6}-[0-9a-f]{6}\/$/`；§10 step 0.1 同步 |
| 4b | Op-specific body validation 漏 | §4 加 PUT_BODY_REQUIRED / NON_PUT_REJECT_BODY；body 出現 `bucket` 欄位升 fail-closed 400 BUCKET_FIELD_FORBIDDEN |
| 5 | Two-commit chain 缺「commit 2 deploy removal verified」 | §9 加完整 Step A + B（等 Pages deployment hash 對齊 commit 2 + curl endpoint 預期 404/405）|
| 6 | §11 non-goals 殘留「36 lock + 36 lifecycle」mismatch | §11 改 **18 lock + 18 lifecycle = 36 rules total**；§12 memory update 同步 |

**§14 codex 7 answers 已內嵌進 plan**（取代原 open questions）：
- PASS hard conditions 加 setup_control + put_new + get_control body match
- 檔名保留 `r2-preview-gate-binding-canary.ts`
- classifyR2LockError 加 **parity tests**（既有 isR2LockError 全 case 對齊）— §14c 新章
- Commit 2 保留 helper，註解升「diagnostic classifier」非 canary-專用
- 新檔名 `PREVIEW_GATE_RUNBOOK_BINDING.md`，舊文保留 DO NOT RUN
- Fixture 走 atomic write `.tmp` → 正式 path（§10 step 0.3-0.11 多次 move）
- wrangler.toml / types/env.d.ts 不動 OK

**請 codex r2 驗**：7 fix 是否每條都正確收進 plan；§14b/14c 新章 + §15 動工順序對齊 r2 spec 是否漏 invariant。

---

## Changelog: r2 → r3（2026-05-25 深夜）

Codex r2 verdict = **Reject as written, approve after small r3 patch**。5 個 doc-consistency fix 已套用：

| # | r2 finding | 落實位置 |
|---|---|---|
| 1 | §10 step 0.3-0.11「全程 .tmp、最後才 move」與 §14 answer「每次 atomic replace final fixture」自我矛盾 | §10 改寫：**每步**寫 sibling `<fixture>.tmp` → `[System.IO.File]::Move(tmp, final, overwrite=true)` atomic-replace 正式 path；正式 fixture 永遠是 disk truth、中間狀態 `outcome: "in_progress"`；§8「Runbook 強制順序」段同步重寫 + 增「為什麼每步都 atomic replace」說明 |
| 2 | Fixture schema outcome enum 沒包含 in_progress + 沒加新 FAIL_WRITE_BLOCKED / FAIL_STATE_BREACH | §6 outcome enum 升 `"in_progress" \| "PASS" \| "FAIL_CRITICAL" \| "FAIL_CLASSIFIER_MISS" \| "FAIL_WRITE_BLOCKED" \| "FAIL_STATE_BREACH" \| "FAIL_UNEXPECTED"`（與 §7 verdict matrix 同步）|
| 3 | §8 Runbook 強制順序仍寫「5 個 op」但 r2 已是 6 ops | §8 step 4 改 6 個 op；step 5 同步；§10 step 0.10 已是 op 6（不變） |
| 4 | §4 bucket field validation 寫「truthy 值」才 reject，應 reject property presence | §4 改 `Object.hasOwn(body, 'bucket')` 判斷，命中即 400，**不管值** |
| 5 | §13 risk table propagation mitigation 把 op 1 失敗 retry 成普通延遲、與 FAIL_WRITE_BLOCKED 語意衝突 | §13 改寫：op 1 thrown = FAIL_WRITE_BLOCKED 真實 bug、不 retry；若要 propagation probe 獨立加 step 0.4b（**不啟用，但留 plan 給未來**），與 op 1 流程分離 |

**請 codex r3 驗**：5 doc-consistency fix 是否正確收進 plan；plan 整體無自我矛盾、無新假設、無漏掉 invariant。

---

## Changelog: r3 → r4（2026-05-26 凌晨）

Codex r3 verdict = **Reject as written; approve after one r4 tiny patch**。3 fix 已套用：

| # | r3 finding | 落實位置 |
|---|---|---|
| 1 | **Critical**: §10 atomic sample 用 `[System.IO.File]::Move($tmp, $final, $true)` — 此 3-arg overload 不存在於本機 PS 5.1.19041.6328 / .NET Framework 4.0.30319.42000（codex 親驗），runbook 照跑會在 lock 已設、寫 fixture 時 throw `Method not found` → 命中「不可逆 state 已產生但正式 fixture 沒落地」最怕場景 | §10 PowerShell 樣板重寫；**Claude r4 親跑驗證額外發現** `File.Replace($tmp, $final, $null, $true)` 在 PS 5.1 也炸（`$null` / `[System.String]$null` 第三 arg 都被解釋成 illegal path string，throw `ArgumentException: The path is not of a legal form.`）→ 最終 landing 用 `Move-Item -LiteralPath $tmpAbs -Destination $finalAbs -Force`（PS-idiomatic + NTFS atomic via Windows MoveFileEx + MOVEFILE_REPLACE_EXISTING + 不污染 backup file）；fsync 升真正 `FileStream.Flush($true)` flushToDisk=true（不是 buffer-only flush） |
| 2 | Minor: line 164 `control_object_body_matches` 與 schema/PASS 用的 `get_control_body_match` 命名不一致 | §4 line 164 改 `get_control_body_match`，全 plan 命名統一 |
| 3 | Minor: §15 動工順序仍寫「讀 r2 版本」應改 r3 | §15 改「**r4 版本，含 codex r1 7 + r2 5 + r3 3 全部 fix**」 |

**§14 answer 對應**：
- 第 6 個 answer 已在 r2 升 atomic write；r4 補完「atomic write 在本機 PS 5.1 真實可行」最後一哩 — Claude 親跑 3 步連續 atomic-replace 驗證綠（正式 fixture 對齊最後一步、無 tmp 殘留），API 可用性真 PASS。

**親驗紀錄（Claude r4，PS 5.1.19041.6328 / .NET Fx 4.0.30319.42000）**：
- `File.Move(string, string, bool)` 三-arg overload **不存在**（與 codex r3 一致）
- `File.Replace(string, string, string, bool)` 四-arg overload **存在** but 第三 arg `$null` runtime 炸 `ArgumentException`
- `File.Move(string, string)` 兩-arg overload 存在 + work
- `FileStream.Flush(bool)` overload **存在** + flush=true 真 fsync
- `Move-Item -LiteralPath ... -Destination ... -Force` **work** + 3 步連跑 + 無殘留

**請 codex r4 驗**：3 fix 是否套到位；`Move-Item -Force` 在 NTFS 上的 atomicity 是否符合 plan 宣告（同 volume rename atomic via MoveFileEx）；plan 整體無自我矛盾、無未驗證 API。

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
  op: 'setup_control' | 'put_overwrite' | 'put_new' | 'delete' | 'head' | 'get_control',
  prefix: string,    // MUST match PREFIX_REGEX
  key: string,       // MUST start with prefix
  body?: string,     // 對 put-class ops（setup_control / put_overwrite / put_new）必填 non-empty；其他 op reject
}
```

### 強制 invariant（fail-closed）
- **Prefix regex**（升 r2，codex finding 2 — startsWith 太寬）：
  ```
  PREFIX_REGEX = /^sacrificial\/preview-gate-binding\/\d{8}-\d{6}-[0-9a-f]{6}\/$/
  ```
  → 不符 → `400 BAD_PREFIX`（reject `sacrificial/preview-gate-binding/xxx/`、`sacrificial/preview-gate-binding/2026-05-25/` 等任何不對齊 `<yyyymmdd>-<hhmmss>-<6hex>/` 結構的字串）
- `key.startsWith(prefix)` → 否則 `400 BAD_KEY`
- `op` 限定 6 個 enum → 否則 `400 BAD_OP`
- **Op-specific body validation**（升 r2，codex finding 2）：
  - put-class（`setup_control` / `put_overwrite` / `put_new`）：`body` 必填且非空 string → 否則 `400 PUT_BODY_REQUIRED`
  - 非 put-class（`delete` / `head` / `get_control`）：`body` 必須 absent / null / `''` → 否則 `400 NON_PUT_REJECT_BODY`
- **Body 出現 `bucket` 欄位**（升 r3，codex r2 finding 4 — reject property presence 不看值）→ `400 BUCKET_FIELD_FORBIDDEN`：用 `Object.hasOwn(body, 'bucket')` 判斷，命中即 400，**不管值是 null / '' / false / undefined / 任何 truthy**（fail-closed；防止用 `bucket: null` 之類繞過）；binding 由 server-side 硬寫 `env.AUDIT_ARCHIVE_BUCKET`
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
  success_meta:
    | { etag, httpEtag, size, version }       // put-class success
    | { deleted: true }                        // delete success
    | { etag, size }                           // head success
    | { body_sha256: string, size: number }    // get_control success (r2: hash-only, NEVER raw body)
    | null,
  thrown: ThrownShape | null,
  classifier_verdict: boolean | null,  // null when outcome === 'success'; boolean when 'thrown'
  classifier_paths_hit: string[] | null, // null when success; subset of ['fast_path_code', 'canonical_phrase', 'numeric_code', 'dual_condition'] when thrown — 跟 isR2LockError 三路對齊（debug 用）
  timing_ms: number,
}
```

`ThrownShape` 同 1b.1（`name / message / code / status / cause / stringified`）— fixture 比對相容。

**`get_control` 設計（升 r2，codex finding 2）**：endpoint 走 binding `.get(key)` 讀回小型 canary body（setup_control 預先 PUT 已知 sha256 的 byte string；建議 64-byte 含 ts + rand），**internal compute `sha256(arrayBuffer)` + return `{ body_sha256: <hex>, size }`**。`get_control` response **絕不**含 raw body bytes（避免 fixture 落地的位元組成為 leak surface 或 git 體積 bloat；fixture 比對 hash 即可）。對應 fixture summary 加 `get_control_body_match`（升 r4，codex r3 minor nit — 與 §6 schema + §7 PASS 命名一致）（hash 比對 setup_control 階段預先計算的 expected sha256）作 hard PASS 條件。

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
  "outcome": "in_progress" | "PASS" | "FAIL_CRITICAL" | "FAIL_CLASSIFIER_MISS" | "FAIL_WRITE_BLOCKED" | "FAIL_STATE_BREACH" | "FAIL_UNEXPECTED",  // r3：與 §7 verdict 列舉同步 + 加 in_progress 對應 step 3 / 4 partial state
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
    /* step 2 put_overwrite, 3 put_new, 4 delete, 5 head, 6 get_control — 6 ops 順序固定 */
  ],

  "control_object": {
    "key": "<full key>",
    "expected_body_sha256": "<sha256 hex — setup_control 階段預先計算>",
    "head_after_delete_attempt": { /* op 5 head response */ },
    "get_body_sha256": "<sha256 hex — op 6 get_control 回的；PASS 必須與 expected 完全一致>"
  },

  "summary": {
    "setup_control_success": boolean,        // op 1 outcome === 'success'（HARD PASS）
    "overwrite_blocked": boolean,            // op 2 outcome === 'thrown'（HARD PASS）
    "overwrite_classifier_hit": boolean,     // op 2 classifier_verdict === true（HARD PASS）
    "overwrite_paths_hit": string[],         // op 2 classifier_paths_hit
    "put_new_success": boolean,              // op 3 outcome === 'success'（HARD PASS — write-once design 仰賴此；若 false 表示 prod lock 上線後新 chunk/manifest 寫不進）
    "delete_blocked": boolean,               // op 4 outcome === 'thrown'（HARD PASS）
    "delete_classifier_hit": boolean,        // op 4 classifier_verdict === true（HARD PASS）
    "delete_paths_hit": string[],            // op 4 classifier_paths_hit
    "head_after_delete_intact": boolean,     // op 5 outcome === 'success'（control object 未被 op 4 動到）
    "get_control_body_match": boolean,       // op 6 body_sha256 === expected_body_sha256（HARD PASS — overwrite/delete 沒造成狀態破壞的最終證明）
    "binding_throw_shape_matches_1b1": boolean,  // diff against r2-lock-binding-canary-2026-05-24.json（non-blocking record）
    "binding_throw_shape_diff": object | null    // if !matches: diff summary（forensic only）
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

## 7. PASS/FAIL judgment（嚴格 — 升 r2，codex finding 1）

### PASS（全 7 條 HARD AND）
1. `setup_control_success === true` （op 1 PUT new key 進 locked prefix 必過；若 false 表示 write-once design 在 prod bucket 不成立）
2. `overwrite_blocked === true` （op 2 thrown）
3. `overwrite_classifier_hit === true` （isR2LockError 命中 op 2）
4. `put_new_success === true` （op 3 PUT new key 進已 locked prefix 必過；**HARD** — 若 false 表示 lock 連合法 new key 也擋，prod lock 上線後新 chunk/manifest 寫不進、archive 流程整個 break；Cloudflare bucket lock docs 定義 lock 防 deletion/overwrite，**不**防新物件寫入，若擋是真實 bug）
5. `delete_blocked === true` （op 4 thrown）
6. `delete_classifier_hit === true` （isR2LockError 命中 op 4）
7. `get_control_body_match === true` （op 6 sha256 等於 setup_control 階段的 expected_body_sha256；**HARD** — overwrite/delete 沒造成 state 破壞的最終證明；codex finding 1 強調沒這條 gate 沒證明完整）

**Non-blocking 但記錄**（forensic only）：
- `head_after_delete_intact === true`（op 5 head 仍回 success；冗餘訊號，肯定 control 物件被 op 4 嘗試 DELETE 失敗 + body 沒被改）
- `binding_throw_shape_matches_1b1 === true`（与 1b.1 preview fixture diff 對齊；若不同記 diff 但不 block — 真實平台行為 drift 才是新 issue）

### FAIL 分類

| outcome 字串 | 觸發條件 | 處理 |
|---|---|---|
| `FAIL_CRITICAL` | op 2 OR op 4 `outcome === 'success'`（binding 真的沒擋 overwrite/delete）| **prod lock 上線 BLOCKED**；開 CF support ticket 問 prod bucket binding 與 preview bucket 是否平台行為不同；保留 sacrificial prefix 24h 作 forensic |
| `FAIL_CLASSIFIER_MISS` | op 2 / op 4 thrown 但 classifier_verdict === false（binding 擋了但 classifier 漏判） | **prod lock 上線 BLOCKED**；classifier extend PR + 補 fixture wholesale regression；保留 fixture forensic |
| `FAIL_WRITE_BLOCKED` | op 1 setup_control OR op 3 put_new `outcome === 'thrown'`（lock 連新物件都擋；違反 Cloudflare bucket lock 設計）| **prod lock 上線 BLOCKED**；CF support 確認 bucket lock 真實平台行為；archive write-once design 重新設計 |
| `FAIL_STATE_BREACH` | op 6 get_control body_sha256 !== expected_body_sha256（overwrite 嘗試實際改成了 body）| **prod lock 上線 BLOCKED + CRITICAL**：lock 沒 enforce 寫入完整性；同 FAIL_CRITICAL 嚴重度但獨立分類便於 forensic 區分 |
| `FAIL_UNEXPECTED` | endpoint 回 4xx/5xx (auth / validation / binding missing) | **prod lock 上線 BLOCKED**；停下 debug；保留 fixture |

---

## 8. Failure path — cleanup + metadata preservation

**Codex 點明的 gap**：current runbook 只在 PASS 後寫 fixture；FAIL 時最需要保留 sacrificial prefix / rule / controlKey metadata。本 PR 修正方式：

### Runbook 強制順序
1. 設 lifecycle add（先設無 retention enforce，安全）
2. 設 lock add（不可逆 24h）
3. **立刻** atomic-replace 正式 fixture（`outcome: "in_progress"`、含 prefix / lock_rule_name / lifecycle_rule_name；空 ops + 空 summary）— 在跑任何 op 前；寫 sibling `<fixture>.tmp` + `FileStream.Flush($true)` 真正 fsync → `Move-Item -LiteralPath $tmpAbs -Destination $finalAbs -Force`（PS 5.1 / .NET Fx 4.0 親驗綠，NTFS atomic；詳 §10 PowerShell 樣板）
4. 跑 6 個 op（升 r3，codex r2 finding 3 — get_control 是 op 6），**每跑完一條** atomic-replace 正式 fixture，正式 path 上的 JSON 一直是當下最完整狀態（outcome 仍 `in_progress`、ops 已含已跑完的 N entry / partial summary）
5. 6 個 op 結束後 finalize：算 summary + outcome verdict（PASS / 5 種 FAIL 之一）→ atomic-replace 正式 fixture 最後一次
6. 不論 PASS / FAIL 都 `git add` + commit + push

### 為什麼每步都 atomic replace 正式 fixture（升 r3，codex r2 finding 1）
若 step 4 在跑 op 時 PowerShell session 掛掉 / network error / 中斷：
- **r2 寫法**「全程 .tmp、最後才 move」→ 正式 fixture 路徑可能還不存在，metadata 只在 `.tmp`（容易被 user 誤刪、不在 git working tree 預期位置、cleanup 流程找不到）
- **r3 寫法**「每步 atomic replace 正式 path」→ 正式 fixture 永遠是 disk truth；mid-run crash 後最壞情況是「partial outcome 留在正式 JSON、outcome 仍 in_progress」，但 prefix + rule names + control_key + 已跑 op 的 entries 都齊全 → S3 cleanup 可從正式 path 直接 recover

`<fixture>.tmp` 是寫入過程的 race-safe staging file，**不**作為 long-lived state。完整流程：write tmp bytes → `FileStream.Flush($true)` 真正 fsync（flushToDisk=true）→ `Move-Item -Force` atomic-replace 正式 path → tmp 消失。

### S3 後 48hr 自動 cleanup
1b spike S3 段已驗 lifecycle `--expire-days 2` 真的會清 sacrificial object。但 **lock rule + lifecycle rule entry 不會自動消** — 仍要手動移除（升 r2，codex finding 3 — wrangler 4.x 規定 `--id` 必填）：
```powershell
npx wrangler r2 bucket lock remove chiyigo-audit-archive --id $lock_rule_name
npx wrangler r2 bucket lifecycle remove chiyigo-audit-archive --id $lifecycle_rule_name
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
4. user `Invoke-RestMethod` 6 ops，每 op 立刻寫 fixture entry（atomic write — §6 細節）
5. fixture finalize + commit + push（這個 commit 是 plan 第三個，**不在 two-commit chain 內**，是 between-commits 的 forensic artifact）

### Commit 2 — Remove endpoint
**Subject**: `feat(audit-archive): PR 0.2c-pre-3 commit 2 — preview gate binding canary <PASS|FAIL> + endpoint removed`

**Files**:
- 刪 `functions/api/admin/cron/r2-preview-gate-binding-canary.ts`
- 刪 `tests/r2-preview-gate-binding-canary.test.ts`
- 刪 `tests/integration/r2-preview-gate-binding-canary.test.ts`
- 改 `docs/AUDIT_ARCHIVE_LOCK_BEHAVIOR.md`（紀錄 PR 0.2c-pre-3 outcome）
- 改 `docs/AUDIT_RETENTION_PLAN.md`（gate checklist tick / cross-tick）
- **保留**：`functions/utils/audit-archive.ts` 的 `classifyR2LockError` helper — 升級為 **「diagnostic classifier 」**（codex §14 answer，非 canary-專用命名；給未來 forensic / debug 用）；註解段加「為何留：暴露 isR2LockError 內部 path 命中情形，便於將來 binding/S3 throw shape 改變時快速比對」

**Baseline 要求**：
- 同 commit 1 baseline
- test count 回到 commit 1 之前 + classifier regression（5 ish 增量留）

**重要**：commit 2 把臨時 prod-touching endpoint 從 prod 移除，避免遺留 surface（與 1b.1 commit 2 一致）。

### Commit 2 deploy removal verified（升 r2，codex finding 4）

**`git push commit 2 ≠ prod endpoint 已消失`**。Pages auto-deploy 有 ~30-90s 延遲；commit 2 推完到 endpoint 真正從 prod 消失之間有 race window。本步驟在 commit 2 push 後**強制執行**才能宣稱 prod-touching surface removed：

```powershell
# Step A: 等 Pages production deployment hash 對齊 commit 2
# 開 CF dashboard → Workers & Pages → chiyigo-com → Deployments
# 等最新 Production deployment commit = <commit-2-short-hash>
# 或 wrangler CLI:
$expectedHash = (git rev-parse --short=8 HEAD)
# poll Pages deployments API（或人眼盯 dashboard）

# Step B: curl endpoint 預期 404 / 405 / Method Not Allowed
$endpointUrl = 'https://chiyigo.com/api/admin/cron/r2-preview-gate-binding-canary'
$probe = try { Invoke-WebRequest -Uri $endpointUrl -Method POST -Headers @{'Authorization' = 'Bearer fake-for-removal-check'} -Body '{}' -ContentType 'application/json' -ErrorAction Stop } catch { $_.Exception.Response }
$status = [int]$probe.StatusCode

# 預期 status 是 404（Pages function 已移除）或 405（route 不在）
if ($status -ne 404 -and $status -ne 405) {
  throw "Endpoint removal verify FAIL: got status $status; commit 2 may not have deployed yet, OR endpoint still routable on prod"
}
"Endpoint removal verified: status=$status (404/405 expected)"
```

**只有 Step A + B 都過**才可結案 PR 0.2c-pre-3 + memory 標 prod-touching surface removed。若 Step B 拿到 401 / 200 表示 endpoint 仍然 routable — 立刻檢查 Pages deployment 是否真換到 commit 2、必要時 redeploy。

---

## 10. 新 PREVIEW_GATE_RUNBOOK_BINDING.md 結構

**Path**: `docs/PREVIEW_GATE_RUNBOOK_BINDING.md`（新檔，不蓋舊 `PREVIEW_GATE_RUNBOOK.md` — 舊文留作 design history + DO NOT RUN reference）

**Sections**:

1. **🔴 安全護欄**（不可逆度 + prefix 強制 + retention 上限 + 不做的事 — 對齊舊 runbook §安全護欄）
2. **預備檢查** A1–A4（OAuth identity + CRON_SECRET 取得 + main HEAD 對齊 + Pages prod deploy 對齊）
3. **執行步驟（Layer 0 — 對齊 binding canary outcome 不是 wrangler lock semantics）**
   - Step 0.1 生 prefix `sacrificial/preview-gate-binding/<ts>-<rand>/`（必符 PREFIX_REGEX `^sacrificial\/preview-gate-binding\/\d{8}-\d{6}-[0-9a-f]{6}\/$`） + lock_rule_name + lifecycle_rule_name
   - Step 0.2 lifecycle add → lock add（用 wrangler；這部分 wrangler owner privilege 不影響）
   - Step 0.3 **atomic-replace 正式 fixture**（升 r3，codex r2 finding 1 — 不是「全程寫 tmp」）：寫 `<fixture>.tmp` → atomic move 到正式 path `docs/fixtures/preview-gate-binding-canary-<ts>.json`，內容 `outcome: "in_progress"` + prefix + lock_rule_name + lifecycle_rule_name + control_key + 空 ops[]
   - Step 0.4 lock propagation wait 10s（[[feedback_r2_lock_propagation_canary]]）
   - Step 0.5 `Invoke-RestMethod` op 1 setup_control（POST endpoint）→ 算 `expected_body_sha256` + atomic-replace 正式 fixture（ops[0] 入 + control_object.expected_body_sha256 入；outcome 仍 `in_progress`）
   - Step 0.6 op 2 put_overwrite → atomic-replace 正式 fixture（ops[1] 入）
   - Step 0.7 op 3 put_new → atomic-replace 正式 fixture（ops[2] 入；write-once design proof — **HARD PASS**：若 thrown 表示 FAIL_WRITE_BLOCKED，正式 fixture 仍 `in_progress` 直到 step 0.11 才升）
   - Step 0.8 op 4 delete → atomic-replace 正式 fixture（ops[3] 入）
   - Step 0.9 op 5 head → atomic-replace 正式 fixture（ops[4] 入）
   - Step 0.10 op 6 **get_control** → atomic-replace 正式 fixture（ops[5] 入、control_object.get_body_sha256 入；**HARD PASS**：sha 不對齊 expected 表示 FAIL_STATE_BREACH）
   - Step 0.11 finalize：算 summary + 從 §7 verdict matrix 算 outcome（`PASS` / 5 個 `FAIL_*` 之一）→ atomic-replace 正式 fixture 最後一次（outcome 升、verdict_reason 填、summary 完整）

**PowerShell atomic replace 樣板**（每步重用；升 r4，codex r3 critical — 本機 PS 5.1.19041.6328 / .NET Fx 4.0.30319.42000 沒有 `File.Move(string,string,bool)` 三-arg overload；**且 Claude 親跑驗證 `File.Replace($tmp, $final, $null, $true)` 也炸 `The path is not of a legal form.`**（PS `$null` 第三 arg 被解釋成 illegal string path）。最後 landing 用 `Move-Item -Force` cmdlet，PS-idiomatic、NTFS 同 volume rename atomic（Windows `MoveFileEx` + `MOVEFILE_REPLACE_EXISTING`），不留 backup file 污染：

```powershell
# $finalPath = docs/fixtures/preview-gate-binding-canary-<ts>.json（repo-relative）
$finalAbs  = Join-Path (Get-Location) $finalPath
$tmpAbs    = Join-Path (Get-Location) "$finalPath.tmp"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$jsonBody  = $fixture | ConvertTo-Json -Depth 6

# Write tmp + 真正 fsync（FileStream.Flush(bool) flushToDisk=true，PS 5.1 / .NET Fx 4.0 親驗綠）
$bytes = $utf8NoBom.GetBytes($jsonBody + [Environment]::NewLine)
$fs = [System.IO.File]::Open($tmpAbs, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $fs.Write($bytes, 0, $bytes.Length)
  $fs.Flush($true)        # flushToDisk=true → 真 fsync（不是只刷 OS write-back cache）
} finally {
  $fs.Dispose()
}

# Atomic-replace 正式 path 用 Move-Item -Force（PS-idiomatic，NTFS atomic）：
#   - 首次（step 0.3，final 不存在）+ 後續（step 0.5+，final 已存在）路徑統一
#   - -Force 在 destination 已存在時 overwrite；不存在時等同 plain Move
#   - 內部走 Windows MoveFileEx + MOVEFILE_REPLACE_EXISTING → 同 volume NTFS 原生 atomic
Move-Item -LiteralPath $tmpAbs -Destination $finalAbs -Force
```

**為何**最終 landing 不用 `File.Replace` 或 `File.Move`（即便它們 method overload 都在）：
- `File.Move(string, string, bool overwrite)` 是 .NET Core / .NET 5+ 才有的 overload；PS 5.1 跑在 .NET Framework 4.x，**沒這支 overload**（codex r3 親驗 + Claude r4 親驗）
- `File.Replace(string, string, string destinationBackupFileName, bool ignoreMetadataErrors)` **理論支援** `destinationBackupFileName=null`，但在 PowerShell 5.1 把 `$null` 傳入 string arg 會被解釋成 illegal path string，runtime throw `ArgumentException: The path is not of a legal form.`（Claude r4 親跑驗證兩種 `$null` 寫法都炸；若硬要用 `File.Replace` 必須給 explicit backup file path + 立刻刪掉，污染 tmp folder）
- `Move-Item -LiteralPath ... -Destination ... -Force` 是 PS 內建 cmdlet，行為穩定、不污染、與 user 既有 S3 cleanup 段（`Remove-Item -LiteralPath`）命名風格一致

**正式 fixture 路徑永遠是 disk truth**；`.tmp` 只在每步寫入過程短暫存在（PowerShell crash 在 `Open/Write/Flush` 中可能殘留，但下一次 user 進來 `.tmp` 在 + 正式 fixture 仍是上一步狀態 → safe，正式 path 是 SoT）。`FileStream.Flush($true)` 確保 OS write-back cache 也刷到 disk（不只進 buffer），power outage 場景 fixture 不會 lose write-through。

**親驗結果（Claude r4 本機跑，PS 5.1.19041.6328 / .NET Fx 4.0.30319.42000）**：
- 連續 3 步 `Write-Atomic` 不同 body → 正式 fixture 內容對齊最後一步 ✓
- 沒 tmp 殘留 ✓
- `File.Replace` 第三 arg `$null` / `[System.String]$null` 都 throw ✗（已替換）
- `Move-Item -Force` 路徑統一首次 + 後續，最簡 ✓
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
- prod bucket **18 lock + 18 lifecycle = 36 rules total** 上線（升 r2，codex finding 5 — 對齊 `docs/AUDIT_RETENTION_PLAN.md` line 906 SoT）：本 PR PASS 後，才 plan 下一個 PR 0.2c 真上線
- wrangler OAuth scope rotate / token 更換：與 gate semantics 無關

---

## 12. Memory updates needed

### Update after commit 1（implementation 期間）
- `project_audit_phase2.md`：current state「明天 user 跑 prod lock pre-flight Layer 1」改為「PR 0.2c-pre-3 commit 1 in progress（binding canary on prod bucket）」
- 新增 [[reference_r2_lock_gate_design_evolution]]：紀錄 wrangler-based → binding-based 設計演進 + 為何 0.2a/wrangler 路徑被拒；給未來類似 gate 設計參考

### Update after commit 2（PASS path）
- `project_audit_phase2.md`：「preview gate PASS + fixture 路徑」+ 「下一步 PR 0.2c 18+18=36 rules total 上線」
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
| Lock propagation 超過 10s | 中 | Low | 升 r3（codex r2 finding 5）：**不把 op 1 失敗當 propagation 延遲處理** — op 1 setup_control 寫 new key 進 locked prefix，按設計應 success（write-once），若 thrown 就是 FAIL_WRITE_BLOCKED 真實 bug、不該 retry；若擔心 propagation，獨立加 step 0.4b 走 `Invoke-RestMethod` head/get_control 對既不存在的 key 做 propagation probe，與 op 1 流程分離 — 但 1b spike + 1b.1 canary 已驗 10s sleep 足夠，此 mitigation 預設不啟用 |
| Prod bucket binding 與 preview bucket binding 平台行為不一致 | 低 | High（gate 真正要驗的事） | 這是 gate 存在的意義；FAIL_CRITICAL 流程處理 |

---

## 14. Open questions — codex r1 answers（已收，2026-05-25）

| # | Question | Codex answer | 落實位置 |
|---|---|---|---|
| 1 | PASS 條件是否漏 | 加硬條件：setup_control success + put_new success + get_control body_sha256 match；binding_throw_shape_matches_1b1 保持 non-blocking record | §7 升 7 條 HARD AND；§6 fixture summary 增 6 個 boolean key |
| 2 | 檔名 | OK，長但清楚；保留 `r2-preview-gate-binding-canary.ts` | §3 維持 |
| 3 | classifyR2LockError 抽法 | 可抽，但加 **parity tests**：所有既有 isR2LockError cases 都要等於 `classify(...).matched` | §11 test 段加 parity 要求 |
| 4 | Commit 2 保留 helper | 保留，加註「**diagnostic classifier**」，不留 canary 專用命名 | §9 commit 2 段已修 |
| 5 | 新 runbook 命名 | `PREVIEW_GATE_RUNBOOK_BINDING.md` OK；舊文保留 DO NOT RUN + 指向新檔 | §10 維持，舊文已 safety patch |
| 6 | Fixture early-write | 用 final fixture path，每次更新走 **atomic write**：寫 `.tmp`，成功後 replace/move 到正式 JSON；不要只寫 tmp 到 finalize | §10 step 0.3-0.11 升 atomic 多次 move；§13 風險表更新 |
| 7 | wrangler.toml / types/env.d.ts 不動的假設 | 確認 OK；`AUDIT_ARCHIVE_BUCKET` 已存在 | §4 file 觸點維持 |

---

## 14b. Codex r1 blocking findings — 7 fix 已套用（2026-05-25）

| # | Finding | Fix 位置 |
|---|---|---|
| 1 | §7 PASS 應升 hard：new_key + control body match 不是 non-blocking | §7 升 7 條 HARD AND + 新增 FAIL_WRITE_BLOCKED / FAIL_STATE_BREACH 兩 FAIL 分類 |
| 2 | Fixture 寫 expected_body_sha256 但 ops 沒驗 — 缺 `get_control` op，head 不夠 | §4 op enum 加 `get_control`；response shape 含 `body_sha256 + size`（NEVER raw body）；§6 fixture 加 op 6；§10 runbook step 0.10 加 op 6 |
| 3 | Cleanup commands 少 `--id` flag | §8 cleanup 兩條指令補 `--id` |
| 4 | Prefix guard 只 startsWith 太寬 | §4 升完整 regex `^sacrificial\/preview-gate-binding\/\d{8}-\d{6}-[0-9a-f]{6}\/$`；§10 step 0.1 也補上 |
| 4b | Op-specific body validation 漏 | §4 加 PUT_BODY_REQUIRED / NON_PUT_REJECT_BODY；body bucket field 改 fail-closed 400 BUCKET_FIELD_FORBIDDEN |
| 5 | Two-commit chain 缺「commit 2 deploy removal verified」步驟 | §9 加完整 Step A + B（等 Pages deployment 對齊 commit 2 hash + curl endpoint 預期 404/405）|
| 6 | §11 non-goals 殘留「36 lock + 36 lifecycle」 mismatch | §11 改 **18 lock + 18 lifecycle = 36 rules total**；§12 memory update 同步 |

---

## 14c. Codex r1 衍生新 test 要求（§14 answer 3）

**Parity tests for `classifyR2LockError`**：
- 既有 isR2LockError test cases 全跑兩遍（透過 helper 暴露 `classify(...).matched === isR2LockError(...)` 對齊）
- 任何單一 mismatch → test fail
- 落實位置：`tests/audit-archive.test.ts` 新 describe `PR 0.2c-pre-3 classifyR2LockError parity`，逐 case 走原 isR2LockError test fixtures，assert 兩函式結果同步
- 預估 +existing cases 數量（PR 1b spike-tightened + 1b.2 binding extend cases，合計約 25-30 個 case）

加進 §9 commit 1 baseline 要求：classifier regression 從 5 ish → ~30 cases（parity 全跑一遍）。

---

## 15. Tomorrow 動工順序（升 r4）

1. Fresh session 開始 → 讀 `MEMORY.md` + 本 plan（**r4 版本，含 codex r1 7 + r2 5 + r3 3 全部 fix**）+ commit 1 task 細節
2. 寫 `r2-preview-gate-binding-canary.ts`（copy 1b.1 + §3 6 點 diff + §4 op-specific validation + regex prefix + get_control）
3. 寫 `classifyR2LockError` helper extension + 暴露 `{ matched, paths }`；對外保留 `isR2LockError(e: unknown): boolean` 不變
4. 寫 unit tests（21+ cases — 多 get_control / body validation / prefix regex 邊界 case）+ int tests（5+ cases — 多 get_control round-trip）+ classifier regression parity（既有 + ~30 parity cases）
5. typecheck / npm test / npm test:int / build / lint:handlers / lint:archive-no-delete / ratchet:report 全綠
6. Commit 1 + push
7. 等 codex review commit 1
8. Codex Approve 後 deploy + 對齊 Pages prod commit hash
9. User 走 walk-through 跑 canary（fresh session 接手 — Claude 帶 user 過 §10 runbook，用 §10 atomic-replace 樣板）
10. Fixture finalize（每步 atomic-replace 正式 path；最後一次寫 outcome + verdict）+ commit + push
11. Codex review fixture（PASS / 5 FAIL 分類 verdict 判定）
12. Commit 2（PASS / FAIL 都做）+ §9 Step A + B prod removal verified
13. 等 codex review commit 2
14. Memory update + 結案

---

**請 codex r4 給 verdict**：r3 3 fix 是否全收進 plan？PS 5.1 / .NET Fx 4.0 相容性樣板是否仍有未驗證 API？plan 整體無自我矛盾、無未實際驗證的假設？
