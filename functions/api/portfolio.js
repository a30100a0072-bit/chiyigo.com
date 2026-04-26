export async function onRequestGet({ env }) {
  try {
    const { results } = await env.chiyigo_db.prepare(
      `SELECT id, title, category, description, image_url, link_url, tags
       FROM portfolio
       ORDER BY sort_order ASC, created_at DESC`
    ).all();

    return Response.json({ items: results }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch {
    return Response.json({ error: 'Failed to load portfolio' }, { status: 500 });
  }
}
