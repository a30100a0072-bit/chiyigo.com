# EVT-001 + EVT-002 修補 Plan：consumer 觀測補強 + 錯誤處理對齊（consumer-hardening）

> Gate State: **PLAN_DRAFT**（自審後 → 送 Codex Plan Gate）
> 來源 finding：`docs/audit/03-event-consistency.md` §2 EVT-001（P2）+ EVT-002（P2）。owner 裁決（2026-06-12）：兩條併一顆 PR（同檔 `event-outbox.ts`）。
> Dual Gate Workflow：本 plan 過 Codex Plan Gate 才進 Code。報告語言繁中；code identifier 保留原文。

---

## 1. 問題（已驗證，03 報告 §2）

**EVT-001**：`functions/api/admin/cron/event-outbox.ts:94-95` claim 連續性以 `status <> 'done'` 阻塞——`'dead'` 列永久擋住同 streamKey 後續 seq（INV-EVT-3 刻意設計，正確性無錯）。觀測缺口：首筆 DLQ critical audit 之後，被阻塞的 pending 列每輪 run **零訊號**（`:203-208` consumer_run 只報本 run counts）；`admin/metrics.ts` 無 event_* 指標；**無 DLQ list 端點**（admin 要 replay 須裸查 D1 撈 dlq id）。

**EVT-002**：`deliver()` 的 prior-read（`:146`）與 noop mark-done（`:154`）落在 failTransition 保護外——transient fault 拋到外層 per-row catch（`:199-201`），列留 orphaned processing、無 backoff，只能等 lease(120s) 過期 reclaim 再 attempts+1；同等故障走 failTransition 路徑要 ~38h 耗盡 6 attempts，走 orphan 路徑 ~30min 就被 STEP A sweep 誤標 `max_attempts` DLQ——**apply 從未被嘗試**，且誤 DLQ 的 dead 列接著觸發 EVT-001 的 HOL 阻塞。

---

## 2. 修法

### 2.1 EVT-002：統一 transient-fault 路徑（最小重構）

`deliver()` 把 reconstruct 之後的整段（prior-read → decision → gap/noop/apply）納入單一 try/catch，catch 統一走 `failTransition`（與 apply 既有 catch 同款）：

```ts
// reconstruct + validate（既有 :136-144 不動：validation_failed → dlqTransition）
try {
  const prior = …(:146)
  const decision = projectionDecision(…)
  if (decision.kind === 'gap')  { await dlqTransition(…'gap_detected'…); return }
  if (decision.kind === 'noop') { …(:153-157 既有 noop 邏輯)…; return }
  …(:161-174 既有 apply batch + 判定)…
} catch (e) {
  await failTransition(db, env, row, runToken, max, backoff, String(…), report)
}
```

- 行為變化**僅限**「prior-read / noop 的 transient fault 從『orphan + 無 backoff』變成『failTransition：retry + backoff、到 max 才 DLQ』」——與 apply 路徑完全對齊。
- `dlqTransition`（gap / validation）的 return 在 try 內不受影響；其自身 DB 寫入若 transient throw → 落入 catch → failTransition retry（正確語意：DLQ 寫入失敗本來就該重試）。
- **不改** attempts 的 claim-time 計數語意（`event-outbox-consumer.test.ts:171` 已鎖）；**不加** wall-time budget（殘差：failTransition 自身 throw 仍由外層 per-row catch 收 → 留 orphan 至 lease 過期，窗口大幅縮小，文件化即可）。

### 2.2 EVT-001a：run report 增加 blocked-backlog 持續訊號

run 尾（既有 consumer_run audit 之前）加一條 read-only query：

```sql
SELECT COUNT(*) AS blocked,
       CAST((julianday('now') - julianday(MIN(o.created_at))) * 86400 AS INTEGER) AS oldest_age_s
FROM event_outbox o
WHERE o.status = 'pending'
  AND EXISTS (SELECT 1 FROM event_outbox d
               WHERE d.stream_key = o.stream_key AND d.stream_seq < o.stream_seq AND d.status = 'dead')
```

- `RunReport` + `domain.event.consumer_run` audit data **新增欄位**：`blocked_backlog`、`oldest_blocked_age_s`、`dlq_unreplayed`（`SELECT COUNT(*) FROM event_dlq WHERE replayed_at IS NULL`，一條 cheap count）。
- severity 規則：`(report.dlq > 0 || blocked_backlog > 0) ? 'warn' : 'info'`——被卡住的 stream 在**每一輪** run 都持續可見，不再只有首筆。`dlq_unreplayed` 只入 data 不觸發 severity（避免「永遠 warn 直到 replay」的告警疲勞；blocked_backlog 已涵蓋「有 stream 被卡」的行動訊號）。
- 欄位純 additive（既有欄位不動）；**severity 語意變更是功能本身**——若既有測試對「DLQ 後的後續 run」斷言 `info`，該斷言隨新語意顯式更新並列入 diff 說明（非靜默改測試）。

### 2.3 EVT-001b：`GET /api/admin/event-dlq` list 端點（新檔）

- **Gate（§5 OD-1）**：`requireRole(admin)` + effective scope `admin:events:replay`（與 replay 同 scope；**不**要求 step-up——read-only、回應全 redacted；step-up 一次性 jti 留給 mutating replay）。per-user rate limit（同 replay 的 kind 或新 kind `event_dlq_list`）。
- Query：`replayed=0`（預設只列未 replay）、cursor `before=<id>`、`LIMIT 50`。
- 回應 DTO（**INV-EVT-9 紀律**）：`id, event_id, event_type, stream_seq, tenant_id, dlq_reason, attempts, failed_at, replayed_at, stream_key_hash`（`hashToken(stream_key)`）、`last_error`（截 200 字）。**絕不回 raw stream_key / data_json**。
- audit：`domain.event.dlq_list`（info，counts only）。

---

## 3. 測試（Code 階段）

沿用 `tests/integration/event-outbox-consumer.test.ts` harness（seedOutbox / runConsumer / outbox / proj / dlqCount）。

**A. EVT-002 repro（pre-fix 紅 → fix 後綠；verifier 精修版）**
1. seed 一筆 valid pending；`vi.spyOn(db,'prepare')` 只讓 `SELECT last_applied_seq…` prior-read throw（**不** mock `db.batch`）。
2. pre-fix：run → 列留 `processing`、`attempts=1`、`report.retried===0`、errors=1；SQL backdate lease（`:109` PAST 手法；注意 `LEASE_SECONDS='0'` 被 posInt fallback 成 120，不可用）重複至 attempts≥max → sweep 誤標 `max_attempts`、投影全程未動（紅的形狀）。
3. post-fix：同故障 → `report.retried===1`、列回 `pending` + `next_attempt_at` 有 backoff、attempts 語意不變；restore mock 後 run → 正常 delivered，`dlqCount('max_attempts')===0`。

**B. EVT-001 repro（訊號欄位；pre-fix expected-fail 形狀）**
1. seed poison seq1（缺 required 欄 → validation_failed）+ 合法 seq2 → run：`dlq===1`、seq1 dead。
2. 再 run：assert `report.blocked_backlog === 1` 且 `oldest_blocked_age_s >= 0` 且 consumer_run severity='warn'（pre-fix 無此欄＝紅）；seq2 仍 pending（HOL 既有行為不變）。
3. replay seq1 對應 dlq id 後 run ×2 → blocked_backlog 歸 0（poison 案例則維持 >0——用可修復的 max_attempts 案例做歸零驗證）。

**C. DLQ list 端點**
- admin + scope → 200，列出未 replay 列，欄位齊 + `stream_key_hash` 存在 + **無** `stream_key`/`data_json` 字樣（regression grep 斷言）；非 admin / 缺 scope → 403；cursor 分頁正確。

**D. regression**：既有 event-outbox-consumer / event-dlq-replay 全綠（severity 與 report 欄位 additive，不動既有斷言對象）。

---

## 4. 變更檔案

| 檔 | 變更 |
|---|---|
| `functions/api/admin/cron/event-outbox.ts` | §2.1 deliver try/catch 重構 + §2.2 report/audit 欄位 |
| `functions/api/admin/event-dlq/index.ts`（新） | §2.3 list 端點 |
| `tests/integration/event-outbox-consumer.test.ts`（追加）+ `event-dlq-list.test.ts`（新） | §3 |

無 migration、無 schema、無新套件、無契約變更。

## 5. Open Decisions

- **OD-1（Codex 可裁）**：list 端點 gate＝`requireRole(admin)+scope`（推薦，read-only+redacted）vs 比照 replay 全雙閘（step-up 一次性 jti 對 list 操作 UX 不可用——每次列表都要重新 step-up）。
- **OD-2（顯式 non-goal）**：poison skip / cursor-advance 工具與 quarantine runbook＝EVT-004（P3，STAGE8 backlog），不入本 PR。

## 6. Acceptance Criteria

typecheck / lint / build:functions / 相關 tests 全綠、ratchet 零新增；§3-A/B repro pre-fix 紅 post-fix 綠；severity additive 不破既有斷言；list 端點 INV-EVT-9 redaction 經 grep 斷言鎖定。
