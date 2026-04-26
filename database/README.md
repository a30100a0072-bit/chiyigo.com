# database/

**Schema 真相來源（Source of Truth）的優先序：**

1. **`migrations/` 目錄**（根目錄外的 sibling）— 漸進式變更的權威紀錄。新環境部署順序執行 0001 → 0002 → ... 即可重建。
2. **生產 D1 實際結構** — 用 `wrangler d1 execute chiyigo_db --remote --command "SELECT sql FROM sqlite_master"` 驗證。
3. **本目錄 `*.sql`** — **僅作為人類可讀快照（reference）**，不可直接執行於空白資料庫，因為不含 ALTER 路徑且可能落後於 migrations。

## 檔案說明

| 檔案 | 用途 |
| --- | --- |
| `schema_auth.sql` | IAM 全表快照（users / local_accounts / user_identities / refresh_tokens / email_verifications / oauth_states 等）。已同步至 prod 結構。 |
| `schema_iam_fresh.sql` | 含 PKCE / auth_codes 等遊戲端 OAuth 額外表的全量快照。 |
| `schema_email.sql` | 早期 email 系統 schema（部分內容已被合併至 `schema_auth.sql` 的 `email_verifications`）。 |
| `migration_001_requisition_contact.sql` | 早期手動 ALTER（已併入 `migrations/0001_*`）。 |

## 加新表 / 新欄位流程

1. 在 `migrations/000X_<purpose>.sql` 新增 idempotent migration（用 `IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`）。
2. 用 `wrangler d1 execute chiyigo_db --remote --file=migrations/000X_*.sql` 套用 prod。
3. 同步更新 `schema_auth.sql` / `schema_iam_fresh.sql` 對應表定義。
4. 在 PR / commit message 註記 migration 已套用。

## 為何不直接刪除 `database/*.sql`？

- 對新進開發者最快建立心智模型 — 一份「現在長什麼樣」的全貌 SQL 比讀 0001~000N migrations 直覺。
- 災難恢復時若 prod 全毀，需要一份能直接 `wrangler d1 execute --file=schema_xxx.sql` 重建的全量 SQL。

**注意**：根目錄原有的 `schema.sql` 已於 2026-04-26 移除，因內容嚴重落後且無人引用。
