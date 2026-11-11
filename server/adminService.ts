import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AdminActivityItemDTO,
  AdminBirdDTO,
  AdminChatMessageDTO,
  AdminChatThreadDTO,
  AdminOverviewDTO,
  AdminUserDTO,
  MutationConfigDTO,
  SpecialBirdDTO,
} from '../shared/api-types.js';
import { MUTATION_CATALOG, getMutationMeta, normalizeGeneKey } from '../shared/genetics/catalog.js';
import {
  createGenotypeForMutation,
  deriveActualSplits,
  deriveVisualPhenotype,
} from '../shared/genetics/engine.js';
import type { BaseLocusKey, MutationKey, Sex } from '../shared/genetics/types.js';
import {
  type BirdRow,
  type MutationConfigRow,
  insertBirdRecord,
  loadMutationConfigsMap,
  parseJsonArray,
  randomConureName,
  resolveMutationAssetUrl,
} from './birdHelpers.js';
import { getServerClock } from './clock.js';
import { withTransaction } from './db.js';
import { SYSTEM_EXCHANGE_USER_ID, ensureHourlyMarketBatch, ensureSystemExchangeAccount } from './marketWorker.js';
import { type SpecialBirdRow, listPaymentRequests, mapSpecialBirdRow } from './paymentService.js';

export class AdminServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function ensureMutationConfigsSynced(db: DatabaseSync): void {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO mutation_configs (
      mutation_key, name, chromosome_label, inheritance_mode, visual_description,
      image_url, base_price, rarity, rarity_score, accent_hex, base_phenotype, is_custom, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );

  for (const meta of Object.values(MUTATION_CATALOG)) {
    stmt.run(
      meta.key,
      meta.name,
      meta.chromosomeLabel,
      meta.inheritanceMode,
      meta.visualDescription,
      `/assets/conures/${meta.assetFile}`,
      meta.basePrice,
      meta.rarity,
      meta.rarityScore,
      meta.accentHex,
      meta.key,
      now,
    );
  }
}

export function getMutationConfigs(db: DatabaseSync): MutationConfigDTO[] {
  ensureMutationConfigsSynced(db);
  const rows = db.prepare('SELECT * FROM mutation_configs').all() as unknown as MutationConfigRow[];
  const catalogOrder = Object.keys(MUTATION_CATALOG);

  rows.sort((a, b) => {
    const idxA = catalogOrder.indexOf(a.mutation_key);
    const idxB = catalogOrder.indexOf(b.mutation_key);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  return rows.map((r) => ({
    key: r.mutation_key,
    name: r.name,
    chromosomeLabel: r.chromosome_label,
    inheritanceMode: r.inheritance_mode,
    visualDescription: r.visual_description,
    imageUrl: resolveMutationAssetUrl(r.mutation_key, r),
    basePrice: r.base_price,
    rarity: r.rarity,
    rarityScore: r.rarity_score,
    accentHex: r.accent_hex,
    basePhenotype: r.base_phenotype || 'WT',
    isCustom: Boolean(r.is_custom),
  }));
}

export function upsertMutationConfig(
  db: DatabaseSync,
  payload: {
    key?: string;
    name: string;
    chromosomeLabel?: string;
    inheritanceMode?: string;
    visualDescription?: string;
    imageUrl?: string;
    basePrice?: number;
    rarity?: string;
    rarityScore?: number;
    accentHex?: string;
    basePhenotype?: string;
  },
): MutationConfigDTO {
  ensureMutationConfigsSynced(db);
  const name = String(payload.name ?? '').trim().slice(0, 64);
  if (!name) {
    throw new AdminServiceError('Mutation name is required.');
  }
  const rawKey = (payload.key?.trim() || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')).slice(0, 32);
  if (!rawKey) {
    throw new AdminServiceError('Valid mutation key is required.');
  }

  const existing = db
    .prepare('SELECT * FROM mutation_configs WHERE mutation_key = ?')
    .get(rawKey) as MutationConfigRow | undefined;
  const isCatalog = rawKey in MUTATION_CATALOG;
  const defaultMeta = isCatalog ? MUTATION_CATALOG[rawKey as MutationKey] : MUTATION_CATALOG.WT;

  const basePhenotype =
    payload.basePhenotype && payload.basePhenotype in MUTATION_CATALOG
      ? payload.basePhenotype
      : existing?.base_phenotype ?? (isCatalog ? rawKey : 'WT');

  const cleanImage = payload.imageUrl !== undefined ? payload.imageUrl.trim() : existing?.image_url ?? '';
  const finalImage = cleanImage.length > 0 ? cleanImage : `/assets/conures/${defaultMeta.assetFile}`;
  const basePrice = Math.max(500, Math.round(Number(payload.basePrice ?? existing?.base_price ?? defaultMeta.basePrice)));
  const rarityScore = Math.max(
    1,
    Math.min(100, Math.round(Number(payload.rarityScore ?? existing?.rarity_score ?? defaultMeta.rarityScore))),
  );
  const now = Date.now();

  db.prepare(
    `INSERT INTO mutation_configs (
      mutation_key, name, chromosome_label, inheritance_mode, visual_description,
      image_url, base_price, rarity, rarity_score, accent_hex, base_phenotype, is_custom, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mutation_key) DO UPDATE SET
      name = excluded.name,
      chromosome_label = excluded.chromosome_label,
      inheritance_mode = excluded.inheritance_mode,
      visual_description = excluded.visual_description,
      image_url = excluded.image_url,
      base_price = excluded.base_price,
      rarity = excluded.rarity,
      rarity_score = excluded.rarity_score,
      accent_hex = excluded.accent_hex,
      base_phenotype = excluded.base_phenotype,
      updated_at = excluded.updated_at`,
  ).run(
    rawKey,
    name,
    String(payload.chromosomeLabel ?? existing?.chromosome_label ?? 'Custom Morph').trim().slice(0, 80),
    String(payload.inheritanceMode ?? existing?.inheritance_mode ?? 'Breeder Line').trim().slice(0, 64),
    String(payload.visualDescription ?? existing?.visual_description ?? '').trim().slice(0, 300),
    finalImage,
    basePrice,
    String(payload.rarity ?? existing?.rarity ?? 'Rare').trim().slice(0, 32),
    rarityScore,
    String(payload.accentHex ?? existing?.accent_hex ?? '#4A7C59').trim().slice(0, 16),
    basePhenotype,
    isCatalog ? 0 : 1,
    now,
  );

  return getMutationConfigs(db).find((m) => m.key === rawKey)!;
}

export function updateMutationImage(db: DatabaseSync, key: string, imageUrl: string): void {
  ensureMutationConfigsSynced(db);
  const cleanUrl = String(imageUrl ?? '').trim();
  if (!cleanUrl) {
    throw new AdminServiceError('imageUrl is required.');
  }
  const existing = db.prepare('SELECT 1 FROM mutation_configs WHERE mutation_key = ?').get(key);
  if (!existing) {
    throw new AdminServiceError('Mutation not found.', 404);
  }
  db.prepare('UPDATE mutation_configs SET image_url = ?, updated_at = ? WHERE mutation_key = ?').run(
    cleanUrl,
    Date.now(),
    key,
  );
}

export function getAdminOverview(db: DatabaseSync): AdminOverviewDTO {
  const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    users: count('SELECT COUNT(*) as c FROM users WHERE is_npc = 0'),
    birds: count('SELECT COUNT(*) as c FROM birds'),
    showroomEntries: count('SELECT COUNT(*) as c FROM showroom_entries'),
    pendingPayments: count("SELECT COUNT(*) as c FROM payment_requests WHERE status = 'pending'"),
    activeMarketListings: count("SELECT COUNT(*) as c FROM market_listings WHERE status = 'ACTIVE'"),
    activeCages: count('SELECT COUNT(*) as c FROM breeding_cages WHERE hatched = 0'),
    p2pListings: count("SELECT COUNT(*) as c FROM p2p_listings WHERE status = 'ACTIVE'"),
  };
}

export function getAdminUsers(db: DatabaseSync): AdminUserDTO[] {
  const rows = db
    .prepare(
      `SELECT u.*,
        (SELECT COUNT(*) FROM birds b WHERE b.current_owner_id = u.id AND b.status <> 'SANCTUARY') as bird_count
       FROM users u
       WHERE u.is_npc = 0
       ORDER BY u.created_at DESC`,
    )
    .all() as unknown as Array<{
    id: string;
    username: string;
    display_name: string;
    aviary_name: string;
    coins: number;
    xp: number;
    level: number;
    total_shows: number;
    total_show_wins: number;
    bird_count: number;
    is_admin: number;
    created_at: number;
  }>;

  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    aviaryName: u.aviary_name,
    coins: u.coins,
    xp: u.xp,
    level: u.level,
    totalShows: u.total_shows,
    totalShowWins: u.total_show_wins,
    birdCount: u.bird_count,
    isAdmin: u.username.toLowerCase() === 'salman' || Boolean(u.is_admin),
    createdAt: u.created_at,
  }));
}

export function adjustUserCoins(db: DatabaseSync, userId: string, amount: number): { coins: number } {
  const delta = Math.round(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) {
    throw new AdminServiceError('Provide a non-zero coin adjustment amount.');
  }

  return withTransaction(db, () => {
    const user = db.prepare('SELECT id, coins FROM users WHERE id = ? AND is_npc = 0').get(userId) as
      | { id: string; coins: number }
      | undefined;
    if (!user) throw new AdminServiceError('User not found.', 404);
    const nextCoins = Math.max(0, user.coins + delta);
    db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(nextCoins, userId);
    return { coins: nextCoins };
  });
}

export function deleteAdminUser(db: DatabaseSync, targetUserId: string, actingAdminId: string): void {
  if (targetUserId === actingAdminId) {
    throw new AdminServiceError('Cannot delete the currently signed-in admin account.');
  }

  withTransaction(db, () => {
    const target = db.prepare('SELECT id, is_npc, username FROM users WHERE id = ?').get(targetUserId) as
      | { id: string; is_npc: number; username: string }
      | undefined;
    if (!target) throw new AdminServiceError('User not found.', 404);
    if (target.is_npc || target.username.toLowerCase() === 'salman') {
      throw new AdminServiceError('Protected account cannot be deleted.');
    }

    ensureSystemExchangeAccount(db);

    // Clean up dependent user records before deleting user
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM user_badges WHERE user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM user_discovered_genes WHERE user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM payment_requests WHERE user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM chat_messages WHERE user_id = ? OR recipient_id = ?').run(targetUserId, targetUserId);
    db.prepare('DELETE FROM breeding_cages WHERE owner_id = ?').run(targetUserId);
    db.prepare('DELETE FROM showroom_entries WHERE user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM p2p_listings WHERE seller_id = ?').run(targetUserId);
    db.prepare('UPDATE p2p_listings SET buyer_id = NULL WHERE buyer_id = ?').run(targetUserId);
    db.prepare('UPDATE market_listings SET buyer_id = NULL WHERE buyer_id = ?').run(targetUserId);

    // Handle birds owned or bred by deleted user without violating pedigree foreign keys
    const ownedOrBredBirds = db
      .prepare('SELECT id FROM birds WHERE current_owner_id = ? OR original_breeder_id = ?')
      .all(targetUserId, targetUserId) as Array<{ id: string }>;

    for (const b of ownedOrBredBirds) {
      const hasProgeny = db
        .prepare('SELECT 1 FROM birds WHERE father_id = ? OR mother_id = ? LIMIT 1')
        .get(b.id, b.id);
      const inOtherShowroom = db
        .prepare('SELECT 1 FROM showroom_entries WHERE bird_id = ? LIMIT 1')
        .get(b.id);
      const inMarket = db
        .prepare('SELECT 1 FROM market_listings WHERE bird_id = ? LIMIT 1')
        .get(b.id);
      const inOtherP2P = db
        .prepare('SELECT 1 FROM p2p_listings WHERE bird_id = ? LIMIT 1')
        .get(b.id);
      const inOtherCages = db
        .prepare('SELECT 1 FROM breeding_cages WHERE male_id = ? OR female_id = ? LIMIT 1')
        .get(b.id, b.id);

      if (hasProgeny || inOtherShowroom || inMarket || inOtherP2P || inOtherCages) {
        db.prepare(
          `UPDATE birds
           SET current_owner_id = CASE WHEN current_owner_id = ? THEN NULL ELSE current_owner_id END,
               original_breeder_id = CASE WHEN original_breeder_id = ? THEN ? ELSE original_breeder_id END,
               status = CASE WHEN current_owner_id = ? THEN 'SANCTUARY' ELSE status END
           WHERE id = ?`,
        ).run(targetUserId, targetUserId, SYSTEM_EXCHANGE_USER_ID, targetUserId, b.id);
      } else {
        db.prepare('DELETE FROM birds WHERE id = ?').run(b.id);
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
  });
}

export function getAdminBirds(db: DatabaseSync): AdminBirdDTO[] {
  const rows = db
    .prepare(
      `SELECT b.*, u.username AS owner_username, u.aviary_name AS owner_aviary_name
       FROM birds b
       LEFT JOIN users u ON u.id = b.current_owner_id
       ORDER BY b.hatch_timestamp DESC
       LIMIT 500`,
    )
    .all() as unknown as Array<
    BirdRow & { owner_username: string | null; owner_aviary_name: string | null }
  >;

  const overrides = loadMutationConfigsMap(db);
  return rows.map((r) => {
    const override = overrides.get(r.visual_phenotype);
    const meta = getMutationMeta(r.visual_phenotype);
    return {
      id: r.id,
      legBand: r.leg_band,
      name: r.name,
      sex: r.sex,
      visualPhenotype: r.visual_phenotype,
      phenotypeName: override?.name || meta.name,
      assetUrl: resolveMutationAssetUrl(r.visual_phenotype, override),
      ownerUsername: r.owner_username,
      ownerAviaryName: r.owner_aviary_name,
      status: r.status,
      plumageSymmetry: Number(r.plumage_symmetry.toFixed(1)),
      generationDepth: r.generation_depth,
      hatchTimestamp: r.hatch_timestamp,
    };
  });
}

function resolveBiologicalKey(db: DatabaseSync, mutationKey: string): MutationKey {
  const norm = normalizeGeneKey(mutationKey.trim());
  if (norm in MUTATION_CATALOG) return norm;
  const row = db
    .prepare('SELECT base_phenotype FROM mutation_configs WHERE mutation_key = ?')
    .get(mutationKey.trim()) as { base_phenotype: string } | undefined;
  if (row && row.base_phenotype in MUTATION_CATALOG) {
    return row.base_phenotype as MutationKey;
  }
  throw new AdminServiceError(`Unknown mutation key: ${mutationKey}`);
}

function sanitizeSplitsForSex(splits: string[], sex: Sex): BaseLocusKey[] {
  const valid: BaseLocusKey[] = [];
  for (const s of splits) {
    if (s !== 'CIN' && s !== 'OP' && s !== 'TQ' && s !== 'DIL') continue;
    // Females (ZW) cannot carry sex-linked Z splits
    if (sex === 'FEMALE' && (s === 'CIN' || s === 'OP')) continue;
    if (!valid.includes(s)) valid.push(s);
  }
  return valid;
}

export function injectMarketBird(
  db: DatabaseSync,
  payload: {
    name?: string;
    mutationKey: string;
    gender: string;
    symmetry?: number;
    price: number;
    splits?: string[];
  },
): { listingId: string; legBand: string } {
  ensureMutationConfigsSynced(db);
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const hourBucketUtc = ensureHourlyMarketBatch(db, nowMs);

  const sex = String(payload.gender ?? 'MALE').toUpperCase();
  if (sex !== 'MALE' && sex !== 'FEMALE') {
    throw new AdminServiceError('Gender must be MALE or FEMALE.');
  }

  const bioKey = resolveBiologicalKey(db, payload.mutationKey);
  const cleanSplits = sanitizeSplitsForSex(payload.splits ?? [], sex);
  const price = Math.max(100, Math.round(Number(payload.price) || getMutationMeta(bioKey).basePrice));
  const symmetry = Math.max(65, Math.min(100, Number(payload.symmetry ?? 85) || 85));
  const name = String(payload.name ?? '').trim().slice(0, 32) || randomConureName();

  return withTransaction(db, () => {
    ensureSystemExchangeAccount(db);
    const genotype = createGenotypeForMutation(bioKey, sex, cleanSplits);
    const actualSplits = deriveActualSplits(genotype);
    const visualPhenotype = deriveVisualPhenotype(genotype);

    const bird = insertBirdRecord(db, {
      name,
      genotype,
      visualPhenotype,
      actualSplits,
      displayedSplits: [],
      plumageSymmetry: symmetry,
      fatherId: null,
      motherId: null,
      originalBreederId: SYSTEM_EXCHANGE_USER_ID,
      originalBreederName: "Admin Wild Release",
      currentOwnerId: null,
      hatchTimestamp: nowMs - 30 * 24 * 60 * 60 * 1000,
      maturationTimestamp: nowMs - 15 * 24 * 60 * 60 * 1000,
      generationDepth: 1,
      status: 'MARKET_SYSTEM',
    });

    const listingId = `mkt_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO market_listings (id, hour_bucket_utc, bird_id, price, is_split_carrier, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    ).run(listingId, hourBucketUtc, bird.id, price, actualSplits.length > 0 ? 1 : 0, nowMs);

    return { listingId, legBand: bird.leg_band };
  });
}

export function getAdminSpecialBirds(db: DatabaseSync): SpecialBirdDTO[] {
  const rows = db.prepare('SELECT * FROM special_birds ORDER BY created_at DESC').all() as unknown as SpecialBirdRow[];
  return rows.map((r) => mapSpecialBirdRow(db, r));
}

export function createSpecialBird(
  db: DatabaseSync,
  payload: {
    name: string;
    mutationKey: string;
    gender: string;
    symmetry?: number;
    splits?: string[];
    pricePkr: number;
    imageUrl?: string;
    description?: string;
    stock?: number;
  },
): SpecialBirdDTO {
  ensureMutationConfigsSynced(db);
  const name = String(payload.name ?? '').trim().slice(0, 48);
  if (!name) throw new AdminServiceError('Special bird name is required.');

  const sex = String(payload.gender ?? 'MALE').toUpperCase();
  if (sex !== 'MALE' && sex !== 'FEMALE') throw new AdminServiceError('Gender must be MALE or FEMALE.');

  const bioKey = resolveBiologicalKey(db, payload.mutationKey);
  const cleanSplits = sanitizeSplitsForSex(payload.splits ?? [], sex);
  const symmetry = Math.max(65, Math.min(100, Number(payload.symmetry ?? 92) || 92));
  const pricePkr = Math.max(0, Math.round(Number(payload.pricePkr) || 1000));
  const stock = Number.isFinite(Number(payload.stock)) ? Math.round(Number(payload.stock)) : 1;
  const id = `spb_${crypto.randomUUID()}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO special_birds (
      id, name, mutation_key, sex, plumage_symmetry, splits_json,
      price_pkr, image_url, description, is_live, stock, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    name,
    bioKey,
    sex,
    symmetry,
    JSON.stringify(cleanSplits),
    pricePkr,
    String(payload.imageUrl ?? '').trim().slice(0, 300),
    String(payload.description ?? '').trim().slice(0, 400),
    stock,
    now,
  );

  const created = db.prepare('SELECT * FROM special_birds WHERE id = ?').get(id) as unknown as SpecialBirdRow;
  return mapSpecialBirdRow(db, created);
}

export function setSpecialBirdLive(db: DatabaseSync, id: string, isLive: boolean): void {
  withTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM special_birds WHERE id = ?').get(id);
    if (!existing) throw new AdminServiceError('Special bird not found.', 404);
    if (isLive) {
      db.prepare('UPDATE special_birds SET is_live = 0').run();
    }
    db.prepare('UPDATE special_birds SET is_live = ? WHERE id = ?').run(isLive ? 1 : 0, id);
  });
}

export function approvePaymentRequest(
  db: DatabaseSync,
  requestId: string,
): { deliveredBirdLegBand: string | null; deliveredBirdName: string | null } {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const wallNow = Date.now();

  return withTransaction(db, () => {
    ensureSystemExchangeAccount(db);
    const pr = db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(requestId) as
      | {
          id: string;
          user_id: string;
          request_type: 'CHOICE_BIRD' | 'SPECIAL_BIRD' | 'SUPPORT';
          special_bird_id: string | null;
          requested_mutation: string | null;
          requested_gender: Sex | null;
          desired_bird_name: string;
          amount: number;
          currency: string;
          sender_name: string;
          status: string;
        }
      | undefined;

    if (!pr) throw new AdminServiceError('Payment request not found.', 404);
    if (pr.status !== 'pending') throw new AdminServiceError('Payment request is no longer pending.', 409);

    let deliveredBirdLegBand: string | null = null;
    let deliveredBirdName: string | null = null;

    if (pr.request_type === 'SPECIAL_BIRD') {
      if (!pr.special_bird_id) throw new AdminServiceError('Special bird reference missing.');
      const sb = db.prepare('SELECT * FROM special_birds WHERE id = ?').get(pr.special_bird_id) as
        | SpecialBirdRow
        | undefined;
      if (!sb) throw new AdminServiceError('Special bird record not found.', 404);

      const bioKey = resolveBiologicalKey(db, sb.mutation_key);
      const splits = sanitizeSplitsForSex(parseJsonArray<string>(sb.splits_json), sb.sex);
      const genotype = createGenotypeForMutation(bioKey, sb.sex, splits);
      const bird = insertBirdRecord(db, {
        name: sb.name,
        genotype,
        visualPhenotype: deriveVisualPhenotype(genotype),
        actualSplits: deriveActualSplits(genotype),
        displayedSplits: [],
        plumageSymmetry: sb.plumage_symmetry,
        fatherId: null,
        motherId: null,
        originalBreederId: SYSTEM_EXCHANGE_USER_ID,
        originalBreederName: "Salman's Creator Reserve",
        currentOwnerId: pr.user_id,
        hatchTimestamp: nowMs - 30 * 24 * 60 * 60 * 1000,
        maturationTimestamp: nowMs - 15 * 24 * 60 * 60 * 1000,
        generationDepth: 1,
        status: 'READY',
      });

      deliveredBirdLegBand = bird.leg_band;
      deliveredBirdName = bird.name;

      if (sb.stock > 0) {
        const nextStock = sb.stock - 1;
        db.prepare('UPDATE special_birds SET stock = ?, is_live = CASE WHEN ? <= 0 THEN 0 ELSE is_live END WHERE id = ?').run(
          nextStock,
          nextStock,
          sb.id,
        );
      }

      db.prepare(
        `INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at)
         VALUES (?, ?, 'SYSTEM', ?, ?, 0, ?)`,
      ).run(
        `ntf_${crypto.randomUUID()}`,
        pr.user_id,
        'Special Conure Delivered!',
        `Your payment from ${pr.sender_name} was approved. ${bird.name} (${getMutationMeta(bioKey).name}, ${sb.sex === 'MALE' ? 'Male' : 'Female'}, ${bird.leg_band}) has joined your aviary!`,
        wallNow,
      );
    } else if (pr.request_type === 'CHOICE_BIRD') {
      if (!pr.requested_mutation || !pr.requested_gender) {
        throw new AdminServiceError('Requested mutation or gender missing.');
      }
      const bioKey = resolveBiologicalKey(db, pr.requested_mutation);
      const meta = getMutationMeta(bioKey);
      const sex = pr.requested_gender;
      const genotype = createGenotypeForMutation(bioKey, sex, []);
      const birdName = pr.desired_bird_name.trim() || `${randomConureName()}`;

      const bird = insertBirdRecord(db, {
        name: birdName,
        genotype,
        visualPhenotype: deriveVisualPhenotype(genotype),
        actualSplits: [],
        displayedSplits: [],
        plumageSymmetry: 88.0,
        fatherId: null,
        motherId: null,
        originalBreederId: SYSTEM_EXCHANGE_USER_ID,
        originalBreederName: "Salman's Creator Reserve",
        currentOwnerId: pr.user_id,
        hatchTimestamp: nowMs - 30 * 24 * 60 * 60 * 1000,
        maturationTimestamp: nowMs - 15 * 24 * 60 * 60 * 1000,
        generationDepth: 1,
        status: 'READY',
      });

      deliveredBirdLegBand = bird.leg_band;
      deliveredBirdName = bird.name;

      db.prepare(
        `INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at)
         VALUES (?, ?, 'SYSTEM', ?, ?, 0, ?)`,
      ).run(
        `ntf_${crypto.randomUUID()}`,
        pr.user_id,
        'Coffee Gift Conure Delivered!',
        `Thank you for supporting the creator (${pr.sender_name})! Your chosen ${meta.name} (${sex === 'MALE' ? 'Male ♂' : 'Female ♀'}) "${bird.name}" [${bird.leg_band}] has been delivered to your aviary.`,
        wallNow,
      );
    } else {
      db.prepare(
        `INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at)
         VALUES (?, ?, 'SYSTEM', ?, ?, 0, ?)`,
      ).run(
        `ntf_${crypto.randomUUID()}`,
        pr.user_id,
        'Thank You for Supporting the Creator!',
        `Salman received your support transfer (${pr.currency} ${pr.amount} from ${pr.sender_name}). Thank you for helping keep Green Cheek Conure Tycoon growing!`,
        wallNow,
      );
    }

    db.prepare("UPDATE payment_requests SET status = 'approved', reviewed_at = ? WHERE id = ?").run(
      wallNow,
      requestId,
    );

    return { deliveredBirdLegBand, deliveredBirdName };
  });
}

export function rejectPaymentRequest(db: DatabaseSync, requestId: string): void {
  const wallNow = Date.now();
  withTransaction(db, () => {
    const pr = db.prepare('SELECT id, user_id, status FROM payment_requests WHERE id = ?').get(requestId) as
      | { id: string; user_id: string; status: string }
      | undefined;
    if (!pr) throw new AdminServiceError('Payment request not found.', 404);
    if (pr.status !== 'pending') throw new AdminServiceError('Payment request is no longer pending.', 409);

    db.prepare("UPDATE payment_requests SET status = 'rejected', reviewed_at = ? WHERE id = ?").run(
      wallNow,
      requestId,
    );

    db.prepare(
      `INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at)
       VALUES (?, ?, 'SYSTEM', ?, ?, 0, ?)`,
    ).run(
      `ntf_${crypto.randomUUID()}`,
      pr.user_id,
      'Payment Claim Update',
      'Your recent payment claim could not be verified. Please double-check your sender name/reference and submit again if needed.',
      wallNow,
    );
  });
}

export function getAdminChatThreads(db: DatabaseSync): AdminChatThreadDTO[] {
  const rows = db
    .prepare(
      `SELECT
        CASE WHEN m.user_id < m.recipient_id THEN m.user_id ELSE m.recipient_id END AS u1_id,
        CASE WHEN m.user_id < m.recipient_id THEN m.recipient_id ELSE m.user_id END AS u2_id,
        u1.username AS u1_username,
        u1.aviary_name AS u1_aviary,
        u2.username AS u2_username,
        u2.aviary_name AS u2_aviary,
        COUNT(*) AS message_count,
        MAX(m.created_at) AS last_activity,
        (
          SELECT cm.message FROM chat_messages cm
          WHERE (cm.user_id = u1.id AND cm.recipient_id = u2.id)
             OR (cm.user_id = u2.id AND cm.recipient_id = u1.id)
          ORDER BY cm.created_at DESC LIMIT 1
        ) AS snippet
       FROM chat_messages m
       JOIN users u1 ON u1.id = (CASE WHEN m.user_id < m.recipient_id THEN m.user_id ELSE m.recipient_id END)
       JOIN users u2 ON u2.id = (CASE WHEN m.user_id < m.recipient_id THEN m.recipient_id ELSE m.user_id END)
       WHERE m.recipient_id IS NOT NULL
       GROUP BY u1_id, u2_id, u1.username, u1.aviary_name, u2.username, u2.aviary_name, u1.id, u2.id
       ORDER BY last_activity DESC`,
    )
    .all() as unknown as Array<{
    u1_id: string;
    u2_id: string;
    u1_username: string;
    u1_aviary: string;
    u2_username: string;
    u2_aviary: string;
    message_count: number;
    last_activity: number;
    snippet: string;
  }>;

  return rows.map((r) => ({
    u1Id: r.u1_id,
    u2Id: r.u2_id,
    u1Username: r.u1_username,
    u1Aviary: r.u1_aviary,
    u2Username: r.u2_username,
    u2Aviary: r.u2_aviary,
    messageCount: r.message_count,
    lastActivity: r.last_activity,
    snippet: r.snippet ?? '',
  }));
}

export function getAdminChatThreadMessages(db: DatabaseSync, u1: string, u2: string): AdminChatMessageDTO[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, recipient_id, username, aviary_name, message, created_at
       FROM chat_messages
       WHERE (user_id = ? AND recipient_id = ?) OR (user_id = ? AND recipient_id = ?)
       ORDER BY created_at ASC`,
    )
    .all(u1, u2, u2, u1) as unknown as Array<{
    id: string;
    user_id: string;
    recipient_id: string | null;
    username: string;
    aviary_name: string;
    message: string;
    created_at: number;
  }>;

  return rows.map((m) => ({
    id: m.id,
    userId: m.user_id,
    recipientId: m.recipient_id,
    username: m.username,
    aviaryName: m.aviary_name,
    message: m.message,
    createdAt: m.created_at,
  }));
}

export function getAdminAuditFeed(db: DatabaseSync): AdminActivityItemDTO[] {
  const items: AdminActivityItemDTO[] = [];

  const p2pRows = db
    .prepare(
      `SELECT p.id, p.asking_price, p.sold_at, b.name AS bird_name, b.leg_band,
              s.username AS seller_name, u.username AS buyer_name
       FROM p2p_listings p
       JOIN birds b ON b.id = p.bird_id
       JOIN users s ON s.id = p.seller_id
       LEFT JOIN users u ON u.id = p.buyer_id
       WHERE p.status = 'SOLD' AND p.sold_at IS NOT NULL
       ORDER BY p.sold_at DESC LIMIT 20`,
    )
    .all() as Array<{
    id: string;
    asking_price: number;
    sold_at: number;
    bird_name: string;
    leg_band: string;
    seller_name: string;
    buyer_name: string | null;
  }>;

  for (const r of p2pRows) {
    items.push({
      id: `p2p_${r.id}`,
      kind: 'P2P_SALE',
      summary: `${r.buyer_name ?? 'Player'} bought ${r.bird_name} (${r.leg_band}) from ${r.seller_name}`,
      detail: `${r.asking_price.toLocaleString()} Coins`,
      timestamp: r.sold_at,
    });
  }

  const mktRows = db
    .prepare(
      `SELECT ml.id, ml.price, ml.sold_at, b.name AS bird_name, b.leg_band, u.username AS buyer_name
       FROM market_listings ml
       JOIN birds b ON b.id = ml.bird_id
       LEFT JOIN users u ON u.id = ml.buyer_id
       WHERE ml.status = 'SOLD' AND ml.sold_at IS NOT NULL
       ORDER BY ml.sold_at DESC LIMIT 20`,
    )
    .all() as Array<{
    id: string;
    price: number;
    sold_at: number;
    bird_name: string;
    leg_band: string;
    buyer_name: string | null;
  }>;

  for (const r of mktRows) {
    items.push({
      id: `mkt_${r.id}`,
      kind: 'MARKET_BUY',
      summary: `${r.buyer_name ?? 'Player'} acquired ${r.bird_name} (${r.leg_band}) from Wild Market`,
      detail: `${r.price.toLocaleString()} Coins`,
      timestamp: r.sold_at,
    });
  }

  const payReqs = listPaymentRequests(db).slice(0, 20);
  for (const p of payReqs) {
    items.push({
      id: `pay_${p.id}`,
      kind: 'PAYMENT',
      summary: `${p.username} (${p.senderName}) · ${p.requestedMutationName ?? p.specialBirdName ?? 'Creator Support'}`,
      detail: `${p.currency} ${p.amount} · ${p.status.toUpperCase()}`,
      timestamp: p.createdAt,
    });
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, 40);
}
