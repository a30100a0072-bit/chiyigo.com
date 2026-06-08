export async function onRequestGet({ env }: { env: Env }) {
  try {
    const { results } = await env.chiyigo_db.prepare(
      `SELECT id, title, category, description, image_url, link_url, tags
       FROM portfolio
       ORDER BY
         CASE category
           WHEN 'Web'         THEN 1
           WHEN 'System'      THEN 2
           WHEN 'AI'          THEN 3
           WHEN 'Analytics'   THEN 4
           WHEN 'App'         THEN 5
           WHEN 'Integration' THEN 6
           WHEN 'Game'        THEN 7
           WHEN 'Platform'    THEN 8
           ELSE 99
         END ASC,
         sort_order ASC,
         created_at DESC`
    ).all();

    return Response.json({ items: results }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch {
    return Response.json({ error: 'Failed to load portfolio' }, { status: 500 });
  }
}
