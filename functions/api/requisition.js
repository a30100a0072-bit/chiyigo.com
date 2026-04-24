const REQUIRED = ['name', 'contact', 'service_type', 'message'];

function validate(body) {
  for (const key of REQUIRED) {
    if (!body[key]?.trim()) return `Missing field: ${key}`;
  }
  const v = body.contact.trim();
  const isEmail = /.+@.+\..+/.test(v);
  const isPhone = /^09\d{8}$/.test(v);
  const isLine  = /^[a-zA-Z0-9._\-@]{4,}$/.test(v);
  if (!isEmail && !isPhone && !isLine) return 'Invalid contact format';
  if (body.message.length > 2000) return 'Message too long';
  return null;
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
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
      `INSERT INTO requisition (name, company, contact, service_type, budget, timeline, message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.name.trim(),
      body.company?.trim() ?? '',
      body.contact.trim(),
      body.service_type.trim(),
      body.budget?.trim()   ?? '',
      body.timeline?.trim() ?? '',
      body.message.trim()
    ).run();

    const message =
      `📥 <b>新諮詢通知</b>\n\n` +
      `👤 <b>姓名：</b>${body.name}\n` +
      `📱 <b>聯絡：</b>${body.contact}\n` +
      `🏢 <b>公司：</b>${body.company || '未填'}\n` +
      `🛠 <b>需求：</b>${body.service_type}\n` +
      `💰 <b>預算：</b>${body.budget || '未填'}\n` +
      `⏱ <b>時程：</b>${body.timeline || '未填'}\n` +
      `📝 <b>簡述：</b>\n${body.message}`;

    waitUntil(sendTelegram(env, message));

    return Response.json({ success: true, id: meta.last_row_id }, { status: 201 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
