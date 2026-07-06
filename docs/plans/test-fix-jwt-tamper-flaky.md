# Test-fix — `tests/jwt.test.ts` flaky「rejects tampered token」確定性化

**目標**：把 `tests/jwt.test.ts` 的 `it('rejects tampered token')`（~1.6%/run flaky）改為**確定性**。**test-integrity fix**（非 noImplicitAny / reduce lane）。
**base**：`3d72bec6`（origin/main, PR-2dl γ #137）｜**性質**：L1；純 test 檔**單一測例**；**零 production / 零 runtime / 零 schema·API·migration**。
**流程**：走完整 Dual Gate v3.1 四道外部審查（① ChatGPT Arch ② Codex Plan ③ Codex Code ④ ChatGPT faithfulness）。

> 插隊動機：此 flaky 已第 3 次撞 main-push CI（`jwt.test.ts:34:42`「promise resolved instead of rejecting」），先於 requireRole 續清處理。

---

## 1. Root cause（對碼 + 量化 + 隔離三重坐實）

現行 `tests/jwt.test.ts:33`（@ base `3d72bec6`）：
```ts
const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A') + token.slice(-1)
```
- 此式**替換倒數第 2 字元**（`slice(0,-2) + X + slice(-1)`），但**替換值 `X` 由最後一字元決定**（`endsWith('A')`）。兩者巧合時 `X === 倒數第2字元` → no-op → `tampered === token` → `verifyJwt` 驗到**未竄改的原 token** 而 resolve → `:34 .rejects.toThrow()` 失敗。
- **量化**：純 Node 200k 忠實模擬（`crypto.randomBytes(64)`→base64url，等價 ES256 簽章尾端分佈）→ OLD no-op **1.562%** ≈ 1/64；末字元集合實測 `{A,Q,g,w}`（僅 2 有效 bit），倒數第 2 字元 distinct=64（全 6-bit 均勻）。Codex 獨立 replay：OLD `3119/200000`、NEW `0/200000`。
- **隔離**：`grep` 全 `tests/` → 此 buggy pattern **僅 `jwt.test.ts:33` 一處**（其餘 `endsWith` 皆合法字尾斷言；其餘 `tamper` 字樣屬 audit-log / domain-events / factor-add 等無關 domain）。
- **拒絕路徑**：`functions/utils/jwt.ts:159-182` — tamper 第 3 段簽章 → header/payload 逐 byte 不變 → `decodeProtectedHeader` 成功、kid 命中、aud/iss 符 → 唯一失敗點 = `jwtVerify` ECDSA 簽章驗證 throw `JWSSignatureVerificationFailed`。**root cause 屬 test tamper 邏輯，非 `verifyJwt` runtime**。

## 2. 改動（`EXACT_DIFF_LOCK`；owner 裁定 exact shape，OD-1 = Option A）

`tests/jwt.test.ts` `it('rejects tampered token')`：
```diff
   it('rejects tampered token', async () => {
     const token = await signJwt({ sub: 'x' }, '5m', env)
-    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A') + token.slice(-1)
+    // 依「實際被替換的字元」決定替換值，確保 tampered !== token 恆成立、消除 no-op。
+    // 舊碼替換值取決於 token.endsWith('A')（最後一字元）卻替換「倒數第 2 字元」，兩者巧合時
+    // 變 no-op → verifyJwt 驗到未竄改的原 token 而 resolve → ~1.6% flaky。
+    // 取倒數第 2（非最後一）：ES256 簽章最後一 base64url 字元只帶 2 有效 bit（尾字元 ∈ {A,Q,g,w}），
+    // 改它可能因 padding bit 對齊而解出相同 bytes（另一種潛在 no-op）；倒數第 2 為全 6-bit、改必變。
+    const penultimate = token.slice(-2, -1)
+    const tampered =
+      token.slice(0, -2) + (penultimate === 'A' ? 'B' : 'A') + token.slice(-1)
+
+    expect(tampered).not.toBe(token)
     await expect(verifyJwt(tampered, env)).rejects.toThrow()
   })
```

**為何恆正確（case 全舉）**：`r = penultimate==='A' ? 'B' : 'A'` → penult=='A'→'B'≠'A'；penult≠'A'→'A'≠penult。∴ 對所有 penult 值 `r ≠ penult` → `tampered !== token` 恆真；penult = 簽章 byte 63 有效 bit → decode bytes 必變 → ECDSA 驗證必失敗 → 恆 reject。tamper 內**無 RNG**。

## 3. Locks（SPEC + ChatGPT Arch 累積，共 9）
| Lock | 落地 |
|---|---|
| `EXACT_DIFF_LOCK` | tamper 片段逐字等同 owner 裁定 shape；`git diff` 已驗 |
| `SCOPE_LOCK` | 僅 `tests/jwt.test.ts` 該測例（+ 本 companion doc） |
| `NO_PROD_CHANGE_LOCK` | `functions/utils/jwt.ts` + 任何 runtime/auth 全不動 |
| `NO_TEST_SWEEP_LOCK` | 僅該 1 測例；無其他同型 flaky 掃入 |
| `PENULTIMATE_LOCK` | 只改倒數第 2 字元；`token.slice(-1)` 最後字元原封 |
| `ASSERTION_LOCK` | 新增 `expect(tampered).not.toBe(token)` |
| `NO_RATCHET_UPDATE_LOCK` | 不 `--update` baseline；ratchet 數字不變 |
| `COMMENT_BOUNDARY_LOCK` | comment 僅解釋 no-op / base64url padding，無測試政策 / broader claim |
| `GATE_LOCK` | 逐 gate 授權；SPEC/Plan approval ≠ coding/commit/merge |

## 4. 不碰（byte-identical 行為邊界）
- `functions/utils/jwt.ts` 及任何 runtime/auth code 不動。
- `jwt.test.ts` 其餘 19 測例、其他 test 檔不動；imports 不動。
- `token.slice(-1)`（最後一字元）不動。

## 5. 機械 gate（CODE stage @ working tree，直接跑讀真實輸出）
| Gate | 結果 |
|---|---|
| `git diff` exact shape | ✅ 逐字合規（EXACT_DIFF / PENULTIMATE / ASSERTION lock） |
| vitest 單跑 `tests/jwt.test.ts` | ✅ 20 passed |
| **迴圈 50× 全檔** | ✅ **0 failures**（每次 fresh keypair/簽章） |
| `typecheck:ratchet:report` | ✅ **505 / 31 / 304 不變**（`slice` 回 string、0 新 tsc error；未 --update） |
| `lint` | ✅ green（eslint functions tests + compat-date + workflows） |
| `build:functions` | ✅ Compiled Worker successfully |
| `npm audit --omit=dev --audit-level=high` | ✅ 0 vulnerabilities（deps 未改） |
| `test:cov` | ✅ 90.28%（1933/2141）+ unit **737/737** passed |
| `test:int` | ✅ **1328/1328**（75 檔，544s；crash 字樣為故意 error-path 測例 log） |
| 200k 機制 sim | ✅ OLD 1.562% / NEW 0（Codex replay 3119 / 0） |

## 6. 維度 A self-review（L1 單 agent 對抗式；主線親裁不採 raw）
- **獨立 readonly-reviewer**（第二眼）：6 對抗任務（diff 吻合 / 簽章拒絕理由正確 / 無 no-op 反例 / 語意未弱化 / scope·lock / comment boundary）全 **PASS**；總裁決 **SHIP-CLEAN**。補精度：倒數第 2 字元 = 簽章 byte 63 有效 bit。
- **主線親裁**：reviewer findings 與主線 50× 迴圈 + 200k sim + git diff 一致；`tampered!==token` 恆真為靜態可證、`not.toBe` 鎖 no-op regression（舊邏輯下 1.6% 紅、確定性 no-op 下 100% 紅，符 [[feedback_regression_test_must_lock_exact_failure]] exact-failure 鎖）。**一輪 0 新發現** → `CODE_SELF_REVIEW_CLEAN`。

## 7. 風險
- **regression lock 非 deterministic pre-fix fail**（flaky-fix 特性）：一般規則要求 pre-fix 必紅，此為機率性（1.6%）。**接受此例外**——exact-failure 鎖 = 邏輯保證（case 全舉）+ `not.toBe` invariant + 200k sim + Codex 獨立 replay，非單次 pre-fix run（回應 SPEC 風險表「模擬非唯一證明」）。
- **零行為風險**：純 test 檔；prod / runtime / schema 零改；ratchet 不變。

## 8. Gate trail（Dual Gate v3.1）
- `SPEC_APPROVED_WITH_LOCKS`（owner；OD-1 = Option A：改倒數第 2 字元 + 替換值依倒數第 2 字元決定）。
- ① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`：root cause 成立 / 修法正確 / 測試語意保留 / production 零 runtime diff / ratchet 不變。新增 `EXACT_DIFF_LOCK` · `NO_RATCHET_UPDATE_LOCK` · `COMMENT_BOUNDARY_LOCK`。
- ② `CODEX_PLAN_APPROVED`：no material findings；三提問全 Yes；獨立 replay（HEAD `3d72bec6`、grep 僅 `:33`、jwt.ts:159 jose 拒絕、ratchet 505/31/304）。residual「pin companion doc 路徑」→ 本檔 `docs/plans/test-fix-jwt-tamper-flaky.md`（已閉）。
- `CODE_SELF_REVIEW_CLEAN`（維度 A，見 §6）。
- ③ `CODEX_CODE`：⏳ 待送。
- ④ `CHATGPT_CODE_FAITHFULNESS`：⏳ 待送。
- `MERGE_ALLOWED` / squash-merge：待 owner 明示。

## 9. 流程定位
- test-integrity fix → full 四道外部審查 + L1 單 agent 對抗式 self-review。
- merge：squash-merge、**owner 明示同意後**才執行；merge 後監看 CI + Deploy（無 prod 行為變更、smoke 為 deploy 健康確認）。
- final scope（`git diff --name-status`）：`M tests/jwt.test.ts` + `A docs/plans/test-fix-jwt-tamper-flaky.md`（2 檔）。
