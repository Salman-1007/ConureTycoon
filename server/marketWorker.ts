import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ConureDTO, SystemMarketListingDTO } from '../shared/api-types.js';
import { getMutationMeta } from '../shared/genetics/catalog.js';
import {
  createGenotypeForMutation,
  deriveActualSplits,
  deriveVisualPhenotype,
  type RandomFn,
} from '../shared/genetics/engine.js';
import type { BaseLocusKey, OfficialMutationKey, Sex } from '../shared/genetics/types.js';
import {
  type BirdRow,
  getUserDiscoveredGenes,
  insertBirdRecord,
  loadAllBirdsMap,
  loadMutationConfigsMap,
  loadOwnerNamesMap,
  randomConureName,
  toSanitizedConureDTO,
} from './birdHelpers.js';
import { HOUR_MS, getHourBucketUtc, getServerClock } from './clock.js';
import { withTransaction } from './db.js';

export const SYSTEM_EXCHANGE_USER_ID = 'npc_canopy_exchange';
export const SYSTEM_EXCHANGE_NAME = 'Canopy Wild Exchange';
export const MARKET_BATCH_SIZE = 10;

const RARE_WEIGHTS: Array<{ key: OfficialMutationKey; weight: number }> = [
  { key: 'TQ', weight: 22 },
  { key: 'CIN', weight: 20 },
  { key: 'TQ_CIN', weight: 14 },
  { key: 'TQ_YS', weight: 14 },
  { key: 'TQ_PINE', weight: 10 },
  { key: 'DIL', weight: 8 },
  { key: 'MINT', weight: 6 },
  { key: 'SUNCHK', weight: 3 },
  { key: 'MOONCHK', weight: 3 },
];

export function roundTo50(value: number): number {
  return Math.round(value / 50) * 50;
}

function pickWeightedRare(rng: RandomFn): OfficialMutationKey {
  const total = RARE_WEIGHTS.reduce((s, r) => s + r.weight, 0);
  let r = rng() * total;
  for (const item of RARE_WEIGHTS) {
    r -= item.weight;
    if (r <= 0) return item.key;
  }
  return 'TQ';
}

export function computeMarketPrice(basePrice: number, isSplitCarrier: boolean, rng: RandomFn = Math.random): number {
  const minAllowed = basePrice * 0.8;
  const maxAllowed = basePrice * 1.2;
  const variance = 0.8 + rng() * 0.4; // [0.80, 1.20]
  let raw = basePrice * variance;
  if (isSplitCarrier) {
    // +5% to +10% offset clamped strictly inside allowed +-20% bounds
    const splitOffset = 1.05 + rng() * 0.05;
    raw = Math.min(maxAllowed, Math.max(minAllowed, raw * splitOffset));
  }
  return Math.max(roundTo50(minAllowed), Math.min(roundTo50(maxAllowed), roundTo50(raw)));
}

export function rollMarketConureSpec(rng: RandomFn = Math.random): {
  mutation: OfficialMutationKey;
  sex: Sex;
  splits: BaseLocusKey[];
  isSplitCarrier: boolean;
  price: number;
  symmetry: number;
} {
  const sex: Sex = rng() < 0.5 ? 'MALE' : 'FEMALE';
  const roll = rng();

  let mutation: OfficialMutationKey = 'WT';
  let splits: BaseLocusKey[] = [];
  let isSplitCarrier = false;

  if (roll < 0.5) {
    // 50% Pure Normal Green
    mutation = 'WT';
  } else if (roll < 0.8) {
    // 30% Split Carrier Normal Green (1-2 masked splits)
    mutation = 'WT';
    isSplitCarrier = true;
    const pool: BaseLocusKey[] = sex === 'MALE' ? ['CIN', 'OP', 'TQ', 'DIL'] : ['TQ', 'DIL'];
    const numSplits = rng() < 0.72 ? 1 : 2;
    const shuffled = [...pool].sort(() => rng() - 0.5);
    splits = shuffled.slice(0, numSplits);
  } else if (roll < 0.9) {
    // 10% Intermediate Visuals (Yellow-Sided or Pineapple)
    mutation = rng() < 0.5 ? 'OP' : 'PINE';
  } else {
    // 10% Rare Visuals
    mutation = pickWeightedRare(rng);
  }

  const meta = getMutationMeta(mutation);
  const price = computeMarketPrice(meta.basePrice, isSplitCarrier, rng);
  const symmetry = Math.round((70 + rng() * 24) * 10) / 10; // 70.0 .. 94.0

  return { mutation, sex, splits, isSplitCarrier, price, symmetry };
}

export function ensureSystemExchangeAccount(db: DatabaseSync): void {
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(SYSTEM_EXCHANGE_USER_ID);
  if (!exists) {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, display_name, aviary_name, coins, xp, level, is_npc, created_at)
       VALUES (?, ?, 'LOCKED', ?, ?, 0, 0, 1, 1, ?)`,
    ).run(SYSTEM_EXCHANGE_USER_ID, SYSTEM_EXCHANGE_USER_ID, SYSTEM_EXCHANGE_NAME, 'Wild Exchange', Date.now());
  }
}

export function ensureHourlyMarketBatch(
  db: DatabaseSync,
  effectiveNowMs?: number,
  forceRefresh = false,
  rng: RandomFn = Math.random,
): number {
  const nowMs = effectiveNowMs ?? getServerClock(db).effectiveNowMs;
  const hourBucketUtc = getHourBucketUtc(nowMs);
  const nextRefreshAt = hourBucketUtc + HOUR_MS;

  return withTransaction(db, () => {
    ensureSystemExchangeAccount(db);

    const existingBatch = db
      .prepare('SELECT hour_bucket_utc FROM market_batches WHERE hour_bucket_utc = ?')
      .get(hourBucketUtc) as { hour_bucket_utc: number } | undefined;

    if (existingBatch && !forceRefresh) {
      return hourBucketUtc;
    }

    // Wipe/expire all previous unsold active listings
    const unsoldBirdIds = db
      .prepare("SELECT bird_id FROM market_listings WHERE status = 'ACTIVE'")
      .all() as Array<{ bird_id: string }>;

    db.prepare("UPDATE market_listings SET status = 'EXPIRED' WHERE status = 'ACTIVE'").run();
    for (const row of unsoldBirdIds) {
      db.prepare("UPDATE birds SET status = 'SANCTUARY' WHERE id = ? AND current_owner_id IS NULL").run(row.bird_id);
    }

    if (!existingBatch) {
      db.prepare('INSERT INTO market_batches (hour_bucket_utc, generated_at, next_refresh_at) VALUES (?, ?, ?)').run(
        hourBucketUtc,
        nowMs,
        nextRefreshAt,
      );
    } else {
      db.prepare('UPDATE market_batches SET generated_at = ?, next_refresh_at = ? WHERE hour_bucket_utc = ?').run(
        nowMs,
        nextRefreshAt,
        hourBucketUtc,
      );
    }

    for (let i = 0; i < MARKET_BATCH_SIZE; i++) {
      const spec = rollMarketConureSpec(rng);
      const genotype = createGenotypeForMutation(spec.mutation, spec.sex, spec.splits, rng);
      const actualSplits = deriveActualSplits(genotype);
      const visualPhenotype = deriveVisualPhenotype(genotype);

      const bird = insertBirdRecord(db, {
        name: randomConureName(),
        genotype,
        visualPhenotype,
        actualSplits,
        displayedSplits: [], // Always masked in system market
        plumageSymmetry: spec.symmetry,
        fatherId: null,
        motherId: null,
        originalBreederId: SYSTEM_EXCHANGE_USER_ID,
        originalBreederName: SYSTEM_EXCHANGE_NAME,
        currentOwnerId: null,
        hatchTimestamp: nowMs - 30 * 24 * 60 * 60 * 1000,
        maturationTimestamp: nowMs - 15 * 24 * 60 * 60 * 1000,
        generationDepth: 1,
        status: 'MARKET_SYSTEM',
      });

      db.prepare(
        `INSERT INTO market_listings (id, hour_bucket_utc, bird_id, price, is_split_carrier, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      ).run(
        `mkt_${crypto.randomUUID()}`,
        hourBucketUtc,
        bird.id,
        spec.price,
        spec.isSplitCarrier ? 1 : 0,
        nowMs,
      );
    }

    return hourBucketUtc;
  });
}

export function getActiveSystemMarket(db: DatabaseSync, viewerId: string): {
  hourBucketUtc: number;
  listings: SystemMarketListingDTO[];
} {
  const clock = getServerClock(db);
  const hourBucketUtc = ensureHourlyMarketBatch(db, clock.effectiveNowMs);

  const rows = db
    .prepare(
      `SELECT ml.id as listing_id, ml.hour_bucket_utc, ml.price, ml.status as listing_status, b.*
       FROM market_listings ml
       JOIN birds b ON b.id = ml.bird_id
       WHERE ml.hour_bucket_utc = ? AND ml.status IN ('ACTIVE', 'SOLD')
       ORDER BY ml.created_at ASC, ml.id ASC`,
    )
    .all(hourBucketUtc) as unknown as Array<BirdRow & { listing_id: string; hour_bucket_utc: number; price: number; listing_status: 'ACTIVE' | 'SOLD' }>;

  const birdLookup = loadAllBirdsMap(db);
  const ownerNames = loadOwnerNamesMap(db);
  const discovered = getUserDiscoveredGenes(db, viewerId);
  const mutationConfigs = loadMutationConfigsMap(db);

  const listings: SystemMarketListingDTO[] = rows.map((row) => ({
    listingId: row.listing_id,
    hourBucketUtc: row.hour_bucket_utc,
    price: row.price,
    status: row.listing_status,
    bird: toSanitizedConureDTO(
      row,
      birdLookup,
      ownerNames,
      discovered,
      viewerId,
      clock.effectiveNowMs,
      true, // Mask all splits on system market listings
      mutationConfigs,
    ),
  }));

  return { hourBucketUtc, listings };
}

export class MarketPurchaseError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export function buySystemMarketListing(
  db: DatabaseSync,
  buyerId: string,
  listingId: string,
): { bird: ConureDTO; newCoinsBalance: number; pricePaid: number } {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  return withTransaction(db, () => {
    const listing = db
      .prepare('SELECT id, bird_id, price, status FROM market_listings WHERE id = ?')
      .get(listingId) as { id: string; bird_id: string; price: number; status: string } | undefined;

    if (!listing) {
      throw new MarketPurchaseError('Listing not found.', 404);
    }
    if (listing.status !== 'ACTIVE') {
      throw new MarketPurchaseError('This conure has already been sold or expired.', 409);
    }

    const buyer = db
      .prepare('SELECT id, coins, market_spent FROM users WHERE id = ?')
      .get(buyerId) as { id: string; coins: number; market_spent: number } | undefined;

    if (!buyer) {
      throw new MarketPurchaseError('Buyer account not found.', 404);
    }
    if (buyer.coins < listing.price) {
      throw new MarketPurchaseError(`Insufficient coins. Need ${listing.price.toLocaleString()} coins.`, 400);
    }

    const newCoins = buyer.coins - listing.price;
    db.prepare('UPDATE users SET coins = ?, market_spent = market_spent + ? WHERE id = ?').run(
      newCoins,
      listing.price,
      buyerId,
    );

    const birdRow = db.prepare('SELECT * FROM birds WHERE id = ?').get(listing.bird_id) as unknown as BirdRow;
    const discovered = getUserDiscoveredGenes(db, buyerId);
    const actualSplits: string[] = JSON.parse(birdRow.actual_splits || '[]');
    const revealedSplits = actualSplits.filter((g) => discovered.has(g));

    db.prepare(
      `UPDATE birds SET current_owner_id = ?, status = 'READY', displayed_splits = ? WHERE id = ?`,
    ).run(buyerId, JSON.stringify(revealedSplits), listing.bird_id);

    db.prepare(
      `UPDATE market_listings SET status = 'SOLD', buyer_id = ?, sold_at = ? WHERE id = ?`,
    ).run(buyerId, nowMs, listingId);

    const updatedRow = db.prepare('SELECT * FROM birds WHERE id = ?').get(listing.bird_id) as unknown as BirdRow;
    const birdLookup = loadAllBirdsMap(db);
    const ownerNames = loadOwnerNamesMap(db);

    return {
      bird: toSanitizedConureDTO(updatedRow, birdLookup, ownerNames, discovered, buyerId, nowMs, false),
      newCoinsBalance: newCoins,
      pricePaid: listing.price,
    };
  });
}

export function startMarketCronWorker(db: DatabaseSync): NodeJS.Timeout {
  // Initial sync on boot
  ensureHourlyMarketBatch(db);
  return setInterval(() => {
    try {
      ensureHourlyMarketBatch(db);
    } catch (err) {
      console.error('[marketWorker] Failed hourly check:', err);
    }
  }, 5000);
}
