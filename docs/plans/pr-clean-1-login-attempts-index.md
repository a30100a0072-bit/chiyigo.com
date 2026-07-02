# PR-CLEAN-1 — login_attempts(created_at) cleanup index（migration 0056）

**狀態**：SHIPPED（squash-merge to main）｜**gate-log 永久記錄**（governance artifact，FTH-CLEAN-1；非 repair diff）
**base**：`4d9907f2`｜**repair commits**：`40dfc295`（migration）+ `c5892b11`（migration coverage registry）
**性質**：單一 additive D1 index migration + 其 coverage-registry registration。migration-only、functions/ application source diff = 0。

> **完成宣稱（FTH-CLEAN-3，措辭鎖定）**：本 PR 僅消除 **`login_attempts` cleanup DELETE 的 full table scan**（prod apply 後以 EXPLAIN 驗收）。**不**宣稱「cron 524 已修」（那次 524 為 transient CF/D1 stall、非 scan 造成）或「cleanup 全部 full-scan 已解」（`refresh_tokens`/`email_verifications` 仍為 SCAN、另案）。

---

## 1. 起源
daily cron `Cron — D1 Cleanup`（run `28571005124`）一次性 HTTP 524（CF edge timeout）。唯讀調查：`functions/api/admin/cron/cleanup.ts` 18 條序列 DELETE；prod `EXPLAIN QUERY PLAN` 坐實 `login_attempts`（+`refresh_tokens`/`email_verifications`）cleanup DELETE 走全表 `SCAN`。prod row count login_attempts=974 / refresh_tokens=4 → 現 scan 無害、524 判定為 transient（非 scan-caused）；index 為 **preventive hygiene**（未來累積成長才有實益）。

## 2. Scope（SPEC → SPEC-DELTA → CLEAN-R1e）
- SPEC-DELTA：只做 **`login_attempts(created_at)`** index；`refresh_tokens` 移 PR-CLEAN-2、`email_verifications` defer。
- **CLEAN-R1e（③ Code r1 REJECT 後 owner amendment）**：repo `lint:migrations`（`scripts/lint-migrations-coverage.mjs`、chained in `build`）強制每 migration 註冊進 `tests/integration/migrations.test.ts`；原「2 migration 檔、no test」locks 與此硬要求衝突 → owner 裁 registry registration 為 allowed required-companion（嚴格限 import+ALL_UPS+coverage-range 文字+index spot-check；禁其他 test 邏輯/assertion 語義/behavior）。repair scope＝2 migration + migrations.test.ts registration。

## 3. Migration（0056、additive）
up `migrations/0056_login_attempts_created_at_index.sql`（唯一 DDL）：
```sql
CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at ON login_attempts(created_at);
```
down `migrations/down/0056_login_attempts_created_at_index.down.sql`：
```sql
DROP INDEX IF EXISTS idx_login_attempts_created_at;
```
- naming SSOT：先例 `idx_audit_log_created_at`（`migrations/0017_audit_log.sql:42`）。idempotent、up/down 互逆。
- registry：`migrations.test.ts` 加 `import up0056` + `ALL_UPS` + 5× `0001..0055`→`0001..0056` + full-forward index spot-check `idx_login_attempts_created_at`（down0056 刻意不 import＝會 unused；rule A 只計 up）。

## 4. 證據
- **prod baseline（read-only）**：cleanup DELETE `WHERE created_at < datetime('now','-90 days')` → `SCAN login_attempts`（既有複合索引皆 leading ip/email/kind、非 created_at）。
- **scratch D1（node:sqlite 3.51.2、0002+0011 exact schema）**：加 index → `SEARCH login_attempts USING INDEX idx_login_attempts_created_at (created_at<?)`；up/down round-trip + idempotency ALL PASS（最終 index 名）。
- **prod 完成閘（post-apply、未做）**：手動 apply 後 prod `EXPLAIN` 須見 `SEARCH … idx_login_attempts_created_at (created_at<?)`（ARCH-CLEAN-3 / CLEAN-L8）。
- **refresh_tokens scout（→ PR-CLEAN-2）**：`revoked_at IS NOT NULL OR expires_at<…` 4 種 index 設計（plain/partial×2/composite）皆 SCAN（SQLite OR-union 需兩 term 皆 seekable、`IS NOT NULL` 非）→ index-only 不可解、需 handler-split（另 SPEC）。

## 5. 本地機械 gate（全綠、實跑）
lint:migrations OK（N=0056、4 rules）· lint 0 · lint:handlers/archive-no-delete 0 · typecheck:ratchet `530`（不變）· build:functions 0 · test:cov 90.28%（1933/2141）· test:int 75 files/1328 tests · npm audit 0 · up/down round-trip PASS。

## 6. Dual Gate v3.1 — 4 道外部審查
- **① ChatGPT Arch** `APPROVED_WITH_LOCKS`：0 blocking / 0 required / ARCH-CLEAN-1..5。DB/migration 契約、naming SSOT、expand-only、scope、誠實框架、refresh_tokens 移出 全 PASS。
- **② Codex Plan** `APPROVED`：scratch scout replay（SCAN→SEARCH on created_at）、最終 index 名 in-memory round-trip、0056 numbering、cleanup.ts:45 對齊、deploy 無 auto-migrate、refresh_tokens 4-design SCAN 支持 deferral。
- **③ Codex Code** `r1 REJECTED`（blocking：`lint:migrations` fail、0056 未註冊）→ **owner `CLEAN-R1e` amendment** → fix `c5892b11` → **r2 `CODEX_CODE_APPROVED`**（lint:migrations PASS 親驗、migration byte-identical、functions/ source diff 0、test:int full-forward 覆蓋 0056）。
- **④ ChatGPT Faithfulness** `APPROVED_WITH_LOCKS`：0 blocking / 0 credible Tier0-1 / faithfulness matrix 全 Faithful / CLEAN-R1e 裁定正當（owner-ratified、repo 硬要求、非未授權 creep）/ FTH-CLEAN-1..3。

**維度 A self-review**：PLAN（2 readonly-reviewer：scope-faithfulness / migration+evidence）+ CODE r1（2：diff-fidelity+scope / migration-correctness）+ CODE r2 re-review（2：full-diff scope / registry correctness）— 各輪全 CLEAN 0；主線親裁非採 raw。

## 7. Locks 全集
SPEC：CLEAN-L1..L8 / CLEAN-R1..R8 / **CLEAN-R1a..R1e**（R1e＝registry required-companion）。
Arch：ARCH-CLEAN-1（functions/ source diff=0、repair＝migration + R1e registry）· L2（gate-log doc 只記軌跡）· L3（prod 驗收用最終名看 SEARCH）· L4（無 overclaim）· L5（無 refresh_tokens/email/handler/workflow-retry/db.batch）。
Faithfulness：FTH-CLEAN-1（name-status 3 repair + gate-log 另列 governance）· FTH-CLEAN-2（migrations.test.ts 後續不得超 R1e）· FTH-CLEAN-3（措辭：只「login_attempts cleanup full scan 已由 index 消除、prod apply 後 EXPLAIN 驗收」，禁「524 已修 / cleanup 全解」）。

## 8. 完成定義（兩段授權）
- **授權 1＝`MERGE_ALLOWED`**（本 PR：code + merge-front gates + squash-merge）。
- **授權 2（獨立、prod schema mutation）＝prod D1 apply**：merge 後手動 `wrangler d1 execute chiyigo_db --remote --file migrations/0056_login_attempts_created_at_index.sql` + **prod `EXPLAIN QUERY PLAN` 驗 `SEARCH … idx_login_attempts_created_at (created_at<?)`**。**未做前，本 PR 為「code landed、prod schema 未生效」**。

## 9. 教訓
- **merge-front gate checklist 缺口（r1 根因）**：原只跑 `build:functions`，漏 `build`（chains `lint:migrations`/`lint:handlers`/`lint:archive-no-delete`）→ 未抓到 0056 未註冊。修正：加 migration 的 PR 必跑完整 `build` + 知悉「加 migration＝必註冊進 `migrations.test.ts` coverage registry」。補 [[feedback_pre_merge_gate_checklist_match_ci]]。
- **Plan-phase scout 應含「加 X 在本 repo 實際需要什麼」**（registry/coverage-gate），不只 numbering/round-trip/deploy。
- **scope reduction（refresh_tokens 移出）非 creep**；**required-companion（registry）非 creep**——皆 owner-ratified delta。

## 10. 後續
- **PR-CLEAN-2**：`refresh_tokens` cleanup OR-DELETE handler-split（拆兩條 indexed DELETE）+ index；需自己的 SPEC（觸 cron handler SQL 語義）。審重點：兩條 DELETE 等價原 OR、重複刪除順序安全、`revoked_at IS NOT NULL` 是否值得 partial index、delete count / error handling 不變。
- **email_verifications** SCAN（OR `used_at IS NOT NULL` 低選擇性）：更後案、需重構評估。
