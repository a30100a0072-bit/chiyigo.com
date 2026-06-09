const RESEND_API = 'https://api.resend.com/emails';
const DEFAULT_FROM     = 'noreply@chiyigo.com';
const DEFAULT_BASE_URL = 'https://chiyigo.com';

// 補 §程式碼要求「外部呼叫必設 timeout」基線。caller 自帶 signal 時不 wrap、
// 保 signal contract（如 send-verification.ts 自管 timeout）；無 signal 才建內部
// AbortController + setTimeout，避免裸 fetch 無限等。env override RESEND_TIMEOUT_MS。
// retry policy 延後到 F-2 金流 smoke 一起設計（屆時有 Resend 真實 5xx/429 訊號）。
const RESEND_TIMEOUT_MS_DEFAULT = 5_000

type EmailEnv = Pick<Env, 'IAM_BASE_URL' | 'MAIL_FROM_ADDRESS' | 'RESEND_TIMEOUT_MS'>

function fromOf(env?: EmailEnv)    { return env?.MAIL_FROM_ADDRESS ?? DEFAULT_FROM }
function baseUrlOf(env?: EmailEnv) { return env?.IAM_BASE_URL      ?? DEFAULT_BASE_URL }

function parseTimeoutMs(env?: EmailEnv): number {
  const raw = env?.RESEND_TIMEOUT_MS
  if (raw == null || raw === '') return RESEND_TIMEOUT_MS_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 10) return RESEND_TIMEOUT_MS_DEFAULT
  return Math.floor(n)
}

/**
 * 所有 send* 函式皆額外接受 env，用以讀取 MAIL_FROM_ADDRESS / IAM_BASE_URL。
 * 既有呼叫方 (apiKey, to, token) 可繼續運作（env=undefined 時回退到預設值）。
 *
 * @param {string} apiKey
 * @param {string} to
 * @param {string} token  raw hex token
 * @param {object} [env]
 */
export async function sendDeleteConfirmationEmail(apiKey: string | undefined, to: string, token: string, env?: EmailEnv) {
  const BASE_URL = baseUrlOf(env)
  const link = `${BASE_URL}/confirm-delete.html?token=${token}`

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto">
    <tr><td style="padding:32px;background:#1e293b;border-radius:12px">
      <h1 style="margin:0 0 8px;font-size:24px;color:#f8fafc">確認刪除帳號</h1>
      <p style="margin:0 0 8px;color:#94a3b8;font-size:14px">
        我們收到你刪除 Chiyigo 帳號的請求。此操作不可逆，所有個人資料將被永久移除。
      </p>
      <p style="margin:0 0 24px;color:#f87171;font-size:13px;font-weight:600">
        若非本人操作，請立即忽略此信，你的帳號不會有任何變動。
      </p>
      <a href="${link}"
         style="display:inline-block;padding:12px 28px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
        確認刪除帳號
      </a>
      <p style="margin:24px 0 0;color:#475569;font-size:12px">
        連結 15 分鐘後失效，且僅能使用一次。
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim()

  return sendEmail(apiKey, env, {
    to,
    subject: '確認刪除你的 Chiyigo 帳號',
    html,
  })
}

async function sendEmail(apiKey: string | undefined, env: EmailEnv | undefined, { to, subject, html, signal }: { to: string; subject: string; html: string; signal?: AbortSignal }) {
  // caller 給 signal = caller 已自管 timeout / cancellation；原樣 pass 不 wrap。
  // 沒 signal 才建內部 timeout，避免裸 fetch 無限等 + Worker 卡到 wall-clock 終止。
  let actualSignal = signal
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (!signal) {
    const timeoutMs = parseTimeoutMs(env)
    const ctrl = new AbortController()
    timeoutId = setTimeout(() => ctrl.abort(new Error(`Resend timeout after ${timeoutMs}ms`)), timeoutMs)
    actualSignal = ctrl.signal
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromOf(env), to, subject, html }),
      signal: actualSignal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }

    // await 拉進 try：success path 也要等 body 解析完才 clearTimeout，避免
    // Resend header 已回但 body 卡住時 timeout 提早被 finally 清掉。
    return await res.json();
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/**
 * 發送 Email 驗證信。
 * @param {string} apiKey  RESEND_API_KEY（來自 env）
 * @param {string} to      收件人信箱
 * @param {string} token   原始 token（hex，64 字元）
 */
export async function sendVerificationEmail(apiKey: string | undefined, to: string, token: string, env?: EmailEnv, signal?: AbortSignal) {
  const BASE_URL = baseUrlOf(env)
  // 改指向前端確認頁，使用者按下按鈕才 POST 核銷，避免郵件代理 / 預載提前消耗 token
  const link = `${BASE_URL}/verify-email.html?token=${token}`;

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto">
    <tr><td style="padding:32px;background:#1e293b;border-radius:12px">
      <h1 style="margin:0 0 8px;font-size:24px;color:#f8fafc">驗證你的 Email</h1>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:14px">請在 1 小時內點擊下方按鈕完成驗證。</p>
      <a href="${link}"
         style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
        驗證 Email
      </a>
      <p style="margin:24px 0 0;color:#475569;font-size:12px">
        若非本人操作，請忽略此信。<br>
        連結 1 小時後失效，且僅能使用一次。
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendEmail(apiKey, env, {
    to,
    subject: '驗證你的 Chiyigo 帳號 Email',
    html,
    signal,
  });
}

/**
 * 發送組織邀請信（PR4 Invitation）。
 * @param {string} apiKey  RESEND_API_KEY（來自 env）
 * @param {string} to      被邀請人信箱
 * @param {string} token   原始邀請 token（hex，64 字元；僅存在於信件連結，DB 只存 hash）
 */
export async function sendInvitationEmail(apiKey: string | undefined, to: string, token: string, env?: EmailEnv, signal?: AbortSignal) {
  const BASE_URL = baseUrlOf(env)
  // 指向前端接受頁，使用者登入後按下按鈕才 POST /api/invitations/accept 核銷（避免郵件預載提前消耗）
  const link = `${BASE_URL}/accept-invitation.html?token=${token}`;

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto">
    <tr><td style="padding:32px;background:#1e293b;border-radius:12px">
      <h1 style="margin:0 0 8px;font-size:24px;color:#f8fafc">你被邀請加入組織</h1>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:14px">登入（或註冊）你的 Chiyigo 帳號後，點擊下方按鈕接受邀請。</p>
      <a href="${link}"
         style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
        接受邀請
      </a>
      <p style="margin:24px 0 0;color:#475569;font-size:12px">
        此邀請限本信箱使用，且僅能接受一次。<br>
        若非預期收到此信，請忽略。
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendEmail(apiKey, env, {
    to,
    subject: '你被邀請加入 Chiyigo 組織',
    html,
    signal,
  });
}

/**
 * 發送密碼重設信。
 * @param {string} apiKey  RESEND_API_KEY（來自 env）
 * @param {string} to      收件人信箱
 * @param {string} token   原始 token（hex，64 字元）
 */
export async function sendPasswordResetEmail(apiKey: string | undefined, to: string, token: string, env?: EmailEnv) {
  const BASE_URL = baseUrlOf(env)
  const link = `${BASE_URL}/reset-password.html?token=${token}`;

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto">
    <tr><td style="padding:32px;background:#1e293b;border-radius:12px">
      <h1 style="margin:0 0 8px;font-size:24px;color:#f8fafc">重設密碼</h1>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:14px">請在 1 小時內點擊下方按鈕重設密碼。</p>
      <a href="${link}"
         style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
        重設密碼
      </a>
      <p style="margin:24px 0 0;color:#475569;font-size:12px">
        若非本人操作，請立即忽略此信，你的密碼不會被更動。<br>
        連結 1 小時後失效，且僅能使用一次。
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendEmail(apiKey, env, {
    to,
    subject: '重設你的 Chiyigo 帳號密碼',
    html,
  });
}

/**
 * Phase D-4：新裝置首次登入提醒。
 * 不可逆操作不需要連結；只是通知 + 引導到 dashboard 處置。
 *
 * @param {string} apiKey  RESEND_API_KEY
 * @param {string} to      使用者信箱
 * @param {object} info    { deviceUuidPrefix, country, when }
 * @param {object} env
 */
export async function sendNewDeviceAlertEmail(apiKey: string | undefined, to: string, info: { deviceUuidPrefix?: string; country?: string; when?: string }, env?: EmailEnv) {
  const BASE_URL = baseUrlOf(env)
  const dash = `${BASE_URL}/dashboard.html`
  const devLabel = info.deviceUuidPrefix ? `App 裝置 ${info.deviceUuidPrefix}…` : '新裝置'
  const country  = info.country ?? '未知'
  const when     = info.when ?? new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto">
    <tr><td style="padding:32px;background:#1e293b;border-radius:12px">
      <h1 style="margin:0 0 8px;font-size:22px;color:#f8fafc">📱 新裝置登入提醒</h1>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:14px">
        我們偵測到你的 Chiyigo 帳號被一個沒看過的裝置登入：
      </p>
      <table style="margin:0 0 20px;color:#e2e8f0;font-size:14px;line-height:1.6">
        <tr><td style="color:#94a3b8;padding-right:16px">裝置</td><td>${devLabel}</td></tr>
        <tr><td style="color:#94a3b8;padding-right:16px">地區</td><td>${country}</td></tr>
        <tr><td style="color:#94a3b8;padding-right:16px">時間</td><td>${when}</td></tr>
      </table>
      <p style="margin:0 0 20px;color:#fbbf24;font-size:13px;font-weight:600">
        若不是你本人，請立即至 dashboard 登出此裝置並修改密碼。
      </p>
      <a href="${dash}"
         style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
        開啟 Dashboard
      </a>
      <p style="margin:24px 0 0;color:#475569;font-size:12px">
        若是你本人，可忽略此通知。Chiyigo 不會透過 email 索取密碼或 2FA 驗證碼。
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim()

  return sendEmail(apiKey, env, {
    to,
    subject: '⚠ Chiyigo 新裝置登入提醒',
    html,
  })
}

/**
 * Phase E-2：高風險登入被擋下提醒。
 * caller 在 risk score ≥ 70 時呼叫；email 用於告知本人「我們擋了一次嫌疑登入」。
 *
 * @param {string} apiKey
 * @param {string} to
 * @param {object} info  { score, factors:[...], country, when }
 * @param {object} env
 */
export async function sendRiskBlockedAlertEmail(apiKey: string | undefined, to: string, info: { score?: number; factors?: string[]; country?: string; when?: string }, env?: EmailEnv) {
  const BASE_URL = baseUrlOf(env)
  const dash = `${BASE_URL}/dashboard.html`
  const reset = `${BASE_URL}/forgot-password.html`
  const score = info.score ?? '?'
  const factors = (info.factors ?? []).join(', ') || '—'
  const country = info.country ?? '未知'
  const when = info.when ?? new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:40px auto">
    <tr><td style="padding:32px;background:#1e293b;border-radius:12px">
      <h1 style="margin:0 0 8px;font-size:22px;color:#f87171">🚨 高風險登入已被擋下</h1>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:14px">
        我們偵測到一次風險評分過高的登入嘗試，已主動擋下：
      </p>
      <table style="margin:0 0 20px;color:#e2e8f0;font-size:14px;line-height:1.6">
        <tr><td style="color:#94a3b8;padding-right:16px">風險分數</td><td style="color:#fbbf24;font-weight:600">${score} / 100</td></tr>
        <tr><td style="color:#94a3b8;padding-right:16px">觸發原因</td><td>${factors}</td></tr>
        <tr><td style="color:#94a3b8;padding-right:16px">地區</td><td>${country}</td></tr>
        <tr><td style="color:#94a3b8;padding-right:16px">時間</td><td>${when}</td></tr>
      </table>
      <p style="margin:0 0 20px;color:#fbbf24;font-size:13px;font-weight:600">
        如果這次嘗試**就是你本人**（VPN / 出國 / 換新裝置半夜登入等），
        恢復常態後再試一次即可，不需要其他動作。
      </p>
      <p style="margin:0 0 20px;color:#f87171;font-size:13px;font-weight:600">
        如果**不是你**，請立即重設密碼並檢查綁定的裝置 / passkey：
      </p>
      <a href="${reset}"
         style="display:inline-block;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;margin-right:8px">
        立即重設密碼
      </a>
      <a href="${dash}"
         style="display:inline-block;padding:12px 24px;background:#374151;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
        查看裝置列表
      </a>
      <p style="margin:24px 0 0;color:#475569;font-size:12px">
        Chiyigo 不會透過 email 索取密碼或 2FA 驗證碼。
      </p>
    </td></tr>
  </table>
</body>
</html>`.trim()

  return sendEmail(apiKey, env, {
    to,
    subject: '🚨 Chiyigo 高風險登入已被擋下',
    html,
  })
}
