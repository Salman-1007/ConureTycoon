import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Parse PostgreSQL BIGINT (OID 20), INT2/4, FLOAT8, NUMERIC directly as JS numbers
pg.types.setTypeParser(20, (val) => Number(val));
pg.types.setTypeParser(21, (val) => Number(val));
pg.types.setTypeParser(23, (val) => Number(val));
pg.types.setTypeParser(700, (val) => Number(val));
pg.types.setTypeParser(701, (val) => Number(val));
pg.types.setTypeParser(1700, (val) => Number(val));

export interface DbExecutor {
  dialect: 'sqlite' | 'postgres';
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}

export interface AppDatabase extends DbExecutor {
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function loadEnvFileOnce(): void {
  const envCandidates = [
    path.resolve(PROJECT_ROOT, '.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
    break;
  }
}

export function resolveMigrationPath(filename = 'schema_migrations.sql'): string {
  const candidates = [
    path.resolve(PROJECT_ROOT, 'migrations', filename),
    path.resolve(process.cwd(), 'migrations', filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate migrations/${filename}`);
}

export function convertQuestionMarksToPg(sql: string): string {
  let out = '';
  let idx = 1;
  let inSingleQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && sql[i + 1] === "'") {
        out += sql[i + 1];
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (ch === '?' && !inSingleQuote) {
      out += `$${idx++}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function normalizeParams(params: unknown[]): Array<string | number | Uint8Array | null> {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p as string | number | Uint8Array;
  });
}

function createSqliteDatabase(targetPath: string): AppDatabase {
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const rawDb = new DatabaseSync(targetPath);
  rawDb.exec('PRAGMA journal_mode = WAL;');
  rawDb.exec('PRAGMA busy_timeout = 5000;');
  rawDb.exec('PRAGMA foreign_keys = ON;');

  const migrationSql = fs.readFileSync(resolveMigrationPath('schema_migrations.sql'), 'utf8');
  rawDb.exec(migrationSql);

  // Incremental column upgrades for pre-existing SQLite files
  const userCols = rawDb.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'is_admin')) {
    rawDb.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;');
  }
  rawDb.exec("UPDATE users SET is_admin = 1 WHERE lower(username) = 'salman';");

  const birdCols = rawDb.prepare('PRAGMA table_info(birds)').all() as Array<{ name: string }>;
  if (!birdCols.some((c) => c.name === 'genetics_reveal_at')) {
    rawDb.exec('ALTER TABLE birds ADD COLUMN genetics_reveal_at INTEGER NOT NULL DEFAULT 0;');
  }
  if (!birdCols.some((c) => c.name === 'genetics_processed')) {
    rawDb.exec('ALTER TABLE birds ADD COLUMN genetics_processed INTEGER NOT NULL DEFAULT 1;');
  }
  rawDb.exec('UPDATE birds SET cooldown_until = 0 WHERE cooldown_until > 0;');

  const cageCols = rawDb.prepare('PRAGMA table_info(breeding_cages)').all() as Array<{ name: string }>;
  if (!cageCols.some((c) => c.name === 'laid_at')) {
    rawDb.exec('ALTER TABLE breeding_cages ADD COLUMN laid_at INTEGER NOT NULL DEFAULT 0;');
    rawDb.exec('UPDATE breeding_cages SET laid_at = started_at WHERE laid_at = 0;');
  }
  if (!cageCols.some((c) => c.name === 'fostered_count')) {
    rawDb.exec('ALTER TABLE breeding_cages ADD COLUMN fostered_count INTEGER NOT NULL DEFAULT 0;');
  }

  let txDepth = 0;

  const executor: DbExecutor = {
    dialect: 'sqlite',
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      return rawDb.prepare(sql).get(...normalizeParams(params)) as T | undefined;
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      return rawDb.prepare(sql).all(...normalizeParams(params)) as unknown as T[];
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const res = rawDb.prepare(sql).run(...normalizeParams(params));
      return { changes: Number(res.changes ?? 0) };
    },
    async exec(sql: string): Promise<void> {
      rawDb.exec(sql);
    },
  };

  return {
    ...executor,
    async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      if (txDepth > 0) {
        return fn(executor);
      }
      txDepth++;
      rawDb.exec('BEGIN IMMEDIATE;');
      try {
        const result = await fn(executor);
        rawDb.exec('COMMIT;');
        return result;
      } catch (err) {
        try {
          rawDb.exec('ROLLBACK;');
        } catch {
          // Ignore rollback errors if connection already rolled back
        }
        throw err;
      } finally {
        txDepth--;
      }
    },
    async close(): Promise<void> {
      rawDb.close();
    },
  };
}

function makePgExecutor(clientOrPool: pg.Pool | pg.PoolClient): DbExecutor {
  return {
    dialect: 'postgres',
    async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const pgSql = convertQuestionMarksToPg(sql);
      const res = await clientOrPool.query(pgSql, normalizeParams(params));
      return res.rows[0] as T | undefined;
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      const pgSql = convertQuestionMarksToPg(sql);
      const res = await clientOrPool.query(pgSql, normalizeParams(params));
      return res.rows as T[];
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const pgSql = convertQuestionMarksToPg(sql);
      const res = await clientOrPool.query(pgSql, normalizeParams(params));
      return { changes: Number(res.rowCount ?? 0) };
    },
    async exec(sql: string): Promise<void> {
      await clientOrPool.query(sql);
    },
  };
}

async function createPostgresDatabase(connectionString: string): Promise<AppDatabase> {
  const hasSslParam = /[?&]sslmode=/i.test(connectionString);
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const pool = new pg.Pool({
    connectionString,
    ...(isLocal ? { ssl: false } : hasSslParam ? {} : { ssl: { rejectUnauthorized: false } }),
    max: 12,
  });

  const migrationSql = fs.readFileSync(resolveMigrationPath('schema_migrations_pg.sql'), 'utf8');
  await pool.query(migrationSql);

  // Additive schema safety for pre-existing Neon deployments
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER NOT NULL DEFAULT 0");
  await pool.query("UPDATE users SET is_admin = 1 WHERE lower(username) = 'salman'");
  await pool.query('ALTER TABLE birds ADD COLUMN IF NOT EXISTS genetics_reveal_at BIGINT NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE birds ADD COLUMN IF NOT EXISTS genetics_processed INTEGER NOT NULL DEFAULT 1');
  await pool.query('UPDATE birds SET cooldown_until = 0 WHERE cooldown_until > 0');
  await pool.query('ALTER TABLE breeding_cages ADD COLUMN IF NOT EXISTS laid_at BIGINT NOT NULL DEFAULT 0');
  await pool.query('UPDATE breeding_cages SET laid_at = started_at WHERE laid_at = 0');
  await pool.query('ALTER TABLE breeding_cages ADD COLUMN IF NOT EXISTS fostered_count INTEGER NOT NULL DEFAULT 0');

  const rootExecutor = makePgExecutor(pool);

  return {
    ...rootExecutor,
    async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const txExecutor = makePgExecutor(client);
      try {
        await client.query('BEGIN');
        const result = await fn(txExecutor);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback error
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export async function createDatabase(dbPathOrUrl?: string): Promise<AppDatabase> {
  if (!dbPathOrUrl) {
    loadEnvFileOnce();
  }

  const candidate = dbPathOrUrl ?? process.env.DATABASE_URL ?? process.env.GCCT_DB_PATH;
  if (candidate && (candidate.startsWith('postgres://') || candidate.startsWith('postgresql://'))) {
    return createPostgresDatabase(candidate);
  }

  const targetPath = candidate ?? path.resolve(process.cwd(), 'data', 'gcct.sqlite');
  return createSqliteDatabase(targetPath);
}

export function withTransaction<T>(db: DbExecutor | AppDatabase, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  if ('transaction' in db && typeof db.transaction === 'function') {
    return db.transaction(fn);
  }
  return fn(db);
}
