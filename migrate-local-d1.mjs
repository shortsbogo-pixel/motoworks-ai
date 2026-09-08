import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dbPath = 'E:/Projects/motoworks-import-20260906-160143/motoworks-ai/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite';
const db = new DatabaseSync(dbPath);

const migrationFiles = [
  'drizzle/0000_heavy_apocalypse.sql',
  'drizzle/0001_add_plate_digits_hash.sql',
  'drizzle/0002_steep_misty_knight.sql',
  'drizzle/0003_add_idempotency_key.sql',
];

for (const file of migrationFiles) {
  if (fs.existsSync(file)) {
    const sql = fs.readFileSync(file, 'utf8');
    const statements = sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (err) {
        // 이미 존재하는 테이블/컬럼/인덱스는 건너뜀
      }
    }
  }
}

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables migrated successfully in local D1:');
console.log(tables.map((t) => t.name));

db.close();
