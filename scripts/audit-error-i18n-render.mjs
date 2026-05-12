// Render audit JSON → markdown doc.
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('scripts/audit-error-i18n.out.json', 'utf8'));
const { results, warnings } = data;

// ---- 1. Manual override map (keyed by exact errorStr) ----
// 這裡的條目都視為 confident=true。命名衝突、CJK hardcode、scope 樣板的覆寫都靠這張表。
const MANUAL_CODE_MAP = {
  // 高頻基礎 code（從原 heuristic map 搬進來，免得標 NEEDS_REVIEW）
  'Invalid JSON': 'INVALID_JSON',
  'Invalid credentials': 'INVALID_CREDENTIALS',
  'User not found': 'USER_NOT_FOUND',
  'Client not found': 'CLIENT_NOT_FOUND',
  'Local account not found': 'LOCAL_ACCOUNT_NOT_FOUND',
  'Account not found': 'ACCOUNT_NOT_FOUND',
  'Credential not found': 'CREDENTIAL_NOT_FOUND',
  'Token is invalid or has expired': 'TOKEN_INVALID_OR_EXPIRED',
  'Too many requests. Please try again later.': 'RATE_LIMITED',
  'Too many requests': 'RATE_LIMITED',
  'Internal error': 'INTERNAL_ERROR',
  'Invalid id': 'INVALID_ID',
  'Invalid user id': 'INVALID_USER_ID',
  'Invalid OTP code': 'INVALID_OTP',
  'Invalid token subject': 'INVALID_TOKEN_SUBJECT',
  'Invalid or already used backup code': 'INVALID_OR_USED_BACKUP_CODE',
  'Invalid OTP or backup code': 'INVALID_OTP_OR_BACKUP_CODE',
  '2FA is already enabled': '2FA_ALREADY_ENABLED',
  '2FA is not enabled': '2FA_NOT_ENABLED',
  'otp_code is required': 'OTP_CODE_REQUIRED',
  'otp_code must be 6 digits': 'OTP_CODE_INVALID_FORMAT',
  'otp_code or backup_code is required': 'OTP_OR_BACKUP_CODE_REQUIRED',
  'response is required': 'RESPONSE_REQUIRED',
  'email and password are required': 'EMAIL_PASSWORD_REQUIRED',
  'user_id must be a number': 'USER_ID_INVALID',
  'from must be ISO 8601 date/datetime': 'FROM_DATE_INVALID',
  'to must be ISO 8601 date/datetime': 'TO_DATE_INVALID',
  'invalid status': 'INVALID_STATUS',
  'Refresh token has been revoked': 'REFRESH_TOKEN_REVOKED',
  'CRON_SECRET not configured': 'CRON_SECRET_NOT_CONFIGURED',
  'TradeNo not found; cannot call refund API': 'TRADE_NO_NOT_FOUND',
  'ECPay refund failed': 'ECPAY_REFUND_FAILED',
  'refund not implemented for vendor: ${intent.vendor}': 'REFUND_NOT_IMPLEMENTED',
  'No updatable fields provided': 'NO_UPDATABLE_FIELDS',

  // 大小寫合併
  'unauthorized': 'UNAUTHORIZED',
  'Unauthorized': 'UNAUTHORIZED',
  'token is required': 'TOKEN_REQUIRED',
  'Token is required': 'TOKEN_REQUIRED',

  // CJK hardcode（原本被歸 NEEDS_REVIEW）
  '今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們': 'REQUISITION_DAILY_LIMIT',
  '今日 AI 助手呼叫次數已達上限，請稍後再試或直接填寫表單': 'AI_DAILY_LIMIT',
  '無效的請求格式': 'INVALID_REQUEST_FORMAT',
  '缺少必要欄位': 'MISSING_REQUIRED_FIELD',
  '信箱格式無效': 'INVALID_EMAIL_FORMAT',
  '連結無效或已過期，請重新登入': 'LINK_INVALID_OR_EXPIRED',
  '連結類型錯誤': 'LINK_TYPE_INVALID',
  'Token 資料不完整': 'TOKEN_DATA_INCOMPLETE',
  '此信箱已被既有帳號使用。請改用既有方式登入，登入後可在帳號設定中綁定 ${provider} 帳號。': 'EMAIL_USED_BIND_AFTER_LOGIN',
  '帳號建立後無法查詢，請稍後重試': 'ACCOUNT_LOOKUP_FAILED_AFTER_CREATE',
  '此帳號已被停用': 'ACCOUNT_DISABLED',
  '不支援的登入方式：${provider}': 'UNSUPPORTED_PROVIDER',
  '${provider} 尚未設定，請稍後再試': 'PROVIDER_NOT_CONFIGURED',
  'Apple 登入尚未開放': 'APPLE_LOGIN_NOT_AVAILABLE',
  'platform 必須為 web、pc 或 mobile': 'INVALID_PLATFORM',
  'OAuth 狀態儲存失敗，請重試': 'OAUTH_STATE_SAVE_FAILED',
  '找不到該需求單': 'REQUISITION_NOT_FOUND',
  '此單已在處理中，無法撤銷': 'REQUISITION_IN_PROCESS',

  // 啟發式產生的爛 code 修正
  'Cannot revoke a user with equal or higher role': 'CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE',
  'Cannot ban a user with equal or higher role': 'CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE',
  'Cannot unban a user with equal or higher role': 'CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE',
  'Cannot revoke your own tokens via admin API': 'CANNOT_TARGET_SELF',
  'Cannot ban yourself': 'CANNOT_TARGET_SELF',
  'Invalid platform. Must be web, pc, or mobile.': 'INVALID_PLATFORM',
  'requireStepUp must check an elevated:* scope': 'INTERNAL_ERROR',
  'Cannot remove the last authentication method.': 'LAST_AUTH_METHOD',
  'Forbidden: pre_auth token cannot access this resource': 'PRE_AUTH_TOKEN_FORBIDDEN',
  'Forbidden: wrong token scope': 'WRONG_TOKEN_SCOPE',
  'code, code_verifier, and redirect_uri are required': 'OAUTH_CODE_REQUIRED_FIELDS',
  'redirect_uri, code_challenge, and state are required': 'OAUTH_AUTHORIZE_REQUIRED_FIELDS',
  'Only response_type=code is supported': 'OAUTH_UNSUPPORTED_RESPONSE_TYPE',
  'Only code_challenge_method=S256 is supported': 'OAUTH_UNSUPPORTED_PKCE_METHOD',
  'nickname must be a non-empty string up to ${NICKNAME_MAX} chars': 'INVALID_NICKNAME',
  "mode must be one of: ${[...VALID_MODES].join(', ')}": 'INVALID_MODE',
  "scope must be one of: ${[...KNOWN_ELEVATED_SCOPES].join(', ')}": 'INVALID_SCOPE',
  'platform=pc requires a valid port parameter (4-5 digits)': 'PC_PORT_REQUIRED',
  'AUDIT_ARCHIVE_BUCKET binding missing': 'INTERNAL_ERROR',
  'chiyigo_db binding missing': 'INTERNAL_ERROR',
  'user_id must be a positive integer': 'USER_ID_INVALID',
  'severity must be info | warn | critical': 'INVALID_SEVERITY',
  'Address does not match nonce': 'WALLET_ADDRESS_MISMATCH',
  'Verification produced incomplete credential': 'WEBAUTHN_VERIFICATION_INCOMPLETE',
  'Webhook validation failed': 'WEBHOOK_VALIDATION_FAILED',
  'Verification failed': 'WEBAUTHN_VERIFICATION_FAILED',
  'Invalid clientDataJSON': 'INVALID_CLIENT_DATA',
  'Server error': 'INTERNAL_ERROR',
  'Invalid Ethereum address': 'INVALID_WALLET_ADDRESS',
  'No binding found for provider: ${provider}': 'PROVIDER_NOT_BOUND',
  'Unsupported provider: ${provider}': 'UNSUPPORTED_PROVIDER',
  "Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}": 'UNSUPPORTED_PROVIDER',
  'Wallet not found': 'WALLET_NOT_FOUND',
  'Device not found': 'DEVICE_NOT_FOUND',
  'Device mismatch': 'DEVICE_MISMATCH',
  'device_uuid is required for mode=device': 'DEVICE_UUID_REQUIRED',
  'device_uuid must be string or null': 'INVALID_DEVICE_UUID',
  'jti is required for mode=jti': 'JTI_REQUIRED',
  'Nonce invalid or expired': 'NONCE_INVALID_OR_EXPIRED',
  'Nonce mismatch': 'NONCE_MISMATCH',
  'Challenge invalid or expired': 'CHALLENGE_INVALID_OR_EXPIRED',
  'Challenge mismatch': 'CHALLENGE_MISMATCH',
  'Credential already registered': 'CREDENTIAL_ALREADY_REGISTERED',
  'Account is banned': 'ACCOUNT_BANNED',
  'Account not found or already deleted': 'ACCOUNT_NOT_FOUND',
  'User is already banned': 'USER_ALREADY_BANNED',
  'User is not banned': 'USER_NOT_BANNED',
  'Client already disabled': 'CLIENT_ALREADY_DISABLED',
  'Email already registered': 'EMAIL_ALREADY_REGISTERED',
  'Email already verified': 'EMAIL_ALREADY_VERIFIED',
  'email is required': 'EMAIL_REQUIRED',
  'password is required': 'PASSWORD_REQUIRED',
  'new_password is required': 'NEW_PASSWORD_REQUIRED',
  'pkce_key is required': 'PKCE_KEY_REQUIRED',
  'prompt is required': 'PROMPT_REQUIRED',
  'provider is required': 'PROVIDER_REQUIRED',
  'refresh_token is required': 'REFRESH_TOKEN_REQUIRED',
  'requisition_id is required': 'REQUISITION_ID_REQUIRED',
  'intent_id required': 'INTENT_ID_REQUIRED',
  'token and new_password are required': 'TOKEN_AND_PASSWORD_REQUIRED',
  'message and signature are required': 'WALLET_MESSAGE_SIGNATURE_REQUIRED',
  'for_action must be a non-empty string when provided': 'INVALID_FOR_ACTION',
  '2FA verification required': 'TFA_VERIFICATION_REQUIRED',
  'Invalid 2FA code': 'INVALID_OTP',
  'Invalid email format': 'INVALID_EMAIL_FORMAT',
  'Invalid request': 'INVALID_REQUEST',
  'Invalid or expired authorization code': 'INVALID_AUTHORIZATION_CODE',
  'Invalid or expired deletion token': 'INVALID_DELETION_TOKEN',
  'Invalid or expired PKCE session': 'INVALID_PKCE_SESSION',
  'Invalid or expired refresh token': 'INVALID_REFRESH_TOKEN',
  'Incorrect password': 'INCORRECT_PASSWORD',
  'PKCE verification failed': 'PKCE_VERIFICATION_FAILED',
  'redirect_uri mismatch': 'REDIRECT_URI_MISMATCH',
  'redirect_uri not allowed': 'REDIRECT_URI_NOT_ALLOWED',
  'Failed to send confirmation email, please try again later': 'EMAIL_SEND_FAILED',
  'Failed to send email, please try again later': 'EMAIL_SEND_FAILED',
  'Run /api/auth/2fa/setup first': 'TFA_SETUP_REQUIRED',
  'Unknown KYC vendor: ${vendor}': 'UNKNOWN_KYC_VENDOR',
  'Unknown payment vendor: ${vendor}': 'UNKNOWN_PAYMENT_VENDOR',
  'captcha_failed': 'CAPTCHA_FAILED',
};

// ---- 2. File-context override (NOT_FOUND family etc.) ----
function fileContextCode(file, errorStr) {
  const lc = errorStr.toLowerCase();
  if (lc === 'not_found' || lc === 'not found') {
    if (/\/admin\/audit/.test(file)) return 'AUDIT_NOT_FOUND';
    if (/\/admin\/payments\/intents\//.test(file)) return 'INTENT_NOT_FOUND';
    if (/\/admin\/requisition-refund/.test(file)) return 'REFUND_REQUEST_NOT_FOUND';
    if (/\/admin\/requisitions/.test(file)) return 'REQUISITION_NOT_FOUND';
    if (/\/payments\/intents\//.test(file) || /refund-request/.test(file)) return 'INTENT_NOT_FOUND';
    if (/\/auth\/payments/.test(file)) return 'INTENT_NOT_FOUND';
    if (/\/api\/requisition\//.test(file) || /\/api\/requisition\.js$/.test(file)) return 'REQUISITION_NOT_FOUND';
    return 'NOT_FOUND';
  }
  if (errorStr === 'linked intent not found') return 'LINKED_INTENT_NOT_FOUND';
  return null;
}

// ---- 3. Template: scope-required → INSUFFICIENT_SCOPE ----
function scopeRequiredMeta(s) {
  const m = s.match(/^([a-z][\w:*]+)\s+scope required$/i);
  if (!m) return null;
  return { code: 'INSUFFICIENT_SCOPE', scope: m[1] };
}

// ---- 4. Final code lookup ----
function suggestCode(file, s) {
  const ctx = fileContextCode(file, s);
  if (ctx) return { code: ctx, confident: true };
  if (MANUAL_CODE_MAP[s]) return { code: MANUAL_CODE_MAP[s], confident: true };
  const sc = scopeRequiredMeta(s);
  if (sc) return { code: sc.code, confident: true, scope: sc.scope };
  // 已是 SCREAMING_SNAKE
  if (/^[A-Z][A-Z0-9_]*$/.test(s)) return { code: s, confident: true };
  // lowercase snake_case
  if (/^[a-z][a-z0-9_]*$/.test(s)) return { code: s.toUpperCase(), confident: true };
  // fallback：mark NEEDS_REVIEW，避免產出爛截斷 code 污染 doc
  return { code: 'NEEDS_REVIEW', confident: false };
}

// Build dedup table — 用 (code, errorStr) 為 key，因 file-context 可能讓同字串分歧出多個 code
const byCodeStr = new Map();
for (const r of results) {
  const { code, confident, scope } = suggestCode(r.file, r.errorStr);
  const key = `${code} ${r.errorStr}`;
  if (!byCodeStr.has(key)) byCodeStr.set(key, { code, errorStr: r.errorStr, count: 0, confident, scope });
  byCodeStr.get(key).count++;
}
const codeTable = [...byCodeStr.values()];
codeTable.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

// Detect collisions (same code, different strings) — INSUFFICIENT_SCOPE 故意多字串故略
const codeToStrs = new Map();
for (const c of codeTable) {
  if (c.code === 'INSUFFICIENT_SCOPE') continue;
  if (!codeToStrs.has(c.code)) codeToStrs.set(c.code, []);
  codeToStrs.get(c.code).push(c.errorStr);
}

// Group results by file for per-file listing
const byFile = new Map();
for (const r of results) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}
const filesSorted = [...byFile.keys()].sort();

// zh-TW suggestions
const zhMap = {
  INVALID_JSON: '請求格式錯誤',
  NOT_FOUND: '找不到資源',
  INTENT_NOT_FOUND: '找不到付款單',
  AUDIT_NOT_FOUND: '找不到稽核紀錄',
  REFUND_REQUEST_NOT_FOUND: '找不到退款申請',
  REQUISITION_NOT_FOUND: '找不到該需求單',
  LINKED_INTENT_NOT_FOUND: '找不到關聯的付款單',
  USER_NOT_FOUND: '找不到使用者',
  INVALID_CREDENTIALS: '帳號或密碼錯誤',
  CLIENT_NOT_FOUND: '找不到應用程式',
  LOCAL_ACCOUNT_NOT_FOUND: '尚未建立本地帳號',
  ACCOUNT_NOT_FOUND: '找不到帳號',
  CREDENTIAL_NOT_FOUND: '找不到憑證',
  OTP_CODE_INVALID_FORMAT: '驗證碼需為 6 位數字',
  TOKEN_INVALID_OR_EXPIRED: '連結無效或已過期',
  USER_ID_INVALID: 'user_id 需為數字',
  FROM_DATE_INVALID: '起始日期格式錯誤（需為 ISO 8601）',
  TO_DATE_INVALID: '結束日期格式錯誤（需為 ISO 8601）',
  INVALID_STATUS: '狀態值無效',
  OTP_OR_BACKUP_CODE_REQUIRED: '請輸入驗證碼或備援碼',
  RATE_LIMITED: '請求過於頻繁，請稍後再試',
  INVALID_ID: '識別碼格式錯誤',
  UNAUTHORIZED: '未登入或登入已過期',
  INTERNAL_ERROR: '系統錯誤，請稍後再試',
  EMAIL_PASSWORD_REQUIRED: '請輸入 Email 與密碼',
  REFRESH_TOKEN_REVOKED: '登入憑證已失效，請重新登入',
  OTP_CODE_REQUIRED: '請輸入驗證碼',
  '2FA_ALREADY_ENABLED': '兩步驟驗證已啟用',
  '2FA_NOT_ENABLED': '尚未啟用兩步驟驗證',
  TFA_VERIFICATION_REQUIRED: '需通過兩步驟驗證',
  TFA_SETUP_REQUIRED: '請先完成兩步驟驗證設定',
  INVALID_OTP: '驗證碼錯誤',
  INVALID_OR_USED_BACKUP_CODE: '備援碼錯誤或已使用過',
  INVALID_OTP_OR_BACKUP_CODE: '驗證碼或備援碼錯誤',
  INVALID_TOKEN_SUBJECT: 'Token subject 無效',
  RESPONSE_REQUIRED: '請完成人機驗證',
  TRADE_NO_NOT_FOUND: '找不到交易序號',
  ECPAY_REFUND_FAILED: '綠界退款失敗',
  REFUND_NOT_IMPLEMENTED: '此金流供應商尚未支援退款',
  CRON_SECRET_NOT_CONFIGURED: '排程密鑰未設定',
  INSUFFICIENT_SCOPE: '權限不足（缺 `{required}` scope）',
  TOKEN_REQUIRED: '請提供 Token',
  REQUISITION_DAILY_LIMIT: '今日提單次數已達上限，如有急件請直接致電或 LINE 聯絡我們',
  AI_DAILY_LIMIT: '今日 AI 助手呼叫次數已達上限',
  INVALID_REQUEST_FORMAT: '無效的請求格式',
  MISSING_REQUIRED_FIELD: '缺少必要欄位',
  INVALID_EMAIL_FORMAT: '信箱格式無效',
  LINK_INVALID_OR_EXPIRED: '連結無效或已過期，請重新登入',
  LINK_TYPE_INVALID: '連結類型錯誤',
  TOKEN_DATA_INCOMPLETE: 'Token 資料不完整',
  EMAIL_USED_BIND_AFTER_LOGIN: '此信箱已被既有帳號使用，請改用既有方式登入後綁定',
  ACCOUNT_LOOKUP_FAILED_AFTER_CREATE: '帳號建立後無法查詢，請稍後重試',
  ACCOUNT_DISABLED: '此帳號已被停用',
  UNSUPPORTED_PROVIDER: '不支援的登入方式',
  PROVIDER_NOT_CONFIGURED: '此登入方式尚未設定，請稍後再試',
  APPLE_LOGIN_NOT_AVAILABLE: 'Apple 登入尚未開放',
  INVALID_PLATFORM: 'platform 必須為 web、pc 或 mobile',
  OAUTH_STATE_SAVE_FAILED: 'OAuth 狀態儲存失敗，請重試',
  REQUISITION_IN_PROCESS: '此單已在處理中，無法撤銷',
  CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE: '無法對同等或更高權限的使用者執行此操作',
  CANNOT_TARGET_SELF: '無法對自己執行此操作',
  LAST_AUTH_METHOD: '無法移除最後一個登入方式',
  PRE_AUTH_TOKEN_FORBIDDEN: 'Token 權限不足，請先完成兩步驟驗證',
  WRONG_TOKEN_SCOPE: 'Token 權限範圍錯誤',
  OAUTH_CODE_REQUIRED_FIELDS: '請提供 code、code_verifier、redirect_uri',
  OAUTH_AUTHORIZE_REQUIRED_FIELDS: '請提供 redirect_uri、code_challenge、state',
  OAUTH_UNSUPPORTED_RESPONSE_TYPE: '僅支援 response_type=code',
  OAUTH_UNSUPPORTED_PKCE_METHOD: '僅支援 code_challenge_method=S256',
  INVALID_NICKNAME: '暱稱格式錯誤',
  INVALID_MODE: 'mode 參數無效',
  INVALID_SCOPE: 'scope 參數無效',
  PC_PORT_REQUIRED: '桌面登入需提供有效 port',
  INVALID_SEVERITY: 'severity 必須為 info / warn / critical',
  WALLET_ADDRESS_MISMATCH: '錢包地址與 nonce 不符',
  WEBAUTHN_VERIFICATION_INCOMPLETE: '驗證資料不完整',
  WEBHOOK_VALIDATION_FAILED: 'Webhook 驗證失敗',
  WEBAUTHN_VERIFICATION_FAILED: 'WebAuthn 驗證失敗',
  INVALID_CLIENT_DATA: 'clientDataJSON 格式錯誤',
  INVALID_WALLET_ADDRESS: '錢包地址格式錯誤',
  PROVIDER_NOT_BOUND: '尚未綁定此登入方式',
  WALLET_NOT_FOUND: '找不到錢包',
  DEVICE_NOT_FOUND: '找不到裝置',
  DEVICE_MISMATCH: '裝置不符',
  DEVICE_UUID_REQUIRED: '請提供 device_uuid',
  INVALID_DEVICE_UUID: 'device_uuid 格式錯誤',
  JTI_REQUIRED: '請提供 jti',
  NONCE_INVALID_OR_EXPIRED: 'Nonce 無效或已過期',
  NONCE_MISMATCH: 'Nonce 不符',
  CHALLENGE_INVALID_OR_EXPIRED: 'Challenge 無效或已過期',
  CHALLENGE_MISMATCH: 'Challenge 不符',
  CREDENTIAL_ALREADY_REGISTERED: '此憑證已註冊',
  ACCOUNT_BANNED: '帳號已被停用',
  USER_ALREADY_BANNED: '使用者已被停用',
  USER_NOT_BANNED: '使用者並未被停用',
  CLIENT_ALREADY_DISABLED: '應用程式已被停用',
  EMAIL_ALREADY_REGISTERED: '此 Email 已註冊',
  EMAIL_ALREADY_VERIFIED: 'Email 已驗證',
  EMAIL_REQUIRED: '請提供 Email',
  PASSWORD_REQUIRED: '請提供密碼',
  NEW_PASSWORD_REQUIRED: '請提供新密碼',
  PKCE_KEY_REQUIRED: '請提供 pkce_key',
  PROMPT_REQUIRED: '請提供 prompt',
  PROVIDER_REQUIRED: '請選擇登入方式',
  REFRESH_TOKEN_REQUIRED: '請提供 refresh_token',
  REQUISITION_ID_REQUIRED: '請提供 requisition_id',
  INTENT_ID_REQUIRED: '請提供 intent_id',
  TOKEN_AND_PASSWORD_REQUIRED: '請提供 Token 與新密碼',
  WALLET_MESSAGE_SIGNATURE_REQUIRED: '請提供 message 與 signature',
  INVALID_FOR_ACTION: 'for_action 格式錯誤',
  INVALID_REQUEST: '請求格式錯誤',
  INVALID_AUTHORIZATION_CODE: '授權碼無效或已過期',
  INVALID_DELETION_TOKEN: '刪除帳號 Token 無效或已過期',
  INVALID_PKCE_SESSION: 'PKCE Session 無效或已過期',
  INVALID_REFRESH_TOKEN: 'Refresh Token 無效或已過期',
  INCORRECT_PASSWORD: '密碼錯誤',
  PKCE_VERIFICATION_FAILED: 'PKCE 驗證失敗',
  REDIRECT_URI_MISMATCH: 'redirect_uri 不符',
  REDIRECT_URI_NOT_ALLOWED: 'redirect_uri 未允許',
  EMAIL_SEND_FAILED: '寄送 Email 失敗，請稍後再試',
  UNKNOWN_KYC_VENDOR: '未知的 KYC 廠商',
  UNKNOWN_PAYMENT_VENDOR: '未知的金流廠商',
  CAPTCHA_FAILED: '人機驗證失敗',
  INVALID_USER_ID: '使用者 ID 格式錯誤',
  NO_UPDATABLE_FIELDS: '沒有可更新的欄位',
};

// ---- Suggested PR splits ----
function bucketOf(file) {
  if (/^functions\/api\/auth\/local\//.test(file)) return 'B-1a (Auth local 入口)';
  if (/^functions\/api\/auth\/2fa\//.test(file)) return 'B-1b (2FA)';
  if (/^functions\/api\/auth\/(oauth|webauthn|wallet)/.test(file)) return 'B-1c (OAuth / WebAuthn / Wallet)';
  if (/^functions\/api\/auth\/(email|delete|identity|game|me\.js|refresh|step-up|userinfo)/.test(file)) return 'B-1d (Auth 其他)';
  if (/^functions\/api\/auth\/(devices|account|payments)/.test(file)) return 'B-2 (會員 Dashboard)';
  if (/^functions\/api\/(requisition|portfolio|ai)/.test(file)) return 'B-3 (公開頁 / Requisition / AI)';
  if (/^functions\/api\/admin/.test(file)) return 'B-4 (Admin 後台)';
  if (/^functions\/api\/(webhooks|payments)/.test(file)) return 'B-5 (Payments / Webhooks)';
  if (/^functions\/utils/.test(file)) return 'B-6 (utils 共用)';
  return 'B-X (其他)';
}
const byBucket = new Map();
for (const r of results) {
  const b = bucketOf(r.file);
  if (!byBucket.has(b)) byBucket.set(b, { files: new Set(), count: 0 });
  byBucket.get(b).files.add(r.file);
  byBucket.get(b).count++;
}

// ---- Render markdown ----
const out = [];
out.push('# Phase B Backend Error Code 盤點（2026-05-12）');
out.push('');
out.push('> Phase A 已建 `public/js/api.js#API_ERROR_I18N` 前端字典。本 doc 列出 `functions/` 下所有 `res({ error: \'...\' })` 缺 `code:` 欄位的處，作為 Phase B 漸進補碼依據。**本 PR 只盤點，不改 code**。');
out.push('');
out.push('## 摘要');
out.push(`- 總計：**${results.length} 處**缺 \`code\``);
out.push(`- 涉及檔案：**${filesSorted.length} 個**`);
out.push(`- 推薦新增 / 既有 i18n key：**${codeTable.length} 個**（去重後）`);
const needsReviewCount = codeTable.filter(c => !c.confident).length;
out.push(`- 仍標 \`NEEDS_REVIEW\` 待人工命名：**${needsReviewCount} 處**（佔 ${(needsReviewCount / codeTable.length * 100).toFixed(0)}%）`);
out.push(`- 變數型 \`error: <expr>\` 警告：**${warnings.length} 處**（列在文末警告區）`);
out.push('');
out.push('### 判定規則');
out.push('- 掃描 `res({ ... })` 物件 literal 字面值；同一物件 literal 內若有 `code: \'...\'` 字串欄位則跳過（已 OK）');
out.push('- `error:` 後接識別字 / 表達式視為「變數型」，列警告區');
out.push('- 多行物件 literal 用 `{` `}` 配對解析，字串內 `{` 不影響配對');
out.push('- 命名來源優先序：file-context（如 NOT_FOUND → INTENT_NOT_FOUND）→ MANUAL_CODE_MAP → SCOPE_REQUIRED → 原樣 → `NEEDS_REVIEW`');
out.push('');

out.push('## 推薦新 code 列表（去重 + 建議 zh-TW / en）');
out.push('');
out.push('| code | 出現處數 | 建議 zh-TW | 建議 en |');
out.push('|---|---:|---|---|');
for (const c of codeTable) {
  const zh = zhMap[c.code] || '（待補）';
  const en = c.errorStr.replace(/\|/g, '\\|');
  const flag = c.confident ? '' : ' ⚠️';
  out.push(`| \`${c.code}\`${flag} | ${c.count} | ${zh} | ${en} |`);
}
out.push('');
out.push('> ⚠️ = 仍標 `NEEDS_REVIEW`，建議實作 PR 動工時逐條定名');
out.push('> `INSUFFICIENT_SCOPE` 樣板化：i18n 字串內含 `{required}` 參數，傳入後端的 scope 字串');
out.push('');

// Code collisions（INSUFFICIENT_SCOPE 已排除；剩下都應該是真衝突，理論上應為 0）
const collisions = [...codeToStrs.entries()].filter(([, arr]) => arr.length > 1);
if (collisions.length) {
  out.push('### 命名衝突 / 故意合併（同 code 對應多字串）');
  out.push('');
  out.push('> 多數為**故意合併**（大小寫不同、措辭微異但語意一致），實作 PR 補 code 時挑一個對應的英文字串即可；真要拆碼會在這次 review 標註。');
  for (const [code, arr] of collisions) {
    out.push(`- \`${code}\`：`);
    for (const s of arr) out.push(`  - ${JSON.stringify(s)}`);
  }
  out.push('');
} else {
  out.push('### 命名衝突');
  out.push('無（INSUFFICIENT_SCOPE 樣板化處理不算衝突）');
  out.push('');
}

out.push('## 逐檔清單');
out.push('');
for (const file of filesSorted) {
  const arr = byFile.get(file);
  out.push(`### ${file}（${arr.length} 處）`);
  for (const r of arr) {
    const { code, confident, scope } = suggestCode(r.file, r.errorStr);
    const flag = confident ? '' : ' ⚠️';
    const note = scope ? `（scope=\`${scope}\`）` : '';
    out.push(`- L${r.line} \`'${r.errorStr.replace(/`/g, '\\`')}'\` → \`${code}\`${flag}${note}`);
  }
  out.push('');
}

if (warnings.length) {
  out.push('## 警告區（error 是變數 / 表達式，無從翻譯）');
  out.push('');
  for (const w of warnings) {
    out.push(`- ${w.file}:L${w.line} — \`error: ${w.expr}\``);
  }
  out.push('');
  out.push('> 處理建議：上游 catch 處改用 `res({ code: \'INTERNAL_ERROR\', error: e.message }, 500)`，前端優先讀 code、保留 error 供 debug。');
  out.push('');
}

out.push('## 後續 PR 切分建議');
out.push('');
const bucketsSorted = [...byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [name, info] of bucketsSorted) {
  out.push(`### PR ${name}`);
  out.push(`- 檔案：${info.files.size} 個，處數：**${info.count}**`);
  for (const f of [...info.files].sort()) out.push(`  - ${f}`);
  out.push('');
}

out.push('## 工具');
out.push('- 掃描器：`scripts/audit-error-i18n.mjs`（純讀取，bracket-match 解析 `res({...})`）');
out.push('- 渲染器：`scripts/audit-error-i18n-render.mjs`（含 `MANUAL_CODE_MAP` + file-context 規則）');
out.push('- 重跑：`node scripts/audit-error-i18n.mjs functions > scripts/audit-error-i18n.out.json && node scripts/audit-error-i18n-render.mjs`');
out.push('- 中介產物 `scripts/audit-error-i18n.out.json` 已加入 `.gitignore`，需要時重跑即可');
out.push('');

writeFileSync('docs/error-i18n-audit-phase-b.md', out.join('\n'), 'utf8');
console.log('Written docs/error-i18n-audit-phase-b.md  lines=', out.length);
