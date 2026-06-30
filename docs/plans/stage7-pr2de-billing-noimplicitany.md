# Stage 7 PR-2de — billing / credit_wallets 域 noImplicitAny → 0

**狀態**：Code Gate 進行中（`CODE_SELF_REVIEW_CLEAN`；待 ③ Codex Code → ④ ChatGPT Faithfulness → owner `MERGE_ALLOWED`）。
**型態**：single PR domain-batch、純 type-only、runtime byte-identical、零新型別 OD、零新 import。impl L1 / review care L2/L3（money-adjacent 不降級）。

## Base / commit

- PR base：`68975120`（#128 PR-2dd）｜ branch `refactor/stage7-pr2de-billing-noimplicitany`
- source commit：`1fb5532d`（4 檔、8 insertions / 8 deletions）
- ratchet：`653 / 58 / 277` → `634 / 54 / 281`（errorCount / errorFiles / cleanFiles；baseline `1119/175` 凍結、**不** `--update`）

## 範圍（4 檔）

| 檔 | noImplicitAny | annotation |
|---|--:|---|
| `functions/api/admin/billing/grant.ts` | 4（TS7006×2 + TS7031×2） | emitDenied(env,request) + onRequestPost({request,env}) |
| `functions/api/admin/billing/quotas/[tenantId]/[productId].ts` | 5（TS7006×2 + TS7031×3） | emitDenied + onRequestPut({request,env,params}) |
| `functions/api/admin/billing/wallets/[tenantId]/adjust.ts` | 5（TS7006×2 + TS7031×3） | emitDenied + onRequestPost({request,env,params}) |
| `functions/api/admin/billing/wallets/[tenantId]/topup.ts` | 5（TS7006×2 + TS7031×3） | emitDenied + onRequestPost({request,env,params}) |

全 19 = TS7006×8（局部 emitDenied helper 的 env/request）+ TS7031×11（handler-context 解構）。套既有 Convention A `{ request: Request; env: Env[; params: Record<string, string>] }`。

## OD（零新型別 OD）— cascade 安全四證

1. callee 已安全：`requireStepUp(request:Request, env:Env)` exact；`checkRateLimit`/`recordRateLimit(db:Env['chiyigo_db'])` exact；`safeUserAudit(env)` implicit-any accepts；`grantPlan`/`setProductQuota`/`adjustCredits`/`topUpCredits(db:ChiyigoDb)` 而 **`type ChiyigoDb = Env['chiyigo_db']`**（billing.ts:22 / credit.ts:23）→ 傳 `env.chiyigo_db` 同一 indexed-access 型別、assignable 恆真。
2. env single-file：4 檔僅存取 `env.chiyigo_db`（env.d.ts:23）→ 標 env:Env 零 TS2339 → 不碰 `types/env.d.ts`。
3. D1=any cascade-safe（repo 無 `@cloudflare/workers-types`）。
4. dual-leaf 反向陷阱已排除：全 repo 僅 2 test importer（`billing-endpoints.test.ts` / `credit-endpoints.test.ts`），皆經 `call(handler:(ctx:unknown)=>unknown)` 型別抹除 wrapper + `ProvidedEnv extends Env`（assignable）→ 與 ecpay PR-2db partial-literal 撞 TS2345 陷阱反向、不需 narrow `Pick<Env>`。

## Byte-identical（money-path 零行為變更硬 gate）

esbuild `--loader=ts --format=esm` stdin、**base-blob `68975120` vs committed-blob `1fb5532d`**（非恆真）4/4 MATCH：grant `9c92bb809503` / quotas `ef90f979319f` / adjust `55d59699cdb0` / topup `7907a5a91a61`。

## Gate 軌跡

| gate | 狀態 | 證據 |
|---|---|---|
| SPEC | `SPEC_APPROVED` | owner C-2 + ChatGPT 收斂（9 決策 + SPEC-BL-1..7） |
| 維度 A plan self-review | CLEAN | 3 readonly-reviewer 三維（plan-faithfulness / type-cascade / security-scope）一輪 0 blocking/major/minor |
| ① ChatGPT Arch | `CHATGPT_ARCH_APPROVED` | 無 blocking/required/major、ARCH-BL-1..7 |
| ② Codex Plan | `CODEX_PLAN_APPROVED` | scratch replay：653→634、REMOVED=19/ADDED=0、name-status 4、byte-identical 4/4、cascade 四證 |
| Code Gate 機械層 | 全綠 | forced tsc 634 · sort-diff 19/0 · byte-identical 4/4（committed-blob）· name-status 4 · ratchet enforce `ratchet OK`(634≤1119, 281≥175) · lint · build:functions · verify:browser-pipeline · test:cov 90.28% · test:int 75f/1328 · npm audit 0 |
| 維度 A code self-review | `CODE_SELF_REVIEW_CLEAN` | 3 readonly-reviewer 三維（diff-fidelity / runtime-security / evidence）一輪 0 finding；主線獨立裁決 |
| ③ Codex Code | pending | — |
| ④ ChatGPT Faithfulness | pending | — |

## Scope locks（SPEC-BL / ARCH-BL）

僅 4 檔 ｜ 恰 8 行 in-place 型別標註 ｜ runtime byte-identical ｜ 不碰 `types/env.d.ts` ｜ 不抽 `emitDenied` shared helper ｜ 不改 money/security/runtime（step-up/scope/rate-limit/actor snapshot/寫入/outcome→HTTP/audit）｜ 完成只宣稱 `billing/credit_wallets 域 noImplicitAny=0`（≠ SIWE user_wallets）。

## 殘留 / merge-front

- ③ Codex Code + ④ ChatGPT Faithfulness 待跑（owner 運行外部 gate）。
- merge-front 7 gates 已於 Code Gate 全綠；merge 前對 main Actions 複查（jwt.test flaky ~1.6% 紅就 re-run，本棒 byte-identical 不碰 jwt）。
- 無 DB migration（type-only）。
