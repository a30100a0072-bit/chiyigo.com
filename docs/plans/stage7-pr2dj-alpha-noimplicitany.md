# Stage 7 PR-2dj α — noImplicitAny 續清（misc leaf α cluster：revoke + devices + devices/logout）

**狀態**：SHIPPED（squash-merge to main）｜**gate-log 永久記錄**（4 道外部審查軌跡）
**base**：`bf1a9bdb`（origin/main）｜**source commit**：`219c2dae`
**性質**：純 type-only noImplicitAny 標註（13 → 0）、byte-identical emit 3/3、零 runtime / 零 schema/API/migration。

---

## 1. Scope 與 locks

**SCOPE-1**：僅 3 source
- `functions/api/admin/revoke.ts`（admin token revoke：mode jti/user/device、requireRole/actorOutranksTarget/audit-chain/session-family revoke）
- `functions/api/auth/devices.ts`（GET device list、read-only）
- `functions/api/auth/devices/logout.ts`（self-service multi-family session revoke、integrity fail-closed）

**13 noImplicitAny → 0**：TS7031×10（handler-ctx destructure）+ TS7006×3（row-map callback）。

**Edit locks**：EDIT-1 handler-ctx `{ request, env }: { request: Request; env: Env }`（×5）｜EDIT-2 row-map `(r: Record<string, unknown>)`（×3）｜EDIT-3 `Env` ambient、禁 import。
**Block locks**：BLOCK-1 禁 env.d.ts｜BLOCK-2 禁 helper/cookie/shared-logic 抽取｜BLOCK-3 禁改 test｜BLOCK-4 禁 β(logout/refresh)·γ(backchannel/revocation)｜BLOCK-5 禁 jti OD（`string | null | undefined` 屬 γ/PR-2dl）。
**ARCH locks（① ChatGPT Arch）**：L1 3 檔｜L2 2 edit 形式｜L3 Env ambient 無 import｜L4 禁 env.d.ts/tests/helper/cookie/shared｜L5 禁 β/γ（`auth/logout.ts` ≠ `auth/devices/logout.ts`）｜L6 禁 jti OD｜L7 Code Gate 重證 tsc｜L8 packet 附 byte-identical + name-status。

## 2. Edit matrix（8 edit）

| # | file:line | cleared | form |
|---|---|---|---|
| 1 | admin/revoke.ts:49 | TS7031×2 | `onRequestPost({ request, env }: { request: Request; env: Env })` |
| 2 | admin/revoke.ts:169 | TS7006×1 | `.map((r: Record<string, unknown>) => String(r.ref))` |
| 3 | devices.ts:36 | TS7031×2 | `onRequestOptions({ request, env }: { request: Request; env: Env })` |
| 4 | devices.ts:40 | TS7031×2 | `onRequestGet({ request, env }: { request: Request; env: Env })` |
| 5 | devices.ts:63 | TS7006×1 | `.map((r: Record<string, unknown>) => ({` |
| 6 | devices/logout.ts:31 | TS7031×2 | `onRequestOptions({ request, env }: { request: Request; env: Env })` |
| 7 | devices/logout.ts:35 | TS7031×2 | `onRequestPost({ request, env }: { request: Request; env: Env })` |
| 8 | devices/logout.ts:74 | TS7006×1 | `.map((r: Record<string, unknown>) => String(r.ref))` |

SSOT：handler-ctx 對齊 82 shipped siblings；row-map 對齊 10 shipped D4（`String(r.ref)`/object-literal/`Number(… ?? 0)` → `res(data: unknown)`，`noPropertyAccessFromIndexSignature` OFF、免 call-site cast）。

## 3. 證據（EVIDENCE-1/2/3）

- **forced tsc** `tsc -b tsconfig.solution.json --force`：**543 → 530**、REMOVED=13（恰 8 標註點）、**ADDED=0**（set-diff、非算術）。errorFiles 38→35、cleanFiles 297→300。baseline `1119/175` frozen（未 --update）。
- **byte-identical**（canonical `esbuild --loader=ts --format=esm` stdin、非空）：3/3 MATCH — revoke `cdce3ac9dc7ba014`/7167 · devices `c59d6313c8231d12`/1366 · devices/logout `fe8961b7738e70d2`/4080。
- **name-status**：僅 3 source。numstat 2/2·3/3·3/3。

**dual-leaf assignable**：3 handler 唯一 type-level importer 皆 integration test（admin-revoke / devices / session-revoke-multi），傳 `cloudflare:test` env=`ProvidedEnv extends Env`（`env.d.ts:112-115`）assignable；無 production cross-import；無 ecpay narrow-literal TS2345 陷阱。
**F-3 DORMANT-safe**：3 檔 0 命中 archive/R2/retention/aggregate/checkpoint；`safeUserAudit` transitive cold_class feed args byte-identical → dormant 未改未 invoke。

## 4. 本地機械 gate（全綠、實跑）

`typecheck:ratchet` OK（530）· `lint` 0 · `verify:browser-pipeline` 0（25 pages ?v= governance OK）· `test:cov` 737 passed / 90.28%（1933/2141）· `test:int` 75 files / 1328 passed（無 flake）· `build:functions` OK · `npm audit --omit=dev --audit-level=high` 0 vuln。

## 5. Dual Gate v3.1 — 4 道外部審查全過

- **① ChatGPT Architecture** `CHATGPT_ARCH_APPROVED_WITH_LOCKS`：0 blocking / 0 required / 2 NB / ARCH-L1..L8。pattern SSOT / scope / 安全契約（byte-identical 足作 Tier-0-adjacent 零行為保證）/ F-3 / dual-leaf 全 PASS。
- **② Codex Plan** `CODEX_PLAN_APPROVED`：隔離 temp clone replay — BASE=543/OVERLAY=530/REMOVED=13/ADDED=0/residual 0/name-status 3 檔/byte-identical 3/3/import-graph/D4/dormant 全 held。NB：packet diff 應附 `git apply`-able 全 diff（Code packet 已改附 -U3）。
- **③ Codex Code** `CODEX_CODE_APPROVED`：0 blocking。live @`219c2dae`：patch byte-matches `git diff -U3`（reverse + `--3way` apply OK）、no escape hatch、committed esbuild byte-identical 3/3、forced tsc 543→530/ADDED=0、gates rerun 綠。risk findings 全 None。npm audit external-registry escalation 被拒未重跑（package.json/lock 未改 → 非 blocker）。
- **④ ChatGPT Faithfulness** `CHATGPT_CODE_FAITHFULNESS_APPROVED`：faithfulness matrix 全 ✓、0 有改動未附 hunk、0 scope creep、0 β/γ、0 jti OD、0 可信 Tier0/1 side-finding。NB-1 npm audit 未重跑非 blocker。

**維度 A self-review（內部放大器、非取代外部）**：
- PLAN（L3、3 readonly-reviewer：plan-faithfulness / type-cascade / security-scope）→ 全 CLEAN 0；type-cascade 隔離 base 重建 set-diff ADDED=0。
- CODE（L3、3 readonly-reviewer：diff-fidelity / runtime-security / evidence）→ 全 CLEAN 0；committed-blob byte-identical 3/3、`typecheck-baseline.json` 未動、broadened `\bany\b` 掃空。
- 主線親裁（非採 raw）：兩階段各一輪 0 新發現。

## 6. OD 狀態
α **零新型別 OD**。唯一 OD＝jti null-union（`isJtiRevoked`/`revokeJti`/`consumeJtiOnce`）已 owner 裁 **`string | null | undefined`**（以 runtime guard + `revocation.test.ts:111/113` 契約測試為 SoT、JSDoc `@param {string}` 標「文件落後於契約」不反壓型別）→ **屬 γ/PR-2dl，本棒 BLOCK-5 明禁未碰**。

## 7. 非 blocking notes（後續注意）
- **NB-1**（ChatGPT Arch）：`devices.ts` row-map 物件屬性保留 `unknown` 流向（下游 `res(data: unknown)` 可接受）、本棒不補 DTO。
- **NB-2**（ChatGPT Arch）：cold_class 論證前提＝byte-identical + name-status 反查（Code/Faithfulness packet 已保）。
- **NB（Codex Plan）**：packet diff 用 `git apply`-able 全 diff（-U0 零 context fragile → 改 -U3）。

## 8. 後續棒次（misc leaf 續清）
- **PR-2dk β**：`auth/logout.ts` + `auth/refresh.ts`（12、handler-ctx + parseCookieHeader dup）。
- **PR-2dl γ**：`utils/backchannel.ts` + `utils/revocation.ts`（13、util params + **jti OD `string | null | undefined`**）。
- 之後：requireRole 12（TS7053）· auth 7（TS7018）· oauth 105 · audit 381（含 F-3 DORMANT）。
