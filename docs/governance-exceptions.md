# Ratchet Governance Exceptions Log

書面留底「typecheck:ratchet 在 base ref 對比下被故意觸發 fail」的人工放行紀錄。
ratchet 設計（`scripts/typecheck-ratchet.mjs` §F4-BASE-LIVE）規定「破例需走人工 governance review，本 script 未實作 env gate」，所以每次刪除 clean TS source 或縮小 tsconfig include 都會留在這個檔。

格式：每個事件一段，列出三件事 — 觸發的 commit、ratchet 跑出來的 failure 列表（逐字）、放行理由。

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
