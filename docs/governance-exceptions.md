# Ratchet Governance Exceptions Log

書面留底「typecheck:ratchet 在 base ref 對比下被故意觸發 fail」的人工放行紀錄。

## 兩類放行

### (A) Source deletion / tsconfig 縮小（人工 review，無 env gate）

刪除 clean TS source 或縮小 tsconfig include 會觸發 base-derived fail（如 `[BASE] cleanFiles` / `[BASE-D-tsconfig] include 縮小`）。這類**無 env gate**，走人工 governance review。格式：每個事件一段，列出觸發 commit、ratchet failure 列表（逐字）、放行理由。

### (B) Open-strict baseline raise（locked override，PR-0 / Stage 7 起）

開單一 solution leaf 的 strict-family flag 會從 zero base 製造大量 error，觸發 base-derived guards（`[BASE] errorCount/cleanFiles`、`[BASE-B']`、`[BASE-EBF]`、`[BASE-D-tsconfig]` strict-family）。自 PR-0（`scripts/lib/ratchet-override.mjs` + `typecheck-ratchet.mjs`）起，這類走 **locked override**：env `RATCHET_ALLOW_BASELINE_RAISE=<reason>` + 5 precondition（P1 no-source／P2 單 leaf strict-family↑／P3 base errorCount===0／P4 branch===current／P5 errorsByFile leaf-scoped）全過，才豁免那 5 條 base-derived；branch-local guard（A/B/B'/B''/SCHEMA、非該 leaf strict-family 的 D-tsconfig、C、D/E）永遠 enforce。經 `.github/workflows/strict-leaf-governance.yml`（workflow_dispatch + 必填 base_ref）執行；一般 ci.yml 對 open-strict PR 預期 red。每次 override 在本檔留一筆。

open-strict override entry 格式：觸發 commit／leaf／strict flag(s)／governance workflow run id／`errorCount 0 → N`、`cleanFiles → M`／被豁免的 failure 列表（逐字）／reason（= env value）。

---

## 2026-05-22 — concert-system page removal

- **Commit**: `fb2ea3a feat(portfolio): remove concert-system page + portfolio card`
- **Cache-bust follow-up**: `65c7ca3 chore(cache-bust): hash sync 500c790 -> fb2ea3a1`
- **Base ref for ratchet bundle-level check**: `500c790`
- **Trigger command** (codex / CI 都跑這條):
  ```
  RATCHET_BASE_REF=500c790 npm run typecheck:ratchet
  ```

### Failures explicitly accepted

1. `[BASE] baseline.cleanFiles 被同 PR 削弱：255 → 254`
   - 原因：刪除 `src/js/concert-system.ts` 這個 clean tracked TS source（不是 error 檔 budget shuffle，不是治理弱化）
2. `[BASE-D-tsconfig] tsconfig.browser-classic.json include 縮小：缺 "src/js/concert-system.ts"`
   - 原因：同一檔從 canary include 移除（與 source deletion 對齊）
3. `[BASE-D-tsconfig] tsconfig.browser-classic.prod.json include 縮小：缺 "src/js/concert-system.ts"`
   - 原因：同一檔從 prod emit include 移除（與 source deletion 對齊）

### 放行依據

- 三條 failure 全部由「使用者明確要求刪除 concert-system 整個頁面 + portfolio 卡片」觸發
- 不是 budget shuffle、不是 ratchet 規則弱化、不是 tsconfig compilerOptions guard 鬆綁
- `npm run verify:browser-pipeline` 綠（classic 27 entries + module 1 entry 全 byte-equal）
- `npm run build` 綠
- D1 portfolio.id=13 同次 PR 由 user 對 prod 跑 `wrangler d1 execute` 刪除
- 無 source 內任何 `concert-system` active reference 殘留（docs/STAGE_4_FRONTEND_PREFLIGHT.md 為歷史回顧文件保留）

### CI gate 狀態

GitHub Actions `test` workflow 對 main push 用 push-before-SHA (`500c790`) 當 baseRef，本次 push 跨 `feat + cache-bust` 兩顆 commit，feat 那層 cleanFiles 削弱必然觸發 [BASE] failure，CI run `26291480926` 因此紅燈。

下次任意非 deletion PR push 上 main 時 baseRef 會變成 `65c7ca3`（cache-bust commit），cleanFiles 兩邊都是 254、tsconfig include 兩邊一致，ratchet 應自動恢復綠。本次 CI 紅燈為設計內預期，不需 hotfix、不擋 deploy（Pages deploy workflow 同次 push 為綠）。

### Post-deploy ops 事件：Pages custom-domain stale cache（同次 PR 衍生）

刪除 page + D1 row + 三波 cache purge 跑完後，`https://chiyigo.com/concert-system` 仍持續回 200 + 老 HTML body，**SIN PoP 連抽 5 次都同個 cached entry，Age 線性遞增到 6843s**。對照組：

- `https://chiyigo-com.pages.dev/concert-system` → **404** ✓（Pages canonical URL 正確）
- `https://chiyigo.com/concert-system?bust=<ts>` → **404** ✓（cache-buster 強制 origin 取資料正確）
- `https://chiyigo.com/concert-system.html` → **404** ✓
- `https://chiyigo.com/concert-system/` → **404** ✓
- `https://chiyigo.com/concert-system`（exact no-query path）→ **200 stale** ✗

整 zone `cf-cache-status: DYNAMIC`（連首頁 / 都是）→ stale cache 不在 zone 邊端 cache 層。
但 response 帶 `Age: 6xxx`、`x-robots-tag: noindex`（老 deployment `_headers` 殘留）、`Cache-Control: public, s-maxage=604800` → cache 來自上游 / Pages 自家 internal asset cache layer。

**三波 purge 全失效**：
1. Custom Purge URL `/concert-system` + 6 個 concert image — Age 持續遞增
2. Custom Purge URL `/concert-system.html` + `/concert-system/` + `/concert-system` — Age 持續遞增
3. Purge Everything（zone 全清）— Age 持續遞增

Codex r1 假設「Purge Everything 不受 custom cache key 影響」在這次失效，落點修正為「stale cache 位於 zone purge 範圍外」。

#### Hypothesis

Cloudflare Pages 對 production deployment 的 static asset 有自己的 internal cache layer（綁 deployment + distribution），跟 zone 邊端 cache 是不同 system，zone-level purge（含 Purge Everything）打不到。

#### 本 commit 的雙重目的

1. Ops incident log — 留書面 trail 給未來查同類問題
2. **觸發 Pages auto-deploy** — push main 後 Pages 自動跑新 deployment，理論上會觸發 Pages 內部 asset cache 重洗 + custom-domain routing 重建。屬於 codex r2 排序的第 (1) 候選「Force Pages redeploy」

若本 commit deploy 後 `/concert-system` 仍 stale，下一步 fallback：
- `wrangler pages deploy public --project-name=chiyigo-com --branch=main --commit-dirty=true`（Direct Upload mode，可能與 GH integration 平行 deployment）
- 查 zone Cache Rules / Page Rules / Transform Rules
- 查 Cache Reserve 實際狀態
- 查 Workers Routes（看有沒有 worker 攔截路徑）

---

## 2026-06-08 — Stage 7 PR-1：functions leaf `noImplicitAny` open-strict override

第一個 (B) locked-override PR：開 functions leaf 的 `noImplicitAny`（per-flag ladder rung 1，`strict` 仍 `false`），同 PR 收編 baseline、**不修任何 error**。完整 plan 見 `docs/plans/stage7-pr1-functions-noimplicitany.md`。

- **觸發 commit**: `<squash-merge commit SHA 補註；PR #__；branch stage7-functions-noimplicitany>`
- **leaf / flag**: `functions` / `noImplicitAny`（**來源 = ratchet `[OVERRIDE]` 輸出，非 `workflow_dispatch` UI input**）
- **governance workflow run id**: `<dispatch 綠後、squash-merge 前補>`
  （`.github/workflows/strict-leaf-governance.yml`；inputs: `leaf=functions` / `reason=`見下 / `base_ref=c694366b2dd2d80639c72daf32ccd038893dd3d9`）
- **errorCount 0 → 1193**、**cleanFiles 257 → 158**
  - cleanFiles `257→158` = 過期 base baseline `257` → 實 clean `304` 刷新（`b63d971` 後新增 47 clean source）**減** 146 個 functions 檔因 noImplicitAny 落入 error；即 **`304 − 146 = 158`**。
- **reason（= `RATCHET_ALLOW_BASELINE_RAISE` env value）**:
  ```
  Stage 7 PR-1: open functions leaf noImplicitAny (per-flag ladder rung 1; strict stays false); baseline errorCount 0->1193 / cleanFiles ->158; reduce PRs follow
  ```
- **ratchet `[OVERRIDE]` 行（gate of record = governance workflow run 輸出；本地 T4 帶同一 `RATCHET_BASE_REF` 復現一致）**:
  ```
  [OVERRIDE] leaf=functions flag=noImplicitAny errorCount 0→1193 cleanFiles 257→158 baseRef=c694366b2dd2d80639c72daf32ccd038893dd3d9 reason=Stage 7 PR-1: open functions leaf noImplicitAny (per-flag ladder rung 1; strict stays false); baseline errorCount 0->1193 / cleanFiles ->158; reduce PRs follow
  ```

### 被豁免的 base-derived failures（逐字；無 env 時 `npm run typecheck:ratchet` 實測 150 行，全屬下列 5 類，**無任何 branch-local 規則觸發**）

1. `[BASE] baseline.errorCount 被同 PR 削弱：0 → 1193（baseline 只能由 error-reducing PR 降低；如需提高，走 governance review）`
2. `[BASE] baseline.cleanFiles 被同 PR 削弱：257 → 158`
3. `[BASE-B'] 新增 error 檔（base ref baseline 無對應；同 PR 改 baseline 也擋）：` + 146 個 `functions/` 檔（單行；完整清單 = `types/typecheck-baseline.json` 的 `errorsByFile` keys）
4. `[BASE-EBF] branch baseline.errorsByFile 新增 <functions/檔> (count=N) — base baseline 無此檔且非合法 rename；防 PR 同 commit 預先擴 baseline 加 budget` —— **×146**（每個 errored functions 檔一行；完整 146 檔 = `types/typecheck-baseline.json` 的 `errorsByFile` keys；首例：`functions/.well-known/jwks.json.ts (count=1)`）
5. `[BASE-D-tsconfig] tsconfig.functions.json compilerOptions.noImplicitAny 變更：false → true（影響 typecheck 強度；升級走 governance review）`

> branch-local guards（`[A]/[B]/[B']/[B'']/[SCHEMA-baseline]/[SCHEMA-baseBaseline]/[D-tsconfig]/[C]/[D/E]`）全部**不觸發** = override 設計（baseline:update 使 `current == branch baseline`；無 source、無 suppression、tsconfig snapshot 自洽）；故非豁免、亦非 budget slack。

### precondition 證明（override 啟用條件，全 AND；由 T4 綠燈機械證明）

- **P1** no-source：`git diff c694366b2dd2d80639c72daf32ccd038893dd3d9...HEAD --name-only` 僅 `tsconfig.functions.json` + `types/typecheck-baseline.json` + `docs/governance-exceptions.md` + `docs/plans/stage7-pr1-functions-noimplicitany.md`；**0 個 `.ts/.js/.mjs/.cjs/.d.ts`**。
- **P2** 單 leaf strict-family：snapshot diff（base ref live read vs working tree）恰 `tsconfig.functions.json` 的 `noImplicitAny` `false→true`。
- **P3** base errorCount==0：`c694366` 的 `types/typecheck-baseline.json` errorCount=0。
- **P4** baseline==current：baseline:update 寫 current 快照，全 derived 欄位相等。
- **P5** errorsByFile ⊆ `functions/`：146 檔全在 `functions/`（0 非 functions 路徑）。

### CI gate 狀態

一般 `ci.yml` 的 `typecheck:ratchet` step（不帶 `RATCHET_ALLOW_BASELINE_RAISE`）對本 PR **預期 RED**（上述 150 行 base-derived），屬上位 plan §3.6 Approval Record 的設計內 red、bounded per leaf（P3 機械保證同時最多一個 strict surface 未清零）。**gate of record = `strict-leaf-governance` workflow_dispatch run #`<id>`**（帶 env + base_ref，override 啟用後綠）。owner 於該 run 綠燈後 admin-merge。後續 reduce PR **不帶 env**、走正常 ratchet 下降。
