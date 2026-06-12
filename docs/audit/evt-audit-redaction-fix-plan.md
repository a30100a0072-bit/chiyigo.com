# EVT-006 修補 Plan：admin/revoke device_uuid 稽核 redaction（audit-redaction tiny PR）

> Gate State: **PLAN_REVISED**（Codex Plan Gate r1 = Revise Required；finding 已修，見 §5 → 送 Codex 確認）
> 來源 finding：`docs/audit/03-event-consistency.md` §2 EVT-006（P3，trivial）。owner 裁決（2026-06-12）：tiny PR 窗內修。
> Dual Gate Workflow：本 plan 過 Codex Plan Gate 才進 Code。

---

## 1. 問題（已驗證）

`functions/api/admin/revoke.ts:200,217`（device-mode 的 partial 與 ok 兩條稽核路徑）把 admin 提供的 `device_uuid` **全值明文**寫入 audit data。repo 既定慣例是 keyed-HMAC：`devices/logout.ts:101-105` 同欄位走 `hashIdentifierForAudit(env,'device-uuid',…)` → `device_uuid_hmac16`（Codex r9-4）；`device-alerts.ts:67-75` 第三處同款。`user-audit.ts:19` 檔內約定明寫 device_uuid 應截斷；threat model（`user-audit.ts:198-233`，audit DB 外洩後反查）對 admin-context 同樣適用——device_uuid 參與 refresh device-binding（`refresh.ts:185-186`），raw 值可配合被竊 refresh token 通過綁定。

## 2. 修法

`admin/revoke.ts` 兩處稽核 data 改。**helper 回傳 `{ hex, bytes, salted }`**（`user-audit.ts:215-233`）；slice(0,16) + 記 `salted` 與 `devices/logout.ts:101-105`、`device-alerts.ts:67-75` 既有模式逐字對齊：

```ts
const sig = await hashIdentifierForAudit(env, 'device-uuid', deviceUuid)
// audit data（兩處同款）：
device_uuid_hmac16: sig.hex.slice(0, 16),
salted: sig.salted,
```

（移除明文 `device_uuid` 鍵；欄位名與 `devices/logout.ts` 對齊＝同概念同字串。）import 既有 helper，無其他變更。**不動** emit/session-revoke 邏輯、不動 response shape（若 response body 也回 device_uuid——admin 自己送進來的值，回顯不屬 audit 落庫面，不在 scope）。

## 3. 測試

integration（沿用 admin/revoke 既有測試檔 fixture）：admin device-mode revoke 後查 `audit_log`，斷言 `JSON.parse(event_data).device_uuid === undefined`、`device_uuid_hmac16` 存在且長度 16、`salted` 欄位存在（boolean）（pre-fix 紅：明文在、無 hmac16）。partial 與 ok 兩路徑各一案。既有 revoke 測試全綠。

## 4. 變更檔案 / AC / Non-goals

- `functions/api/admin/revoke.ts`（2 處）+ 對應 test 檔。無 migration / schema / 套件。
- AC：repro pre-fix 紅 post-fix 綠；typecheck/lint/build/tests 綠；ratchet 零新增。
- Non-goals：不做全站 audit-PII allowlist 盤點（屬 P4 安全邊界整面矩陣的 audit 欄）。

## 5. Codex Plan Gate r1 對照（2026-06-12）

- **Finding「audit shape 寫錯」→ 已修**：§2 程式片段由 `device_uuid_hmac16: await hashIdentifierForAudit(...)`（誤把整個回傳物件當值）改為 `const sig = await ...; device_uuid_hmac16: sig.hex.slice(0,16), salted: sig.salted`，與三處既有 site 模式逐字對齊；§3 測試斷言同步補 `salted`。
