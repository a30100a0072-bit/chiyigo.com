'use strict';

const TABLES = [
  'auth_codes',
  'pkce_sessions',
  'refresh_tokens',
  'email_verifications',
];

export default {
  async scheduled(_event, env, _ctx) {
    const results = {};

    for (const table of TABLES) {
      try {
        const { meta } = await env.chiyigo_db
          .prepare(`DELETE FROM ${table} WHERE expires_at < datetime('now')`)
          .run();
        results[table] = { deleted: meta.changes ?? 0 };
      } catch (err) {
        // 表不存在（如 email_verifications 尚未建立）時靜默略過
        results[table] = { skipped: err.message };
      }
    }

    console.log('[chiyigo-cleanup]', JSON.stringify(results));
  },
};
