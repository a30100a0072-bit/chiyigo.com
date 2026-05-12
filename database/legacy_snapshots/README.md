# database/legacy_snapshots/

⚠️ **ARCHIVED — DO NOT TREAT AS SOURCE OF TRUTH.**

這目錄收的是 2026-05-12 schema baseline 重整前的歷史快照與一次性腳本。
**新的 truth = `migrations/_base.sql` + `migrations/0001..NNNN`**。

## 為何留著

- 對 prod schema drift / 歷史考古有用（這些是當時 fresh-rebuild 或手動 bootstrap 用過的形）
- `scripts/dump-remote-schema.mjs` 預設輸出仍寫到本目錄（archival use）
- 災難恢復時若需要看「2026 年中 prod 長什麼樣」，這裡有版本參考

## 為何不能再被「當 truth」

- `schema_iam_fresh.sql` / `schema_iam_prod.sql` 都有「混 numbered migration 之後欄位」的問題（token_version / public_sub / owner_* / scope / nonce 等），fresh D1 跑它再跑 0001..NNNN 會 duplicate column fail
- `schema_auth.sql` / `schema_email.sql` 是更早期的部分快照
- `backfill_d1_ledger_2026_05_07.sql` 是 d1_migrations ledger 一次性 backfill，已完工

## 改 schema 要做什麼

走 `migrations/00NN_*.sql` 新檔 + 對應 down，不要回頭改本目錄任何檔。
