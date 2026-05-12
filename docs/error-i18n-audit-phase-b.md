# Phase B Backend Error Code 盤點（2026-05-12）

> Phase A 已建 `public/js/api.js#API_ERROR_I18N` 前端字典。本 doc 列出 `functions/` 下所有 `res({ error: '...' })` 缺 `code:` 欄位的處，作為 Phase B 漸進補碼依據。**本 PR 只盤點，不改 code**。

## 摘要
- 總計：**97 處**缺 `code`
- 涉及檔案：**27 個**
- 推薦新增 / 既有 i18n key：**51 個**（去重後）
- 仍標 `NEEDS_REVIEW` 待人工命名：**2 處**（佔 4%）
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
| `INTENT_NOT_FOUND` | 6 | 找不到付款單 | not_found |
| `CLIENT_NOT_FOUND` | 4 | 找不到應用程式 | Client not found |
| `INVALID_JSON` | 4 | 請求格式錯誤 | Invalid JSON |
| `REFUND_REQUEST_NOT_FOUND` | 4 | 找不到退款申請 | not_found |
| `REQUISITION_NOT_FOUND` | 4 | 找不到該需求單 | not_found |
| `FROM_DATE_INVALID` | 3 | 起始日期格式錯誤（需為 ISO 8601） | from must be ISO 8601 date/datetime |
| `INSUFFICIENT_SCOPE` | 3 | 權限不足（缺 `{required}` scope） | admin:clients:write scope required |
| `INSUFFICIENT_SCOPE` | 3 | 權限不足（缺 `{required}` scope） | admin:payments scope required |
| `INVALID_STATUS` | 3 | 狀態值無效 | invalid status |
| `TO_DATE_INVALID` | 3 | 結束日期格式錯誤（需為 ISO 8601） | to must be ISO 8601 date/datetime |
| `UNAUTHORIZED` | 3 | 未登入或登入已過期 | Unauthorized |
| `USER_ID_INVALID` | 3 | user_id 需為數字 | user_id must be a number |
| `USER_NOT_FOUND` | 3 | 找不到使用者 | User not found |
| `AUDIT_NOT_FOUND` | 2 | 找不到稽核紀錄 | not_found |
| `CRON_SECRET_NOT_CONFIGURED` | 2 | 排程密鑰未設定 | CRON_SECRET not configured |
| `ECPAY_REFUND_FAILED` | 2 | 綠界退款失敗 | ECPay refund failed |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:audit:write scope required |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:payments:refund scope required |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:payments:* scope required |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:users:write scope required |
| `INTERNAL_ERROR` | 2 | 系統錯誤，請稍後再試 | chiyigo_db binding missing |
| `INVALID_USER_ID` | 2 | 使用者 ID 格式錯誤 | Invalid user id |
| `REFUND_NOT_IMPLEMENTED` | 2 | 此金流供應商尚未支援退款 | refund not implemented for vendor: ${intent.vendor} |
| `TRADE_NO_NOT_FOUND` | 2 | 找不到交易序號 | TradeNo not found; cannot call refund API |
| `UNAUTHORIZED` | 2 | 未登入或登入已過期 | unauthorized |
| `WEBHOOK_VALIDATION_FAILED` | 2 | Webhook 驗證失敗 | Webhook validation failed |
| `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE` | 1 | 無法對同等或更高權限的使用者執行此操作 | Cannot revoke a user with equal or higher role |
| `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE` | 1 | 無法對同等或更高權限的使用者執行此操作 | Cannot ban a user with equal or higher role |
| `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE` | 1 | 無法對同等或更高權限的使用者執行此操作 | Cannot unban a user with equal or higher role |
| `CANNOT_TARGET_SELF` | 1 | 無法對自己執行此操作 | Cannot revoke your own tokens via admin API |
| `CANNOT_TARGET_SELF` | 1 | 無法對自己執行此操作 | Cannot ban yourself |
| `CAPTCHA_FAILED` | 1 | 人機驗證失敗 | captcha_failed |
| `CLIENT_ALREADY_DISABLED` | 1 | 應用程式已被停用 | Client already disabled |
| `DEVICE_UUID_REQUIRED` | 1 | 請提供 device_uuid | device_uuid is required for mode=device |
| `INTENT_ID_REQUIRED` | 1 | 請提供 intent_id | intent_id required |
| `INTERNAL_ERROR` | 1 | 系統錯誤，請稍後再試 | AUDIT_ARCHIVE_BUCKET binding missing |
| `INTERNAL_ERROR` | 1 | 系統錯誤，請稍後再試 | requireStepUp must check an elevated:* scope |
| `INVALID_MODE` | 1 | mode 參數無效 | mode must be one of: ${[...VALID_MODES].join(', ')} |
| `INVALID_SEVERITY` | 1 | severity 必須為 info / warn / critical | severity must be info \| warn \| critical |
| `JTI_REQUIRED` | 1 | 請提供 jti | jti is required for mode=jti |
| `LINKED_INTENT_NOT_FOUND` | 1 | 找不到關聯的付款單 | linked intent not found |
| `NEEDS_REVIEW` ⚠️ | 1 | （待補） | invalid JSON body |
| `NEEDS_REVIEW` ⚠️ | 1 | （待補） | action must be one of ${[...VALID_ACTIONS].join(', ')} |
| `NO_UPDATABLE_FIELDS` | 1 | 沒有可更新的欄位 | No updatable fields provided |
| `PRE_AUTH_TOKEN_FORBIDDEN` | 1 | Token 權限不足，請先完成兩步驟驗證 | Forbidden: pre_auth token cannot access this resource |
| `UNKNOWN_KYC_VENDOR` | 1 | 未知的 KYC 廠商 | Unknown KYC vendor: ${vendor} |
| `UNKNOWN_PAYMENT_VENDOR` | 1 | 未知的金流廠商 | Unknown payment vendor: ${vendor} |
| `USER_ALREADY_BANNED` | 1 | 使用者已被停用 | User is already banned |
| `USER_ID_INVALID` | 1 | user_id 需為數字 | user_id must be a positive integer |
| `USER_NOT_BANNED` | 1 | 使用者並未被停用 | User is not banned |
| `WRONG_TOKEN_SCOPE` | 1 | Token 權限範圍錯誤 | Forbidden: wrong token scope |

> ⚠️ = 仍標 `NEEDS_REVIEW`，建議實作 PR 動工時逐條定名
> `INSUFFICIENT_SCOPE` 樣板化：i18n 字串內含 `{required}` 參數，傳入後端的 scope 字串

### 命名衝突 / 故意合併（同 code 對應多字串）

> 多數為**故意合併**（大小寫不同、措辭微異但語意一致），實作 PR 補 code 時挑一個對應的英文字串即可；真要拆碼會在這次 review 標註。
- `UNAUTHORIZED`：
  - "Unauthorized"
  - "unauthorized"
- `USER_ID_INVALID`：
  - "user_id must be a number"
  - "user_id must be a positive integer"
- `INTERNAL_ERROR`：
  - "chiyigo_db binding missing"
  - "AUDIT_ARCHIVE_BUCKET binding missing"
  - "requireStepUp must check an elevated:* scope"
- `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE`：
  - "Cannot revoke a user with equal or higher role"
  - "Cannot ban a user with equal or higher role"
  - "Cannot unban a user with equal or higher role"
- `CANNOT_TARGET_SELF`：
  - "Cannot revoke your own tokens via admin API"
  - "Cannot ban yourself"
- `NEEDS_REVIEW`：
  - "invalid JSON body"
  - "action must be one of ${[...VALID_ACTIONS].join(', ')}"

## 逐檔清單

### functions/api/admin/audit-archive/retry.js（4 處）
- L98 `'admin:audit:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:audit:write`）
- L102 `'chiyigo_db binding missing'` → `INTERNAL_ERROR`
- L105 `'invalid JSON body'` → `NEEDS_REVIEW` ⚠️
- L114 `'action must be one of ${[...VALID_ACTIONS].join(', ')}'` → `NEEDS_REVIEW` ⚠️

### functions/api/admin/audit.js（4 處）
- L86 `'user_id must be a number'` → `USER_ID_INVALID`
- L98 `'severity must be info | warn | critical'` → `INVALID_SEVERITY`
- L106 `'from must be ISO 8601 date/datetime'` → `FROM_DATE_INVALID`
- L111 `'to must be ISO 8601 date/datetime'` → `TO_DATE_INVALID`

### functions/api/admin/audit/[id].js（3 處）
- L27 `'admin:audit:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:audit:write`）
- L31 `'not_found'` → `AUDIT_NOT_FOUND`
- L36 `'not_found'` → `AUDIT_NOT_FOUND`

### functions/api/admin/cron/audit-archive.js（4 處）
- L181 `'CRON_SECRET not configured'` → `CRON_SECRET_NOT_CONFIGURED`
- L182 `'unauthorized'` → `UNAUTHORIZED`
- L186 `'AUDIT_ARCHIVE_BUCKET binding missing'` → `INTERNAL_ERROR`
- L188 `'chiyigo_db binding missing'` → `INTERNAL_ERROR`

### functions/api/admin/cron/cleanup.js（2 處）
- L82 `'CRON_SECRET not configured'` → `CRON_SECRET_NOT_CONFIGURED`
- L83 `'unauthorized'` → `UNAUTHORIZED`

### functions/api/admin/deals.js（3 處）
- L62 `'user_id must be a number'` → `USER_ID_INVALID`
- L69 `'from must be ISO 8601 date/datetime'` → `FROM_DATE_INVALID`
- L74 `'to must be ISO 8601 date/datetime'` → `TO_DATE_INVALID`

### functions/api/admin/oauth-clients.js（2 處）
- L137 `'admin:clients:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:clients:write`）
- L142 `'Invalid JSON'` → `INVALID_JSON`

### functions/api/admin/oauth-clients/[client_id].js（9 處）
- L56 `'Client not found'` → `CLIENT_NOT_FOUND`
- L141 `'admin:clients:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:clients:write`）
- L146 `'Invalid JSON'` → `INVALID_JSON`
- L150 `'No updatable fields provided'` → `NO_UPDATABLE_FIELDS`
- L156 `'Client not found'` → `CLIENT_NOT_FOUND`
- L178 `'Client not found'` → `CLIENT_NOT_FOUND`
- L200 `'admin:clients:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:clients:write`）
- L207 `'Client not found'` → `CLIENT_NOT_FOUND`
- L208 `'Client already disabled'` → `CLIENT_ALREADY_DISABLED`

### functions/api/admin/payments/aggregate.js（1 處）
- L45 `'invalid status'` → `INVALID_STATUS`

### functions/api/admin/payments/intents.js（5 處）
- L48 `'admin:payments scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:payments`）
- L83 `'user_id must be a number'` → `USER_ID_INVALID`
- L89 `'invalid status'` → `INVALID_STATUS`
- L101 `'from must be ISO 8601 date/datetime'` → `FROM_DATE_INVALID`
- L106 `'to must be ISO 8601 date/datetime'` → `TO_DATE_INVALID`

### functions/api/admin/payments/intents/[id]/delete.js（3 處）
- L47 `'admin:payments scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:payments`）
- L51 `'not_found'` → `INTENT_NOT_FOUND`
- L54 `'not_found'` → `INTENT_NOT_FOUND`

### functions/api/admin/payments/intents/[id]/refund.js（6 處）
- L61 `'admin:payments:refund scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:payments:refund`）
- L65 `'not_found'` → `INTENT_NOT_FOUND`
- L68 `'not_found'` → `INTENT_NOT_FOUND`
- L79 `'refund not implemented for vendor: ${intent.vendor}'` → `REFUND_NOT_IMPLEMENTED`
- L100 `'TradeNo not found; cannot call refund API'` → `TRADE_NO_NOT_FOUND`
- L160 `'ECPay refund failed'` → `ECPAY_REFUND_FAILED`

### functions/api/admin/payments/metadata-archive.js（2 處）
- L38 `'admin:payments:* scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:payments:*`）
- L44 `'intent_id required'` → `INTENT_ID_REQUIRED`

### functions/api/admin/payments/webhook-dlq.js（1 處）
- L39 `'admin:payments:* scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:payments:*`）

### functions/api/admin/requisition-refund.js（1 處）
- L53 `'invalid status'` → `INVALID_STATUS`

### functions/api/admin/requisition-refund/[id]/approve.js（7 處）
- L51 `'admin:payments:refund scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:payments:refund`）
- L55 `'not_found'` → `REFUND_REQUEST_NOT_FOUND`
- L62 `'not_found'` → `REFUND_REQUEST_NOT_FOUND`
- L72 `'linked intent not found'` → `LINKED_INTENT_NOT_FOUND`
- L81 `'refund not implemented for vendor: ${intent.vendor}'` → `REFUND_NOT_IMPLEMENTED`
- L105 `'TradeNo not found; cannot call refund API'` → `TRADE_NO_NOT_FOUND`
- L163 `'ECPay refund failed'` → `ECPAY_REFUND_FAILED`

### functions/api/admin/requisition-refund/[id]/reject.js（3 處）
- L38 `'admin:payments scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:payments`）
- L42 `'not_found'` → `REFUND_REQUEST_NOT_FOUND`
- L49 `'not_found'` → `REFUND_REQUEST_NOT_FOUND`

### functions/api/admin/requisitions/[id]/delete.js（2 處）
- L37 `'not_found'` → `REQUISITION_NOT_FOUND`
- L43 `'not_found'` → `REQUISITION_NOT_FOUND`

### functions/api/admin/requisitions/[id]/save.js（2 處）
- L42 `'not_found'` → `REQUISITION_NOT_FOUND`
- L49 `'not_found'` → `REQUISITION_NOT_FOUND`

### functions/api/admin/revoke.js（8 處）
- L48 `'Invalid JSON'` → `INVALID_JSON`
- L52 `'mode must be one of: ${[...VALID_MODES].join(', ')}'` → `INVALID_MODE`
- L59 `'jti is required for mode=jti'` → `JTI_REQUIRED`
- L86 `'user_id must be a positive integer'` → `USER_ID_INVALID`
- L89 `'Cannot revoke your own tokens via admin API'` → `CANNOT_TARGET_SELF`
- L95 `'User not found'` → `USER_NOT_FOUND`
- L107 `'Cannot revoke a user with equal or higher role'` → `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE`
- L141 `'device_uuid is required for mode=device'` → `DEVICE_UUID_REQUIRED`

### functions/api/admin/users/[id]/ban.js（6 處）
- L27 `'admin:users:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:users:write`）
- L31 `'Invalid user id'` → `INVALID_USER_ID`
- L32 `'Cannot ban yourself'` → `CANNOT_TARGET_SELF`
- L41 `'User not found'` → `USER_NOT_FOUND`
- L53 `'Cannot ban a user with equal or higher role'` → `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE`
- L55 `'User is already banned'` → `USER_ALREADY_BANNED`

### functions/api/admin/users/[id]/unban.js（5 處）
- L30 `'admin:users:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:users:write`）
- L34 `'Invalid user id'` → `INVALID_USER_ID`
- L43 `'User not found'` → `USER_NOT_FOUND`
- L55 `'Cannot unban a user with equal or higher role'` → `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE`
- L57 `'User is not banned'` → `USER_NOT_BANNED`

### functions/api/payments/intents/[id]/refund-request.js（3 處）
- L25 `'not_found'` → `INTENT_NOT_FOUND`
- L29 `'Invalid JSON'` → `INVALID_JSON`
- L40 `'not_found'` → `INTENT_NOT_FOUND`

### functions/api/webhooks/kyc/[vendor].js（2 處）
- L28 `'Unknown KYC vendor: ${vendor}'` → `UNKNOWN_KYC_VENDOR`
- L38 `'Webhook validation failed'` → `WEBHOOK_VALIDATION_FAILED`

### functions/api/webhooks/payments/[vendor].js（2 處）
- L32 `'Unknown payment vendor: ${vendor}'` → `UNKNOWN_PAYMENT_VENDOR`
- L60 `'Webhook validation failed'` → `WEBHOOK_VALIDATION_FAILED`

### functions/utils/auth.js（6 處）
- L31 `'Unauthorized'` → `UNAUTHORIZED`
- L36 `'Unauthorized'` → `UNAUTHORIZED`
- L45 `'Unauthorized'` → `UNAUTHORIZED`
- L66 `'Forbidden: wrong token scope'` → `WRONG_TOKEN_SCOPE`
- L71 `'Forbidden: pre_auth token cannot access this resource'` → `PRE_AUTH_TOKEN_FORBIDDEN`
- L211 `'requireStepUp must check an elevated:* scope'` → `INTERNAL_ERROR`

### functions/utils/turnstile.js（1 處）
- L15 `'captcha_failed'` → `CAPTCHA_FAILED`

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

### PR B-4 (Admin 後台)
- 檔案：22 個，處數：**83**
  - functions/api/admin/audit-archive/retry.js
  - functions/api/admin/audit.js
  - functions/api/admin/audit/[id].js
  - functions/api/admin/cron/audit-archive.js
  - functions/api/admin/cron/cleanup.js
  - functions/api/admin/deals.js
  - functions/api/admin/oauth-clients.js
  - functions/api/admin/oauth-clients/[client_id].js
  - functions/api/admin/payments/aggregate.js
  - functions/api/admin/payments/intents.js
  - functions/api/admin/payments/intents/[id]/delete.js
  - functions/api/admin/payments/intents/[id]/refund.js
  - functions/api/admin/payments/metadata-archive.js
  - functions/api/admin/payments/webhook-dlq.js
  - functions/api/admin/requisition-refund.js
  - functions/api/admin/requisition-refund/[id]/approve.js
  - functions/api/admin/requisition-refund/[id]/reject.js
  - functions/api/admin/requisitions/[id]/delete.js
  - functions/api/admin/requisitions/[id]/save.js
  - functions/api/admin/revoke.js
  - functions/api/admin/users/[id]/ban.js
  - functions/api/admin/users/[id]/unban.js

### PR B-5 (Payments / Webhooks)
- 檔案：3 個，處數：**7**
  - functions/api/payments/intents/[id]/refund-request.js
  - functions/api/webhooks/kyc/[vendor].js
  - functions/api/webhooks/payments/[vendor].js

### PR B-6 (utils 共用)
- 檔案：2 個，處數：**7**
  - functions/utils/auth.js
  - functions/utils/turnstile.js

## 工具
- 掃描器：`scripts/audit-error-i18n.mjs`（純讀取，bracket-match 解析 `res({...})`）
- 渲染器：`scripts/audit-error-i18n-render.mjs`（含 `MANUAL_CODE_MAP` + file-context 規則）
- 重跑：`node scripts/audit-error-i18n.mjs functions > scripts/audit-error-i18n.out.json && node scripts/audit-error-i18n-render.mjs`
- 中介產物 `scripts/audit-error-i18n.out.json` 已加入 `.gitignore`，需要時重跑即可
