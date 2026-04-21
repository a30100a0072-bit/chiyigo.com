/**
 * 作品集新增工具
 * 用法：node scripts/portfolio-add.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline/promises';

const STATE_DIR = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1');

function getLatestDb() {
  const files = readdirSync(STATE_DIR)
    .filter(f => f.endsWith('.sqlite') && !f.startsWith('metadata'))
    .map(f => ({ name: f, mtime: statSync(join(STATE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error('找不到本機 D1 DB，請先啟動 wrangler pages dev');
  return join(STATE_DIR, files[0].name);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function ask(q, fallback = '') {
  const ans = await rl.question(q);
  return ans.trim() || fallback;
}

console.log('\n===== CHIYIGO 作品集新增工具 =====\n');

const title       = await ask('標題（必填）：');
const category    = await ask('分類（Branding / Web / Marketing）：');
const description = await ask('描述（選填）：');
const image_url   = await ask('圖片路徑（選填，例：/images/work-1.jpg）：');
const link_url    = await ask('連結網址（選填）：');
const tags        = await ask('標籤（逗號分隔，選填）：');
const sort_order  = await ask('排序數字（選填，預設 0）：', '0');

rl.close();

if (!title || !category) {
  console.error('\n標題和分類為必填！');
  process.exit(1);
}

const db = new DatabaseSync(getLatestDb());
const stmt = db.prepare(`
  INSERT INTO portfolio (title, category, description, image_url, link_url, tags, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const result = stmt.run(title, category, description || null, image_url || null, link_url || null, tags || null, Number(sort_order));
console.log(`\n✅ 新增成功！ID: ${result.lastInsertRowid}`);

// 列出所有作品
const all = db.prepare('SELECT id, title, category, sort_order FROM portfolio ORDER BY sort_order, id').all();
console.log('\n目前作品集：');
console.table(all);
db.close();
