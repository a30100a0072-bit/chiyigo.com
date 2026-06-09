# Stage 7 reduce PR-2m — utils/email noImplicitAny（首個 utils-lane PR）

**目標**：`functions/utils/email.ts` **31 個 noImplicitAny error → 0**，**純 type-only**。**Path A（owner 拍板）**：因 email.ts 讀 2 個未宣告於 `Env` 的真實 env var，需同 PR 在 `types/env.d.ts` 補宣告，故 source scope = **2 檔**（`types/env.d.ts` + `functions/utils/email.ts`），皆 type-only。

**首個 low-sensitivity utils-lane reduce PR**（tenants mutating IAM 6 檔已於 PR-2i~2l 全清零）。base main `db6bb2b`（接 PR-2l）。email.ts 純低敏感（email 寄送、無 auth/payment/audit 判斷）。

## 為什麼是 2 檔（env 型別前置條件）

`Env`（`types/env.d.ts`）是 **sealed interface（無 index signature）**。email.ts 讀 `env?.MAIL_FROM_ADDRESS`（line 11）與 `env?.RESEND_TIMEOUT_MS`（line 15），但兩者**未宣告於 Env**。若直接 `env: Env` 會在 email.ts 內產生 **TS2339（property 不存在於 Env）= self-cascade**。env.d.ts 檔頭明示「新增 secret 須更新本檔」→ 補宣告是**此 PR 必要的型別前置條件、非 scope creep**，且保持 `Env` 單一真相源（不在 email.ts 做平行 local env type＝owner 否決 Path B）。

## Scout（對抗式驗證）

`npx tsc -b tsconfig.solution.json` 實證 email.ts **31 errors**（TS7006 param / 無其他型別點）：

| 區塊 | 行 | implicit-any param |
|---|---|---|
| helper `fromOf` | (11,17) | `env` |
| helper `baseUrlOf` | (12,20) | `env` |
| helper `parseTimeoutMs`（已具 `: number` 回傳） | (14,25) | `env` |
| `sendDeleteConfirmationEmail` | 31 | `apiKey` `to` `token` `env` |
| 內部 `sendEmail`（destructure 已具型別） | 68 | `apiKey` `env` |
| `sendVerificationEmail` | 110 | `apiKey` `to` `token` `env` `signal` |
| `sendInvitationEmail` | 151 | `apiKey` `to` `token` `env` `signal` |
| `sendPasswordResetEmail` | 192 | `apiKey` `to` `token` `env` |
| `sendNewDeviceAlertEmail` | 234 | `apiKey` `to` `info` `env` |
| `sendRiskBlockedAlertEmail` | 288 | `apiKey` `to` `info` `env` |

合計 3 + 4 + 2 + 5 + 5 + 4 + 4 + 4 = **31**。

importer（8 functions + 1 test）：`delete` / `send-verification` / `forgot-password` / `login` / `register` / `oauth callback` / `webauthn login-verify` / `tenants invitations`；test `tests/email.test.ts`。

## 改動

### `types/env.d.ts`（External services 區，緊接 `RESEND_API_KEY?` / `IAM_BASE_URL?`）

```ts
MAIL_FROM_ADDRESS?: string;
RESEND_TIMEOUT_MS?: string;
```
（2 個 optional string，反映 email.ts 實際讀取的真實 env var；零 runtime、加 optional 欄位不破壞任何現有 caller。）

### `functions/utils/email.ts`（31 param annotation）

- 全部 `env` → `env: Env`（helper × 3 + 函式 × 7；補宣告後 `env?.MAIL_FROM_ADDRESS`/`env?.RESEND_TIMEOUT_MS` 解析為 `string | undefined`，`?? default` 後為 string）。
- `apiKey` → **`apiKey: string | undefined`**（owner 拍板）：忠實反映 caller 現況——`RESEND_API_KEY?: string`，且 3 個 caller〔`delete`/`send-verification`/`forgot-password`〕未 guard 即傳。**forward-correct**：strict:true 啟用後仍 cascade-free（見下風險節）。
- `to` → `to: string`、`token` → `token: string`（語意正確；caller 傳 row.email/local var）。
- `signal` → `signal?: AbortSignal`（line 110/151；caller 傳 `ctrl.signal`）。
- `info`（**最小 inline object type，不引新 abstraction**）：
  - `sendNewDeviceAlertEmail`：`info: { deviceUuidPrefix?: string; country?: string; when?: string }`
  - `sendRiskBlockedAlertEmail`：`info: { score?: number; factors?: string[]; country?: string; when?: string }`
  - （與 caller 物件欄位完全對應，無 excess-property；函式內 `info.X ?? default` 對應 optional。）

## 不碰（runtime byte-identical）

- 所有 email HTML template / subject / `RESEND_API` endpoint / `Bearer ${apiKey}` header / `fetch` body
- `sendEmail` 的 timeout/AbortController 邏輯（caller 給 signal 不 wrap、無 signal 才建內部 timeout）、`parseTimeoutMs` 數值邏輯、`fromOf`/`baseUrlOf` 的 `?? default`
- `try/finally` clearTimeout、error throw（`Resend API ${status}`）、`return await res.json()`
- **3 個未 guard caller 不修**（latent「`Bearer undefined`」→ 另案 hardening follow-up，本 PR type-only 不碰行為）

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `db6bb2b` `--report` 實測現況：errorCount **1081** / errorFiles **120** / cleanFiles **184** / sourceFilesTotal **304**。
- 本 PR 後 **current ratchet state**：errorCount **1081 → 1050**（−31）、errorFiles **120 → 119**（−1，email.ts 離開 errored set）、cleanFiles **184 → 185**（+1，email.ts 全清）。
- `env.d.ts` 為 `.d.ts`、本就 0 error；加 2 optional 欄位**不改 error/clean 計數**。
- baseline file 不變，天花板保留 errorCount 1119 / cleanFiles 175（reduce PR 不跑 `--update`）。

## Tier / 風險

- **低敏感 utils**（email 寄送，無安全判斷）。改動純參數型別，TS erase 後 runtime **零變化**。
- **caller cascade 分析（零 cascade）**：
  - 當前 functions leaf = **`noImplicitAny: true` / `strict: false`** → strictNullChecks **OFF**：`string | undefined`（如 `env.RESEND_API_KEY`）assignable 到 `string`，故 `apiKey`/`to` 任一型別當前皆**不 cascade**。
  - `apiKey: string | undefined` = **forward-correct**：strict:true 啟用後，`env.RESEND_API_KEY`（string|undefined）仍 assignable 到 `string | undefined`，3 個未 guard caller 不會在未來 strict 階段炸。
  - `info` object literal：caller 傳欄位與 inline type **完全對應**（無 excess-property check 失敗）；值多為 `any`（risk-score 等未 typed）→ assignable。
  - `env: Env`：8 caller 皆傳 handler `env`（typed `Env`）→ assignable；新增 optional 欄位後 email.ts 內 `env?.MAIL_FROM_ADDRESS` 解析正常。
- **驗證**：全 solution tsc 確認**只降 email.ts 31、零 cascade**（其他檔 error 計數不變）。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=db6bb2b npm run typecheck:ratchet` green（current 1081→1050 / errorFiles 120→119 / cleanFiles 184→185）。
  - 本機 base 用 main SHA，避免 branch 無 commit 時 HEAD~1 false-RED（[[feedback_ratchet_local_base_ref]]）。
- `npm run lint` green、`npm run build:functions` green。
- 觸及 email helper 的現有測試：`npx vitest run --config vitest.config.js tests/email.test.ts`（直接 import `functions/utils/email`）。
- 全 `tsc` filter 確認 **email.ts 0 殘留 + 無新增其他檔 error（零 cascade）**。
- **硬驗收**：source diff 僅 `env.d.ts`（+2 optional 欄位）+ `email.ts`（31 param annotation）；所有 HTML/subject/fetch/timeout/error-handling **byte-identical**；mutation/IO 零行邏輯改動；ratchet 淨降剛好 **31**。

## Follow-up（不在本 PR）

- **3 個未 guard caller**（`delete.ts` / `send-verification.ts` / `forgot-password.ts`）直接傳 `env.RESEND_API_KEY`（可能 undefined）→ 未來可能送 `Bearer undefined`（Resend 回 401、caller try/catch 吞掉、best-effort 不影響主流程）。屬 **behavior hardening**（加 `if (env.RESEND_API_KEY)` guard），非 type-only → 另案 PR、不混入本 PR。

## 流程定位

- 低敏感 utils、純 type-only → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff；code-gate = 實際 source diff）。
- 後續（不在本 PR）：續收低敏感 utils → **auth-core**（jwt/crypto/siwe/scopes/password/role-change/rate-limit，**每檔先確認**；risk-score.ts 因 security-adjacent〔gate 登入〕+ 型別設計重，建議升級為 security-adjacent 小批單獨 plan-gate）→ 熱區 codex chain → functions 清零開 `strict:true`。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy，補 credential-free prod smoke。
