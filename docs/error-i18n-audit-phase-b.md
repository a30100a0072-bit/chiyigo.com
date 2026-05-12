# Phase B Backend Error Code 盤點（2026-05-12）

> Phase A 已建 `public/js/api.js#API_ERROR_I18N` 前端字典。本 doc 列出 `functions/` 下所有 `res({ error: '...' })` 缺 `code:` 欄位的處，作為 Phase B 漸進補碼依據。**本 PR 只盤點，不改 code**。

## 摘要
- 總計：**0 處**缺 `code`
- 涉及檔案：**0 個**
- 推薦新增 / 既有 i18n key：**0 個**（去重後）
- 仍標 `NEEDS_REVIEW` 待人工命名：**0 處**（佔 NaN%）
- 變數型 `error: <expr>` 警告：**7 處**（列在文末警告區）
- 已有 code 但前端 dict 缺翻譯：**0 個 code**（列在「漏譯」區）

### 判定規則
- 掃描 `res({ ... })` 物件 literal 字面值；同一物件 literal 內若有 `code: '...'` 字串欄位則跳過（已 OK）
- `error:` 後接識別字 / 表達式視為「變數型」，列警告區
- 多行物件 literal 用 `{` `}` 配對解析，字串內 `{` 不影響配對
- 命名來源優先序：file-context（如 NOT_FOUND → INTENT_NOT_FOUND）→ MANUAL_CODE_MAP → SCOPE_REQUIRED → 原樣 → `NEEDS_REVIEW`

## 推薦新 code 列表（去重 + 建議 zh-TW / en）

| code | 出現處數 | 建議 zh-TW | 建議 en |
|---|---:|---|---|

> ⚠️ = 仍標 `NEEDS_REVIEW`，建議實作 PR 動工時逐條定名
> `INSUFFICIENT_SCOPE` 樣板化：i18n 字串內含 `{required}` 參數，傳入後端的 scope 字串

### 命名衝突
無（INSUFFICIENT_SCOPE 樣板化處理不算衝突）

## 逐檔清單

## 警告區（error 是變數 / 表達式，無從翻譯）

- functions/api/admin/audit-archive/retry.js:L119 — `error: tgtErr`
- functions/api/admin/oauth-clients.js:L145 — `error: v.error`
- functions/api/auth/account/change-password.js:L56 — `error: pwCheck.error`
- functions/api/auth/local/register.js:L42 — `error: pwCheck.error`
- functions/api/auth/local/reset-password.js:L36 — `error: pwCheck.error`
- functions/api/auth/oauth/[provider]/init.js:L132 — `error: err.message`
- functions/api/requisition.js:L79 — `error: err`

> 處理建議：上游 catch 處改用 `res({ code: 'INTERNAL_ERROR', error: e.message }, 500)`，前端優先讀 code、保留 error 供 debug。

## 後續 PR 切分建議

## 工具
- 掃描器：`scripts/audit-error-i18n.mjs`（純讀取，bracket-match 解析 `res({...})`）
- 渲染器：`scripts/audit-error-i18n-render.mjs`（含 `MANUAL_CODE_MAP` + file-context 規則）
- 重跑：`node scripts/audit-error-i18n.mjs functions > scripts/audit-error-i18n.out.json && node scripts/audit-error-i18n-render.mjs`
- 中介產物 `scripts/audit-error-i18n.out.json` 已加入 `.gitignore`，需要時重跑即可
