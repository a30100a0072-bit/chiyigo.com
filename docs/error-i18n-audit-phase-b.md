# Phase B Backend Error Code 盤點（2026-05-12）

> Phase A 已建 `public/js/api.js#API_ERROR_I18N` 前端字典。本 doc 列出 `functions/` 下所有 `res({ error: '...' })` 缺 `code:` 欄位的處，作為 Phase B 漸進補碼依據。**本 PR 只盤點，不改 code**。

## 摘要
- 總計：**227 處**缺 `code`
- 涉及檔案：**55 個**
- 推薦新增 / 既有 i18n key：**133 個**（去重後）
- 仍標 `NEEDS_REVIEW` 待人工命名：**2 處**（佔 2%）
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
| `INVALID_JSON` | 21 | 請求格式錯誤 | Invalid JSON |
| `USER_NOT_FOUND` | 11 | 找不到使用者 | User not found |
| `INTENT_NOT_FOUND` | 10 | 找不到付款單 | not_found |
| `REQUISITION_NOT_FOUND` | 8 | 找不到該需求單 | not_found |
| `INVALID_CREDENTIALS` | 5 | 帳號或密碼錯誤 | Invalid credentials |
| `CLIENT_NOT_FOUND` | 4 | 找不到應用程式 | Client not found |
| `REFUND_REQUEST_NOT_FOUND` | 4 | 找不到退款申請 | not_found |
| `FROM_DATE_INVALID` | 3 | 起始日期格式錯誤（需為 ISO 8601） | from must be ISO 8601 date/datetime |
| `INSUFFICIENT_SCOPE` | 3 | 權限不足（缺 `{required}` scope） | admin:clients:write scope required |
| `INSUFFICIENT_SCOPE` | 3 | 權限不足（缺 `{required}` scope） | admin:payments scope required |
| `INVALID_ID` | 3 | 識別碼格式錯誤 | Invalid id |
| `INVALID_STATUS` | 3 | 狀態值無效 | invalid status |
| `TO_DATE_INVALID` | 3 | 結束日期格式錯誤（需為 ISO 8601） | to must be ISO 8601 date/datetime |
| `UNAUTHORIZED` | 3 | 未登入或登入已過期 | Unauthorized |
| `USER_ID_INVALID` | 3 | user_id 需為數字 | user_id must be a number |
| `AUDIT_NOT_FOUND` | 2 | 找不到稽核紀錄 | not_found |
| `CREDENTIAL_NOT_FOUND` | 2 | 找不到憑證 | Credential not found |
| `CRON_SECRET_NOT_CONFIGURED` | 2 | 排程密鑰未設定 | CRON_SECRET not configured |
| `ECPAY_REFUND_FAILED` | 2 | 綠界退款失敗 | ECPay refund failed |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:audit:write scope required |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:payments:refund scope required |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:payments:* scope required |
| `INSUFFICIENT_SCOPE` | 2 | 權限不足（缺 `{required}` scope） | admin:users:write scope required |
| `INTERNAL_ERROR` | 2 | 系統錯誤，請稍後再試 | chiyigo_db binding missing |
| `INTERNAL_ERROR` | 2 | 系統錯誤，請稍後再試 | Internal error |
| `INVALID_CLIENT_DATA` | 2 | clientDataJSON 格式錯誤 | Invalid clientDataJSON |
| `INVALID_TOKEN_SUBJECT` | 2 | Token subject 無效 | Invalid token subject |
| `INVALID_USER_ID` | 2 | 使用者 ID 格式錯誤 | Invalid user id |
| `RATE_LIMITED` | 2 | 請求過於頻繁，請稍後再試 | Too many requests. Please try again later. |
| `REFRESH_TOKEN_REVOKED` | 2 | 登入憑證已失效，請重新登入 | Refresh token has been revoked |
| `REFUND_NOT_IMPLEMENTED` | 2 | 此金流供應商尚未支援退款 | refund not implemented for vendor: ${intent.vendor} |
| `REQUISITION_DAILY_LIMIT` | 2 | 今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們 | 今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們 |
| `RESPONSE_REQUIRED` | 2 | 請完成人機驗證 | response is required |
| `TRADE_NO_NOT_FOUND` | 2 | 找不到交易序號 | TradeNo not found; cannot call refund API |
| `UNAUTHORIZED` | 2 | 未登入或登入已過期 | unauthorized |
| `WEBAUTHN_VERIFICATION_FAILED` | 2 | WebAuthn 驗證失敗 | Verification failed |
| `WEBHOOK_VALIDATION_FAILED` | 2 | Webhook 驗證失敗 | Webhook validation failed |
| `ACCOUNT_BANNED` | 1 | 帳號已被停用 | Account is banned |
| `ACCOUNT_DISABLED` | 1 | 此帳號已被停用 | 此帳號已被停用 |
| `ACCOUNT_LOOKUP_FAILED_AFTER_CREATE` | 1 | 帳號建立後無法查詢，請稍後重試 | 帳號建立後無法查詢，請稍後重試 |
| `ACCOUNT_NOT_FOUND` | 1 | 找不到帳號 | Account not found or already deleted |
| `ACCOUNT_NOT_FOUND` | 1 | 找不到帳號 | Account not found |
| `AI_DAILY_LIMIT` | 1 | 今日 AI 助手呼叫次數已達上限 | 今日 AI 助手呼叫次數已達上限，請稍後再試或直接填寫表單 |
| `APPLE_LOGIN_NOT_AVAILABLE` | 1 | Apple 登入尚未開放 | Apple 登入尚未開放 |
| `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE` | 1 | 無法對同等或更高權限的使用者執行此操作 | Cannot revoke a user with equal or higher role |
| `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE` | 1 | 無法對同等或更高權限的使用者執行此操作 | Cannot ban a user with equal or higher role |
| `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE` | 1 | 無法對同等或更高權限的使用者執行此操作 | Cannot unban a user with equal or higher role |
| `CANNOT_TARGET_SELF` | 1 | 無法對自己執行此操作 | Cannot revoke your own tokens via admin API |
| `CANNOT_TARGET_SELF` | 1 | 無法對自己執行此操作 | Cannot ban yourself |
| `CAPTCHA_FAILED` | 1 | 人機驗證失敗 | captcha_failed |
| `CHALLENGE_INVALID_OR_EXPIRED` | 1 | Challenge 無效或已過期 | Challenge invalid or expired |
| `CHALLENGE_MISMATCH` | 1 | Challenge 不符 | Challenge mismatch |
| `CLIENT_ALREADY_DISABLED` | 1 | 應用程式已被停用 | Client already disabled |
| `CREDENTIAL_ALREADY_REGISTERED` | 1 | 此憑證已註冊 | Credential already registered |
| `DEVICE_MISMATCH` | 1 | 裝置不符 | Device mismatch |
| `DEVICE_NOT_FOUND` | 1 | 找不到裝置 | Device not found |
| `DEVICE_UUID_REQUIRED` | 1 | 請提供 device_uuid | device_uuid is required for mode=device |
| `EMAIL_ALREADY_VERIFIED` | 1 | Email 已驗證 | Email already verified |
| `EMAIL_SEND_FAILED` | 1 | 寄送 Email 失敗，請稍後再試 | Failed to send confirmation email, please try again later |
| `EMAIL_SEND_FAILED` | 1 | 寄送 Email 失敗，請稍後再試 | Failed to send email, please try again later |
| `EMAIL_USED_BIND_AFTER_LOGIN` | 1 | 此信箱已被既有帳號使用，請改用既有方式登入後綁定 | 此信箱已被既有帳號使用。請改用既有方式登入，登入後可在帳號設定中綁定 ${provider} 帳號。 |
| `INCORRECT_PASSWORD` | 1 | 密碼錯誤 | Incorrect password |
| `INTENT_ID_REQUIRED` | 1 | 請提供 intent_id | intent_id required |
| `INTERNAL_ERROR` | 1 | 系統錯誤，請稍後再試 | AUDIT_ARCHIVE_BUCKET binding missing |
| `INTERNAL_ERROR` | 1 | 系統錯誤，請稍後再試 | Server error |
| `INTERNAL_ERROR` | 1 | 系統錯誤，請稍後再試 | requireStepUp must check an elevated:* scope |
| `INVALID_AUTHORIZATION_CODE` | 1 | 授權碼無效或已過期 | Invalid or expired authorization code |
| `INVALID_DELETION_TOKEN` | 1 | 刪除帳號 Token 無效或已過期 | Invalid or expired deletion token |
| `INVALID_DEVICE_UUID` | 1 | device_uuid 格式錯誤 | device_uuid must be string or null |
| `INVALID_EMAIL_FORMAT` | 1 | 信箱格式無效 | 信箱格式無效 |
| `INVALID_FOR_ACTION` | 1 | for_action 格式錯誤 | for_action must be a non-empty string when provided |
| `INVALID_MODE` | 1 | mode 參數無效 | mode must be one of: ${[...VALID_MODES].join(', ')} |
| `INVALID_NICKNAME` | 1 | 暱稱格式錯誤 | nickname must be a non-empty string up to ${NICKNAME_MAX} chars |
| `INVALID_OTP_OR_BACKUP_CODE` | 1 | 驗證碼或備援碼錯誤 | Invalid OTP or backup code |
| `INVALID_PKCE_SESSION` | 1 | PKCE Session 無效或已過期 | Invalid or expired PKCE session |
| `INVALID_PLATFORM` | 1 | platform 必須為 web、pc 或 mobile | Invalid platform. Must be web, pc, or mobile. |
| `INVALID_PLATFORM` | 1 | platform 必須為 web、pc 或 mobile | platform 必須為 web、pc 或 mobile |
| `INVALID_REFRESH_TOKEN` | 1 | Refresh Token 無效或已過期 | Invalid or expired refresh token |
| `INVALID_REQUEST_FORMAT` | 1 | 無效的請求格式 | 無效的請求格式 |
| `INVALID_SCOPE` | 1 | scope 參數無效 | scope must be one of: ${[...KNOWN_ELEVATED_SCOPES].join(', ')} |
| `INVALID_SEVERITY` | 1 | severity 必須為 info / warn / critical | severity must be info \| warn \| critical |
| `INVALID_WALLET_ADDRESS` | 1 | 錢包地址格式錯誤 | Invalid Ethereum address |
| `JTI_REQUIRED` | 1 | 請提供 jti | jti is required for mode=jti |
| `LAST_AUTH_METHOD` | 1 | 無法移除最後一個登入方式 | Cannot remove the last authentication method. |
| `LINK_INVALID_OR_EXPIRED` | 1 | 連結無效或已過期，請重新登入 | 連結無效或已過期，請重新登入 |
| `LINK_TYPE_INVALID` | 1 | 連結類型錯誤 | 連結類型錯誤 |
| `LINKED_INTENT_NOT_FOUND` | 1 | 找不到關聯的付款單 | linked intent not found |
| `MISSING_REQUIRED_FIELD` | 1 | 缺少必要欄位 | 缺少必要欄位 |
| `NEEDS_REVIEW` ⚠️ | 1 | （待補） | invalid JSON body |
| `NEEDS_REVIEW` ⚠️ | 1 | （待補） | action must be one of ${[...VALID_ACTIONS].join(', ')} |
| `NEW_PASSWORD_REQUIRED` | 1 | 請提供新密碼 | new_password is required |
| `NO_UPDATABLE_FIELDS` | 1 | 沒有可更新的欄位 | No updatable fields provided |
| `NONCE_INVALID_OR_EXPIRED` | 1 | Nonce 無效或已過期 | Nonce invalid or expired |
| `NONCE_MISMATCH` | 1 | Nonce 不符 | Nonce mismatch |
| `OAUTH_AUTHORIZE_REQUIRED_FIELDS` | 1 | 請提供 redirect_uri、code_challenge、state | redirect_uri, code_challenge, and state are required |
| `OAUTH_CODE_REQUIRED_FIELDS` | 1 | 請提供 code、code_verifier、redirect_uri | code, code_verifier, and redirect_uri are required |
| `OAUTH_STATE_SAVE_FAILED` | 1 | OAuth 狀態儲存失敗，請重試 | OAuth 狀態儲存失敗，請重試 |
| `OAUTH_UNSUPPORTED_PKCE_METHOD` | 1 | 僅支援 code_challenge_method=S256 | Only code_challenge_method=S256 is supported |
| `OAUTH_UNSUPPORTED_RESPONSE_TYPE` | 1 | 僅支援 response_type=code | Only response_type=code is supported |
| `OTP_CODE_INVALID_FORMAT` | 1 | 驗證碼需為 6 位數字 | otp_code must be 6 digits |
| `OTP_OR_BACKUP_CODE_REQUIRED` | 1 | 請輸入驗證碼或備援碼 | otp_code or backup_code is required |
| `PASSWORD_REQUIRED` | 1 | 請提供密碼 | password is required |
| `PC_PORT_REQUIRED` | 1 | 桌面登入需提供有效 port | platform=pc requires a valid port parameter (4-5 digits) |
| `PKCE_KEY_REQUIRED` | 1 | 請提供 pkce_key | pkce_key is required |
| `PKCE_VERIFICATION_FAILED` | 1 | PKCE 驗證失敗 | PKCE verification failed |
| `PRE_AUTH_TOKEN_FORBIDDEN` | 1 | Token 權限不足，請先完成兩步驟驗證 | Forbidden: pre_auth token cannot access this resource |
| `PROMPT_REQUIRED` | 1 | 請提供 prompt | prompt is required |
| `PROVIDER_NOT_BOUND` | 1 | 尚未綁定此登入方式 | No binding found for provider: ${provider} |
| `PROVIDER_NOT_CONFIGURED` | 1 | 此登入方式尚未設定，請稍後再試 | ${provider} 尚未設定，請稍後再試 |
| `PROVIDER_REQUIRED` | 1 | 請選擇登入方式 | provider is required |
| `REDIRECT_URI_MISMATCH` | 1 | redirect_uri 不符 | redirect_uri mismatch |
| `REDIRECT_URI_NOT_ALLOWED` | 1 | redirect_uri 未允許 | redirect_uri not allowed |
| `REFRESH_TOKEN_REQUIRED` | 1 | 請提供 refresh_token | refresh_token is required |
| `REQUISITION_ID_REQUIRED` | 1 | 請提供 requisition_id | requisition_id is required |
| `REQUISITION_IN_PROCESS` | 1 | 此單已在處理中，無法撤銷 | 此單已在處理中，無法撤銷 |
| `REQUISITION_NOT_FOUND` | 1 | 找不到該需求單 | 找不到該需求單 |
| `TOKEN_DATA_INCOMPLETE` | 1 | Token 資料不完整 | Token 資料不完整 |
| `TOKEN_INVALID_OR_EXPIRED` | 1 | 連結無效或已過期 | Token is invalid or has expired |
| `TOKEN_REQUIRED` | 1 | 請提供 Token | token is required |
| `TOKEN_REQUIRED` | 1 | 請提供 Token | Token is required |
| `UNKNOWN_KYC_VENDOR` | 1 | 未知的 KYC 廠商 | Unknown KYC vendor: ${vendor} |
| `UNKNOWN_PAYMENT_VENDOR` | 1 | 未知的金流廠商 | Unknown payment vendor: ${vendor} |
| `UNSUPPORTED_PROVIDER` | 1 | 不支援的登入方式 | Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')} |
| `UNSUPPORTED_PROVIDER` | 1 | 不支援的登入方式 | Unsupported provider: ${provider} |
| `UNSUPPORTED_PROVIDER` | 1 | 不支援的登入方式 | 不支援的登入方式：${provider} |
| `USER_ALREADY_BANNED` | 1 | 使用者已被停用 | User is already banned |
| `USER_ID_INVALID` | 1 | user_id 需為數字 | user_id must be a positive integer |
| `USER_NOT_BANNED` | 1 | 使用者並未被停用 | User is not banned |
| `WALLET_ADDRESS_MISMATCH` | 1 | 錢包地址與 nonce 不符 | Address does not match nonce |
| `WALLET_MESSAGE_SIGNATURE_REQUIRED` | 1 | 請提供 message 與 signature | message and signature are required |
| `WALLET_NOT_FOUND` | 1 | 找不到錢包 | Wallet not found |
| `WEBAUTHN_VERIFICATION_INCOMPLETE` | 1 | 驗證資料不完整 | Verification produced incomplete credential |
| `WRONG_TOKEN_SCOPE` | 1 | Token 權限範圍錯誤 | Forbidden: wrong token scope |

> ⚠️ = 仍標 `NEEDS_REVIEW`，建議實作 PR 動工時逐條定名
> `INSUFFICIENT_SCOPE` 樣板化：i18n 字串內含 `{required}` 參數，傳入後端的 scope 字串

### 命名衝突 / 故意合併（同 code 對應多字串）

> 多數為**故意合併**（大小寫不同、措辭微異但語意一致），實作 PR 補 code 時挑一個對應的英文字串即可；真要拆碼會在這次 review 標註。
- `REQUISITION_NOT_FOUND`：
  - "not_found"
  - "找不到該需求單"
- `UNAUTHORIZED`：
  - "Unauthorized"
  - "unauthorized"
- `USER_ID_INVALID`：
  - "user_id must be a number"
  - "user_id must be a positive integer"
- `INTERNAL_ERROR`：
  - "chiyigo_db binding missing"
  - "Internal error"
  - "AUDIT_ARCHIVE_BUCKET binding missing"
  - "Server error"
  - "requireStepUp must check an elevated:* scope"
- `ACCOUNT_NOT_FOUND`：
  - "Account not found or already deleted"
  - "Account not found"
- `CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE`：
  - "Cannot revoke a user with equal or higher role"
  - "Cannot ban a user with equal or higher role"
  - "Cannot unban a user with equal or higher role"
- `CANNOT_TARGET_SELF`：
  - "Cannot revoke your own tokens via admin API"
  - "Cannot ban yourself"
- `EMAIL_SEND_FAILED`：
  - "Failed to send confirmation email, please try again later"
  - "Failed to send email, please try again later"
- `INVALID_PLATFORM`：
  - "Invalid platform. Must be web, pc, or mobile."
  - "platform 必須為 web、pc 或 mobile"
- `NEEDS_REVIEW`：
  - "invalid JSON body"
  - "action must be one of ${[...VALID_ACTIONS].join(', ')}"
- `TOKEN_REQUIRED`：
  - "token is required"
  - "Token is required"
- `UNSUPPORTED_PROVIDER`：
  - "Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}"
  - "Unsupported provider: ${provider}"
  - "不支援的登入方式：${provider}"

## 逐檔清單

### functions/api/admin/audit-archive/retry.js（4 處）
- L85 `'admin:audit:write scope required'` → `INSUFFICIENT_SCOPE`（scope=`admin:audit:write`）
- L89 `'chiyigo_db binding missing'` → `INTERNAL_ERROR`
- L92 `'invalid JSON body'` → `NEEDS_REVIEW` ⚠️
- L101 `'action must be one of ${[...VALID_ACTIONS].join(', ')}'` → `NEEDS_REVIEW` ⚠️

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

### functions/api/ai/assist.js（3 處）
- L95 `'Invalid JSON'` → `INVALID_JSON`
- L102 `'prompt is required'` → `PROMPT_REQUIRED`
- L154 `'今日 AI 助手呼叫次數已達上限，請稍後再試或直接填寫表單'` → `AI_DAILY_LIMIT`

### functions/api/auth/account/change-password.js（4 處）
- L50 `'Invalid JSON'` → `INVALID_JSON`
- L53 `'new_password is required'` → `NEW_PASSWORD_REQUIRED`
- L59 `'Invalid token subject'` → `INVALID_TOKEN_SUBJECT`
- L67 `'User not found'` → `USER_NOT_FOUND`

### functions/api/auth/delete.js（7 處）
- L26 `'Internal error'` → `INTERNAL_ERROR`
- L39 `'Invalid JSON'` → `INVALID_JSON`
- L42 `'password is required'` → `PASSWORD_REQUIRED`
- L58 `'Too many requests. Please try again later.'` → `RATE_LIMITED`
- L72 `'Account not found'` → `ACCOUNT_NOT_FOUND`
- L75 `'Incorrect password'` → `INCORRECT_PASSWORD`
- L114 `'Failed to send confirmation email, please try again later'` → `EMAIL_SEND_FAILED`

### functions/api/auth/delete/confirm.js（4 處）
- L13 `'Invalid JSON'` → `INVALID_JSON`
- L16 `'token is required'` → `TOKEN_REQUIRED`
- L33 `'Invalid or expired deletion token'` → `INVALID_DELETION_TOKEN`
- L44 `'Account not found or already deleted'` → `ACCOUNT_NOT_FOUND`

### functions/api/auth/devices/logout.js（3 處）
- L41 `'Invalid JSON'` → `INVALID_JSON`
- L45 `'device_uuid must be string or null'` → `INVALID_DEVICE_UUID`
- L60 `'Device not found'` → `DEVICE_NOT_FOUND`

### functions/api/auth/email/send-verification.js（5 處）
- L30 `'Internal error'` → `INTERNAL_ERROR`
- L60 `'Too many requests. Please try again later.'` → `RATE_LIMITED`
- L71 `'User not found'` → `USER_NOT_FOUND`
- L73 `'Email already verified'` → `EMAIL_ALREADY_VERIFIED`
- L115 `'Failed to send email, please try again later'` → `EMAIL_SEND_FAILED`

### functions/api/auth/email/verify.js（3 處）
- L24 `'Invalid JSON'` → `INVALID_JSON`
- L28 `'Token is required'` → `TOKEN_REQUIRED`
- L47 `'Token is invalid or has expired'` → `TOKEN_INVALID_OR_EXPIRED`

### functions/api/auth/game/login.js（3 處）
- L44 `'Invalid platform. Must be web, pc, or mobile.'` → `INVALID_PLATFORM`
- L47 `'Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}'` → `UNSUPPORTED_PROVIDER`
- L52 `'platform=pc requires a valid port parameter (4-5 digits)'` → `PC_PORT_REQUIRED`

### functions/api/auth/identity/unbind.js（7 處）
- L24 `'Invalid JSON'` → `INVALID_JSON`
- L29 `'provider is required'` → `PROVIDER_REQUIRED`
- L32 `'Unsupported provider: ${provider}'` → `UNSUPPORTED_PROVIDER`
- L43 `'User not found'` → `USER_NOT_FOUND`
- L44 `'Account is banned'` → `ACCOUNT_BANNED`
- L56 `'Cannot remove the last authentication method.'` → `LAST_AUTH_METHOD`
- L65 `'No binding found for provider: ${provider}'` → `PROVIDER_NOT_BOUND`

### functions/api/auth/me.js（1 處）
- L43 `'User not found'` → `USER_NOT_FOUND`

### functions/api/auth/oauth/[provider]/init.js（5 處）
- L72 `'不支援的登入方式：${provider}'` → `UNSUPPORTED_PROVIDER`
- L76 `'${provider} 尚未設定，請稍後再試'` → `PROVIDER_NOT_CONFIGURED`
- L95 `'Apple 登入尚未開放'` → `APPLE_LOGIN_NOT_AVAILABLE`
- L108 `'platform 必須為 web、pc 或 mobile'` → `INVALID_PLATFORM`
- L177 `'OAuth 狀態儲存失敗，請重試'` → `OAUTH_STATE_SAVE_FAILED`

### functions/api/auth/oauth/authorize.js（4 處）
- L92 `'Only response_type=code is supported'` → `OAUTH_UNSUPPORTED_RESPONSE_TYPE`
- L94 `'redirect_uri, code_challenge, and state are required'` → `OAUTH_AUTHORIZE_REQUIRED_FIELDS`
- L96 `'Only code_challenge_method=S256 is supported'` → `OAUTH_UNSUPPORTED_PKCE_METHOD`
- L98 `'redirect_uri not allowed'` → `REDIRECT_URI_NOT_ALLOWED`

### functions/api/auth/oauth/bind-email.js（9 處）
- L35 `'無效的請求格式'` → `INVALID_REQUEST_FORMAT`
- L41 `'缺少必要欄位'` → `MISSING_REQUIRED_FIELD`
- L45 `'信箱格式無效'` → `INVALID_EMAIL_FORMAT`
- L52 `'連結無效或已過期，請重新登入'` → `LINK_INVALID_OR_EXPIRED`
- L56 `'連結類型錯誤'` → `LINK_TYPE_INVALID`
- L60 `'Token 資料不完整'` → `TOKEN_DATA_INCOMPLETE`
- L98 `'此信箱已被既有帳號使用。請改用既有方式登入，登入後可在帳號設定中綁定 ${provider} 帳號。'` → `EMAIL_USED_BIND_AFTER_LOGIN`
- L128 `'帳號建立後無法查詢，請稍後重試'` → `ACCOUNT_LOOKUP_FAILED_AFTER_CREATE`
- L129 `'此帳號已被停用'` → `ACCOUNT_DISABLED`

### functions/api/auth/oauth/code.js（3 處）
- L29 `'Invalid JSON'` → `INVALID_JSON`
- L32 `'pkce_key is required'` → `PKCE_KEY_REQUIRED`
- L46 `'Invalid or expired PKCE session'` → `INVALID_PKCE_SESSION`

### functions/api/auth/oauth/token.js（6 處）
- L55 `'Invalid JSON'` → `INVALID_JSON`
- L60 `'code, code_verifier, and redirect_uri are required'` → `OAUTH_CODE_REQUIRED_FIELDS`
- L93 `'Invalid or expired authorization code'` → `INVALID_AUTHORIZATION_CODE`
- L99 `'redirect_uri mismatch'` → `REDIRECT_URI_MISMATCH`
- L106 `'PKCE verification failed'` → `PKCE_VERIFICATION_FAILED`
- L115 `'User not found'` → `USER_NOT_FOUND`

### functions/api/auth/payments/intents/[id].js（4 處）
- L34 `'not_found'` → `INTENT_NOT_FOUND`
- L38 `'not_found'` → `INTENT_NOT_FOUND`
- L49 `'not_found'` → `INTENT_NOT_FOUND`
- L53 `'not_found'` → `INTENT_NOT_FOUND`

### functions/api/auth/refresh.js（6 處）
- L63 `'refresh_token is required'` → `REFRESH_TOKEN_REQUIRED`
- L80 `'Invalid or expired refresh token'` → `INVALID_REFRESH_TOKEN`
- L86 `'Refresh token has been revoked'` → `REFRESH_TOKEN_REVOKED`
- L127 `'Device mismatch'` → `DEVICE_MISMATCH`
- L141 `'User not found'` → `USER_NOT_FOUND`
- L169 `'Refresh token has been revoked'` → `REFRESH_TOKEN_REVOKED`

### functions/api/auth/step-up.js（8 處）
- L65 `'Invalid JSON'` → `INVALID_JSON`
- L71 `'scope must be one of: ${[...KNOWN_ELEVATED_SCOPES].join(', ')}'` → `INVALID_SCOPE`
- L74 `'otp_code or backup_code is required'` → `OTP_OR_BACKUP_CODE_REQUIRED`
- L77 `'for_action must be a non-empty string when provided'` → `INVALID_FOR_ACTION`
- L80 `'Invalid token subject'` → `INVALID_TOKEN_SUBJECT`
- L105 `'User not found'` → `USER_NOT_FOUND`
- L121 `'otp_code must be 6 digits'` → `OTP_CODE_INVALID_FORMAT`
- L151 `'Invalid OTP or backup code'` → `INVALID_OTP_OR_BACKUP_CODE`

### functions/api/auth/userinfo.js（1 處）
- L48 `'User not found'` → `USER_NOT_FOUND`

### functions/api/auth/wallet/[id].js（2 處）
- L39 `'Invalid id'` → `INVALID_ID`
- L44 `'Wallet not found'` → `WALLET_NOT_FOUND`

### functions/api/auth/wallet/nonce.js（2 處）
- L36 `'Invalid JSON'` → `INVALID_JSON`
- L42 `'Invalid Ethereum address'` → `INVALID_WALLET_ADDRESS`

### functions/api/auth/wallet/verify.js（5 處）
- L47 `'Invalid JSON'` → `INVALID_JSON`
- L55 `'message and signature are required'` → `WALLET_MESSAGE_SIGNATURE_REQUIRED`
- L76 `'Nonce invalid or expired'` → `NONCE_INVALID_OR_EXPIRED`
- L84 `'Nonce mismatch'` → `NONCE_MISMATCH`
- L91 `'Address does not match nonce'` → `WALLET_ADDRESS_MISMATCH`

### functions/api/auth/webauthn/credentials/[id].js（6 處）
- L45 `'Invalid id'` → `INVALID_ID`
- L49 `'Invalid JSON'` → `INVALID_JSON`
- L53 `'nickname must be a non-empty string up to ${NICKNAME_MAX} chars'` → `INVALID_NICKNAME`
- L66 `'Credential not found'` → `CREDENTIAL_NOT_FOUND`
- L81 `'Invalid id'` → `INVALID_ID`
- L90 `'Credential not found'` → `CREDENTIAL_NOT_FOUND`

### functions/api/auth/webauthn/login-verify.js（8 處）
- L59 `'Invalid JSON'` → `INVALID_JSON`
- L66 `'response is required'` → `RESPONSE_REQUIRED`
- L73 `'Invalid clientDataJSON'` → `INVALID_CLIENT_DATA`
- L80 `'Invalid credentials'` → `INVALID_CREDENTIALS`
- L109 `'Invalid credentials'` → `INVALID_CREDENTIALS`
- L119 `'Invalid credentials'` → `INVALID_CREDENTIALS`
- L145 `'Invalid credentials'` → `INVALID_CREDENTIALS`
- L153 `'Invalid credentials'` → `INVALID_CREDENTIALS`

### functions/api/auth/webauthn/register-verify.js（9 處）
- L45 `'Invalid JSON'` → `INVALID_JSON`
- L50 `'response is required'` → `RESPONSE_REQUIRED`
- L55 `'Invalid clientDataJSON'` → `INVALID_CLIENT_DATA`
- L62 `'Challenge invalid or expired'` → `CHALLENGE_INVALID_OR_EXPIRED`
- L69 `'Challenge mismatch'` → `CHALLENGE_MISMATCH`
- L88 `'Verification failed'` → `WEBAUTHN_VERIFICATION_FAILED`
- L96 `'Verification failed'` → `WEBAUTHN_VERIFICATION_FAILED`
- L112 `'Verification produced incomplete credential'` → `WEBAUTHN_VERIFICATION_INCOMPLETE`
- L159 `'Credential already registered'` → `CREDENTIAL_ALREADY_REGISTERED`

### functions/api/payments/intents/[id]/refund-request.js（3 處）
- L25 `'not_found'` → `INTENT_NOT_FOUND`
- L29 `'Invalid JSON'` → `INVALID_JSON`
- L40 `'not_found'` → `INTENT_NOT_FOUND`

### functions/api/requisition.js（4 處）
- L76 `'Invalid JSON'` → `INVALID_JSON`
- L112 `'今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們'` → `REQUISITION_DAILY_LIMIT`
- L123 `'今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們'` → `REQUISITION_DAILY_LIMIT`
- L175 `'Server error'` → `INTERNAL_ERROR`

### functions/api/requisition/[id].js（4 處）
- L17 `'not_found'` → `REQUISITION_NOT_FOUND`
- L29 `'not_found'` → `REQUISITION_NOT_FOUND`
- L50 `'not_found'` → `REQUISITION_NOT_FOUND`
- L57 `'not_found'` → `REQUISITION_NOT_FOUND`

### functions/api/requisition/revoke.js（4 處）
- L49 `'Invalid JSON'` → `INVALID_JSON`
- L52 `'requisition_id is required'` → `REQUISITION_ID_REQUIRED`
- L66 `'找不到該需求單'` → `REQUISITION_NOT_FOUND`
- L68 `'此單已在處理中，無法撤銷'` → `REQUISITION_IN_PROCESS`

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

- functions/api/admin/audit-archive/retry.js:L106 — `error: tgtErr`
- functions/api/admin/oauth-clients.js:L145 — `error: v.error`
- functions/api/auth/account/change-password.js:L56 — `error: pwCheck.error`
- functions/api/auth/local/register.js:L42 — `error: pwCheck.error`
- functions/api/auth/local/reset-password.js:L36 — `error: pwCheck.error`
- functions/api/auth/oauth/[provider]/init.js:L132 — `error: err.message`
- functions/api/requisition.js:L79 — `error: err`

> 處理建議：上游 catch 處改用 `res({ code: 'INTERNAL_ERROR', error: e.message }, 500)`，前端優先讀 code、保留 error 供 debug。

## 後續 PR 切分建議

### PR B-1c (OAuth / WebAuthn / Wallet)
- 檔案：11 個，處數：**59**
  - functions/api/auth/oauth/[provider]/init.js
  - functions/api/auth/oauth/authorize.js
  - functions/api/auth/oauth/bind-email.js
  - functions/api/auth/oauth/code.js
  - functions/api/auth/oauth/token.js
  - functions/api/auth/wallet/[id].js
  - functions/api/auth/wallet/nonce.js
  - functions/api/auth/wallet/verify.js
  - functions/api/auth/webauthn/credentials/[id].js
  - functions/api/auth/webauthn/login-verify.js
  - functions/api/auth/webauthn/register-verify.js

### PR B-1d (Auth 其他)
- 檔案：10 個，處數：**45**
  - functions/api/auth/delete.js
  - functions/api/auth/delete/confirm.js
  - functions/api/auth/email/send-verification.js
  - functions/api/auth/email/verify.js
  - functions/api/auth/game/login.js
  - functions/api/auth/identity/unbind.js
  - functions/api/auth/me.js
  - functions/api/auth/refresh.js
  - functions/api/auth/step-up.js
  - functions/api/auth/userinfo.js

### PR B-2 (會員 Dashboard)
- 檔案：3 個，處數：**11**
  - functions/api/auth/account/change-password.js
  - functions/api/auth/devices/logout.js
  - functions/api/auth/payments/intents/[id].js

### PR B-3 (公開頁 / Requisition / AI)
- 檔案：4 個，處數：**15**
  - functions/api/ai/assist.js
  - functions/api/requisition.js
  - functions/api/requisition/[id].js
  - functions/api/requisition/revoke.js

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
