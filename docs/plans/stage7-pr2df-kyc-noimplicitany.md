# Stage 7 PR-2df — kyc 域 noImplicitAny → 0（B1_KYC_DOMAIN_ZERO）

**gate-state**：`CODE_SELF_REVIEW_CLEAN`（Plan Gate 雙過 + owner `CODING_ALLOWED`；source commit `7341ce61`、機械層全綠、維度 A code self-review 3 reviewer 0 finding；待 ③ Codex Code → ④ ChatGPT Faithfulness → owner `MERGE_ALLOWED`）。
**型態**：single PR domain-batch、純 type-only、runtime byte-identical、零新型別、零新 import、無 DB migration。impl L1 / **review care L2/L3**（kyc gate 提款＝compliance/money-adjacent 不降級）。
**SPEC**：`CHATGPT_SPEC_DIRECTION_APPROVED_WITH_LOCKS: B1_KYC_DOMAIN_ZERO`（owner + ChatGPT 收斂，2026-06-30）。

## 1. Approved SPEC summary（B1）

清 kyc 域 4 檔全部 16 noImplicitAny → **0**。其中 `utils/kyc.ts` 的 PR-2n（#52）defer 殘留以 **4 個 local `null as null`**（null literal → null 型別鎖定）清除，**不**替 `requireKyc` 加 explicit return type、**不**處理 `requireAuth().user` 既有 any。

## 2. Base / commit / ratchet

- PR base：`fc2ac85c`（#129 PR-2de，main HEAD）｜ branch（Code 階段才開）`refactor/stage7-pr2df-kyc-noimplicitany`
- 預計 source：4 檔、12 changed lines（in-place 型別標註 + null-cast）
- ratchet：`634 / 54 / 281` → **`618 / 50 / 285`**（errorCount / errorFiles / cleanFiles；baseline `1119/175` 凍結、**不** `--update`）

## 3. 範圍（4 檔 / 16 errors / 12 lines）

| 檔 | noImplicitAny | 明細 | annotation |
|---|--:|---|---|
| `functions/utils/kyc-vendors/mock.ts` | 6 | TS7006×6 | `parseWebhook(request: Request, env: Env)` / `hmacSha256Hex(secret: string, body: string)` / `constantTimeEq(a: string, b: string)` |
| `functions/api/webhooks/kyc/[vendor].ts` | 5 | TS7031×3 + TS7011×1 + TS7006×1 | `onRequestPost({…}: { request: Request; env: Env; params: Record<string, string> })` / `.catch(() => null as null)` / `sha256Hex(s: string)` |
| `functions/api/auth/kyc/status.ts` | 4 | TS7031×4 | `onRequestOptions`/`onRequestGet` ctx `{ request: Request; env: Env }` |
| `functions/utils/kyc.ts` | 1 | TS7018（L143） | 4× `null as null`（L143/154/166 `user: null`、L176 `error: null`） |

> **標註僅兩種形式**：(1) param / handler-context 型別標註（清 14× TS7006/TS7031）；(2) `null as null` idiom（清 2× SNC-off null-widening：`[vendor].ts:44` `() => null as null` 清 TS7011〔該 arrow body 推 `null` 型別、非 implicit-any〕＋ `kyc.ts` 4 處清 TS7018）。**無 return-type 標註、無 `as any` / explicit return type**。`[vendor].ts:44` 的 `() => null as null` 是該檔 in-scope TS7011（SCOPE-2 承諾清除的 16 之一）的最小 type-only 清法、emit byte-identical（self-review faithfulness MINOR：原 `(): null => null` 改採 `null as null` idiom 與 TYPE-2 詞彙一致；Arch Gate 確認 TYPE-1 涵蓋「每個 in-scope error 的最小 type-only 清法」）。

### 3.1 Frozen diff（逐行；Codex scratch-replay 依據）

```
mock.ts
 L25  async parseWebhook(request, env) {                          → async parseWebhook(request: Request, env: Env) {
 L60  async function hmacSha256Hex(secret, body) {                → async function hmacSha256Hex(secret: string, body: string) {
 L72  function constantTimeEq(a, b) {                             → function constantTimeEq(a: string, b: string) {

[vendor].ts
 L25  export async function onRequestPost({ request, env, params }) {
      → export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
 L44  ? await sha256Hex(parsed.raw_body).catch(() => null)        → ? await sha256Hex(parsed.raw_body).catch(() => null as null)
 L92  async function sha256Hex(s) {                               → async function sha256Hex(s: string) {

status.ts
 L16  export async function onRequestOptions({ request, env }) {  → …({ request, env }: { request: Request; env: Env }) {
 L20  export async function onRequestGet({ request, env }) {      → …({ request, env }: { request: Request; env: Env }) {

kyc.ts
 L143 if (error) return { user: null, error }                    → if (error) return { user: null as null, error }
 L154       user: null,                                          →       user: null as null,
 L166       user: null,                                          →       user: null as null,
 L176 return { user, error: null, kyc }                          → return { user, error: null as null, kyc }
```

## 4. 反轉 PR-2n（#52）defer 的理由（PROOF-4）

- **PR-2n 當時 defer 的假設**：清 L143 TS7018「須給 `requireKyc` explicit return type」，而 success `user` 衍生自未型別化 `requireAuth` → 會 launder derived-any → 故 fail-closed 留殘留，等 auth-core typed / strict:true。
- **本 scout 實證推翻該假設**：清 L143 **不需** explicit return type——`requireKyc` 4 個 return 分支的 `null` literal（SNC-off 下 widening 成 any）逐一觸發 TS7018（spike：L143 修完跳 L154 → L166 → L176），**4 個 local `null as null` 即清乾淨**（kyc 域 → 0、forced tsc total 618、ADDED=0）。
- **這不是 derived-any laundering**：`null as null` 只把**真實的 null literal** 鎖成 `null` 型別（與本 PR `[vendor].ts:44` `() => null as null` 清 TS7011 同一 idiom、同 honesty-flavor）；**不**碰 success branch 的 `user`，其既有 any（來自 `requireAuth`）**維持可見**、與全 codebase 每個 call `requireAuth` 的已清檔同款。`requireKyc` 並未被宣稱 typed。
- **不踩 ratchet ban**：`null as null` 不命中 `BAN_PATTERNS`（typecheck-ratchet.mjs:269 只 ban `: any`/`as any`/`<any>`/容器 any/JSDoc any）。

## 5. Cascade 安全（forced tsc 實測 ADDED=0）

1. **adapter-union cascade 已實證否證**：kyc **無** named `KycAdapter` interface；`kyc.ts:204` 是 `ADAPTERS: Partial<Record<string, typeof mockKycAdapter>>`（結構快照、非共用契約）。≠ payments `PaymentAdapter` 的 coupled cascade（PR-2da）。標 `mock.ts request: Request` 後 `parseWebhook` return **唯一變動＝`raw_body` any→string**（`await request.text()`），傳到 `[vendor].ts:43 parsed.raw_body`、**唯一 consumer `sha256Hex(s: string)`（本 PR 同批標）接受 string→string**；其餘 return 欄（`status`/`level`/… 來自 `JSON.parse` 仍 any）不變。forced tsc ADDED=0 實證無外溢。
2. **single-file（不碰 env.d.ts）**：`mock.ts` 僅存取 `env?.KYC_MOCK_SECRET`（**已在 `types/env.d.ts:62` `KYC_MOCK_SECRET?: string`**）→ 標 `env: Env` 零 TS2339。`status.ts`/`[vendor].ts` 僅存取 `env.chiyigo_db` + forward。皆非 Path-A。
3. **D1 = any**（repo 無 `@cloudflare/workers-types`）→ `env.chiyigo_db` query/`.first`/`.run` 鏈 any、無 row cascade。
4. **dual-leaf = assignable 變體**（非 ecpay TS2345 陷阱）：`kyc.ts`/`status.ts`/`[vendor].ts` 被 `tests/integration/kyc.test.ts` + `p4-p2-hardening.test.ts` import；二者皆 `import { env } from 'cloudflare:test'`（`ProvidedEnv extends Env`）直傳 handler → 標 `env: Env` wide-OR-equal assignable、零 TS2345。`mock.ts` 無直接 test importer（僅 transitive）。
5. **requireKyc production caller = 0**（僅 `kyc.test.ts:110`；⚠ `requireKyc`「gate 提款」現為 Phase F-1 scaffold、尚未接 prod 提款端點〔提款 gate 走 payments 自有 helper〕＝PR 前既存狀態、非本 type-only PR 引入）→ return union 形狀變動 cascade 面極小；forced tsc ADDED=0 已證。

## 6. Byte-identical（runtime 零行為變更硬 gate；PROOF-2）

esbuild `--loader=ts --format=esm` stdin、**base-blob `fc2ac85c` vs annotated-blob**（非恆真）4/4 MATCH：

| 檔 | emit sha256（base == annotated） |
|---|---|
| `utils/kyc.ts`（含 4× null-cast） | `7cc6431df0f7995cc68be816003f621da60376dbd0bb259d4f74fc7ff3213859` |
| `utils/kyc-vendors/mock.ts` | `2affb95808415b1edfdd7bc566b817d0182fd2e6c6686b1531a3858e27718453` |
| `api/webhooks/kyc/[vendor].ts` | `69ce4c036d26d22ef4b0dceac7b37ec281c824075b20d15451c360a6d7b408dc` |
| `api/auth/kyc/status.ts` | `8a0a3e9b813703e3a9bf983f9ddb2c9f0fed4a346206c967852a3c1877bd2693` |

→ 所有改動純 type annotation / null-cast，emit 後完全消失、**零 runtime**。

## 7. Scope / Ban locks（ChatGPT SPEC）

| lock | 內容 |
|---|---|
| SCOPE-1 | 單 PR，限 kyc 域 **4 source 檔**（mock / [vendor] / status / kyc.ts）＋ 1 docs gate-log（本 plan doc，流程產物、非 source/runtime） |
| SCOPE-2 | 目標 16→0；ratchet `634→618 / 54→50 / 281→285` |
| TYPE-1 | mock / [vendor] / status — **每個 in-scope error 的最小 type-only 清法**：param + handler-context 型別標註（TS7006/7031）＋ `[vendor].ts:44` `() => null as null`（TS7011 null-widening 最小 fix、非 handler-context/param；ARCH-L3） |
| TYPE-2 | `utils/kyc.ts` 僅 4 個 `null as null`（`user: null` ×3、`error: null` ×1） |
| BAN-1 | 禁 `as any` / `: any` / 容器 any / `unknown as X` 假清 |
| BAN-2 | 禁替 `requireKyc` 加 explicit return type |
| BAN-3 | 禁觸 `requireAuth` / `auth.ts` / `jwt.ts` / `env.d.ts` / migration / test 行為 |
| BAN-4 | 禁改 business logic / KYC 狀態機 / webhook 驗簽 / audit 流程 |

### 7.1 ARCH locks（① ChatGPT Arch Gate 增補；`CHATGPT_ARCH_APPROVED_WITH_LOCKS`）

| lock | 內容 |
|---|---|
| ARCH-L1 | `null as null` 僅允許本 PR 白名單 **5 處**：`[vendor].ts:44` ×1、`kyc.ts` L143/154/166/176 ×4；不得擴散成一般 cast pattern |
| ARCH-L2 | `utils/kyc.ts` 不得新增 explicit return type、不得替 `requireAuth`/`requireKyc`/success `user` 建推導型別包裝（不 launder derived-any） |
| ARCH-L3 | `[vendor].ts:44` 在 plan/code 須說明為 **TS7011 最小 type-only fix**、不得描述為 handler-context / param annotation |
| ARCH-L4 | Code Gate 必重跑並附：forced tsc `618`、sort-diff `REMOVED=16/ADDED=0`、4/4 byte-identical、`git diff --name-status` 僅 4 source + plan doc |
| ARCH-L5 | `CLEANUP_PLAN.md`（pre-existing untracked）不得進本 PR diff；Code 階段**明確 stage** 4 source + plan doc（禁 `git add -A`/`.`） |
| ARCH-L6 | 不得觸 `auth.ts`/`jwt.ts`/`env.d.ts`/migration/tests/KYC business logic/webhook 驗簽/audit behavior/archive/R2/retention |
| ARCH-L7 | Codex scratch-replay 若見任何 ADDED error / emit drift / name-status 多檔 / `null as null` 超白名單 → 退回 Plan 修正、不進 Code |

## 8. Verification gates（PROOF-1..3 + merge-front）

| gate | 證據要求 |
|---|---|
| forced tsc | `tsc -b tsconfig.solution.json --force`；sort-diff vs base **REMOVED=16 / ADDED=0**（PROOF-1） |
| byte-identical | esbuild stdin 4 檔 base==committed MATCH（PROOF-2） |
| name-status | `git diff --name-status` 僅 4 source（+1 docs gate-log）（PROOF-3） |
| ratchet enforce | `ratchet OK`（618≤1119、285≥175、diff 無新增 BAN_PATTERN） |
| merge-front 7 | lint · typecheck:ratchet · verify:browser-pipeline · test:cov · test:int（~14min）· build:functions · npm audit（⚠ jwt.test flaky ~1.6% 紅 re-run，本棒 byte-identical 不碰 jwt） |

## 9. Risk table

| 項目 | 等級 | 影響 | 防禦 |
|---|--:|---|---|
| 重開 PR-2n documented defer | 中 | 審查者質疑反轉既有決策 | §4 明寫「新 scout 實證推翻當時假設、非改標準」；附 spike L143→154→166→176、ADDED=0 |
| `null as null` 被誤解為 cast 洗白 | 中 | 被視為假清 noImplicitAny | TYPE-2 鎖定僅 null literal → null；BAN-1/2 禁 `as any` / explicit return type；不宣稱 `user` typed |
| kyc.ts return union 形狀變動 | 低 | 呼叫端推斷變窄 | production caller=0；forced tsc ADDED=0；Plan/Code Gate 必重跑 |
| adapter-union cascade | 低 | 拖出跨檔錯誤 | 已實證否證（§5.1）；return 僅 `raw_body` any→string、consumer `sha256Hex(s:string)` 接受、ADDED=0 |
| runtime drift | 低 | KYC/webhook 行為被改 | byte-identical esbuild 硬 gate（§6）；source 僅 type annotation / null-cast |

## 10. Defense table（runtime 邊界皆不動）

| 機制 | 處理 | 說明 |
|---|---|---|
| RateLimit / 權限 / Input / Log / Retry / 備援 | 不處理 | type-only PR、不改 runtime / webhook / auth / audit 行為 |
| 監控 | 處理 | ratchet + forced tsc(ADDED=0) + byte-identical + name-status 作 gate |

## 11. 結論

本 PR = **type-only / single PR / no runtime behavior change / no env.d.ts / no Path-A / no coupled PR**；kyc 域 noImplicitAny **16 → 0**。`utils/kyc.ts` 的 PR-2n defer 殘留以 4 個 honest null-cast 清除（非 derived-any laundering）。F-3 DORMANT-safe（`[vendor].ts:23` 僅 import F-3 aggregate 模組的凍結常數 `DEBUG_REASON_CODES`〔`Object.freeze`、無 R2/retention/cron side effect〕、4 檔皆不 invoke aggregate/retention/R2/checkpoint；`safeUserAudit` transitive cold_class feed 但 args byte-unchanged）。

## 12. Gate 軌跡

| gate | 狀態 | 證據 |
|---|---|---|
| SPEC | `CHATGPT_SPEC_DIRECTION_APPROVED_WITH_LOCKS` | owner + ChatGPT 收斂 B1_KYC_DOMAIN_ZERO（SCOPE/TYPE/BAN/PROOF locks） |
| 維度 A plan self-review | `PLAN_SELF_REVIEW_CLEAN` | 3 readonly-reviewer 三維（繼承 Opus 4.8）一輪 **0 BLOCKING / 0 MAJOR**：plan-faithfulness〔2 MINOR/INFO：L44 idiom 統一→`() => null as null`、SCOPE-1=4 source〕· type-cascade〔1 MINOR：§5.1 `raw_body` any→string 措辭〕· security-scope〔0 finding；byte-identical 4/4 含 sed-injected annotated 版重算 MATCH〕。findings 全修入；**主線獨立重跑** forced tsc 618 / REMOVED=16 / ADDED=0 / byte-identical 4/4 親證（非採 subagent raw） |
| ① ChatGPT Arch | `CHATGPT_ARCH_APPROVED_WITH_LOCKS` | 6 決策點全 APPROVED（PR-2n 反轉=新實證、TYPE-1 擴涵 L44、null-cast 非假清、Convention A 一致、零契約/migration、F-3-safe）；+ARCH-L1..L7 |
| ② Codex Plan | `CODEX_PLAN_APPROVED` | scratch replay @base `fc2ac85c` 親驗：base 634→replay 618、REMOVED=16（全 4 kyc 檔）/ADDED=0、name-status 4 source、byte-identical 4/4 MATCH、`null as null` 恰 5 白名單（`as any`/`unknown as`=0）、`npm run typecheck:ratchet` → ratchet OK 618/285 |
| Code Gate 機械層 | 全綠 | source `7341ce61`：forced tsc 618 · REMOVED=16/ADDED=0 · byte-identical 4/4 · name-status 4 source · ratchet OK 618/285 · lint(eslint+compat+workflows) · build:functions · verify:browser-pipeline · **test:int 75f/1328**（kyc 15 + p4-p2-hardening 10）· test:cov 25f/90.28% · npm audit 0 |
| 維度 A code self-review | `CODE_SELF_REVIEW_CLEAN` | 3 readonly-reviewer 三維（diff-fidelity / runtime-security / evidence、繼承 Opus 4.8）一輪 **0 finding**；2 INFO（CLEANUP_PLAN.md staging 紀律 + kyc.ts:133-136 pre-existing stale JSDoc，皆 out-of-scope）；主線獨立親跑全 gate 裁決（非 subagent raw） |
| ③ Codex Code | pending | scratch replay @base `fc2ac85c` / committed `7341ce61` |
| ④ ChatGPT Faithfulness | pending | — |
