/**
 * 列出 / 刪除作品集
 * 用法：node scripts/portfolio-list.mjs [delete <id>]
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STATE_DIR = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1');

function getLatestDb() {
  const files = readdirSync(STATE_DIR)
    .filter(f => f.endsWith('.sqlite') && !f.startsWith('metadata'))
    .map(f => ({ name: f, mtime: statSync(join(STATE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error('找不到本機 D1 DB');
  return join(STATE_DIR, files[0].name);
}

const db = new DatabaseSync(getLatestDb());
const [,, action, id] = process.argv;

if (action === 'delete' && id) {
  db.prepare('DELETE FROM portfolio WHERE id = ?').run(Number(id));
  console.log(`已刪除 ID: ${id}`);
}

const rows = db.prepare('SELECT id, title, category, sort_order, created_at FROM portfolio ORDER BY sort_order, id').all();
console.log('\n===== 作品集清單 =====');
console.table(rows);
console.log(`共 ${rows.length} 筆\n`);
db.close();
