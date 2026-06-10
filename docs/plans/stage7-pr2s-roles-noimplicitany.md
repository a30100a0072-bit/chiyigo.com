# Stage 7 reduce PR-2s — utils/roles noImplicitAny（auth-core 單檔 codex chain 第 3 棒）

**目標**：`functions/utils/roles.ts` **3 個 noImplicitAny error → 0**，**純 type-only**（2 個函式簽名、3 個參數標註）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。`password.ts`（PR-2q `4d6d075`）校準模板、`role-change.ts`（PR-2r `b43770b`）第 2 棒；本 PR = 第 3 棒 `roles.ts`，再續 risk-score.ts〔security-adjacent 單獨 plan-gate〕→ 2fa/verify → _middleware〔最後、blast radius 最大〕。

base main `b43770b`（接 PR-2r）。

## ⚠ auth-core / RBAC 敏感聲明（最高優先紀律）

`roles.ts` = **RBAC 合法 role 定義的 single source of truth**（`VALID_ROLES` catalog + `isValidRole` application-layer 驗證 + `canRoleSeeAuditEvent` support-role audit 遮蔽白/黑名單），privilege-escalation 領域、Tier-0 security boundary。owner 紀律：**修法若非純型別、或會牽動 role 集合 / 驗證語意 / 階層對應 / 回傳 shape / 任何 runtime 行為 → 立刻停手回報，不硬寫 plan；寧可 partial（fail-closed 留 residual）也不用 derived-any 假清或改 role 定義/授權語意。**

**scout 結論：修法為純型別、零行為變更，繼續出 plan。** 改動 = 2 個函式簽名共 3 個參數補型別標註（`unknown` ×2 + `string` ×1，全部「any → 更嚴格」方向）。**完全不碰**：`VALID_ROLES` 8 個 role 條目、`Object.freeze`、`VALID_ROLES_SET`、`typeof` 守衛、`SUPPORT_SAFE_EVENT_PREFIXES` / `SUPPORT_DENIED_EVENT_PREFIXES` 白/黑名單內容、prefix 比對順序（黑名單先擋 → 白名單放行 → 預設遮蔽 fail-closed）、`role === 'support'` 分支、回傳 shape。TS erase 後 runtime **byte-identical**。

## Scout（對抗式驗證，含 spike 實證）

### exact errors（forced tsc，base `b43770b`、total 1020）
```
functions/utils/roles.ts(35,29): error TS7006: Parameter 'role' implicitly has an 'any' type.
functions/utils/roles.ts(73,38): error TS7006: Parameter 'eventType' implicitly has an 'any' type.
functions/utils/roles.ts(73,49): error TS7006: Parameter 'role' implicitly has an 'any' type.
```
**恰 3 個**（baseline file `types/typecheck-baseline.json` 同記 `"functions/utils/roles.ts": 3`）——`isValidRole(role)` 1 個 + `canRoleSeeAuditEvent(eventType, role)` 2 個。檔內無其他 implicit-any 點（module-level const 全有推斷型別）。

### 型別選型（逐參數，chain 既定 pattern）

**1. `isValidRole(role: unknown)`** —— PR-2q password.ts 同款「邊界 untrusted / 窄化前 → unknown」：
- 本函式**就是** role 驗證器本體（窄化函式），in-body `typeof role === 'string'` type guard 完整。
- `tests/roles.test.ts:27-30` **故意傳 `null` / `undefined` / `123` / `{}`** 測 guard → `unknown` 全 assignable（零 tests-leaf cascade、不改 test）；`string` 會 TS2345 炸 4 個測例。
- narrowing 後 `VALID_ROLES_SET.has(role)` 的 `role` 已是 `string`，`Set<string>.has` ✓（spike 證無新 error）。

**2. `canRoleSeeAuditEvent(eventType: unknown, ...)`** —— 同上 pattern：
- in-body 已有 **fail-closed 守衛** `if (typeof eventType !== 'string') return false`（support 分支內），runtime 本來就把 eventType 當 untrusted 處理。
- `tests/roles.test.ts:59` **故意傳 `null`** 測 fail-closed → `unknown` 必要；`string` 會 TS2345。
- 守衛後 `eventType.startsWith(p)` 已窄化為 `string` ✓。
- caller `audit.ts:134` 傳 `r.event_type`（D1 row → 本 repo `D1Database`=any → `r` any）→ assignable ✓。

**3. `canRoleSeeAuditEvent(..., role: string)`** —— 與 #1/#2 不同，這裡選 `string` 非 `unknown`：
- 此參數**非**驗證器輸入，是 post-auth 的 role 值；JSDoc `@param {string} role` 一致；body **無** typeof 守衛（`role === 'support'` 直接比對）。
- 全部測例只傳 string（line 35 loop over string array literal、`'support'` 字面值）→ `string` 零 tests-leaf cascade。
- caller `audit.ts:134` 傳 `user.role`（requireAuth 未型別化 → any）→ assignable ✓。
- 若用 `unknown`：型別上會暗示「非 string role 也是受支援輸入」，但 body 無守衛（非 string role 走 `return true` = 看全套），**型別寬鬆化反而遮蔽 fail-open 事實**；`string` 讓未來 strict 化 caller 時 TS 強制 caller 先證明 role 是 string，更 fail-closed。

**考慮過、否決**：
- `isValidRole` 加 type predicate（`role is ...`）→ 改變 caller 端 narrowing 行為 = 型別語意變更，非最小 diff；且 `VALID_ROLES` 無 `as const`（型別 `readonly string[]`），predicate 只能寫 `role is string`，價值低。否決。
- `VALID_ROLES` 加 `as const` 變 literal union → 改變 exported 型別 shape（潛在 caller cascade + 語意變更），與本 PR「清 implicit-any」無關。否決（留待未來需要時獨立 PR）。

### callers / cascade 面（roles.ts 是底層 util，特別查廣）
全 repo grep `isValidRole|VALID_ROLES|canRoleSeeAuditEvent|utils/roles`：
- **source caller 僅 2 檔**：`role-change.ts:57` `isValidRole(newRole)`（`newRole: string`，PR-2r 已型別化 → assignable 到 `unknown` ✓）；`api/admin/audit.ts:134` `canRoleSeeAuditEvent(r.event_type, user.role)`（兩值皆 any → assignable ✓）。`scopes.ts` 僅註解提及、無 import。
- **test caller**：`tests/roles.test.ts`（unit，10 例）——本 PR 型別選型即由其測例倒推，零改 test。
- D1 row：roles.ts 不碰 env / D1（pure module-level catalog + pure functions），無 row 存取。

### spike 實證（已 revert）
套 3 個標註後清 `.tscache` → `tsc -b --force`：
- **functions leaf**：`roles.ts` 3 → **0**（filter 無殘留）。
- **tests leaf**（`tsconfig.tests.json` 含 `functions/**` + `tests/**`）：**exit 0、0 errors** → 零 tests-leaf cascade。
- **canonical `--report`**：errorCount 1020 → **1017**（淨 **−3**）、errorFiles 113 → **112**、cleanFiles 191 → **192**。
- **零 cascade 數學證明**：只改 1 檔、total 恰 −3 == roles.ts 釋放的 3 → 其他所有檔（含 role-change.ts 0 / audit.ts 既存數）完全未變。
- **targeted test 實跑**：`npx vitest run tests/roles.test.ts` **10/10 passed**（標註套用狀態下跑，證 runtime 不變）。
- lint 風險評估：改動僅參數標註（built-in `unknown`/`string`），無新 identifier / 無新 global type → 無 PR-2o 式 `no-undef` 旗標面；`npm run lint` 列 code-stage gate 實跑。

## 改動（source scope = 1 檔，純 type-only，2 處簽名 / 3 個參數）

### `functions/utils/roles.ts`
```ts
// line 35
export function isValidRole(role: unknown) {
// line 73
export function canRoleSeeAuditEvent(eventType: unknown, role: string) {
```
- **不碰**：`VALID_ROLES` 條目 / `Object.freeze` / `VALID_ROLES_SET`、兩個 prefix 名單內容與順序、`typeof` 守衛、`role === 'support'` 分支、回傳 shape、所有註解。

### 已知小不一致（doc-only，預設不修）
`canRoleSeeAuditEvent` 的 JSDoc `@param {string} eventType`（line 69）與新標註 `unknown` 字面不一致——但 runtime 守衛 + 測例（傳 null）證明 `unknown` 才是事實 contract，JSDoc 反映的是「caller 預期傳 string」的意圖。比照 PR-2r「不碰 JSDoc」前例（該 PR `@param {object} env` vs `env: Env` 同樣未修），**預設保持 source diff 嚴格 = 2 行標註**、JSDoc 不動，列 post-strict doc cleanup debt。若 plan-gate / owner 裁定要順修（`{string}` → `{unknown}`，+1 行 doc-only、零 runtime），coding 階段一併帶入。

## 預期 ratchet

- clean main `b43770b` `--report` 現況：errorCount **1020** / errorFiles **113** / cleanFiles **191** / sourceFilesTotal 304。
- 本 PR 後 **current ratchet state**：errorCount **1020 → 1017**（−3）、errorFiles **113 → 112**（−1）、cleanFiles **191 → 192**（+1，roles.ts 全清）。
- baseline file 不變，天花板保留 errorCount **1119** / cleanFiles **175**（reduce PR 不跑 `--update`）。

## Tier / 風險

- **RBAC SSOT，但純 type-only**：3 個參數 any → 更嚴格型別，TS erase 後 runtime **零變化**；role 集合 / 驗證語意 / 遮蔽名單零變化。
- **blast radius 小且已實證**：3 export、2 source caller（皆 assignable、spike 數學證明零 cascade）、1 unit test 檔。
- **零 cascade（含 tests-leaf）**：spike total 恰 −3、tests leaf exit 0、roles.test.ts 10/10。
- 無新 global、無新套件、無 tsconfig 改動、不碰 env / D1。

## 驗證計劃（coding 階段）

> ⚠ ratchet/tsc 量測前先清 `.tscache` 全重建（PowerShell `Remove-Item -Recurse -Force .tscache`，**勿照字面跑 POSIX `rm -rf`**）。**PowerShell 用 `$env:RATCHET_BASE_REF='b43770b'`**（勿照字面跑 POSIX `VAR=x npm`，否則 fallback HEAD~1 false-RED）。

- `$env:RATCHET_BASE_REF='b43770b'; npm run typecheck:ratchet` green（current 1020→1017 / errorFiles 113→112 / cleanFiles 191→192）。
- `npm run lint` green、`npm run build:functions` green。
- **filtered forced tsc**：確認 `roles.ts` **0 殘留** + 無其他檔 error 增加（零 cascade，含 `tsc -b tsconfig.tests.json --force` exit 0）。
- **targeted test**（unit，default config）：`npx vitest run tests/roles.test.ts`（10 例）。
- **硬驗收**：source diff 僅 `roles.ts` 2 行簽名（3 參數標註）；role 條目 / 名單 / 守衛 / SQL-free pure functions **byte-identical**；ratchet 淨降剛好 **3**、零 cascade。

## 測試覆蓋誠實

`tests/roles.test.ts` 10 例 unit 實跑覆蓋：`VALID_ROLES` 8 條目精確比對、`isValidRole` 全 8 role true / unknown·空字串·`null`·`undefined`·`123`·`{}` false、`canRoleSeeAuditEvent` non-support 4 role（super_admin/admin/developer/finance）全 true、support 白名單 7 prefix true、白名單外+空字串+`null` eventType false（fail-closed）、黑名單蓋白名單 5 例 false。
**未被測例覆蓋、不宣稱實跑**：`player` / `moderator` / `user` 作為 `canRoleSeeAuditEvent` 的 role 參數（走同一 `return true` 分支，分支本身已被 4 個 non-support role 覆蓋）；`api/admin/audit.ts` endpoint 層的過濾整合行為（本 PR 不動 audit.ts，不在驗證範圍宣稱）。

## 流程定位（auth-core 單檔模板）

- auth-core / RBAC SSOT util → **full 四檢查點 + codex chain**（plan-gate = 本 doc；code-gate = 實際 source diff）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；紅 CI 不 merge；merge 後監看 CI+Deploy（撞 `jwt.test`「rejects tampered token」偶發 flake 就 `gh run rerun --failed`），補 credential-free prod smoke（roles.ts 無自身端點 → smoke 確認 deploy 健康、home/login 200）。
- **下一刀（owner 排序）**：risk-score.ts〔security-adjacent 單獨 plan-gate〕→ 2fa/verify → _middleware〔最後〕。
