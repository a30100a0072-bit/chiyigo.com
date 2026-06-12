# P3 事件一致性 + DLQ 審計報告（Event Consistency）

> 領域：事件一致性 + DLQ｜Tier-0 對應：**正確性**｜SSOT：`00-invariants-threat-model.md` §2.4/§3 事件段/§4。
> 不變量標的：INV-EVT-1..10（首要 INV-EVT-10 enforcement seam）。報告語言繁體中文；code identifier / 欄位名 / 路徑保留原文。
> **產出日期**：2026-06-12（Fable 5 審計窗 6/12–6/22）。方法：4 切角 workflow finder 並行（`wf_7c8052a4-b32`，4/4 切角完整回傳）→ 對抗式 verify → 主線獨立讀碼裁決。
> 尾端 3 個 verifier 撞 session limit 失敗 → 該 3 條候選由主線直接讀碼補裁（無覆蓋缺口，全數駁回，見 §3）。

---

## 0. 執行摘要

**Headline（INV-EVT-10 正向答案）：「記了不擋」不成立。** `event_deny_state.denied` 全 repo 唯一 reader 是 consumer 自己（`event-outbox.ts:146`）——沒有任何 auth/refresh 路徑讀它，**但這是 owner LOCKED 的 by-design**（migration 0051 註解「INTERNAL projection, NOT an RP wire contract」；PR5 plan §9.5「Reads are tests + future RP API only」）。逐一建表驗證後確認：**每個被 emit 的 deny 事件都有獨立的 chiyigo-side live enforcement**（§1 對照表），無任何事件「唯一 enforcement 是沒人讀的 projection」。真正的缺口全在**反向**——enforcement 存在但 event 沒發（未來 RP pull under-deny），其中一條成立為 P2（EVT-003），其餘屬已裁決 deferral（§3 駁回）。

**機制面正面保證（finder 整面驗證、無 finding）**：INV-EVT-1/2（9 個 wired emit site 全部 both-or-neither、streamKey 一律 SPEC 推導、emit 側並發 seq 分配安全 + `UNIQUE(stream_key,stream_seq)` backstop）、INV-EVT-4/5/6（consumer 全部 6 條寫入路徑 owner-CAS/gated，無未 fence 路徑；重疊 run 推演收斂）、INV-EVT-7（poison→DLQ）、INV-EVT-8（per-login ref，re-login 不永久封）、INV-EVT-9（全鏈只記 stream_key_hash）、DENY_EFFECT 11 事件歸類全對。

**6 條 findings（無 live-exploitable；P2 ×3 全為「latent Tier-0 / Tier-1 觀測」級）：**

| ID | 嚴重度 | 一句話 | 處置 |
|---|---|---|---|
| **EVT-001** | **P2** | dead row 永久 head-of-line 阻塞同 streamKey 後續事件，且 blocked-backlog **零持續觀測**（首筆 DLQ critical 後全靜默；無 gauge / oldest-age / DLQ list 端點） | 窗內修（觀測補強） |
| **EVT-002** | **P2** | `deliver()` 的 prior-read 與 noop mark-done 在 failTransition 保護外：orphan 路徑無 backoff、attempts 每次 reclaim +1，可把**從未真正嘗試 apply** 的可投遞事件誤 DLQ 成 max_attempts | 窗內修（錯誤處理對齊） |
| **EVT-003** | **P2** | 帳號 hard-delete（`delete/confirm.ts`）是最強的 account disable 卻**不 emit `account.disabled`**（較弱的 ban 反而有）；且 `UPDATE users` 無 CAS 守衛 | 窗內修（需 owner 裁 scope，§5） |
| EVT-004 | P3 | 結構性 poison 無 quarantine 工具/runbook（plan §7 承諾的 manual quarantine SOP 不存在）；replay 對 poison 主動有害（每按一次多鑄一筆 DLQ row）；quarantine 必須**同步推進 projection cursor** 否則二次卡死 | backlog + runbook |
| EVT-005 | P3 | 事件四表無 retention：每日 cleanup cron 已清 11 表但事件表全未掛；outbox done purge＝plan §16 已記載 debt 未落地；**`event_deny_state` + session 型 sequences 的不朽累積＝新發現**（無任何文件兜底） | backlog |
| EVT-006 | P3 | `admin/revoke.ts:200,217` 把 `device_uuid` **明文**寫入 audit，違反 repo 既定 `hashIdentifierForAudit` HMAC16 慣例（×3 處先例）；device_uuid 參與 refresh device-binding，audit DB 外洩情境下削弱縱深 | 2 行 fix，可併窗內 tiny PR |

**對抗式駁回 4 條**（§3；駁回理由本身是 audit 價值）：product_access.* 零 emitter（×2 finder 重複報）＝Codex 裁決明文 DEFER to F-2；token-epoch 不發 event＝契約明文 + NEGATIVE test 鎖定；refresh device-mismatch 不 emit＝owner D6 裁決 DEFER。

---

## 1. INV-EVT-10 enforcement seam 對照表（正向驗證）

| 事件 | DENY_EFFECT | emission 點 | chiyigo-side 實際 enforcement | 延遲窗 |
|---|---|---|---|---|
| member.suspended / offboarded | deny | members.ts（同 batch CAS gated） | `requireActiveTenantRole` → `resolveIssuanceContextForTenant` 每 request 由 DB live 推導 membership | 下一次 tenant-scoped call 即擋（=0） |
| member.reactivated / joined | undeny | members.ts / invitations.ts | 同上（live membership） | 即時 |
| member.role_changed | soft | members.ts（CAS-pinned fromRole） | platform_role 每 request live 推導 | 即時（'soft' 註解指 RP 側 token TTL） |
| account.disabled / reenabled | deny / undeny | ban.ts / unban.ts | `UPDATE users SET status='banned', token_version+1` + 撤全 refresh；requireAuth **每 request 查 DB token_version 比對**（auth.ts:80-89） | 即時（=0） |
| session.revoked | deny | logout.ts / session-revoke.ts（devices/logout + admin mode=device） | `casByFamily` 撤 refresh family | refresh 即時；**該裝置殘存 access ≤15min**（既有 backlog：per-device token version） |
| account hard-delete | （無事件 → **EVT-003**） | — | deleted_at 過濾 + token_version bump + refresh/local_accounts 全刪 | 即時 |
| token-epoch 類（改密/重設密/2FA disable/admin mode=user） | （by-design 非事件） | — | `bumpTokenVersion`（ver 比對 + 撤全 refresh） | 即時 |
| product_access.revoked / restored | deny / undeny | （**零 emitter**＝F-2 裁決 deferral，§3） | `entitlements.ts:34` 直接讀 `tenant_product_access` 表 | 即時（live read） |

結論：deny 軸 enforcement 與 projection **完全解耦**，每條都有獨立 live 機制；projection 純為 future RP 物化。唯一系統性風險是反向：mutation 有、事件無 → RP 上線後 under-deny，且 **streamSeq 必須在 mutation 當下 in-batch 分配，事後不可補發**（both-or-neither 保證的代價）——這是 EVT-003 定 P2 的核心理由。

---

## 2. Finding 詳述

### EVT-001（P2）— dead row 永久 HOL 阻塞 + blocked-backlog 零持續觀測

```
ID         : EVT-001
領域        : Events
嚴重度      : P2（Tier-1 critical-path 觀測缺口 + latent Tier-0 雙邊命中）
違反條款    : INV-EVT-3 的 liveness 對偶 + Tier-0 證據要求（觀測）
證據        : functions/api/admin/cron/event-outbox.ts:94-95（claim 連續性 NOT EXISTS 用 status<>'done' → 'dead' 永久阻塞）
            :203-208（consumer_run 只報本 run counts；severity 只在本 run dlq>0 時 warn）
            functions/api/admin/event-dlq/ 下只有 [id]/replay.ts —— 無 DLQ list 端點；admin/metrics.ts 無 event_* 指標
信心度      : high（finder→verifier 維持→主線獨立讀碼三層確認）
需 Gate 複核 : 修法 PR 走 Dual Gate
建議修者    : 窗內（Fable 5）
```

**機制**：claim 連續性把 `status<>'done'` 全視為阻塞——`'dead'` 是 terminal、永不被 reclaim，故任一事件進 DLQ（max_attempts / gap / validation_failed）後，同 streamKey 的 seq N+1.. **永遠不被 claim**、靜停 pending。這是 INV-EVT-3「永不靜默跳」的刻意設計（plan §5.2「Head-of-line tradeoff (accepted)」），**正確性面沒有錯**；缺口在觀測：首筆 DLQ 有 critical audit + 該 run report warn，之後每輪 run 對被阻塞 pending 列 sweep 不選、claim 排除、零訊號——run report 無 blocked-backlog 深度 / oldest-pending-age 欄位，連 DLQ list 端點都沒有（admin 要 replay 得裸查 D1 撈 dlq id）。

**blast radius**：account / member-lifecycle 有序流可被單一 poison 永久凍結投影；enforcement seam 未來接上 RP 後，卡在 DLQ 後面的 undeny（如 member.reactivated）= 用戶被永久錯誤 denied 而 ops 無從得知。

**修復方向**：(a) consumer run report + `domain.event.consumer_run` audit 增加 `blocked_backlog`（pending 且前序非 done 的列數）與 `oldest_blocked_age_s` 欄位，>0 時 severity 升 warn（持續可見）；(b) 補 `GET /api/admin/event-dlq`（list 未 replay 的 DLQ 列，step-up + scope 同 replay 端點）。
**repro（verifier 精修版，expected-fail 形式）**：沿用 `event-outbox-consumer.test.ts` harness——seed poison seq1 + 合法 seq2 → run 一次 dlq=1；再 run 3 次 assert 每次 claimed=0 ∧ dlq=0（現狀 silent=pass），regression pack 改斷言「consumer_run 應帶 blocked_backlog>0」（現狀無此欄 → fail，修復 PR 翻綠）。

### EVT-002（P2）— orphan 路徑錯誤處理不對稱：attempts 膨脹、無 backoff、誤 DLQ

```
ID         : EVT-002
領域        : Events
嚴重度      : P2（latent Tier-0：可投遞 deny-state 事件被誤 DLQ → 投影遺漏）
違反條款    : INV-EVT-4/5（transition 一致性）；attempts 語意混淆 delivery-failure 與 orphaning
證據        : event-outbox.ts:88（claim 無條件 attempts+1，含 reclaim）；:122-131（failTransition 不動 attempts）
            :146（prior-read SELECT）與 :154（noop mark-done）在 :161-177 try/catch 之外
            :199-201（外層 per-row catch 只記 errors、列留 orphaned processing、無 backoff）
信心度      : high（機制）/ medium（觸發前提）；verifier 維持 P2
需 Gate 複核 : 修法 PR 走 Dual Gate
建議修者    : 窗內（Fable 5）
```

**機制**：乾淨失敗走 failTransition（retry + backoff [60s..24h]，累計 ~38h 才耗盡 6 attempts）；但 `:146` prior-read 與 `:154` noop mark-done 的 transient D1 fault 會拋到外層 catch——列留 processing + attempts 已 +1、不排 backoff，只能等 lease(120s) 過期被 reclaim 再 +1。**同樣的故障走錯路徑，~30min 就燒完 6 attempts**，事件被 STEP A sweep 標 max_attempts DLQ——而它的 apply **從未被嘗試**。觸發前提（連續 transient fault 或 backlog>50＋run 中途死亡）現架構難現場觸發，且 errors→500 屬 loud failure（cron workflow 會紅），故 P2 非 P1。verifier 補充：誤 DLQ 的 dead 列接著觸發 EVT-001 的 HOL 阻塞，blast radius 比 finder 估的更大。

**修復方向**：把 `:146`/`:154` 納入與 apply 同等的 failTransition 保護（catch → failTransition 而非裸拋）；可選：orphan reclaim 與 delivery-failure 分開計數。
**repro（verifier 精修版）**：spy `db.prepare` 只打掉 prior-read SELECT（不 mock db.batch）→ run：assert 列 processing+attempts=1、retried=0；SQL backdate lease（既有 test :109 PAST 手法；注意 `LEASE_SECONDS='0'` 會被 posInt fallback 成 120，不可用）→ 重複至 attempts≥max → restore mocks → run：sweep 誤 DLQ max_attempts、投影全程未動。

### EVT-003（P2）— 帳號 hard-delete 不 emit account.disabled（含 CAS 缺口）

```
ID         : EVT-003
領域        : Events / Integration seam
嚴重度      : P2（latent Tier-0：deny-state SoT 完整性缺口，RP 上線後不可事後補救）
違反條款    : INV-EVT-10 reverse seam；emitter surface 完整性
證據        : functions/api/auth/delete/confirm.ts:50-64（atomic batch：6×DELETE + UPDATE users SET deleted_at,
            token_version+1 —— 全程零 emit*；:75 safeUserAudit('account.delete') 是 audit 非 domain event）
            對照 ban.ts:78-89（較弱的可逆 ban 有 emitAccountDisabled 同 batch）
            confirm.ts:57-63 UPDATE users 無 `AND deleted_at IS NULL` CAS（:38-44 pre-read 是 TOCTOU；
            :47 token 消耗 DELETE 未驗 changes）
信心度      : high（兩個 finder 獨立發現；verifier 兩路皆維持；主線親讀確認）
需 Gate 複核 : 修法 PR 走 Dual Gate；scope 需 owner 裁決（§5）
建議修者    : 窗內（Fable 5）
```

**機制**：契約完全適配（`account.disabled` SPEC：tenant null、required {sub}、optional {reason}、streamKey `account:<sub>`），ban 已接好同款；刪號是更強的 disable 卻零事件。**「刻意不納」假說查無實據**：pr5c plan 的 NON-GOALS 逐條列出被排除者（session.revoked→5d、token-epoch、product_access→F-2），**帳號刪除完全未被提及**＝未被考慮的 gap，非設計排除。chiyigo-side enforcement 無缺（token_version bump 即時 + refresh/local_accounts 全刪），危害純在 RP 視角：ban 的帳號 denied=1、被刪（更該擋）的帳號永遠無 deny row。**P2 理由：streamSeq 必須 mutation 當下 in-batch 分配，RP 上線後無法對歷史刪號補發事件。**

**附帶面（同 PR 收斂）**：(a) UPDATE users 無 CAS → 並發 double-confirm 會 double-emit（5c 對 ban 加 CAS 的同款教訓），fix 須先補 `AND deleted_at IS NULL`；(b) 刪號 batch 不動 `organization_members`、不發 member.offboarded——已刪 user 的 membership row 殘留（anonymized email 仍掛在 tenant 成員列表、未來 RP 視其為 active member）——scope 是否納入本 PR 待 owner 裁（§5）。

**repro**：seed user B + delete_account token → 呼叫 confirm → assert `SELECT COUNT(*) FROM event_outbox WHERE stream_key='account:'||B` ≥1 —— pre-fix 實為 0（fail）。對照組 ban→1（pass）。

### EVT-004（P3）— poison quarantine 工具/runbook 缺位

**機制**：plan §7 明文承諾「recovery is a MANUAL admin quarantine that deliberately advances the projection past the bad seq -- out of PR5 default scope, but alarmed via the critical DLQ audit」——但 `docs/runbooks/` grep 'quarantine' 零命中，違反基線 §高風險 Queue/Message「DLQ 復原 SOP 進 runbook」。verifier 三點補強：(a) 正確 quarantine 必須**同時** mark outbox row='done' **且**推進 `event_deny_state.last_applied_seq`——只做前者會讓後續 seq 撞 gap 分支再次 DLQ（stream 二次卡死）、只做後者 dead 列繼續擋 claim；(b) replay 對結構性 poison 主動有害（每按一次 INSERT 新 DLQ episode row + critical audit）；(c) gap 分支在正常守門下不可達（claimed row 的 prior 必 done），唯 poison-dead 或 deny_state row 被外力刪除才 live——**與 EVT-005 交織：未來若有人 naive GC 刪 deny_state row，重生的 stream 會以 priorSeq=0 判 gap → 全 stream 卡死**。
**修復方向**：gap/poison-recovery runbook（含雙步 quarantine SQL SOP）優先；admin cursor-advance 工具列 backlog。

### EVT-005（P3）— 事件四表無 retention（含已記載 debt 與新發現）

**機制（verifier scope 校正後）**：每日 retention cron 存在（`cron-cleanup.yml` → `cleanup.ts:21-80` 已清 11 表），事件四表全未掛。三段：(a) `event_outbox` done rows——plan §16 已明文「intended long-term hygiene = piggyback the existing cleanup cron」＝**已揭露 debt 未落地**；(b) `event_dlq`（forensic）與 `event_stream_sequences`（須永遠遞增）不 prune＝**刻意設計，不是缺口**；(c) **`event_deny_state` 的 retention 在所有文件中完全未被討論**，且 session 型 streamKey 單次性（revoke 後 family 死亡、re-login 新 key）使「sequences 永遠遞增」的理由對 session:* 列不成立——每次 logout 永久淨增 deny_state + sequences 各一列＝新發現。
**修復方向**：cleanup cron 加 outbox done purge（兌現 plan §16）；deny_state/session-sequences retention 需設計裁決（**禁 naive DELETE**——見 EVT-004 交織風險，須同步處理 contiguity 語意）→ 進 backlog 與 RP pull API 設計一起定。

### EVT-006（P3）— admin/revoke device_uuid 明文入 audit

**機制**：`admin/revoke.ts:200,217` 稽核 data 直記 `device_uuid` 全值明文；姊妹端點 `devices/logout.ts:101-105` 同欄位走 `hashIdentifierForAudit(env,'device-uuid',...)` HMAC16（Codex r9-4），`device-alerts.ts:66-74` 第三處同款＝既定慣例。verifier 補強：`user-audit.ts:19` 檔內約定明寫「device_uuid（截斷）」，此處連截斷都沒有（對比 refresh.ts 至少 slice(0,8)）；device_uuid 參與 refresh device-binding（refresh.ts:185-186），audit DB 外洩的 raw 值可配合被竊 refresh token 通過綁定——HMAC 正是擋這條。INV-EVT-9 本體（streamKey/data_json redaction）全鏈驗證通過，本條是旁支 PII parity。
**修復方向**：兩行改 `hashIdentifierForAudit`，trivial。

---

## 3. 對抗式駁回紀錄（4 條）

1. **product_access.revoked/restored 零 emitter（兩個 finder 重複報，P3）→ 駁回**。機制事實屬實，但：(a) Codex 裁決明文記錄的刻意 deferral——pr5 master plan §18.1「product_access.* emission -> **DEFER ENTIRELY to F-2**. No lone 'restored'.」，pr5b/pr5c/runbook 各處重申；(b) deny-state 語意誤讀：無 row=未 deny；grant（none→active）本就不該發 lone restored（正是裁決拒絕的）；整條 product 軸均勻未接線=與「無 revoke 能力」的現實一致，無半接線不一致；(c) `revoked→active` reinstatement 前置狀態 production 不可達（全 repo 無路徑寫 'revoked' 進 `tenant_product_access`）。residual：F-2 加 revoke endpoint 時**必須同 PR 接 emitter**——已在 plan 18.1 與 runbook 原位明文，列 [[project_iam_phase_f2_todo]] 提醒即可。
2. **token-epoch 撤銷（改密/重設密/2FA disable/admin mode=user）無 deny 訊號（P3）→ 駁回**（主線裁決；verifier 撞 limit）。契約 domain-events.ts:17-18 明文 whole-user logout-all =「a PR5 token epoch / revokedBefore cutoff (**NOT a deny-list subject**)」；pr5 plan :167、pr5c :64/:345、pr5d :114/:140 全部重申「FUTURE PR」；pr5d3 :443 甚至有 NEGATIVE test 鎖「mode='user' + ban → ZERO session.revoked rows（token-epoch ≠ deny）」。屬文件完備、test 鎖定的 design deferral。residual：token-epoch RP 機制是 RP 整合的前置條件之一 → 已在 [[project_rp_integration_chiyigo_backlog]] 軌道。
3. **refresh device-mismatch 撤 family 不 emit session.revoked（P3）→ 駁回**（主線裁決；verifier 撞 limit）。pr5d plan D6 = **owner 顯式裁決 DEFER**（:111「a security path in the HOT refresh endpoint…a separate follow-up」、:118、:516、:581），5d-2 L6 與 5d-3 L5 兩度重申「refresh.ts device_mismatch **STAYS deferred**」。與 jti dormant slot 同類（owner DEFER + 追蹤錨存在）。residual：5d-4（device_mismatch wire）是 dormant slot，RP 接線前補上即可。
4. **（P1 駁回慣例對照）**本輪另有一條 finder 對 EVT-005 的「無 retention cron」子句被 verifier 校正（cleanup cron 存在、11 表已掛）——證據面修正後保留為 scope 較窄的 EVT-005，不整條駁回。

---

## 4. INV-EVT-1..10 逐條結論

- **INV-EVT-1（同 batch + changes()=1 gating）✅**：9 個 wired site 整面列舉逐一驗（members×4 / invitations×2 / ban / unban / logout / session-revoke multi-family），gating mutation 全為單列 CAS、emit 緊鄰、0-row 不發；ban.ts 的 refresh-revoke 排在 outboxInsert 之後不破壞 changes() 鏈；multi-family chunk 內 [cas,seq,outbox]×N 順序正確。
- **INV-EVT-2（streamSeq 嚴格單調、streamKey SPEC 推導）✅**：無 caller 自填；seqUpsert 在 D1 寫序列化下不重號不跳號；`UNIQUE(stream_key,stream_seq)` backstop；session ref 強制 colon-free。
- **INV-EVT-3（contiguous apply；gap→DLQ 永不靜默跳）✅ 機制正確**；其 liveness 對偶（dead→HOL 永久阻塞）的觀測缺口＝**EVT-001**，恢復縫隙＝**EVT-004**。gap 分支在正常守門下不可達（claimed row 的 prior 必 done）。
- **INV-EVT-4（owner-CAS fencing）✅**：consumer 全部 6 條寫入路徑（sweep/claim/dlq/fail/noop-done/apply）逐條驗證有 fence；重疊 run interleaving 推演收斂。錯誤處理不對稱（保護範圍）＝**EVT-002**。
- **INV-EVT-5（mark-done 與 projection 同 batch gated，G2）✅**：local+remote 既有 test 證實。
- **INV-EVT-6（DLQ gated 恰一筆，G3）✅**：三種 reason 皆 owner-CAS + changes()=1。
- **INV-EVT-7（consumer 重建 re-validate）✅**：corrupt row → validation_failed DLQ；emission 端 SQL-derived 欄位以 sentinel 過 shape validation 後由 consumer 真值複驗（defense in depth 成立）。
- **INV-EVT-8（session.revoked ref=per-login family；re-login 不永久封）✅**：機制成立；生命週期清理面＝**EVT-005(c)**。
- **INV-EVT-9（audit 只記 stream_key_hash）✅**：consumer / replay / 三個 emit-site 全鏈驗證；旁支 device_uuid PII parity＝**EVT-006**。
- **INV-EVT-10（enforcement seam）✅ 正向不成立為缺口**（§1 對照表；projection 未被消費是 owner LOCKED by-design）；**反向缺口一條成立＝EVT-003**（hard-delete），其餘反向候選皆為已裁決 deferral（§3）。

---

## 5. 修復交接 + 待 owner 裁決

**窗內修（P0–P2 紅線，Dual Gate）**：
- **EVT-001 + EVT-002 建議併一顆 consumer-hardening PR**（同檔 `event-outbox.ts`，觀測欄位 + 錯誤處理保護；含 verifier 精修的兩個 repro/regression test）。
- **EVT-003 獨立 PR**（`delete/confirm.ts`：CAS + emitAccountDisabled splice + repro test）。
- **EVT-006 可選 tiny PR**（2 行 redaction；P3 但 trivial，類比 audit-loss console.error 前例）——owner 點頭即做，否則進 backlog。

**待 owner 裁決（EVT-003 scope）**：
1. 刪號事件語意：reuse `account.disabled`（optional `reason:'account_deleted'`，零 schema 變更、契約現成）**（推薦）** vs 新增 `account.deleted` 事件型別（additive 合法但需動 0051 CHECK constraint = table rebuild migration，成本高很多）。
2. 刪號是否同 PR 一併處理 tenant membership（DELETE `organization_members` rows + 每 tenant 一筆 member.offboarded emit）？不處理則已刪 user 殘留在成員列表且 RP 視其 active member（可後續獨立 PR）。

**P3 → STAGE8 backlog / regression pack（Opus 6/26）**：EVT-004（quarantine runbook + 工具）、EVT-005（retention 設計，禁 naive DELETE）、EVT-006（若不走 tiny PR）。

**交其他領域**：
- **P4 安全邊界**：(a) `end-session.ts` 撤全 user refresh 但**未 bump token_version**（access 殘存 ≤15min）——finder 顯式標記交接；(b) `delete/confirm.ts:47` delete-token 消耗未驗 changes===1（非 atomic consume；EVT-003 PR 若補 CAS 可一併收斂，否則交 P4）；(c) `webhooks/kyc/[vendor].ts` ISO-ENUM-2 同款複查（P2 報告既有交接）。
- **P5 整合**：ban→account.disabled→deny-state 鏈的端到端 repro（含 consumer 實跑）已被既有 integration tests 覆蓋大半；P5 聚焦 refund→credit→outbox 鏈與雙 role 軸。

**加深項狀態（誠實標記）**：本輪 workflow 為靜態分析+推演；三條 P2 的 repro test（verifier 已精修到可實作規格）與 projection property-fuzz 隨修復 PR 同輪落地（pre-fix fail 實跑後才算數）。consumer 並發互鎖的「實測」由既有 event-outbox-consumer.test.ts 的 fencing 案例 + 新增 repro 共同構成；webhook dedupe 三態並發實測屬金流面，排 P5/金流 smoke 輪。

---

## 6. 給校準 Gate 的問題

1. §1 enforcement 對照表（尤其 token_version 每 request live 比對、tenant 軸 live membership 推導）我讀對了嗎？
2. EVT-003 定 P2 的判準（「streamSeq 不可事後補發 → RP 上線後不可補救」）合理嗎？
3. EVT-001/002 維持 P2 不升 P1 的理由（loud failure 兜底 + 現架構難觸發）站得住嗎？
4. 4 條駁回（尤其 device-mismatch D6 deferral 的主線裁決）有無誤判？
5. 有無 finder 與主線都漏掉的事件鏈系統級破口？

_報告完成 2026-06-12。workflow 原始輸出：`tasks/waqm39gsy.output`（temp，可能已清；finder/verifier 全文已摘錄至本報告）。下一步：owner 裁 EVT-003 scope → 3 顆窗內修補 PR 走 Dual Gate → /clear 斷點 3 → P4。_
