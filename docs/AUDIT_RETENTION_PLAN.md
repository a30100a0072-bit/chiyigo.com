# Audit Retention Plan — F-3 Phase 2

> Status: draft for codex review · 2026-05-10
> Phase 1 done (commit 97e1a72): event registry + warn-on-missing
> Phase 2 scope: retention policy, aggregate rules, D1 → R2 archive flow

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

## Aggregate 規則

只 `telemetry` / `debug_failure` 兩類可 aggregate。

**Bucket 鍵**
```
(event_type, user_id_or_null, severity, hour_bucket)  -- 1 hour 起跳
```

**保留欄位（aggregate row）**
- `event_type, severity, user_id, ip_hash` (取 bucket 內第一筆)
- `bucket_start, bucket_end`
- `count`
- `sample_event_data` (bucket 內第一筆原始 event_data，方便 reproduce)
- `last_event_data` (bucket 內最後一筆，看 anomaly)

**Aggregate 觸發點**
- hot retention 過期前 **24h** 跑 aggregate 任務：把超過 90/30 天的 telemetry/debug_failure rows 合併寫入 `audit_log_aggregate` 表（保留 90/30 天 hot），原始 row 刪除。
- aggregate row 進 R2 時走獨立 manifest，不混 raw event archive。

**Sampling（debug_failure 限定）**
- 若同 bucket count > 1000，aggregate 後保留 100 筆 sample_event_data 陣列代表性樣本（first 50 + last 50）。
- 超過 1000 的 bucket 在 archive manifest 標 `sampled=true`。

## Archive Flow（D1 → R2）

### 命名 / 切片

```
chiyigo-audit-archive/
  audit_log/
    YYYY/MM/
      audit_log__YYYY-MM__chunk-NNN.jsonl.zst   # raw events
      audit_log__YYYY-MM__chunk-NNN.manifest.json
      audit_log__YYYY-MM.manifest.json           # 月份級總 manifest
  audit_log_aggregate/
    YYYY/MM/
      audit_log_aggregate__YYYY-MM__chunk-NNN.jsonl.zst
      ...
  admin_audit_log/
    YYYY/MM/
      admin_audit_log__YYYY-MM__chunk-NNN.jsonl.zst
      admin_audit_log__YYYY-MM__chunk-NNN.manifest.json   # 含 hash chain head/tail
      ...
```

**Chunk 大小**：每 chunk 上限 10,000 rows 或 5MB compressed（先到先切）。

### Manifest 結構（chunk-level）

```json
{
  "schema_version": "1.0",
  "table": "audit_log",
  "chunk_id": "audit_log__2026-04__chunk-003",
  "row_count": 9874,
  "min_id": 1234567,
  "max_id": 1244440,
  "min_ts": "2026-04-01T00:00:00Z",
  "max_ts": "2026-04-30T23:59:59Z",
  "sha256_jsonl": "<sha256 of decompressed jsonl>",
  "sha256_zst": "<sha256 of compressed file>",
  "row_count_verified": true,
  "compression": "zstd-19",
  "categories": { "immutable": 1234, "security_signal": 5678, ... },
  "severities": { "info": 1000, "warn": 7000, "critical": 1874 },
  "created_at": "2026-05-15T03:00:00Z",
  "writer": "cron-archive-worker",
  "writer_version": "1.0.0"
}
```

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

### 寫入流程（fail-safe）

```
1. SELECT batch from D1 (id range, ORDER BY id)
2. Build JSONL → compress → SHA-256 (decompressed + compressed)
3. Upload chunk + chunk-manifest to R2
4. R2 GET back chunk → verify SHA-256 + row count
5. 若驗證 ok：
     - INSERT audit_log audit.archive.chunk_uploaded（含 chunk_id, sha256, row_count）
     - DELETE FROM D1 WHERE id BETWEEN min_id AND max_id
     - INSERT audit_log audit.archive.d1_purged（含 chunk_id, deleted_count）
6. 若驗證失敗：
     - INSERT audit_log audit.archive.verification_failed（critical）
     - 不刪 D1，下一輪 cron 重試
7. 月底 chunk 全寫完後：
     - 計算月份 manifest，upload R2
     - INSERT audit_log audit.archive.month_completed
```

**為什麼先寫 R2 再刪 D1**：D1 是 source of truth；R2 寫失敗下一輪 retry，最壞情況 hot retention 多保幾天，不會丟資料。反過來會丟。

### 失敗模式 / 邊界

| 失敗模式 | 處置 |
|---|---|
| R2 PUT timeout/network error | retry 3 次（exponential backoff），仍失敗則寫 `audit.archive.upload_failed`（warn）；下一輪 cron 重跑 |
| R2 GET 驗證雜湊不符 | 寫 `audit.archive.verification_failed`（critical）+ Discord webhook；不刪 D1；標記 chunk_id 黑名單，require admin job 介入 |
| D1 DELETE 部分成功 | DELETE 用 `WHERE id BETWEEN ... AND revoked_at_or_archived_marker IS NULL`，partial 失敗不會留 orphan；但若中斷在 DELETE 中，下一輪會 SELECT 到已 archive 的 row → 用 `archived_at` 欄位避免重複歸檔 |
| Cron 中斷（Workers CPU limit） | 每 chunk 是 atomic（R2 寫成功 + D1 delete 是兩步驟，但中間有 audit event 標記）。下一輪能從 `audit.archive.chunk_uploaded` 最後成功 chunk 的 max_id+1 接續 |
| Admin 想看冷存 | `/api/admin/audit/export?month=2026-04` 從 R2 拉 chunk + verify hash 後組合，寫 `admin.audit.archive.read` 進 hot audit |

### Schema 變更

新增欄位 / 表：
- `audit_log.archived_at TEXT`  — 標記已歸檔但尚未刪除（debug 視窗，archive 完寫入後再 DELETE 時填）
- `audit_log_aggregate` 新表 — 結構同 retention matrix「保留欄位」段
- `admin_audit_log.archived_at TEXT` — 同上
- `audit_archive_state` 新表 — 記錄 archive cron 進度
  ```sql
  CREATE TABLE audit_archive_state (
    table_name TEXT PRIMARY KEY,
    last_archived_id INTEGER NOT NULL,
    last_archived_ts TEXT NOT NULL,
    last_run_at TEXT NOT NULL,
    last_status TEXT NOT NULL CHECK(last_status IN ('ok','partial','failed'))
  );
  ```

## 新增 audit events（要進 audit-policy registry）

全部歸 `immutable`（archive 操作本身要永留）：
- `audit.archive.chunk_uploaded`
- `audit.archive.d1_purged`
- `audit.archive.verification_failed` （critical severity）
- `audit.archive.upload_failed`
- `audit.archive.month_completed`
- `audit.archive.aggregate_completed`
- `admin.audit.archive.read` （admin export 觸發）

## Hash chain 策略

### `admin_audit_log`：嚴格逐列鏈（既有設計沿用）
- `prev_hash / row_hash` 已在 schema（migration 0012）
- archive 時 manifest 必須記錄該 chunk 的 `head_row_hash` / `tail_row_hash`，確保跨 chunk 仍可串
- admin export 時驗整條鏈

### `audit_log`：chunk-level hash（Phase 2 推薦）
- 每 chunk JSONL 算 SHA-256 進 manifest
- 月份 manifest 算 chunks 陣列的 SHA-256
- **不**逐列鏈（成本/收益不划算；audit_log 寫入頻率高，逐列 hash chain 會在 hot path 增加 overhead）
- 若未來監管要求逐列鏈，再走 Phase 3 升級

## Cron / Job 拆分

| Job | 觸發 | 目的 |
|---|---|---|
| `cron-archive-worker` | 每日 03:00 UTC（亞洲低峰）| 找 hot retention 過期的 row → 寫 R2 chunks → DELETE D1 |
| `cron-aggregate-worker` | 每週日 02:00 UTC | telemetry / debug_failure aggregate（先合併再讓 archive worker 接手）|
| `cron-month-finalize-worker` | 每月 1 號 04:00 UTC | 上月所有 chunk 完成後寫月份 manifest |
| `admin-job: audit-archive-retry` | 手動 / API | 補跑失敗的 chunk（讀 audit_archive_state.last_status='failed'）|
| `admin-job: audit-archive-export` | 手動 / API | 讀 R2，組合月份檔回 admin |

**Cron 分散原因**：archive 是大量 R2 PUT（量大但 CPU 輕），aggregate 是 D1 重 query（CPU 重），分開避開單個 Worker invocation 的 CPU/time 上限。

## Implementation phases（拆 4 個 PR）

### PR 1 — Schema + retention metadata
- 加 `archived_at` 欄、`audit_log_aggregate` 表、`audit_archive_state` 表
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

## Open questions（請 codex 評估）

1. **R2 versioning + immutable lock**：要不要對 archive bucket 開 versioning + 1 年 retention lock，避免 admin 不小心 DELETE？金融級可能要求 immutable。
2. **chunk size 上限 5MB / 10k rows**：太小會浪費 PUT request 次數（R2 Class A 0.0036 USD/1000）；太大會 retry 成本高。要不要實測決定？
3. **admin_audit_log hash chain 跨 chunk**：每 chunk 開頭 prev_hash 必須 = 上 chunk 結尾 row_hash。當前 schema 沒記 chunk 邊界，archive 邏輯要能自動偵測 chain 斷點還是依 id 連續？
4. **R2 binding 命名**：建議 `AUDIT_ARCHIVE` env binding，prod / preview 分 bucket（`chiyigo-audit-archive` / `chiyigo-audit-archive-preview`）。
5. **failed chunk 重試上限**：3 次連續失敗後是否 fall through 到 PagerDuty/Discord critical？目前 webhook 是 `DISCORD_AUDIT_WEBHOOK`，可不可以重用？
6. **archive timing**：03:00 UTC = 11:00 Asia/Taipei，是否衝到台灣早班用戶？要不要改 18:00 UTC（凌晨 02:00 Asia/Taipei）？
7. **debug_failure sampling 邊界**：bucket > 1000 留 100 筆樣本，這個門檻要不要 per-event_type 客製（例如 `payment.refund.network_error` 樣本要更多）？

## 下一步

- codex 審完 → 更新前提後動工 PR 1（schema migration）
- PR 1 落 prod 7 天無回歸 → PR 2 dry-run
- PR 2 dry-run 1 個月觀察體積/效能 → PR 3 / PR 4
