# chiyigo.com 系統級安全審計 — P0 起手：不變量 + Threat Model SSOT

> **文件定位**：這是 2026-06-12～06-22 Fable 5 系統級審計的**地基文件**。
> 用途有三：(1) 校準 Gate 驗證「Claude 對 codebase 的基礎心智模型是否正確」的對照基準；
> (2) 四個領域 workflow finder 的共同不變量清單與獵捕目標；(3) Stage 8+ backlog 的歸類框架。
> **本文件不含 findings**，只含「必須恆真的事」與「該往哪裡找違反者」。
>
> 報告語言繁體中文；code identifier / 欄位名 / 路徑保留原文。

---

## 0. 為什麼這樣審（策略前提）

**關鍵情報：這個 codebase 的 Tier-0 核心已被 Codex 多輪深審**（webhook handler r1–r8、outbox consumer 5a-spike + Gate、tenant-context Gate-1 r1→r3、requireRole Codex #6/r2–r7）。inline 註解完整追溯每條 finding。

因此本次審計**刻意不重跑已被審過的單檔邏輯**，槓桿集中在四類 Fable 5 才划算的目標：

1. **跨 PR / 跨模組的系統級不變量** —— 每個 PR 各自正確，組合起來是否仍正確？
   （例：refund → credit wallet → event outbox → deny-state 這條鏈端到端一致嗎？）
2. **模組之間的接縫（seam）** —— A 模組假設、B 模組保證，假設與保證之間的縫。
   （例：deny-state projection 把 `denied` bit 物化了，但 chiyigo-side auth **真的讀它來擋人**嗎，還是只記不擋？）
3. **較新、審查深度較淺的程式碼** —— B2B 多租戶（PR1–5）、credit/billing、tenants/* 端點群。
4. **一致性整面覆蓋** —— 不是抽查某個 endpoint 有沒有 tenant gate，而是**列舉全部** tenant-scoped 端點逐一驗證 gate 是否齊備（這正是單檔 review 會漏的）。

**finder 紀律**：若一條候選 finding 的修法已在該檔 inline 註解（`Codex rN PX-Y`）中明載為已處理，**不重列**，除非能證明該修法在某個組合情境下失效。

---

## 1. 審計範圍與分工（4+1 領域）

| 領域 | Tier-0 對應 | 主要面 | 產出 |
|---|---|---|---|
| 金流 Payments | 正確性 | `utils/payments.ts`、`payment-vendors/*`、`webhooks/payments/[vendor].ts`、`payments/intents/[id]/refund*.ts`、`requisition-refund/*`、`webhook-dlq.ts`、`billing/grant.ts`、`credit.ts` | `01-payments.md` |
| 多租戶隔離 Isolation | 隔離 | `utils/tenant-context.ts`、`requireRole.ts`、`scopes.ts`、`members.ts`、`api/tenants/[tenantId]/**`、`billing/**` | `02-isolation.md` |
| 事件一致性 + DLQ | 正確性 | `domain-events.ts`、`domain-event-emit.ts`、`cron/event-outbox.ts`、`event-dlq/[id]/replay.ts`、`deny-state-projection.ts`、`session-revoke.ts`、`users/[id]/{ban,unban}.ts` | `03-event-consistency.md` |
| 安全邊界 Security | 安全 | 4 個 `_middleware.ts`、`auth.ts`、`jwt.ts`、`revocation.ts`、`brute-force.ts`、`step-up.ts`、refresh token 系列、OAuth/OIDC surface、`webauthn.ts`、`turnstile.ts` | `04-security-boundary.md` |
| 整合 Integration | 全部 | 跨領域鏈、雙 role 軸交互、completeness critic | `05-integration.md` |

最終彙整 → `STAGE8-BACKLOG.md`（按 P0→P3 排序的待辦）。

**深度權重**：金流與隔離最高（Tier-0 最重 + B2B 未來），各排 2 個工作段；事件與安全邊界各 1.5 段。

---

## 2. 共用 infra 心智模型（← 校準 Gate 驗這一節）

> 這節是我從讀碼建立的系統理解。校準 Gate 的唯一任務就是讓 Codex/GPT 確認**這節沒讀錯**——
> 因為若這節錯了，下面所有 finding 都會被污染。每條都標了 source 供查證。

### 2.1 Middleware chain（`functions/api/_middleware.ts` + 各子目錄 `_middleware.ts`）
- 頂層 `api/_middleware.ts`：注入 16-hex `traceId`（可由 `X-Request-Id` 繼承）、結構化 JSON log、例外攔截回 500、**POST Content-Type 必 `application/json`** 守門（豁免：`/api/auth/logout`、OAuth callback、`/api/webhooks/*`）。`tryDecodeAuthSub` 只解 JWT payload 取 `sub` **當 log 標籤，不驗章**——真實驗證在 handler 的 `requireAuth`。
- 子目錄 `_middleware.ts`（auth/admin/ai）：純 CORS（`getCorsHeaders`）+ OPTIONS→204。**注意**：CF Pages Functions 同目錄 `_middleware` 會疊加；admin 版有特別處理 `set-cookie` 多值。
- **心智模型重點**：身份/RBAC **不在 middleware 強制**，而在各 handler 顯式呼叫 `requireAuth/requireRole/requireActiveTenantRole`。→ 這代表「漏呼叫 = 裸奔」是真實風險面，**隔離與安全邊界審計必須整面列舉端點確認每個都呼叫了 gate**。

### 2.2 身份解析與 token 種類（`utils/auth.ts`）
- `requireAuth` → 驗 access token，回 `{ user, error }`；`user.sub` / `user.role`。
- `requireRegularAccessToken`（tenant-context 用）→ 拒 `pre_auth` / `temp_bind` / `elevated` 等特殊 token，只認 regular actor token。
- token 種類至少有：regular access、pre_auth（2FA 前）、temp_bind（綁定流程）、elevated（step-up 後）。**待查**：完整 token taxonomy + 各自允許的操作面（安全邊界領域深讀 `auth.ts` 補全）。

### 2.3 RBAC：兩條正交軸 ⚠️（高價值 hunt 種子）
- **全域軸 `role`**（`requireRole.ts`）：`player/user=0 < moderator=1 < admin/super_admin=2 < developer=3`；`finance/support`=0（管理權限走 `requireScope` fine-grain，不靠 hierarchy 升權）。`actorOutranksTarget` 用於 ban/unban（actor 須嚴格高於 target）。未知 role → critical audit + fail-closed 403。
- **租戶軸 `platform_role`**（`tenant-context.ts`）：`tenant_owner/tenant_admin/billing_admin/member`，**每 request 由 DB membership row live 重新推導，禁信 token claim**。`requireActiveTenantRole(request, env, tenantId, allowedRoles)` = `requireRegularAccessToken` THEN `resolveIssuanceContextForTenant`（驗 tenant active + membership active + role from DB）。
- **⚠️ 系統級 hunt**：這兩軸**正交**。整合領域必須驗：全域 `admin`/`developer` 是否在某處**隱式繞過** tenant gate（例如某 admin 端點直接用全域 role 改 tenant 資料而不過 `platform_role`）？反之 tenant_owner 是否誤拿到全域權限？兩軸混淆是隔離 Tier-0 的首要破口。

### 2.4 Event outbox → consumer → deny-state（`domain-event-emit.ts` + `cron/event-outbox.ts` + `deny-state-projection.ts`）
- **發送**：emit helper 回傳 `[seqUpsert, outboxInsert]` 兩條 statement，caller **splice 進自己的 `db.batch()`，緊接在 gating mutation 之後**。`seqUpsert` 用 `WHERE changes()=1` 確保只在 gating mutation 真的改了 row 時才分配 seq；`outboxInsert` 同樣 gated。→ **business change 與 event both-or-neither，且 0-row mutation 不發 event**。
- **streamSeq**：per-streamKey 嚴格單調，in-batch 分配。`streamKey` 由 `domain-events.ts` 的 frozen SPEC 推導（禁 caller 自填）。
- **消費**（cron，每 5 分鐘）：STEP A max-attempt sweep → STEP B claim（owner-CAS `locked_by=runToken` + 連續性 NOT EXISTS 前序未 done）→ STEP C deliver。每個 transition 帶 owner-CAS；mark-done 與 projection upsert 同 batch 且 gated（G2）；DLQ 寫入 gated（G3，重疊 run 只一筆）。
- **投影規則**（pure）：`seq <= prior` → noop；`seq > prior+1` → **gap → DLQ（不靜默跳）**；`== prior+1` → apply。`denied` bit：deny→1 / undeny→0 / soft·none→保持 prior。
- **⚠️ 最關鍵系統級 hunt（INV-EVT-10）**：`deny-state-projection` 註解說 `denied` bit 是「future RP pull source of truth」。→ **chiyigo-side 的 auth / refresh / token 驗證流程，現在是否真的讀 `event_deny_state.denied` 來即時擋掉被 suspend/offboard/ban 的人？還是 emission + projection 都做了，但 enforcement 還沒接上（記了卻不擋）？** 這條接縫若斷，所有 member.suspended/account.disabled 事件就只是 audit 噪音，達不到 Tier-0 hard-revoke。事件 + 整合領域必須回答。

### 2.5 Payment webhook 三態 apply_status（`webhooks/payments/[vendor].ts`）
- dedupe = `payment_webhook_events (vendor, event_id)` UNIQUE + `apply_status ∈ {processing, applied, failed}`。fresh INSERT changes=1 → claim；既有 `applied` → 真 dedup 回 success；既有 `failed` → CAS `failed→processing` 才 claim；既有 `processing` / CAS 落敗 → **回 PSP failure 讓 retry，不雙跑**。
- 雙閘門：**簽章 + 金額/幣別比對**（密鑰外洩也擋「拿低額 intent 偽造高額」）。amount_mismatch → critical audit + DLQ + 不更新 status + 回 success（避免 PSP retry 灌爆）。
- PSP-direct intent 建立預設**關閉**（`PSP_DIRECT_INTENT_ENABLED`），防偽造 webhook 塞任意金額成功 row。
- status 轉換走 `updatePaymentStatus` CAS，回 structured outcome（`applied/same_status/no_row/illegal_transition`）；illegal / CAS-lost → 跳過 success tail + critical audit 留證。

---

## 3. 不變量清單（四領域；finder 的驗證標的）

> 格式：`INV-<域>-<n>`。每條都是**可證偽命題**。workflow finder 的任務 = 對每條找反例（含 repro）。

### 金流 Payments
- **INV-PAY-1** 每筆 webhook `(vendor, event_id)` 恰套用一次；並發只一個 owner，其餘回 failure 重試不雙跑。
- **INV-PAY-2** webhook 金額/幣別必與原 intent 一致才更新 status；不符 → 不更新 + critical audit + DLQ。
- **INV-PAY-3** PSP-direct intent 建立需顯式 env flag；否則偽造 webhook 無法塞成功 row。
- **INV-PAY-4** status 轉換經 CAS；非法轉移（如 `failed→succeeded`）被擋並留證；CAS-lost 不靜默吞。
- **INV-PAY-5** 退款是**獨立狀態機**（`requisition_refund_request` / refund kind），不塞回 `payment.status` 混用。
- **INV-PAY-6** 前端不決定付款成功；source of truth = webhook + server query。
- **INV-PAY-7** 跨資源寫入（payment / credit wallet / event outbox / R2）不假設原子；走 `db.batch` CAS 或 outbox。
- **INV-PAY-8** 每筆金流狀態變更必 critical audit（可對帳/追溯）。
- **INV-PAY-9** idempotency / refund key 落 D1 且有明確 TTL（**待驗：是否真有 ≥7d TTL 機制，或目前靠 webhook dedupe 替代**）。
- **INV-PAY-10** `payment_intents.metadata` 寫入經 allowlist；任意鍵被丟棄。
- **獵捕重點**：refund→credit wallet 一致性（`credit_wallets`≠`user_wallets` 命名陷阱）；refund unique-pending constraint（`0034`）競態；ecpay adapter 驗章正確性；`amount_subunit/raw/currency` 跨 vendor 一致；soft-delete + webhook TOCTOU 殘留。

### 多租戶隔離 Isolation
- **INV-ISO-1** `platform_role` 一律由 DB membership live 推導，禁信 token claim（suspended/demoted actor 立即被拒，不等 ≤15min TTL）。
- **INV-ISO-2** **每個** `/api/tenants/[tenantId]/**` 端點都以 path `tenantId` 過 `requireActiveTenantRole`，fail-closed 403。
- **INV-ISO-3** personal tenant 只能由其 owner 進入（`PERSONAL_TENANT_FOREIGN`）。
- **INV-ISO-4** 所有 tenant-scoped D1 query 帶 `tenant_id` 條件，無裸 query（repository 層強制）。
- **INV-ISO-5** 一般 user 無法自升 `platform_role` 或改他人 role；ban/unban actor 須 `actorOutranksTarget`。
- **INV-ISO-6** 全域 `role` 軸與 tenant `platform_role` 軸正交；全域權限不隱式繞過 tenant boundary（見 2.3）。
- **INV-ISO-7** credit wallet / billing entitlement / quota 全 tenant-scoped，無跨租戶讀寫。
- **獵捕重點**：整面列舉所有吃 `[tenantId]` / `[userId]` / `[id]` path param 的端點，逐一驗 IDOR（horizontal escalation）；billing/credit 端點的 tenant 過濾；admin 端點是否走全域 role 就改了 tenant 資料（vertical/cross-tenant）。

### 事件一致性 + DLQ
- **INV-EVT-1** outbox row 與 gating mutation 同一 `db.batch()`；event 僅在 `changes()=1` 時發。
- **INV-EVT-2** `streamSeq` per-streamKey 嚴格單調，in-batch 分配，caller 不自填 `streamKey`。
- **INV-EVT-3** 套用為 contiguous（`seq==last+1`）；`<=` noop；`>` gap→DLQ，**永不靜默跳**。
- **INV-EVT-4** 每個 worker transition 帶 owner-CAS（`locked_by=runToken`）；stale worker fenced。
- **INV-EVT-5** mark-done 與 projection upsert 同 batch 且 gated `changes()=1`（G2）。
- **INV-EVT-6** DLQ 寫入 gated（`WHERE changes()=1`），重疊 run 恰一筆。
- **INV-EVT-7** consumer 重建 event 並 re-validate（defense in depth）；corrupt/tamper → DLQ。
- **INV-EVT-8** `session.revoked.ref` = per-login family id（非 stable account id）；re-login = 新 streamKey，不永久封。
- **INV-EVT-9** audit 只記 `stream_key_hash`，不記 raw streamKey / data_json。
- **INV-EVT-10 ⚠️（系統級首要）** deny-state `denied` bit 是否在 chiyigo-side auth/refresh 被**實際消費/強制執行**？emission+projection 已存在，enforcement seam 待證。
- **獵捕重點**：並發 cron run 下的 ordering 與 sweep/claim 交互；`attempts` 計數與 backoff；replay 端點冪等；large-N alarm；每個 emitter（members/invitations/ban/unban/logout）是否正確 splice outbox statements。

### 安全邊界 Security
- **INV-SEC-1** 所有非公開 API 經 `requireAuth/requireRole/requireActiveTenantRole`，缺則 401/403（deny by default）。
- **INV-SEC-2** access token ≤15min；refresh rotation 安全（`successor_hash` 防 reuse；reuse → family 撤銷）。
- **INV-SEC-3** step-up token atomic consume（`INSERT OR IGNORE`/CAS + `changes()=1`）。
- **INV-SEC-4** brute force → rate limit + 帳號鎖定 + 觀測（`login_attempts`、`ip_blacklist`）。
- **INV-SEC-5** 敏感操作防 replay（nonce / idempotency / `used_totp`）。
- **INV-SEC-6** 所有外部 input schema validation；webhook 驗簽；AI/第三方輸出視為 untrusted。
- **INV-SEC-7** output 過 DTO 不 dump row；錯誤對外只給 error code + traceId，不洩漏 internal。
- **INV-SEC-8** CRON endpoints 經 `CRON_SECRET` bearer 比對。
- **INV-SEC-9** refresh device-id read-only fail-closed（缺則不打 refresh；新生 UUID≠後端綁定 → device_mismatch 撤 family）。
- **INV-SEC-10** state-changing 跨域請求受 Origin / CORS credentials 控制；CSP 嚴格（Phase D 已完成，僅查回歸）。
- **INV-SEC-11** secrets 不 hardcode；走 env / Wrangler secret。
- **獵捕重點**：refresh rotation race；jti revocation（`revoked_jti`）；OAuth/OIDC surface（`authorize`/`code`/`end-session`/`backchannel`/`frontchannel-logout`/PKCE/nonce/aud）；webauthn register/login verify；rate limit 覆蓋缺口；較新端點的 input validation 缺口；`tryDecodeAuthSub` 確認永不被信任。

### 整合 Integration
- 端到端鏈一致性：`refund→credit→outbox→deny`；`login→tenant resolve→token claims`；`ban→account.disabled→deny-state→enforcement`。
- 雙 role 軸交互（2.3）。
- 每個 domain-event emitter 的 splice 正確性整面複查。
- completeness critic：哪個模態沒查、哪條 claim 沒驗、哪份 source 沒讀。

---

## 4. Threat Model skeleton（每領域：attacker goal / entry / asset）

| 領域 | Attacker goal | Entry point | 受保護 asset |
|---|---|---|---|
| 金流 | 重複扣款 / 偽造成功付款 / 偽造退款 / 金額竄改 | 偽造/重送 webhook、並發 checkout、refund 端點、soft-delete race | payment_intents 狀態、credit wallet 餘額、對帳完整性 |
| 隔離 | 讀/改他租戶或他人資料、自升權限 | `[tenantId]`/`[userId]`/`[id]` path param IDOR、token claim 偽造、admin 端點 | 跨租戶資料、membership、billing/credit、entitlement |
| 事件 | 帳本不平 / deny 失效 / 重複套用 / 順序亂 | 並發 cron、replay 端點、corrupt outbox row、gap 注入 | event_deny_state 一致性、hard-revoke 有效性 |
| 安全邊界 | token theft / replay / 提權 / brute force / session 劫持 | login、refresh、step-up、OAuth callback、webauthn、CRON | token 完整性、session、帳號、secret |

---

## 5. Finding schema + 嚴重度

每條 finding 固定欄位：

```
ID         : <域>-<序號>，如 PAY-001
領域        : Payments / Isolation / Events / Security / Integration
嚴重度      : P0 / P1 / P2 / P3
違反條款    : INV-xxx-n + Tier-0/1 對應
證據        : file:line（具體）
重現情境    : 攻擊路徑 / 競態序列（P0/P1 附 repro test 描述）
blast radius: 影響面
修復方向    : 非完整 code，指出方向
信心度      : high / medium / low
需 Gate 複核: yes / no
建議修者    : Opus / Haiku / 人工
```

**嚴重度定義**
- **P0** —— 現在或首筆真實流量即可觸發的 Tier-0 違反（live-exploitable）。→ **立即通報 + 提供 hotfix 選項**（owner 2026-06-12 拍板），不等 6/26。
- **P1** —— 有前提但可能成立的 Tier-0；或 critical path 的 defense-in-depth 缺口。→ Opus 6/26 起優先。
- **P2** —— Tier-1（critical path 的觀測/可維護缺口）；或現架構觸發不了的 latent Tier-0。
- **P3** —— hardening / nice-to-have。

**P0/P1 驗證要求（owner 2026-06-12 拍板）**：寫一個 pre-fix 會 fail 的 repro test（local D1 / vitest），把「合理推測」變「已證實」，並直接留給 Opus 當 regression test。

---

## 6. 執行模式與 Gate（owner 2026-06-12 拍板）

- **執行模式**：每領域開一個 multi-agent **workflow**，fan-out 多個 Fable 5 subagent 並行找線索 + 對抗式驗證；Claude 主線負責系統級綜合與裁決。最大化 6/22 收窗前 Fable 5 吞吐。
- **Gate 時機**：**Hybrid**。金流報告 + 本不變量 doc 完成後做一次**小型校準 Gate**（只驗 §2 心智模型對不對，趁只污染 1 份報告時便宜抓系統性誤讀）；末期（6/23–25）再做完整 Gate 審所有 finding。
- **P0 處置**：live-exploitable P0 立即通報 + 提供 hotfix 選項，其餘照常 defer 進 backlog。

---

## 7. 各領域 workflow 設計骨架（執行時用）

每個領域 workflow 走同一形狀（pipeline，find → adversarially verify）：

1. **Find 階段**（並行 finder，每個 finder 一個 hunt 切角）：
   - 切角範例（隔離）：by-endpoint-enumeration（列舉所有 path-param 端點）、by-query-grep（找裸 query / 缺 tenant_id）、by-role-axis（雙軸混淆）、by-IDOR-scenario。
   - 每個 finder 帶 §6 紀律：**不重列 inline 已標記的 codex 已修項**。
2. **Verify 階段**（對每條候選 finding 並行對抗式驗證）：
   - 多個 skeptic，prompt 為「嘗試反駁這條 finding；預設 refuted 除非能證明可觸發」。
   - P0/P1 額外要求產出 repro test 草稿。
3. **Synthesize**（Claude 主線）：去重、歸類 INV、定嚴重度、寫進領域報告。

**finder 共同輸入**：本文件 §2（心智模型）+ §3（不變量）+ §6 紀律。

---

_P0 起手完成於 2026-06-12。下一步：校準前先補讀 `auth.ts` 完整 token taxonomy + `scopes.ts`，再進 P1 金流 workflow。_
