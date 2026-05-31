# Governance Entry Pointer — chiyigo.com

> chiyigo.com 是 `chiyigo-core` 治理層的 **consuming repo**。本檔是固定入口，指向共享架構規則的權威來源。

---

## 治理基線來源（pinned governance baseline — binding SSOT）

> ✅ **v0.1.3 = org-wide binding SSOT**（owner 於 2026-05-31 拍板升格）。規則內容凍結於 v0.1.2 converged baseline（Codex r1→r3 + 最終 re-review **APPROVED**，2026-05-29，0 blocking）；v0.1.3 相對 v0.1.2 無任何規則內容變更，僅狀態由 candidate 翻為 binding（PATCH）。本 baseline 為 chiyigo.com 與所有 RP 必守的架構權威，衝突一律以本 SSOT 為準（見下「與本 repo 文件的關係」）。
>
> ⚠ **「binding」≠「stable」**：已承諾但未完成的契約遷移（`sub`→`public_sub`、`tenant_id` 內部 id→public id、deny-state / 撤銷事件格式）將以未來版本演進，詳見 `chiyigo-core` README §狀態 與對應 ADR。

- **Repo**：`chiyigo-core`（與 chiyigo.com 並列；本機 `~/Desktop/chiyigo-core`）。
- **Pin**：tag `governance-v0.1.3` @ commit `aa0343735967e3f451233d08d06aacb316d3ec6a`。
  - **以 commit SHA 為準**（git tag 可被 retarget，無法單靠 tag 重現同一基線）。
  - 升級需經一次 review，不自動跟最新；升級時同時更新 tag + SHA。

## AI / 工程師開工前必讀

依序：

1. `chiyigo-core/ai/GLOBAL_AI_RULES.md` — 所有 AI 共同鐵則。
2. 角色檔：`ai/CLAUDE_CODE_CONTEXT.md`（實作）/ `ai/CODEX_REVIEW_CONTEXT.md`（審查）/ `ai/GPT_ARCHITECT_CONTEXT.md`（設計）。
3. `chiyigo-core/core/CORE_INVARIANTS.md` — 13 條不變量。
4. 與任務相關的 `core/*.md` + `adr/*.md`。

## 與本 repo 文件的關係

- `chiyigo-core` 是**規則治理基線**（org-wide **binding SSOT**，v0.1.3 起、2026-05-31 升格）；chiyigo.com 是**實作來源**，受其約束。
- 兩者衝突 → **先停手**，判斷是改實作還是開 ADR 改規則，禁靜默選一邊。
- chiyigo.com 內的舊規格文件（如 `docs/JWT_SPEC.md`）必與 `chiyigo-core` + runtime 對齊；`sub` 契約已於 2026-05-29 校正（見 `chiyigo-core` INV-1 / ADR-004）。

## 升級流程

`chiyigo-core` 出新 tag → 在此更新 pin 版本前，先過一次 review（確認新版不變量 / ADR 對本 repo 無破壞）。
