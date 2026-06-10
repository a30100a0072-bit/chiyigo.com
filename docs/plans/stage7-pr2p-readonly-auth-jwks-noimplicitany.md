# Stage 7 reduce PR-2p — read-only auth/JWKS pilot（noImplicitAny）

**目標**：3 個 **read-only GET** 端點各清 noImplicitAny → 0，**純 type-only**，共 **6 errors → 0**：
- `functions/api/auth/userinfo.ts`（OIDC UserInfo，2 err）
- `functions/api/auth/me.ts`（dashboard 自家身份，3 err）
- `functions/.well-known/jwks.json.ts`（RFC 7517 公鑰分發，1 err）

> **誠實命名（owner 拍板 2026-06-10）**：這**不是**一般「非熱區低風險 endpoint batch」。scout 證實該批已在 PR-2a..2l 實質清光——目前 `functions/api/**` 所有 ≤3-error handler（27 個）**全落在 auth / payment / admin·audit / middleware** 排除類別，無合格非熱區成員。本 PR 是 owner 批准的**窄例外 pilot：「read-only auth/JWKS」**。

## 放寬規則（精確版，owner 拍板）

- **仍排除**：auth mutation、token 簽發、risk scoring、middleware。
- **只允許**：read-only GET / OPTIONS。
- **不得改**：auth 語意、SQL、response shape、headers / cache / CORS。
- 本 PR 僅加 handler context 型別標註（Convention A）+ 1 個 map callback 參數型別，**TS erase 後 runtime 零變化**。

## Scout（對抗式驗證，含 spike 實證）

`grep` + forced tsc（base main `bbfa0a4`，total 1028）確認 6 個 error 的**精確位置與型別**：

| 檔 | 行/欄 | error | 修法 |
|---|---|---|---|
| `jwks.json.ts` | (29,38) | TS7031 `env` binding | `({ env }: { env: Env })` |
| `userinfo.ts` | (29,38)/(29,47) | TS7031 `request`/`env` binding | `({ request, env }: { request: Request; env: Env })` |
| `me.ts` | (21,38)/(21,47) | TS7031 `request`/`env` binding | `({ request, env }: { request: Request; env: Env })` |
| `me.ts` | (69,44) | TS7006 `i` param | `.map((i: Record<string, unknown>) => …)` |

### `me.ts` 的 `i` 為何不用 `.all<IdentityRow>()`（對抗式發現）

owner 提的 `.all<IdentityRow>()` 在本 repo **無效**：`@cloudflare/workers-types` 未安裝（PR-2o spike 已證）→ `env.chiyigo_db` 的 `D1Database` 解為 **`any`**（靠 skipLibCheck 容忍）→ `db.prepare(...).bind(...).all<IdentityRow>()` 是對 `any` 帶 type-arg，`any` 忽略 type-arg、仍回 `any`、`{ results: identities }` 的 `identities` 仍 `any` → `.map(i)` 的 `i` 仍 implicit-any（TS7006 不消）。**唯一有效解＝直接標 callback 參數型別**。採 **`i: Record<string, unknown>`**——這是本 repo projection-map callback 的**既定慣例**（PR-2c aggregate `r`、PR-2e/2f `r`/`u` 皆 owner-ruled `Record<string,unknown>`，§架構一致性），且 `i.provider` 等成 `unknown` 投影進 response object 不破壞 shape（spike 證零殘留、零 cascade）。

### `request.cf`？否

`me.ts` / `userinfo.ts` 的 `request` **不讀 `.cf`**（只傳給 `requireAuth`）→ 用 lib `Request` 即可，**不需** PR-2o 的 `CfRequest`。

### 既有測試覆蓋（owner 指定 gate `tests/integration/oidc.test.ts`）

`oidc.test.ts` 直接 import 並呼叫：
- `jwksGet({ env })`（env = `cloudflare:test` 全 `Env`）→ 型別後 assignable ✓
- `userinfoGet({ request: new Request(...), env })`（req = lib `Request`）→ assignable ✓
- discovery（不在本 PR scope）

## 改動（source scope = 3 檔，皆 type-only / read-only handler）

### `functions/.well-known/jwks.json.ts`
- `onRequestGet({ env }: { env: Env })`（1 處）。
- **不碰**：`getPublicJwks(env)`〔jwt.ts，env 為 implicit-any → 傳 typed `Env` 不 cascade〕、`CORS_HEADERS`、`Cache-Control: public, max-age=3600`、`let keys` evolving-any、500/200 response shape、`onRequestOptions`。

### `functions/api/auth/userinfo.ts`
- `onRequestGet({ request, env }: { request: Request; env: Env })`（1 處）。
- **不碰**：`requireAuth(request, env, null, { audience: null })`〔cross-aud OIDC 語意〕、`.first()` row 讀取（→any、無 row 錯）、banned/404 分支、OIDC claims shape（sub/email/email_verified/name/updated_at）、`onRequestOptions`。

### `functions/api/auth/me.ts`
- `onRequestGet({ request, env }: { request: Request; env: Env })`（1 處）+ `identities.map((i: Record<string, unknown>) => …)`（1 處）。
- **不碰**：`requireAuth(request, env)`、即時 DB banned 檢查（403）、`USER_NOT_FOUND`（404）、兩段 SQL（users LEFT JOIN local_accounts / user_identities）、response shape（含 `identities[]` 的 provider/display_name/avatar_url/linked_at 對應）。

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `bbfa0a4` `--report` 現況：errorCount **1028** / errorFiles **118** / cleanFiles **186** / sourceFilesTotal 304。
- 本 PR 後 **current ratchet state**：errorCount **1028 → 1022**（−6）、errorFiles **118 → 115**（−3）、cleanFiles **186 → 189**（+3，三檔全清）。
- baseline file 不變，天花板保留 errorCount **1119** / cleanFiles **175**（reduce PR 不跑 `--update`）。

## Tier / 風險

- **read-only auth/JWKS（無 mutation / 無 token 簽發 / 無 risk）**。改動純 handler context 型別 + 1 map callback 型別，runtime byte-identical。
- **零 cascade（spike 數學證明）**：只改 3 檔；forced tsc total 1028→1022 = −6 == 三檔釋放的 6 → 其餘所有檔（含 jwt.ts 35 / auth.ts 7 等既存 error）計數完全未變。
- **tests-leaf**：`oidc.test.ts` 以全 `Env` + lib `Request` 呼叫 jwks/userinfo handler → assignable，0 新 TS2345（me.ts 無直接 test caller）。
- 名稱無新 global、無新套件、無 tsconfig 改動（不同於 PR-2o）。

## 驗證計劃（coding 階段）

> ⚠ ratchet/tsc 量測前先清 `.tscache` 全重建（PowerShell native `Remove-Item -Recurse -Force .tscache` 或 `tsc --force`，**勿照字面跑 POSIX `rm -rf`**——plan-gate nit）。**PowerShell 用 `$env:RATCHET_BASE_REF='bbfa0a4'`**（勿照字面跑 POSIX `VAR=x npm`，否則 fallback HEAD~1——PR-2o plan-gate nit）。

- `$env:RATCHET_BASE_REF='bbfa0a4'; npm run typecheck:ratchet` green（current 1028→1022 / errorFiles 118→115 / cleanFiles 186→189）。
- `npm run lint` green（`Record<string,unknown>` 在型別位置，比照 kyc.ts `Partial<Record<…>>` 既有先例不觸 no-undef）、`npm run build:functions` green。
- **filtered forced tsc**：`tsc -b --force` filter 確認 `me.ts` / `userinfo.ts` / `jwks.json.ts` **各 0 殘留**（6→0）+ 無其他檔 error 增加（零 cascade）。
- **整合測試**：`npx vitest run --config vitest.workers.config.js tests/integration/oidc.test.ts`（直接 import jwks/userinfo handler；含 discovery/jwks/userinfo happy + 401/403/404 路徑）。
- **硬驗收**：source diff 僅 3 檔的 4 處 annotation；所有 SQL / requireAuth 參數 / response shape / CORS / Cache-Control **byte-identical**；ratchet 淨降剛好 **6**、零 cascade。

## 測試覆蓋誠實（owner 指定，不 overclaim）

- `oidc.test.ts` 實跑覆蓋 **jwks + userinfo**（happy + 無 token/壞 token/banned/not-found 分支）。
- **`/api/auth/me` 無正向整合測試**（全 repo grep 證實）→ 本 PR **不宣稱 me.ts 端點被 runtime 實跑驗證**；me.ts 僅由 tsc / build:functions（型別 + bundle）涵蓋。屬 **residual test gap**，因本 PR 純 type-only、runtime byte-identical → **可接受**，但明文記錄、不誇大。

## Pilot 後續（owner 拍板的放寬條件）

- 本 pilot 證 **ratchet delta == 各檔 error sum（=6）+ 零 cascade** 後，owner 才考慮把後續 read-only 例外批放寬到 **4–5 檔/PR**。
- **下一刀不選** cf 消費者（2fa/verify auth-flow、risk-score security-adjacent、_middleware 熱區——皆走各自 codex chain，非 batch pilot）；auth-core（jwt/crypto/siwe/scopes/…）為後續主線。

## 流程定位

- auth 域（即使 read-only）→ **full 四檢查點 + codex chain**（plan-gate = 本 doc；code-gate = 實際 source diff）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy（撞 `jwt.test` flake 就 rerun --failed），補 credential-free prod smoke。
