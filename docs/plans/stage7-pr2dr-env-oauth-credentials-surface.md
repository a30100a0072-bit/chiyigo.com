# Stage 7 PR-2dr — 棒3-env：`types/env.d.ts` 補 OAuth provider credential surface（R1 governance enabler）

**SPEC**: `STAGE7_ENV_OAUTH_CREDENTIAL_SURFACE`
**狀態**: `PLAN_SELF_REVIEW_CLEAN`（owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-10 → 維度 A self-review 0 新發現 → **① ChatGPT Arch R1 `CHANGES_REQUIRED`（方向通過、4 required refinement ARCH-R1..R4 + 4 lock ARCH-ENV-11..14）已納入** → 修訂後再自審 0 新發現 → 本 commit＝plan-local anchor；**① Arch Gate 尚未閉合**，待 owner 送最終收據錨定本 plan commit SHA，ARCH-ENV-14）
> **gate 進程**: scout〔standalone overlay `REMOVED=0/ADDED=0` + 對照對 Leg A/B TS2559 present/absent + `git checkout --` 還原、overlay 零殘留、ratchet 還原 414/20/315〕→ owner **`SPEC_APPROVED_WITH_LOCKS`（L2 governance、OD-env-1 FOLLOW-UP、OD-env-2 credentials 註解核准、10 條 ARCH-ENV-1..10）** → 本 plan doc → 維度 A 對抗式 self-review（5 finder + 主線裁決、0 新發現）→ **① ChatGPT Arch R1 `CHANGES_REQUIRED`**（方向/scope/證據判定通過；4 required refinement **ARCH-R1 red-test-integrity / ARCH-R2 immutable-base / ARCH-R3 full-diff-allowlist / ARCH-R4 plan-anchor** + 4 lock **ARCH-ENV-11..14**）→ **修訂納入 R1..R4 + 再自審 0 新發現 + header→`PLAN_SELF_REVIEW_CLEAN` + plan-local commit** → **① ChatGPT Arch 最終收據錨定 plan commit SHA**（owner 送）→ ② Codex Plan → `CODING_ALLOWED` → CODE fresh replay → ③ Codex Code → ④ ChatGPT faithfulness → owner `MERGE_ALLOWED` + CI green → squash-merge。
> **狀態 SoT**: 本 header + 對應中文報告為當前 gate-state 權威。目前＝`PLAN_SELF_REVIEW_CLEAN`（plan-local commit）；**① ChatGPT Arch Gate 尚未閉合（R1 `CHANGES_REQUIRED`、待最終收據錨定本 plan commit SHA，ARCH-ENV-14）；尚未 `CODING_ALLOWED`、尚未動 `types/env.d.ts`、尚未 push/PR/merge**。

**base**: `3a4f29d8`（origin/main，#143 PR-2dq 棒3a SHIPPED 後）
**級別**: **L2 governance**（owner 裁 2026-07-10）——觸共用 `Env` 型別面，但屬 additive optional、zero JS emit、zero runtime、zero cascade（scout 實測），無須升 L3。
**性質**: 純 type-only `.d.ts` declaration 變更、**zero JS emit**（`.d.ts` 結構性保證）、零 runtime / 零 schema / 零 API / 零 migration / 零部署面 / 零 test 改動 / 零 `oauth-providers.ts` 改動。**本棒是 enabler、預期移除錯誤數 = `0`**（非 noImplicitAny reducer）；價值在解除後續 棒3b（init/bind-email）+ 棒4（callback）的 `getProvider()` `Env → ProviderSecretsEnv` weak-type TS2559 blocker。

**owner ruling（2026-07-10 `SPEC_APPROVED_WITH_LOCKS`）**: L2 governance｜source 核准僅 `types/env.d.ts`（+ plan companion）｜OD-env-1 = **FOLLOW-UP 不摺入本棒**（保留 `ProviderSecretsEnv` least-privilege 窄介面原樣）｜OD-env-2 = **核准獨立段落 + 註解統稱 credentials（非 secrets）**、置於 `External services` 後 `Payments` 前｜10 條 Architecture Locks（ARCH-ENV-1..10，§1.2 逐字）｜Plan 必載 5 點（§5.1）｜風險表（§5.2）。

**① ChatGPT Arch R1（2026-07-10 `CHANGES_REQUIRED`；方向/scope/證據判定通過、Arch Gate 未閉合）**: 4 required refinement 已納入本修訂——**ARCH-R1** red-test-integrity（§4；刪「flaky 直接 rerun」）、**ARCH-R2** immutable-base（§4；`RATCHET_BASE_REF=3a4f29d8` 取代 `$(git rev-parse main)`）、**ARCH-R3** full-diff-allowlist（§4；完整 changed-files 恰 {`env.d.ts`, plan doc}、禁先過濾 source subset）、**ARCH-R4** plan-anchor（header→`PLAN_SELF_REVIEW_CLEAN` + plan-local commit + ① 最終收據錨定該 commit SHA）｜+ 4 lock **ARCH-ENV-11..14**（§1.2）｜授權：建 branch + 改/commit 僅本 plan doc，**未授權** `env.d.ts` / 任何 production·test·config / `CODING_ALLOWED` / push·PR·merge。

> ⚠ 本棒 **tree 非 fully clean**：`CLEANUP_PLAN.md`（pre-existing untracked、**不屬本 PR、挑檔 stage 排除**）+ 本 plan doc。CODE stage 的 **FULL-DIFF-ALLOWLIST（ARCH-ENV-13）** = `3a4f29d8..<source>` 完整 changed-files 恰 {`types/env.d.ts`, 本 plan doc}；其中 **source 面**恰 `types/env.d.ts`（ARCH-ENV-8，輔）。本 plan-local commit（PLAN 階段）只含本 plan doc（env.d.ts 屬 CODE stage、未授權動）。

---

## 1. Scope 與 locks

### 1.1 SCOPE（owner ARCH-ENV-1 / ARCH-ENV-8）: **1 source**

- `types/env.d.ts`（`Env` interface additive +10 optional OAuth provider credential key）
- （+ 本 plan doc companion，per stage7 慣例；**不計入 source surface**）

**唯一變更**：在 `Env` interface 內、`External services` 段（現 L42-52，末行 `ALERT_WEBHOOK_URL?: string;`）之後、`Payments` 段（現 L54）之前，additive 插入一獨立段落：

```ts
    // ── OAuth provider credentials (runtime bindings; read by getProvider())
    DISCORD_CLIENT_ID?: string;
    DISCORD_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    LINE_CLIENT_ID?: string;
    LINE_CLIENT_SECRET?: string;
    FACEBOOK_CLIENT_ID?: string;
    FACEBOOK_CLIENT_SECRET?: string;
    APPLE_CLIENT_ID?: string;
    APPLE_CLIENT_SECRET?: string;
```

- 註解＝owner ARCH-ENV-9 核准 verbatim（`OAuth provider credentials (runtime bindings; read by getProvider())`；**統稱 credentials、不稱 secrets**）。
- 10 key＝完全依 `functions/utils/oauth-providers.ts` L134-140 `ProviderSecretsEnv` 的**名稱 / 型別（`?: string`）/ provider 順序**（Discord→Google→Line→Facebook→Apple，各 `CLIENT_ID` 後接 `CLIENT_SECRET`）。**不多、不少、不 rename、不擴增 Apple 其他欄位、不新增其他 provider**（ARCH-ENV-2）。
- 全 10 key 保持 `?: string`（ARCH-ENV-3）；`env.d.ts` header L12-15 慣例：optional binding 標 `?:`（誠實反映「該 credential 未必在所有環境設」；getProvider 已 `?? null` graceful 處理缺值）。

### 1.2 Block locks（**ARCH-ENV-1..10** = owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-10 逐字落地；**ARCH-ENV-11..14** = ① ChatGPT Arch R1 `CHANGES_REQUIRED` 回寫；① 最終收據待錨定本 plan commit SHA、ARCH-ENV-14）

| Lock | 核准內容 |
|---|---|
| **ARCH-ENV-1 SCOPE** | source diff 僅 `types/env.d.ts`。plan companion 不計入 source surface。禁改任何 handler、`oauth-providers.ts`、tests、schema、migration、deployment config。 |
| **ARCH-ENV-2 EXACT-KEYSET** | 恰加 10 個 optional `string` key：Discord / Google / Line / Facebook / Apple 各 `CLIENT_ID` / `CLIENT_SECRET`。不得多、不得少、不得 rename。 |
| **ARCH-ENV-3 OPTIONALITY** | 10 個欄位全部保持 `?: string`。不得改 required、不得加 fallback value、不得改 nullable union。 |
| **ARCH-ENV-4 TYPE-ONLY** | 僅 `.d.ts` declaration change；不得產生 JS、不得改 runtime binding、不得宣稱此棒建立或部署任何 credential。 |
| **ARCH-ENV-5 PROVIDER-BOUNDARY** | `ProviderSecretsEnv`、`getProvider()` signature、動態索引（`env[\`${upper}_CLIENT_ID\` as keyof ProviderSecretsEnv]`）、provider list（`PROVIDERS`）全部凍結。`Partial<Pick<Env, ...>>` 僅列 follow-up（OD-env-1）。 |
| **ARCH-ENV-6 CASCADE** | CODE commit fresh replay 必證 forced-tsc `REMOVED=0 / ADDED=0`，且含 `cloudflare:test` leaf；任何新增錯誤直接阻斷、回 plan。 |
| **ARCH-ENV-7 RATCHET** | ratchet 必維持 `414/20/315`；禁 `--update`；不得把此 enabler 宣稱為 noImplicitAny reduction。 |
| **ARCH-ENV-8 CHANGED-FILES** | CODE gate 機械核對 source changed-files 恰為 `types/env.d.ts`；任一其他 source/test/config 檔即 scope violation。 |
| **ARCH-ENV-9 COMMENT-SEMANTICS** | 文件及註解統稱 `OAuth provider credentials` / `OAuth credential bindings`；不得把 client IDs 宣稱為 secrets。 |
| **ARCH-ENV-10 FOLLOW-UP-NONBLOCKING** | `Env` 與 `ProviderSecretsEnv` 鏡像 drift 屬已知維護風險、不阻擋本棒；後續若處理，必須獨立 SPEC、獨立 source commit、重跑 type/cascade gates。 |
| **ARCH-ENV-11 RED-TEST-INTEGRITY**（① R1 ARCH-R1） | 任何首次 test red 必留存首次失敗輸出並判定原因；**禁以「known flaky」為由直接 rerun 至 green**（避免把 regression 誤歸環境雜訊、與 halt-on-red / fresh replay 治理衝突）。僅在已有獨立證據證明非本棒造成、且首次 red 已完整留存時，才可補跑一次作診斷；補跑不得抹除首次 red。 |
| **ARCH-ENV-12 IMMUTABLE-BASE**（① R1 ARCH-R2） | 所有 ratchet / set-diff / changed-files replay 固定以 `3a4f29d8`（full `3a4f29d8d9bc5a864ce6e3c25b900d32acd01ae6`）為 base；**禁解析移動中的 `main` ref（`$(git rev-parse main)`）取代 approved base SHA**。replay 前先驗 base 為 HEAD 祖先。 |
| **ARCH-ENV-13 FULL-DIFF-ALLOWLIST**（① R1 ARCH-R3） | CODE stage `3a4f29d8..<source>` **完整** changed-files 恰為 {`types/env.d.ts`, `docs/plans/stage7-pr2dr-env-oauth-credentials-surface.md`}；**禁先依 source/docs 型別過濾後才核對**（防 anti-curated 漏檔）。owner 若 CODE 前否決 plan companion → 完整 changed-files 恰 1 檔 `types/env.d.ts`。ARCH-ENV-8 source-subset 核對保留、不取代本完整 allowlist。 |
| **ARCH-ENV-14 PLAN-ANCHOR**（① R1 ARCH-R4） | Arch Gate 只對 `PLAN_SELF_REVIEW_CLEAN` 的**已 commit** plan SHA 生效；未 commit draft 不構成外部 gate closure。① 最終收據必錨定該 plan commit SHA。 |

## 2. SSOT 對齊（每個型別決策的真相源）

- **10 key 的真相源 = `functions/utils/oauth-providers.ts` L134-140 `ProviderSecretsEnv`（凍結，ARCH-ENV-5）**：本棒把 getProvider 現讀的 credential surface **鏡像宣告**進 `Env`，使 `Env` 對 `ProviderSecretsEnv` 由「零屬性重疊」變「10 屬性重疊」。**方向 = 補 `Env` surface（least-privilege 窄型 `ProviderSecretsEnv` 不動）**，非回退窄型（對映 [[feedback_util_env_param_pick_not_full_env]]：util 收窄型是正解；本棒補的是被窄型 `Pick`/鏡像的 `Env` 母表）。

- **weak-type 機制（TS2559 crux）**：`ProviderSecretsEnv` 是全 optional interface（weak type）。TypeScript weak-type assignability 規則要求 source 與 target **至少一個共同屬性**，否則 TS2559「no properties in common」。`Env` 現況零 OAuth CLIENT key → 對 `ProviderSecretsEnv` 零重疊 → getProvider caller 標 `env: Env` 時 TS2559。加 10 key 後 `Env` 含全部 10 key → 重疊 → `Env` assignable to `ProviderSecretsEnv` → TS2559 消（scout 對照對 Leg A/B 坐實，§3.B）。

- **credential 語意（非 secret；ARCH-ENV-9）**：`*_CLIENT_ID` 為 OAuth 公開識別碼、非機密；`*_CLIENT_SECRET` 才是機密。10 key 統稱「OAuth provider credentials」語意精確（涵蓋公開 ID + 機密 secret 兩類），故註解與 plan 一律用 credentials / credential bindings，不用 secrets。

- **optional `?: string`（ARCH-ENV-3）**：OAuth provider 為 opt-in feature（非所有環境設齊 5 provider；Apple 尚有 `$99/yr` 帳號 TODO，見 oauth-providers.ts L107）。標 required 會使「未設某 provider」在 CF 部署誤報缺 binding；標 `?:` 誠實 + 沿 `env.d.ts` header 既有「optional binding 標 `?:`」慣例（header 原文用語為 "optional secrets"、涵蓋 preview/debug/telemetry；本棒 credential surface 含**公開 `*_CLIENT_ID` + 機密 `*_CLIENT_SECRET`** 兩類，統稱 credentials、不因沿用此 optionality 慣例而改稱 client ID 為 secret，ARCH-ENV-9）。

## 3. 證據（scout transient overlay 實測 @ working-tree `3a4f29d8`，已 `git checkout --` 還原、**overlay 零殘留**；CODE stage 於 source commit **fresh replay** 重證，ARCH-ENV-6）

**A. Standalone forced-tsc set-diff**（只加 `Env` 10 key、不動 handler/`oauth-providers.ts`）— `npx tsc -b tsconfig.solution.json --pretty false --force`（uniq set，`sort -u` 後 `comm`）：
- base error set = **414 unique**（= ratchet report 414/20/315；raw 414、**零 dual-leaf 重複**）。
- overlay（`Env` +10 key）→ **414 unique**；set-diff **REMOVED=0 / ADDED=0**（全 solution，含 `cloudflare:test` `ProvidedEnv extends Env` tests-leaf——繼承 10 key 但無任何 test 破）。baseline `1119/175` frozen（reduce 禁 `--update`）。
- **零 cascade 機制（結構免疫 + 三重使用免疫 + load-bearing 條件，主線獨立實測核對）**：
  - **結構**：`env.d.ts` 只被 **2/4 solution leaf** include（`tsconfig.functions.json:31` + `tsconfig.tests.json:37`）；`tsconfig.scripts.json`（`scripts/**`）+ `tsconfig.browser-typecheck.json`（`src/js/**`）**不 include env.d.ts**（主線實測 `\bEnv\b` 於 `scripts/**`、`src/js/**` 各 0 命中）→ 該二 leaf 結構性無法 cascade；cascade 面僅 functions + tests 2 leaf。`exactOptionalPropertyTypes` 未設（5 tsconfig 皆 `strict:false`）→ `?: string` 無 exactness cascade。
  1. 4 個 integration test（cred-reverify / callback / oauth-nonce / rate-limit）全走 `Object.assign(env, { GOOGLE_CLIENT_ID:…, … })`；`Object.assign<T,U>(target,source): T&U` **不對 source 做 excess-property check against target** → 加不加 key 皆無 error（雙向免疫）。
  2. unit test `oauth-providers.test.ts` L4-10 用 untyped object literal 傳給 `getProvider(name, env: ProviderSecretsEnv)`——param 是 `ProviderSecretsEnv` 非 `Env` → 與本棒無關。
  3. grep 全 `.ts`：**無 `satisfies Env` / 無 `const x: Env = {…}` exhaustive literal / 無 `keyof Env` / 無 `Required<Env>` / 無 typed `env.*_CLIENT_*` read** → additive optional key 對此類天然 backward-compatible、亦無既存 TS2339 可 REMOVE。
  - **REMOVED=0 的 load-bearing 條件**：head tree 三個 getProvider caller 全 implicit-`any`（未標 `env: Env`）→ 無 TS2559 可 REMOVE；**ARCH-ENV-8 changed-files lock（source 恰 `env.d.ts`）保證本棒不標任何 caller** → REMOVED=0 成立。（標 `env: Env` 屬 棒3b/棒4，本棒不含。）

**B. R1-blocker-proof（對照對；compiler-as-oracle，非推斷）** — 外科式隔離探針：只在 `bind-email.ts:31` 解構加局部型別 `const { request, env }: { request: Request; env: Env } = context`（不動 handler 簽名 → 隔離純 TS2559、避開 tests 傳 rich EventContext 的 TS2353）：

| 狀態 | probe | 結果 |
|---|---|---|
| Leg A：**有 R1**（`Env` +10 key） | bind-email `env: Env` | **TS2559 消失**、ADDED=0 / REMOVED=0（`Env` assignable to `ProviderSecretsEnv`）|
| Leg B：**無 R1**（base） | bind-email `env: Env` | **TS2559 出現** `bind-email.ts(71,30): error TS2559: Type 'Env' has no properties in common with type 'ProviderSecretsEnv'`、ADDED=1（414→415；raw 2 條 / unique 1 條 = dual-leaf，[[feedback_tsc_forced_solution_dual_leaf_error_count]]）|

坐實 R1 正是消除 `getProvider` TS2559 的直接原因。**getProvider production caller = 恰 3**（`functions/api/auth/oauth/[provider]/init.ts:76` · `functions/api/auth/oauth/[provider]/callback.ts:54` · `functions/api/auth/oauth/bind-email.ts:71`，全現 `env:any` 遮蔽）；三者同構、R1 一次解全部（Leg A/B 以 bind-email 坐實，init/callback 為同型 `getProvider(provider, env)` call）。

**C. Zero JS emit（取代 byte-identical）**：`env.d.ts` 為 `.d.ts`（`export {}` + `declare global`）→ TypeScript 對 `.d.ts` **零 `.js` emit**（結構性保證，非 byte-identical 量測）。RUNTIME 面坐實 = (a) source changed-files 恰 `types/env.d.ts`（ARCH-ENV-8）、(b) `oauth-providers.ts` 及全 `.ts` 一字不動（`git diff` 空 / byte-identical）、(c) `build:functions` 產物不變。

**D. transient revert clean**：`git checkout -- types/env.d.ts functions/api/auth/oauth/bind-email.ts` → scout 時 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（pre-existing；本 plan doc 當時尚未建）、`git diff --stat` 空、HEAD 未動 `3a4f29d8`、ratchet 還原 **414/20/315**。（本 plan doc 建立後現樹另含 `?? docs/plans/stage7-pr2dr-…md` untracked，見 header ⚠ 與 §性質。）

## 4. 本地機械 gate（CODE stage 全套實跑；對齊 CI `ci.yml`；ARCH-ENV-6 fresh replay，禁沿用 scout overlay）

CODE stage @ final source commit 必跑並讀真實輸出：`typecheck:ratchet`（**enforce、必維持 `414/20/315`、baseline `1119/175` frozen 未 `--update`**、ARCH-ENV-7；帶 **`RATCHET_BASE_REF=3a4f29d8`（immutable base、ARCH-ENV-12；禁 `$(git rev-parse main)`）**；replay 前先驗 base 為 HEAD 祖先：`git merge-base --is-ancestor 3a4f29d8 HEAD`（exit 0）或 `test "$(git merge-base HEAD 3a4f29d8)" = "$(git rev-parse 3a4f29d8)"`）· `lint`（eslint + lint:workflows）· `verify:browser-pipeline` · `test:cov` · `test:int`（含觸 OAuth 的 integration test — TEST-LOCK 下不改；standalone overlay ADDED=0 已含 tests-leaf 反證無新型別錯）· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。

另 **REPLAY（ARCH-ENV-6，source commit fresh replay）**：
- forced tsc set-diff **`REMOVED=0 / ADDED=0`**（全 solution、dual-leaf-aware、**含 `cloudflare:test` leaf**）；任何 ADDED>0 直接阻斷、回 plan。
- **FULL-DIFF-ALLOWLIST 機械核對（ARCH-ENV-13，主）**：`git diff --name-only 3a4f29d8..<source>` **完整** changed-files 恰為 {`types/env.d.ts`, `docs/plans/stage7-pr2dr-env-oauth-credentials-surface.md`}——**禁先依 source/docs 型別過濾**（防 anti-curated 漏檔）。owner 若 CODE 前否決 plan companion → 完整 changed-files 恰 1 檔 `types/env.d.ts`。任一額外檔（含非 source 的 docs/config、含 pre-existing `CLEANUP_PLAN.md`）= scope violation、停 gate。
- **source-subset 核對（ARCH-ENV-8，輔、保留不取代）**：上述完整 allowlist 內的 source 面恰 `types/env.d.ts`。
- **zero-emit 坐實（ARCH-ENV-4）**：全 `.ts` `git diff` 空（`oauth-providers.ts` 尤其一字不動）、`build:functions` 產物不變。

> **RED-TEST-INTEGRITY（ARCH-ENV-11）**：任何 test failure 均先視為 gate red、保留首次失敗輸出並判定原因；**不得以「known flaky」為由直接 rerun 至 green**。僅在已有獨立證據證明非本棒造成、且首次失敗已完整留存時，才可補跑一次作診斷；補跑不得抹除首次 red。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。

## 5. Open Decisions / owner ruling（2026-07-10）

| 項 | 裁決 | SoT / 理由 |
|---|---|---|
| 級別 | **L2 governance** | 共用型別面但 additive optional / zero emit / zero runtime / zero cascade；無須升 L3 |
| **OD-env-1** ProviderSecretsEnv derive | **FOLLOW-UP，不摺入本棒** | 改 `Partial<Pick<Env, ...>>` 會動 production `.ts`（`oauth-providers.ts`）擴大範圍，且把「補共用契約」與「消除型別鏡像」兩個可獨立驗證的變更綁一起。先保留 least-privilege 窄介面原樣（ARCH-ENV-5/10） |
| **OD-env-2** 放置 + 註解 | **核准獨立段落、註解統稱 credentials（非 secrets）**、置 `External services` 後 `Payments` 前 | `*_CLIENT_ID` 非機密；統稱 secrets 語意不精確（ARCH-ENV-9） |

### 5.1 Plan 必載（owner 明列 5 點）

1. **本棒是 enabler，預期移除錯誤數 = `0`**（ratchet `414/20/315` unchanged；ARCH-ENV-7）。
2. **直接受益 caller 恰 3**：`functions/api/auth/oauth/[provider]/init.ts:76`、`functions/api/auth/oauth/[provider]/callback.ts:54`、`functions/api/auth/oauth/bind-email.ts:71`。
3. **本棒只解除 `Env → ProviderSecretsEnv` weak-type incompatibility**；**不處理**三個 caller 現存的 `env:any`（那屬 棒3b/棒4）。
4. **棒3b 及 棒4 不得納入本棒驗證結果，也不得藉機提前修改**（ARCH-ENV-1）。
5. **「production 已有相關 runtime binding」只能列為 scout 觀察、不成為本棒可驗證宣稱**；本棒能證明的只有型別宣告 + 零 runtime diff（ARCH-ENV-4）。

### 5.2 風險表（owner 明列）

| 項目 | 等級 | 影響 | 防禦 |
|---|---:|---|---|
| 共用 `Env` surface 漂移 | 中 | 未來新增 provider 時可能與 `ProviderSecretsEnv` 不同步 | OD-env-1 登記 follow-up；本棒 exact-keyset 鎖定（ARCH-ENV-2/10）|
| client ID 被誤稱秘密 | 低 | 文件語意錯誤，可能導致錯誤安全假設 | 統一改稱 credentials（ARCH-ENV-9）|
| enabler 被誤報成 ratchet reduction | 中 | 污染 Stage 7 指標與收據 | 明載 `REMOVED=0`、ratchet unchanged（ARCH-ENV-7 / §5.1.1）|
| scope creep 至 provider source | 中 | 純 declaration change 變成 production source change | changed-files lock + provider-boundary lock（ARCH-ENV-8/5）|
| optional 欄位被改 required | 高 | 大量 test/env mock cascade | optionality lock + forced-tsc set-diff（ARCH-ENV-3/6）|

### 5.3 Gate 收據

- **scout overlay 實測**（2026-07-10 @ `3a4f29d8`）：standalone REMOVED=0/ADDED=0（含 `cloudflare:test` leaf）· 對照對 Leg A（R1 → TS2559 absent）/ Leg B（no-R1 → TS2559 present `bind-email.ts(71,30)`、ADDED=1 dual-leaf）· `git checkout --` 還原、overlay 零殘留、ratchet 還原 414/20/315。
- **維度 A self-review R1**（2026-07-10；5 finder Agent 並行對抗〔lock+keyset / cascade / scope+semantics / mandated+enabler / evidence+gate-state〕+ 主線裁決 + 主線獨立實測複驗，非採 raw）：**0 BLOCKER/MAJOR**；納入 4 項 precision 強化（leaf-inclusion 結構免疫 / §2 credential-not-secret 措辭 / caller 全路徑 / §3.D scout-time git-status）；主線再讀 0 新發現。
- **① `CHATGPT_ARCH_CHANGES_REQUIRED` R1**（2026-07-10；**方向/scope/證據判定通過、Arch Gate 未閉合、≠ `CODING_ALLOWED`、≠ commit code/merge**）：0 方向偏移；4 required refinement（**ARCH-R1** red-test-integrity、**ARCH-R2** immutable-base、**ARCH-R3** full-diff-allowlist、**ARCH-R4** plan-anchor）+ 4 lock（ARCH-ENV-11..14）。**本修訂已全數納入**（§4 R1/R2/R3、§1.2 ARCH-ENV-11..14、header→`PLAN_SELF_REVIEW_CLEAN`）→ 修訂後再自審 0 新發現 → plan-local commit（僅 stage 本 plan doc）→ 待 owner 送 ① 最終收據錨定本 plan commit SHA（ARCH-ENV-14）。
- **授權邊界（owner ① R1）**：核准建 branch `stage7-pr2dr-env-oauth-credentials-surface` + 改/commit **僅** 本 plan doc（staged 恰本檔）；**未授權** `types/env.d.ts` / 任何 production·test·config / `CODING_ALLOWED` / push·PR·merge。

## 6. 非 blocking notes

- **NB-1**：註解採 owner ARCH-ENV-9 verbatim `// ── OAuth provider credentials (runtime bindings; read by getProvider())`（**無** sibling section header 的 trailing box-dash `───`）。CODE stage 沿用 verbatim；若 owner 偏好與鄰段視覺對齊（補 trailing `───`）屬純 cosmetic、可 CODE 前一句明示，預設 verbatim。
- **NB-2**：`env.d.ts` L112-114 `declare module 'cloudflare:test' { interface ProvidedEnv extends Env {} }` → test env 繼承這 10 key（`string | undefined`）。standalone overlay ADDED=0 已含此 leaf（無 test READ typed `env.X_CLIENT_ID`、全走 `Object.assign` write → 無 TS2339 可 REMOVE、無 excess-property 可 ADD）。
- **NB-3**：本棒**不觸** `ProviderSecretsEnv` / getProvider / provider list（ARCH-ENV-5）；OD-env-1（derive `Partial<Pick<Env, ...>>` 消鏡像 drift）另開獨立 SPEC + 獨立 source commit + 重跑 gates（ARCH-ENV-10）。drift 風險低（5 provider 穩定）。
- **NB-4**：shipped 集 = `types/env.d.ts` + 本 plan doc companion（per stage7 慣例）；**source surface = `types/env.d.ts` only**（ARCH-ENV-1/8）。owner CODE 前可否決 plan doc companion。
- **NB-5**：本棒不觸 LINE id_token hardening（棒5、`callback.ts` verifyLineIdToken；runtime/security 行為變更、與 type-only 互斥）。

## 7. 後續棒次（owner S2 序列）

- 棒1 oauth utils（33）✅ PR-2do SHIPPED → 棒2 admin oauth-clients pair（19）✅ PR-2dp SHIPPED → 棒3a flow issuance clean-4（20）✅ PR-2dq SHIPPED → **本棒 棒3-env（PR-2dr；enabler、REMOVED=0、閉合 PR-2do NB-2 gap、解 棒3b/棒4 getProvider blocker）** → **棒3b init/bind-email（6；index-sig ctx + buf cast、getProvider 現可標 `env:Env`）** → **棒4 callback.ts（27；Tier-0 最重，R1 已解其 getProvider blocker）** → **棒5 LINE id_token hardening（獨立 additive-security、非 type-only）**。
- oauth 域（105）清完 → **audit 域（381，殿後最重，含 F-3 DORMANT）** → noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。

---

## Index receipt（archive 用；本檔結案後搬 MEMORY 對應）
- `types/env.d.ts` `Env` additive +10 optional OAuth provider credential key（Discord/Google/Line/Facebook/Apple × CLIENT_ID/CLIENT_SECRET，鏡像 `oauth-providers.ts` `ProviderSecretsEnv`）；**enabler、REMOVED=0、ratchet `414/20/315` unchanged**；standalone overlay REMOVED=0/ADDED=0、對照對坐實 R1 消 `getProvider` TS2559（Leg A absent / Leg B present）。
- OD-env-1 = ProviderSecretsEnv derive `Partial<Pick<Env,...>>` **FOLLOW-UP**（保留窄型原樣）；OD-env-2 = credentials 註解（非 secrets）+ 獨立段落。
- ARCH-ENV-1..10（SCOPE / EXACT-KEYSET / OPTIONALITY / TYPE-ONLY / PROVIDER-BOUNDARY / CASCADE / RATCHET / CHANGED-FILES / COMMENT-SEMANTICS / FOLLOW-UP-NONBLOCKING）+ ① R1 ARCH-ENV-11..14（RED-TEST-INTEGRITY / IMMUTABLE-BASE / FULL-DIFF-ALLOWLIST / PLAN-ANCHOR；對映 ARCH-R1..R4）。
- zero JS emit（`.d.ts`）取代 byte-identical；RUNTIME 坐實 = changed-files 恰 env.d.ts + 全 `.ts` git-diff 空 + build:functions 不變。
