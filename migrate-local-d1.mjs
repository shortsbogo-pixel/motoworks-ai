import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dbPath = 'E:/Projects/motoworks-import-20260906-160143/motoworks-ai/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite';
const db = new DatabaseSync(dbPath);

const sql = fs.readFileSync('drizzle/0000_heavy_apocalypse.sql', 'utf8');
const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);

for (const stmt of statements) {
  db.exec(stmt);
}

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables migrated successfully in local D1:');
console.log(tables.map((t) => t.name));

db.close();
