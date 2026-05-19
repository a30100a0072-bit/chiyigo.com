# Stage 4 Frontend Migration Preflight

PR-38 preflight / inventory（docs-only，不碰 runtime，不 cache-bust）。

承接 [[project_js_to_ts_stage3_non_auth_plan]] 段結（HEAD `b5028b8`，2026-05-19）。functions/ 28/28 .ts、scripts/ 0 errors、public/js/ 0 errors，**剩餘戰線完全集中在前端 `src/js/**` 與 `tests/integration/**`**。

本文不開新規矩；所有紀律承接 [[project_js_to_ts_migration]] §1.5b（tsconfig 拆兩階段）／§1.5e（熱區 glob）／§1.5f（public/js 收編 deadline）／§紀律規則。

---

## 1. Baseline 重新校準（HEAD `b5028b8`，ratchet 951/204）

| 區塊 | 檔數 | errors | 註 |
|---|---|---|---|
| `functions/**` | — | **0** | Stage 2/3 完工，0 個 .js 殘留 |
| `scripts/**` | 16 | **0** | 全 .js/.mjs 但 typecheck 乾淨 |
| `public/js/**` | 31 | **0** | build artifact + 3 個 hand-edited（[[feedback_src_vs_public_build]]）|
| `tests/integration/**` | 18/68 | **74** | **Stage 4 真正目標**（migration plan §Stage 4）|
| `src/js/**` | 27/28 | **877** | Stage 4.5a/b → Stage 5/6（依賴 browser pipeline）|
| 合計 | — | **951** | committed baseline 951/203（PR-23~37 transient cleanFiles=204）|

**關鍵發現**：

1. **Stage 4 在 migration plan 是「tests/integration .js→.ts」（68 檔，-100 errors）**，不是前端。用戶口語的「Stage 4 frontend」實際對應 plan 的 **Stage 4.5a + 4.5b + Stage 5 + Stage 6**。
2. **src/js 總 errors 877**，加上 tests 74 = baseline 951 全部歸宿。functions/scripts/public 各 0，沒有藏 error。
3. **`erp-architecture-3d.js` 是唯一用 ESM `import` 的 src/js 檔**（line 14：`import * as THREE from '/js/vendor/three.module.min.js'`）。其餘 26 檔零 `import/export`。**驗證 §1.5b codex r3 P0 的「classic 26 + module 1」拆配置假設**。
4. **HTML 端只有 1 個 `<script type="module">`**（`erp-architecture-3d.html`），其餘 25 頁全部 `<script defer>` classic。

---

## 2. `src/js/**` 全 27 檔 inventory

按 baseline errors 排序（同 [[project_js_to_ts_migration]] §Stage 0 「Top 5 地雷檔」更新版）。

| 檔 | 行 | err | HTML coupling | window.* export | 風險檔位 |
|---|---:|---:|---|---|---|
| dashboard.js | 2225 | **228** | dashboard.html（唯一）| `window._lastRequisitions` | **🔴 Tier-S 金流/auth/session 心臟** |
| auth-ui.js | 931 | 45 | dashboard.html + login.html | `window.onloadTurnstile` | **🔴 Tier-S Turnstile + auth 流程** |
| erp-architecture-3d.js | 888 | 66 | erp-architecture-3d.html | `window.toggleTopLangDrop` | 🟡 Tier-A 唯一 ESM 入口 + Three.js |
| admin-requisitions.js | 630 | 54 | admin-requisitions.html | — | 🟠 Tier-B admin 後台 |
| erp-architecture.js | 512 | 44 | erp-architecture.html + index.html | `window.erpArchSetLang` / `window.toggleTopLangDrop` | 🟠 Tier-B 首頁嵌入 |
| admin-payments.js | 507 | 45 | admin-payments.html | — | **🔴 Tier-S 金流 admin** |
| case-platform.js | 393 | 38 | case-platform.html + index.html | `window.cpArchSetLang` / `window.toggleTopLangDrop` | 🟠 Tier-B 首頁嵌入 |
| requisition.js | 350 | 37 | requisition.html | — | 🟠 Tier-B 表單 + Turnstile |
| ai-assistant.js | 341 | 27 | ai-assistant.html | `window.onloadTurnstileCallback` | 🟡 Tier-A portfolio 展示 |
| portfolio.js | 321 | 26 | portfolio.html | `window.toggleTopLangDrop` | 🟡 Tier-A 純展示 |
| admin-deals.js | 306 | 21 | admin-deals.html | — | 🟠 Tier-B admin 後台 |
| admin-payment-records.js | 300 | 24 | admin-payment-records.html | — | **🔴 Tier-S 金流 admin** |
| admin-refund-requests.js | 259 | 25 | admin-refund-requests.html | — | **🔴 Tier-S 金流 admin** |
| reset-password.js | 203 | 18 | reset-password.html | — | 🟡 Tier-A auth 流程 |
| login.js | 190 | 28 | login.html | — | **🔴 Tier-S auth 入口** |
| index.js | 188 | 29 | index.html | — | 🟡 Tier-A 首頁 |
| about.js | 178 | 21 | about.html | — | 🟢 **Tier-C 純展示**（首手候選）|
| meeting-system.js | 161 | 21 | meeting-system.html | — | 🟢 Tier-C 純展示 |
| concert-system.js | 161 | 21 | concert-system.html | — | 🟢 Tier-C 純展示 |
| confirm-delete.js | 148 | 8 | confirm-delete.html | — | 🟡 Tier-A 帳號刪除 |
| bind-email.js | 136 | 7 | bind-email.html | — | 🟡 Tier-A auth 流程 |
| confirm-dialog.js | 131 | 5 | **24 頁全載** | — | 🟠 Tier-B shared helper（爆炸面廣）|
| forgot-password.js | 128 | 10 | forgot-password.html | — | 🟡 Tier-A auth 流程 |
| verify-email.js | 126 | 6 | verify-email.html | — | 🟡 Tier-A auth 流程 |
| 404.js | 95 | 11 | 404.html | — | 🟢 Tier-C 純展示 |
| privacy.js | 94 | 11 | privacy.html | — | 🟢 Tier-C 純展示 |
| notify.js | 56 | 1 | **24 頁全載** | — | 🟠 Tier-B shared helper（爆炸面廣）|
| login-boot.js | 41 | 0 | login.html | — | **🟢 Tier-C boot 0 error**（首手候選）|

**Tier 風險定義**：

- **Tier-S（🔴）**：金流 / auth 入口 / session 心臟 / step-up。動到必走 [[feedback_security_boundary_pr_first_do_no_harm]]、preview smoke、人工煙測。dashboard.js + auth-ui.js + admin-payments + admin-payment-records + admin-refund-requests + login.js。
- **Tier-A（🟡）**：auth 流程外圍 / Three.js / portfolio 展示。需 DOM smoke + 視覺對齊。
- **Tier-B（🟠）**：admin 後台 / shared helper（confirm-dialog/notify 載 24 頁）/ 首頁嵌入 widget。需 DOM smoke + 全頁回歸。
- **Tier-C（🟢）**：純展示頁 / boot 檔。DOM smoke + 切語言驗收即可。

---

## 3. 低風險首手候選（Stage 5 第一發 PR 目標）

排序：errors 低 → 行少 → coupling 窄 → 純展示。

| 排名 | 檔 | 行 | err | 為何適合 |
|---|---|---:|---:|---|
| 1 | `login-boot.js` | 41 | **0** | 0 error；純 boot；只接 login.html；風險最低 |
| 2 | `notify.js` | 56 | 1 | 僅 1 error；shared helper 但介面極窄（純 toast）|
| 3 | `confirm-dialog.js` | 131 | 5 | shared helper；5 errors；介面 dialog open/close |
| 4 | `verify-email.js` | 126 | 6 | auth 但流程線性；6 errors |
| 5 | `bind-email.js` | 136 | 7 | auth 流程線性；7 errors |
| 6 | `confirm-delete.js` | 148 | 8 | 帳號刪除前確認；8 errors |

**首發 PR-39 建議**：`login-boot.js`（0 error，pure rename，照 PR-30 oidc public-ish 同 R100 pattern）。但**前提是 Stage 4.5a 完成**，否則 ratchet 規則 E 擋（`src/js/*.ts` 在 4.5a pipeline ready 前禁）。

---

## 4. `public/js/**` 邊界規則確認

**現況（[[feedback_src_vs_public_build]]）**：`public/js/` = `npm run build` 產物 + 3 個 hand-edited source。

| public/js 檔 | 行 | 來源 | 結論 |
|---|---:|---|---|
| `api.js` | 1014 | hand-edited（無 src/ 對應）| Stage 4.5b 才搬到 src/js/api.ts |
| `sidebar-auth.js` | 178 | hand-edited（無 src/ 對應）| Stage 4.5b 才搬 |
| `form-enter.js` | 44 | hand-edited（無 src/ 對應）| Stage 4.5b 才搬 |
| 其餘 28 個 | — | build artifact（src/js/*.js → 同名複製）| **不手改、不 rename** |

**規矩**（不變，承接既有紀律）：
1. `public/js/{api,sidebar-auth,form-enter}.js` 三檔是 **Stage 4.5b 收編對象**。在那之前**手改可以**（既有規矩），但不准 rename .ts。
2. 其餘 `public/js/*.js` 都是 `npm run build` 從 `src/js/` 複製的 artifact。**禁止直接改 public/js/，必改 src/js 後跑 build**。
3. `src/js/erp-architecture-3d.js` 用 `/js/vendor/three.module.min.js` 是 vendored ESM，**不在遷移範圍**（[[feedback_threejs_self_host_pattern]]）。

---

## 5. `scripts/**` 不另開 Stage

**結論**：scripts/ 16 檔 0 errors，且非 runtime，**不單獨開 Stage**。

| 觀察 | 處置 |
|---|---|
| 16 檔合計 2,525 行；6 個是 `.mjs`（已 ES module）、10 個 `.js` | 維持現況 |
| typecheck 0 errors → 改 .ts 純美觀，不換戰力 | 不投入 |
| `_archive-lint-patterns.js` / `lint-handlers.js` 等被 CI 引用 | 改名會牽 npm scripts，回報率低 |
| `typecheck-ratchet.mjs` 本身是 ratchet engine | **嚴禁此 PR 改它**（governance §1.5a 規則 D）|

**例外條款**：未來若 scripts/ 出現 type 困擾（如 d.ts 寫 helper、共享 types），順手 rename 一個 leaf 檔（如 `seed-local.mjs` / `portfolio-add.mjs`）OK，但**不開系統性 Stage**。

---

## 6. PR 階段切分（重新校準 migration plan §Stage 4–6）

| 階段 | 範圍 | 估 PR | 估 -err | 依賴 | 風險 |
|---|---|---:|---:|---|---|
| **Stage 4** | `tests/integration/**` 18 檔 74 errors（純測試檔，rename + extensionless importer）| 3–5 | -74 | 無 | 🟢 低，照 PR-29~37 套路 |
| **Stage 4.5a** | `tsconfig.browser-classic.json` + `tsconfig.browser-module.json` + `browser-script-manifest.json` + `scripts/build-partials.js` 擴 emit pipeline；**不動現有 public/js 內容** | 2–3 | 0 | 無 | 🟠 中，touch build pipeline，需 resolver matrix smoke |
| **Stage 4.5b** | `public/js/{api,sidebar-auth,form-enter}.js` 搬到 `src/js/`；ambient ownership 從 `types/globals.d.ts` 搬到 `src/js/api-globals.d.ts`（不移除 ambient，只搬家）| 1–3 | 0 | 4.5a | **🔴 高**，api.js 是 auth/session 樞紐（[[feedback_iswebclient_origin_source_of_truth]]）|
| **Stage 5** | 前端低 error 檔（Tier-C/A 共 8–10 檔：login-boot / notify / confirm-dialog / 404 / privacy / about / portfolio / verify-email / bind-email / confirm-delete）| 6–10 | -120 | 4.5a + 4.5b | 🟡 中，照 PR-29~37 套路但須 DOM smoke |
| **Stage 6.0** | tsconfig.json 拆 references（root → backend + browser-classic + browser-module + tests），完整分流；ratchet `.checkedConfigs` 升 4 個 tsconfig | 1 | 0 | Stage 5 | 🟠 中，但純 config |
| **Stage 6.1** | Tier-B 中型檔（erp-architecture / case-platform / admin-deals / admin-requisitions / admin-payment-records / admin-refund-requests / requisition / index / ai-assistant / meeting-system / concert-system / reset-password / forgot-password）| 10–15 | -350 | 6.0 | 🟠 中，DOM narrow 是主戰場 |
| **Stage 6.2** | **Tier-S 心臟**：dashboard.js 228 errors（4–8 PR 分批）+ auth-ui.js + admin-payments + login + erp-architecture-3d.js（Three.js + ESM 入口）| 8–15 | -400 | 6.1 | **🔴 極高**，[[feedback_security_boundary_pr_first_do_no_harm]] + preview smoke + codex 強 review |
| **Stage 7** | strict 階梯：`strict:false` → `noImplicitAny` → `strictNullChecks` → `strict:true`；ratchet 改 zero-error；接進 `npm run build` | 3–4 | 0 | 6.2 | 🟢 低（防回流）|

**總戰線重估**（vs migration plan 53–80 PR）：

- 本次 preflight 算法：Stage 4 (3–5) + 4.5a (2–3) + 4.5b (1–3) + 5 (6–10) + 6.0 (1) + 6.1 (10–15) + 6.2 (8–15) + 7 (3–4) = **34–56 PR**
- 比初估 53–80 PR 略低，主因 functions/ 與 scripts/ 已歸零、tests/ 比預期少
- 維持 4–6 個月戰線估，dashboard.js 是真正 long pole

---

## 7. Gate Matrix（每階段必跑）

`✓` = 必跑、`◐` = 視 PR 內容、`–` = 不適用。

| Gate | tests/ (4) | 4.5a | 4.5b | Tier-C (5) | Tier-B (6.1) | Tier-S (6.2) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `typecheck:ratchet`（errorCount/cleanFiles）| ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lint` + `lint:handlers`（DOM handler 綁定）| ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lint:archive-no-delete`（R2 保險）| ✓ | – | – | – | – | – |
| `build:functions`（Pages Functions compile）| ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `npm run build`（src→public emit）| – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cache-bust commit（two-phase build→commit→rebuild）| – | ◐ | ✓ | ✓ | ✓ | ✓ |
| HTML script src `?v=` 對齊 HEAD short hash（[[feedback_cache_bust_build_order_trap]]）| – | ◐ | ✓ | ✓ | ✓ | ✓ |
| DOM id smoke（無痕視窗驗 console no error）| – | – | ✓ | ✓ | ✓ | ✓ |
| 視覺對齊（[[feedback_design_reference]] light/dark + [[feedback_light_dark_mode]]）| – | – | – | ✓ | ✓ | ✓ |
| Codex r1 review | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Preview smoke**（headless Chrome / [[reference_codex_prod_verification]]）| – | ✓ | ✓ | – | ◐ | ✓ |
| **人工煙測**（金流路徑 / OAuth / step-up）| – | – | ✓ | – | – | ✓ |
| **Resolver matrix smoke**（classic vs module 載入 OK）| – | ✓ | ✓ | – | – | ◐ |
| **F-2 期間 dashboard.js 鎖最小修**（[[project_js_to_ts_migration]] §紀律 §2）| – | – | – | – | – | ✓ |

---

## 8. 開工順序與起手 checklist

**下一棒順序**（user 拍板後執行）：

1. **PR-38 = 本文 commit**（docs-only，不 cache-bust，不變 baseline）
2. **PR-39 起 Stage 4 tests/integration** rename — 3–5 PR；比 functions/ 簡單，照 PR-29~37 套路
3. **PR-40+ Stage 4.5a** browser pipeline — 投入 2–3 PR；本階段最大不確定性
4. **Stage 4.5b api.js 收編** — codex 強 review，[[feedback_iswebclient_origin_source_of_truth]] 不能破
5. **Stage 5 Tier-C 首發**：`login-boot.js`（0 error，最低風險試水溫）

**起手前必驗**：

- [ ] `npm run typecheck` 確認 errorCount=951 / cleanFiles=204 沒漂
- [ ] `git log -1` HEAD = `b5028b8`（PR-37 收尾後）
- [ ] 讀 [[project_js_to_ts_migration]] §1.5b（tsconfig 拆兩階段）+ §1.5f（public/js 收編）+ §1.5e（熱區 glob）
- [ ] 讀 `docs/JS_TO_TS_MIGRATION_PLAYBOOK.md`（PR-34 收進 repo 的 6 節紀律）
- [ ] **F-2 金流期間動 dashboard.js 鎖最小 .js 修，不順手遷**（migration plan §紀律 §2 r3 刪了「順手遷」條款）

**Stage 4 (tests/) PR 切法建議**（4 PR 鏈）：

| PR | 範圍 | 檔數 | 估 -err |
|---|---|---:|---:|
| PR-39 | tests/integration auth/oauth/oidc 群（auth-ui adjacent test）| 5–6 | -25 |
| PR-40 | tests/integration admin/cron 群（archive/aggregate test）| 4–5 | -20 |
| PR-41 | tests/integration payments/webhooks 群（[[feedback_security_boundary_pr_first_do_no_harm]]）| 3–4 | -15 |
| PR-42 | tests/integration 剩餘（util / helpers / smoke）| 4–6 | -14 |

合計 18 檔 → -74 errors，預期 baseline 877/204 收尾（tests 全綠後 src/js 877 為唯一戰線）。

---

## 相關 memory / docs

- [[project_js_to_ts_migration]] — 主計畫；§1.5b tsconfig 拆 / §1.5e 熱區 / §1.5f public/js 收編
- [[project_js_to_ts_stage3_non_auth_plan]] — Stage 3 functions/ 非 auth 收尾參考
- [[feedback_src_vs_public_build]] — src/ vs public/ 邊界
- [[feedback_cache_bust_versioning]] / [[feedback_cache_bust_build_order_trap]] — cache-bust 紀律
- [[feedback_security_boundary_pr_first_do_no_harm]] — Tier-S 動工原則
- [[feedback_threejs_self_host_pattern]] — erp-architecture-3d.js 例外
- [[feedback_iswebclient_origin_source_of_truth]] — api.js 收編風險
- `docs/JS_TO_TS_MIGRATION_PLAYBOOK.md` — PR-34 收進 repo 的紀律 playbook
