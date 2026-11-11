import type { ServerTimeDTO } from '../shared/api-types.js';
import type { DbExecutor } from './db.js';

export const HOUR_MS = 60 * 60 * 1000;
const DEV_OFFSET_KEY = 'dev_time_offset_ms';

export function isDevTimeToolsEnabled(): boolean {
  if (process.env.GCCT_ENABLE_DEV_TOOLS === 'true') return true;
  if (process.env.GCCT_ENABLE_DEV_TOOLS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export async function getDevTimeOffsetMs(db: DbExecutor): Promise<number> {
  if (!isDevTimeToolsEnabled()) return 0;
  const row = await db.get<{ meta_value: string }>('SELECT meta_value FROM system_meta WHERE meta_key = ?', DEV_OFFSET_KEY);
  const parsed = row ? Number(row.meta_value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function advanceDevTimeOffsetMs(db: DbExecutor, deltaMs: number): Promise<number> {
  if (!isDevTimeToolsEnabled()) {
    throw new Error('Developer time controls are disabled in production mode.');
  }
  const current = await getDevTimeOffsetMs(db);
  const next = Math.max(0, current + Math.round(deltaMs));
  await db.run(
    `INSERT INTO system_meta (meta_key, meta_value) VALUES (?, ?)
     ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value`,
    DEV_OFFSET_KEY,
    String(next),
  );
  return next;
}

export async function resetDevTimeOffsetMs(db: DbExecutor): Promise<void> {
  if (!isDevTimeToolsEnabled()) return;
  await db.run('DELETE FROM system_meta WHERE meta_key = ?', DEV_OFFSET_KEY);
}

export function getHourBucketUtc(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export async function getServerClock(db: DbExecutor): Promise<ServerTimeDTO> {
  const serverUtcMs = Date.now();
  const timeOffsetMs = await getDevTimeOffsetMs(db);
  const effectiveNowMs = serverUtcMs + timeOffsetMs;
  const currentHourBucketUtc = getHourBucketUtc(effectiveNowMs);
  const nextRefreshUtcMs = currentHourBucketUtc + HOUR_MS;

  return {
    serverUtcMs,
    effectiveNowMs,
    timeOffsetMs,
    currentHourBucketUtc,
    nextRefreshUtcMs,
  };
}
