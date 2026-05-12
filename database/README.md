# database/

## Schema 真相來源（Source of Truth）

**唯一 truth = `migrations/_base.sql` + `migrations/0001..NNNN`**

- `_base.sql` = post-fresh-rebuild baseline（2026-05-12 重整後定型）
- `0001..NNNN` = 增量變更 ledger
- fresh D1 跑 `wrangler d1 migrations apply chiyigo_db [--remote]` 即可重建

驗證 prod 真實狀態：

```sh
npx wrangler d1 execute chiyigo_db --remote --command "SELECT sql FROM sqlite_master ORDER BY type, name"
# 或快照：
npx wrangler d1 export chiyigo_db --remote --no-data --output=database/_prod_snapshot_<date>.sql
```

## 本目錄檔案

| 檔案 | 用途 |
| --- | --- |
| `_prod_snapshot_2026_05_12.sql` | 2026-05-12 prod schema 快照（dry，無 data），baseline 重整的對齊 reference |
| `migration_001_requisition_contact.sql` | ⚠️ DEPRECATED — pre-numbered 一次性 RENAME 腳本，結果已併入 `_base.sql`；檔案保留作 archaeology |
| `legacy_snapshots/` | 2026-05-12 重整前的舊 schema 快照（schema_iam_fresh / schema_iam_prod / schema_auth / schema_email 等）；archival use only |

## 加新表 / 新欄位流程

1. 在 `migrations/00NN_<purpose>.sql` 新增 idempotent migration（用 `IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`）
2. 對應寫 `migrations/down/00NN_*.down.sql`
3. local：`npx wrangler d1 migrations apply chiyigo_db`（無 `--remote`）
4. tests：跑 `tests/integration/migrations.test.js` 確認 smoke
5. prod：`npx wrangler d1 migrations apply chiyigo_db --remote`
6. **不要**回頭改 `_base.sql` 或 `legacy_snapshots/` 任何檔案
