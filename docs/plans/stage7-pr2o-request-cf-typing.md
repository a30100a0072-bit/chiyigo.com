# Stage 7 reduce PR-2o — request.cf canonical typing + device-alerts noImplicitAny

**目標**：建立 Cloudflare-augmented `Request`（帶 `.cf`）的 **canonical 型別法**，解鎖 noImplicitAny ladder 裡讀 `request.cf` 的檔；同 PR 把它**套用到第一個消費者** `functions/utils/device-alerts.ts`，將其 **14 個 noImplicitAny error → 0**，**純 type-only**。

**owner 拍板（2026-06-10）**：
1. **型別來源／放置 = Path 1** — 手寫窄型別、放 `types/env.d.ts` global ambient（與 `Env` 同類、同處、無 import）。**不**裝 `@cloudflare/workers-types`（spike 證該套件整個 node_modules 都沒裝、import 直接 TS2307；裝它會把 type-only 降錯變成 dependency/toolchain PR，且需 §套件管理 論證）。型別保持**窄**（只 `country`），未來需要 `colo`/`asn` 再明確擴、不一次搬官方大 shape。
2. **scope = Path 1** — 型別 + device-alerts 合成（owner 原 PR-2o「建型別」+ PR-2p「device-alerts 套用」併一個 PR）。理由：spike 已證只改 device-alerts 即可全清 14、總數恰好 −14、cascade 數學上為 0 → 一個 global runtime 型別 + 一個已驗證消費者 = 理想的 Stage 7 tiny source commit。純建型別無消費者 = ratchet 淨降 0、且型別未被行使無法 falsify。
3. **AlertEnv** = file-local `Pick<Env, …>`（照 `email.ts` 的 `EmailEnv` 慣例，**非** owner 決策點）。

base main `75c3bb0`（接 PR-2n 與 test-fix #53）。device-alerts 純非熱區 util（fire-and-forget 異常裝置警示，無 auth/payment gate 判斷）。

---

## Scout（對抗式驗證，含 spike 實證）

### 讀 `request.cf` 的檔（`grep -rlE "request\??\.cf" functions` 重新確認）= 4 個

| 檔 | request.cf 用法 | PR-2o 處置 |
|---|---|---|
| `functions/utils/device-alerts.ts` | line 60、88 `request?.cf?.country` | **本 PR 收**（first CF-pattern consumer） |
| `functions/api/auth/2fa/verify.ts` | line 182 `request?.cf?.country` | 排除（auth-flow entrypoint + 10-param helper；未來另案） |
| `functions/utils/risk-score.ts` | line 61 `request?.cf?.country` | 排除（security-adjacent，owner 裁「升級 security-adjacent 小批單獨 plan-gate」） |
| `functions/api/_middleware.ts` | line 144 `request.cf ?? {}` | 排除（全域 middleware 熱區，留熱區 codex chain） |

### 核心 wrinkle 證實（spike）

WebWorker 的 lib `Request` global **沒有 `.cf`**，所以 `request: Request` 會讓 `request?.cf?.country` 噴 **TS2339**。三段 spike（scratch 檔，已刪）：

1. `import type { IncomingRequestCfProperties } from '@cloudflare/workers-types'` → **TS2307 Cannot find module**（套件未裝；`node_modules/@cloudflare/` 只有 `kv-asset-handler`/`vitest-pool-workers`/`workerd-windows-64`，連 vitest-pool-workers 宣告的 transitive `@cloudflare/workers-types` 也未實際安裝）→ **import 官方型別不可行**。
2. 手寫 `Request & { cf?: { country?: string } }` → `request.cf.country` **合法、零 error**（functions + tests 兩 project）。
3. bare `request: Request` 存取 `.cf` 配 `@ts-expect-error` → directive 被滿足（無 "unused directive" 報錯）→ 確認 lib `Request` **確無 `.cf`**。

### device-alerts 全清 spike（已 revert）

把 3 個函式參數全標註（`AlertEnv` + `CfRequest` + `userId/email/deviceUuid`）後 `tsc -b --force --pretty false`：
- `functions/utils/device-alerts.ts` 錯誤 14 → **0**。
- 全量 file-errors 1042 → **1028**（淨 **−14**）。
- **cascade 數學證明 = 0**：只改 device-alerts 一個檔；total 恰好 −14 == device-alerts 釋放的 14 → 其他所有檔 error 計數**完全未變**（若有 cascade +K，total 會是 1028+K）。
- `--report` 確認 errorFiles 119 → **118**、cleanFiles 185 → **186**。

### env forward cascade 點（已驗）

device-alerts 把 `env` 往下傳給 3 個函式：
- `safeUserAudit(env, …)`、`hashIdentifierForAudit(env, …)`（`functions/utils/user-audit.ts`）→ 兩者 env 參數**仍 implicit-any**（user-audit.ts 自身尚未收編）→ **不 constrain** 傳入型別。
- `sendNewDeviceAlertEmail(env.RESEND_API_KEY, email, {…}, env)`（`functions/utils/email.ts`，PR-2m 已型別化）→ 第 4 參 `env?: EmailEnv`，`EmailEnv = Pick<Env, 'IAM_BASE_URL' | 'MAIL_FROM_ADDRESS' | 'RESEND_TIMEOUT_MS'>` → **會 constrain**：device-alerts 的 env 型別必須 assignable 到 `EmailEnv`，否則 TS2345 cascade。
- → 故 `AlertEnv` 必含 `email.ts` forward 需要的 3 個 key（`IAM_BASE_URL`/`MAIL_FROM_ADDRESS`/`RESEND_TIMEOUT_MS`）+ device-alerts 直接讀的 2 個（`chiyigo_db`/`RESEND_API_KEY`）= 5 key。spike 已含此 5-key `AlertEnv` 並證零 cascade。

---

## 改動（source scope = 2 檔，皆 type-only）

### 1. `types/env.d.ts`（`declare global` 內，緊接 `interface Env { … }` 之後）

新增 global 型別別名（與 `Env` 同為 Cloudflare runtime ambient contract、同處、無需 import）：

```ts
/**
 * Cloudflare 在 edge 為 inbound Request 注入的 `cf` metadata（geo/IP 等）。
 * lib `Request`（WebWorker）無 `.cf`；local / integration-test 環境亦無
 * （故 `cf?` optional）。窄到目前唯一讀取的 `country`；未來消費 colo/asn
 * 等欄位時再明確擴充（勿一次搬官方完整 shape）。
 */
type CfRequest = Request & {
  cf?: {
    country?: string
  }
}
```

- 為什麼 global（不開新模組）：`Env` 已是 repo 的 ambient Cloudflare runtime contract，`request.cf` 是同一類 runtime 注入 shape；repo **無 `functions/types/` 慣例**，為一個 ~11 行型別開新共用模組會增加放置規則並與 `Env`（全 codebase `Pick<Env,…>` 無 import 直接用）的慣例分歧（§架構一致性）。
- 純型別宣告、TS erase 後 runtime 零變化；`cf?` 為 optional → 既有任何 `request: Request` 用法不受影響、無 cascade。

### 2. `functions/utils/device-alerts.ts`（1 個 file-local type alias + 14 param annotation）

- **新增 1 行 file-local derived 型別**（照 `email.ts` 的 `EmailEnv` 慣例，從 `Env` 衍生、非平行 SSOT）：
  ```ts
  type AlertEnv = Pick<Env, 'chiyigo_db' | 'RESEND_API_KEY' | 'IAM_BASE_URL' | 'MAIL_FROM_ADDRESS' | 'RESEND_TIMEOUT_MS'>
  ```
  （`chiyigo_db`/`RESEND_API_KEY` = 直接讀；後 3 key = forward 給 `sendNewDeviceAlertEmail(env?: EmailEnv)` 所需。）
- **3 個函式參數標註**（14 個 implicit-any）：
  - `safeAlertAnomalies(env: AlertEnv, request: CfRequest, { userId, email, deviceUuid }: { userId: number; email: string | null; deviceUuid: string | null })`
  - `checkNewDevice(env: AlertEnv, request: CfRequest, userId: number, email: string | null, deviceUuid: string | null)`
  - `checkCountryJump(env: AlertEnv, request: CfRequest, userId: number, _email: string | null)`
- `email`/`deviceUuid` 取 `string | null`（忠實反映 caller 可能傳 null、`?? null` 流向；strictNullChecks OFF 下對 `to: string` 仍 assignable）；`userId: number`。

## 不碰（runtime byte-identical）

- 兩個偵測的全部邏輯：新裝置 SQL（`COUNT(*)`/`SUM(CASE…)`）、`total<=1`/`sameDevice>1` 判斷、country jump 撈最近 2 筆 audit + `JSON.parse` 比對。
- `hashIdentifierForAudit`（keyed HMAC）、`safeUserAudit`（`auth.new_device`/`auth.country_jump` critical）、`sendNewDeviceAlertEmail` 呼叫的所有引數與 `device_uuid_hmac16`/`salted`/`country`/`when` payload。
- `Promise.allSettled` fan-out、全 `try { … } catch { /* swallow */ }` fire-and-forget 語意、`if (!deviceUuid) return` / `if (!currCountry) return` early-skip。
- request.cf 讀法本身（`request?.cf?.country ?? null`）一字不改——只給 `request` 參數型別。

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `75c3bb0` `--report` 實測現況：errorCount **1042** / errorFiles **119** / cleanFiles **185** / sourceFilesTotal **304**。
- 本 PR 後 **current ratchet state**：errorCount **1042 → 1028**（−14）、errorFiles **119 → 118**（−1）、cleanFiles **185 → 186**（+1，device-alerts 全清）。
- 新增的 `type CfRequest`（env.d.ts）+ `type AlertEnv`（device-alerts.ts）皆**零 error**、不改 error/clean 計數。
- baseline file 不變，天花板保留 errorCount **1119** / cleanFiles **175**（reduce PR 不跑 `--update`）。

## Tier / 風險

- **低敏感非熱區 util**（異常裝置警示，fire-and-forget、無安全判斷 gate）。改動純參數型別 + 2 個 derived/global type alias，TS erase 後 runtime **零變化**。
- **零 cascade（含 tests-leaf）**：
  - **source**：spike 數學證明 total 恰 −14、僅 device-alerts 變動（見 Scout）。
  - **tests-leaf**：`tests/integration/device-alerts.test.ts` 以 `reqWithCountry()` 建 `new Request(...)`（靜態型別 `Request`，conditionally `Object.defineProperty(req,'cf',…)`）→ 對 `request: CfRequest`（`cf?` optional）**assignable**；env 用 `cloudflare:test` 的真實 `ProvidedEnv extends Env`（全 Env）→ assignable 到 `AlertEnv`（Pick 子集）；`userId/email/deviceUuid` 傳 number/string/null → assignable。→ **0 新 TS2345**。
  - **production callers**（`2fa/verify`/`login`/`oauth callback`/`webauthn login-verify` 4 入口）：自身 implicit-any → 傳 `any` 值 → 不 constrain、不 cascade。
- **CfRequest 名稱無碰撞**（全 repo grep `\bCfRequest\b` 無既有符號；無既有 Request `.cf` augmentation）。

## 驗證計劃（coding 階段）

> ⚠ **本 PR 改 ambient `.d.ts`（env.d.ts）→ 增量 `tsc -b` 可能 stale 短報**（[[feedback_tsc_b_incremental_stale_after_ambient_dts]]，PR-2m 教訓）。所有 ratchet/tsc 量測前先 `rm -rf .tscache`（或 `--force`）全重建，取 CI clean-checkout 真值。

- `rm -rf .tscache; RATCHET_BASE_REF=75c3bb0 npm run typecheck:ratchet` green（current 1042→1028 / errorFiles 119→118 / cleanFiles 185→186）。
  - 本機 base 用 main SHA，避免 branch 無 commit 時 HEAD~1 false-RED（[[feedback_ratchet_local_base_ref]]）。
- `npm run lint` green（`_email` 以 `_` 前綴、annotation 不改 unused 狀態）、`npm run build:functions` green。
- **targeted filtered tsc**：全 `tsc -b --force` filter 確認 `functions/utils/device-alerts.ts` **0 殘留** + `tests/integration/device-alerts.test.ts` 無新增 TS2345 + 無其他檔 error 增加（零 cascade）。
- **觸及的整合測試**：`npx vitest run --config vitest.workers.config.js tests/integration/device-alerts.test.ts`（直接 import `functions/utils/device-alerts`，含 `request.cf` 有/無、新裝置/country jump 路徑）。
- **硬驗收**：source diff 僅 `env.d.ts`（+`type CfRequest` 區塊）+ `device-alerts.ts`（+1 `type AlertEnv` 行 + 14 param annotation）；所有 SQL/HMAC/audit/email payload/控制流 **byte-identical**；ratchet 淨降剛好 **14**、零 cascade。

## Follow-up（不在本 PR）

- `2fa/verify.ts`（auth-flow）、`risk-score.ts`（security-adjacent 小批單獨 plan-gate）、`_middleware.ts`（熱區 codex chain）三個 `request.cf` 消費者 → 各自後續 PR **複用本 PR 建立的 global `CfRequest`**（這正是「建型別」的解鎖價值）。
- `risk-score.ts` 另含 `factors: string[]` / D1 row callback / return-shape 設計，建議 security-adjacent 小批單獨 plan-gate（owner 既定）。

## 流程定位

- 低敏感非熱區 util、純 type-only → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff；code-gate = 實際 source diff）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy（撞 `jwt.test`「rejects tampered token」偶發 flake 就 rerun --failed 清綠、與本 PR 無關），補 credential-free prod smoke。
