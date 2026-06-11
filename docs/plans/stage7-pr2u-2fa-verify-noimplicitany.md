# Stage 7 reduce PR-2u — auth/2fa/verify noImplicitAny（auth-core chain 第 5 棒，auth-flow 熱區單獨 plan-gate）

**目標**：`functions/api/auth/2fa/verify.ts` **13 個 noImplicitAny error → 0**，**純 type-only**（3 個編輯點，全為型別標註）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。`password.ts`（PR-2q `4d6d075`）→ `role-change.ts`（PR-2r `b43770b`）→ `roles.ts`（PR-2s `7307c91`）→ `risk-score.ts`（PR-2t `7ca8456`）；本 PR = 第 5 棒 `2fa/verify.ts`，再續 `_middleware`〔最後、blast radius 最大〕。

base main `7ca8456`（接 PR-2t）。

> **Gate 紀錄（Dual Gate Workflow）**：
> - 2026-06-11 owner 當輪明示 SPEC_APPROVED（scope = 本檔 noImplicitAny 清零、純 type-only；Non-goals = 不碰 caller/tests/config/runtime 行為），並預授權 A1 spike + plan doc 落檔 commit feature branch。
> - 2026-06-11 Claude plan 自審到零 blocker（`PLAN_SELF_REVIEW_CLEAN`）。
> - 2026-06-11 **A1 spike 已執行並全項達標**（見 §Spike 實證；PR-2t 前例之 Arch Gate 條件本 PR 前置完成），working tree 已 revert clean。
> - 2026-06-11 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`** — Scope / SSOT / Contract / DB-Migration 四項全過；型別選型逐項裁可（`CfRequest` 複用 ✓、`Env['chiyigo_db']` ✓、`riskClaims` producer mirror ✓ 明示「不建議改成 unknown」、`record` inline 5 欄 ✓、`method` literal union ✓）。
> - 2026-06-11 **Codex Plan Gate：`CODEX_PLAN_APPROVED`（@ `bcc3b11`，findings: none）** — Arch Gate 指定 4 點全過：① riskClaims producer mirror 接受（producer typed → login 簽進 pre_auth → requireAuth 驗簽/scope，不要求降 unknown）② record 5 欄完全覆蓋 helper 實讀（totp_secret/totp_enabled 在 helper 呼叫前消費；users.email schema NOT NULL、token_version 出自 migration 0009）③ CfRequest 無 contract drift ④ 凍結 diff 真 type-only。**硬條件**：落地 source diff 與 §Spike 最終 diff 逐行一致；code gate 重跑全 gates（ratchet `RATCHET_BASE_REF='7ca8456'` / 全量 lint / build:functions / filtered forced tsc + tests-leaf / 兩個 targeted int suite）。
> - `CODING_ALLOWED` 達成 → coding：source commit `94e618b`（落地 diff 與凍結 diff **byte-identical**，blob `b048771→60bad1f`）。
> - 2026-06-11 **Codex Code Gate：`CODEX_CODE_APPROVED`（@ `94e618b`，findings: none）** — Codex 本地重跑全 gates 一致（ratchet OK 989/194、report 989/110/194、filtered tsc 0 殘留、tests-leaf exit 0、targeted int 11/11、lint 0、build:functions ✓、`git diff --check` clean）。Critical risk: none；backup-code 併發測試缺口如實揭露、未惡化。
> - `MERGE_ALLOWED`（Codex 端技術放行）；squash-merge 仍待 owner 明示點頭。
> - **Arch Gate coding 階段鎖定條件**（與本 doc §敏感聲明一致，重申）：只改本檔、runtime byte-identical、SQL / rate-limit / OTP regex / token TTL / scope / audit / error string / caller / tests / config 全不改、baseline file 不改（reduce PR 不 `--update`）、不得新增「順手修正」。

## ⚠ auth-flow 熱區敏感聲明（最高優先紀律）

`2fa/verify.ts` = 登入 2FA 驗證端點：驗 pre_auth_token scope → TOTP replay-safe 驗證 / backup code **原子核銷**（`UPDATE ... WHERE used_at IS NULL` + `changes > 0`）→ **簽發完整 access_token + refresh token 落 DB（含 issued_aud / session_id）** → audit + 異常裝置警示 → isWebClient 通道分流（HttpOnly cookie vs JSON body）— Tier-0 鄰接。owner / gate 紀律：**修法若非純型別、或會牽動 OTP 格式 regex（`^\d{6}$` / 20-hex）/ rate-limit 常數（5 次 / 5 分）/ SQL / 原子核銷語意 / token TTL（15m / 7d）/ scope 字串 `'pre_auth'` / audit event 字串 / cookie 通道判斷 / caller / tests / config → 立刻停手回 `PLAN_DRAFT`，不硬寫。** TS erase 後 runtime 行為必須不變（SQL / 常數 / 字串 / 註解 byte-identical；簽名斷行屬 formatting）。

**Coding 階段硬性邊界**：
- 允許：handler destructure 參數型別標註（Convention A inline）/ helper 參數型別標註 / catch-callback 顯式 return 標註（`(): null => null`）
- 禁止：改 SQL、改 regex、改 rate-limit / TTL 常數、改 audit event / scope / error code 字串、改原子核銷邏輯、改 isWebClient 判斷、改 caller、改 tests、改 tsconfig / eslint / vitest、新增 any、新增 suppression、新增 global、新增 import、新增 package

## Scout（對抗式驗證）

### exact errors（forced tsc @ `7ca8456`，total 1002）
```
functions/api/auth/2fa/verify.ts(37,39):  TS7031 request    (37,48):  TS7031 env
functions/api/auth/2fa/verify.ts(144,33): TS7006 userId     (144,41): TS7006 record
functions/api/auth/2fa/verify.ts(144,49): TS7006 db         (144,53): TS7006 deviceUuid
functions/api/auth/2fa/verify.ts(144,65): TS7006 platform   (144,75): TS7006 env
functions/api/auth/2fa/verify.ts(144,80): TS7006 audience   (144,90): TS7006 request
functions/api/auth/2fa/verify.ts(144,99): TS7006 riskClaims (144,111): TS7006 method
functions/api/auth/2fa/verify.ts(173,80): TS7011 catch-callback
```
恰 13 個（baseline file `types/typecheck-baseline.json` 同記 `"functions/api/auth/2fa/verify.ts": 13`）。分布 = handler destructure ×2 + `respondWithToken` 10 參數 ×10 + `() => null` TS7011 ×1（[[feedback_ts_callback_null_return_ts7011]] 預載情報原樣命中）。

### 依賴邊界（新型別流入點逐一驗證）
- **typed callee（標註後新型別會流入、已逐一驗 assignable）**：
  - `safeAlertAnomalies(env: AlertEnv, request: CfRequest, { userId: number; email: string | null; deviceUuid: string | null })`（PR-2o typed）→ **強制 `record.email` 不能是 unknown**（unknown ↛ `string | null` = TS2345）→ `record` 必須 inline shape、`deviceUuid` 必須 `string | null`；`AlertEnv = Pick<Env,...>` ← `Env` assignable ✓
  - `isWebClient(request /* implicit any */, { platform }: { platform?: string | null } = {})` → `platform: string | null` ✓
  - `resolveActiveTenantClaims(db: ChiyigoDb, userId: number)`，`type ChiyigoDb = Env['chiyigo_db']`（tenant-context module-local）→ `env: Env` 的 `env.chiyigo_db` 同型別 ✓
  - `signJwt(payload, expiresIn, env, opts: { audience?: string | null })`（opts 已 typed）→ `{ audience }` with `audience: string` assignable ✓
  - `requireAuth(request: Request, env: Env, ...)`（params 已 typed；**回傳 user = any**——成功分支 `{ user: payload }`、payload 來自 untyped `verifyJwt`）→ `request: CfRequest` 是 `Request` 子型別 assignable ✓；`user.sub / user.risk_*` 讀取零新 error ✓
  - `hashUa(ua: string)`（PR-2t typed）→ `request.headers.get('User-Agent') ?? ''` = string ✓
- **untyped callee（implicit any param，error 記在各自檔）**：`verifyTotpReplaySafe` / `checkRateLimit`·`recordRateLimit`·`clearRateLimit`（第二參數 typed 但與本 PR 標註無交互——現有呼叫今天已 typecheck）/ `safeUserAudit` / `buildTokenScope(role)` / `refreshCookie` / `generateSecureToken`·`hashToken`·`verifyBackupCode` / `resolveAud(input)`（回傳因 `getAudByOrigin()` any 而為 any → assignable to `audience: string`）。
- **production caller：無**（Pages Function endpoint，無 repo 內 import 本檔者；`respondWithToken` 為 module-local helper、僅本檔 2 個呼叫點）。
- **test**：`tests/integration/2fa-verify.test.ts` + `tests/integration/rate-limit.test.ts` 直接 `import { onRequestPost as twofaVerify }`，但走 `_helpers.ts callFunction(handler /* implicit any */, request)` 包裝——tests leaf **noImplicitAny 未開** → handler 是 any、**零 excess-property cascade 風險**（spike tests-leaf exit 0 實證）。
- **與 F-3 / audit retention / R2 lock 零重疊**：本 PR 不碰 F-3 四敏感檔；`safeUserAudit` 寫入是既有 runtime 行為。
- eslint globals 已含 `CfRequest` + `Env`（PR-2o / Stage 2 註冊）→ 零 config 改動（spike 單檔 eslint exit 0 實證）。

### 型別選型（chain 既定 pattern；Convention A inline）

1. **`onRequestPost({ request, env }: { request: CfRequest; env: Env })`** — `CfRequest` 因本檔即 memory 列名的 cf 消費者（`request?.cf?.country` L182 同一物件下游讀取）；`Env` full（Pick 條件不成立：int test 用 `cloudflare:test` 完整 typed env，同 PR-2r/2t）。
2. **`respondWithToken` 10 參數**：
   - `userId: number`（caller 傳 `Number(user.sub)`）
   - `record: { email: string; email_verified: number; role: string; status: string; token_version: number | null }` — 只列 helper 實讀 5 欄（SELECT 另有 totp_secret/totp_enabled 但 helper 不讀，per Convention A）；`email: string` 由 `safeAlertAnomalies` 契約強制（見上）；`email_verified: number`（SQLite 0/1、`=== 1` 比較）；`token_version: number | null`（`?? 0` 守衛語意）
   - `db: Env['chiyigo_db']` — indexed access 保 Env SSOT，同 tenant-context `ChiyigoDb` in-repo 前例
   - `deviceUuid: string | null` / `platform: string | null` — 鏡像接收端契約（`safeAlertAnomalies` / `isWebClient`）；caller 傳 body destructure（any）assignable ✓
   - `env: Env`、`audience: string`（`resolveAud` 語意契約：全分支回合法 aud 字串）
   - `request: CfRequest`（讀 `.headers` / `.cf?.country`）
   - `riskClaims: { score: number; factors: string[]; country: string | null } | null` — **鏡像 producer 契約**：login.ts 把 `computeRiskScore` 的 typed return（PR-2t：`score: number / factors: string[] / country: string | null`）原樣簽進 pre_auth claims；claims 經 `requireAuth` 驗簽後才進 handler（自簽信任邊界內）、僅流入 audit forensic data；construction site `{ score: number; factors: any; country: any } | null` assignable ✓
   - `method: 'totp' | 'backup_code'` — 兩呼叫點傳精確 literal；literal union 讓未來 enum 變更編譯期可見
3. **catch callback `(): null => null`**（L173）— [[feedback_ts_callback_null_return_ts7011]]：SNC-off 下 `() => null` 推 implicit any return → TS7011 不因 callee（`hashUa` 已 typed）自動消；顯式 return 標註是最小 type-only 修法。

**考慮過、否決**：`record: Record<string, unknown>`（`record.email` unknown ↛ `safeAlertAnomalies` 的 `string | null` → TS2345）；`db: D1Database` 裸名（可解析但依賴 vitest-pool-workers ambient 解析細節；`Env['chiyigo_db']` 保 SSOT + in-repo 前例）；`db: unknown`（`.prepare` 呼叫 TS2571）；`riskClaims` 欄位全 `unknown`（過度保守——claims 來自自簽 JWT 驗簽後、producer return 已 typed；mirror 契約更可審計）；`method: string`（loose，literal union 零成本更精確）；helper 顯式 `Promise<Response>` return 標註（無 error 驅動、非最小 diff）。

## Spike 實證（A1，2026-06-11，已 revert）

**程序**：套 3 編輯點 → 清 `.tscache` → `tsc -b tsconfig.solution.json --force` → `tsc -b tsconfig.tests.json --force` → 清 `.tscache` → canonical `--report` → targeted int test ×2 檔 → 單檔 eslint → `git restore` → 驗 clean。

**單輪達標**（PR-2t 預載的 TS7011 / any-chain 情報直接內建進 plan，無 R2 修正輪）：

| 驗收條件 | 結果 |
|---|---|
| `2fa/verify.ts` errors 13 → 0 | ✅ filter 0 殘留 |
| total errorCount 1002 → 989（恰 −13） | ✅ forced tsc 989 + canonical `--report` errorCount 989 |
| errorFiles 111 → 110 / cleanFiles 193 → 194 | ✅ `--report` 實測 110 / 194（sourceFilesTotal 304 不變） |
| zero cascade（含 tests leaf） | ✅ `tsc -b tsconfig.tests.json --force` **exit 0**；total 恰 −13 數學證明其他檔全未變 |
| targeted test runtime 不變 | ✅ `npm run test:int -- tests/integration/2fa-verify.test.ts tests/integration/rate-limit.test.ts` **11/11 passed（2 檔）**（標註套用狀態實跑） |
| lint | ✅ `npx eslint functions/api/auth/2fa/verify.ts` exit 0（全量 lint 列 code-stage gate） |
| 無新增檔案 / 無 caller/test/config diff | ✅ `git diff --stat` 僅 2fa/verify.ts 1 檔（+14/−3） |
| working tree revert clean | ✅ `git restore` 後 `git status --porcelain` 空、HEAD `7ca8456` |

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，3 編輯點）**：
```diff
-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: CfRequest; env: Env }) {

-async function respondWithToken(userId, record, db, deviceUuid, platform, env, audience, request, riskClaims, method) {
+async function respondWithToken(
+  userId: number,
+  record: { email: string; email_verified: number; role: string; status: string; token_version: number | null },
+  db: Env['chiyigo_db'],
+  deviceUuid: string | null,
+  platform: string | null,
+  env: Env,
+  audience: string,
+  request: CfRequest,
+  riskClaims: { score: number; factors: string[]; country: string | null } | null,
+  method: 'totp' | 'backup_code',
+) {

-    const uaHash = await hashUa(request.headers.get('User-Agent') ?? '').catch(() => null)
+    const uaHash = await hashUa(request.headers.get('User-Agent') ?? '').catch((): null => null)
```
（OTP regex、rate-limit 常數、SQL、原子核銷、token TTL、scope / audit event / error code 字串、cookie 邏輯、所有註解 **byte-identical**；`respondWithToken` 簽名斷行為 formatting、TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `7ca8456` `--report` 現況：errorCount **1002** / errorFiles **111** / cleanFiles **193** / sourceFilesTotal 304（spike 前實測）。
- 本 PR 後 current ratchet state：errorCount **1002 → 989**（−13）、errorFiles **111 → 110**、cleanFiles **193 → 194**（spike 實測值，非預測）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 型別標註，TS erase 後 runtime 行為不變；targeted int test 11/11 已在標註狀態實跑證明（含 isWebClient channel matrix + 2FA rate-limit 路徑）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 1002，零殘留。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（spike tests-leaf exit 0 實證）。
- 11 例實跑覆蓋（2 檔）：`2fa-verify.test.ts` isWebClient channel matrix（web cookie 通道 / non-web JSON 通道 / session_id 落 DB）+ `rate-limit.test.ts` 2FA 維度（5 次失敗 429 / 成功清零 / window 行為）。
- **未覆蓋、不宣稱**：backup code 原子核銷併發路徑無直接測例（本 PR 不動該邏輯）；`login.test.ts` 僅註解提及本檔、無 import。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> ⚠ ratchet/tsc 量測前清 `.tscache`（PowerShell `Remove-Item -Recurse -Force .tscache`）。**PowerShell 用 `$env:RATCHET_BASE_REF='7ca8456'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='7ca8456'; npm run typecheck:ratchet` green（1002→989 / 111→110 / 193→194）。
- `npm run lint` green（全量）、`npm run build:functions` green。
- filtered forced tsc：2fa/verify.ts 0 殘留 + `tsc -b tsconfig.tests.json --force` exit 0。
- targeted test：`npm run test:int -- tests/integration/2fa-verify.test.ts tests/integration/rate-limit.test.ts`（11 例）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（人審 `git diff -- functions/api/auth/2fa/verify.ts`）；超出 = scope creep = Gate fail。

## 流程定位

- Dual Gate Workflow：`SPEC_APPROVED`（owner 當輪明示）→ `PLAN_SELF_REVIEW_CLEAN` → A1 spike（owner 預授權前置）→ 本 doc commit feature branch → **ChatGPT Architecture Gate** → **Codex Plan Gate**（迭代審到過）→ `CODING_ALLOWED` → coding（凍結 diff 逐行重放）→ 實跑 gates → 自審 → Codex Code Gate → owner 明示同意才 squash-merge。
- merge 後監看 CI+Deploy（撞 `jwt.test` flake 就 rerun）；2fa/verify 為 auth 端點、無 credential-free 自身 smoke → deploy 健康確認為主。
- **下一刀（owner 排序）**：`_middleware`〔最後、blast radius 最大〕；jwt/crypto/siwe/scopes/rate-limit 同 chain。
