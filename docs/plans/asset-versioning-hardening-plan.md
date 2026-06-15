# Asset Versioning Hardening Plan — content-hash `?v=` + CI guard

> **狀態**：`PLAN_DRAFT Rev 2（locked）`。ChatGPT Arch `REVISE_REQUIRED`（H1/H2/H3/M1–M4）已全納；**sub-OD-3=(i) 兩段式 + OD-E 措辭 已由 owner LOCKED（2026-06-15）、無 open OD**。dim-A self-reviewed。**待重送 ChatGPT Arch Gate → Codex Plan Gate → `CODING_ALLOWED`**。本文 plan-only，未動 code/branch/scripts/package/workflow/public artifacts、未 pop stash。
> **分級**：L2（build pipeline + CI gate；frontend asset versioning）。敏感熱區＝**部署可重現性 / build SoT** → 三道基本外部審查全走。
> **背景錨點**：#89（squash `9e92754e`）已**止血** split-brain `?v=`（203× `749ced39` + 11× `96d2b662` → `0f25ff3d`）。本 plan **根治**版本規則。
> **⚠ Rev 2 重大變更**：H3 證 `tailwind.config.cjs` 掃 `./public/**/*.html` → sub-OD-1=(a) 廢止，**改 §3.3 sub-OD-3=(i) 兩段式（owner locked）**。sub-OD-2（同 PR 兩 commit）、OD-E（Direct Upload）不變。

---

## 0. 問題根因（為何 #89 不夠）
`?v=` 由 `build-partials.js:resolveBuildVer()` 取 `git rev-parse --short=8 HEAD`，在 **Direct Upload committed `public/`** + **squash-merge** 下必再 stale，且「改資產忘了 rebuild HTML」現有 CI 無 gate（`verify-browser-pipeline.mjs` 只驗 `public/js` byte，不碰 HTML `?v=`）。**根治＝per-file content-hash + CI guard。**

---

## 1. 目標 / 非目標
**Goals**：`?v=`＝本地資產內容 hash（squash-independent、idempotent）；build 與 verify 共用 SSOT helper；CI 機械驗 committed HTML `?v=` 一致；部署 docs 落地。
**Non-goals**：大範圍 CRLF renormalize / `git add --renormalize .`；跨帳號 / Cloudflare dashboard 變更；JS/CSS **runtime 邏輯**改動；build 寫 CRLF 進工作樹的硬化（§7 觀察）。
**BUILD_VER consumer inventory（M3）**：repo-local inventory — code 僅 `build-partials.js`；docs 僅歷史 D-4 審計 + 本 plan；**無其他 script / CI / workflow 用 `BUILD_VER`**。移除為 repo-local-safe。本變更影響**所有跑本 repo `build-partials` / `npm run build` 的環境**（含 cross-account 同 repo build consumer ≠ 其他 repo 共用本 script）。其他 repo 共用本 `build-partials`：**無 npm package / submodule / shared-script consumer 證據 → `not repo-verifiable; owner states no shared repo consumer`**。本 PR **不改** dashboard / 跨帳號設定。

---

## 2. 設計：content-hash 版本規則

### 2.1 Canonical hash input（F1，已實測）
`public/css/*.css` 工作樹 12 CRLF / 12 LF 混雜；`_components.css` 工作樹(CRLF) hash ≠ git blob(LF)，但 **LF-normalized == LF blob**。Direct Upload 部署 committed LF blob。→ **canonical input = CRLF→LF normalized bytes**，三方（Windows local / Linux CI / 部署 blob）必一致。

### 2.2 SSOT helper `scripts/lib/asset-versioning.mjs`（F4 + H2 + M1）
build 與 verify 共用，單一來源：

**(a) `ASSET_RE`**（唯一來源）：`/\b(src|href)="(\/[^"#?]+\.(?:js|css|mjs))(\?[^"#]*)?(#[^"]*)?"/g`。

**(b) `resolveAssetPath(urlPath) -> absPath | REJECT`（H2 — regex 不決定安全邊界）**：
- 只接受 **root-relative repo-local public asset**（`/` 開頭）。
- **拒絕 protocol-relative**（`//…` 視為外部、不注入）。
- decode + `path.normalize`；**resolved 絕對路徑必須仍在 `PUBLIC` 之下**（`path.resolve(PUBLIC, '.'+urlPath)` 後驗 prefix）。
- 允許清單 root：`/js/*.js`、`/css/*.css`、`/*.mjs`（僅在 inventory 確認實際存在才啟用 mjs）。
- traversal / encoded traversal / 不在允許 root → **fail-closed（throw）**。

**(c) `assetVersion(absPath) -> string`（F1 + F4）**：
- 檔不存在 → **throw `ASSET_MISSING:<path>`（fail-closed；移除 timestamp fallback）**。
- **byte-level**：讀 `Buffer` → `CRLF(0x0D0A)→LF(0x0A)` 在 buffer 層（不經 string decode/re-encode，含 BOM/非典型 byte 逐 byte 對齊 blob）；**只 CRLF→LF、不 strip lone CR**（對齊 git `eol=lf`；非 `tr -d '\r'`）→ `sha256(buffer)` → hex → `.slice(0,12)`。

**(d) `injectCacheBust(html, resolveAssetPath)` — canonical URL rewrite（M1，採保守 fail-closed 選項 A）**：
- v1 **只支援**：local asset URL 無 query，或 query 僅含 `v=<old>`。
- **任何其他 query（非 `v`）在 local asset 上 → fail-closed**（明確 review；M2 掃描證實現況本就只有 `?v=` / 無 query，選項 A 安全且符實）。
- 重複 `v` / 多 query 的完整 canonicalize（選項 B）**v1 不做**，留待真有 non-`v` query 才升級。
- **fragment 保留**；rewrite = 移除既有 `v` → append `v=<hash>` → 接回 fragment。

### 2.3 per-file（OD-A lock）
每資產各自 hash，只有變動資產 re-cache。`build-partials.js` 移除 `resolveBuildVer`/`BUILD_VER`/內嵌 inject，改 import helper。

---

## 3. Build graph（H3 — sub-OD-1 取代為 sub-OD-3）

### 3.1 H3 事實
`tailwind.config.cjs` content = `["./public/**/*.html","./public/js/**/*.js"]` → **Tailwind 掃生成後的 public HTML/JS** 決定輸出 class。故 `tailwind.css` 內容**依賴已 render 的 HTML**。

### 3.2 依賴拆解
- `public/js`、非-tailwind `public/css/*.css`：內容**獨立於 HTML** → hash 可在 render 時算。
- `public/css/tailwind.css`：內容**依賴已 render HTML+js** → 其 hash 只能在 render + tailwind **之後**算。
- 「tailwind 在 renderPages 前」(舊 sub-OD-1=(a)) → 會掃**舊 HTML** 產 CSS，且 HTML 的 `tailwind.css?v=` 需 tailwind.css hash → **循環**。**故 (a) 廢止。**

### 3.3 sub-OD-3（取代 sub-OD-1）— **LOCKED：(i) 兩段式**（owner 2026-06-15）
原 sub-OD-1=(a) 廢止：H3 證 Tailwind 掃 generated public HTML，`ensureTailwind` 不能在 `renderPages` 前。
1. `buildJs` → public/js
2. `buildCss` → public/css/*.css（除 tailwind）
3. `renderPages` PASS-1：注入 js + 非-tailwind css 的 content-hash；**tailwind.css link 留 sentinel placeholder（或暫存舊 `v`），此階段不算 tailwind hash**。
4. `ensureTailwind`：tailwind 掃 **PASS-1 產生的** public/*.html + public/js → 最終 public/css/tailwind.css。
5. **PASS-2 targeted patch**：算 tailwind.css content-hash，**只 replace HTML 內 `tailwind.css?v=` 該 token**。
   - **嚴禁 PASS-2 重新 render 全站模板**（避免 i18n / template / 文案 drift）；PASS-2 必須是對既有 HTML 字串的 targeted replace。
   - 只動 tailwind.css 的 `?v=`、不增減 class → tailwind 輸出仍有效（無需 re-scan）。
   - **Gate 驗證（硬條件）**：PASS-2 的 diff 除 `tailwind.css` 的 `?v=` 外，**不得改任何其他 HTML 內容**（impl/CI 以 diff 範圍斷言）。

**(ii) tailwind 改掃 src — 暫緩、不進本輪**（owner）。**不改 `tailwind.config.cjs` content source**。未來若做，另開獨立 spike（src-scan vs public-scan `diff` 證 class 等價）+ plan，不混本 PR。

### 3.4 `ensureTailwind()`（required edit 1 — 無 shell 字串）
`execFileSync(process.execPath, [path.join(ROOT,'node_modules/tailwindcss/lib/cli.js'),'-c','tailwind.config.cjs','-i','src/css/tailwind.css','-o','public/css/tailwind.css','--minify'], {cwd:ROOT,...})`。CLI entry 已確認存在；args 對齊現行 `build:css`。

### 3.5 `package.json`（sub-OD-1 之 package 面仍適用）
`build` 移除 `&& npm run build:css`（tailwind 由 orchestrator 內 `ensureTailwind` 產，HTML 之後不可再有第二次 tailwind build）；`build:css` 保留為獨立工具但不在 canonical build 內於 HTML 後跑。`build:watch` 同步、watch 對 tailwind re-run 策略列 impl note。

---

## 4. CI verifier（F3 + H1 + M4，同 PR、不可拆走）

### 4.1 執行時機（H1 — 鎖死）
- verifier 驗的是 **fresh checked-out committed tree**，**必須在任何會重生 `public/*.html|js|css` 的指令之前**跑。
- **不得**於內部呼叫 `npm run build` / `build:partials` / `build:css` / 任何產 artifact 指令（否則會掩蓋「committed artifact stale」）。
- 可選的 deterministic-build 檢查須**獨立、明確、以 `git diff --exit-code` 結尾**，且**不得取代** committed-artifact 驗證。
- 落地：擴充 `scripts/verify-browser-pipeline.mjs`（已在 `ci.yml`，CI checkout 後、未跑 build），對每個 committed `public/*.html` 用 §2.2 同一 helper 以**當前 committed 資產**重算期望 `?v=`，比對；不符 → `fail()`。與現有 `public/js` byte 檢查並存。

### 4.2 測試（M4 — 不加新套件）
- **單元（vitest，現有 runner）**：`assetVersion()` CRLF/LF 同 hash、缺檔 throw、12 hex；`resolveAssetPath()` 拒 protocol-relative / traversal / 越界 PUBLIC；`injectCacheBust()` path/query/fragment rewrite（含 fail-closed non-`v` query）。
- **整合（node-script fixture / temp workspace，無新套件）**：verifier 能擋 stale HTML、缺檔 fail-closed、CRLF-normalized==LF-blob 一致。
- **測試矩陣三負例（required edit 3）**：(1) HTML `?v=` stale → fail；(2) 資產缺檔 → fail-closed；(3) CRLF 工作樹 normalized 後 hash == LF blob → pass。

---

## 5. 一次性 migration（sub-OD-2 lock）
切換後 `?v=` 全站 re-stamp 成 content-hash（純 `?v=` diff，比照 #89 純度 gate）。**同一 PR、兩 commit**：commit 1 = helper + build graph + `package.json` + verifier + docs（邏輯改，**不要求 standalone CI green**，restamp 前 verifier 對舊 `?v=` 報錯＝預期）；commit 2 = 一次性 restamp（純生成）。**最終 PR state 必 green**（squash＝release unit）。

---

## 6. Docs 更新面（required edit 2 + M3 + OD-E）
- `docs/JS_TO_TS_MIGRATION_PLAYBOOK.md`（`?v=<HEAD>` 舊規則）→ content-hash，**避免舊 SOP 復活**。
- 新增部署模型 docs：「**本 repo GitHub deploy path = Direct Upload committed `public/`**」（`deploy.yml`）、`?v=` 本機 build 烘焙、`CF_PAGES_COMMIT_SHA` N/A、content-hash 規則、dev flow、rollback（Direct Upload 回退前一 deployment / `git revert`）。
- 歷史 D-4（`?v==parent short8`）標 **superseded**，不改寫。
- **M3 cross-account**：docs 明寫本變更影響「跑本 repo `build-partials`/`npm run build` 的環境」；cross-account 部署若只是同 repo 跑 `npm run build` 屬 build consumer（≠ 其他 repo 共用本 script）；**不改** dashboard / 跨帳號。
- **OD-E（LOCKED 措辭）**：repo-verifiable deploy path = GitHub Actions Direct Upload committed `public/`（`deploy.yml`）。**Cloudflare dashboard Build command 未由 owner 親眼確認 → 寫 `owner-unverified / not repo-verifiable`，不得寫成 Codex/repo verified**。其他 repo 共用本 `build-partials`：repo-local inventory 僅見 `build-partials.js`（+歷史 docs），無 package/submodule/shared-script 證據 → `not repo-verifiable; owner states no shared repo consumer`。本 PR 不改 dashboard / 跨帳號。
- post-merge 更新 memory（`feedback_cache_bust_*`）對 `?v==HEAD` 描述。

---

## 7. CRLF working-tree 輸出 — 觀察/待裁（不進 v1）
與 hash 正確性**解耦**（§2.1 已 LF-normalize，工作樹 CRLF 不影響 hash，已實測）。build 寫 CRLF 只剩 cosmetic phantom。待裁（另議另審）：build 強制 LF / 一次性 renormalize / 接受（commit 層 `.gitattributes` 已修）。

---

## 8. PR 結構
單一 PR（`feat(build): content-hash asset versioning + CI guard`）、兩 commit（§5）；feature branch → PR → squash（禁直推 main）。**無 D1 migration、無 runtime 邏輯改動。**

---

## 9. In / Out
| In | Out |
|---|---|
| per-file content-hash `?v=`；LF-normalized SSOT helper（含 path containment + query rule） | 大範圍 CRLF renormalize；`git add --renormalize .` |
| build graph sub-OD-3 (i) two-pass | 跨帳號 / dashboard 變更；改 tailwind config content source |
| HTML `?v=` verifier 同 PR 進 CI（fresh committed tree） | JS/CSS runtime 改動 |
| 缺檔 fail-closed、12 hex；Direct Upload docs | build CRLF 輸出硬化（§7 觀察） |

---

## 10. 風險
| 項目 | 等級 | 防禦 |
|---|---|---|
| **H3 tailwind 掃 public HTML → 循環** | High | LOCKED sub-OD-3=(i) 兩段式：PASS-1 render → tailwind 掃 PASS-1 HTML → PASS-2 patch |
| **PASS-2 重寫全站致 i18n/template drift** | Medium | PASS-2 僅 targeted replace `tailwind.css?v=`；Gate 斷言 diff 除該 token 外無其他 HTML 變更 |
| verifier 跑在 build 後掩蓋 stale | High | §4.1 鎖死：fresh committed tree、不內部 build、可選 det-build 獨立 `git diff --exit-code` |
| asset path traversal / protocol-relative | High | §2.2(b) resolveAssetPath 允許清單 + PUBLIC containment + fail-closed |
| query/fragment rewrite 不一致 | Medium | §2.2(d) 選項 A fail-closed（符合 M2 現況） |
| ASSET_RE 漏本地資產 | Medium | §12 inventory 報 matched + suspected-unmatched，未分類即 blocker |
| 移除 BUILD_VER 誤傷他環境 | Medium | §1 inventory（僅 build-partials）+ cross-repo owner-confirm |
| build graph reorder 改 emit 行為 | Medium | verifier 同 PR 兜底；migration 純度 gate；`build:functions`/`test:int` 全跑 |
| helper/verifier 演算法分叉 | Medium | 單一 SSOT module |
| 一次性 restamp 夾帶 drift | Low | commit 2 純生成；#89 同款純度 gate |

---

## 11. Open Decisions — **全部 LOCKED（無 open OD）**
- **sub-OD-3 → (i) 兩段式**（owner 2026-06-15）；sub-OD-1=(a) 廢止；(ii) src-scan 暫緩另開 spike/plan。
- **OD-E → §6 LOCKED 措辭**（repo-verifiable Direct Upload；dashboard `owner-unverified / not repo-verifiable`；其他 repo 共用 `not repo-verifiable; owner states no shared repo consumer`）。
- **CODING_ALLOWED 仍 false** — 待 ChatGPT Arch Gate（Rev 2 重送）→ Codex Plan Gate 通過。

---

## 12. 驗收 / Gates

**Gate 流程**：本 plan → dim-A self-review → **ChatGPT Arch Gate（Rev 2 重送）** → **Codex Plan Gate** → `CODING_ALLOWED` → 實作 → Codex Code Gate + ChatGPT faithfulness → squash。

**Pre-impl inventory（M2 — CODING_ALLOWED 後、動手前，read-only）**：枚舉 `public/*.html` 報四組：**A** ASSET_RE-matched；**B** 疑似本地 js/css/mjs 但未被 ASSET_RE 命中（單引號 / 無引號 / preload / inline import）；**C** external / protocol-relative 刻意忽略；**D** 缺檔本地資產。**任何 B（疑似本地未命中）未分類即 blocker**。（初掃：A=全雙引號 `/css|/js`；B=未見；C=cloudflare beacon；D=待確認 — 動手前正式跑。）

**實作期 gate（impl PR 必跑，對齊 CI）**：`lint` / `typecheck:ratchet` / `verify:browser-pipeline`（含新 HTML `?v=` 檢查）/ `test:cov` / `test:int` / `build:functions` / `npm audit` 全綠；`git diff --check` clean；migration commit 純度（numstat 對稱、非-`?v=`=0）；target main CI 於 merge 前再查。

**部署防禦**：CI-CD = verifier 進 CI（fresh tree）；Rollback = Direct Upload 回退 / `git revert`；Health/Smoke = merge 後 `/` `/login` `/dashboard` HTML 引用 content-hash（curl/grep）；CDN/cache = content-hash 解 stale（核心目標）；SSL/Env = N/A。

**驗收條件**：資產內容變 → 該資產 `?v=` 變、未變不變（per-file）；改資產忘 rebuild HTML → verifier fail；缺資產 → fail-closed；CRLF/LF 工作樹 → 同 hash。
