const RESEND_API = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'noreply@chiyigo.com';
const BASE_URL = 'https://chiyigo.com';

/**
 * @param {string} apiKey
 * @param {string} to
 * @param {string} token  raw hex token
 */
export async function sendDeleteConfirmationEmail(apiKey, to, token) {
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

  return sendEmail(apiKey, {
    to,
    subject: '確認刪除你的 Chiyigo 帳號',
    html,
  })
}

async function sendEmail(apiKey, { to, subject, html }) {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
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
export async function sendVerificationEmail(apiKey, to, token) {
  const link = `${BASE_URL}/api/auth/email/verify?token=${token}`;

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

  return sendEmail(apiKey, {
    to,
    subject: '驗證你的 Chiyigo 帳號 Email',
    html,
  });
}

/**
 * 發送密碼重設信。
 * @param {string} apiKey  RESEND_API_KEY（來自 env）
 * @param {string} to      收件人信箱
 * @param {string} token   原始 token（hex，64 字元）
 */
export async function sendPasswordResetEmail(apiKey, to, token) {
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

  return sendEmail(apiKey, {
    to,
    subject: '重設你的 Chiyigo 帳號密碼',
    html,
  });
}
