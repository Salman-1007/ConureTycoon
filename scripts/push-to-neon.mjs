import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const PROJECT_ROOT = process.cwd();

function loadDotEnvIfNeeded() {
  const envPath = path.resolve(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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
}

function topoSortBirds(birds) {
  const byId = new Map(birds.map((b) => [b.id, b]));
  const visited = new Set();
  const ordered = [];

  function visit(bird) {
    if (!bird || visited.has(bird.id)) return;
    visited.add(bird.id);
    if (bird.father_id && byId.has(bird.father_id)) visit(byId.get(bird.father_id));
    if (bird.mother_id && byId.has(bird.mother_id)) visit(byId.get(bird.mother_id));
    ordered.push(bird);
  }

  for (const b of birds) visit(b);
  return ordered;
}

async function main() {
  loadDotEnvIfNeeded();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
    console.error('DATABASE_URL is missing or not a PostgreSQL URL. Set it in .env first.');
    process.exit(1);
  }

  const schemaPath = path.resolve(PROJECT_ROOT, 'migrations', 'schema_migrations_pg.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const client = await pool.connect();

  try {
    console.log('[Neon Push] Connected to Neon PostgreSQL. Applying schema...');
    await client.query(schemaSql);
    console.log('[Neon Push] Schema tables & indexes verified.');

    const sqlitePath = process.env.GCCT_DB_PATH ?? path.resolve(PROJECT_ROOT, 'data', 'gcct.sqlite');
    if (!fs.existsSync(sqlitePath)) {
      console.log('[Neon Push] No local data/gcct.sqlite found — schema created cleanly (backend will auto-seed on startup).');
      return;
    }

    const sqlite = new DatabaseSync(sqlitePath);
    const tableOrder = [
      'users',
      'sessions',
      'birds',
      'user_discovered_genes',
      'market_batches',
      'market_listings',
      'breeding_cages',
      'p2p_listings',
      'showroom_entries',
      'user_badges',
      'notifications',
      'system_meta',
      'mutation_configs',
      'special_birds',
      'payment_requests',
      'chat_messages',
    ];

    await client.query('BEGIN');
    if (process.argv.includes('--fresh')) {
      console.log('[Neon Push] --fresh specified: clearing pre-seeded/duplicate tables before clean import...');
      await client.query(`TRUNCATE TABLE ${tableOrder.map((t) => `"${t}"`).join(', ')} CASCADE`);
    }
    const summary = {};

    for (const table of tableOrder) {
      let rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      if (table === 'birds') {
        rows = topoSortBirds(rows);
      }

      if (rows.length === 0) {
        summary[table] = { sqlite: 0, pushed: 0 };
        continue;
      }

      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
      const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

      let pushed = 0;
      for (const row of rows) {
        const vals = cols.map((c) => (row[c] === undefined ? null : row[c]));
        const res = await client.query(insertSql, vals);
        pushed += Number(res.rowCount ?? 0);
      }
      summary[table] = { sqlite: rows.length, inserted: pushed };
    }

    // Ensure salman admin & zero cooldown consistency in Neon
    await client.query("UPDATE users SET is_admin = 1 WHERE lower(username) = 'salman'");
    await client.query('UPDATE birds SET cooldown_until = 0 WHERE cooldown_until > 0');
    await client.query('COMMIT');
    sqlite.close();

    console.log('[Neon Push] Local SQLite data pushed cleanly to Neon:');
    for (const [tbl, stats] of Object.entries(summary)) {
      const neonCountRes = await client.query(`SELECT COUNT(*)::int AS c FROM "${tbl}"`);
      console.log(`  - ${tbl.padEnd(24)} SQLite=${String(stats.sqlite).padStart(4)} | NewlyInserted=${String(stats.inserted ?? 0).padStart(4)} | NeonTotal=${neonCountRes.rows[0].c}`);
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[Neon Push] Failed:', err);
  process.exit(1);
});
