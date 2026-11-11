import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DiscoveredGeneDTO, NotificationDTO, UserBadgeDTO, UserProfileDTO } from '../shared/api-types.js';
import { createGenotypeForMutation, deriveActualSplits, deriveVisualPhenotype } from '../shared/genetics/engine.js';
import { getLevelInfo, insertBirdRecord } from './birdHelpers.js';
import { getServerClock, isDevTimeToolsEnabled } from './clock.js';
import { withTransaction } from './db.js';

export const SESSION_COOKIE_NAME = 'gcct_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  aviary_name: string;
  coins: number;
  xp: number;
  level: number;
  total_shows: number;
  total_show_wins: number;
  best_show_score: number;
  total_coins_earned: number;
  market_spent: number;
  is_npc: number;
  is_admin?: number;
  created_at: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function createSession(db: DatabaseSync, userId: string, nowMs = Date.now()): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    nowMs,
    nowMs + SESSION_TTL_MS,
  );
  return token;
}

export function getUserBySessionToken(db: DatabaseSync, token: string | undefined): UserRow | null {
  if (!token) return null;
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, now) as UserRow | undefined;
  return row ?? null;
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function registerUser(
  db: DatabaseSync,
  params: {
    username: string;
    password: string;
    displayName: string;
    aviaryName: string;
    startingCoins?: number;
  },
): { user: UserRow; token: string } {
  const cleanUsername = params.username.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(cleanUsername)) {
    throw new Error('Username must be 3-32 characters (letters, numbers, _, ., -).');
  }
  if (params.password.length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }
  const cleanDisplay = params.displayName.trim() || cleanUsername;
  const cleanAviary = params.aviaryName.trim() || `${cleanDisplay}'s Canopy Aviary`;
  const allowedCoins = Math.max(10000, Math.min(20000, Math.round(params.startingCoins ?? 15000)));
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const wallNow = Date.now();

  return withTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (existing) {
      throw new Error('Username is already taken.');
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const pwHash = hashPassword(params.password);
    const isAdmin = cleanUsername === 'salman' ? 1 : 0;

    db.prepare(
      `INSERT INTO users (
        id, username, password_hash, display_name, aviary_name,
        coins, xp, level, is_npc, is_admin, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0, ?, ?)`,
    ).run(userId, cleanUsername, pwHash, cleanDisplay, cleanAviary, allowedCoins, isAdmin, wallNow);

    // Initial Aviary State: ONLY NORMAL_GREEN (WT) unlocked
    db.prepare('INSERT INTO user_discovered_genes (user_id, gene_key, unlocked_at) VALUES (?, ?, ?)').run(
      userId,
      'WT',
      nowMs,
    );

    // Starter flock: 3 mature Normal Green foundation birds (with hidden genetics masked)
    const starterSpecs: Array<{
      name: string;
      sex: 'MALE' | 'FEMALE';
      splits: Array<'CIN' | 'OP' | 'TQ' | 'DIL'>;
      symmetry: number;
    }> = [
      { name: 'Bramble', sex: 'MALE', splits: ['TQ'], symmetry: 81 },
      { name: 'Clover', sex: 'FEMALE', splits: ['TQ'], symmetry: 83 },
      { name: 'Pebble', sex: 'MALE', splits: ['CIN'], symmetry: 79 },
    ];

    const matureHatch = nowMs - 24 * 60 * 60 * 1000;
    const matureDone = nowMs - 12 * 60 * 60 * 1000;

    for (const spec of starterSpecs) {
      const genotype = createGenotypeForMutation('WT', spec.sex, spec.splits);
      insertBirdRecord(db, {
        name: spec.name,
        genotype,
        visualPhenotype: deriveVisualPhenotype(genotype),
        actualSplits: deriveActualSplits(genotype),
        displayedSplits: [], // Masked by Fog of War initially!
        plumageSymmetry: spec.symmetry,
        fatherId: null,
        motherId: null,
        originalBreederId: userId,
        originalBreederName: cleanDisplay,
        currentOwnerId: userId,
        hatchTimestamp: matureHatch,
        maturationTimestamp: matureDone,
        generationDepth: 1,
        status: 'READY',
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow;
    const token = createSession(db, userId, wallNow);
    return { user, token };
  });
}

export function authenticateUser(
  db: DatabaseSync,
  username: string,
  password: string,
): { user: UserRow; token: string } {
  const cleanUsername = username.trim().toLowerCase();
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND is_npc = 0')
    .get(cleanUsername) as UserRow | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid username or password.');
  }
  const token = createSession(db, user.id, Date.now());
  return { user, token };
}

export function buildUserProfileDTO(db: DatabaseSync, user: UserRow): UserProfileDTO {
  const { current, next } = getLevelInfo(user.xp);
  const discoveredGenes = db
    .prepare('SELECT gene_key, unlocked_at FROM user_discovered_genes WHERE user_id = ? ORDER BY unlocked_at ASC')
    .all(user.id) as Array<{ gene_key: string; unlocked_at: number }>;

  const badges = db
    .prepare('SELECT badge_key, badge_title, awarded_at FROM user_badges WHERE user_id = ? ORDER BY awarded_at DESC')
    .all(user.id) as Array<{ badge_key: string; badge_title: string; awarded_at: number }>;

  const notifications = db
    .prepare(
      'SELECT id, kind, title, message, read_flag, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
    )
    .all(user.id) as Array<{
    id: string;
    kind: string;
    title: string;
    message: string;
    read_flag: number;
    created_at: number;
  }>;

  const isAdmin = user.username.toLowerCase() === 'salman' || Boolean(user.is_admin);
  let pendingPaymentsCount: number | undefined;
  if (isAdmin) {
    const pendingRow = db
      .prepare("SELECT COUNT(*) as c FROM payment_requests WHERE status = 'pending'")
      .get() as { c: number } | undefined;
    pendingPaymentsCount = pendingRow?.c ?? 0;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    aviaryName: user.aviary_name,
    coins: user.coins,
    xp: user.xp,
    level: current.level,
    levelTitle: current.title,
    nextLevelXp: next.xpRequired,
    totalShows: user.total_shows,
    totalShowWins: user.total_show_wins,
    bestShowScore: user.best_show_score,
    totalCoinsEarned: user.total_coins_earned,
    marketSpent: user.market_spent,
    createdAt: user.created_at,
    discoveredGenes: discoveredGenes.map<DiscoveredGeneDTO>((g) => ({
      geneKey: g.gene_key,
      unlockedAt: g.unlocked_at,
    })),
    badges: badges.map<UserBadgeDTO>((b) => ({
      badgeKey: b.badge_key,
      badgeTitle: b.badge_title,
      awardedAt: b.awarded_at,
    })),
    notifications: notifications.map<NotificationDTO>((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      message: n.message,
      read: Boolean(n.read_flag),
      createdAt: n.created_at,
    })),
    devToolsEnabled: isDevTimeToolsEnabled(),
    isAdmin,
    ...(pendingPaymentsCount !== undefined ? { pendingPaymentsCount } : {}),
  };
}
