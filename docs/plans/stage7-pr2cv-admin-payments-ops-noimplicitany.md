# Stage 7 reduce PR-2cv — `admin/payments/{aggregate,webhook-dlq,metadata-archive}.ts` noImplicitAny（**payments 域 admin-ops 三檔 batch / single-file（非 Path A）**；type-only、review care **L2**）

**目標**：admin payments 觀測/對帳三個 read endpoint 的 **13 個 noImplicitAny error → 0**，**純 type-only**。env typing 不掀 `Env` 缺口（三檔 `env` 存取僅 `env.chiyigo_db`〔已宣告〕+ 整包 forward util）→ scope ＝ **single-file（3 source 檔，無 env.d.ts 變更、非 Path A）**。

| 檔 | 現狀 err | 編輯點 | 變更性質 |
|---|---|---|---|
| `functions/api/admin/payments/aggregate.ts` | 5（4×TS7031 handler ctx + 1×TS7006 `r` 投影 callback）| **3 行改 + 1 行增**（L26 / L30 / L94 簽名 + L93.5 `type MainRow`）| handler ctx annotation + D1-row `.map` callback typed cast（mirror 同檔既有 `RefundRow` 先例）|
| `functions/api/admin/payments/webhook-dlq.ts` | 4（4×TS7031 handler ctx）| **2 行改**（L23 / L27 簽名）| handler ctx annotation（純 Convention A）|
| `functions/api/admin/payments/metadata-archive.ts` | 4（4×TS7031 handler ctx）| **2 行改**（L23 / L27 簽名）| handler ctx annotation（純 Convention A）|

本 PR ＝ payments 大熱區續清（接 PR-2cq #115 `[id].ts`、PR-2cr #116 `intents.ts` list、PR-2cs #117 `payment-return/ecpay.ts`、PR-2ct #118 `mock.ts`、PR-2cu #119 `checkout/ecpay.ts`）。與前五棒差異：**本批是 admin 觀測/對帳 read endpoint（無金流寫入路徑、無 redirect、純讀 + critical audit）** → review care **L2**（admin-gated；webhook-dlq + metadata-archive 帶 step-up `elevated:payment` + PII〔raw_body / original_metadata〕read audit）。完整 Dual Gate v3.1 四道外部審查、不降級。

## ⚠️ 為何 single-file（非 Path A）— spike 實證

**owner SPEC_APPROVED（2026-06-27）＝選項 A（admin-ops 三檔 batch）+ aggregate MainRow cast**。Claude **non-commit full-solution spike** 證明 single-file（只標 3 source、不補 env.d.ts）即可淨降、零 cascade：

- 三檔 `env` 存取**僅 `env.chiyigo_db`**（D1 binding，`types/env.d.ts:23` 已宣告）+ 整包 forward 給 `getCorsHeaders`/`requireStepUp`/`requireAnyScope`/`safeUserAudit`/`effectiveScopesFromJwt`（後者取 `user` 非 `env`）。**無任何 exotic / 未宣告 env key 存取** → 標 `env: Env` **不掀 TS2339**（與 PR-2cu `checkout/ecpay.ts` 存取未宣告 `ECPAY_*_URL`、被迫 Path A 不同）。
- spike 實測（套 3 source annotation，**不**改 env.d.ts）：forced full-solution `tsc -b tsconfig.solution.json --force` total **783 → 770（恰 −13）**、三檔殘留 **0 error**、全 leaf sort-diff **REMOVED=13 / ADDED=0（零 cascade，含 payment 域與全樹）**。
- → **無 Env 缺口、無需 Path A、source 改動 = 3 檔**。

## base 錨點（current main，非 stale）

- **base ＝ current main `745019ab`**（`git rev-parse HEAD` 實證 `745019ab…`、`origin/main == HEAD == branch tip` 一致、working tree clean〔僅 `?? CLEANUP_PLAN.md` untracked〕）。
- 此即 PR-2cu #119 `745019ab`（`checkout/ecpay.ts` Path A）squash commit；owner prompt base 與實查一致、**無 stale 修正**。
- branch `refactor/stage7-pr2cv-admin-payments-ops-noimplicitany`（自 clean main `745019ab` 開、未 push）。
- base source blobs：aggregate `1a09ace8`、webhook-dlq `4521cf3a`、metadata-archive `f7e442c4`；plan-only commit 後 `HEAD:src` 三 blob 仍須 == base（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）。

## annotation 形式裁定（沿 Convention A function-declaration + inline param type）

三檔唯一允許落地的 source diff（共 7 改 + 1 增）：

```ts
// aggregate.ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {  // L26
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {       // L30
  type MainRow = { bucket: string; count: number; sum_subunit: number }                      // L93.5 新增
  const buckets = ((main.results ?? []) as MainRow[]).map(r => ({                             // L94 改

// webhook-dlq.ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {  // L23
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {       // L27

// metadata-archive.ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {  // L23
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {       // L27
```

- **正式 frozen form ＝ function-declaration ＋ inline param type**（沿 PR-2cp..2cu 既定）；**禁** arrow const、named ctx type alias、拆多行、加 return type。
- handler ctx ＝ **full Convention A `{ request: Request; env: Env }`**（六 handler 皆 destructure `{ request, env }`、實讀 `env.chiyigo_db` + 整包 forward env → 用 full `Env`，**非** `Pick`、**非** `CfRequest`〔無 `.cf` 存取〕）。
- aggregate `r` callback ＝ **`MainRow` cast**（mirror 同檔 L90 既有 `RefundRow` 先例：cast `as MainRow[]`、type 宣告緊鄰唯一使用點）；**禁** `Record<string, unknown>`（spike 證會在 L98/99 掀 TS2345，見 §OD ruling）、**禁** annotate callback param、**禁** 改 callback body。

## OD ruling（型別選型，對抗式驗證）

| 決策點 | 裁示 | 理由 |
|---|---|---|
| handler `request`（六處）| **`Request`（plain）** | 三檔僅 `getCorsHeaders(request,…)` + `new URL(request.url)` + 傳 `request` 給 `requireStepUp`/`requireAnyScope`/`safeUserAudit`；**無 `.cf` 存取** → 非 `CfRequest` |
| handler `env`（六處）| **`Env`（full）** | 六 handler 實讀 `env.chiyigo_db` 並**整包 forward** 給 util（getCorsHeaders/requireStepUp/requireAnyScope/safeUserAudit）→ 需 full Env；**Pick 否決**（forward 面要 full、窄 Pick 會 cascade）|
| aggregate `r`（L94 `.map`）| **`MainRow` cast `((main.results ?? []) as MainRow[])`** | `main.results` 源自 `env.chiyigo_db.prepare(...).all()`（D1 `.all()` 解為 any → `.results` any → callback `r` 無 contextual type TS7006）。type ＝ main query 三投影欄（`bucket`/`count`/`sum_subunit`）；**mirror 同檔 L90 `RefundRow` cast 先例**（架構一致、非新範式）|
| `Record<string, unknown>`（**否決**）| **禁** | spike 實證：`r: Record<string,unknown>` → `r.bucket` 為 `unknown` → L98/99 `refundMap.get(r.bucket)`（`Map<string,RefundRow>.get` 期望 `string`）掀 **TS2345 ×2**（dual-leaf ×2 = 4 error-line）→ **新增 error**、淨值不降 |
| `CfRequest`（**否決**）| **禁** | 三檔無 `.cf` 存取 |
| `Pick<Env,…>`（**否決**）| **禁** | env 整包 forward、需 full Env |
| arrow const / return type / annotate callback param / JSDoc / 格式（**否決**）| **不改** | 沿 lock，只處理 noImplicitAny 13 錯 |

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（mechanical type-only、7 改 + 1 增）/ review care **L2**（**admin 觀測/對帳 read endpoint**：webhook-dlq + metadata-archive 帶 step-up `elevated:payment` + critical PII read audit〔raw_body 含 ECPay payload、original_metadata 含 user 個資〕；aggregate 為對帳 read〔admin:payments scope〕。**無金流寫入、無 redirect、純讀 + type-only byte-identical 不改 PII gate 行為**）。**完整 Dual Gate v3.1 四道外部審查、不降級**。
- **self-review ＝ multi-agent workflow（payments 熱區、不降單 agent；[[feedback_self_review_form_not_downgradable_by_spike]]）**。rubric **收斂 scope-fidelity / runtime-security / evidence-integrity 三維、不擴全域**（不碰任何排除檔、不碰 runtime 紅線、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` agent**（無 model pin → 繼承 session model Opus 4.8，[[feedback_selfreview_workflow_model_inheritance]]；options `__proto__:null` no-haiku 機械保證；**非機械安全邊界、持 Bash、read-only 屬 best-effort**）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner 2026-06-27「照你推薦跑」：候選＝admin-ops 三檔 batch（aggregate+webhook-dlq+metadata-archive）；OD ＝ handler `{request:Request;env:Env}` + aggregate **MainRow cast**（非 `Record<string,unknown>`）；single-file（spike 證無 Env 缺口、非 Path A）；self-review ＝ multi-agent workflow（不降）；**禁** `CfRequest`/`Pick`/arrow const/return type/碰排除檔。
  - ✅ Claude scout（read-only @ `745019ab`）→ 逐檔 error set（13 錯：aggregate 5 / webhook-dlq 4 / metadata-archive 4）+ caller cascade（三 handler ＝ Pages entrypoint；direct importer ＝ `admin-payments.test.ts` direct-literal call）+ env 存取掃描（僅 `env.chiyigo_db`，無缺口）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 revert clean、blobs 回 base）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_6d11bd01-c0a`、3 readonly-reviewer finder 繼承 Opus〔scope-fidelity/runtime-security/evidence-integrity〕+ 對抗 verifier、`__proto__:null`；1 tier3 doc-label finding〔L-1 cell「2 ctx」→「4 ctx-err」〕主線裁決修正、runtime-security + evidence-integrity **0 findings**、一輪 0 新發現；見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B、2026-06-27、**0 blocker**、7 架構裁決全 APPROVED〔plain Request / full Env 非 Pick / MainRow cast mirror RefundRow / 禁 Record / single-file 非 Path A / type-only 需 Code 階段重證〕、binding **BL-1..BL-10**；見 §Gate 進程紀錄）→ ✅ `CODEX_PLAN_APPROVED`（② 維度 C、2026-06-27、**r1 `CHANGES_REQUESTED`〔唯一 blocker = packet evidence typo、0 source〕→ 修 → r2 `APPROVED`**、HEAD-independent anchor 零 false-reject；見 §Gate 進程紀錄）→ ⏳ owner `CODING_ALLOWED`（**待明示**）
  - ✅ Code 階段（owner `CODING_ALLOWED` 2026-06-27 → source commit `bf82640a` + plan whitespace strip `38530379` → full replay @ committed 全綠、不沿用 spike）→ ✅ `CODE_SELF_REVIEW_CLEAN`（維度 A workflow `wf_0d0a715b-3f3`、3 readonly-reviewer finder 繼承 Opus、三維 **全 0 findings**、主線獨立裁決；見 §Gate 進程紀錄）→ ⏳ `CODEX_CODE_APPROVED`（③、packet 待產/送）→ ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④）
  - ⬜ merge-front 7 gates → ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-27 Claude **scout（read-only @ `745019ab`）** → 13 錯（aggregate 5〔L26/L30 4×TS7031 ctx + L94 1×TS7006 `r`〕、webhook-dlq 4〔L23/L27 4×TS7031〕、metadata-archive 4〔L23/L27 4×TS7031〕）+ env 存取掃描（三檔僅 `env.chiyigo_db`、無未宣告 key → 無 Path A 風險）+ caller cascade（三 handler Pages entry；`admin-payments.test.ts` L21-23 direct import + L201/208/248 direct-literal call）。
- 2026-06-27 Claude **non-commit full-solution spike**（已 revert clean）→ single-file（3 source、不改 env.d.ts）證足：total **783→770**、三檔 0 殘留、sort-diff **REMOVED=13 / ADDED=0**、三檔 emit **byte-identical**、aggregate `MainRow` cast 乾淨（vs `Record<string,unknown>` 掀 TS2345 ×2 已否決）。frozen blobs：aggregate `1a09ace8→283746af`、webhook-dlq `4521cf3a→39bdc897`、metadata-archive `f7e442c4→1292b21f`。
- 2026-06-27 **plan self-review = multi-agent workflow（維度 A、run `wf_6d11bd01-c0a`、4 agents〔3 finder + 1 verifier〕/ 377246 subagent tokens / 53 tool uses；finder/verifier 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8`、`__proto__:null`）→ `PLAN_SELF_REVIEW_CLEAN`**：收斂三維。**runtime-security 0 findings、evidence-integrity 0 findings**（finder 獨立重現 base forced tsc 13 錯分佈、3 base emit sha〔2931/2217/1941B〕、ratchet 783/75/259、MainRow-clean vs Record-breaks-TS2345 推理，全對上、無 discrepancy）。**1 tier3 doc-label finding（scope-fidelity）**：L-1 lock cell 把 webhook-dlq/metadata-archive 寫「2 ctx」（混用 ctx error-count 與 sig-line-count；該兩檔各 4 ctx error）→ per-file tally 讀成 5+2+2=9、與同 cell「全 13 錯」矛盾。**主線獨立裁決（v3.1 §5、非採 raw）**：grep 全檔確認唯 L89 有 unit-conflation（top table L7-9 / scout L70·L81 / error inventory L143 皆正確 4/4）→ 修 L-1 為「4 ctx-err … 全 13 錯（5+4+4）」→ 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `745019ab`〔plan commit 前〕、3 source blob 未動〔1a09ace8/4521cf3a/f7e442c4〕、staged 空、`git diff 745019ab..HEAD -- functions/ types/` 空）。
- 2026-06-27 **plan doc commit `0606b29e`**（branch、local、未 push、plan-only +288 / 0 source；commit 後核 staged set 僅 plan doc、CLEANUP_PLAN.md 未 staged、net source diff base..HEAD 空、`HEAD:src` 三 blob == base `1a09ace8`/`4521cf3a`/`f7e442c4`）→ 中文報告 6 欄（gate-state `PLAN_SELF_REVIEW_CLEAN`）→ 產自足 **ChatGPT Arch packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cv-chatgpt-arch-packet.md`、repo 外、§2 HEAD-independent anchor + §3 frozen diff + §7 三檔 full base source）→ **待 owner 送外部 ①**。
- 2026-06-27 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 blocker / 0 required revision**）— 7 架構裁決全 **APPROVED**（`request:Request`〔無 `.cf`、不用 CfRequest〕/ `env:Env` full〔整包 forward、Pick 會擴散 util 契約〕/ `MainRow` cast〔對齊 main query 三欄、mirror 同檔 RefundRow〕/ 禁 `Record<string,unknown>`〔`r.bucket` 變 unknown 撞 `Map<string,RefundRow>.get` 契約〕/ single-file 非 Path A〔三檔只碰已存在 `env.chiyigo_db`、未新增 binding、不觸 TS2339〕/ type-only claim〔合理但需 Code 階段重跑 byte-identical、不沿用 spike〕）。**binding BL-1..BL-10（② Codex Plan / ③ Codex Code / ④ Faithfulness 須保留）**：BL-1 Scope〔僅 3 source、不改 env.d.ts〕· BL-2 Runtime hot-zone〔不改 SQL/WHERE/bucket/scope gate/step-up/PII audit/query parse/soft-delete/projection/callback body/response/CORS/docstring〕· BL-3 No shared logic〔不新增 import、MainRow 限檔內 type-only〕· BL-4 Callback OD〔`as MainRow[]`、禁 Record/annotate-param/return type〕· BL-5 Byte-identical〔merge 前必要證據〕· **BL-6 No env.d.ts〔Code 階段若掀 Env 缺口→停手退 PLAN_DRAFT、禁自行轉 Path A〕** · BL-7 OD shape〔`{request:Request;env:Env}`、禁 CfRequest/Pick/arrow〕· BL-8 Evidence replay〔source commit 後重證、不引 spike〕· BL-9 Coverage honesty〔可說有 direct test、不預先宣稱通過數〕· BL-10 Stop rule〔runtime diff/碰排除檔/偏離 OD/掀缺口→退 PLAN_DRAFT〕。風險表 5 項（PII read 高、其餘中/低，全有防禦）。**可進 ② Codex Plan Gate；非 coding/merge 授權。**
- 2026-06-27 owner 驅動產 **Codex Plan packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cv-codex-plan-packet.md`、repo 外、§1 HEAD-independent anchor B1-B5 + §3 read-only replay recipe〔Git Bash〕+ §3c dual-leaf reconcile + §4 frozen diff + §5 BL-1..BL-10 + §6 cascade + §8 三檔 base source）→ 送外部 ②。
- 2026-06-27 **Codex Plan Gate（② 維度 C）：r1 `CHANGES_REQUESTED`（唯一 blocker = packet evidence typo、0 source/code）**→ §3 L59 metadata-archive 預期 emit sha 誤植 `6f6af4dd_a091c6a1`（live 為 `6f6af4dda091c6a1`、plan doc L173 本已正確）。**主線單-agent 自審修正**（§9 throttling：repo-external trivial；對照 live esbuild replay + plan doc L173 + base capture 三方一致、`rg` 掃無其他 underscore-sha typo、repo source/plan 零改動〔HEAD 不變 `1644156e`、`git diff 745019ab..HEAD -- functions/ types/` 空〕）→ 重送 delta（唯一變更 = 該 sha typo）。
- 2026-06-27 **Codex Plan Gate（② 維度 C）：r2 `CODEX_PLAN_APPROVED`**（**0 blocker / 0 required revision**）— 增量確認 packet §3 L59 改正、`rg` 無其他 underscore-sha typo、packet↔plan doc L173 一致；重驗 anchors 全綠（HEAD `1644156ef99dff1a63bf9ca40533f0b94f634b13`、base `745019abe313438ec87d954eeda99c19ef5f002f`、`git diff --name-status 745019ab..HEAD -- functions/ types/` 空、三 source blob `HEAD == 745019ab`、packet 426 行、metadata-archive Git Bash stdin esbuild **1941B sha `6f6af4dda091c6a1` err=0**）。**HEAD-independent anchor → 零 false-reject。Plan Gate 雙道（①+②）全過 = plan 批准；非 coding/push/merge 授權、待 owner 明示 `CODING_ALLOWED` 才進 Code 階段。** 附帶：Codex 提醒 `MEMORY.md` memory-hygiene WARN/ISSUES_FOUND ＝ 獨立治理任務、非 PR-2cv scope。
- 2026-06-27 owner **`CODING_ALLOWED`** ✅ → **Code 階段（source commit `bf82640a`）**：套 frozen diff（6 handler ctx + aggregate L94 `as MainRow[]` + L93.5 `type MainRow`）；working-tree blobs == frozen `283746af`/`39bdc897`/`1292b21f`、numstat 4/3+2/2+2/2、`git diff --check` clean；**明確 stage 該 3 source（禁 `-A`）、`CLEANUP_PLAN.md` 未進**（BL-1/staged 驗）；name-status `745019ab..HEAD -- functions/` = 恰 3 source。隨後 plan doc embedded-diff 尾空白 strip commit `38530379`（docs-only cosmetic，`git diff --check 745019ab..HEAD` 轉全乾淨；source 未碰）。**full replay @ committed（BL-8/BL-10、不沿用 spike）全綠**：forced `tsc -b --force` **770** / 三檔 0 殘留 · sort-diff **REMOVED=13〔aggregate 5+webhook-dlq 4+metadata-archive 4〕/ ADDED=0** · 三檔 byte-identical @ committed blob（`git show 745019ab:` vs `git show HEAD:`、canonical esbuild `--loader=ts --format=esm` stdin、Git Bash）：aggregate **2931B** `d343d728e84b2137`、webhook-dlq **2217B** `c849a015a9836516`、metadata-archive **1941B** `6f6af4dda091c6a1`，stderr 0、`diff -q` IDENTICAL · ratchet enforce〔`RATCHET_BASE_REF=745019ab`〕**OK**（baseline 1119/175、current **770/262**）· `git diff 745019ab..HEAD --check` clean · **lint** green · **build:functions「Compiled Worker successfully」** · **targeted `admin-payments.test.ts` 33/33 passed**（涵蓋 intents/aggregate/webhook-dlq/metadata-archive；含 scope 403 / step-up 401·403 / soft-delete / critical read audit / refunded bucket 對齊）。**NB-2 雙證齊**（byte-identical @ committed blob + source diff 逐行 == frozen 8 行）。
- 2026-06-27 **Code self-review = multi-agent workflow（維度 A、converged 三維 diff-fidelity / runtime-security / evidence-integrity；run `wf_0d0a715b-3f3`、3 agents〔3 finder、0 verifier ∵ 0 candidate〕/ 260924 subagent tokens / 48 tool uses；finder 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8`、`__proto__:null`）→ `CODE_SELF_REVIEW_CLEAN`**：三維 **全 0 findings**（diff-fidelity / runtime-security / evidence-integrity，皆實際 read-only git/tsc/esbuild 重現、非空轉）。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：workflow 前已親跑 full replay @ committed（770 / byte-identical 三檔 / REMOVED 13·ADDED 0 / ratchet 770·262 / int 33 passed）→ workflow 0-findings 佐證、非唯一依據；① committed diff == frozen（blobs `283746af`/`39bdc897`/`1292b21f`、name-status 恰 3 source、CLEANUP_PLAN.md 未 commit、函式體 byte-unchanged）② byte-identical @ committed ③ 機械值親驗 ④ 無 cross-PR 洩漏（本 PR 引 770/72/262·13·2931/2217/1941、無 783-final/789/4594 等他 PR 數）→ 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `38530379`、source blobs 未動、staged 空、`git diff 745019ab..HEAD -- functions/ types/` = 恰 frozen 3 source、working tree 僅 `?? CLEANUP_PLAN.md`）。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；非 merge 授權。**
- ⬜（後續 dated 收錄：③ Codex Code → ④ ChatGPT Faithfulness → merge-front 7 gates → owner MERGE_ALLOWED → squash → SHIPPED + memory）

## owner 鎖定表（2026-06-27；single-file 版）

| Lock | 內容 |
|---|---|
| L-1 Scope | **3 source 檔**：① `aggregate.ts`（4 ctx-err + 1 MainRow callback-err，3 改 + 1 增）② `webhook-dlq.ts`（4 ctx-err，2 改）③ `metadata-archive.ts`（4 ctx-err，2 改）。納入全 13 錯（5+4+4）、三檔目標 0 noImplicitAny、cleanFiles +3。**無 env.d.ts 變更（single-file，spike 證無 Env 缺口）** |
| L-2 Runtime hot-zone lock | **不改** 任何 SQL query / WHERE 條件 / bucket 表達式 / scope gate（`requireAnyScope`/`requireStepUp`/`effectiveScopesFromJwt`）/ step-up action / PII read audit（event_type·severity·payload）/ `pending`·`vendor`·`limit` parse / `intent_id` validate / response shape·status·CORS·docstring / aggregate 投影算式（`Number(...)||0`、`refundMap.get`）/ callback body |
| L-3 No new shared logic / no new import | 不新增 shared logic、不抽 helper、不新增任何 import；aggregate `type MainRow` ＝ **檔內 type-only 宣告**（mirror 既有 `RefundRow`、非 shared logic、非 import）|
| L-4 callback OD | aggregate `r` 用 **`MainRow` cast**；**禁** `Record<string,unknown>`（spike 證掀 TS2345）、禁 annotate callback param、禁加 return type、禁改 callback body |
| L-5 byte-identical evidence | 三檔 emit **byte-identical**（type-strip / canonical esbuild `--loader=ts --format=esm` stdin）為 merge 前必要證據（含 aggregate `as MainRow[]` cast erase 後不變）|
| L-6 No env.d.ts | **不**動 `types/env.d.ts`（single-file）；若 coding 階段意外掀 Env 缺口 → 立刻停手回 `PLAN_DRAFT`（owner 重裁 Path A）|
| L-7 OD 形態 | handler `{request:Request;env:Env}` full Convention A；aggregate `MainRow` cast；**禁** `CfRequest`/`Pick`/arrow const |
| L-8 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L-9 Coverage 誠實 | 三檔有 direct test（`admin-payments.test.ts` direct-literal）；不 overclaim runtime 覆蓋、不預先宣稱通過數（[[feedback_pr_coverage_claim_accuracy]]）|
| L-10 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / 偏離 OD（`CfRequest`/`Pick`/arrow const/加 return type/`Record<string,unknown>`/動函式體·SQL·audit/掀 Env 缺口需 env.d.ts）→ 退回 `PLAN_DRAFT` |

## ⚠ payments admin-ops 聲明（review care L2，**admin read + PII audit**）

三檔 ＝ payments 觀測/對帳 read endpoint（無金流寫入、無 redirect）：

| 紅線（typing 全程不得牽動）| 檔 / 位置 |
|---|---|
| `requireAnyScope`（admin:payments fine scope）| aggregate L33 |
| `requireStepUp(elevated:payment)` + `effectiveScopesFromJwt` scope 驗 | webhook-dlq L31/L35、metadata-archive L30/L34 |
| **PII critical read audit**（`admin.payment_webhook_dlq.read` / `payment.metadata_archive.viewed`、severity `critical`）| webhook-dlq L66、metadata-archive L57 |
| SQL query（`payment_intents` 對帳 GROUP BY / `payment_webhook_dlq` / `payment_metadata_archive`）| aggregate L61-88、webhook-dlq L53-63、metadata-archive L47-55 |
| query param parse（`period`/`status`/`from`/`to` / `pending`/`vendor`/`limit` / `intent_id`）+ soft-delete 過濾 | 各檔 |
| aggregate 對帳投影（`refundMap` join、`Number(...)||0`）| aggregate L90-100 |

本刀只在 6 個 handler 簽名 + 1 個 callback cast（+1 type 宣告行）加 inline 型別（TS erase 後 byte-identical），**函式體一律不動**。修法若非純型別、或牽動上列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L-2/L-10）。

### Coding 階段硬性邊界

- **允許**：三檔 6 handler 簽名各加 inline ctx type；aggregate L94 cast `as MainRow[]` + L93.5 `type MainRow` 宣告（§frozen diff 的 8 行）。
- **禁止**：改三檔任何函式體 / SQL / WHERE / audit / scope gate / step-up / response shape / docstring / 加 return type / annotate callback param / 用 `Record<string,unknown>` / 新增任何安全功能或驗證 / shared util logic / tests / `tsconfig`·`eslint`·`vitest` / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types`·`Pick` / 動 `types/env.d.ts` / 新增 any·suppression·global·import·package / **碰排除檔**（payments 域其他檔：`admin/payments/intents.ts`、`intents/[id]/refund.ts`·`delete.ts`、`payments/intents/[id]/refund-request.ts`、`utils/payments.ts`、vendor `payment-vendors/ecpay.ts`、`webhooks/payments/[vendor].ts`，及其餘 util / audit 域）/ 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `745019ab`）

### 逐檔 error set（forced `tsc -b tsconfig.solution.json --force`，filtered，loc+code）

```
# aggregate.ts (5)
functions/api/admin/payments/aggregate.ts(26,42): error TS7031   # onRequestOptions request
functions/api/admin/payments/aggregate.ts(26,51): error TS7031   # onRequestOptions env
functions/api/admin/payments/aggregate.ts(30,38): error TS7031   # onRequestGet request
functions/api/admin/payments/aggregate.ts(30,47): error TS7031   # onRequestGet env
functions/api/admin/payments/aggregate.ts(94,44): error TS7006   # buckets .map(r) — D1-row callback
# webhook-dlq.ts (4)
functions/api/admin/payments/webhook-dlq.ts(23,42): error TS7031   # onRequestOptions request
functions/api/admin/payments/webhook-dlq.ts(23,51): error TS7031   # onRequestOptions env
functions/api/admin/payments/webhook-dlq.ts(27,38): error TS7031   # onRequestGet request
functions/api/admin/payments/webhook-dlq.ts(27,47): error TS7031   # onRequestGet env
# metadata-archive.ts (4)
functions/api/admin/payments/metadata-archive.ts(23,42): error TS7031   # onRequestOptions request
functions/api/admin/payments/metadata-archive.ts(23,51): error TS7031   # onRequestOptions env
functions/api/admin/payments/metadata-archive.ts(27,38): error TS7031   # onRequestGet request
functions/api/admin/payments/metadata-archive.ts(27,47): error TS7031   # onRequestGet env
```

**恰 13 錯**：12×TS7031（6 handler × {request,env} destructure）+ 1×TS7006（aggregate `r` D1-row 投影 callback）。**目前三檔 line-count == unique（零 dual-leaf 重複）** = 只報 TS70xx〔functions leaf 獨有〕，無 noImplicitAny-independent 錯。

### 依賴邊界（caller cascade，spike 實測 = 0）

| 面 | 判定 | 證據 |
|---|---|---|
| 外部 production TS caller（六 handler）| **0 牽動** | `onRequestOptions`/`onRequestGet` ＝ Pages file-routing entry，production runtime 由 Pages 注入 context、不靜態 type-check 本 annotation |
| direct test importer（三檔）| **0 牽動（dual-leaf、direct-literal）** | `tests/integration/admin-payments.test.ts` L21-23 `import { onRequestGet as … }`（aggregate/dlq/metadata）+ L201/208/248 等 **direct-literal call** `handler({ request: bearer(...), env })`；標 ctx 後 literal `{request,env}` 恰兩屬性、`bearer()`→`Request`、`env`（`cloudflare:test`、`ProvidedEnv extends Env`）assignable → **0 TS2345**（同 PR-2cp/2ch/2cc direct-literal 先例；spike 全 leaf ADDED=0 實證）|
| aggregate `MainRow` cast cascade | **0** | `type MainRow` 檔內 type-only、cast 純斷鏈；`r.bucket`(string)→`refundMap.get` 合法、輸出 shape 不變 |
| 跨檔/util cascade | **0（全 leaf）** | spike forced full-solution sort-diff ADDED=0（functions + scripts + tests + browser）|

**precedent landscape（佐證 OD ruling）**：
- handler `{ request: Request; env: Env }` ＝ repo 主流 Convention A（PR-2cp..2cu 數十 handler）→ 零新 OD。
- aggregate `MainRow` cast ＝ **同檔 L90 `RefundRow` cast 既有先例**複用（D1-row `.map` 投影、PR-2co register `takenRows` const 斷鏈同類）→ 零新 OD pattern。
- direct-literal test 維持綠 ＝ PR-2cp login `user-audit.test.ts` / PR-2ch / PR-2cc 先例。

## Spike 實證（full-solution，本地未 commit，2026-06-27，已 revert clean）

**程序**：branch（自 clean main `745019ab`）→ 量 base（forced tsc total、3 base emit、ratchet:report）→ 套 3 source annotation（含 aggregate MainRow cast）→ forced tsc + sort-diff + ratchet + byte-identical → frozen diff + `git diff --check` → `git checkout HEAD --` revert → 驗 clean（blobs 回 base、staged 空、net source vs base 空）。另跑 `Record<string,unknown>` 變體證會破（TS2345）。

| 驗收條件 | 結果 |
|---|---|
| 三檔 errors 13 → 0 | ✅ sort-diff REMOVED = 恰 13 行（aggregate 5 + webhook-dlq 4 + metadata-archive 4）；patched grep 三檔 NONE-clean |
| **single-file（不改 env.d.ts）→ 證足、無 Env 缺口** | ✅ 三檔 `env` 僅 `env.chiyigo_db`（已宣告）→ 標 `env: Env` 零 TS2339；total **783 → 770（恰 −13）** |
| **aggregate `MainRow` cast 乾淨（vs `Record<string,unknown>` 否決）** | ✅ MainRow → aggregate 5→0、零新錯；⚠ `Record<string,unknown>` 變體 → L98,48 / L99,48 掀 **TS2345 ×2**（dual-leaf ×2 = 4 error-line；`refundMap.get` 期望 string、`r.bucket` 變 unknown）→ 否決 |
| zero cascade（全 leaf：functions + scripts + tests + browser）| ✅ sort-diff **REMOVED=13 / ADDED=0** |
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **783** / errorFiles **75** / cleanFiles **259** / sourceFilesTotal **334** → patched **770** / **72** / **262** / **334**（三檔全清入 cleanFiles）|
| **三檔 emitted-JS byte-identical**（TS erase runtime 不變硬保證；canonical `esbuild --loader=ts --format=esm` stdin，[[feedback_byte_identical_emit_verification]]）| ✅ 三檔 base vs patched **IDENTICAL**、stderr 空：aggregate **2931B** sha `d343d728e84b2137…`、webhook-dlq **2217B** sha `c849a015a9836516…`、metadata-archive **1941B** sha `6f6af4dda091c6a1…`（base==head 兩端同 byte 同 sha；含 aggregate `as MainRow[]` cast erase 後不變）|
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace）|
| frozen diff numstat | ✅ aggregate `4 3`（blob `1a09ace8→283746af`）+ webhook-dlq `2 2`（`4521cf3a→39bdc897`）+ metadata-archive `2 2`（`f7e442c4→1292b21f`）；diff --stat 3 files / +8 / −7；無 whole-file CRLF churn |
| working tree revert clean | ✅ `git checkout HEAD --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、三 blob 回 base、staged 空 |

**byte-identical 適用性**：三檔**皆有 import** → esbuild stdin transform 是**單檔 type-strip**（import 原樣穿透、不解析依賴），非完整 bundle。**對 type-only 證明而言這是正確粒度**：annotation + `as MainRow[]` cast erase 後輸出逐 byte 不變 → runtime 行為不變（同 PR-2cq..2cu 有 import 檔作法）。⚠ 用 **stdin**（`<`），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell）；本 spike 三檔 emit 皆非空、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

```diff
diff --git a/functions/api/admin/payments/aggregate.ts b/functions/api/admin/payments/aggregate.ts
index 1a09ace8..283746af 100644
--- a/functions/api/admin/payments/aggregate.ts
+++ b/functions/api/admin/payments/aggregate.ts
@@ -23,11 +23,11 @@ import { getCorsHeaders } from '../../../utils/cors'
 import { SCOPES } from '../../../utils/scopes'
 import { PAYMENT_STATUS, isPaymentStatus } from '../../../utils/payments'

-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
 }

-export async function onRequestGet({ request, env }) {
+export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
   const cors = getCorsHeaders(request, env)
   // P1-17 Phase 3: 任一金流 fine scope 即可讀（finance/support 透過 :read 通過）
   const { error } = await requireAnyScope(
@@ -91,7 +91,8 @@ export async function onRequestGet({ request, env }) {
   const refundMap = new Map(
     ((refunded.results ?? []) as RefundRow[]).map(r => [r.bucket, r] as const),
   )
-  const buckets = (main.results ?? []).map(r => ({
+  type MainRow = { bucket: string; count: number; sum_subunit: number }
+  const buckets = ((main.results ?? []) as MainRow[]).map(r => ({
     bucket:               r.bucket,
     count:                Number(r.count) || 0,
     sum_subunit:          Number(r.sum_subunit) || 0,
diff --git a/functions/api/admin/payments/metadata-archive.ts b/functions/api/admin/payments/metadata-archive.ts
index f7e442c4..1292b21f 100644
--- a/functions/api/admin/payments/metadata-archive.ts
+++ b/functions/api/admin/payments/metadata-archive.ts
@@ -20,11 +20,11 @@ import { getCorsHeaders } from '../../../utils/cors'
 import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
 import { safeUserAudit } from '../../../utils/user-audit'

-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
 }

-export async function onRequestGet({ request, env }) {
+export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
   const cors = getCorsHeaders(request, env)

   const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_PAYMENT, 'view_metadata_archive')
diff --git a/functions/api/admin/payments/webhook-dlq.ts b/functions/api/admin/payments/webhook-dlq.ts
index 4521cf3a..39bdc897 100644
--- a/functions/api/admin/payments/webhook-dlq.ts
+++ b/functions/api/admin/payments/webhook-dlq.ts
@@ -20,11 +20,11 @@ import { getCorsHeaders } from '../../../utils/cors'
 import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
 import { safeUserAudit } from '../../../utils/user-audit'

-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
 }

-export async function onRequestGet({ request, env }) {
+export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
   const cors = getCorsHeaders(request, env)
   // P1-16：DLQ raw_body 含 ECPay payload（PII / 帳號 / 部分卡資訊）；
   // 與 metadata-archive 對齊，要求 step-up elevated:payment + admin:payments scope。
```

`git diff --stat`：3 files changed, 8 insertions(+), 7 deletions(-)；`git diff --numstat`：aggregate `4 3` / metadata-archive `2 2` / webhook-dlq `2 2`。

## 預期 ratchet

- clean main `745019ab` `--report`：errorCount **783** / errorFiles **75** / cleanFiles **259** / sourceFilesTotal **334**。
- 本 PR 後 current ratchet state：errorCount **783 → 770**（−13）、errorFiles **75 → 72**、cleanFiles **259 → 262**（spike 實測值；三檔全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 770」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 三檔改動 = 6 handler 簽名 inline ctx 型別 + aggregate 1 callback cast（+1 type 宣告），TS erase 後 runtime byte-identical（§Spike 三 sha 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 783、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。
- **無 D1 migration**（純 type-only、不觸 schema）→ 不觸發 migration-before-merge（[[feedback_migration_before_merge_autodeploy]]）。
- **無 env.d.ts 變更**（single-file）→ 無 ambient `.d.ts` stale 風險（但 coding 階段 forced tsc 仍 `--force`）。

## 測試影響面（覆蓋誠實，L-9 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike 全 leaf sort-diff ADDED=0）。
- **覆蓋分層（誠實）**：

| 標的 | direct test | 硬保證 |
|---|---|---|
| aggregate `onRequestGet`（對帳）| `admin-payments.test.ts` direct-literal（L194+ `GET /aggregate` describe）| byte-identical（2931B 不變）+ integration（merge-front 實跑）|
| webhook-dlq `onRequestGet`（DLQ read）| `admin-payments.test.ts`（L263+ `GET /webhook-dlq` describe）| byte-identical（2217B）+ integration |
| metadata-archive `onRequestGet`（archive read）| `admin-payments.test.ts`（L762+ `GET /metadata-archive` describe）| byte-identical（1941B）+ integration |
| 三檔 `onRequestOptions`（CORS preflight）| 視 test 覆蓋 | byte-identical |

- **誠實界線**：type-only 改動 runtime 不可見（型別 erase）→ **主硬保證 ＝ byte-identical emit（三檔 sha 兩端一致）**。`admin-payments.test.ts` 具體覆蓋與通過數**於 coding 階段實跑後據實記錄、不在 plan 階段預先宣稱**（[[feedback_dont_assert_runtime_semantics_without_verify]]）。
- merge-front 跑全量 `test:int` / `test:cov` 確認無跨檔破壞（三檔 type-only → 預期零牽動）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測用 `--force`（清 incremental）。**PowerShell 用 `$env:RATCHET_BASE_REF='745019ab'`**；唯獨 byte-identical 段用 **Git Bash**（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='745019ab'; npm run typecheck:ratchet` green（783→770 / 75→72 / 259→262）。
- forced `tsc -b tsconfig.solution.json --force`：三檔 0 殘留 + 全 leaf sort-diff **REMOVED=13 / ADDED=0**。
- **byte-identical**（canonical recipe；NB-2 雙證之一）⚠ **Git Bash**，三檔各跑（base `git show 745019ab:` vs HEAD `git show HEAD:`，皆 stdin esbuild）：期望 aggregate 2931B `d343d728…` / webhook-dlq 2217B `c849a015…` / metadata-archive 1941B `6f6af4dd…` 兩端、stderr 空、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「三檔 base vs patched emit byte-identical（sha + bytes）」與「source diff 僅 8 行（`git diff` 逐行 == frozen）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green、`npm run build:functions` green（Compiled Worker successfully）。
- 全量 `test:int` / `test:cov` 確認無跨檔破壞。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 3 檔、aggregate +4/−3 + webhook-dlq +2/−2 + metadata-archive +2/−2）；超出 = scope creep = Gate fail。
