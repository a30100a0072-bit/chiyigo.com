# Audit Retention Plan — F-3 Phase 2

> Status: v3 draft (round-3 codex feedback integrated) · 2026-05-10
> Phase 1 done (commit 97e1a72): event registry + warn-on-missing
> Phase 2 scope: audit_log retention + R2 cold archive
> Phase 2 **不**動 admin_audit_log hot D1（量小、hash chain 證據敏感、verifier 不改）
> Phase 3 (條件觸發)：admin_audit_log size > 500k row 或 D1 壓力明顯時 → 加 audit_chain_anchor + hot purge

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

**Goals**
- 把 `audit_log` / `admin_audit_log` 從「無上限累積」變成「分級保留 + 冷存」。
- 金融級稽核：mutation / security / read 類資料都能在規定保留期內查得到。
- D1 不長期膨脹（D1 是 hot store，10GB 軟天花板要尊重）。
- 失敗 fail-safe：R2 沒寫成功不刪 D1。
- 操作可稽核：archive job 自身的成功/失敗/重試都進 audit_log。

**Non-goals**
- 不做即時查詢冷存資料（admin 要查 R2 archive 走 admin job export）。
- 不做跨 region replication（R2 預設 11 9s 已夠）。
- 不在這個 phase 做 PII redaction / GDPR right-to-be-forgotten；屬獨立議題。

## Tier 模型

| Tier | 介質 | 用途 | TTL 上限 |
|---|---|---|---|
| Hot | D1 `audit_log` / `admin_audit_log` | admin UI 查詢 / on-call 即時排查 / event correlation | 30-180 天（依分類） |
| Cold | R2 bucket `chiyigo-audit-archive` | 長期稽核 / 法遵 / 監管要求 / forensic | 1-7 年（依分類） |
| Permanent | — | （不採用：所有事件最終都會被冷存或刪掉） | — |

**為什麼 R2 唯一 cold archive**
- D1 archive table 會持續吃 D1 空間，跟 D1 的 hot 角色相衝。
- R2 storage 0.015 USD/GB/month，全量 audit 估 < 50MB/month，10 年 < 6GB → 1 USD/year 級數，符合 $0 成本基線。
- R2 immutable upload 配 versioning，可作為法遵 chain-of-custody。

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

**Key 命名**（資料 + manifest 分前綴，env 入 key 防同 bucket 互汙染）：
```
audit-log/{env}/{table}/{yyyy}/{mm}/{dd}/{min_id}-{max_id}-{chunk_sha256}.jsonl.zst
manifest/{env}/{table}/{yyyy}/{mm}/{dd}/{min_id}-{max_id}-{chunk_sha256}.json
manifest/{env}/{table}/{yyyy}/{mm}/month.json
runs/{env}/{table}/{yyyy}/{mm}/{dd}/{run_id}.json   # 該 run 內含的 chunk_id 列表（觀察用）
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
  "schema_version": "1.1",
  "env": "prod",
  "table": "audit_log",
  "run_id": "01HZAB...ULID",
  "chunk_id": "audit-log/prod/audit_log/2026/04/30/1234567-1244440-abc123ef.jsonl.zst",
  "state": "verified",                          // planned|uploaded|verified|marked_archived|purged
  "state_history": [
    { "state": "planned",          "at": "2026-05-15T18:00:00Z" },
    { "state": "uploaded",         "at": "2026-05-15T18:00:08Z" },
    { "state": "verified",         "at": "2026-05-15T18:00:11Z" },
    { "state": "marked_archived",  "at": "2026-05-15T18:00:12Z" },
    { "state": "purged",           "at": "2026-05-15T18:30:00Z" }
  ],
  "row_count": 9874,
  "min_id": 1234567,
  "max_id": 1244440,
  "min_ts": "2026-04-01T00:00:00Z",
  "max_ts": "2026-04-30T23:59:59Z",
  "sha256_jsonl": "<sha256 of decompressed jsonl>",
  "sha256_zst": "<sha256 of compressed file>",
  "compression": "zstd-19",
  "categories": { "immutable": 1234, "security_signal": 5678 },
  "severities": { "info": 1000, "warn": 7000, "critical": 1874 },

  // admin_audit_log only — 跨 chunk hash chain 驗證用
  "first_row_hash":         "<row_hash of min_id>",
  "last_row_hash":          "<row_hash of max_id>",
  "prev_hash_of_first_row": "<prev_hash field of min_id row>",

  "writer": "cron-archive-worker",
  "writer_version": "1.0.0"
}
```

**狀態機規則**（codex M-6 修正：拆 marked_archived / purged）
- `planned`：D1 SELECT 完成 + sha256 算完 → 寫 manifest 上 R2
- `uploaded`：jsonl.zst PUT 完 → manifest 升狀態
- `verified`：R2 GET 回讀 + sha256 + row_count 比對 ok → manifest 升狀態
- `marked_archived`：D1 `UPDATE archived_at = NOW() WHERE id BETWEEN ... AND archived_at IS NULL` 完成；affected_rows 必須等於 manifest.row_count（差距 = 異常）
- `purged`：grace period 過後執行 `DELETE WHERE archived_at < NOW() - grace`；DELETE 的 affected_rows 必須等於 manifest.row_count
- 中斷恢復時 cron 讀最新 manifest state；該做什麼一目了然，不必反推 audit events
- **affected_rows = 0 不算錯誤**：代表已被前一輪處理（idempotent re-entry），但仍需與 manifest.row_count 對齊才能升下一狀態

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

### 寫入流程（fail-safe，可重入）

```
1. SELECT batch from D1 (id range [min_id..max_id], ORDER BY id)
2. Build JSONL → compress (zstd) → SHA-256 (decompressed + compressed)
3. Upload manifest（state=planned）to R2
4. Upload jsonl.zst chunk to R2 (key 含 chunk_sha256，重跑 idempotent)
5. Update manifest（state=uploaded）
6. R2 GET back chunk → verify SHA-256 + row count
   ok   → manifest（state=verified）+ audit.archive.chunk_uploaded
   fail → audit.archive.verification_failed（critical）→ 不刪 D1，下輪重試
7. DELETE D1：
     UPDATE audit_log SET archived_at=NOW()
       WHERE id BETWEEN ? AND ? AND archived_at IS NULL
     -- 條件含 archived_at IS NULL：重跑同 chunk 時不會再標記，affected_rows=0
     -- 同步比對 manifest.row_count 防 D1 與 manifest 行數不一致
   後執行：DELETE FROM audit_log WHERE archived_at < NOW() - INTERVAL grace_period
   purged → manifest（state=purged）+ audit.archive.d1_purged
8. 月底所有 chunk = purged → 寫月份 manifest + audit.archive.month_completed
```

**為什麼先寫 R2 再刪 D1**：D1 是 source of truth；R2 寫失敗下輪 retry，最壞情況 hot retention 多保幾天，不會丟資料。反過來會丟。

**可重入保證**
- chunk key 含 `chunk_sha256`，相同資料重算 sha256 一致 → R2 PUT 同 key idempotent
- D1 UPDATE 條件含 `archived_at IS NULL`，已歸檔 row 不會被重複處理；affected_rows=0 視為 `already_purged`，不算錯誤
- manifest state 遞進；遇到既存 verified manifest 直接跳到 purge 步驟
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


### Schema 變更（v3 修正）

**audit_log 加 archived_at**
```sql
ALTER TABLE audit_log ADD COLUMN archived_at TEXT;
CREATE INDEX idx_audit_log_archived_at ON audit_log(archived_at);
```

**admin_audit_log 不加 archived_at**（v3 user decision；Phase 2 只 copy cold 不 purge）

**audit_archive_chunks（per-chunk 狀態，codex M-3 修正）**
```sql
CREATE TABLE audit_archive_chunks (
  env             TEXT    NOT NULL,
  table_name      TEXT    NOT NULL,
  archive_date    TEXT    NOT NULL,           -- YYYY-MM-DD
  min_id          INTEGER NOT NULL,
  max_id          INTEGER NOT NULL,
  chunk_sha256    TEXT    NOT NULL,           -- jsonl 解壓後的 sha256
  state           TEXT    NOT NULL            -- planned|uploaded|verified|marked_archived|purged|failed|blacklisted
                  CHECK(state IN ('planned','uploaded','verified','marked_archived','purged','failed','blacklisted')),
  row_count       INTEGER NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  last_failure    TEXT,                       -- error reason
  next_reminder_at TEXT,                      -- 24h reminder due time
  blacklisted_at  TEXT,                       -- 連 3 次失敗後標記
  run_id          TEXT NOT NULL,              -- 最後一次處理的 run
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (env, table_name, archive_date, min_id, max_id, chunk_sha256)
);
CREATE INDEX idx_archive_chunks_state ON audit_archive_chunks(state, table_name);
CREATE INDEX idx_archive_chunks_blacklist ON audit_archive_chunks(blacklisted_at)
  WHERE blacklisted_at IS NOT NULL;
```

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

**舊 audit_archive_state（v2）**：作廢，不建。改用 chunks 表查詢 `MAX(max_id) WHERE state='purged'` 即可得每表進度。

## 新增 audit events（要進 audit-policy registry）

全部歸 `immutable`（archive 操作本身要永留）：
- `audit.archive.chunk_uploaded`
- `audit.archive.d1_purged`
- `audit.archive.verification_failed` （critical severity）
- `audit.archive.upload_failed`
- `audit.archive.month_completed`
- `audit.archive.aggregate_completed`
- `admin.audit.archive.read` （admin export 觸發）

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

### `audit_log`：chunk-level hash（Phase 2 採用）
- 每 chunk JSONL 算 SHA-256 進 manifest
- 月份 manifest 算 chunks 陣列的 SHA-256（chunks 依 min_id 排序）
- **不**逐列鏈（成本/收益不划算；audit_log 寫入頻率高，逐列鏈在 hot path overhead 過大）
- 若未來監管要求逐列鏈 → Phase 3 升級

## Cron / Job 拆分

| Job | 觸發 | 目的 |
|---|---|---|
| `cron-archive-worker` | 每日 18:00 UTC（= 02:00 Asia/Taipei 凌晨低峰）| 找 hot retention 過期的 row → 寫 R2 chunks → DELETE D1 |
| `cron-aggregate-worker` | 每週日 17:00 UTC（= 01:00 Asia/Taipei）| telemetry / debug_failure aggregate（先合併再讓 archive worker 接手）|
| `cron-month-finalize-worker` | 每月 1 號 19:00 UTC（= 03:00 Asia/Taipei）| 上月所有 chunk 完成後寫月份 manifest |
| `admin-job: audit-archive-retry` | 手動 / API | 補跑失敗的 chunk（讀 audit_archive_state.last_status='failed'）|
| `admin-job: audit-archive-export` | 手動 / API | 讀 R2，組合月份檔回 admin |

**Cron 分散原因**：archive 是大量 R2 PUT（量大但 CPU 輕），aggregate 是 D1 重 query（CPU 重），分開避開單個 Worker invocation 的 CPU/time 上限。

## Implementation phases（拆 4 個 PR）

### PR 0（前置）— Neuter 舊路徑 + R2 bucket + versioning + IAM

**Step 0.1（必先做，commit 後再動 binding）— 拆掉 cleanup.js 既有 destructive archive 路徑（codex H-1）**
- `functions/api/admin/cron/cleanup.js`：
  - 移除 `audit_log_archive` special branch 內部邏輯（`archiveAndDeleteAuditLog` 改為 no-op + 註明「Phase 2 archive worker 接手」）
  - audit_log task 改成 `{ name: 'audit_log', noop: true, note: 'phase2-pending' }` 或直接從 TASKS 陣列移除
  - 整個函式體刪掉，避免 future 誤啟用
- 不刪掉 D1 binding（cleanup.js 其他 task 仍要用）
- 落 prod 確認 cron 不再呼舊路徑

**Step 0.2 — R2 bucket + IAM**
- 建 prod / preview 兩個 bucket（`chiyigo-audit-archive` / `chiyigo-audit-archive-preview`）
- 開 versioning，retention lock（若 R2 支援）
- 建立最小權限 archive token（PUT/GET only，不給 DELETE）
- **驗** Step 0.1 已 deployed prod 後，才設 `AUDIT_ARCHIVE_BUCKET` env binding（順序顛倒會立即觸發舊路徑）
- 不寫 code，純 ops

### PR 1 — Schema + retention metadata
- 加 `audit_log.archived_at` 欄（**不**加 `admin_audit_log.archived_at`，v3 user decision）
- 新建 `audit_archive_chunks` 表（per-chunk 狀態，codex M-3）
- 新建 `audit_log_aggregate_telemetry` + `audit_log_aggregate_debug` 表（M-5）
- 不動現有寫入路徑

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

## Codex review 重點（請特別看緊）

1. **R2 versioning fallback 是否守得住** — 沒有 retention lock 時，最小權限 token + runtime 禁 DELETE + break-glass 三層是否足夠抵 prod 操作意外？
2. **Manifest 狀態機對中斷的覆蓋** — `planned/uploaded/verified/purged` 四態是否足夠？是否有 partial 狀態漏寫？
3. **可重入 DELETE 的真正 atomicity** — `archived_at IS NULL` 條件 + chunk_sha256 idempotent key + manifest state，這三層在 D1 / R2 / Worker invocation 中斷時的行為是否真的 fail-safe？
4. **R2 寫成功但 audit event 沒寫進 D1** — 例如 R2 PUT ok 但 D1 寫 audit.archive.chunk_uploaded 失敗，下輪如何辨識「實際 R2 已 ok」？manifest state 是否能 cover？
5. **跨 chunk hash chain 驗證對 admin_audit_log** — 上 chunk 已歸檔但 last_row_hash 沒被驗就刪 D1 了，下個月新 chunk prev_hash_of_first_row 還能對得上嗎？
6. **chunk_sha256 嵌 key 的衝突風險** — sha256 全域唯一夠強，但 key 含 `min_id-max_id-sha256` 三段，min_id+max_id 範圍有沒有可能跨 retention 邊界重疊？

## 下一步

- codex 審完 → 更新前提後動工 PR 1（schema migration：`archived_at` 欄、`audit_log_aggregate` 表、`audit_archive_state` 表）
- PR 1 落 prod 7 天無回歸 → PR 2 dry-run archive worker
- PR 2 dry-run 1 個月觀察 R2 寫入正確性、體積、效能 → PR 3 aggregate worker
- PR 3 ok → PR 4 移除 DRY_RUN flag，啟動真刪除
