# Stage 7 PR-2ds — 棒3b：`init.ts` + `bind-email.ts` noImplicitAny 續清（oauth domain dirty-2）

**SPEC**: `STAGE7_OAUTH_INIT_BINDEMAIL_NOIMPLICITANY`
**狀態**: `CODEX_PLAN_CHANGES_REQUESTED (r1) → PLAN 已修訂、待 owner 重送 ① ChatGPT Arch`（② Codex Plan Gate r1 判 OD-3b-3 `buf as ArrayBufferLike` 為未登錄的非完全誠實 assertion、違 advisory `TS-BOUNDARY-002` → 採建議改 `toBase64Url` **function overload、零 assertion**；此偏離原核准 OD-3b-3 故須**重開 ① Arch + 建新 plan anchor**；plan 已修訂並焦點 self-review〔localized 單函式、overlay 重證 REMOVED=6/ADDED=0 + byte-identical〕。**≠ `CODEX_PLAN_APPROVED` / `CODING_ALLOWED`**。上游歷史：SPEC `SPEC_APPROVED_WITH_LOCKS` + ① Arch r0 `APPROVED_WITH_LOCKS`〔@ 歷史 anchor `45935374`、cast 版、**已被 r1 overload 修訂取代**〕+ 維度 A self-review clean §5.7）。
> **gate 進程**: scout〔2 檔共 6 錯 forced tsc 確認、zero dual-leaf〕→ transient overlay 實測〔**REMOVED=6/ADDED=0** + byte-identical 升級證據（cmp -s + SHA-256）+ `git checkout --` 還原、ratchet 還原 414/20/315〕→ owner **`SPEC_APPROVED_WITH_LOCKS`**（OD-3b-1..4、micro、MC-1/MC-2、ARCH-3B-1..16）→ MC-1 params 驗證〔`{ provider?: string }` REMOVED=6/ADDED=0 無 cascade、採用〕→ 本 plan doc → 維度 A self-review clean → **① ChatGPT Arch r0 `APPROVED_WITH_LOCKS`**〔2 提交前修正 folded〕→ **plan-anchor commit `45935374`（cast 版、歷史）** → **② Codex Plan Gate r1 `CHANGES_REQUESTED`**〔OD-3b-3 cast 違 TS-BOUNDARY-002 → function overload〕→ **plan r1 修訂（overload、零 assertion）+ 焦點 self-review + 新 anchor（parent `45935374`）** → 【待 owner **重送 ① Arch**】→ ② Codex Plan → `CODING_ALLOWED` → CODE fresh replay → ③ Codex Code → ④ ChatGPT faithfulness → owner `MERGE_ALLOWED` + CI green → squash-merge。
> **狀態 SoT**: 本 header + 對應中文報告為當前 gate-state 權威。目前＝`CODEX_PLAN_CHANGES_REQUESTED (r1)` 後之修訂態、待 owner 重送 ① Arch；**歷史 anchor `45935374ae64947430b07a81c3e771ab2c8655b8`**（cast 版、① Arch r0 通過但被 r1 overload 修訂取代、**不可直接取得 Plan approval**）；**新 anchor**＝`a8e6fe42c9f982314398673beab32beb410bb8ea`（r1 overload 修訂 commit、parent `45935374`、① Arch r1 `APPROVED_WITH_LOCKS`）；其上另有本次 doc-hygiene follow-up commit（`ARCH_R1_DOC_HYGIENE_FOLLOWUP_ALLOWED`、parent `a8e6fe42`），該 follow-up 完整 SHA ＝送 ② Codex Plan r2 的唯一有效 anchor。**CODING_ALLOWED 前禁動 source**。

**base**: `7fe52bcfe78412d11c337080075141715d0f7cc6`（origin/main，#144 PR-2dr 棒3-env SHIPPED 後；ARCH-3B-2 immutable base）
**級別**: **L2 implementation + L3 security review**（實作純 type-only 屬 L2；但 `init.ts` = OAuth authorization init〔PKCE / silent SSO / rate-limit / elevation / factor-add binding〕、`bind-email.ts` = OAuth identity binding + access/refresh token 簽發，皆 Tier-0 端點，治理與審查輸出升 L3 security-context）
**性質**: 純 type-only noImplicitAny 標註（`init.ts` **5→0** · `bind-email.ts` **1→0**；合 **6→0**、全 TS7006）、byte-identical emit（esbuild stdin-pipe + SHA-256 實證）、**零 runtime / 零 control-flow / 零 validation / 零 schema / 零 API / 零 migration / 零部署面 / 零 test 改動 / 零 env.d.ts / 零新 interface / 零 export / 零新套件 / 零 lockfile**。棒3b 是 reduce PR（**REMOVED=6**、非 enabler）；post-棒3b ratchet = **408 / 18 / 317**（ARCH-3B-13）。

**owner ruling（2026-07-11 `SPEC_APPROVED_WITH_LOCKS`）**: source 核准僅 `init.ts` + `bind-email.ts`（+ plan companion）｜OD-3b-1 context shape = **inline object + `[key: string]: unknown`、禁共用 interface/export/正式 EventContext 宣稱**｜OD-3b-2 = **handler boundary `env: Env`、util 端 `ProviderSecretsEnv` 不放寬**｜OD-3b-3 = **~~`new Uint8Array(buf as ArrayBufferLike)`~~ → r1 ② Codex Plan 修訂為 `toBase64Url` function overload〔零 assertion、閉合 advisory TS-BOUNDARY-002〕、待 ① Arch 重批**｜OD-3b-4 = **bind-email 不含 params**｜micro（`n: number` / `platform: string` / `port: string \| null`）全採｜**強制修正 MC-1（params 不得寬泛 Record）+ MC-2（byte-identical 證據升級）**｜Architecture Locks **ARCH-3B-1..16**（§1.2 逐字）｜風險表 §5.2 / 防禦表 §5.4 / 驗證要求 §5.5 / 商業摘要 §5.6。

> ⚠ 本棒 **tree 狀態（plan-anchor commit 後）**：唯一 untracked ＝ `CLEANUP_PLAN.md`（pre-existing、**不屬本 PR、挑檔 stage 排除**）；**本 plan doc 已 tracked**（commit 進 anchor 鏈 `45935374`→`a8e6fe42`）。eventual PR 的完整 changed-files allowlist 恰 {`init.ts`, `bind-email.ts`, 本 plan doc}〔plan doc 已 anchor-committed、2 source 待 CODE stage〕；source 面恰 {`init.ts`, `bind-email.ts`}。

> ⚠ **標籤衝突聲明（faithfulness）**：owner ruling 中「**## 強制修正**」段的 `ARCH-3B-1`（params narrowing）/ `ARCH-3B-2`（byte-identical 證據升級）與「**## Architecture Locks**」表的 `ARCH-3B-1`（scope）/ `ARCH-3B-2`（immutable base）**標籤重疊、語意不同**。本 plan **兩者皆逐字保留**：強制修正以 **MC-1 / MC-2** 別名承載（§5.3），Locks 表維持 `ARCH-3B-1..16`（§1.2）。gate 引用時以區塊標題區分。

---

## 1. Scope 與 locks

### 1.1 SCOPE（ARCH-3B-1 lock）: **2 source**

- `functions/api/auth/oauth/[provider]/init.ts`（動態 OAuth 授權入口：provider 驗證 + PKCE/state/nonce 生成 + per-IP rate-limit + is_binding factor-add gate + purpose=elevation OAuth-reauth + oauth_states 寫入 + 302/JSON 重導）
- `functions/api/auth/oauth/bind-email.ts`（無 email OAuth 用戶補填信箱：temp_bind_token 驗證 + jti replay 防禦 + reverification gate + 信箱碰撞 + user/identity 建立 + access/refresh token 簽發）
- （+ 本 plan doc companion，per stage7 慣例；**不計入 source surface**）

**6 noImplicitAny → 0**（forced tsc `-b tsconfig.solution.json --pretty false --force` 實證，base `7fe52bcf`；**zero dual-leaf**，base error set = 414 raw = 414 unique〔**非**全 TS7006，尚含 TS7031/7053/7034 等其他 noImplicitAny 變體〕；**本棒所清的 6 個全 TS7006**）：

#### 1.1.1 `init.ts`（5：5 TS7006）
| loc（base） | error | 型別決策（form） |
|---|---|---|
| 34,20 | TS7006 `n` | `function randomHex(n: number)`（caller = `randomHex(STATE_BYTES)`〔=16〕；內部 `new Uint8Array(n)` 需 number）|
| 39,22 | TS7006 `buf` | **function overload**（r1 ② 修訂、取代原 cast）：`function toBase64Url(buf: ArrayBuffer): string` + `function toBase64Url(buf: Uint8Array): string` + 實作簽名 `function toBase64Url(buf: ArrayBuffer \| ArrayLike<number>)`（caller: `raw`=Uint8Array〔L46〕 / `hashBuf`=ArrayBuffer〔L48〕）；**L40 impl body `new Uint8Array(buf)` 一字不動、零 assertion**（OD-3b-3）|
| 53,30 / 53,40 | TS7006 `platform` / `port` | `function buildClientCallback(platform: string, port: string \| null)`（caller: `platform` = `url.searchParams.get('platform') ?? 'web'`〔string〕 / `port` = `url.searchParams.get('port')`〔string\|null〕）|
| 68,36 | TS7006 `context` | `onRequestGet(context: { request: Request; env: Env; params: { provider?: string }; [key: string]: unknown })`（單一 context 參數、body 內 destructure 不動；OD-3b-1 + MC-1）|

#### 1.1.2 `bind-email.ts`（1：1 TS7006）
| loc（base） | error | 型別決策（form） |
|---|---|---|
| 30,37 | TS7006 `context` | `onRequestPost(context: { request: Request; env: Env; [key: string]: unknown })`（**無 params**，OD-3b-4；handler 只 destructure `{ request, env }`）|

> **type surface（zero 新 named interface、zero export）**：2 handler-ctx inline 標註〔init 1 + bind-email 1〕+ 3 helper/param 標註〔`n: number` / `platform: string` + `port: string\|null`〕+ `toBase64Url` **function overload**〔2 public overload signature〔`ArrayBuffer→string` / `Uint8Array→string`〕+ 1 implementation signature〔`ArrayBuffer\|ArrayLike<number>`〕、**零 type assertion**（r1 ②）〕。`Env` / `Request` 為 global ambient（2 檔未 import；overlay ADDED=0 反證解析）。2 檔為 leaf route handler、**zero export type/interface** → 型別面全 module-local（production 僅 Pages router 觸發；integration test 以 value import `onRequest*`，故 CASCADE-LOCK 含 tests-leaf，見 NB-1）。

### 1.2 Block locks（**ARCH-3B-1..16** = owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-11 逐字落地）

| Lock | 要求 |
|---|---|
| **ARCH-3B-1 SCOPE** | scope 僅 `init.ts`、`bind-email.ts`、plan companion |
| **ARCH-3B-2 IMMUTABLE-BASE** | base 固定 `7fe52bcf`；實作前必須重驗 main、tree、ratchet |
| **ARCH-3B-3 SOURCE-DELTA** | source 僅增加參數型別與 `toBase64Url` function overload 型別簽名；**零 type assertion**（r1 ② 修訂：取代原 `as ArrayBufferLike`、閉合 TS-BOUNDARY-002）|
| **ARCH-3B-4 ZERO-RUNTIME** | 零 runtime expression、branch、validation、return、exception、log 變動 |
| **ARCH-3B-5 CONTEXT-SHAPE** | handler 保留單一 `context` 參數及 body destructuring |
| **ARCH-3B-6 INDEX-SIG-ENVELOPE** | `[key: string]: unknown` 僅為 test/framework extra-property envelope |
| **ARCH-3B-7 NO-DYNAMIC-KEY** | 禁止透過 `context[key]` 或未宣告屬性取得業務資料 |
| **ARCH-3B-8 NO-ANY-NO-GLOBAL** | 禁止 `any`、`as any`、`as unknown as`、新增 global declaration |
| **ARCH-3B-9 UTIL-FROZEN** | `getProvider` 繼續接受 `ProviderSecretsEnv`；不得改 util signature |
| **ARCH-3B-10 NO-ENV-SURFACE** | `env.d.ts`、OAuth credentials、schema、migration、API contract 零變動 |
| **ARCH-3B-11 SECURITY-BYTE-IDENTICAL** | PKCE、state、silent SSO、rate limit、identity binding、token issuance 全部 byte-identical |
| **ARCH-3B-12 CASCADE** | TypeScript set-diff 必須 `REMOVED=6 / ADDED=0`，並包含 solution 與 tests leaf |
| **ARCH-3B-13 RATCHET** | post-ratchet 必須為 `408 / 18 / 317`；不符即 halt |
| **ARCH-3B-14 PROVIDER-PATH-HUNK** | `[provider]/init.ts` 必須人工補完整 hunk，不得只依賴 reviewer script |
| **ARCH-3B-15 NO-FOLD-IN** | 禁止摺入 callback.ts、LINE hardening 或其他 OAuth 清理 |
| **ARCH-3B-16 NO-PKG-NO-TEST** | 新增套件、修改 lockfile、改測試檔均禁止 |

## 2. SSOT 對齊（每個型別決策的真相源）

- **handler-ctx（2 TS7006；OD-3b-1）**：兩 handler 用**單一 `context` 參數**（非 destructure-in-signature），僅在 `context` 補 inline object 型別 + `[key: string]: unknown`。**採單一 context 參數是 byte-identical 的必要條件**——若把 destructure 搬進簽名（如 `onRequestGet({ request, env, params }: …)`）會改變 emit（destructure 位置移動）、破壞 ARCH-3B-11。既有 precedent = `functions/api/redirect/line.ts:13`（`onRequestGet(context: { request: Request; env: Env })` 單一 context 參數 + exact-inline，其 tests 傳 subset ctx 故無需 index-sig）。
  - **`[key: string]: unknown` 的真相源（ARCH-3B-6）**：init/bind-email 的 integration test 傳**完整 EventContext literal**（`{ request, env, params, waitUntil, data, next }`）。若 handler ctx 標 exact-inline（無 index-sig）→ `waitUntil`/`data`/`next` 觸 TS2353 excess-property（本棒 scout full-6 對照坐實：dirty-2 曾出 7×TS2353）。index-sig `[key: string]: unknown` **抑制 excess-property check**（extra prop 全 assignable to `unknown`）。`unknown`（非 `any`）確保 handler 不能未經 narrow 讀取那些 framework prop（ARCH-3B-7）。functions/ 內 `[key:string]:unknown` 零既有用例＝**新 shape、由 test 傳 rich ctx 逼出、非偏好**；但**不建共用 type、不 export、不宣稱為正式 `EventContext` 模型**（owner OD-3b-1）。

- **`init` params `{ provider?: string }`（MC-1）**：**禁用寬泛 `Record<string, string>` 單純讓 TS 綠燈**（owner 風險表：`Record<string,string>` 過度宣稱「所有 key 均存在且為字串」）。真相源 = owner 優先型別 `{ provider?: string }`。**MC-1 驗證程序實測坐實可用**（§5.3）：
  - `strict: false` → `strictNullChecks: false`（tsconfig.functions.json:13）→ optional `provider?: string` 於**讀取端不帶入 `| undefined`**（`params.provider` 讀為 `string`）→ `provider = params.provider?.toLowerCase()` 得 `string` → `SUPPORTED_PROVIDERS.includes(provider)`〔`SUPPORTED_PROVIDERS: string[]`〕與 `getProvider(provider, env)`〔`getProvider(name: string, …)`〕**皆不 cascade**（overlay ADDED=0 坐實）。
  - **所有 init test call-site 皆傳 provider present**（`{ provider }` cred-reverify / `{ provider:'google' }` rate-limit·callback·oauth-nonce / `{ provider:'discord' }` oauth-nonce），**無任何傳 `params:{}`** → `{ provider?: string }` optional 對全部 test literal assignable。
  - **語意**：`{ provider?: string }` 只宣稱 params 可能有 `provider` string key（不宣稱其他 key）；optional 是誠實保守方向（route boundary 未由本棒型別強斷）。既有 runtime `params.provider?.toLowerCase()` + `if (!SUPPORTED_PROVIDERS.includes(provider))` 已是 provider 缺值/未知的 fail-closed 守門（unsupported → 400），本棒不新增、不移除任何 narrowing（ARCH-3B-4）。

- **`bind-email` ctx 無 params（OD-3b-4）**：bind-email handler 只 `const { request, env } = context`（L31）、**不 destructure/讀 params**。tests 傳 `params:{}` 由 `[key:string]:unknown` 吸收。**least-surface：不為對稱性增加未使用欄位**（owner OD-3b-4）。

- **`env: Env`（OD-3b-2）**：init `getProvider(provider, env)`〔L76〕/ bind-email `getProvider(provider, env)`〔L71〕的 `env` 由 context 型別帶出 `Env`。**handler boundary 用完整 `Env`**（槓桿 棒3-env #144 補進 `Env` 的 10 optional OAuth credential key → `Env` 與 weak-type `ProviderSecretsEnv` 有 10 屬性重疊 → assignable、**無 TS2559**）。**util 端 `getProvider(name, env: ProviderSecretsEnv)` least-privilege 窄型不放寬**（ARCH-3B-9；棒3-env ARCH-ENV-5 已凍結）。對映 [[feedback_util_env_param_pick_not_full_env]]（util 收窄型是正解、caller 傳母表 Env）。init 另用 `env.chiyigo_db`〔D1Database〕/ `env.IAM_BASE_URL`〔`?: string`〕，皆在 `Env`（`types/env.d.ts`:23/46）→ 標 `env:Env` 不 cascade TS2339。

- **`toBase64Url` function overload（OD-3b-3；r1 ② Codex Plan 修訂，取代原 `as ArrayBufferLike`）**：
  ```ts
  function toBase64Url(buf: ArrayBuffer): string
  function toBase64Url(buf: Uint8Array): string
  function toBase64Url(buf: ArrayBuffer | ArrayLike<number>) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))   // impl body 一字不動、零 assertion
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }
  ```
  - **真相源＝② Codex Plan r1 建議**：原 `buf: ArrayBuffer | Uint8Array` + `new Uint8Array(buf as ArrayBufferLike)` 被判為未登錄的非完全誠實 assertion、違 advisory `TS-BOUNDARY-002`（`Uint8Array` 本身非 `ArrayBufferLike`）。改用 function overload 後 **零 `as` assertion、零 unsafe-boundary exception**（無需新增 governance registry）。
  - **兩 caller 忠實**：`raw`（Uint8Array，PKCE verifier L46）→ 命中 `(buf: Uint8Array): string` overload；`hashBuf`（ArrayBuffer，SHA-256 digest L48）→ 命中 `(buf: ArrayBuffer): string` overload。public overload 精確描述兩 call site、比原 union 更誠實。
  - **實作簽名 `ArrayBuffer | ArrayLike<number>`**：內部 `new Uint8Array(buf)` 於此實作簽名下 type-check **無新錯**（transient overlay `ADDED=0` compiler-as-oracle 坐實；不憑型別推理宣稱、[[feedback_dont_assert_runtime_semantics_without_verify]]）。
  - **byte-identical 維持**：2 個 public overload signature 為 declaration-only、**esbuild 於 emit strip**（實測 init.ts emit 仍 `9048` / SHA-256 `f87d1c0f…`、cmp -s exit 0；emit 只剩 `function toBase64Url(buf) {`）；runtime `new Uint8Array(buf)` 對兩型別行為不變（ArrayBuffer→view、Uint8Array→copy，皆既有正確行為）。
  - **module-local、public API / runtime contract 不變**；**禁擴散、禁 `as` 任何形式 / helper wrapper / runtime branch**（OD-3b-3 + ARCH-3B-3/8）。

- **micro（caller-faithful）**：`randomHex(n: number)`（number const caller）· `buildClientCallback(platform: string, port: string \| null)`（`port` 誠實 nullable、內部 `if (!port …)` + `String(port)` 既有不動）。

## 3. 證據（scout transient overlay 實測 @ working-tree `7fe52bcf`，已 `git checkout --` 還原、**overlay 零殘留**；CODE stage 於 source commit **fresh replay** 重證，ARCH-3B-2/12）

**A. forced tsc set-diff** — `npx tsc -b tsconfig.solution.json --pretty false --force`（uniq set、`sort -u` 後 `comm`）：
- base error set = **414 unique**（= ratchet report 414/20/315；raw 414、**零 dual-leaf**）。
- 套 6 處 type-affecting overlay（init 5 + bind-email 1、含 `{ provider?: string }` + `[key:string]:unknown` + `toBase64Url` **function overload**〔r1 ② 版〕）→ **408 unique**；set-diff **REMOVED=6**（init.ts 34,20/39,22/53,30/53,40/68,36 + bind-email.ts 30,37、全 TS7006）/ **ADDED=0**（全 solution、含 tests-leaf；[[feedback_tsc_forced_solution_dual_leaf_error_count]]）。errorFiles 20→18、cleanFiles 315→317。baseline `1119/175` frozen（reduce 禁 `--update`）。**r1 overload 版與 r0 cast 版 REMOVED/ADDED 逐字相同（皆 6/0）、byte-identical 逐字相同（9048/8060、同 SHA）**——差異僅 assertion→overload，型別效果與 emit 皆等價。
- **關鍵消解坐實**：**TS2559 未出現**（`getProvider(provider, env:Env)` assignable to `ProviderSecretsEnv`＝棒3-env #144 之效）· **TS2353 未出現**（index-sig ctx 吸收 test rich EventContext）· **零 `as` assertion**（`toBase64Url` 改 function overload、**無 TS2352 / 無 TS-BOUNDARY-002 exception**；impl body `new Uint8Array(buf)` 於實作簽名 `ArrayBuffer\|ArrayLike<number>` 下 ADDED=0）· 無 TS2339（env.IAM_BASE_URL 等在 Env）· 無 TS2345（`params.provider` 讀為 string、不 cascade `.includes`/`getProvider`）。

**B. byte-identical emit（ARCH-3B-11 + MC-2 升級證據；esbuild stdin-pipe、非 vacuous）**：
| 檔 | base size | cand size | cmp -s exit | SHA-256（base = cand） | vacuous guard |
|---|---|---|---|---|---|
| `[provider]/init.ts` | 9048 | 9048 | **0** | `f87d1c0f203838b8e216e4eeae8bc76ee0819c9d9aa9b5c2ac630f604df0313d` | non-vacuous（≠ empty sha `e3b0c442…`）|
| `bind-email.ts` | 8060 | 8060 | **0** | `f32008463d6379d1658585a6bb0157c1a722cea86559e639cef5928ce166b001` | non-vacuous |
> RUNTIME-LOCK（ARCH-3B-4/11）坐實：provider 驗證 / PKCE / state / nonce / silent SSO / rate-limit / is_binding factor-add / elevation OAuth-reauth / oauth_states 寫入 / temp_bind jti replay / reverification gate / 信箱碰撞 / user·identity 建立 / access·refresh token 簽發 / cookie 100% 未動；參數註記 / function overload 簽名（型別資訊）全於 emit 抹除〔esbuild strip overload signature、實測 init.ts emit 只剩 `function toBase64Url(buf) {`〕（**本棒零 `as` assertion、不新增 return-type 標註**，delta 限「參數型別 + overload 型別簽名」、ARCH-3B-3）。
> **⚠ 驗法（MC-2；[[feedback_byte_identical_emit_verification]]）**：`git show HEAD:<f> | esbuild --loader=ts --format=esm` vs `cat <f> | esbuild --loader=ts --format=esm`，取 **`cmp -s` exit 0 + 兩側 SHA-256 一致 + 兩側 size > 0**（**size 相等不足以標 byte-identical**，MC-2 明訂）。canonical recipe **必含 `--format=esm`**；`--loader=ts` 對 file-arg 會 error → 0-byte vacuous 假 pass，故必驗 byte > 0 且 sha ≠ empty-string sha。PowerShell 5.1 無 `<` stdin redirection、命令走 Git Bash（② Codex 環境 `bash` 不在 PATH → replay 用明確路徑 `C:\Program Files\Git\bin\bash.exe` 或 esbuild JS transform fallback）。

**C. transient revert clean（⚠ historical scout/overlay snapshot before plan-anchor commits；非當前 branch 狀態）**：`git checkout -- ':(literal)functions/api/auth/oauth/[provider]/init.ts' 'functions/api/auth/oauth/bind-email.ts'`（`:(literal)` pathspec 處理 `[provider]` glob）→ 當時 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（pre-existing）+ 當時 plan doc（尚未 anchor-commit、untracked）、`git diff --stat HEAD` 空（零殘留）、HEAD 當時 `7fe52bcf`、ratchet 還原後仍 414/20/315。〔**當前 branch**：plan doc 已 tracked @ anchor `a8e6fe42`、HEAD ≠ `7fe52bcf`；此段僅記 scout 階段證據、非現況〕

## 4. 本地機械 gate（CODE stage 全套實跑；對齊 CI `ci.yml`；ARCH-3B-2 fresh replay，禁沿用 overlay）

CODE stage @ final source commit 必先跑 **immutable-base guard（ARCH-3B-2）**：`git merge-base --is-ancestor 7fe52bcf HEAD`（exit 0）+ 重驗 main/tree/ratchet；再跑並讀真實輸出：`typecheck:ratchet`（**enforce、post = `408/18/317`、baseline `1119/175` frozen 未 `--update`**、ARCH-3B-13；帶 **`RATCHET_BASE_REF=7fe52bcf`**〔immutable base、禁 `$(git rev-parse main)`〕）· `lint`（eslint + lint:workflows）· `verify:browser-pipeline` · `test:cov` · `test:int`〔含觸及本 2 檔的 oauth integration test — ARCH-3B-16 下不改；clean overlay ADDED=0 已含 tests-leaf 反證無新型別錯〕· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。

另 **REPLAY（ARCH-3B-2/12，source commit fresh replay）**：
- forced tsc set-diff **`REMOVED=6 / ADDED=0`**（全 solution、dual-leaf-aware、含 tests leaf）；任何 ADDED>0 直接阻斷、回 plan。
- **byte-identical（MC-2 升級）**：esbuild stdin-pipe `--loader=ts --format=esm`，2 檔 **cmp -s exit 0 + 雙側 SHA-256 一致 + size>0**（working-tree + committed-blob 雙面）。
- **FULL-DIFF-ALLOWLIST 機械核對**：`git diff --name-only 7fe52bcf..<source>` 完整 changed-files 恰 {`init.ts`, `bind-email.ts`, 本 plan doc}；source 面恰 {`init.ts`, `bind-email.ts`}。任一額外檔（含 pre-existing `CLEANUP_PLAN.md`）= scope violation、停 gate。
- **RED-TEST-INTEGRITY**：任何 test red 先保留首次失敗輸出並判因；**禁以「known flaky」直接 rerun 至 green**（僅在已證非本棒造成、首次 red 已留存時才可補跑一次診斷、不抹除首次 red）。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。
- **PROVIDER-PATH-HUNK（ARCH-3B-14）**：`[provider]/init.ts` 因路徑含 `[` → `code-self-review.mjs` REPO_PATH_PATTERN 拒 `[`、無法當 formal decision-point → faithfulness packet **人工補完整 hunk + 機械 `git diff --name-status`**，不得只依賴 reviewer script。

## 5. Open Decisions / owner ruling（2026-07-11）

### 5.1 OD 裁決（owner `SPEC_APPROVED_WITH_LOCKS`）
| OD | 裁決 | 鎖定 |
|---|---|---|
| OD-3b-1 context shape | **採用，附限制** | inline object + `[key: string]: unknown`；禁共用 interface/type、禁 export、禁宣稱正式 `EventContext` 模型（ARCH-3B-6/7）|
| OD-3b-2 `env: Env` | **採用** | handler boundary 用完整 `Env`；`getProvider` 端維持 `ProviderSecretsEnv`、不放寬 util capability（ARCH-3B-9）|
| OD-3b-3 buffer 型別 | **r0 owner「局部 overload bridge cast」→ r1 ② 修訂為 function overload、零 assertion** | `toBase64Url(buf:ArrayBuffer):string` + `(buf:Uint8Array):string` + impl `(buf:ArrayBuffer\|ArrayLike<number>)`；impl body `new Uint8Array(buf)` 不變；**零 `as`**/helper/runtime branch（ARCH-3B-3/8）；閉合 TS-BOUNDARY-002、無需 registry |
| OD-3b-4 bind-email params | **採用不含 params** | handler 未讀 params、由 index-sig 吸收 test ctx；不得為對稱性增未使用欄位 |
| micro types | **採用** | `n: number` / `platform: string` / `port: string \| null`；必須與實際 caller 推導一致 |

### 5.2 風險表（owner 明列）
| 項目 | 等級 | 影響 | 防禦 |
|---|---:|---|---|
| OAuth init / identity binding 型別誤導 | Tier-0 | 可能掩蓋 provider、帳號綁定或 token 路徑缺陷 | 僅補參數型別，禁 runtime/control-flow/validation 變更（ARCH-3B-4/11）|
| `context` index signature 過寬 | 中 | 任意欄位均可存在，可能成後續濫用入口 | 僅限函式參數 local inline shape；值固定 `unknown`；禁動態 key 讀取（ARCH-3B-6/7）|
| `params` 過度宣稱 | 中 | 宣稱所有 key 存在且為字串、與 route boundary 不完全一致 | **MC-1**：優先 `{ provider?: string }`；確認既有流程使用前已 narrowing／fail-closed |
| buffer 型別誠實性（原 `buf as ArrayBufferLike`）| 低（r1 已消解）| r0 cast 為 overload bridge、被 ② 判違 TS-BOUNDARY-002 | **r1 ② 修訂：改 `toBase64Url` function overload、零 `as`、零 unsafe-boundary exception**；public API/runtime contract 不變、module-local；byte-identical 維持（overload 簽名 esbuild strip、9048/SHA 不變）|
| byte-identical 僅比較長度 | 高 | 相同 byte count ≠ 內容相同 | **MC-2**：`cmp -s` exit 0 或雙側 SHA-256、兩側非空 |
| `[provider]` 路徑工具漏掃 | 中 | 自審工具可能未納入 init.ts | **ARCH-3B-14**：faithfulness packet 人工補完整 hunk + 機械 name-status |

### 5.3 強制修正（MC；owner「## 強制修正」段逐字承載，別名以避與 Locks 表標籤衝突）

- **MC-1 = owner「強制修正 ARCH-3B-1」（init `params` 不得直接凍結為寬泛 `Record<string, string>`）**：正式 plan 必先確認既有程式使用 provider 前是否已 narrowing。優先型別 `{ provider?: string }`。只有下列任一成立才可用其他 shape：(1) Cloudflare route type 或專案既有型別能機械證明 `[provider]` 必為 scalar string；(2) 現有測試要求缺失 provider context、且既有 runtime 明確 fail-closed；(3) 替換 optional 後產生錯誤證明無 narrowing → **不得靠不實型別消錯、不得自加 runtime 修復、必須退回 SPEC 裁決**。**不得用 `Record<string, string>` 單純讓 TS 綠燈**。
  - **本棒執行結果**：試 `{ provider?: string }` → forced tsc **REMOVED=6 / ADDED=0（無 cascade）**（機制：`strictNullChecks:false` 使 optional 讀取端不帶 `|undefined` → 不 cascade `.includes`/`getProvider`；全 init test 傳 provider present、無 `params:{}` → optional assignable）→ **condition #3 不觸發**（無 cascade）→ **直接採用 owner 優先型別 `{ provider?: string }`、無需退回 SPEC、無需 runtime 修復**。§2 記載真相源與機制。
- **MC-2 = owner「強制修正 ARCH-3B-2」（byte-identical 證據升級）**：gate 證據必含 `baseline size > 0` + `candidate size > 0` + `cmp -s baseline.js candidate.js` exit 0，**或**雙側 SHA-256 完全一致。`9048==9048`／`8060==8060` 只證長度、不足以標 byte-identical。
  - **本棒執行結果**：§3.B 已提供 `cmp -s` exit 0 + 雙側 SHA-256 一致（init `f87d1c0f…` / bind-email `f32008…`）+ size>0 非 vacuous。CODE stage fresh replay 同法重證。

### 5.4 防禦表（owner 明列）
| 機制 | 處理否 | 實作 | 未處理原因 |
|---|---|---|---|
| RateLimit | 保持 | 現有 init 流程 byte-identical | 本棒不改 runtime |
| 權限／identity binding | 保持 | bind-email 現有驗證與 token 路徑不動 | 本棒僅 type-only |
| Input validation | 保持 | provider、email、token 現有 narrowing 不動 | 禁新增 validation |
| XSS | 不適用 | JSON/API response 面不變 | 無 HTML surface |
| Structured Log / TraceID | 保持 | 現有 logging 不變 | 不擴 scope |
| Retry | 不適用 | 無新增外部呼叫 | 行為不變 |
| 備援 | 不適用 | 無 infrastructure 變更 | 行為不變 |
| 監控 | 保持 | 現有端點指標不變 | 本棒不新增觀測面 |

### 5.5 驗證要求（owner 明列）
| 類型 | 目標 | 工具 |
|---|---|---|
| 單元 | init、bind-email 既有測試零行為變更 | 專案既有 test runner |
| 整合 | solution 與 tests leaf 均無新增 TS error | `tsc -b tsconfig.solution.json --pretty false` |
| E2E | 本棒不新增 E2E；既有 OAuth suite 全綠 | 現有 CI |
| Emit | 兩檔輸出逐 byte 相同且非空 | esbuild stdin pipe + `cmp -s` / SHA-256 |
| Ratchet | 414→408、errorFiles 20→18、cleanFiles 315→317 | 現有 ratchet script |
| CI | typecheck、lint、完整 tests、`test:cov` | 與 `ci.yml` 一致 |

### 5.6 商業摘要（owner）
本棒是低成本、零功能變動的技術債清理，讓兩個 Tier-0 OAuth 檔案轉 clean、降低 callback.ts（棒4）後續處理時的錯誤噪音。**不得藉此棒重構 context abstraction**；該收益不足以承擔 OAuth 端點 runtime drift（ARCH-3B-15）。

### 5.7 維度 A 對抗式 self-review 收據（2026-07-11；5 finder 並行 + 主線裁決）
> **r0（cast 版）maiden 收據**——下列 5 finder 審的是 ① Arch r0 通過的 `buf as ArrayBufferLike` cast 版。r1 ② Codex Plan 將 OD-3b-3 改為 function overload（零 assertion），其餘 5 決策（context/params/env:Env/bind-email/micro）**一字未變**、r0 finding 對其仍全效。r1 修訂之焦點 re-review 見本節末「r1 焦點 self-review」。

5 個 read-only 對抗 finder（各攻一維度、全程禁改檔/禁套 overlay/禁動 git，避免平行 tree 互吸）+ 主線獨立複核。**0 BLOCKER / 0 MAJOR**；1 MINOR + 6 NIT 全數折入本 plan doc；主線 fresh-pass 再讀 0 新發現。
- **Finder 1（Lock 忠實度 + Scope）**：0 BLOCKER/MAJOR/MINOR + 3 NIT。獨立重現 base emit SHA（逐字命中）；以 clean `token.ts`（棒3a 已 noImplicitAny=0）當 in-repo witness 坐實 **bare `.first()` 回 `any`、欄位讀取不 cascade**（ADDED=0 關鍵支柱）；全 env sink assignability 逐一核；16 locks 連號無缺、標籤衝突處理正確。NIT：env.d.ts 路徑前綴〔已修〕· §3.B「return type」vacuous 列舉〔已修〕· 內文 inline ARCH-3B-1 雙義〔已修〕。
- **Finder 2（Cascade + 型別正確性）**：6 檢查全 VERIFIED、0 BLOCKER/MAJOR + 3 NIT（透明度）。機械重算 REMOVED=6/ADDED=0（`comm` + `grep -Fxvf` 雙法）、6 錯座標、post-ratchet 408/18/317（獨立推導 errorFiles 20→18）；型別邏輯獨立推導 MC-1 機制 + 雙重保險、env:Env 消 TS2559（10/10）、`buf as ArrayBufferLike` 消 TS2352 + cast 必要性。NIT：raw dual-leaf / cleanFiles 絕對值 / byte-identical 不在此維度、由 CODE-stage fresh replay 兜底。
- **Finder 3（byte-identical + runtime 分離）**：0 發現。在 scratchpad（未動 repo tree）重建 candidate、用 repo esbuild 實測、**獨立重現 plan §3.B 的 sha/size 逐字吻合**（init `f87d1c0f…`/9048、bind-email `f32008…`/8060、`cmp -s` exit 0）；6 處全 emit-erased、零 runtime 構造。誠實邊界：byte-identical PASS 不保證型別正確（屬 Finder 2 維度）。
- **Finder 4（MC 遵從 + 證據完整性 / gate-state 忠實）**：7 維度全 PASS + 1 NIT〔已修〕。獨立交叉驗證 ADDED=0 → MC-1 condition #3 正確未觸發；獨立重現 base emit sha → MC-2 PASS；base SHA / ratchet 414/20/315 / gate-state（無 commit/branch）/ 標籤衝突 / 內部恆等式（20+315=18+317=335）全自洽。NIT：§1.1「全 TS7006」措辭〔已修〕。
- **Finder 5（L3 security-context + faithfulness）**：安全維度 1-5 全 0 發現 + 1 MINOR〔已修〕+ 1 NIT〔已折入 NB-7〕。安全：6 註記不誤導安全不變量、`[key:string]:unknown` 無 live 濫用向量（grep 零 `context[...]`/`env[...]`）、`env:Env` 是收緊非放寬、P0-2/consumeJtiOnce/OD-3 reverification/PKCE/nonce 全未動、不摺入 LINE hardening。MINOR：NB-1 誤列 `jwt-sid-claim` 為 bind-email value-leaf〔主線 grep 複核確認、已更正為 oauth-bind-email 唯一〕。NIT：`{provider?:string}` strict:true 延後 cascade〔已補 NB-7 揭露〕。

**r1 焦點 self-review（② Codex Plan CHANGES_REQUESTED 後、localized 單函式 `toBase64Url` overload 修訂；依 Dual Gate「L2/L3 回應外部小修正、不觸架構/單檔局部 → 單 agent／主線對抗式」，未達重跑 5-finder workflow 規模）**：主線對抗式複核 + compiler-as-oracle 實測——
- **compiler 坐實**：套 overload 版 transient overlay（其餘 5 標註不變）→ forced tsc `REMOVED=6 / ADDED=0`（與 r0 cast 版逐字相同、含 tests-leaf）；`git checkout --` 還原、overlay 零殘留、ratchet 還原 414/20/315。
- **byte-identical 坐實（MC-2 升級）**：init.ts emit `9048` / SHA-256 `f87d1c0f…`、bind-email.ts `8060` / `f32008…`、`cmp -s` exit 0、雙側非 vacuous——**與 r0 cast 版逐字相同**；且 esbuild emit 實測只剩 `function toBase64Url(buf) {`（2 overload signature 被 strip）→ 坐實 overload 為 declaration-only、runtime 零變更。
- **對抗結論**：overload 版消除 assertion（閉合 TS-BOUNDARY-002）、零 `as`、零 registry；型別效果（REMOVED/ADDED）與 emit（byte-identical）皆與 r0 等價；其餘 OD/lock/security 決策未受影響。**0 新發現**。

## 6. 非 blocking notes
- **NB-1**：2 檔為 leaf route handler、**zero export type/interface**（同 PR-2dp/2dq）——production 僅 Pages router 觸發、無跨模組 public type contract。⚠ integration test 以 **value** import `onRequest*`：**init 4 leaf**〔`cred-reverify-enforcement` / `rate-limit` / `callback` 靜態 import + `oauth-nonce` **動態** `await import()`〕、**bind-email 1 leaf**〔`oauth-bind-email.test.ts:22` 唯一〕。故 CASCADE-LOCK（ARCH-3B-12）**必含 tests-leaf**；overlay ADDED=0 已全 solution 涵蓋。⚠ **`jwt-sid-claim.test.ts` 不是 bind-email 的 value-import leaf**（其 L10 註解提及 "bind-email" 屬 issuance 清單、非 import；實際 import login/refresh；bind-email sid regression 由 `oauth-bind-email` flow 自身覆蓋）——早期 `grep -rln "bind-email"` 誤命中該註解、已更正。
- **NB-2**：init/bind-email 用 **index-signature ctx**（`[key:string]:unknown`）吸收 tests 傳的完整 EventContext literal（`{ request, env, params, waitUntil, data, next }`），與 棒3a（PR-2dq）的 exact-inline ctx 對照——差異根源＝哪些 tests 傳 rich ctx literal。init tests 傳 rich（含 waitUntil/data/next）→ 必 index-sig；棒3a 4 檔 tests 傳 exact/subset → 不需。
- **NB-3**：`init` params 採 `{ provider?: string }`（MC-1）非 `Record<string,string>`（scout 初版）；bind-email 不含 params（OD-3b-4）→ 兩 handler ctx **刻意不同 shape**（忠於各自實際用法、非 uniform 抽象）。
- **NB-4**：init `getProvider(provider, env)`〔L76〕/ bind-email `getProvider(provider, env)`〔L71〕的 `env: Env` 由 棒3-env #144（`Env` +10 OAuth credential key）解 TS2559；**本棒不觸 env.d.ts**（ARCH-3B-10）、僅槓桿其已落地效果。第 3 個 getProvider caller `callback.ts:54` 屬棒4、不納本棒（ARCH-3B-15）。
- **NB-5**：shipped 集 = 2 source + 本 plan doc companion（per stage7 慣例）；source surface = {`init.ts`, `bind-email.ts`}（ARCH-3B-1）。owner CODE 前可否決 plan doc companion。
- **NB-6**：本棒**不觸** LINE id_token hardening（棒5、`callback.ts` verifyLineIdToken；runtime/security 行為變更、與 byte-identical type-only 互斥、ARCH-3B-15）。
- **NB-7（strict:true 延後成本，已揭露非本棒缺陷）**：`init` params 採 `{ provider?: string }` 於本階段（`strictNullChecks:false`）不 cascade（MC-1 坐實）；但未來 `strict:true`（§7 roadmap，rebaseline 之後、~998 error 浪次）會使 `params.provider?.toLowerCase()` 成 `string | undefined` → `SUPPORTED_PROVIDERS.includes(...)` 觸 TS2345、需補 narrowing（`if (!provider)` guard 或改非 optional）。此為 **strict 浪次的已知待補點**（與 init.ts 其他 optional-read 同批處理），**非本棒 scope**（MC-1 明選 optional 為本階段誠實型）；列此僅供 ① Arch / ② Codex Plan 審者知悉。

## 7. 後續棒次（owner S2 序列）
- 棒1 oauth utils（33）✅ PR-2do → 棒2 admin oauth-clients pair（19）✅ PR-2dp → 棒3a flow issuance clean-4（20）✅ PR-2dq → 棒3-env（enabler、REMOVED=0）✅ PR-2dr #144 → **本棒 棒3b init/bind-email（6；PR-2ds）** → **棒4 callback.ts（27；Tier-0 最重，R1 已解其 getProvider blocker）** → **棒5 LINE id_token hardening（獨立 additive-security、非 type-only）**。
- oauth 域（105）清完 → **audit 域（381，殿後最重，含 F-3 DORMANT）** → noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。

---

## Index receipt（archive 用；本檔結案後搬 MEMORY 對應）
- 清 oauth dirty-2 2 檔 6 noImplicitAny → 0（init.ts 5〔n/buf/platform/port/context〕+ bind-email.ts 1〔context〕、全 TS7006、zero dual-leaf）；REMOVED=6 / ADDED=0、byte-identical（init sha `f87d1c0f…` 9048 / bind-email sha `f32008…` 8060、cmp -s + SHA-256）。post-ratchet 408/18/317。
- OD 裁決：OD-3b-1 inline ctx + `[key:string]:unknown`（禁共用/export/EventContext 宣稱）、OD-3b-2 `env:Env`（util `ProviderSecretsEnv` 凍結）、**OD-3b-3 `toBase64Url` function overload（r1 ② 修訂、零 assertion、取代原 `as ArrayBufferLike`、閉合 TS-BOUNDARY-002）**、OD-3b-4 bind-email 無 params；micro `n:number`/`platform:string`/`port:string|null`。
- MC-1（params `{ provider?: string }` 非 `Record<string,string>`；試 optional → REMOVED=6/ADDED=0 無 cascade〔strictNullChecks:false〕→ 採用、condition #3 不觸發）+ MC-2（byte-identical 證據升級 cmp -s + SHA-256 + size>0）。
- ARCH-3B-1..16（SCOPE / IMMUTABLE-BASE / SOURCE-DELTA / ZERO-RUNTIME / CONTEXT-SHAPE / INDEX-SIG-ENVELOPE / NO-DYNAMIC-KEY / NO-ANY-NO-GLOBAL / UTIL-FROZEN / NO-ENV-SURFACE / SECURITY-BYTE-IDENTICAL / CASCADE / RATCHET / PROVIDER-PATH-HUNK / NO-FOLD-IN / NO-PKG-NO-TEST）。⚠ 標籤衝突：強制修正段 ARCH-3B-1/2 ≠ Locks 表 ARCH-3B-1/2（本檔以 MC-1/MC-2 別名承載強制修正）。
