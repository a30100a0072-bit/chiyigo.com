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
