# SEC-REFRESH-REUSE (P1) — Refresh Reuse Family-Revoke Fix Plan

狀態：`PLAN_DRAFT`（ChatGPT Arch APPROVED_WITH_CLARIFICATIONS〔C1/C2/C3〕→ **Codex Plan Gate r2 = REVISE〔2 blocker〕→ r3 已修,重送** `CODEX_PLAN_APPROVED`）
動工分級：**L2 + 高風險加碼**（auth 熱路徑 + distributed session state → 補 state-transition 表 / idempotency / abuse-cap / failure-mode / Ordering-B tradeoff 顯式化）
前置：SEC-FACTOR-ADD ADD-A 全系列已收尾（#74/#75/#77/#78/#79/#80）。
Spec：owner 2026-06-13 prose ruling（Option B + PT-2 truth table + 2 hard locks）= `SPEC_APPROVED`。

**Arch Gate clarifications 已補**：C1 `family_revoked` 只在 CAS `changes>0` emit（§5/§7）；C2 DB error → 401 `SESSION_REVOKED` + `family_revoke_error`（§4）；C3 前端只對 `SESSION_REVOKED` 清（§10）；OD-SR-A/B（§11）。

**Codex Plan Gate r2 blockers 已修（本版 r3）**：**Blocker 1**（state consistency）—`casByFamily` 真語意＝**PK-pinned single-head CAS**（changes∈{0,1}）+ 需 caller **GLOBAL COUNT preflight**;§4 補三路分支（heads>1→`session.integrity_violation` fail-closed、heads=1→casByFamily、heads=0→changes=0），杜絕「撤 1 留 1」不一致。**Blocker 2**（feasibility）—per-(user,session) cap 無 key;§5/§9 改 **template kind `refresh_family_revoke:<session_hmac>` + helper**（擴 RateLimitKind template literal,**無 migration**,不退化 per-user/不濫用 email·ip）。

---

## 0. 定位與 owner 裁決

**P1 根因**：refresh rotation 本身健全（`refresh.ts:245` atomic batch：S1 revoke old + stamp `successor_token_hash` WHERE `revoked_at IS NULL` CAS／S2 INSERT successor WHERE `changes()=1`；preserve `session_id`）。但 **revoked-token reuse 分支（`refresh.ts:130–168`）目前唯讀**——emit audit + rate-limit，**整條路徑無任何 family-revoke**。

**攻擊（INV-SEC-2 違反 + OAuth refresh-rotation BCP）**：web session（`device_uuid=null`），攻擊者偷 live R_n → **搶先 rotate** → 持 live successor S_atk。受害者拿舊 R_n → `reuse_detected` → 受害者 401，**但 S_atk 永遠繼續 rotate（從不 family-revoke）** = 攻擊者持久隱形 session，當前**無限期**。

**為何不能 naive casByFamily**：revoked 路徑直接 family-revoke 會在 **Ordering-B 良性情境**（受害者先 rotate、舊 token 後到）殺掉**活著的 successor**（受害者的）= replay-DoS。fork2 round-2 H binding invariant 因此禁 revoked 路徑 family-revoke。

**Option B（owner ruled）**：接受**有界**良性重登成本，換攻擊者持久 session 從**無限期**收斂到**有界**。靠 **PT-2 sub-path truth table** 只在「proven non-benign reuse」family-revoke。

| OD | 裁決 | 落地 |
|---|---|---|
| OD-SR-1 family 範圍 | **session_id family**（只撤 presented token 的 family，不跨同 user 其他 family，不收斂到 device——web `device_uuid=null` 是主血管） | §3/§4 |
| OD-SR-2 abuse cap | **per-user 5/10min + per-session idempotency**；cap 只能壓**重複** audit/work，**不得阻止首次必要 revoke**（hard lock） | §5 |
| OD-SR-3 force re-login | **401 + `SESSION_REVOKED`** distinct code；前端**只**對此 code 清 token+導 login（hard lock，不可全 401 導 login） | §6 |
| OD-SR-4 audit | 新 **`auth.refresh.family_revoked`**（SECURITY_SIGNAL/critical）；registry **225→226** 雙 lockstep；payload 最小化 | §7 |

---

## 1. 系統架構 / 資料流（改 `refresh.ts` revoked-token 路徑）

```
incoming refresh token → lookup refresh_tokens by token_hash
  ├─ live (revoked_at IS NULL) → [既有] device check / rotate（不動）
  └─ revoked (revoked_at NOT NULL) → reuse 分支（§3 改造）
        classify sub-path (PT-2 truth table)
        ├─ NOT family-revoke 類（successor NULL / grace_device_mismatch / benign orphan）→ [既有行為] warn/no-op 401
        └─ family-revoke 類（proven non-benign）→
              casByFamily(db, userId, presentedFamilyRef).run()   ← idempotent，撤 family live head（= 攻擊者 successor）
              ├─ changes>0（首撤）→ emit auth.refresh.family_revoked critical(revoke_count) → 401 SESSION_REVOKED
              └─ changes=0（family 已撤 / repeated replay）→ idempotent no-op → abuse-cap 決定 audit 降噪 → 仍 401 SESSION_REVOKED
```

`presentedFamilyRef`（JS 算）= `tokenRow.session_id ?? ('legacy_' + tokenRow.id)`，對齊 `FAMILY_REF_SQL = COALESCE(session_id,'legacy_'||id)`（session-revoke.ts:42）。

## 2. 安全邊界

- **token-based**（無 RBAC 面）；input = refresh token，只以 `hashToken` 查 `token_hash`，**不 log raw token**。
- **fail-secure**：family-revoke 寫入失敗 → **不簽發新 token**、回 401（既有 reuse 路徑本就不簽新 token，維持）。
- **no cross-family**：family-revoke 只動 presented token 的 `session_id` family（`WHERE user_id=? AND FAMILY_REF=presentedFamilyRef AND revoked_at IS NULL`）→ 不影響同 user 其他 login。
- **PII**：audit payload 無 raw token / raw device / raw provider；`session_id` 走 hash/ref。

## 3. PT-2 state machine — revoked-token 路徑 truth table（核心，禁單句 `reuse_detected → revoke`）

| sub-path | 判定（沿用 `refresh.ts:130–168` 既有分類） | family revoke | audit |
|---|---|---|---|
| `successor_token_hash IS NULL` | logout/admin/device-mismatch 撤的（非 rotation） | **否** | 既有 `auth.refresh.fail` reason=`reuse_detected`（warn，**不** critical theft） |
| `grace_device_mismatch` | grace candidate + device 不符 | **否**（維持 round-2 H） | 既有 `auth.refresh.fail` reason=`grace_device_mismatch`（warn） |
| proven benign grace orphan | in-grace + 同 device + successor live | **否** | 既有 `auth.refresh.grace_orphan`（warn） |
| **out-of-grace + non-benign** | rotation-revoked（successor 非 NULL）+ 逾 30s grace | **是** | `auth.refresh.family_revoked`（critical） |
| **device-null candidate + non-benign** | rotation-revoked + device-null（web 無法確認同 device） | **是** | `auth.refresh.family_revoked`（critical） |
| **dead-or-missing successor + non-benign** | rotation-revoked + successor 已撤/過期（chain advanced） | **是** | `auth.refresh.family_revoked`（critical） |
| repeated replay after family revoked | 上述 revoke 類但 family 已撤（changes=0） | **no-op**（idempotent） | capped/aggregated（§5；不重複 critical） |

> 三個 family-revoke 類 = 既有 code 會 fall-through 到 `reuse_detected`（refresh.ts:166）的三條路徑。改造＝在 emit `reuse_detected` 之前插入 family-revoke 分流。前三類**維持原樣**。
> **三個 family-revoke 類一律先過 §4 GLOBAL COUNT preflight**：heads>1 → `session.integrity_violation` fail-closed（不撤、不 family_revoked）;heads=1 → casByFamily single-head CAS;heads=0 → changes=0 路徑。`family_revoked` ⟺ CAS changes>0（C1）。

## 4. family-revoke：GLOBAL COUNT preflight + single-head CAS（Codex Plan Gate r2 blocker 1）

**casByFamily 真實語意（session-revoke.ts:18–62 註解 B3）**：它是 **PK-pinned single-head CAS**（`WHERE id = (SELECT id … LIMIT 1) AND revoked_at IS NULL` → `changes() ∈ {0,1}`，撤**一條** live head，**非**全部）。**EXACTLY-ONE-LIVE-HEAD invariant**：2-live-head family 必 **FAIL CLOSED**（不可「撤 1 + emit 1 + 留另一條 live」），靠 **caller 在 CAS 前做 GLOBAL `(user_id, ref)` COUNT preflight** 強制。SEC-REFRESH 沿用此既有契約：

```
genuine-reuse（§3 family-revoke 類）→
preflight: heads = SELECT COUNT(*) FROM refresh_tokens
                     WHERE user_id=? AND FAMILY_REF_SQL=? AND revoked_at IS NULL   (ref = presentedFamilyRef)
  ├─ heads === 1 → casByFamily(db, userId, ref).run()  → changes=1 → §5 step2 (emit family_revoked critical)
  ├─ heads === 0 → 無 live successor（family 已全撤）→ §5 step2-else (changes=0 路徑；NOT family_revoked)
  └─ heads >  1 → **invariant breach（FAIL CLOSED）**：emit `session.integrity_violation`(既有 IMMUTABLE/critical)
                   + 401 SESSION_REVOKED；**不** casByFamily（只會撤 1）、**不** emit family_revoked
```

- **pre-read 與 CAS 同 predicate**（`FAMILY_REF_SQL` + `revoked_at IS NULL`），不比 CAS 窄（feedback_gating_preread_not_narrower_than_cas）；CAS 仍 re-resolve 當下 live head，對並發 rotation 穩健。
- **idempotency 不變量**：heads=1 的 casByFamily `WHERE revoked_at IS NULL` → 並發第二者 `changes=0`。OD-SR-2 hard lock 的根＝revoke 永遠嘗試（preflight+CAS 不被 cap gate），changes 決定是否真撤。
- 單表單 family；非跨 binding。presented token 本身已 revoked，撤的是**其 family 的 live head**（successor）。
- `session.integrity_violation` 已註冊（registry 不增量；只 family_revoked +1=226）。
- **failure-mode（fail-secure；C2）**：preflight/casByFamily 包 try/catch；DB error →
  - requester：**回 401 `SESSION_REVOKED`**（不簽新 token;client 清本地 token 安全——presented token 確實該作廢）。
  - audit：**`auth.refresh.fail` reason_code=`family_revoke_error`**(既有 SECURITY_SIGNAL/warn,可查可告警) ——**絕不** emit `family_revoked`(C1：未實撤不可謊稱已撤)。
  - 一致性：revoke 未成 → 下次同 family reuse 呈現再撤(idempotent,最終一致)。
  - 監控：`family_revoke_error` 計數設 alert threshold。

## 5. abuse cap 設計（OD-SR-2 hard lock：cap 不得阻 first revoke）

**順序鐵律：revoke 先於 cap-gate；cap 只壓 audit 噪音，不 gate revoke。**

named constants（OD-SR-A 裁定;**禁 magic number**）：
```
REFRESH_FAMILY_REVOKE_AUDIT_CAP             = 5     // 每 window 內重複(changes=0)audit 上限
REFRESH_FAMILY_REVOKE_AUDIT_WINDOW_SECONDS  = 600
```

```
genuine-reuse（§3 family-revoke 類）：
1. §4 preflight COUNT(heads in presentedFamilyRef)：
   - heads > 1 → emit session.integrity_violation + return 401 SESSION_REVOKED   ← FAIL CLOSED(不續走、不 family_revoked)
   - heads ∈ {0,1} → const r = (heads===1) ? casByFamily(db,userId,presentedFamilyRef).run() : { meta:{changes:0} }
2. if (r.meta.changes > 0):                     ← heads=1 首撤 = 真撤到 live successor
      emit auth.refresh.family_revoked CRITICAL { revoke_count: r.meta.changes, sub_path, reason, abuse_capped:false, session_id_hmac16 }
   else:                                        ← changes=0：family 已撤(repeated) 或 heads=0(無 live successor)
      // C1：changes=0 沒撤到任何 active row → **不得** emit family_revoked(不可謊稱已撤)
      const capKind = familyRevokeCapKind(session_id_hmac)   // = `refresh_family_revoke:${session_id_hmac}`
      const capped  = checkRateLimit({ kind: capKind, userId, windowSeconds: WINDOW, max: CAP }).blocked
      if (!capped):
        recordRateLimit({ kind: capKind, userId })
        emit auth.refresh.fail WARN { reason_code:'reuse_detected_family_already_revoked', sub_path }   ← 既有 fail event,**非** family_revoked
      // capped → 不 emit(純降噪)
3. return 401 SESSION_REVOKED（一律;client 清 token 安全）
```

- **cap key 可實作性（Codex r2 blocker 2）= template kind `refresh_family_revoke:<session_id_hmac>` + `userId` scope**（達 per-(user, session_id)）。**無 migration**——`login_attempts.kind` 已是 TEXT,直接存 composite 字串;`session_id_hmac` 走 `hashIdentifierForAudit`（不存明文 session）。`RateLimitKind` 擴 template literal `| \`refresh_family_revoke:${string}\``（保留 prefix typo 防護）;封裝 helper `familyRevokeCapKind(sessionIdHmac): RateLimitKind`（禁散落字串拼接）。**不**退化成 per-user、**不**濫用 email/ip 欄。
- **C1**：`auth.refresh.family_revoked` **只在 `changes>0`** emit;`changes=0` 走既有 `auth.refresh.fail`(reason 區分 already-revoked),不可冒充 family_revoked,觀測語意不失真。
- **hard lock(OD-SR-2)滿足**：step 1 revoke **不在 cap 之後、不被 cap 跳過**;cap 只在 `changes=0` 分支壓**重複** audit。攻擊者打滿 family A 的 cap **無法**讓**另一** genuine-reuse family B 首撤被跳過——B 首撤走 `changes>0` 分支,與 cap 無關,且 cap key 含 session_id(A≠B)。**cap 不可能成 bypass**。

## 6. SESSION_REVOKED 信號 + 前端（OD-SR-3 hard lock）

- **後端**：family-revoke 類一律回 **401 `{ error, code:'SESSION_REVOKED', traceId }`**（取代該三路徑原本的 `reuse_detected` 回應碼；audit 仍記 sub_path）。
- **前端**（`src/js/api.ts`）：apiFetch 對 **`code==='SESSION_REVOKED'`** → 清 `sessionStorage.access_token` + 導 `/login`（或既有登出流程）。**只對此 code**，一般 401（token expired / unauthorized / 其他 refresh fail）**不**清、**不**導（hard lock：防誤登出）。
- 既有 `reuse_detected`/`grace_*` 仍回原碼（前端不對它們強制登出）→ 維持。

## 7. audit event `auth.refresh.family_revoked`（OD-SR-4）

- 註冊 audit-policy **SECURITY_SIGNAL**（critical severity → cold_class `security_critical`）；registry **225→226** + **兩處 lockstep**（`audit-policy.test:333` + `session-revoke-multi.test:392`）+ 顯式分類 describe（同 PR-A4 慣例）。
- **emit 條件（C1）**：**只在 family-revoke CAS `changes>0`** 時 emit（真撤到 ≥1 active row）。`changes=0`（repeated/已撤）走 `auth.refresh.fail`、DB error 走 `auth.refresh.fail` reason=`family_revoke_error`——**皆非** family_revoked。觀測上 `family_revoked` 計數 ⟺ 真實 family 撤除事件。
- **payload 最小化**：`{ reason ∈ (genuine_reuse_outside_grace|device_null_candidate|dead_successor), sub_path, session_id_hmac16, revoke_count, abuse_capped }`。**無** raw token / raw device / raw provider；`session_id` 走 `hashIdentifierForAudit` keyed-HMAC。
- safe：emit 失敗不影響 revoke 已寫入的事實（revoke 在 emit 前）。

## 8. Ordering-B tradeoff（顯式化，owner ruled Option B）

PT-2 **故意接受**：極少數 out-of-grace 良性 orphan（>30s 延遲重試）→ family-revoke → 重登一次。換得攻擊者持久 session 從**無限期** → **有界**（受害者下次 out-of-grace 呈現即殺 successor；web device-null 更快）。abuse cap 防被武器化成 audit/DB DoS（但不阻 revoke，§5）。**不跨 session_id family**（風險表第 1 條）→ 一張舊 token 不能反殺同 user 其他 login。

## 9. 改檔清單（預計）

| 檔 | 動作 |
|---|---|
| `functions/api/auth/refresh.ts` | revoked-token 路徑（130–168）插入 PT-2 分流：GLOBAL COUNT preflight（§4）+ heads>1→`session.integrity_violation` fail-closed + heads=1→`casByFamily` + SESSION_REVOKED 回應；import `casByFamily`/`FAMILY_REF_SQL` |
| `functions/utils/rate-limit.ts` | `RateLimitKind` 擴 template literal `\| \`refresh_family_revoke:${string}\``（保 prefix typo 防護）+ helper `familyRevokeCapKind(sessionIdHmac)`;**無 migration**（kind 已 TEXT） |
| `functions/utils/audit-policy.ts` | +`auth.refresh.family_revoked`（SECURITY_SIGNAL）；registry **225→226**。`session.integrity_violation` / `auth.refresh.fail` **已註冊不增量** |
| `src/js/api.ts` | apiFetch **只**對 `code==='SESSION_REVOKED'` 清 token+導 login；generic 401/403/429/network/malformed 不清（§10 C3）；bump `?v=` cache-bust |
| `tests/integration/refresh.test.ts` | + SEC-REFRESH 矩陣（§10）含 attacker-first pre-fix-fail + **heads>1 integrity_violation** + cap-不阻-first + DB-error |
| `tests/audit-policy.test.ts` / `tests/integration/session-revoke-multi.test.ts` | registry 226 lockstep + `family_revoked` 分類 describe |
| `tests/*`（前端 `api.ts` focused）| SESSION_REVOKED vs generic-401/403/429/network/malformed 分流（OD-SR-B：focused test + 後端 contract + manual smoke，manual-only 不足） |

> refresh.ts 是熱路徑且本 PR 不新增 D1 util；無 coverage category 新增需求。RateLimitKind template literal 不破既有 union typo 防護（prefix 固定）。

## 10. 測試矩陣（owner test list + pre-fix-fail；critical path 必 integration）

| 測試 | 預期（pre-fix 必 RED） |
|---|---|
| **attacker-first（核心 pre-fix-fail）** | 攻擊者搶先 rotate → 受害者呈現舊 token（out-of-grace/device-null）→ **post-fix：family live head（攻擊者 successor）被撤、401 SESSION_REVOKED**；pre-fix：successor 仍 live（RED） |
| victim-first Ordering-B | 受害者先 rotate（live successor）→ 舊 token >30s 後呈現 → family-revoke（接受一次重登）；**不**撤其他 session_id family |
| `successor_token_hash NULL` | **不** family-revoke、**不** critical theft（reason=reuse_detected warn） |
| `grace_device_mismatch` | **不** revoke |
| benign grace orphan | **不** revoke（grace_orphan warn） |
| out-of-grace genuine reuse | family-revoke + 401 SESSION_REVOKED + `auth.refresh.family_revoked` critical |
| device-null candidate | family-revoke |
| dead/missing successor | family-revoke |
| **heads>1 invariant breach（Codex r2 blocker 1）** | seed 同 session_id 2 live head + 對應 revoked predecessor reuse → **`session.integrity_violation` fail-closed + 401 SESSION_REVOKED**；**不** family_revoke（不撤 1 留 1）、**不** emit family_revoked |
| repeated replay（已撤 family，changes=0） | idempotent no-op;emit `auth.refresh.fail` reason=`reuse_detected_family_already_revoked`;**不** emit family_revoked(C1) |
| **C1：changes=0 不冒充 family_revoked** | family 已撤後再 reuse → audit 無 `auth.refresh.family_revoked` row(只 fail/already_revoked) |
| **C2：DB error fail-secure** | casByFamily throw（mock）→ 401 `SESSION_REVOKED` + audit `auth.refresh.fail` reason=`family_revoke_error`;**不簽新 token**、**不** emit family_revoked |
| **cap 不阻 first revoke（OD-SR-2 hard lock）** | 先打滿 family A 的 cap（changes=0 重放）→ 對**另一** genuine-reuse family B 首次呈現 → **仍 family-revoke（changes>0）+ critical** |
| no cross-family | family-revoke 後,同 user **其他** session_id family 的 live token **未**被撤 |
| audit registry | 226 雙 lockstep |
| **前端（C3）** | (a) 401 `SESSION_REVOKED` → 清 token + 導 login;(b) generic 401 → **不**清;(c) 403 / 429 / network error → **不**清;(d) malformed / code 缺 response → **不**清 |

## 11. Decisions（Arch Gate 已裁 + C1/C2/C3 已補）

- **OD-SR-A → 裁定**：cap = **5 / 600s** 起手;**常數集中**（`REFRESH_FAMILY_REVOKE_AUDIT_CAP` / `_WINDOW_SECONDS`，§5，禁 magic number）。
- **OD-SR-B → 裁定**：前端覆蓋 = **後端 contract test（回正確 code）+ focused `api.ts` test + manual smoke**（**manual-only 不足**）;§10 前端 (a)–(d) 已列。若 repo 無前端測試框架,以可跑的 `api.ts` focused test 守 SESSION_REVOKED-vs-generic 分流。
- **Arch Gate C1/C2/C3 已補**：C1（`family_revoked` 只在 `changes>0`，§5/§7）、C2（DB error → 401 SESSION_REVOKED + `family_revoke_error`，§4）、C3（前端只對 `SESSION_REVOKED` 清，§10 (a)–(d)）。
