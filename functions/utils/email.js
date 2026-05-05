const RESEND_API = 'https://api.resend.com/emails';
const DEFAULT_FROM     = 'noreply@chiyigo.com';
const DEFAULT_BASE_URL = 'https://chiyigo.com';

function fromOf(env)    { return env?.MAIL_FROM_ADDRESS ?? DEFAULT_FROM }
function baseUrlOf(env) { return env?.IAM_BASE_URL      ?? DEFAULT_BASE_URL }

/**
 * 所有 send* 函式皆額外接受 env，用以讀取 MAIL_FROM_ADDRESS / IAM_BASE_URL。
 * 既有呼叫方 (apiKey, to, token) 可繼續運作（env=undefined 時回退到預設值）。
 *
 * @param {string} apiKey
 * @param {string} to
 * @param {string} token  raw hex token
 * @param {object} [env]
 */
export async function sendDeleteConfirmationEmail(apiKey, to, token, env) {
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

async function sendEmail(apiKey, env, { to, subject, html }, signal) {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromOf(env), to, subject, html }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * 發送 Email 驗證信。
 * @param {string} apiKey  RESEND_API_KEY（來自 env）
 * @param {string} to      收件人信箱
 * @param {string} token   原始 token（hex，64 字元）
 */
export async function sendVerificationEmail(apiKey, to, token, env, signal) {
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
  }, signal);
}

/**
 * 發送密碼重設信。
 * @param {string} apiKey  RESEND_API_KEY（來自 env）
 * @param {string} to      收件人信箱
 * @param {string} token   原始 token（hex，64 字元）
 */
export async function sendPasswordResetEmail(apiKey, to, token, env) {
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
export async function sendNewDeviceAlertEmail(apiKey, to, info, env) {
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
