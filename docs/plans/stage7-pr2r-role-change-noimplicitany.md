# Stage 7 reduce PR-2r — utils/role-change noImplicitAny（auth-core 單檔 codex chain 第 2 棒）

**目標**：`functions/utils/role-change.ts` **1 個 noImplicitAny error → 0**，**純 type-only**（`env: Env`）。

> **主線定位（owner 拍板 2026-06-10，C-1）**：reduce 已抵 **auth-core**，走「auth-core 單檔 codex chain」。`password.ts`（PR-2q）已校準「auth-core 單檔模板」；本 PR = 第 2 棒，接 `role-change.ts`，再續 roles.ts → risk-score.ts〔單獨 plan-gate〕→ 2fa/verify → _middleware〔最後、blast radius 最大〕。

base main `4d6d075`（接 PR-2q）。

## ⚠ auth-core / RBAC 敏感聲明（最高優先紀律）

`role-change.ts` = **權限變更核心**（platform role / entitlement，privilege-escalation 領域，Tier-0 security boundary）。owner 紀律：**修法若非純型別、或會牽動授權邏輯 / runtime policy / 回傳 shape / 任何行為 → 立刻停手回報，不硬寫 plan；寧可 partial 也不用 derived-any 假清或改授權語意。**

**scout 結論：修法為純型別、零行為變更，繼續出 plan。** 唯一改動 = 第 49 行 `env` 參數補型別標註 `env: Env`（`any` → `Env`，更嚴格非更寬鬆）。**完全不碰**：`isValidRole` 驗證、`Number.isInteger` 守衛、F2 atomicity batch（admin_audit_log INSERT + revoke + CAS UPDATE 三條綁同一 `db.batch`）、revoke gate-on-oldRole 語意、`roleChanges !== 1 → ROLE_RACE`、`bumpTokenVersion`（CAS `token_version + 1`）、self-demotion critical audit 判定、所有 SQL 字串、所有 error code、回傳 shape。TS erase 後 runtime **byte-identical**。

## Scout（對抗式驗證，含 spike 實證）

### exact error（forced tsc，base `4d6d075`、total 1021）
```
functions/utils/role-change.ts(49,38): error TS7006: Parameter 'env' implicitly has an 'any' type.
```
**僅 1 個**——唯一 export `changeUserRole(env, { ... })` 的第 1 參數 `env` 無型別標註。檔內 JSDoc 寫 `@param {object} env`，但 **.ts 檔的 JSDoc type 不被 TS 採用**（[[feedback_ts_no_jsdoc_in_ts_mode]]）→ implicit-any。opts 物件（第 2 參）已有 inline 型別標註，無 implicit-any。

### 型別選型：`env: Env`（full Env，**非** `Pick<Env, ...>`）——關鍵決策
本檔 `env` 的用途有二：
1. `const db = env.chiyigo_db`（第 67 行，唯一直接讀的 key）。
2. **`await safeUserAudit(env, { ... })`（第 137 行）—— 把整個 `env` wholesale 轉交** 給 audit util。

→ **不採 `Pick<Env, 'chiyigo_db'>`**：env 被整包 forward 給 `safeUserAudit`（其 `env` 參數為 implicit-any，無 forward 型別約束，但語意上需要完整 env 做 alert/webhook 等）。若窄成 `Pick<Env,'chiyigo_db'>`，型別上會誤導讀者「role-change 只用到 chiyigo_db」，與「整包 forward」的事實不符。
→ **PR-2m 的 Pick 教訓不適用本檔**：PR-2m 用 Pick 是因 `email.ts` 的 **unit test 傳 partial fake env**（`{ RESEND_API_KEY: 'x' }`），full Env 會 TS2345 cascade。本檔的 targeted test 是 **integration test，傳真實 `env`（`cloudflare:test` 的 `ProvidedEnv extends Env`）與 `stubEnv`（真 env spread + `chiyigo_db` 覆蓋）**，皆 full-Env-derived → **無 partial-fake-env，full Env 不 cascade**（spike 實證，見下）。
→ `env: Env` 同時符合既有 handler-context PR（PR-2a..2l）的 `env: Env` 慣例，最誠實也最一致。

### latent helper — 無 source caller（privilege-escalation 風險面評估）
`changeUserRole` 為 **latent**：全 repo grep `changeUserRole`，source 端**僅** `roles.ts` 註解提及（第 11/14 行，doc 範例），**無任何 admin endpoint 實際呼叫**（檔頭註解亦自述「目前 prod 沒有任何 admin endpoint 呼叫這個 helper」）。唯一實際 caller = `tests/integration/role-change.test.ts`。
→ 本 PR 不 wire、不啟用此 helper，僅補 `env` 型別；privilege-escalation 攻擊面**零變化**（latent 仍 latent）。

### callers / cascade 面
- source caller：0（latent）。
- test caller：`tests/integration/role-change.test.ts`（9 例），傳 `env` / `stubEnv`。`stubEnv = { ...env, chiyigo_db: { prepare, batch } }`——spike 證 `stubEnv` assignable 到 `Env`（本 repo `@cloudflare/workers-types` 未裝 → `D1Database` 解為 `any` → stub 的 `chiyigo_db` 任意 shape 皆 assignable，[[feedback_d1database_resolves_any_no_workers_types]]）。
- D1 row：`target = await db...first()`、`target.role` / `target.email` 在本 repo 解為 `any`（D1Database=any）→ 不報、不 cascade。

### spike 實證（已 revert）
套 `env: Env` 後清 `.tscache` → `tsc -b --force`：
- **functions leaf**：`role-change.ts` 1 → **0**（filter 無殘留）。
- **tests leaf**（`tsconfig.tests.json`，noImplicitAny:false，含 `functions/**` + `tests/**`）：**0 errors**、`role-change.test.ts` 0 新 error → **零 tests-leaf cascade**（`stubEnv` assignable 確認）。
- **canonical `--report`**：errorCount 1021 → **1020**（淨 **−1**）、errorFiles 114 → **113**、cleanFiles 190 → **191**。
- **零 cascade 數學證明**：只改 1 檔、total 恰 −1 == role-change 釋放的 1 → 其他所有檔計數完全未變。

## 改動（source scope = 1 檔，純 type-only，1 處）

### `functions/utils/role-change.ts`（第 49 行，1 處）
```ts
export async function changeUserRole(env: Env, { userId, newRole, actorId, actorEmail, request, reason }: {
```
- **不碰**：JSDoc 註解、opts inline 型別、`isValidRole`/`Number.isInteger` 守衛、F2 atomicity batch（INSERT+revoke+CAS）、revoke gate-on-oldRole、CAS `WHERE role=oldRole AND deleted_at IS NULL`、`token_version + 1`、`ROLE_RACE` 判定、self-demotion critical audit、所有 SQL、所有 error code、回傳 shape、轉交 `safeUserAudit(env, ...)` 的呼叫。

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `4d6d075` `--report` 現況：errorCount **1021** / errorFiles **114** / cleanFiles **190** / sourceFilesTotal 304。
- 本 PR 後 **current ratchet state**：errorCount **1021 → 1020**（−1）、errorFiles **114 → 113**（−1）、cleanFiles **190 → 191**（+1，role-change.ts 全清）。
- baseline file 不變，天花板保留 errorCount **1119** / cleanFiles **175**（reduce PR 不跑 `--update`）。

## Tier / 風險

- **auth-core / RBAC util，但純 type-only**：改動僅 1 個參數 `any → Env`（更嚴格、非更寬鬆），TS erase 後 runtime **零變化**；privilege-escalation 攻擊面零變化（latent 仍 latent）。
- **blast radius 最小**：1 export、**0 source caller**（latent）、1 integration test。
- **零 cascade（含 tests-leaf）**：spike 數學證明 total 恰 −1；`stubEnv` 對 `Env` 全 assignable（D1Database=any）。
- 無新 global、無新套件、無 tsconfig 改動。

## 驗證計劃（coding 階段）

> ⚠ ratchet/tsc 量測前先清 `.tscache` 全重建（PowerShell `Remove-Item -Recurse -Force .tscache`，**勿照字面跑 POSIX `rm -rf`**）。**PowerShell 用 `$env:RATCHET_BASE_REF='4d6d075'`**（勿照字面跑 POSIX `VAR=x npm`，否則 fallback HEAD~1）。

- `$env:RATCHET_BASE_REF='4d6d075'; npm run typecheck:ratchet` green（current 1021→1020 / errorFiles 114→113 / cleanFiles 190→191）。
- `npm run lint` green、`npm run build:functions` green。
- **filtered forced tsc**：確認 `role-change.ts` **0 殘留** + 無其他檔 error 增加（零 cascade）。
- **targeted test**（integration，workers config）：`npx vitest run --config vitest.workers.config.js tests/integration/role-change.test.ts`（9 例，直接 import changeUserRole；含 INVALID_ROLE / USER_NOT_FOUND / NOOP / happy-path〔role 更新 + token_version+1 + refresh revoke + hash-chain admin_audit + user_audit warn〕/ self-demotion critical / 4× ROLE_RACE 原子性場景）。
- **硬驗收**：source diff 僅 `role-change.ts` 第 49 行 `env` → `env: Env` 一處；F2 batch / SQL / error code / 回傳 shape / safeUserAudit 轉交 **byte-identical**；ratchet 淨降剛好 **1**、零 cascade。

## 測試覆蓋誠實

`role-change.test.ts` 9 例 integration 實跑覆蓋 helper 的：INVALID_ROLE、USER_NOT_FOUND、NOOP（不 bump）、happy-path（role 更新 + `token_version+1` + refresh family revoke + hash-chain `admin_audit_log` + `user_audit` warn）、self-demotion critical、4× ROLE_RACE 原子性（stub-batch CAS=0 / 真-DB role race / same-target race / soft-delete race）。
**未被測例覆蓋、不宣稱實跑**：`INVALID_USER_ID` / `INVALID_ACTOR_ID`（`Number.isInteger` 守衛）、`AUDIT_CHAIN_FAILED`（`prepareAppendAuditLog` 或 `db.batch` 拋例外路徑）。
**helper latent 誠實聲明**：此 helper 無 prod endpoint wire（檔頭自述 + grep 證實），測試覆蓋的是 **helper 本身**的行為，非端到端 endpoint；type-only 改動不改此狀態，亦不 wire。

## 流程定位（auth-core 單檔模板）

- auth-core util → **full 四檢查點 + codex chain**（plan-gate = 本 doc；code-gate = 實際 source diff）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；紅 CI 不 merge；merge 後監看 CI+Deploy（撞 `jwt.test`「rejects tampered token」偶發 flake 就 `gh run rerun --failed`），補 credential-free prod smoke（role-change.ts 無自身端點 → smoke 確認 deploy 健康、home/login 200）。
- **下一刀（owner 排序）**：roles.ts → risk-score.ts〔security-adjacent 單獨 plan-gate〕→ 2fa/verify → _middleware〔最後〕。
