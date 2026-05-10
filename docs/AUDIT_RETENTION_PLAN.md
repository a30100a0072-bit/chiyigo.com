# Audit Retention Plan — F-3 Phase 2

> Status: v8 draft (codex round-7 finding 修正) · 2026-05-10
> Phase 1 done (commit 97e1a72): event registry + warn-on-missing
> Phase 2 scope: audit_log retention + R2 cold archive
> Phase 2 **不**動 admin_audit_log hot D1（量小、hash chain 證據敏感、verifier 不改）
> Phase 3 (條件觸發)：admin_audit_log size > 500k row 或 D1 壓力明顯時 → 加 audit_chain_anchor + hot purge

## v8 主要變更（codex round-7 修正）

| codex finding | v8 解法 |
|---|---|
| H 1：cold_class 分流後 D1 mark/purge `WHERE id BETWEEN` 會誤動其他 class | `audit_log` 加 `cold_class` 欄；safeUserAudit 寫入時自動填；mark/purge 加 `AND cold_class = ?` predicate |
| H 2：progress query `MAX(max_id)` 跨 cold_class 不安全 | 進度查詢改 per (table, cold_class)；GROUP BY cold_class；每 class 獨立 cursor |
| M 3：manifest 範例 key 缺 cold_class、`categories` 欄與「同 chunk 同 class」衝突 | manifest 加 `cold_class` + `cold_class_version` 單值欄；移除 `categories` 混合計數；`severities` 改成同 class 內摘要 |
| M 4：aggregate cold archive lock/lifecycle 沒落到命令 | PR 0.2 補 `audit-log-aggregate-{telemetry,debug}/` 與其 manifest 4 條 lock + 4 條 lifecycle（共 18+18 條規則）|

**新增**：`cold_class_version` 概念（user 加固）— audit-policy 改動時 bump，避免歷史 chunk 分類語義模糊。chunks 表 + manifest 都記。

## v7 主要變更（per-category R2 retention lock，user round-7 決定）

驗證 R2 `lock` 與 `lifecycle` 都支援 `--prefix` filtering → retention matrix 不再僅是文字承諾，由 R2 物理保護層強制執行（合規 + GDPR / legal order 都對得上）。

| 改動點 | v6 → v7 |
|---|---|
| **R2 key** | 加 `{category}` 段：`audit-log/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{...}` |
| **manifest key** | 同上加 `{cold_class}` 段 |
| **`audit_archive_chunks` PK** | 加 `cold_class` 欄：`(env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256)` |
| **Archive worker** | 「先 classify → 再切 chunk」：同 chunk 只裝同 cold_class 的 row |
| **R2 lock 對應** | 6 個 cold_class 各 1 條 lock + lifecycle rule（共 6+6=12 條 prefix-scoped 規則）|
| **debug_failure retention=0** | 純 aggregate 不寫 R2，aggregate 表自己走 1y prefix |

**Cold archive class（v7 新增）** — `audit-policy` 衍生 + `severity` 細分：

| cold_class（R2 prefix）| 來源 | Lock retention | Lifecycle expire |
|---|---|---|---|
| `immutable` | category=immutable | 2555d (7y) | 2557d |
| `security_critical` | category=security_signal AND severity=critical | 2555d (7y) | 2557d |
| `security_warn` | category=security_signal AND severity IN (warn,info) | 1095d (3y) | 1097d |
| `read_audit` | category=read_audit | 1095d (3y) | 1097d |
| `telemetry` | category=telemetry | 365d (1y) | 367d |
| `debug_failure` | category=debug_failure | 365d (1y) | 367d (or skip cold) |

**admin_audit_log** 全 row 視為 `immutable` cold_class（所有 admin 操作都金流/權限級）。

## v6 主要變更（codex round-6 修正）

| codex finding | v6 解法 |
|---|---|
| M 1：terminal state hardcode 'purged'，admin_audit_log 永遠跑不完 | 三處改 table-specific：write flow step 9、cron-month-finalize、進度查詢 `MAX(max_id)`。新增 `isChunkComplete()` 規則 |
| L/M 2：cold_copied transition 規則 implicit | 狀態機表加 `cold_copied` 行：verified 後直接升、寫 cold_copied_at、emit `audit.archive.cold_copied`、不進 mark/purge |
| L 3：review 焦點仍寫 v4 | 改 v5 焦點 + 移除舊 `deleted == row_count AND still_archived == 0` 表述（升 dual-path 描述）|

## v5 主要變更（codex round-5 修正）

| codex finding | v5 解法 |
|---|---|
| M/H 1：purged 升態同樣有 crash-after-delete-before-state hole | 加 purged 雙路徑：`deleted == row_count && still_archived == 0` 直升；`deleted == 0 && still_archived == 0 && remaining_in_range == 0 && prior_state == marked_archived` → recovery 升 |
| M 2：cron-purge-worker 無法有效查詢「7 天後」 | `audit_archive_chunks` 加 `marked_archived_at` / `purge_after` / `cold_copied_at` 三欄；加 partial index `idx_archive_chunks_purge ON (state, purge_after) WHERE state='marked_archived'` |
| M 3：新 v4 audit events 沒進 registry | 加進事件清單：`audit.archive.marked_archived` / `cold_copied` / `row_count_mismatch` / `partial_archive_mismatch` / `purge_mismatch` |
| L/M 4：Goals/Tier wording 沒反映 admin_audit_log Phase 2 不 purge | 改寫 Goals + Tier 表，明確 admin_audit_log Phase 2 = hot 永久 append-only + 月度 cold copy |

## v4 主要變更（codex round-4 修正）

| codex finding | v4 解法 |
|---|---|
| M/H 1：marked_archived re-entry 規則矛盾 | 改雙路徑驗證：UPDATE changes==row_count → 直升；changes==0 → 查 `COUNT WHERE archived_at IS NOT NULL`，等於 row_count 才升；partial 需手動補齊 |
| M 2：cold_copied terminal state 沒進 enum | 加進 manifest state enum + `audit_archive_chunks.state` CHECK 約束 |
| M 3：v2 stale references | 清掉 `audit_archive_state.last_status` / 舊 PR 1 描述 / 四態 review重點 |
| L/M 4：audit_log hash 策略段重複 | 刪掉重複段，留一份 |
| L 5：寫入流程 step 7 仍寫 DELETE D1（沒拆） | 改名 step 7 = Mark archived，新增 step 8 = Delayed purge（grace 7d，獨立 cron）|

## v3 主要變更（vs v2）

| codex finding | v3 解法 |
|---|---|
| High 1：cleanup.js 既有 destructive archive 路徑 | **PR 0 第一步必先 neuter** `functions/api/admin/cron/cleanup.js` 的 `audit_log_archive` special — 改為 no-op；舊路徑寫死 disabled，避免加 binding 後直接觸發舊邏輯 |
| High 2：manifest key 用 run_id 不可重入 | manifest key 改為 deterministic：`manifest/{env}/{table}/{yyyy}/{mm}/{dd}/{min_id}-{max_id}-{chunk_sha256}.json`；run_id 降為 metadata + 獨立 run-index 檔 |
| M-H 3：audit_archive_state schema 過粗 | 改 per-chunk 行：`(env, table, date, min_id, max_id, chunk_sha256)` 為 PK，欄位含 state / retry_count / last_failure_at / next_reminder_at / blacklisted_at |
| M 4：verifyAuditChain 會被 admin_audit_log 歸檔打斷 | Phase 2 admin_audit_log **不 purge**（user decision），verifier 完全不動；Phase 3 才考慮 anchor |
| M 5：aggregate vs sampling schema 不一致 | 拆 `audit_log_aggregate_telemetry` 與 `audit_log_aggregate_debug` 兩個表 |
| M 6：purged 狀態 overload | 狀態機加 `marked_archived` 中介態：planned → uploaded → verified → **marked_archived** → purged |

## Goals & non-goals

**Goals**（Phase 2 範圍，codex round-4 M-4 收緊）
- 把 **`audit_log`** 從「無上限累積」變成「分級保留 + 冷存」（hot 30-180d、cold 1-7y）。
- 把 **`admin_audit_log`** 增加 cold backup 能力（R2 月度 copy）；**hot D1 暫不受 retention 限制**（量小 + hash chain 證據敏感）。
- 金融級稽核：mutation / security / read 類資料都能在規定保留期內查得到。
- D1 不長期膨脹（D1 是 hot store，10GB 軟天花板要尊重）— 主要靠 audit_log 分級控管達成。
- 失敗 fail-safe：R2 沒寫成功不刪 D1。
- 操作可稽核：archive job 自身的成功/失敗/重試都進 audit_log。

**Non-goals**（Phase 2）
- 不做即時查詢冷存資料（admin 要查 R2 archive 走 admin job export）。
- 不做跨 region replication（R2 預設 11 9s 已夠）。
- 不在這個 phase 做 PII redaction / GDPR right-to-be-forgotten；屬獨立議題。
- **不對 admin_audit_log 做 hot D1 retention**（v3 user decision；條件觸發後走 Phase 3）。

## Tier 模型

| Tier | 介質 | 用途 | audit_log TTL | admin_audit_log（Phase 2）|
|---|---|---|---|---|
| Hot | D1 | admin UI 查詢 / on-call 即時排查 / event correlation | 30-180 天（依分類） | **永久 append-only**（量小，verifyAuditChain 從 GENESIS 驗）|
| Cold | R2 bucket `chiyigo-audit-archive` | 長期稽核 / 法遵 / 監管要求 / forensic | 1-7 年（依分類） | **每月 cold copy**（cold_copied 終態，不影響 hot）|

**為什麼 R2 唯一 cold archive**
- D1 archive table 會持續吃 D1 空間，跟 D1 的 hot 角色相衝。
- R2 storage 0.015 USD/GB/month，全量 audit 估 < 50MB/month，10 年 < 6GB → 1 USD/year 級數，符合 $0 成本基線。
- R2 immutable upload 配 versioning，可作為法遵 chain-of-custody。

**Phase 3（條件觸發）**：當 admin_audit_log row count > 500k 或 D1 size 壓力明顯時，加 `audit_chain_anchor` + `archived_at` 欄 + 真 purge 流程；verifier 改從 anchor 起算。

## Retention Matrix

| Category | Hot D1 | Cold R2 | Aggregate? | Sampling? |
|---|---|---|---|---|
| `immutable` (金融/權限/身分 mutation) | 180 d | **7 年** | 否 | 否 |
| `security_signal` (critical/warn) | 180 d | **3 年** (warn) / **7 年** (critical) | 否 | 否 |
| `read_audit` (admin 敏感讀取) | 180 d | **3 年** | 否 | 否 |
| `telemetry` (rate_limit / dispatch) | 90 d | 1 年 | **是**（time-bucket）| 高頻可採樣 |
| `debug_failure` (client-noise / network err) | 30-90 d | 0-1 年 | **是** | **是** |

**法遵錨點**
- 7 年：對齊台灣商會計法 / 個資法 / 反洗錢規範下的金融紀錄保存期。
- 3 年：對齊一般民事請求權時效（消費爭議）。
- 1 年：操作審計足以 cover 多數異常 root cause analysis。

**critical 升 7 年的判定**
透過 audit_log.severity 欄位區分：
- security_signal + severity='critical'（refresh.aud_mismatch / device_mismatch / risk.blocked）→ 7 年
- security_signal + severity in ('warn','info') → 3 年

## Aggregate 規則（v3：telemetry / debug_failure 分流，M-5 修正）

只 `telemetry` / `debug_failure` 兩類可 aggregate；兩者 schema/bucket key 不同：

### Telemetry aggregate（純計數）
- **Bucket key**：`(event_type, user_id_or_null, severity, hour_bucket)`
- **保留欄位**：`count` + `ip_hash_top`（出現最多的 hash，觀察用）
- **不留樣本**：rate_limit / dispatch 類用計數已足夠
- 寫進 `audit_log_aggregate_telemetry`

### Debug_failure aggregate（含 sample）
- **Bucket key**：`(event_type, reason_code, hour_bucket)`
- **保留欄位**：`total_count` + `sample_count` + `samples_json`（前 100 筆 raw event_data）
- **`sampled=true`** if `total_count > 100`
- **`critical` severity 不採樣**：金融級下不冒險，每筆保留（升 immutable 處理）
- 寫進 `audit_log_aggregate_debug`

### Aggregate 觸發點
- Hot retention 過期前 **24h** 跑 aggregate worker：把超過 90/30 天的 raw rows 合併寫入對應 aggregate 表
- 合併完成後，raw row 進 archive worker（一般 chunk 流程進 R2 + DELETE）
- Aggregate 表自身也要冷存：每月底 archive aggregate 表進 R2（key prefix `audit-log-aggregate-{telemetry|debug}/`），冷存 1 年

## Archive Flow（D1 → R2）

### 命名 / 切片

**R2 bucket**：prod / preview 分 bucket（`chiyigo-audit-archive` / `chiyigo-audit-archive-preview`）；env binding `AUDIT_ARCHIVE_BUCKET`（保留命名空間，未來可有 `AUDIT_ARCHIVE_QUEUE` / `AUDIT_ARCHIVE_KV`）。

**Key 命名**（v7：加 `{cold_class}` 段對齊 R2 prefix-based lock）：
```
audit-log/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min_id}-{max_id}-{chunk_sha256}.jsonl.zst
manifest/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min_id}-{max_id}-{chunk_sha256}.json
manifest/{env}/{table}/{cold_class}/{yyyy}/{mm}/month.json
runs/{env}/{table}/{yyyy}/{mm}/{dd}/{run_id}.json   # 該 run 內含的 chunk_id 列表（觀察用，跨 cold_class）
```
範例 prod chunk key：
```
audit-log/prod/audit_log/immutable/2026/04/30/1234567-1244440-abc123ef.jsonl.zst
audit-log/prod/audit_log/security_critical/2026/04/30/1244441-1244892-def456ab.jsonl.zst
audit-log/prod/audit_log/telemetry/2026/04/30/1244893-1247001-fed789cd.jsonl.zst
```
- **chunk manifest key 與 jsonl key 完全對齊**：相同 `min_id-max_id-chunk_sha256` 路徑下 → 重跑同 chunk 時 GET 既存 manifest 直接讀 state 接續，不靠 run_id 推斷（codex H-2 修正）
- `run_id` = ULID，**降為 metadata**：寫進 manifest 與獨立 run-index 檔，方便人工觀察某次 cron 跑了哪些 chunk，但不參與 idempotency
- chunk_sha256 嵌 key：同資料重算 sha 一致 → R2 PUT 同 key idempotent；不同 chunk 邊界（即使 min/max overlap 也）會被 sha256 區分

**Chunk 切片條件（任一先到）**：
- 10,000 rows
- 5 MB compressed (zstd-19)
- `max_duration_ms = 60_000`（Worker cron 30s 軟限再 doubled buffer，確保不超時被切）

### Manifest 結構（chunk-level，含狀態機）

manifest 是 archive lifecycle 的 source of truth；不只靠 audit event 推進度，方便中斷恢復。

**狀態機**：`planned → uploaded → verified → marked_archived → purged`（單向，每步寫一次 manifest 並寫對應 audit event）

```json
{
  "schema_version": "2.0",
  "env": "prod",
  "table": "audit_log",
  "cold_class": "security_critical",            // v8：每 chunk 單一 cold_class
  "cold_class_version": 1,                      // v8：classifier 版本；audit-policy 改動後 bump
  "run_id": "01HZAB...ULID",
  "chunk_id": "audit-log/prod/audit_log/security_critical/2026/04/30/1244441-1244892-def456ab.jsonl.zst",
  "state": "verified",                          // planned|uploaded|verified|marked_archived|purged|cold_copied|failed|blacklisted
  "state_history": [
    { "state": "planned",          "at": "2026-05-15T18:00:00Z" },
    { "state": "uploaded",         "at": "2026-05-15T18:00:08Z" },
    { "state": "verified",         "at": "2026-05-15T18:00:11Z" },
    { "state": "marked_archived",  "at": "2026-05-15T18:00:12Z" },
    { "state": "purged",           "at": "2026-05-15T18:30:00Z" }
  ],
  "row_count": 452,
  "min_id": 1244441,
  "max_id": 1244892,
  "min_ts": "2026-04-30T00:00:11Z",
  "max_ts": "2026-04-30T23:48:02Z",
  "sha256_jsonl": "<sha256 of decompressed jsonl>",
  "sha256_zst": "<sha256 of compressed file>",
  "compression": "zstd-19",
  "severities": { "critical": 452 },            // 同 cold_class chunk 內的 severity 摘要

  // admin_audit_log only — 跨 chunk hash chain 驗證用
  "first_row_hash":         "<row_hash of min_id>",
  "last_row_hash":          "<row_hash of max_id>",
  "prev_hash_of_first_row": "<prev_hash field of min_id row>",

  "writer": "cron-archive-worker",
  "writer_version": "1.0.0"
}
```

**狀態機規則**（codex round-3 修正：解 marked_archived re-entry 矛盾）

| 狀態 | 觸發條件 | 升態驗證 | 適用表 |
|---|---|---|---|
| `planned` | D1 SELECT 完成 + sha256 算完 → 寫 manifest 上 R2 | manifest PUT ok | 全部 |
| `uploaded` | jsonl.zst PUT 完 | R2 PUT ok | 全部 |
| `verified` | R2 GET 回讀 + sha256 + row_count 比對 ok | sha256 一致 + 行數一致 | 全部 |
| `marked_archived` | D1 `UPDATE archived_at=NOW() WHERE id BETWEEN ? AND ? AND archived_at IS NULL` | **見下方雙路徑驗證** | `audit_log` 專用 |
| `purged` | grace period 過後執行 `DELETE WHERE archived_at < NOW() - grace` | **見下方雙路徑驗證** | `audit_log` 專用（terminal） |
| `cold_copied` | verified 後直接升（不進 mark/purge）→ `UPDATE SET state='cold_copied', cold_copied_at=NOW()`，emit `audit.archive.cold_copied` | 同 verified（已驗 sha256 + row count） | `admin_audit_log` 專用（terminal） |

**Terminal state 對應**（codex round-5 M-1 修正）：
- `audit_log`：terminal = `purged`
- `admin_audit_log`：terminal = `cold_copied`（**不**進 marked_archived / purged）

> 因此「該 chunk 完工」判斷須用 table-specific 規則：
> ```
> isChunkComplete(chunk) =
>   chunk.state == ('purged' if chunk.table == 'audit_log' else 'cold_copied')
> ```

**`marked_archived` 升態雙路徑（codex round-3 M/H 1 修正）**

> 解 crash-after-update-before-state 場景：worker 在 UPDATE 已成功、manifest state 還沒升前掛掉，retry 時 UPDATE 看到的是已標記 row → `affected_rows = 0`。

```
UPDATE audit_log SET archived_at = NOW()
  WHERE id BETWEEN ? AND ? AND archived_at IS NULL
LET changed = affected_rows

IF changed == manifest.row_count:
  → marked_archived（first-pass 成功）
ELSE IF changed == 0:
  -- 可能：(a) 前一輪已標記成功但 state 沒升、(b) 沒任何 row 在範圍內
  query: SELECT COUNT(*) FROM audit_log
           WHERE id BETWEEN ? AND ? AND cold_class = ? AND archived_at IS NOT NULL
  IF count == manifest.row_count → marked_archived（recovery 成功，標記資料已存在）
  ELSE → state=failed + audit.archive.row_count_mismatch（critical）
ELSE (0 < changed < row_count):
  -- partial update：手動補標記到 row_count 為止
  query: SELECT COUNT(*) FROM audit_log
           WHERE id BETWEEN ? AND ? AND cold_class = ? AND archived_at IS NOT NULL
  IF count == manifest.row_count → marked_archived
  ELSE → state=failed + audit.archive.partial_archive_mismatch（critical）
```

**`purged` 升態雙路徑驗證**（codex round-4 M/H 1 修正）

> 解 crash-after-delete-before-state 場景：worker DELETE 已成功、manifest state 還沒升前掛掉，retry 時 DELETE 看到的是已刪 row → `deleted = 0`、`still_archived = 0`。

```
LET deleted = DELETE affected_rows
LET still_archived = SELECT COUNT(*) FROM audit_log
                       WHERE id BETWEEN ? AND ? AND cold_class = ? AND archived_at IS NOT NULL
LET remaining_in_range = SELECT COUNT(*) FROM audit_log
                           WHERE id BETWEEN ? AND ? AND cold_class = ?

IF deleted == manifest.row_count AND still_archived == 0:
  → purged（first-pass 成功）
ELSE IF deleted == 0 AND still_archived == 0 AND remaining_in_range == 0
        AND prior_state was 'marked_archived':
  → purged（recovery 成功：前一輪已物理刪除完，state 沒升）
ELSE IF deleted == 0 AND still_archived == manifest.row_count:
  -- DELETE 條件沒命中（grace 還沒到 / archived_at 比較失敗）：留在 marked_archived
  → 維持 marked_archived，下輪重試
ELSE IF deleted > 0 AND deleted < manifest.row_count:
  -- partial DELETE：手動補刪到 still_archived = 0
  retry DELETE WHERE id BETWEEN ? AND ? AND cold_class = ? AND archived_at IS NOT NULL
  IF still_archived == 0 → purged
  ELSE → state=failed + audit.archive.purge_mismatch（critical）
ELSE:
  → state=failed + audit.archive.purge_mismatch（critical）
```

**recovery 條件靠 prior_state 是 `marked_archived`**：避免 deleted=0 + range 為空被誤判為 purged 完成（萬一 chunk 從來沒進到 marked_archived）。讀 audit_archive_chunks.state 即可確認。

中斷恢復原則：cron 讀 manifest state + audit_archive_chunks state（兩者必同），該做什麼下一步直接決定，不必反推 audit events。

### 月份級總 manifest

```json
{
  "schema_version": "1.0",
  "table": "audit_log",
  "month": "2026-04",
  "chunk_count": 7,
  "total_rows": 67234,
  "chunks": [
    { "chunk_id": "audit_log__2026-04__chunk-000", "sha256_zst": "..." },
    ...
  ],
  "manifest_sha256": "<sha256 of this file's chunks array sorted by chunk_id>",
  "completed_at": "2026-05-15T03:42:11Z"
}
```

**用途**：admin job 重建月份索引時讀總 manifest 即可，不必逐 chunk 列舉 R2。

### 寫入流程（fail-safe，可重入；v7 加 classify 步驟）

```
1. 對每個 cold_class 各跑一輪：
   SELECT * FROM audit_log
    WHERE id BETWEEN ? AND ? AND cold_class = ?
    ORDER BY id
   （v8：cold_class 已在 audit_log row 上，不再 worker 內分類；
    SELECT 範圍內可能不連續，但 chunk 只裝同 cold_class row → mark/purge 用同 predicate 不誤動其他 class）
2. Build JSONL（同 cold_class）→ compress (zstd) → SHA-256 (decompressed + compressed)
3. Upload manifest（state=planned）to R2
4. Upload jsonl.zst chunk to R2 (key 含 chunk_sha256，重跑 idempotent)
5. Update manifest（state=uploaded）
6. R2 GET back chunk → verify SHA-256 + row count
   ok   → manifest（state=verified）+ audit.archive.chunk_uploaded
   fail → audit.archive.verification_failed（critical）→ 不刪 D1，下輪重試
7. Mark archived（D1 logical delete，v8 加 cold_class predicate）：
     UPDATE audit_log SET archived_at=NOW()
       WHERE id BETWEEN ? AND ? AND cold_class = ? AND archived_at IS NULL
     依「marked_archived 升態雙路徑」驗證 affected_rows / 已標記 count
     ok → manifest（state=marked_archived）+ audit.archive.marked_archived
8. Delayed purge（grace period = 7 days；獨立 cron run 觸發）：
     DELETE FROM audit_log
       WHERE id BETWEEN ? AND ? AND cold_class = ? AND archived_at < NOW() - INTERVAL '7 days'
     依「purged 升態驗證」驗證 deleted + still_archived
     ok → manifest（state=purged）+ audit.archive.d1_purged
9. 月底所有 chunk 進入 terminal state（`audit_log` → purged / `admin_audit_log` → cold_copied）→ 寫月份 manifest + audit.archive.month_completed
```

**為什麼先寫 R2 再刪 D1**：D1 是 source of truth；R2 寫失敗下輪 retry，最壞情況 hot retention 多保幾天，不會丟資料。反過來會丟。

**為什麼 mark / purge 拆兩階段（grace 7 天）**：archive 完到物理 DELETE 之間留 audit window，admin 萬一發現 R2 chunk 異常還能直接從 D1 撈回。grace 過了才真刪。

**可重入保證**
- chunk key 含 `chunk_sha256`，相同資料重算 sha256 一致 → R2 PUT 同 key idempotent
- D1 UPDATE 與 DELETE 都依雙路徑驗證 `affected_rows` + 「已標記/已殘留 count」對齊 manifest.row_count
- manifest state 與 `audit_archive_chunks.state` 必同；中斷後讀 chunks 表單行就能決定下一動作
- DELETE 用 row id range + manifest sha256 對齊，**不**用時間窗（時間窗會把後到的新 row 也涵蓋）

### 失敗模式 / 邊界

| 失敗模式 | 處置 |
|---|---|
| R2 PUT timeout/network error | retry 3 次（exponential backoff 1s/4s/16s），仍失敗則寫 `audit.archive.upload_failed`（warn）；下一輪 cron 重跑 |
| R2 GET 驗證雜湊不符 | 寫 `audit.archive.verification_failed`（critical）+ Discord webhook；不刪 D1；標記 chunk_id 黑名單 require admin job 介入 |
| D1 UPDATE 中斷 | `archived_at IS NULL` 條件保證重跑只動未處理 row；中斷可安全重跑 |
| Cron CPU/time 超限 | 每 chunk atomic（manifest state 推進是 single PUT），下一輪讀 manifest state 接續即可 |
| 同 chunk 第 N 次 retry | 第 1-2 次失敗：warn；**第 3 次失敗：critical Discord/PagerDuty**；之後每 24h 一次 reminder（不再每輪噴），避免告警風暴 |
| Admin 看冷存 | `/api/admin/audit/export?month=2026-04` 從 R2 拉 manifest + chunks，逐 chunk verify sha256 + row count 後組合，寫 `admin.audit.archive.read` 進 hot audit |


### Schema 變更（v3 修正 + v8 加 cold_class）

**audit_log 加 archived_at + cold_class**（v8 codex round-7 H-1/H-2 修正）
```sql
ALTER TABLE audit_log ADD COLUMN archived_at TEXT;
ALTER TABLE audit_log ADD COLUMN cold_class TEXT NOT NULL DEFAULT 'immutable'
  CHECK(cold_class IN ('immutable','security_critical','security_warn','read_audit','telemetry','debug_failure'));
CREATE INDEX idx_audit_log_archived_at ON audit_log(archived_at);
CREATE INDEX idx_audit_log_cold_id ON audit_log(cold_class, id);   -- archive worker SELECT 主索引
```

**admin_audit_log 不加 archived_at / cold_class**（v3 user decision；Phase 2 只 copy cold 不 purge；admin 全 row 視為 immutable cold_class，由 archive worker 路徑硬寫常數）

**safeUserAudit 寫入時自動填 cold_class**
```js
// functions/utils/user-audit.js（v8 改動）
import { classifyForCold } from './audit-policy.js'   // 新 helper

const cold_class = classifyForCold(entry.event_type, severity)
INSERT INTO audit_log (..., severity, ..., cold_class) VALUES (..., ?, ..., ?)
```

**Backfill 既有 row**：PR 1 schema migration 同 PR 跑一次：
```sql
-- 對所有 cold_class='immutable' (DEFAULT) 的舊 row 重算正確值
-- classifier 邏輯 inline 寫成 CASE WHEN 或 worker 跑單次 backfill
UPDATE audit_log SET cold_class =
  CASE
    WHEN event_type IN (...immutable list...) THEN 'immutable'
    WHEN event_type IN (...security_signal list...) AND severity='critical' THEN 'security_critical'
    WHEN event_type IN (...security_signal list...) THEN 'security_warn'
    ...
  END
WHERE cold_class = 'immutable';   -- DEFAULT 值，未經 classifier
```

**audit_archive_chunks（per-chunk 狀態，codex M-3 修正 + v7 加 cold_class）**
```sql
CREATE TABLE audit_archive_chunks (
  env             TEXT    NOT NULL,
  table_name      TEXT    NOT NULL,
  cold_class      TEXT    NOT NULL            -- v7：R2 prefix 對應的 retention class
                  CHECK(cold_class IN ('immutable','security_critical','security_warn','read_audit','telemetry','debug_failure')),
  cold_class_version INTEGER NOT NULL DEFAULT 1, -- v8：classifier 版本，audit-policy 改動 bump
  archive_date    TEXT    NOT NULL,           -- YYYY-MM-DD
  min_id          INTEGER NOT NULL,
  max_id          INTEGER NOT NULL,
  chunk_sha256    TEXT    NOT NULL,           -- jsonl 解壓後的 sha256
  state           TEXT    NOT NULL            -- audit_log: planned→uploaded→verified→marked_archived→purged
                                              -- admin_audit_log (Phase 2): planned→uploaded→verified→cold_copied (terminal)
                                              -- failure terminal: failed / blacklisted
                  CHECK(state IN ('planned','uploaded','verified','marked_archived','purged','cold_copied','failed','blacklisted')),
  row_count       INTEGER NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  last_failure    TEXT,                       -- error reason
  next_reminder_at TEXT,                      -- 24h reminder due time
  blacklisted_at  TEXT,                       -- 連 3 次失敗後標記

  marked_archived_at TEXT,                    -- 升 marked_archived 的時間（codex round-4 M-2）
  purge_after        TEXT,                    -- = marked_archived_at + 7d；purge worker 只查此欄
  cold_copied_at     TEXT,                    -- admin_audit_log 走到 cold_copied 終態的時間

  run_id          TEXT NOT NULL,              -- 最後一次處理的 run
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256)
);
CREATE INDEX idx_archive_chunks_state ON audit_archive_chunks(state, table_name, cold_class);
CREATE INDEX idx_archive_chunks_purge ON audit_archive_chunks(state, purge_after)
  WHERE state = 'marked_archived';            -- cron-purge-worker 主查詢索引
CREATE INDEX idx_archive_chunks_blacklist ON audit_archive_chunks(blacklisted_at)
  WHERE blacklisted_at IS NOT NULL;
```

**升態同步寫時間欄位**：
- `marked_archived` 升態時 `UPDATE SET marked_archived_at=NOW(), purge_after=datetime(NOW(), '+7 days')`
- `cold_copied` 升態時 `UPDATE SET cold_copied_at=NOW()`
- `purged` 升態時不另寫時間欄（updated_at 已記錄）

**audit_log_aggregate_telemetry（M-5 修正：純 count，無 samples）**
```sql
CREATE TABLE audit_log_aggregate_telemetry (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL,
  user_id       INTEGER,                       -- nullable（unauth events）
  severity      TEXT NOT NULL,
  hour_bucket   TEXT NOT NULL,                 -- YYYY-MM-DDTHH:00:00Z
  count         INTEGER NOT NULL,
  ip_hash_top   TEXT,                          -- bucket 內出現最多的 ip_hash（觀察用）
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agg_tele_event ON audit_log_aggregate_telemetry(event_type, hour_bucket);
CREATE INDEX idx_agg_tele_user  ON audit_log_aggregate_telemetry(user_id, hour_bucket)
  WHERE user_id IS NOT NULL;
```

**audit_log_aggregate_debug（M-5 修正：含 first 100 raw samples）**
```sql
CREATE TABLE audit_log_aggregate_debug (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type      TEXT NOT NULL,
  reason_code     TEXT,                        -- nullable
  hour_bucket     TEXT NOT NULL,
  total_count     INTEGER NOT NULL,
  sample_count    INTEGER NOT NULL,            -- 實際保留的 sample 筆數（≤100）
  samples_json    TEXT NOT NULL,               -- JSON array of first 100 raw event_data
  sampled         INTEGER NOT NULL DEFAULT 0,  -- 1 = 超過 100 被截，0 = 完整保留
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agg_debug_event ON audit_log_aggregate_debug(event_type, hour_bucket);
```

**舊 audit_archive_state（v2）**：作廢，不建。

**進度查詢必須 per (table, cold_class)**（v8 codex round-7 H-2 修正）— 不能用 global MAX(max_id)，因為各 cold_class 的 id range 交錯，某 class 的高 max_id 完成不代表低 id 的其他 class 完成。

```sql
-- 每個 (table, cold_class) 各自查 cursor
SELECT cold_class, MAX(max_id) AS cursor
  FROM audit_archive_chunks
 WHERE table_name='audit_log'
   AND state='purged'    -- audit_log terminal
 GROUP BY cold_class;

-- admin_audit_log（全部 immutable cold_class，terminal=cold_copied）
SELECT MAX(max_id) AS cursor
  FROM audit_archive_chunks
 WHERE table_name='admin_audit_log'
   AND cold_class='immutable'
   AND state='cold_copied';
```

**Worker 續跑邏輯**：每個 cold_class 維護獨立 cursor，下一輪 SELECT 從 `cursor + 1` 開始，避免重掃已 archived 範圍。

## 新增 audit events（要進 audit-policy registry）

全部歸 `immutable`（archive 操作本身要永留）：

**正常流程**
- `audit.archive.chunk_uploaded`           — verified ok 後寫
- `audit.archive.marked_archived`          — D1 archived_at SET 完成
- `audit.archive.d1_purged`                — 物理 DELETE 完成
- `audit.archive.cold_copied`              — admin_audit_log Phase 2 終態
- `audit.archive.month_completed`
- `audit.archive.aggregate_completed`

**失敗 / 異常**（critical severity，觸發 Discord webhook）
- `audit.archive.verification_failed`      — R2 GET 驗證 sha256 失敗
- `audit.archive.upload_failed`            — R2 PUT 失敗（warn；3 次後升 critical）
- `audit.archive.row_count_mismatch`       — marked_archived 升態時雙路徑都失敗（codex round-4 M-3）
- `audit.archive.partial_archive_mismatch` — marked_archived partial UPDATE 後補齊失敗
- `audit.archive.purge_mismatch`           — purged 升態時 deleted/still_archived 對不上

**Admin 操作**
- `admin.audit.archive.read`               — admin export 觸發

> v4 起新事件需在 PR 1 同 PR 加進 `functions/utils/audit-policy.js`，否則 PR 2 dry-run 會觸發 `[audit-policy] unclassified` warning。

## Hash chain 策略（v3：admin_audit_log 不 purge hot）

### `admin_audit_log`：Phase 2 只 copy cold，hot D1 不動（codex M-4 修正）
- `prev_hash / row_hash` 已在 schema（migration 0012）
- **Hot D1 永久保留 append-only**（量小：admin 操作 ≪ user audit）→ `verifyAuditChain()` 不改、從 GENESIS 一路驗
- archive worker 對 admin_audit_log 路徑：
  - 走 chunk 流程把 row copy 進 R2（manifest + sha256 + row_count 全套）
  - 每 chunk manifest 仍記錄：`first_row_hash` / `last_row_hash` / `prev_hash_of_first_row`（離線備份驗證能力保留）
  - **跳過 marked_archived / purged 狀態**：state 走到 `verified` 即停（升 `cold_copied` 終態）
  - **不 UPDATE archived_at、不 DELETE D1 row**
- 跨 chunk 驗證規則仍適用（純 cold 用）：`chunk[N].prev_hash_of_first_row === chunk[N-1].last_row_hash`
- 月份 manifest 額外記 `month_first_row_hash` / `month_last_row_hash`，方便跨月驗證

### Phase 3 觸發條件（admin_audit_log 真 purge）
當 **任一條件** 成立時啟動 Phase 3：
- `admin_audit_log` row count > 500,000
- D1 size 對 hot 角色造成壓力（具體 threshold 由 prod 觀察決定）

Phase 3 加：
- `audit_chain_anchor` 表記最新已 archive chunk 的 `last_row_hash` + `max_id`
- `verifyAuditChain()` 改為從 anchor 而非 GENESIS 起算
- `admin_audit_log.archived_at` 欄
- archive worker 對 admin_audit_log 走完整 marked_archived → purged 流程
- anchor 寫入必須與 chunk verified 狀態 atomic（避免 anchor 領先實際 archive）

### `audit_log`：chunk-level hash（Phase 2 採用）
- 每 chunk JSONL 算 SHA-256 進 manifest
- 月份 manifest 算 chunks 陣列的 SHA-256（chunks 依 min_id 排序）
- **不**逐列鏈（成本/收益不划算；audit_log 寫入頻率高，逐列鏈在 hot path overhead 過大）
- 若未來監管要求逐列鏈 → 獨立 phase 升級

## Cron / Job 拆分

| Job | 觸發 | 目的 |
|---|---|---|
| `cron-archive-worker` | 每日 18:00 UTC（= 02:00 Asia/Taipei 凌晨低峰）| 找 hot retention 過期的 row → 走完 planned→...→marked_archived 五狀態 |
| `cron-purge-worker` | 每日 19:00 UTC | `WHERE state='marked_archived' AND purge_after <= NOW()` 走 idx_archive_chunks_purge 索引；對命中 chunk 執行物理 DELETE，升 `purged` |
| `cron-aggregate-worker` | 每週日 17:00 UTC（= 01:00 Asia/Taipei）| telemetry / debug_failure aggregate（先合併再讓 archive worker 接手）|
| `cron-month-finalize-worker` | 每月 1 號 20:00 UTC（= 04:00 Asia/Taipei）| 上月 chunk 全部進 terminal（audit_log→purged / admin_audit_log→cold_copied）後寫月份 manifest |
| `admin-job: audit-archive-retry` | 手動 / API | 補跑失敗的 chunk（`SELECT FROM audit_archive_chunks WHERE state IN ('failed','blacklisted')`）|
| `admin-job: audit-archive-export` | 手動 / API | 讀 R2，組合月份檔回 admin |

**Cron 分散原因**：archive 是大量 R2 PUT（量大但 CPU 輕），aggregate 是 D1 重 query（CPU 重），分開避開單個 Worker invocation 的 CPU/time 上限。

## Implementation phases（拆 5 個 PR；PR 0 + PR 1-4）

### PR 0（前置）— Neuter 舊路徑 + R2 bucket + versioning + IAM

**Step 0.1（必先做，commit 後再動 binding）— 拆掉 cleanup.js 既有 destructive archive 路徑（codex H-1）**
- `functions/api/admin/cron/cleanup.js`：
  - 移除 `audit_log_archive` special branch 內部邏輯（`archiveAndDeleteAuditLog` 改為 no-op + 註明「Phase 2 archive worker 接手」）
  - audit_log task 改成 `{ name: 'audit_log', noop: true, note: 'phase2-pending' }` 或直接從 TASKS 陣列移除
  - 整個函式體刪掉，避免 future 誤啟用
- 不刪掉 D1 binding（cleanup.js 其他 task 仍要用）
- 落 prod 確認 cron 不再呼舊路徑

**Step 0.2 — R2 bucket + IAM + per-class lock + lifecycle（v7 落地）**

> Step 0.1 已 deployed prod（commit e57ded4），舊路徑已死。可進 Step 0.2。

**Bucket**
- prod `chiyigo-audit-archive` 已存在（commit ebd44d2，object_count=0）
- 建 preview bucket：`wrangler r2 bucket create chiyigo-audit-archive-preview`

**Versioning**（兩個 bucket 都開）
- R2 versioning 用 dashboard 或 API 開（wrangler 4.87 沒有 `versioning` 子命令）

**Per-class lock（6 條）— 對 prod bucket**
```bash
# 7-year retention（金融 + critical security）
wrangler r2 bucket lock add chiyigo-audit-archive lock-immutable \
  "audit-log/prod/audit_log/immutable/" --retention-days 2555 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-sec-critical \
  "audit-log/prod/audit_log/security_critical/" --retention-days 2555 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-admin-immutable \
  "audit-log/prod/admin_audit_log/immutable/" --retention-days 2555 -y

# 3-year retention
wrangler r2 bucket lock add chiyigo-audit-archive lock-sec-warn \
  "audit-log/prod/audit_log/security_warn/" --retention-days 1095 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-read-audit \
  "audit-log/prod/audit_log/read_audit/" --retention-days 1095 -y

# 1-year retention
wrangler r2 bucket lock add chiyigo-audit-archive lock-telemetry \
  "audit-log/prod/audit_log/telemetry/" --retention-days 365 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-debug \
  "audit-log/prod/audit_log/debug_failure/" --retention-days 365 -y

# manifest 也要鎖（與資料同 retention）
# 7y manifest（3 個）
wrangler r2 bucket lock add chiyigo-audit-archive lock-manifest-immutable \
  "manifest/prod/audit_log/immutable/" --retention-days 2555 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-manifest-sec-critical \
  "manifest/prod/audit_log/security_critical/" --retention-days 2555 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-manifest-admin \
  "manifest/prod/admin_audit_log/immutable/" --retention-days 2555 -y
# 3y manifest（2 個）
wrangler r2 bucket lock add chiyigo-audit-archive lock-manifest-sec-warn \
  "manifest/prod/audit_log/security_warn/" --retention-days 1095 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-manifest-read \
  "manifest/prod/audit_log/read_audit/" --retention-days 1095 -y
# 1y manifest（2 個）
wrangler r2 bucket lock add chiyigo-audit-archive lock-manifest-tele \
  "manifest/prod/audit_log/telemetry/" --retention-days 365 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-manifest-debug \
  "manifest/prod/audit_log/debug_failure/" --retention-days 365 -y

# Aggregate 表的 cold archive（v8 codex round-7 M-4 修正）
# telemetry / debug aggregate 月底進 R2，retention 1y
wrangler r2 bucket lock add chiyigo-audit-archive lock-agg-tele \
  "audit-log-aggregate-telemetry/prod/" --retention-days 365 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-agg-debug \
  "audit-log-aggregate-debug/prod/" --retention-days 365 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-agg-manifest-tele \
  "manifest/prod/audit_log_aggregate_telemetry/" --retention-days 365 -y
wrangler r2 bucket lock add chiyigo-audit-archive lock-agg-manifest-debug \
  "manifest/prod/audit_log_aggregate_debug/" --retention-days 365 -y
```

**Per-class lifecycle（lock 過期後自動刪）— 對 prod bucket**
```bash
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-immutable \
  "audit-log/prod/audit_log/immutable/" --expire-days 2557 -y
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-sec-critical \
  "audit-log/prod/audit_log/security_critical/" --expire-days 2557 -y
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-sec-warn \
  "audit-log/prod/audit_log/security_warn/" --expire-days 1097 -y
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-read-audit \
  "audit-log/prod/audit_log/read_audit/" --expire-days 1097 -y
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-telemetry \
  "audit-log/prod/audit_log/telemetry/" --expire-days 367 -y
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-debug \
  "audit-log/prod/audit_log/debug_failure/" --expire-days 367 -y
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-admin-immutable \
  "audit-log/prod/admin_audit_log/immutable/" --expire-days 2557 -y

# manifest 對應 lifecycle（7 條，prefix 改 manifest/prod/...）
# Aggregate 對應 lifecycle（4 條，prefix 改 audit-log-aggregate-{telemetry|debug}/ 與其 manifest）
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-agg-tele \
  "audit-log-aggregate-telemetry/prod/" --expire-days 367 -y
wrangler r2 bucket lifecycle add chiyigo-audit-archive expire-agg-debug \
  "audit-log-aggregate-debug/prod/" --expire-days 367 -y
# ... manifest 與 aggregate manifest 同樣模式
```

**Lock + Lifecycle 規則總數**：
- audit-log/ 7 條（6 cold_class + 1 admin_audit_log/immutable）
- manifest/ 7 條（對應）
- audit-log-aggregate-{telemetry,debug}/ 2 條
- manifest/.../audit_log_aggregate_{telemetry,debug}/ 2 條
- 共 **18 條 lock + 18 條 lifecycle = 36 條規則**

**IAM**
- Dashboard 建立最小權限 archive token：bucket-scope `chiyigo-audit-archive` + `chiyigo-audit-archive-preview`，permission = Object Read & Write（**不給 Delete**）
- `wrangler.toml` 已有 `AUDIT_ARCHIVE_BUCKET` binding（commit ebd44d2 已 deploy）— 不需再動

**驗證清單**
- `wrangler r2 bucket lock list chiyigo-audit-archive` → 7+ 條 rule
- `wrangler r2 bucket lifecycle list chiyigo-audit-archive` → 7+ 條 rule
- 試上傳一個 object 進 `audit-log/prod/audit_log/immutable/` → 立即 GET 回讀 ok；試 DELETE → 應失敗（lock 生效）
- preview bucket 不需 lock（測試方便，dev 寫過就丟）

### PR 1 — Schema + retention metadata
- 加 `audit_log.archived_at` + `audit_log.cold_class` 兩欄（v8 codex round-7 H-1）
  - cold_class CHECK + idx_audit_log_cold_id `(cold_class, id)` 索引
  - **不**加 `admin_audit_log.archived_at`（v3 user decision；admin Phase 2 不 purge）
- safeUserAudit 改寫：呼叫新 helper `classifyForCold(event_type, severity)` → 寫入 cold_class 欄
- Backfill migration：對 DEFAULT 'immutable' 的舊 row 用 CASE WHEN 重算
- 新建 `audit_archive_chunks` 表（per-chunk 狀態 + cold_class + cold_class_version）
- 新建 `audit_log_aggregate_telemetry` + `audit_log_aggregate_debug` 表
- audit-policy.js 加 `classifyForCold()` 函式 + 7 個新 archive event 入 registry
- 同 PR 加單元測試：`classifyForCold` 對每個已知 event_type 的回值；schema migration up/down

### PR 2 — Archive worker（dry-run 模式）
- Cron worker 寫 R2，但**不刪 D1**（DRY_RUN env flag）
- 跑 1 個月觀察 R2 寫入正確性、體積、效能

### PR 3 — Aggregate worker
- 對 telemetry / debug_failure 跑 bucket 合併
- 仍 dry-run（產 aggregate 表但不刪 raw）

### PR 4 — 啟動真刪除
- 移除 DRY_RUN flag
- archive worker 開始刪 D1
- aggregate worker 開始刪 raw

## Decisions（2026-05-10 round 2，已採納）

| # | 議題 | 決定 |
|---|---|---|
| 1 | R2 versioning + retention lock | **prod bucket 必開 versioning**（Phase 2 前置條件，不是 optional）；retention lock 強烈建議。若 Cloudflare R2 retention lock 功能限制不便，**fallback 控制**：(a) archive token 最小權限（PUT/GET only，不給 DELETE）；(b) runtime 程式禁 DELETE；(c) 人工 break-glass 流程 + audit 必記。 |
| 2 | Chunk size | 10k rows / 5MB compressed / **60s max_duration_ms**，任一先到。同 chunk_sha256 重跑 idempotent。 |
| 3 | admin_audit_log 跨 chunk hash chain | manifest 記 `first_row_hash` / `last_row_hash` / `prev_hash_of_first_row`；驗證離線可做（`chunk[N].prev_hash_of_first_row === chunk[N-1].last_row_hash`），不依賴 D1。 |
| 4 | R2 binding 命名 | `AUDIT_ARCHIVE_BUCKET`（保留命名空間）；prod/preview 分 bucket；env 入 R2 key 前綴防汙染。 |
| 5 | Failed chunk 告警 | 第 1-2 次 warn；**第 3 次升 critical**（Discord/PagerDuty）；之後每 24h 一次 reminder（避免風暴）。Webhook 重用 `DISCORD_AUDIT_WEBHOOK`。 |
| 6 | Archive timing | **18:00 UTC = 02:00 Asia/Taipei 凌晨**（避日間流量；archive 03:00 / aggregate 17:00 週日 / month-finalize 19:00 月初）。 |
| 7 | Sampling 規則 | bucket key = `(event_type, reason_code, hour)`，每組保留 first 100 raw samples + count；`critical` debug_failure 不採樣；`telemetry` 類只 aggregate 計數不留樣本。 |

## Codex review 重點（v6 焦點）

1. **R2 versioning fallback 是否守得住** — 沒有 retention lock 時，最小權限 token + runtime 禁 DELETE + break-glass 三層是否足夠抵 prod 操作意外？
2. **5-狀態機對中斷的覆蓋** — `planned / uploaded / verified / marked_archived / purged` 五態（audit_log）+ `cold_copied`（admin_audit_log）+ `failed / blacklisted`（異常終態）。worker crash-after-update / crash-after-delete 兩種場景是否都被雙路徑驗證守住？
3. **table-specific terminal state 的 worker / monthly-finalize / 進度查詢** — 三處（writeFlow step 9、cron-month-finalize、`MAX(max_id)` 進度查詢）都改成 audit_log→purged / admin_audit_log→cold_copied 是否一致？是否還有遺漏的 `state='purged'` hardcode？
4. **purged 雙路徑 recovery 的 prior_state 條件** — recovery branch 靠 `prior_state == marked_archived` 防誤判（避免從未進 marked 的 chunk 被當成 purged 完成），這條件夠強嗎？
5. **R2 寫成功但 D1 audit event 沒寫進**（例：R2 PUT ok 但寫 `audit.archive.marked_archived` 失敗）— manifest state 與 `audit_archive_chunks.state` 是否真能 cover、不依賴 audit event？
6. **跨 chunk hash chain 驗證對 admin_audit_log（Phase 2 不 purge 後）** — admin_audit_log 仍 hot 全留時，cold copy chunk 跨月 prev_hash_of_first_row 是否真能離線串得起來？
7. **chunk_sha256 嵌 key 的衝突風險** — key 含 `min_id-max_id-sha256` 三段，min_id+max_id 範圍跨 retention 邊界是否可能重疊？

## 下一步

- codex 審完 → 更新前提後動工 **PR 0 Step 0.1**（neuter cleanup.js 既有 destructive 路徑）
- Step 0.1 落 prod 確認 cron 不再走舊路徑 → **PR 0 Step 0.2**（建 R2 bucket + 綁 binding）
- → **PR 1**（schema migration：`audit_log.archived_at` + `audit_archive_chunks` + `audit_log_aggregate_telemetry` + `audit_log_aggregate_debug`）
- PR 1 落 prod 7 天無回歸 → **PR 2** dry-run archive worker
- PR 2 dry-run 1 個月觀察 R2 寫入正確性、體積、效能 → **PR 3** aggregate worker
- PR 3 ok → **PR 4** 移除 DRY_RUN flag，啟動 marked_archived；再過 grace 7 天 → 啟動 purge_worker
