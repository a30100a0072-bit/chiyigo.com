import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STATE_DIR = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// 找最後修改的非 metadata sqlite 檔
const files = readdirSync(STATE_DIR)
  .filter(f => f.endsWith('.sqlite') && !f.startsWith('metadata'))
  .map(f => ({ name: f, mtime: statSync(join(STATE_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (!files.length) {
  console.error('No D1 sqlite files found. Start wrangler pages dev first.');
  process.exit(1);
}

// 寫入兩個最近的 DB（pages dev 與 d1 execute 各一個）
for (const file of files.slice(0, 2)) {
  const path = join(STATE_DIR, file.name);
  console.log(`\nApplying schema to: ${file.name}`);
  try {
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        title     TEXT    NOT NULL,
        category  TEXT    NOT NULL,
        description TEXT,
        image_url TEXT,
        link_url  TEXT,
        tags      TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS requisition (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL,
        company     TEXT,
        service     TEXT NOT NULL,
        budget      TEXT,
        description TEXT NOT NULL,
        created_at  TEXT DEFAULT (datetime('now'))
      );
    `);
    // 確認
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('  Tables:', tables.map(t => t.name).join(', '));
    db.close();
    console.log('  Done.');
  } catch (e) {
    console.error('  Error:', e.message);
  }
}
console.log('\nAll done. You can now start wrangler pages dev.');
