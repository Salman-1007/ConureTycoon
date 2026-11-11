import type { DatabaseSync } from 'node:sqlite';
import type { ServerTimeDTO } from '../shared/api-types.js';

export const HOUR_MS = 60 * 60 * 1000;
const DEV_OFFSET_KEY = 'dev_time_offset_ms';

export function isDevTimeToolsEnabled(): boolean {
  if (process.env.GCCT_ENABLE_DEV_TOOLS === 'true') return true;
  if (process.env.GCCT_ENABLE_DEV_TOOLS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export function getDevTimeOffsetMs(db: DatabaseSync): number {
  if (!isDevTimeToolsEnabled()) return 0;
  const row = db
    .prepare('SELECT meta_value FROM system_meta WHERE meta_key = ?')
    .get(DEV_OFFSET_KEY) as { meta_value: string } | undefined;
  const parsed = row ? Number(row.meta_value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function advanceDevTimeOffsetMs(db: DatabaseSync, deltaMs: number): number {
  if (!isDevTimeToolsEnabled()) {
    throw new Error('Developer time controls are disabled in production mode.');
  }
  const current = getDevTimeOffsetMs(db);
  const next = Math.max(0, current + Math.round(deltaMs));
  db.prepare(
    `INSERT INTO system_meta (meta_key, meta_value) VALUES (?, ?)
     ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value`,
  ).run(DEV_OFFSET_KEY, String(next));
  return next;
}

export function resetDevTimeOffsetMs(db: DatabaseSync): void {
  if (!isDevTimeToolsEnabled()) return;
  db.prepare('DELETE FROM system_meta WHERE meta_key = ?').run(DEV_OFFSET_KEY);
}

export function getHourBucketUtc(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function getServerClock(db: DatabaseSync): ServerTimeDTO {
  const serverUtcMs = Date.now();
  const timeOffsetMs = getDevTimeOffsetMs(db);
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
