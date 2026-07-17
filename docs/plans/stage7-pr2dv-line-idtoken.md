# PLAN — Stage 7 PR-2dv：LINE id_token（HS256）驗證 hardening

**Gate state**: ①`CHATGPT_ARCH_APPROVED`（RR1 CLOSED、2026-07-15）→ ②`CODEX_PLAN_APPROVED`（R3、2026-07-15）→ owner `CODING_ALLOWED`（2026-07-17）→ CODE stage 實作 + 機械證據完成 → ⚠ **base-RED 實測掀出 N15（F-2 null-secret）→ owner 裁「回 Plan Gate 正式修 matrix」** → `PLAN_AMENDMENT_R4` → ①`CHATGPT_ARCH_CHANGES_REQUESTED`（R4：Required 3）→ 落修 → **①`CHATGPT_ARCH_APPROVED`（R4 窄複審 + R4b comment-only、2026-07-17；核准矩陣 **DELTA 10 / INVARIANT 6**、base `18b5f72d`）** → **②`CODEX_PLAN_APPROVED`（R4-R5、2026-07-17；五輪 findings 全 CLOSED）** ✅ → **現＝`PLAN_GATE_PASSED`、等 owner 重新明示 `CODING_ALLOWED`**（兩 gate 皆明示：核准 ≠ coding 授權）｜`CODING_ALLOWED=NO`｜**§13 為本輪 amendment SoT**
**SPEC**: `CHATGPT_SPEC_APPROVED_WITH_LOCKS`（v3 + **OD-4 RECONCILED**，`~/Desktop/chiyigo-packets/stage7-pr2dv-line-idtoken-spec-draft.md`）
**base**: `18b5f72d081e510a34a90ffd040b66bf07c2a52e`（IMMUTABLE-BASE）
**canonical worktree**（CODE stage 建）: `C:/Users/User/Desktop/chiyigo-pr2dv`、branch `stage7-pr2dv-line-idtoken`
**級別**: **L3**（runtime/security）｜**高風險加碼層觸發** → §3

> ⚠ **狀態更新（② R4-R3 BLOCKER 落修；本行原為 PLAN stage 快照）**：~~本輪仍 `SOURCE_CHANGE=NO`~~ → **`SOURCE_CHANGE=UNCOMMITTED_IN_WORKTREE`**（實作 3 檔存於 worktree working tree、未 commit；另含 R4b 核准之 F-2 comment-only delta）· **`WORKTREE=IMPLEMENTATION_PRESENT`** · `CODING_ALLOWED=NO`（須 ② 通過 ∧ owner 重新授權）。**狀態 SoT ＝ 本檔 §Gate state（L3）＋ §13.7**。**base 行為一律 CODE stage base-RED 實測（L8），plan 不 assert-as-fact**（[[feedback_dont_assert_runtime_semantics_without_verify]]；self-review v1 掀出多處 base→200 未驗宣稱、已於本版全數改為「CODE stage 實測後定分類」）。
> **self-review v1 fold（2026-07-15、27 agents）**：A1/A2（N14 不可達）→ OD-4 RECONCILED（N14 重分類 CONFIG-GUARD）；A3（rollback nonce）§6.2；A4（error-string pin）§3.1/§6.3；A5（errorFiles typo）§2.2；主線補判（§3.3 溢述 / now===exp DELTA / channelSecret base 未驗 / DEPLOY query / 消費者列舉）皆已 fold。

---

## 1. Scope（= SPEC v3 §5.1）

| 類別 | 檔 | 變更 | 編輯點 |
|---|---|---|---|
| production | `functions/api/auth/oauth/[provider]/callback.ts` **only** | verifyLineIdToken：+alg/+iss/+aud（+`expectedAud`/`channelSecret` guard）/ exp 強制 / nonce 移入+強制；caller CALLER-CLEANUP | verifyLineIdToken body（L702-727）+ caller（L595-600）+ module const `LINE_ISSUER` |
| 新測試 | `tests/integration/oauth-line-idtoken-hardening.test.ts` | DELTA/INVARIANT + 子案；file-local typed helper（含 N2 custom-header） | 新檔 |
| 既有測試 | `tests/integration/oauth-nonce.test.ts` :202 | **僅 N11**：title + 註解 + expectation（200→400） | 單 `it()` |
| 文件 | 本 plan doc | companion | — |

**既有 LINE id_token 測試消費者清單**（A4/spec-scope 補；確認 hardening 不誤傷）：
- `oauth-nonce.test.ts`（4 LINE token，**全含有效 iss/aud/exp + 預設 HS256**；nonce 依測試設計含/缺/不符〔:126/:153 含、:182/:203 蓄意無〕→ alg/iss/aud/exp 零誤傷；唯 N11 反轉改 :202；R2-5 措辭修正）。
- `oauth-callback-guard-fetch.test.ts` T10（wrong secret；含全 claim → alg 過、sig 先敗 → 維持 400）。
- `callback.test.ts:455`（LINE 碰撞 403，**無 id_token** → verifyLineIdToken 不呼叫 → 免疫）。
- grep `signLineIdToken` 全 repo 僅上述兩檔 → **無其他消費者**。

**明禁動**：verifyGoogle/AppleIdToken body（NF-3）· oauth-providers.ts · init.ts · bind-email.ts · **`callback.ts:80-82` CT 子字串 gate**（L61 是 onRequestGet export、非 CT gate；R2-4 修正）· **`callback.ts:76` clientId guard**（本 PR 依賴其 pre-verifier fail-closed、不動）· PR-2du fetch/exchangeCode/timeout · **`callback.ts:164` 全域 catch（禁 Option C）** · env.d.ts · 共用 test helper · **禁 export verifyLineIdToken / 禁 test-only seam**（production scope 最小化 + module-local security verifier + PR-2du F-1；OD-4 R2）· 禁新建 functions/utils/* · ES256/自簽 JWT。

---

## 2. 型別決策 SSOT + ratchet 安全分析

### 2.1 verifyLineIdToken 新簽名（RN-2 nullable-in-verifier；owner OD-4 建議次序）
```ts
async function verifyLineIdToken(
  idToken: string,
  expectedAud: string | null,      // = cfg.clientId（呼叫時已由 L76 收斂為非空字串、見 §2.3 CALLSITE-INVENTORY）
  channelSecret: string | null,    // = cfg.clientSecret（L76 不 guard、可能 null/''）
  expectedNonce: string | null,    // = stored.nonce（OD-2 移入；required、無 default/optional）
)
```
- 全 param 顯式標型；return 維持推斷（不改既有 any 契約、避免 caller cascade）。
- caller（L595）：`verifyLineIdToken(tokens.id_token, cfg.clientId, cfg.clientSecret, expectedNonce)`；刪 L596-598 nonce 區塊（CALLER-CLEANUP）。
- module const **`LINE_ISSUER = 'https://access.line.me'`**（§3 LINE 官方文件複核、pin literal；⚠ 禁 trailing slash / 禁誤用 authorize-URL host＝與既有 4 test token `iss` + oauth-providers.ts:73 host 一致；值錯會壞全 LINE 登入 + 既有 suite）。
- **aud predicate = LINE-AUD-STRING-ONLY**（ARCH-PR2DV-RR1）：`typeof payload.aud==='string' && payload.aud===expectedAud`（expectedAud 先驗非空 string）；**禁 `Array.isArray`/`.includes`**；比 array-includes 更窄更 fail-closed、貼 LINE 官方單-string aud 契約（詳 §3.1/§4.4）。

### 2.2 ratchet 安全（by-construction 分析；**CODE stage forced-tsc 實測**）
| 指標 | 目標 | 理由 | 實測 |
|---|---|---|---|
| errorCount | **381**（不變） | 新 code 每 param 顯式標型；`payload.aud`/`header`/`payload` 自 JSON.parse=any（noImplicitAny 不罰）；string-only `typeof payload.aud==='string'` narrow **不引入 typed callback param**（無 `Array.isArray`/`.every`、ARCH-PR2DV-RR1）→ 無 TS7006 | forced tsc set-diff |
| errorFiles | **17**（不變） | callback.ts 已 CLEAN、新 code 不引 noImplicitAny → **續 17**（⚠ 若變 **18** = callback.ts 淪 error file = **失敗/halt**；A5 修正原誤植「不變 18」） | 同上、callback.ts 續 0 錯 |
| REMOVED | **0** | callback.ts 已 CLEAN、無 TS7031 可清 | set-diff |
| ADDED | **0** | 新 code 全標型 | set-diff |
| cleanFiles | **319→320** | 新 tracked clean `.ts` 測試檔 +1 | ratchet |
| total | **336→337** | 同上 | ratchet |
> **CODE stage lock = `381/17/320/337`、REMOVED=0/ADDED=0**（漂移 halt）。baseline `1119/175` 凍結禁 `--update`。

### 2.3 CALLSITE-INVENTORY-LOCK（owner OD-4 R2 新增機械證據）
- `verifyLineIdToken` **production callsite = 1**：`callback.ts:595`（`fetchProfile` 內，`provider==='line' && tokens.id_token`）。grep 全 repo 確認唯一（非 export、OD-4 lock）。
- 該 callsite 呼叫前 **L76 `if(!cfg.clientId)return htmlError(400)` 已將 `cfg.clientId` 收斂為非空字串** → `expectedAud` 於 L595 恆非空 → verifier 內 `!expectedAud` 分支 **UNREACHABLE_BY_CURRENT_CALL_GRAPH**。
- **若日後新增第 2 caller → 必重判 aud-null 可達性 + 補直接測試**（此 lock 隨 callsite 變動重驗）。

---

## 3. 高風險領域加碼層四件（L3）

### 3.1 State / claim transition（fail-closed；**精確 throw 字串已 pin**，A4）
```
[fetchProfile · provider==='line' ∧ tokens.id_token]
   → verifyLineIdToken(idToken, cfg.clientId, cfg.clientSecret, expectedNonce)   ← cfg.clientId 已由 L76 收斂非空
        ├─ parts.length!==3                    → throw 'Invalid id_token format'   [既有]
        ├─ 【新】alg: header.alg!=='HS256'      → throw 'id_token unexpected alg'   [新字串]     ★alg 先於 sig
        ├─ 【新】F-2 channelSecret null/空      → throw 'id_token signature invalid' [複用既有字串、generic 不洩 misconfig]
        ├─ HMAC-SHA256 verify !valid           → throw 'id_token signature invalid' [既有 L722、逐字不動]
        ├─ 【新】iss!==LINE_ISSUER             → throw 'id_token issuer mismatch'   [新字串]
        ├─ 【新】aud（**LINE-AUD-STRING-ONLY**、ChatGPT ARCH-PR2DV-RR1）：`typeof expectedAud!=='string' ∨ expectedAud 空` **或** `typeof payload.aud!=='string' ∨ payload.aud!==expectedAud` → throw 'id_token audience mismatch'。**禁 `Array.isArray`/`.includes`**（LINE aud 恆單 string、HS256 multi-audience 未定義）；missing/null/array/object/number/空/mismatch 全拒 [新字串；expectedAud-null 亦此、UNREACHABLE DiD]
        ├─ 【緊】exp: 非 number ∨ **非 finite** ∨ now>=exp → throw 'id_token expired' [既有 L725 字串；F-3 `>=` 強制存在 + Codex `!Number.isFinite`（拒 `1e999`→Infinity，typeof 為 number 但 now>=Infinity=false 會漏放）]
        └─ 【緊+移】nonce: expectedNonce 空 ∨ token nonce 空/型別錯/!== → throw 'id_token nonce mismatch' [既有字串；caller→verifier 移入+強制]
        → ✅ return payload → lineEmail = payload.email ?? null
   →（verify 成功後才）fetchUserInfoWithRetry(…)   ← ORDER-LOCK
```
- **throw 字串盤點**：**新增 3 字串**＝`id_token unexpected alg` / `id_token issuer mismatch` / `id_token audience mismatch`；**複用既有 3 字串**＝`id_token signature invalid`（+F-2 channelSecret guard 亦用此）/ `id_token expired`（exp 語意收緊、字串不變）/ `id_token nonce mismatch`（caller→verifier 移入、字串不變）。**皆帶 `id_token ` 前綴**（A4：v1 誤 drop 前綴、誤標既有為「新 throw」，已改）。
- 任一 throw → caller catch（L162-165）→ audit `reason_code:'profile_fetch_failed'`（不變）+ `htmlError(400)`。**NO-SECRET-LOG**：字串皆 claim-type label、不含 secret/token/nonce/payload 值。

### 3.2 Failure modes（每 reject 防的攻擊）
alg!==HS256（謊報 RS256+HMAC 簽）→ 未來 refactor 誤走非對稱/alg-confusion 顯式化（N2 DELTA，證獨立 gate）｜iss 錯/缺 → 他 IdP token 冒充（N4/N5）｜aud 非 string-exact（錯 string / 缺 / null / **array〔含或不含皆拒〕** / 非 string 型別）→ 跨 channel 重放 + HS256 multi-audience 未定義行為（N6/N7/N8/**N9 全 DELTA reject**；LINE 官方 aud 恆單 string、ARCH-PR2DV-RR1）｜exp **缺/non-coercible 非數字（NaN）/`1e999`→Infinity（Codex `!Number.isFinite`）→ N10 DELTA** ＋ **now===exp 邊界 → DELTA**（F-3 `>=`）；⚠ **past 數字 exp 及 coercible 非數字（轉型為過去值）→ base L725 `>` 已拒＝INVARIANT、非 DELTA**（R2-1 + Codex TS-BOUNDARY-001，見 §4.3）｜nonce（stored NULL/token 缺/不符）→ id_token replay（N11 DELTA/N12 INVARIANT）｜**channelSecret null（未設）→ base `encode(null)` 產生字面 `"null"` 4-byte HMAC key、`importKey` 接受 → 攻擊者以 key `"null"` 自簽即通過驗章（實測 base 200 + 建帳號 + 簽發 access_token）＝**N15 DELTA**、F-2 load-bearing 坐實**；**channelSecret `''` → workerd `importKey` 拒 0-length key→base 已 400＝N13 子案 INVARIANT**（皆 2026-07-17 實測，§13）。

### 3.3 Idempotency / purity（**§3.3 溢述已修正**，主線補判）
- verifyLineIdToken = **純函式**（無 side effect、除 `Date.now()` 讀 exp）；同輸入同結果 → 無 idempotency key 需求。
- **ORDER-LOCK-R2（ChatGPT Arch 明確化，區分兩類避免 Code Gate 誤判既有流程）**：
  - **允許在 verifier 前**：① `oauth_state` 一次性核銷（L107）② 向 LINE token endpoint 交換 authorization code（`exchangeCode`、使 code 失效）——皆**既有一次性安全資源消耗、本 PR 不改**。
  - **禁在 verifier 成功前**：① LINE userinfo fetch（L604）② 本地帳號/identity 查詢·連結 ③ user/identity/session 業務資料寫入 ④ 本站 access/refresh/session token 簽發。
  - verifier 失敗後**不得復原或重用已核銷 state/code**（使用者重跑 OAuth、既有 fail-closed 語意）。
  - 故「失敗不留痕」**僅對 verifier 下游成立、非全流程**（v1 全流程宣稱過度，已改；與 §6.2 一致）。現結構已滿足、保留不 reorder。

### 3.4 Retry + timeout
**無**：verifyLineIdToken 為 local crypto（`crypto.subtle`、無 network）→ 無 timeout/retry；失敗確定性、不 retry。JWKS N/A（LINE HS256 無 JWKS）。

---

## 4. 測試計畫

### 4.1 檔案
- **新檔** `oauth-line-idtoken-hardening.test.ts`：DELTA + INVARIANT + 子案；harness 沿 oauth-nonce 形狀（file-local，不 import _helpers LINE 部分）。
- **edit** `oauth-nonce.test.ts:202`：N11 反轉（title/註解/expectation 200→400）；**僅此、不搬 helper**（N11-NARROW-EDIT）。

### 4.2 file-local typed helper（OD-3；TYPED-HEADER、禁 any）
```ts
interface LineJwtHeader { alg: string; typ: 'JWT' }
interface LineIdTokenClaims { iss?: string; sub?: string; aud?: unknown; exp?: unknown; nonce?: string; email?: string; [k: string]: unknown }  // ⚠ aud/exp=unknown（R2-3/R4）：允許 AUD-TYPE-FAIL malformed aud（[123]/123/[]）+ 非數字 exp（"not-a-number"/{}/"1000000000"/[]）測試構造，不觸 TS2322、不需 any/cast（否則測試檔非 clean、破 ratchet lock）；verifier 端 payload.aud/exp 本就 any。valid number exp 亦 assignable to unknown、不影響 happy path
async function signLineIdToken(payload: LineIdTokenClaims, secret: string): Promise<string>              // 預設 HS256 header
async function signLineIdTokenWithHeader(payload: LineIdTokenClaims, header: LineJwtHeader, secret: string): Promise<string>  // N2：header.alg 可謊報、簽章固定 HMAC-SHA256+channel secret
async function signLineIdTokenWithRawPayload(payloadJson: string, secret: string): Promise<string>       // Codex TS-BOUNDARY-001：注入 raw payload JSON 字串（如 `{...,"exp":1e999}`）；因 JSON.stringify(Infinity)==='null'、object-based signer 無法產出 Infinity、須直接 base64url(payloadJson)
```
- **N2-EXPLICITNESS**：`signLineIdTokenWithHeader({…valid…}, {alg:'RS256',typ:'JWT'}, 'line-channel-secret')`。禁泛用 `signJwt({header,payload,algorithm,key,…})`。

### 4.3 base-RED 方法（L8；**base 行為 CODE stage 於 canonical worktree 實測、不 assert-as-fact**）
- **DELTA_RED**（N2,N4,N5,N6,N7,N8,**N9**,N10,N11）：測試 assert cand（400）→ **copy callback.ts 回 base** 跑 → **必 RED**（base 200 / test 期 400）→ 還原 candidate → GREEN。〔N9 array 由 ARCH-PR2DV-RR1 反轉入 DELTA〕
- **INVARIANT_GREEN**（N1,N3,N12,N13,**N14**）：base ∧ candidate 皆 GREEN（禁逼 pre-fix RED）。
- **⚠ base 行為須實測、不預斷（self-review v1 教訓）**：
  - **N14（LINE_CLIENT_ID null/''）**：base=**400**（L76 pre-verifier guard、非 verifier aud 分支）、cand=400 → **INVARIANT_GREEN/CONFIG-GUARD**（證既有 config fail-closed；**不**證 verifier aud-null 分支＝UNREACHABLE DiD）。**移出 DELTA_RED**（v1 誤標）。
  - ~~**channelSecret=''**：base 行為 **UNVERIFIED**~~ → **RESOLVED（2026-07-17 CODE stage 實測，見 §13）**：workerd `importKey` **拒絕** 0-length HMAC key（拋 `Imported HMAC key length (0) must be a non-zero value…`）→ base 該例外經 L162 catch → **400** ⇒ **`INVARIANT_GREEN`**（即原文「若 importKey 拒空 key 則 base 400＝INVARIANT」分支成立）。⚠ 連帶：`''` 子案**無法**證 F-2 load-bearing（原文設想的「空 secret 簽 + 空 secret 驗」構造在 workerd 不可建——signer 端 importKey 同樣拋錯）→ load-bearing 改由 **N15（channelSecret=null）** 坐實，見 §13。
  - **N10 exp DELTA 範圍（R2-1，含 JS 鬆散轉型精確化 + Codex Infinity）**：base L725 = `if (payload.exp && Date.now()/1000 > payload.exp) throw`（`>` 對 truthy 非數字**強制轉型**）。cand（F-3 + Codex）= `typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || now >= payload.exp`。
    - **DELTA 案（base 200→cand 400）**：`exp 缺（undefined、base falsy 跳過）` / `exp non-coercible 非數字（NaN，如 `"not-a-number"`/`{}` → base `now>NaN`=false 跳過〔非 `&&` 短路〕）` / **`exp=1e999`→Infinity（base `now>Infinity`=false→200 / cand `!Number.isFinite`→400；Codex TS-BOUNDARY-001；因 `JSON.stringify(Infinity)='null'`、須 `signLineIdTokenWithRawPayload('{...,"exp":1e999}')`）** / `now===exp 邊界`。
    - ⚠ **INVARIANT（base 已 400、非 DELTA）**：`past 數字 exp` **及** `coercible 非數字轉型為過去值`（如 `"1000000000"`/`[]`/`[123]` → base `>` 轉型後 true→throw→400）。**若拿這些構 N10 DELTA test，base-swap 會回 GREEN 非 RED、違 §4.3 必RED** → 另立 INVARIANT 附測。N10 DELTA test 一律用 non-coercible/undefined/Infinity/邊界值。
  - **now===exp 邊界**：F-3 `>`→`>=` 使邊界成新 reject（base `now>exp`=false→200 / cand `now>=exp`=true→400）＝**DELTA**（需 `vi.setSystemTime` fake-timer 控 `Date.now()===exp`）。
  - **expectedNonce=''**：base caller `if(''&&…)` falsy→跳過→200 / cand `!expectedNonce`→throw→400＝**DELTA**（可達：seed `oauth_states.nonce=''`）。
  - **expectedAud=''**：**不可達**（L76 `!cfg.clientId` 攔）＝併入 N14 CONFIG-GUARD、非獨立 DELTA。
- **AUD 非-string 子案（LINE-AUD-STRING-ONLY、ARCH-PR2DV-RR1；皆可達 DELTA）**：`aud=[]` / `aud=['line-cid']` / `aud=['line-cid','other']`（**array 含也拒**）/ `aud=[123]` / `aud=123` / `aud={}` / `aud=null` / aud 缺 → **全 reject**（cand `typeof payload.aud!=='string'`→400）；base 無 aud 檢查→200 → 皆 DELTA。**禁 `Array.isArray`/`.includes`**。合法 happy = `aud='line-cid'`（string）→ 200/200（N3 承擔）。
- **機械斷言**：`res.status` + DB user/identity count（沿 oauth-nonce 形狀）。

### 4.4 N-matrix（= SPEC v3 §6 + OD-4 RECONCILED）
~~**DELTA_RED = N2,N4,N5,N6,N7,N8,N9,N10,N11（9）**~~ → **§13 R4 supersede：DELTA_RED = N2,N4,N5,N6,N7,N8,N9,N10,N11,**N15**（10）**｜~~**INVARIANT_GREEN = N1,N3,N12,N13,N14（5）**~~ → **RR1 落修：INVARIANT_GREEN = N1,N3,N12,N13,N14,**N15-control**（6）**（ChatGPT ARCH-PR2DV-RR1：**N9 array 由 INVARIANT-accept〔200/200〕反轉為 DELTA-reject〔200/400〕**；**R4：N15 新增＝F-2 null-secret DELTA、N13 `''` 子案定為 INVARIANT，見 §13**）。
- N14 = `INVARIANT_GREEN / CONFIG-GUARD`（LINE_CLIENT_ID null/'' → base 400/cand 400 via L76）。
- **⚠ aud 語義 = LINE-AUD-STRING-ONLY（ARCH-PR2DV-RR1，取代 R5-1 includes）**：`typeof payload.aud==='string' && payload.aud===expectedAud`；**array（含或不含）/ 非 string 型別 / 缺 / null / 空 全拒**。理由＝LINE 官方 aud 恆單 String（Channel ID、非 array）；OIDC 對 **HS256（MAC）multi-audience 未定義**、`includes` 無法證其他 audience 受信任 → **provider-local 契約 > 表面對稱 jose**（Google/Apple 用 jose generic OIDC audience 不代表 LINE 須接受官方未承諾的 array shape）。**禁 `Array.isArray`/`.includes`/`azp`/trusted-aud registry**（後者 scope creep）。
- **N8/N9 = DELTA reject**：N8 `aud=['other']`（array 不含）/ N9 `aud=['line-cid','other']`（**array 含也拒**）→ base 200（base 無 aud 檢查）/ cand 400。aud gate load-bearing 由 N6（錯 string）/ N7（缺）/ N8/N9（array 全拒）證；合法 string happy = N3（`aud='line-cid'`→200/200）。
- **AUD-TEST-LOCK-R2**（owner OD-4）：①N6/N7/N8/N9 測 verifier 可達 aud 行為 ②N14 測 callback 對 clientId null/'' 既有 pre-verifier 400 ③verifier `!expectedAud` guard 保留為 unreachable-by-current-call-graph DiD ④禁為覆蓋該 branch export/test-seam/DI/改 visibility ⑤N14 不納 base-RED。

### 4.5 Coverage 限制（owner OD-4）
先跑真實 `test:cov`。**禁** `/* c8 ignore */`·`/* istanbul ignore */`·export verifier·test-only runtime branch·降 coverage threshold 去覆蓋不可達 DiD。**若不可達 DiD branch 致既有 coverage gate 失敗 → 回 Plan Gate 重裁、不得 CODE 階段自行繞過。**

---

## 5. DEPLOY-EVIDENCE（OD-1；schema-accurate、CODE→merge/部署前 prod 唯讀查）
```sql
SELECT COUNT(*) AS active_missing_nonce_line_states
FROM oauth_states
WHERE redirect_uri LIKE '%/api/auth/oauth/line/callback'
  AND (nonce IS NULL OR nonce = '')      -- candidate fail-closed 拒 NULL∨''（!expectedNonce）；predicate 對齊拒絕集；alias 反映 NULL∨''（Codex GOV-DRIFT-001）
  AND expires_at > datetime('now');
```
- ⚠ `oauth_states` **無 `provider` 欄**（base 欄 + 後續 migration 另加 nonce/aud/created_at/ip_address/purpose/elevation_user_id/session_id/action/factor_add_grant_hash 等；R2-6：非窮盡列舉，本查詢僅用 `redirect_uri`/`nonce`/`expires_at`，皆存在）→ 以 redirect_uri 識別 LINE。NULL-nonce 對 discord/facebook 正常（migration 0010）→ 必限 LINE。
- `nonce=''` prod 不可達（init.ts 只寫 randomHex/null）但 candidate 亦拒 → 補 `OR nonce=''` 使 predicate 對齊拒絕集（穩健、無害）。
- 走 `wrangler d1 execute <DB> --remote --command "…"`（唯讀 SELECT）；`expires_at` = `YYYY-MM-DD HH:MM:SS` UTC TEXT 用 `datetime('now')`。
- 判讀：只記「於 `<checked_at>` 查得 `N`」；**禁**「證明永不存在」。非零 → 等一完整 TTL(10min) 後再查或明示接受極少數瞬間登入失敗。

---

## 6. Migration / rollback / observability

### 6.1 Migration
DB/schema migration：**無**；部署設定變更：**無**；env key：**無新增**。code 變更：alg/iss/aud＝真 additive；**例外：exp＝既有弱檢查（L725）強化、nonce＝跨檔 relocate；兩者非 additive、rollback 見 §6.2**（B/R2-2 傳播）。

### 6.2 Rollback（forward / selective 優先；**A3 修正 nonce 非 additive**）
| 故障 | 首選處置 |
|---|---|
| **alg/iss/aud** 新檢查誤擋 | **可 selective 撤該單一檢查**（**真 additive**、base 無此檢查、各自獨立）；N3/N9/N12 + suite 先攔 |
| **exp / nonce 硬化須撤** | ⚠ **非 additive、禁只刪 candidate 檢查**（R2-2 + A3）——**exp** 是**既有弱檢查的強化**（base L725 `if(payload.exp && now>exp)`）：刪整 exp block → 連 base 弱檢查一併移除 → **過期 token 被收**；**nonce** 是**跨檔 relocate**（caller L596-598 刪 + verifier 新增）：只撤 verifier throw → caller 已刪 ∧ verifier 不檢查 → **replay 校驗消失**。兩者皆**靜默降到 baseline 以下、無型別報錯**。撤 exp 須**還原 base 弱檢查**、撤 nonce 須**還原 caller L596-598**、或 `git revert` 整包。 |
| N11 反轉致瞬間登入失敗 | DEPLOY-EVIDENCE 前查（§5）；非零等 TTL；真發生 → 使用者重跑 OAuth |
| 緊急全撤 | `git revert` 整包（同退 5 項 + N11 + nonce relocate 一致還原） |
- **AMENDMENT-LOCK**：舊 `NULL→200`（oauth-nonce.test.ts:202 原策略）→ 新 `NULL→400`；理由＝OD-1 fail-closed + DiD；裁決 2026-07-15。
- **ROLLBACK-LOCK-R2（ChatGPT Arch；⚠ **R4 補列 F-2 條款、見 §13.5**）**：**預設 rollback = revert PR-2dv 完整 production commit**。**⓪【R4 新增·最高】F-2／`CHANNEL-SECRET-REQUIRED` 不得單獨撤除**（已由 N15 證為認證安全邊界；替換須同一變更提供等效或更強 fail-closed replacement + 保留 N15 等價回歸證據 + 重過 Arch／Plan／Code Gate；**禁以刪除或弱化 N15 為 rollback 手段**）。若 selective：① alg/iss/aud 可移除其新增檢查（真 additive）② **exp 必精確恢復 base 條件式檢查**（`if(payload.exp && Date.now()/1000 > payload.exp)`）③ **nonce 必同時恢復 caller 原檢查（L596-598）與 verifier signature/callsite**（禁只刪 verifier nonce block）④ selective rollback 後**必重跑完整 N-matrix / ratchet / lint / test:int / build:functions**。因 nonce 涉「搬移＋強制」兩變化、只撤 verifier 端會使驗證完全消失。

### 6.3 Observability / ERROR-CONTRACT（**A4 修正**）
- **新增 3 throw 字串**（alg/iss/aud）+ **複用既有 3**（signature/expired/nonce）；皆帶 `id_token ` 前綴、claim-type label、**NO-SECRET-LOG**。exp/nonce 語意收緊（強制）但字串不變。
- 對外沿既有 caller catch（L162-165、**不動**）→ audit `reason_code:'profile_fetch_failed'`（不變）+ `htmlError(400)`。**ERROR-CONTRACT**：aud-null（含 misconfig）與 aud-mismatch 同訊息、nonce 各失敗同訊息 → client 無法區分 misconfig/state-corruption vs claim mismatch。**禁 Option C 改 L164**（audit reason_code 折疊＝既有語意、本 PR 不擴充詞彙、零 regression）。
- **NB-1（ChatGPT Arch，誠實界定）**：error-string pin **僅涵蓋顯式 `throw new Error(...)`**。新增 header `JSON.parse`／Base64URL decode 的**底層解析錯誤**（malformed header/payload）仍可能由既有 `err.message` 路徑回顯 → **不宣稱所有 malformed token 都得固定錯誤文字**；本 PR **不擴張改全域 catch**（超 scope）。此類解析錯誤仍 fail-closed（throw→400），只是訊息非本 PR pin 的固定字串。

---

## 7. Faithfulness packet 計畫（④ ChatGPT）
`[provider]` 路徑 → code-self-review.mjs 拒 `[` → **人工補完整 hunk**：verifyLineIdToken body（前後）+ caller callsite（含 L596-598 刪除）+ `LINE_ISSUER` const + oauth-nonce.test.ts:202 diff + 新測試檔 + 機械 `git diff --name-status`（pathspec `:(literal)…callback.ts`）。decision points（完整 hunk）：alg/iss/aud/exp/nonce gate + CALLER-CLEANUP（nonce 位移）+ N11 反轉 + **verifier aud-null UNREACHABLE DiD 標註 + CALLSITE-INVENTORY**。

---

## 8. Merge-front CI-mirror gates（SPEC L9；讀真實輸出不推理）
`lint` · `typecheck:ratchet`（=381/17/320/337）· `verify:browser-pipeline` · **`test:cov`**（含 coverage threshold、§4.5）· `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。CODE stage 於 canonical worktree（`npm ci` 後）跑齊。

## 9. Gate 序列 + 下一步
- Phase 1 進度：`PLAN_SELF_REVIEW_CLEAN`（維度 A workflow 27-agent + 多輪對抗）→ ① `CHATGPT_ARCH_APPROVED`（RR1 CLOSED）✅ → ② Codex Plan `CHANGES_REQUESTED`（BLOCKER exp-Infinity + MAJOR gov-drift，已落修）→ ② `CODEX_PLAN_APPROVED`（R3）✅ → owner `CODING_ALLOWED`（2026-07-17）。
- ⚠ **CODE stage 已執行並於 base-RED 實測掀出 N15 → 回 Plan Gate（§13）**：現 `CODING_ALLOWED=NO`，待 ①② 回覆 R4 amendment 後才續 CODE（實作與機械證據已完成、保留於 worktree、未 commit）。

---

## 13. R4 amendment — CODE-stage base-RED 實測（2026-07-17；supersedes §3.2 channelSecret 句 / §4.3 channelSecret='' 列 / §4.4 matrix count）

> **觸發**：owner 裁決「回 Plan Gate 正式修 matrix」（2026-07-17），因 CODE stage 實測掀出 approved matrix 未涵蓋的 F-2 null-secret DELTA。**本節為 R4 amendment SoT**；§3.2/§4.3/§4.4 已 in-place 標記指向本節。

### 13.1 觸發經過（誠實紀錄）
approved matrix 的 **N13 `channelSecret=''` 子案**原用於「證 F-2 load-bearing」，plan §4.3 明令 base 行為 CODE stage 實測。實測結果**與該子案的設計前提相反**：
- 首版測試以 `''` 簽 + `''` 驗 → **測試自身的 signer 就拋錯**（`Imported HMAC key length (0) …`），根本沒走到 callback ⇒ 該版測試是**壞測試、非 DELTA 證據**（若不查失敗原因、只看「base RED」就會**誤判為 DELTA**——[[feedback_regression_test_must_lock_exact_failure]] 實例）。
- 修正構造（伺服器 `''`、以正常 secret 簽）→ base ∧ cand 皆 400 ⇒ **N13 子案 = INVARIANT_GREEN**。

### 13.2 實測事實（workerd + 真 D1；probe 已跑完即刪、非 committed test）
| probe | 實測結果 | 意義 |
|---|---|---|
| `importKey('raw', encode(''), HMAC)` | **THROW**（`Imported HMAC key length (0) must be a non-zero value…`） | base 對 `''` 已 fail-closed（但成因是未捕捉的 crypto 例外、且訊息回顯錯誤頁＝洩 misconfig）；cand 以顯式 guard + generic 訊息達成 ⇒ N13 子案 INVARIANT |
| `new TextEncoder().encode(null)` | **4 bytes、decode = `"null"`** | `encode(null)` 走 ToString(null) ⇒ 產生字面 `"null"` 的 key material |
| `importKey('raw', encode(null), HMAC)` | **NO-THROW** | base 用 key=`"null"` 驗章 |
| **full flow @ base**（`LINE_CLIENT_SECRET` 未設 + 攻擊者以 key `"null"` 自簽 valid claims） | **status 200 · users created = 1 · 簽發 access_token**（body 含 `null-key@line.example` 的 JWT） | **base 200 → cand 400 ＝ DELTA**；F-2 `typeof channelSecret !== 'string'` **load-bearing 坐實** |

### 13.3 N15（新增 DELTA_RED）+ N15-control（新增 INVARIANT_GREEN）— **ARCH-R4-RR1 落修**

| # | 類別 | 案例 | base | cand | item |
|---|---|---|---|---|---|
| **N15** | **DELTA_RED** | `LINE_CLIENT_SECRET` 未設（`cfg.clientSecret = null`）+ 攻擊者以字面 `"null"` 為 HMAC key 自簽全 valid claims | **200**（建帳號 + 簽 token） | **400** | signature / F-2 CHANNEL-SECRET-REQUIRED |
| **N15-control** | **INVARIANT_GREEN** | `LINE_CLIENT_SECRET = 'null'`（**字串**）+ **與 N15 完全相同的 id_token fixture** | **200** | **200** | 證 fixture claims 全 valid ∧ 簽章真可驗 ⇒ N15 的 400 只可能來自 F-2 |

**`N15-LOAD-BEARING-LOCK`（ARCH-R4-RR1 採納，逐字納入）**：
> N15 MUST mechanically prove successful token exchange and otherwise-valid claims before asserting candidate 400, and MUST assert zero account/session/access-token side effects.

**oracle 實作規格（6 項，全部已 probe 實測可達，見 §13.3a）**：
1. **mock token exchange 成功回傳 ∧ verifier 已抵達** → 斷言 `fetchCalls` 含 token endpoint（`/oauth2/`）。⚠ **措辭精確化（`CODEX-R4-MAJOR-3` 落修）**：~~「token exchange 成功且被消費」~~——`fetchCalls` **只證明呼叫發生**，**不證明外部 authorization code 真被消費**（該事實屬 LINE 端、mock 環境無從觀測）。本項證的是「flow 已越過 token 交換、進入 verifier」，不宣稱更多。
2. **其餘 claims 全 valid 之完整 id_token** → 由 **N15-control（**重用同一 token 字串** + secret='null' 字串 → 200 登入成功）機械證明**；非靠結構論述。
3. candidate 回 **400**。
4. **`users` 新增 = 0**。
5. **登入成功副作用 = 0**：`refresh_tokens` = 0 ∧ response body 不含 `access_token`。
6. **歸因 CHANNEL-SECRET-REQUIRED**（非泛化 status oracle）：三重機械證據——(a) `userinfo` **未**被呼叫（`fetchCalls` 不含 `/v2/profile`）⇒ 失敗發生於 verifier 內、userinfo 之前；(b) 錯誤訊息屬 signature 家族（`id_token signature invalid`）⇒ 排除 alg/iss/aud/exp/nonce gate；(c) **N15 vs N15-control 唯一差異＝`LINE_CLIENT_SECRET` 未設 vs 字串 `"null"`**（**token 字串逐 byte 相同、見 `N15-SHARED-TOKEN-LOCK`**）→ 400 vs 200 ⇒ 拒絕**只可能**源自 `typeof channelSecret !== 'string'`。

**`N15-SHARED-TOKEN-LOCK`（`CODEX-R4-MAJOR-3` 落修；新增）**：
> N15 與 N15-control **必須重用同一個 id_token 字串**：於 describe scope 內以 `beforeAll` 產生**一次** `n15IdToken`（key = 字面 `"null"`），兩個 `it()` 直接引用該字串常數。**禁止各自呼叫 signer 重新產生**。
>
> **理由（非形式主義）**：fixture 的 `exp` 取自 `Math.floor(Date.now()/1000)+600`。若兩個 `it()` 各自產生 token，**跨秒邊界時 `exp` 差 1 → payload bytes 不同 → 簽章不同 → 單變數差分前提破裂**（變成「兩個不同 token + 兩種 secret 設定」的雙變數比較），歸因失效且**偶發**（多數執行仍同秒 → 綠 → 假安全）。語義相同 **不等於** byte 相同；本 lock 要求後者。

**⚠ 影響 §13.3a 實測有效性**：既有 probe 是**兩個獨立 `it()` 各自 sign**（同 describe、無共享 token）⇒ 其單變數差分**在跨秒時不成立**。probe 結論（base 200 / cand 400 · control 200/200）本身仍有效（各案獨立成立），但**「逐字相同」的歸因須待 committed test 依本 lock 實作後才機械成立**。CODE stage 必以共享 token 重跑坐實。

### 13.3a oracle 實測（probe 已跑完即刪、非 committed test；候選與 base 各一輪）

| 情境 | base | candidate |
|---|---|---|
| **N15 main** | `status=200` · `users=1` · `refresh_tokens=1` · mock exchange 成功回傳=**true** · userinfo=**true** · **簽發 access_token** | `status=400` · `users=0` · `refresh_tokens=0` · **mock exchange 成功回傳=true ∧ flow 已抵達 verifier** · userinfo=**false** · `id_token signature invalid` · 無 access_token |
| **N15-control** | `status=200` · `users=1` · `refresh_tokens=1` | `status=200` · `users=1` · `refresh_tokens=1` |

⇒ N15 = DELTA（200→400）、N15-control = INVARIANT（200/200）、oracle 6 項全可機械斷言。

- **矩陣變更**：`DELTA_RED 9 → **10**`（+N15）｜`INVARIANT_GREEN 5 → **6**`（+N15-control；**RR1 落修新增**，原 R4 提案為 5）。
- **N13 主案（錯 secret 簽）**：INVARIANT_GREEN，不變。

### 13.4 風險定性（**ARCH-R4-RR3 落修：改 current-path exposure、不作絕對定性**）

> **latent misconfiguration-conditional authentication bypass；目前 production exposure 未觀察到。**
> 現行真 LINE exchange 順序與已設定的 production secrets 降低當前可利用性，**但不作為安全邊界**。F-2 是 fail-closed security hardening，封堵 verifier 可達時的帳號建立與 token issuance。

- **PR 性質（RR3 採納）**：~~一般 additive DiD~~ → **security hardening／latent bypass prevention**（**不**升格為「已遭利用的 live vulnerability fix」）。
- **降低當前可利用性的事實（皆非永久安全屬性、不得倚為邊界）**：① prod 三把 secret 已設 ② 現行 callback 順序下真 LINE token endpoint 預期先拒 `client_secret=null`（probe 能抵達 verifier 係因 token endpoint 被 mock）。以上依賴**部署狀態 / 外部服務行為 / 流程順序**，任一改變即失效。
- **R4 amendment 不新增 production runtime 變更**：F-2 guard 早在 approved SPEC §4 code block 內（`typeof channelSecret !== 'string' || channelSecret.length === 0`、**predicate 逐字不變**），N15/N15-control **只新增測試**。
- ⚠ **措辭更正（`CODEX-R4-BLOCKER-1` + ① R4b-NB 落修）**：~~「production diff 不變」~~ →
  > **相對於前次送審的 R4 candidate**，runtime logic **byte-unchanged**；production 檔唯一新增 delta ＝ **F-2 安全註解更正（comment-only）**。
  >
  > ⚠ **這不是**指 candidate 與 base `18b5f72d` 的 production runtime diff 為零——**相對 base，本 PR 本來就新增 5 道 fail-closed 檢查 + caller 位移**（見 §1/§3.1）。**比較基準必須讀作「R4 candidate ↔ R4b candidate」，非「base ↔ candidate」**（① R4b-NB：防 ③／④ 誤讀基準）。
  - **機械坐實**：去除註解行後與前次 R4 candidate **逐字相同**（`diff` 空輸出）；forced tsc vs base ＝ **381 unique · ADDED=0 · REMOVED=0**。
  - 該註解更正經 **① `CHATGPT_ARCH_APPROVED`（R4b、2026-07-17）** 核准納入 R4 scope（packet `stage7-pr2dv-arch-r4b-comment-confirm.md`）。

### 13.5 對 locks / 既有裁決的影響
- `CHANNEL-SECRET-REQUIRED`（F-2）：predicate **不變**（措辭已涵蓋 null/空）；地位由「一般 additive」升為**認證安全邊界**（RR2）。
- **`ROLLBACK-LOCK-R2` 補列（ARCH-R4-RR2 採納，逐字納入；取代原「可 selective 撤 + 同步刪 N15」提案——該提案 ① **不核准**）**：
> F-2／`CHANNEL-SECRET-REQUIRED` **不得單獨撤除**。只有在同一變更中提供等效或更強的 fail-closed replacement、保留 N15 等價回歸證據，並重新通過 Architecture／Plan／Code Gate，才可替換。**不得以刪除或弱化 N15 作為 rollback 手段。**
- 其餘 locks（LINE-AUD-STRING-ONLY / OD-1..4 / RN-1/2 / ORDER-LOCK-R2 / DEPLOY-EVIDENCE / NB-1）：**不受影響**。
- ratchet 目標：**不變** `381/17/320/337`、`REMOVED=0/ADDED=0`（N15 + N15-control 僅為既有新測試檔內 +2 個 `it()`、不新增檔案）。

### 13.6 N13 `''` 子案（ARCH-R4 Non-blocking 落修）
斷言收斂為**穩定外部行為**：`status 400` ＋ **零帳號／零 token 副作用**；**不 pin** workerd crypto exception 字串（runtime 升級會使測試脆弱）。crypto 例外原文僅記錄於本 plan §13.2 作為**成因說明**，不入測試斷言。

### 13.8 DOC-SYNC-LOCK（**`CODEX-R4-MAJOR-4`**〔State Consistency / `GOV-DECISION-001`〕落修；新增）
> ⚠ **標號更正（② R4-R2 BLOCKER-2 落修）**：本節原誤標 `CODEX-R4-MAJOR-3`（那是 `N15-SHARED-TOKEN-LOCK` / `GOV-EVIDENCE-001`）；**正確為 `MAJOR-4` / `GOV-DECISION-001`**。

**問題**：canonical plan 現存於 `chiyigo.com/main` 的 **untracked** 路徑，而實作在 `chiyigo-pr2dv` worktree —— implementation worktree 內**沒有**該文件 ⇒ **隱含 split**（審查者無法從單一 tree 取得「實作 + 其 plan」的一致快照）。

**裁定（採「單一 commit、byte-identical 帶入」，非 source/docs 分離）**：

1. **PLAN stage（現在）**：canonical ＝ `chiyigo.com/main` working dir 的 `docs/plans/stage7-pr2dv-line-idtoken.md`（untracked）。SPEC §5.1 早已將本 doc 列為 PR scope 的 **companion**，故它**屬於本 PR、與 source 同 commit**。
2. **CODE stage 恢復當下（第一個動作）**：byte-identical copy 進 worktree `docs/plans/` + **SHA-256 比對坐實**。⚠ **可執行性修正（② R4-R2 MAJOR）**：本專案主 shell ＝ **PowerShell 5.1、無 `sha256sum`**（原文指令不可執行）。**固定用以下其一**：
   ⚠ **必須 fail-closed ＋ 可安全重跑（② R4-R3 MAJOR 落修）**：**禁無條件 `Copy-Item -Force`**。理由——CODE stage 允許「只改 worktree 副本」（見 3.），若首次 copy 後 worktree canonical 已被編輯，**無條件 `-Force` 重跑會用 stale main 副本覆寫 canonical**，而其後的 SHA-256 比對**當然相同** ⇒ **「資料已丟失但證據綠燈」**（假綠的最惡型態：證據自我實現）。

   ⚠⚠ **`GOV-FAIL-001`（② R4-R4 BLOCKER）：前版演算法本身 fail-open、已作廢**。② 以「source 與 destination 皆不存在」重跑前版 → `Get-FileHash`/`Copy-Item` 只報**非終止錯誤** → `$srcHash=$null`、`$dstHash=$null` → `$null -ne $null` 為 **false** → **印出 `DOC-SYNC OK:`、什麼都沒複製、exit 0**。⇒ **前版仍是假綠**（路徑打錯／source 消失／讀取失敗皆可觸發）。**根因＝我上版只測了自己設計時預期的分支，未測「source 不存在」**。

   **precondition + 五分支演算法（現行）**：
   | 情境 | 動作 |
   |---|---|
   | **source 不存在／非檔案** | **立即 throw**（precondition；**禁繼續**、禁建立 destination） |
   | 任何 `Get-FileHash`／copy 失敗 | **`-ErrorAction Stop` 轉終止錯誤**（禁非終止錯誤靜默過關） |
   | **destination 不存在** | **原子 no-clobber copy**：`[System.IO.File]::Copy($src,$dst,$false)`（避免 check→copy 之間 destination 出現而被覆寫的 TOCTOU） |
   | **destination 已存在 ∧ hash 相同** | **no-op**（已完成、idempotent） |
   | **destination 已存在 ∧ hash 不同** | **立即 halt、禁覆寫** → 人工判定（多半是 worktree canonical 已被正當編輯 ⇒ **正確方向是以 worktree 為準**，絕非反向覆寫） |
   | 收尾 | 一律做 source／destination **SHA-256 相等斷言** |

   ```powershell
   # PowerShell 5.1（主）— fail-closed、可安全重跑、失敗必 non-zero
   $ErrorActionPreference = 'Stop'
   $src = 'C:\Users\User\Desktop\chiyigo.com\docs\plans\stage7-pr2dv-line-idtoken.md'
   $dst = 'C:\Users\User\Desktop\chiyigo-pr2dv\docs\plans\stage7-pr2dv-line-idtoken.md'

   # precondition：source 必須存在且為檔案（GOV-FAIL-001）
   if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "HALT: source 不存在或非檔案：$src" }
   # ⚠ PS 5.1：`Split-Path -LiteralPath $dst -Parent` 會拋 AmbiguousParameterSet（實測）→ 用 .NET 方法
   $dstDir = [System.IO.Path]::GetDirectoryName($dst)
   if (-not (Test-Path -LiteralPath $dstDir -PathType Container)) { throw "HALT: destination 目錄不存在：$dstDir" }

   $srcHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $src -ErrorAction Stop).Hash
   if (Test-Path -LiteralPath $dst -PathType Leaf) {
     $dstHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dst -ErrorAction Stop).Hash
     if ($dstHash -ne $srcHash) {
       throw "HALT: worktree 副本與 main 不同 hash（src=$srcHash dst=$dstHash）。禁覆寫；以 worktree 為準人工判定後再續。"
     }
     # hash 相同 → no-op
   } else {
     [System.IO.File]::Copy($src, $dst, $false)   # no-clobber：dst 已存在則拋 IOException（原子、防 TOCTOU）
   }

   # 收尾斷言（非終止錯誤已由 -ErrorAction Stop 排除）
   $dstHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $dst -ErrorAction Stop).Hash
   if ($dstHash -ne $srcHash) { throw "HALT: copy 後 hash 不符（src=$srcHash dst=$dstHash）" }
   "DOC-SYNC OK: $srcHash"
   ```
   ⚠ `[System.IO.File]::Copy` 需**絕對路徑**（.NET 方法用 process CWD、非 PowerShell CWD）——上方已用絕對路徑。
   ⚠ **驗收要求（② R4-R4）**：本演算法**必含負向實跑**——`source missing` 須 **non-zero exit ∧ 不輸出 `DOC-SYNC OK` ∧ 不建立 destination**。實測見 §13.8a。
   ⚠ `-LiteralPath`（非 `-Path`）：`-Path` 會把 `[...]` 當 wildcard 解析；本 doc 路徑雖無方括號，仍固定用 `-LiteralPath`（同 repo 內 `[provider]` 路徑的既有教訓）。
   ⚠ **Git Bash 備案**（等價語意；同樣禁無條件覆寫——須先 `[ -e dst ]` 判斷、hash 不同即 halt）：`sha256sum <src> <dst>` 比對。**執行一律以本節 PowerShell 版為準**。
3. **自該次 copy 起，worktree 副本＝唯一 canonical**；`main` working dir 副本視為 **stale scratch**，**禁再編輯**（避免雙源）。若 CODE stage 需再改 plan → **只改 worktree 副本**。
3a. **stale scratch 的處置（② R4-R2 MAJOR 落修；必須明定、不得留隱患）**：
   - **衝突事實**：squash-merge 後 main branch 會 **tracked** 此路徑，而 main working dir 同路徑存在 **untracked** 副本 → `git pull` 必報 `untracked working tree files would be overwritten by merge` 而**拒絕 merge**。故**必須在更新 main 之前處置**。
   - **處置需 owner 當輪明示授權**（刪除屬不可逆操作，依全域 §嚴格禁止例外項／不可逆操作前重 walk-through）。**Claude 不自行刪除。**
   - **預設建議（非破壞、可回溯）**：先 `Move-Item` 到 scratchpad 備份再 `git pull`：
     ```powershell
     Move-Item -LiteralPath 'C:\Users\User\Desktop\chiyigo.com\docs\plans\stage7-pr2dv-line-idtoken.md' `
               -Destination '<scratchpad>\stage7-pr2dv-line-idtoken.main-scratch.md'
     ```
     pull 後 main 的 tracked 版本即為 canonical，備份可留存核對後再由 owner 決定刪除。
   - **替代**：owner 明示授權 → 直接刪除後 pull。
   - **禁**：`git pull` 前不處置（會卡 merge）／`-Force` 覆蓋 untracked 副本而不留備份（丟失 PLAN stage 編輯歷史）。
4. **提交方式**：doc 與 source **同一個 squash commit**（單一 hash 同時覆蓋 plan + 實作 + 測試），**不做 source/docs 分離提交**。
5. **ratchet 無影響**：`.md` 不在 ratchet 計數集（`listTrackedSourceFiles` 僅計 `.js/.mjs/.cjs/.ts/.mts/.cts`、且排除 `.d.ts`）⇒ 新增 tracked plan doc **不動 `320/337`**。
6. **④ Faithfulness packet**：以 worktree 副本為錨點（與 source 同 tree、同 commit）。

### 13.8a DOC-SYNC 演算法驗收實測（② R4-R4 `GOV-FAIL-001` 要求之負向實跑；PowerShell 5.1、throwaway 目錄跑完即刪）

| 情境 | exit | 印 `DOC-SYNC OK` | destination | 判定 |
|---|---|---|---|---|
| **NEG-1 source missing + dst missing**（② 指定） | **1** | **False** | **未建立** | ✅ 三條件全達成 |
| POS-1 source exists、dst missing | 0 | True | 已建立 | ✅ |
| POS-2 重跑（same hash） | 0 | True | 不變 | ✅ no-op、idempotent |
| **NEG-2 dst 被編輯（hash 不同）** | **1** | **False** | **編輯完整倖存**（`canonical + WORKTREE EDIT`） | ✅ 「資料丟失但綠燈」結構性排除 |
| NEG-3 source missing、dst 存在 | 1 | False | 未動 | ✅ precondition 先攔 |

- **另抓到並修正**：`Split-Path -LiteralPath $dst -Parent` 於 PS 5.1 拋 `AmbiguousParameterSet`（實測）→ 改 `[System.IO.Path]::GetDirectoryName($dst)`。該錯**方向為 fail-closed**（擋住正當路徑、不製造假綠），仍屬缺陷、已修。
- **教訓**（同 §13.2 N13、§13.8 `-Force` 假綠，本棒第三次同族）：**測試集由設計者盲點決定** ⇒ 宣稱「已實跑驗證」時必須明列**測了哪些分支**，且**負向案（前置條件失敗）與正向案同等必要**。[[feedback_ts_negative_control_proves_suppression_load_bearing]]

### 13.7 R4 裁決狀態
- **① ChatGPT Arch R4**：`CHATGPT_ARCH_CHANGES_REQUESTED`（Critical 0 / Required 3 / NB 1）→ RR1（§13.3 oracle + `N15-LOAD-BEARING-LOCK`）· RR2（§13.5 rollback ⓪）· RR3（§13.4 定性）· NB（§13.6）全數落修 → **窄複審 `CHATGPT_ARCH_APPROVED`（R4、2026-07-17）**：Critical 0 / Required 0 / NB 1；**RR1·RR2·RR3 + 前輪 NB 全 CLOSED**；**核准矩陣 `DELTA 10 / INVARIANT 6`**；核准 base `18b5f72d`。
  - ① 核准理由摘要：N15 與 N15-control 形成**單變數差分**，足以排除 fixture／claims／簽章／token-exchange 假綠；副作用零鎖定（users／refresh_tokens／access_token）；exchange 成功 ∧ userinfo 未呼叫 ⇒ 可定位至 verifier 階段。
  - ① R4-NB（已處理）：`token issuation` → `token issuance`。⚠ **實況更正**：canonical plan §13.4 **原本即為 `issuance`**、無誤；typo 僅存在於窄複審 packet 的引文（已修）。**SoT 無需變更**。
- **carry-forward locks（① R4 明列續有效、不得放寬）**：`N15-LOAD-BEARING-LOCK` · `CHANNEL-SECRET-REQUIRED` · `ROLLBACK-LOCK-R2 ⓪` · `LINE-AUD-STRING-ONLY` · `OD-1..4` · `RN-1/RN-2` · `ORDER-LOCK-R2` · `DEPLOY-EVIDENCE` · `NB-1` · 其餘 R3 已核准架構鎖。
- **② Codex Plan R4 → `CODEX_PLAN_APPROVED`（R4-R5 窄複審、2026-07-17）** ✅
  - **五輪全數 CLOSED**：R4-R1（2 BLOCKER + 2 MAJOR）→ R4-R2（2 BLOCKER + 1 MAJOR）→ R4-R3（1 BLOCKER + 1 MAJOR）→ R4-R4（2 BLOCKER：`GOV-FAIL-001` fail-open + `GOV-DRIFT-001` packet 二源）→ R4-R5（1 BLOCKER：packet provenance）→ **無殘留 material finding**。
  - **`PLAN-APPROVAL-ANCHOR`（本核准錨定之 bytes）**：canonical plan `docs/plans/stage7-pr2dv-line-idtoken.md` **SHA-256 = `A4734E1D4910B24C31F7019A54E78C7F9F38048A978CD53EBCA0049E32AFB52D`**（② 報告值；本機 `Get-FileHash` 實測**逐字相符**）。② 獨立重跑之 DOC-SYNC 五案即錨定此 bytes。⚠ **本節（§13.7）記錄核准本身會改變 plan hash**——此為核准後的 ledger 更新、非實質變更；**DOC-SYNC 執行時以當下 source hash 為準**（§13.8 演算法自帶 precondition + 收尾斷言，不依賴此錨點）。
  - ② 獨立驗收（非採信我方宣稱）：DOC-SYNC **5 正負案全數重跑相符** · `Split-Path` `AmbiguousParameterSet` **獨立重現** · 三 code SHA-256 不變 · `git diff --check` PASS · `HEAD == origin/main == 18b5f72d`。
  - ⚠ **② 明示**：`CODEX_PLAN_APPROVED` **≠** coding／code gate／commit／push／merge／release 授權；**`CODING_ALLOWED=NO` 維持**，下一狀態＝**等 owner 重新明示 `CODING_ALLOWED`**；**main stale 副本的 Move-Item／刪除授權亦未授予**。
- **② R4 歷輪 findings（全數成立、全數落修；追溯用）**：
  | ID | 指控 | 落修 |
  |---|---|---|
  | **BLOCKER-1** `GOV-DRIFT-001` | `callback.ts` F-2 註解仍稱「空字串會被 importKey 接受」，**與 §13.2 實測直接相反**，且指錯 load-bearing 分支 | ✅ 註解改寫（正確區分 `null`＝load-bearing vs `''`＝已 fail-closed 但洩 crypto 細節）。**根因＝該註解寫於實測前；實測翻案後只更新 plan/SPEC、漏回頭修 code** |
  | **BLOCKER-2** `GOV-DRIFT-001` | SPEC §1「全 additive」與 plan §6.1（exp 收緊 / nonce 位移＝非 additive）矛盾 | ✅ SPEC §1 改為逐項分類表（additive reject / 收緊 / 位移＋強制 / security boundary）。**我的 R4 註記還重申過「全 additive」＝propagate 了原錯** |
  | **MAJOR-3** `GOV-EVIDENCE-001` | 單變數差分要求 token **bytes** 相同，但 fixture `exp` 取自 `Date.now()`，兩 `it()` 各自簽 → **跨秒即破裂**；且 `fetchCalls` 不能證明 authorization code 真被消費 | ✅ 新增 **`N15-SHARED-TOKEN-LOCK`**（§13.3：`beforeAll` 產一次、兩案重用同一字串）＋ oracle ① 措辭改為「mock exchange 成功回傳 ∧ verifier 已抵達」 |
  | **MAJOR-4** `GOV-DECISION-001` | plan 只存在 main untracked、implementation worktree 無此檔＝隱含 split | ✅ 新增 **`DOC-SYNC-LOCK`**（§13.8：CODE stage 首動作 byte-identical copy + SHA-256 比對、worktree 副本自此為唯一 canonical、doc 與 source 同一 squash commit） |
- **② R4 已確認項**（不重審）：N15/N15-control 分類與 `10/6` 合理 · LINE 官方契約（HS256/channel secret · `iss` · `aud` String）一致 · **ratchet 推導正確**（live `381/17/319/336` → 新測試檔納入追蹤 `320/337` → 再加 2 個 `it()` 不影響檔案數）。
- ⚠ **② 提醒（治理誠實）**：repo 無 `governance/rules.json` ⇒ 上述 rule ID 僅來自**全域 advisory baseline、非 repo-local enforced**（對齊 memory `project_governance_hygiene_lints_backlog` P5「advisory-not-enforced」現況）。
- **BLOCKER-1 連帶 → ① R4b 窄確認：`CHATGPT_ARCH_APPROVED`（R4b、2026-07-17）** ✅（Critical 0 / Required 0 / NB 1）
  - **核准**：F-2 安全註解更正**納入 R4 scope**（理由：舊註解與已取得實證直接矛盾，**不應明知錯誤仍合入**；另開 PR 會留下暫時性錯誤安全文件）。
  - **R4 核准前提正式修訂**：~~production diff byte-unchanged~~ → **runtime logic unchanged ＋ comment-only correction**。
  - **`R4b-SCOPE-LOCK`（逐字納入、carry-forward）**：
    > 相對於前次送審的 R4 candidate，唯一新增 production-file delta 為 F-2 安全註解更正；**去除註解後 executable source 必須完全相同**。**不得藉 R4b 修改 predicate、控制流程、錯誤字串或其他 runtime logic。**
  - **不變**：guard predicate · runtime scope · 矩陣 `DELTA 10 / INVARIANT 6` · 全部 carry-forward locks。
  - **① R4b-NB（已落修，不需再送 ①）**：「runtime logic byte-unchanged」須明寫比較基準＝**相對前次 R4 candidate**，**非**「candidate ↔ base `18b5f72d` 的 production runtime diff 為零」（§13.4 已改寫；防 ③／④ 誤讀）。
- ⚠ **`CODING_ALLOWED` 恢復條件**：① 明示其核准**本身不恢復**；須 **②通過 ∧ owner 重新授權** 才可續 CODE。

---

## 14. CODE-stage 維度 A self-review 結果（2026-07-17；`0abd39d8`）

**workflow**：`code-self-review.mjs`、38 agents、23 candidate findings → **6 accepted / 17 refuted**（0 unverified；7 個 transient 529 經 retry 全補回）。17 refuted 多為 finder 讀 main worktree（＝base）致行號漂移、被 verifier 以「該檔/行不存在於 base」駁回。

### 14.1 已於 CODE stage 修（self-review 驅動、test-only）
- **#3（tier3、accepted）item 編號 bug**：新測試檔 nonce 區塊誤標 `item 4`（與 exp 重複、`item 5` 缺席）→ 改 `item 5`；header「5 項」註明＝alg/iss/aud/exp/nonce、signature 為既有 gate。純 label、無 runtime/ratchet/plan 影響（plan 全文無 `item N` 編號）。
- **#5（tier2、accepted）N11 main 弱鎖**：`oauth-nonce.test.ts:202` 原僅斷言 `status===400`，但所有失敗都回 400（htmlError 預設）→ 無法歸因 nonce gate；且 fixture 的 id_token 無 nonce claim → 「stored-NULL 拒絕」與「token-nonce 缺席」耦合。**owner 2026-07-17 裁「就地強化」**：補 `toContain('id_token nonce mismatch')` 精確釘 gate + `users` count=0 零副作用 + fixture id_token 改帶合法 nonce（隔離失敗模式）。仍 DELTA（base 對此 fixture 回 200→訊息/副作用斷言仍 RED、矩陣不變）。⚠ **超出 §4.1/§5.1 字面 N11-NARROW-EDIT（「僅 expectation 200→400」）**：owner 明示授權、依 standing rule [[feedback_regression_test_must_lock_exact_failure]] + PR-2du F-3 先例（test 品質意圖 > 字面 scope）；④ faithfulness packet 標為 owner-approved self-review 強化。

### 14.2 不動 code、文件揭露 + backlog（verifier 共識「別動 code」）
> 皆 tier3（除 idempotency 兩則掛 tier2 但屬 pre-existing）、**今日不可利用**、且落在 §1「明禁動」範圍。依 [[feedback_prefer_plan_fidelity_over_small_waiver]] + [[feedback_security_boundary_pr_first_do_no_harm]]，**CODE stage 不逕改**，進 `project_line_idtoken_verify_hardening_backlog`。

- **#1/#2/#6 — Google/Apple nonce 語義分歧 + 缺 `!tokens.id_token` guard**：本 PR 使 LINE nonce 強制（NULL→400），但 Google（callback.ts:671-673）/ Apple（:691-693）仍條件式 `if (expectedNonce && ...)`＝NULL 靜默跳過 replay 校驗。**分歧由本 PR 造成**（base @18b5f72d 三者一致用 `if (expectedNonce && ...)` idiom）。另 caller L594 `if (provider === 'line' && tokens.id_token)`：token response 無 id_token 時 LINE 跳過全部 6 道 gate 走 userinfo 建帳號，而 Apple:576/Google:586 對缺 id_token 一律 throw（fail-closed），LINE 獨缺對稱守衛。**今日不可利用**：init.ts:30 OIDC_PROVIDERS 含三者、:173 恆生 nonce；LINE userinfo（/v2/profile）不回 email → 無 id_token = 無 email 登入（provider_id 取自 userinfo raw.userId、非 id_token）。**backlog**：後續 PR 評估 (a) Google/Apple 對齊強制 nonce（連帶修 callback.test.ts:229/243/602 三處 nonce=NULL seed）(b) LINE 比照加 `if (!tokens.id_token) throw`。
- **#4 — ERROR-CONTRACT 字串配對未結構綁定**：`signature invalid`（L728 新 + L744 既有）/`nonce mismatch`（L770 新 + L771）各出現兩處，測試只鎖「新端」（N15/N11子案有訊息斷言），「舊端」L744/L771 只驗 status → 單獨改舊端字串測試抓不到。L744 是 plan §3.1 pin「既有逐字不動」、改＝出 scope + 觸 Google/Apple。**backlog**：後續 PR 把 6 個 throw 字串上提為 module 級常數（放 `LINE_ISSUER` 旁）。

### 14.3 主線獨立裁決（非採信 workflow、讀真 diff `18b5f72d..0abd39d8`）
ORDER-LOCK（verifier L596 → userinfo L602、N15 runtime `userinfoCalled=false` 坐實）✓ · CALLER-CLEANUP（讀原始碼確認舊 nonce block 已刪、非只數 grep）✓ · LINE-AUD-STRING-ONLY（verifier 內 0 個 `Array.isArray`/`.includes`）✓ · 禁 export verifyLineIdToken ✓ · diff 新增行 0 個 `any`/suppression ✓ · 明禁動檔案（Google/Apple verifier、oauth-providers.ts、L76 guard、L164 catch、env.d.ts）全未觸 ✓。
