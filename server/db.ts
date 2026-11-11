import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export function resolveMigrationPath(): string {
  const candidates = [
    path.resolve(PROJECT_ROOT, 'migrations', 'schema_migrations.sql'),
    path.resolve(process.cwd(), 'migrations', 'schema_migrations.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not locate migrations/schema_migrations.sql');
}

export function createDatabase(dbPath?: string): DatabaseSync {
  const targetPath = dbPath ?? process.env.GCCT_DB_PATH ?? path.resolve(process.cwd(), 'data', 'gcct.sqlite');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');

  const migrationSql = fs.readFileSync(resolveMigrationPath(), 'utf8');
  db.exec(migrationSql);

  // Incremental column upgrades for pre-existing SQLite files
  const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;');
  }
  db.exec("UPDATE users SET is_admin = 1 WHERE lower(username) = 'salman';");

  return db;
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors if connection already rolled back
    }
    throw err;
  }
}
