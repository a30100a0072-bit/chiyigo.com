# Governance Entry Pointer — chiyigo.com

> chiyigo.com 是 `chiyigo-core` 治理層的 **consuming repo**。本檔是固定入口，指向共享架構規則的權威來源。

---

## 治理基線來源（pinned governance baseline — candidate）

> ⚠ v0.1.2 已經 **Codex final re-review APPROVED**（approved as active candidate pin）；但**仍是 candidate baseline**，**尚未**宣告為 org-wide binding SSOT。升格（adoption / publish）為 **owner 決策**（Codex review gate 已完成）。

- **Repo**：`chiyigo-core`（與 chiyigo.com 並列；本機 `~/Desktop/chiyigo-core`）。
- **Pin**：tag `governance-v0.1.2` @ commit `f865657f10b84192d464b5d76c853aa934abbcb0`。
  - **以 commit SHA 為準**（git tag 可被 retarget，無法單靠 tag 重現同一基線）。
  - 升級需經一次 review，不自動跟最新；升級時同時更新 tag + SHA。

## AI / 工程師開工前必讀

依序：

1. `chiyigo-core/ai/GLOBAL_AI_RULES.md` — 所有 AI 共同鐵則。
2. 角色檔：`ai/CLAUDE_CODE_CONTEXT.md`（實作）/ `ai/CODEX_REVIEW_CONTEXT.md`（審查）/ `ai/GPT_ARCHITECT_CONTEXT.md`（設計）。
3. `chiyigo-core/core/CORE_INVARIANTS.md` — 13 條不變量。
4. 與任務相關的 `core/*.md` + `adr/*.md`。

## 與本 repo 文件的關係

- `chiyigo-core` 是**規則治理基線**（candidate；Codex re-review 已 approve，升格為 binding SSOT 待 owner adoption 決策）；chiyigo.com 是**實作來源**。
- 兩者衝突 → **先停手**，判斷是改實作還是開 ADR 改規則，禁靜默選一邊。
- chiyigo.com 內的舊規格文件（如 `docs/JWT_SPEC.md`）必與 `chiyigo-core` + runtime 對齊；`sub` 契約已於 2026-05-29 校正（見 `chiyigo-core` INV-1 / ADR-004）。

## 升級流程

`chiyigo-core` 出新 tag → 在此更新 pin 版本前，先過一次 review（確認新版不變量 / ADR 對本 repo 無破壞）。
