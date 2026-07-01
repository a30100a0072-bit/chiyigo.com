# Stage 7 PR-2dg — webauthn 域 noImplicitAny → 0

**PR**：refactor(webauthn): annotate webauthn domain noImplicitAny (52 -> 0)
**base**：`07b377c2`（#130 PR-2df）｜**source commit**：`8e0fde5e`
**級別**：impl L1 / review care L3（passkey = auth-core / Tier-0-adjacent，不降審查）
**性質**：純 type-only、byte-identical 7/7、single domain-batch

## 目標 / 結果

webauthn 域 **7 source + `types/env.d.ts`**、**52 noImplicitAny（TS7031×33 + TS7006×15 + TS2339×4）→ 0**。
ratchet **618 / 50 / 285 → 566 / 43 / 292**（baseline 1119/175 凍結、reduce PR 不 `--update`）。

## Scope（8 檔）

```
functions/utils/webauthn.ts                       +7/-7  (12 err)
functions/api/auth/webauthn/register-verify.ts    +7/-7  (11 err，含 D1 cast)
functions/api/auth/webauthn/credentials.ts        +6/-6  ( 6 err，含 D4 row-map)
functions/api/auth/webauthn/credentials/[id].ts   +3/-3  ( 8 err)
functions/api/auth/webauthn/login-verify.ts       +5/-5  ( 7 err；L151 不改)
functions/api/auth/webauthn/login-options.ts      +2/-2  ( 4 err)
functions/api/auth/webauthn/register-options.ts   +2/-2  ( 4 err)
types/env.d.ts                                    +2/-0  ( D3 enables D2；emit 0 bytes)
```
合計 +34/-32、33 edit sites、清 52。

## Owner Decisions（D1–D5，LOCKED）

- **D1** TS2339×4 cast：`import { verifyRegistrationResponse, type WebAuthnCredential } from '@simplewebauthn/server'` + `(info.credential ?? {}) as WebAuthnCredential`。禁 `as any` / local inline credential shape。
  - 根因：v13 `info.credential` = `WebAuthnCredential`，`?? {}` widen 成 union `WebAuthnCredential | {}` → 存取 `.id/.publicKey/.counter/.transports` 時 `{}` 成員缺 → 4×TS2339；cast 收斂回 `WebAuthnCredential`。
- **D2** util env：`functions/utils/webauthn.ts` 4 函式（getRpConfig/saveChallenge/consumeChallenge/listUserCredentials）`env: Env`（唯一 caller = production handler、無 partial-fake-env test）。
- **D3** env.d.ts Path-A：補 `WEBAUTHN_RP_ID?: string` + `WEBAUTHN_RP_NAME?: string`（getRpConfig 已讀、optional、emit 0 bytes；4-space 縮排）。
- **D4** Cloudflare D1 DB row-map：`(r: Record<string, unknown>)` + call-site `as number` / `as string | null`，循 shipped sibling `functions/api/auth/wallet.ts:38` / `me.ts:81`；**`id` 不 cast**（留 unknown）。
- **D5** single domain-batch PR / review care L3。

## Architecture Locks（ChatGPT Arch `APPROVED_WITH_LOCKS`）

- **ARCH-L1**：不擴 locked D4——`listUserCredentials` 無 explicit output interface、無 `id: r.credential_id as string`（除非 Codex 發現 current ADDED>0 或 byte-identical 破功；③④ 皆未觸發）。
- **ARCH-L2**：workers-types / D1 typed-binding 銳化造成的 typed-consumer TS2322 = future re-eval surface；本 PR 不混入 workers-types migration / D1 typed-row refactor。
- **NB-1**：保留 §誠實邊界 workers-types latent caveat。
- **NB-2**：未來開 workers-types 遷移時，`listUserCredentials` 另設 row-to-domain boundary。
- **Hard**：diff 僅 8 檔；`CLEANUP_PLAN.md` 不入；不新增 package/lockfile、不改 runtime logic/SQL·migration/tests/audit args；F-3 DORMANT-safe。

## Dual Gate v3.1 軌跡（全 4 道外部 + 維度 A）

1. **Phase 0**：SPEC rev2 owner **LOCKED**（`CHATGPT_SPEC_APPROVED_FOR_OWNER_LOCK`；rev1 RR-1..3+NB-1..3、rev2 RR-4+NB-4..5 全收斂）。
2. **維度 A plan** 三維 self-review（plan-faithfulness / type-cascade / security-scope）→ 1 MAJOR（F1 縮排 TAB→4-space）+ 2 MINOR（§4.4 rationale / §6 workers-types latent）主線親驗修正 → 一輪 0 新發現。
3. **① ChatGPT Architecture** `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（+ARCH-L1/L2 / NB-1·NB-2；D4 latent fragility 裁決＝維持 locked D4）。
4. **② Codex Plan** `CODEX_PLAN_APPROVED`（scratch-replay @base `07b377c2`：BEFORE=618 / AFTER=566 / REMOVED=52 / ADDED=0 / byte-identical 7/7 / 工作樹未變；residual-note 精確化 workers-types = 非 active typed surface）。
5. **CODING_ALLOWED**（owner）→ branch `refactor/stage7-pr2dg-webauthn-noimplicitany` @ base `07b377c2`、33 edits/8 檔。
6. **機械層 9/9 全綠**：forced tsc REMOVED=52·ADDED=0 / byte-identical 7/7（+ env.d.ts 0 bytes）/ ratchet 566·43·292 / lint / build:functions / verify:browser-pipeline / npm audit 0 / test:cov 90.28% / **test:int 75f·1328**。
7. **維度 A code** 三維 self-review（diff-fidelity / runtime-security / evidence）→ 一輪 0 新發現（主線親驗；1 諮詢性 `// SAFETY:` 註記不採納——locked D4 循 shipped sibling 本無此註解、加註偏離 approved frozen diff、屬 Stage 7 既定慣例）。
8. **source commit `8e0fde5e`** → **③ Codex Code** `CODEX_CODE_APPROVED`（no escape hatch、byte-identical 7/7、REMOVED=52/ADDED=0、full test:int 75f/1328）。
9. **④ ChatGPT Faithfulness** `CHATGPT_CODE_FAITHFULNESS_APPROVED`（FAITHFUL；anti-curated name-status 8 檔皆有 hunk、無漏；D1–D5 + ARCH-L1/L2 全忠實、無 scope creep）。
10. **MERGE_ALLOWED**（owner）→ squash-merge。

## 誠實邊界 / caveat

- **D4 Record 形式今日 ADDED=0 的保證 = D1=any 機制**（`env.chiyigo_db` → `.map()` on any → 整列 any）。`@cloudflare/workers-types` 非 active typed surface：非 direct dep、未實裝於 node_modules、不在 tsconfig `types`（functions/tests 皆 `["@cloudflare/vitest-pool-workers"]`），僅 package-lock transitive 條目。
- **⚠ workers-types latent（ARCH-L2 / NB-2）**：若未來啟用 workers-types 為 active typed D1 surface 銳化 D1 → `listUserCredentials` 回 `{ id: unknown; … }[]` → 流入 typed `generateRegistrationOptions.excludeCredentials`（`register-options.ts:48`）/ `generateAuthenticationOptions.allowCredentials`（`login-options.ts:70`）會生 **TS2322**（此面比 `wallet.ts`/`me.ts` 灌 untyped `res()` 更暴露）。屬 workers-types 遷移時的已知 re-eval 面、非本 PR blocker。
- **dual-leaf**：52 錯全 unique（無 doubling）——TS7031/7006 只在 functions-leaf（noImplicitAny:true）；register-verify 4×TS2339 亦只在 functions-leaf（`let verification` 在 tests-leaf noImplicitAny:false 為純 any、不啟 evolving-any、無 union）。handler env:Env 為 assignable 變體（test 傳 `cloudflare:test` full env）、無 ecpay narrow-literal TS2345 陷阱。
- **`login-verify.ts:151`** `parseTransports(cred.transports)` 未改（`cred` = DB `.first()` any、非 `.map` row、未 flagged、any→`string|null` assignable）。
