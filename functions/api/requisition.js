const REQUIRED = ['name', 'email', 'service', 'description'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body) {
  for (const key of REQUIRED) {
    if (!body[key]?.trim()) return `Missing field: ${key}`;
  }
  if (!EMAIL_RE.test(body.email)) return 'Invalid email format';
  if (body.description.length > 500) return 'Description too long';
  return null;
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    }),
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const err = validate(body);
  if (err) return Response.json({ error: err }, { status: 422 });

  try {
    const { meta } = await env.chiyigo_db.prepare(
      `INSERT INTO requisition (name, email, company, service, budget, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      body.name.trim(),
      body.email.trim().toLowerCase(),
      body.company?.trim() ?? '',
      body.service.trim(),
      body.budget?.trim() ?? '',
      body.description.trim()
    ).run();

    const message =
      `📥 <b>新需求通知</b>\n\n` +
      `👤 <b>姓名：</b>${body.name}\n` +
      `📧 <b>Email：</b>${body.email}\n` +
      `🏢 <b>公司：</b>${body.company || '未填'}\n` +
      `🛠 <b>服務：</b>${body.service}\n` +
      `💰 <b>預算：</b>${body.budget || '未填'}\n` +
      `📝 <b>描述：</b>\n${body.description}`;

    // 非阻塞 Telegram 通知
    waitUntil(sendTelegram(env, message));

    return Response.json({ success: true, id: meta.last_row_id }, { status: 201 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
