# Stage 7 PR-2dh — misc leaf 首棒：cookies + device-id noImplicitAny → 0

**PR**：refactor(utils): annotate cookies + device-id noImplicitAny (8 -> 0)
**base**：`0195c266`（#131 PR-2dg）｜**source commit**：`96f12a9a`｜**docs gate-log**：`9ae7fcd4`（+ 本 trajectory 最終更新）
**級別**：impl L1 / review care L2（pure utils、type-only、無 env/D1/token 變更）
**性質**：純 type-only、byte-identical 2/2、misc leaf 群首棒（split 而非 12 檔 domain-batch）

## 目標 / 結果

misc leaf 群最乾淨 2 檔 **`utils/cookies.ts` + `utils/device-id.ts`**、**8 noImplicitAny（TS7006×5 + TS7031×3）→ 0**（cookies TS7006×4；device-id TS7031×3〔`{ read, write, makeUuid }` 解構每 binding element 各報一次〕+ TS7006×1）。
ratchet **566 / 43 / 292 → 558 / 41 / 294**（baseline 1119/175 凍結、reduce PR 不 `--update`）。

> **misc≠coherent 單域**：misc 80 錯跨 7 pattern × 2 風險層（🟢🟡 low utils / 🔴 session-token L3）。本棒刻意只收「型別最乾淨、無 session/token 變更、皆 unit-tested」的 2 檔 pure utils，把 review care 壓到 L2；session/token（PR-2di）、admin（PR-2dj）、game/login SSO（PR-2dk）、requireRole/auth/oauth/audit（殿後）另棒。

## Scope（2 檔、5 edit sites）

```
functions/utils/cookies.ts     3 sites  (4 err：TS7006×4)
functions/utils/device-id.ts   2 sites  (4 err：TS7031×3 + TS7006×1)
```
合計 5 edit sites、清 8 錯。**不含** `docs/plans/` gate-log 本檔（Phase 2 作第 2 commit）。

## Frozen Diff（ground truth；5 sites，逐字）

### `functions/utils/cookies.ts`
```
L17  - export function refreshCookie(token, maxAgeSec) {
     + export function refreshCookie(token: string, maxAgeSec: number) {

L41  - export function isWebClient(request, { platform }: { platform?: string | null } = {}) {
     + export function isWebClient(request: Request, { platform }: { platform?: string | null } = {}) {
        （註：{ platform } 早於 Stage 2 PR-1 已標；本次僅補 request）

L52  - export function readOAuthDeviceCookie(request) {
     + export function readOAuthDeviceCookie(request: Request) {
```

### `functions/utils/device-id.ts`
```
L19  - export function pickOrMakeDeviceUuid({ read, write, makeUuid }) {
     + export function pickOrMakeDeviceUuid({ read, write, makeUuid }: { read: () => string | null; write: (v: string) => void; makeUuid: () => string | null }) {

L31  - function safeCall(fn) {
     + function safeCall<T>(fn: () => T): T | null {
```

## Owner Decisions（SPEC LOCKED，2026-07-01）

- **SC-1 scope**：僅 `utils/cookies.ts`、`utils/device-id.ts`。**不納入** `game/login.ts` / session-token / admin / requireRole / auth / oauth / audit。
- **SC-2 變更性質**：type-only；**不得**改 runtime branch、cookie 格式字串、device-id 生成邏輯、storage key、fallback 行為。byte-identical 為硬要求。
- **SC-3 device-id DI options**：採 **inline type**（`{ read: () => string | null; write: (v: string) => void; makeUuid: () => string | null }`）；**不**抽 named `DeviceIdAdapter`（無多處重用、無 export 需求 → named type 只增命名面與 review burden）。
- **SC-4 anti-scope**：`CLEANUP_PLAN.md`（untracked、unrelated）任何 commit / PR 禁入；stage 只明確 add 本 2 檔 + gate-log。

## Architecture Locks（ChatGPT Arch `APPROVED_WITH_LOCKS`，2026-07-01）

- **ARCH-L1 scope lock**：Phase 2 只能改 `functions/utils/cookies.ts`、`functions/utils/device-id.ts` + 對應 plan gate-log。
- **ARCH-L2 anti-scope lock**：不得納入 `game/login.ts`、session/token、admin、`requireRole.ts`、`auth.ts`、oauth、audit。
- **ARCH-L3 behavior lock**：不得改 runtime branch、cookie 字串格式、cookie name、device-id storage key、UUID 生成 fallback、read/write 順序。
- **ARCH-L4 byte-identical lock**：Phase 2 **必重跑** esbuild byte-identical；兩檔 sha 必與 base 對齊，否則不得進 code approval（禁只引 Phase 1 spike）。
- **ARCH-L5 tsc lock**：Phase 2 **必重跑** forced tsc；目標 `566→558` / REMOVED=8 / ADDED=0 / 兩檔殘留 0。
- **ARCH-L6 import/contract lock**：不新增 export、不新增 named adapter type、不引入新 dependency、不改任何 caller。
- **ARCH-L7 cleanup lock**：`CLEANUP_PLAN.md` 禁 stage/commit。
- **ARCH-L8 dormant lock**：audit/archive/R2/retention/F-3 derive 檔維持 untouched。

## 型別依據（why these types）

- **cookies.ts**：無 env / 無 D1 / 無 partial-fake-env test caller → 純 primitive + `Request` 標註。
  - `refreshCookie(token: string, maxAgeSec: number)`：`token` 進 `COOKIE_BASE.replace('%TOKEN%', token)`（string）、`maxAgeSec` 進 `Max-Age=${maxAgeSec}`（number）。
  - `isWebClient(request: Request, …)`：`request.headers.get('Origin')`；`{ platform }` 已標故不動。
  - `readOAuthDeviceCookie(request: Request)`：`request.headers.get('cookie')`。
- **device-id.ts**：純瀏覽器 uuid 邏輯、DI-options（params 是 function、非 handler-context、非 D1 row-map）。型別由 `tests/device-id.test.ts` 實際傳入 shape 反推：
  - `read: () => string | null`（test：`() => store.val`、`() => { throw }`）
  - `write: (v: string) => void`（test：`(v) => { store.val = v }`）
  - `makeUuid: () => string | null`（test：`vi.fn(() => 'x')` / `() => VALID_UUID` / `() => null` / `() => { throw }`）
  - `safeCall<T>(fn: () => T): T | null`：3 call site（`safeCall(read)` / `safeCall(makeUuid)` / `safeCall(() => write(fullUuid))`），generic 保各 site 回傳型別。

## dual-leaf / cascade 分析

- 8 錯全 **7xxx（noImplicitAny-dependent）→ 只在 functions-leaf（noImplicitAny:true）報 → 現 566 無 doubling**。
- **cookies.ts**：無 test-partial-env caller、caller 皆傳 real `string`/`number`/`Request` → 標註不引入 tests-leaf 真型別錯。
- **device-id.ts**：`tests/device-id.test.ts` 為 unit test（tests-leaf noImplicitAny:false）；inline options / generic 與 test 傳入 adapter（含 `vi.fn`）assignable → 無 tests-leaf TS2345 cascade。
- **結論**：ADDED=0（下方 spike 實證）；非 ecpay narrow-literal TS2345 陷阱、非 revocation `jti` null-union 情境（那些屬後續 session-token 棒）。
- **import-graph（ARCH-L6 / 匯出回傳收斂前提實證，全 repo grep @ `0195c266`）**：
  - `pickOrMakeDeviceUuid` **唯一 consumer = `tests/device-id.test.ts`**（functions/public/scripts 皆無 production caller）→ 匯出回傳 inferred any→`string|null` 收斂**非破壞**（唯一 consumer 為 unit test、`.toBe/.toBeNull` 值斷言）。
  - `refreshCookie`/`isWebClient`/`readOAuthDeviceCookie` 共 **8 production caller**（`login-verify:307/301`·`refresh:401`·`callback:427/492`·`token:44/51/221`·`bind-email:235/247`·`register:234/240`·`2fa/verify:218/224`·`local/login:283/289`）+ `tests/cookies.test.ts` 單測；全傳 `string`/`number`/`Request`/`any` → 皆 assignable 新 param 型別（spike 全域 ADDED=0〔含 tests-leaf〕實證零 caller cascade；caller 檔本身仍在 defer 桶、本 PR 不改）。

## 驗證 receipts（read-only spike @ `0195c266`，已 `git checkout --` 還原、零殘留）

| 指標 | 結果 |
|---|---|
| forced tsc（`tsc -b tsconfig.solution.json --force`） | **566 → 558**；REMOVED=8 / **ADDED=0**（comm 全域無新錯行） |
| cookies.ts / device-id.ts 殘留錯 | **0** |
| byte-identical（esbuild `--loader=ts --format=esm` stdin、Git Bash） | `cookies.ts` base==work `1246B` sha `ddb3d30b8015766c…`（stderr 0）✓；`device-id.ts` base==work `468B` sha `f405680a4528d7cf…`（stderr 0）✓ |
| ratchet（projected；Phase 2 機械層實測） | errorCount 558 / errorFiles 41 / cleanFiles 294 |

## Non-goals（明列不做）

- 不改任何 runtime 行為 / cookie 屬性（Secure/HttpOnly/SameSite/Domain/Path/Max-Age）/ device-id 正規表 / fallback。
- 不動 `game/login.ts`、session-token（revocation/backchannel/logout/refresh/devices/devices-logout）、admin、requireRole、auth、oauth、audit。
- 不新增 package / lockfile / dependency；不抽 named type；不碰 `types/env.d.ts`（本 2 檔無 env）。
- 不 `--update` ratchet baseline；不碰 `CLEANUP_PLAN.md`。

## Acceptance Criteria

1. forced tsc：cookies.ts + device-id.ts = 0 錯、全域 REMOVED=8 / ADDED=0（558）。
2. byte-identical 2/2（esbuild sha 相符、stderr 空、bytes>0）。
3. ratchet 558 / 41 / 294（不 `--update`）。
4. 既有 unit test `tests/device-id.test.ts` 綠、merge-front 7 gates 全綠（lint / typecheck:ratchet / verify:browser-pipeline / test:cov / test:int / build:functions / npm audit）。
5. diff 僅本 2 source + gate-log；`CLEANUP_PLAN.md` 未入。

## 誠實邊界 / caveat

- **security-adjacent 但零行為變更**：`refreshCookie`（組 refresh cookie 字串、含 Secure/HttpOnly/SameSite=None）與 `isWebClient`（決定 refresh_token 走 HttpOnly cookie vs body 的 security 判定）屬安全敏感面；本 PR 純加型別 annotation，**byte-identical esbuild sha 相符即零 runtime/bytecode 變更之硬證**（非推斷）。
- **byte-identical 前提**：兩檔皆**無 import**，esbuild stdin transform 為單檔完整驗證（非 partial）。
- **後續棒依賴**：本棒不解 misc 其餘 leaf 53 錯（session-token 35〔revocation8+backchannel5+logout6+refresh6+devices5+devices-logout5〕/ admin 15 / game 3 = 53；requireRole 12 + auth 7 殿後另計）。核算 misc 80 = 本棒 8 + 其餘 leaf 53 + 殿後 19；leaf 群完整 map 見 scout finding。

## Dual Gate v3.1 軌跡

1. **Phase 0**：SPEC owner **LOCKED**（scout finding → owner + option 1 拍板 SC-1..SC-4；2026-07-01）。
2. **維度 A plan** self-review（L2 multi-agent workflow `wf_55499c4b-095`、19 agents、7 finder → 對抗 verify → 主線裁決）→ **accepted 2 真缺陷**（L10 error-code `×6/×2→×5/×3`、L101 caveat `34→35` + 帳目恆等式）+ 主線 round-2 補 1 nit（Non-goals devices-logout）→ **一輪 0 新發現** → `PLAN_SELF_REVIEW_CLEAN`。
3. **① ChatGPT Architecture** `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（+ARCH-L1..L8；split/scope/SSOT/契約/rollback 全 APPROVED；byte-identical+tsc Phase 2 必重跑；import-graph 交 Codex 複核）。
4. **② Codex Plan** `CODEX_PLAN_APPROVED`（獨立 scratch-replay @ `C:\tmp`：anchor `0195c266` / frozen diff 5/5 唯一命中〔cookies +3/-3、device-id +2/-2〕/ forced tsc 566→558 REMOVED=8 ADDED=0 殘留 0 / ratchet 558·41·294 / byte-identical sha 相符 bytes 1246·468 stderr 0 / import-graph `pickOrMakeDeviceUuid` prod caller=0；no blocking）。
5. **CODING_ALLOWED**（owner 2026-07-01）→ branch `refactor/stage7-pr2dh-cookies-deviceid-noimplicitany` @ `0195c266` → source commit **`96f12a9a`**（5 edit、net diff = frozen diff 逐字）。
6. **機械層 9/9 全綠**（ARCH-L4/L5 重跑、不沿用 spike）：forced tsc 566→558 / REMOVED=8 / ADDED=0 / 殘留 0 · byte-identical 2/2〔cookies `ddb3d30b…c07ef38` · device-id `f405680a…7ce17d3` · stderr 0〕· ratchet 558/41/294 · lint · build:functions · verify:browser-pipeline · test:cov 737/90.28% · **test:int 75f/1328** · npm audit 0。
7. **維度 A code** self-review（L2 workflow `wf_a7868934-926`、19 agents、7 finder → 對抗 verify）→ **11 findings 全 refuted**（0 accepted / 0 suspicious）：3 contract-enum〔caller cascade / return 收斂 / dual-leaf〕經 ratchet+import-graph 否證、naming-ssot 3〔randomUuid doc-alias〈pre-existing 未改、out-of-scope〉/ maxAgeSec≠maxAgeSeconds / `Request` 為正確最小型別〉、race/idempotency/async/regression-lock 皆 type-only N/A（workflow 獨立重跑 esbuild byte-identical 佐證）。主線親讀真碼裁決認同全 refute → `CODE_SELF_REVIEW_CLEAN`。
8. **③ Codex Code** `CODEX_CODE_APPROVED`（獨立驗：2 source +5/-5、gate-log docs-only、forced tsc 566→558/REMOVED=8/ADDED=0、byte-identical sha 相符、ratchet/lint/build/browser/test:cov/**test:int 75f/1328** 全過、no escape hatch；npm audit external-registry 被拒未重跑、無 dep 變更故非 blocker）。
9. **④ ChatGPT Faithfulness** `CHATGPT_CODE_FAITHFULNESS_APPROVED`（SC-1..4 + ARCH-L1..8 全 PASS、無 scope creep、無漏 hunk〔2 code 皆附、gate-log 為 docs〕、security-adjacent byte-identical 充分）。
10. **MERGE_ALLOWED**（owner 2026-07-01）→ push + PR + squash-merge。
