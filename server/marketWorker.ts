import crypto from 'node:crypto';
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
import { type AppDatabase, type DbExecutor, withTransaction } from './db.js';

export const SYSTEM_EXCHANGE_USER_ID = 'npc_canopy_exchange';
export const SYSTEM_EXCHANGE_NAME = 'Canopy Wild Exchange';
export const MARKET_BATCH_SIZE = 10;

// Rarity-scaled mutation pool for the 14% visual mutation slice (rarityScore 52 -> 100)
const VISUAL_MUTATION_WEIGHTS: Array<{ key: OfficialMutationKey; weight: number }> = [
  // Common Mutations (~53.6% of visual pool -> ~7.5% of total spawns)
  { key: 'CIN', weight: 375 }, // rarityScore 52
  { key: 'OP', weight: 375 }, // rarityScore 54
  // Intermediate (~28.6% of visual pool -> ~4.0% of total spawns)
  { key: 'PINE', weight: 240 }, // rarityScore 66
  { key: 'TQ', weight: 160 }, // rarityScore 72
  // Rare (~15.0% of visual pool -> ~2.1% of total spawns)
  { key: 'TQ_CIN', weight: 70 }, // rarityScore 80
  { key: 'TQ_YS', weight: 70 }, // rarityScore 80
  { key: 'DIL', weight: 40 }, // rarityScore 84
  { key: 'TQ_PINE', weight: 30 }, // rarityScore 88
  // Ultra-Rare (~2.8% of visual pool -> ~0.4% of total spawns)
  { key: 'MINT', weight: 24 }, // rarityScore 93
  { key: 'SUNCHK', weight: 10 }, // rarityScore 97
  { key: 'MOONCHK', weight: 6 }, // rarityScore 100
];

export function roundTo50(value: number): number {
  return Math.round(value / 50) * 50;
}

function pickWeightedVisual(rng: RandomFn): OfficialMutationKey {
  const total = VISUAL_MUTATION_WEIGHTS.reduce((s, r) => s + r.weight, 0);
  let r = rng() * total;
  for (const item of VISUAL_MUTATION_WEIGHTS) {
    r -= item.weight;
    if (r <= 0) return item.key;
  }
  return 'CIN';
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

  if (roll < 0.54) {
    // 54% Pure Normal Green
    mutation = 'WT';
  } else if (roll < 0.86) {
    // 32% Split Carrier Normal Green (1-2 masked splits)
    mutation = 'WT';
    isSplitCarrier = true;
    const pool: BaseLocusKey[] = sex === 'MALE' ? ['CIN', 'OP', 'TQ', 'DIL'] : ['TQ', 'DIL'];
    const numSplits = rng() < 0.72 ? 1 : 2;
    const shuffled = [...pool].sort(() => rng() - 0.5);
    splits = shuffled.slice(0, numSplits);
  } else {
    // 14% Visual Mutations scaled strictly by rarity tier
    mutation = pickWeightedVisual(rng);
  }

  const meta = getMutationMeta(mutation);
  const price = computeMarketPrice(meta.basePrice, isSplitCarrier, rng);
  const symmetry = Math.round((70 + rng() * 24) * 10) / 10; // 70.0 .. 94.0

  return { mutation, sex, splits, isSplitCarrier, price, symmetry };
}

export async function ensureSystemExchangeAccount(db: DbExecutor): Promise<void> {
  await db.run(
    `INSERT INTO users (id, username, password_hash, display_name, aviary_name, coins, xp, level, is_npc, created_at)
     VALUES (?, ?, 'LOCKED', ?, ?, 0, 0, 1, 1, ?)
     ON CONFLICT DO NOTHING`,
    SYSTEM_EXCHANGE_USER_ID,
    SYSTEM_EXCHANGE_USER_ID,
    SYSTEM_EXCHANGE_NAME,
    'Wild Exchange',
    Date.now(),
  );
}

export async function ensureHourlyMarketBatch(
  db: AppDatabase | DbExecutor,
  effectiveNowMs?: number,
  forceRefresh = false,
  rng: RandomFn = Math.random,
): Promise<number> {
  const nowMs = effectiveNowMs ?? (await getServerClock(db)).effectiveNowMs;
  const hourBucketUtc = getHourBucketUtc(nowMs);
  const nextRefreshAt = hourBucketUtc + HOUR_MS;

  return withTransaction(db, async (tx) => {
    await ensureSystemExchangeAccount(tx);

    if (!forceRefresh) {
      // Atomic claim prevents concurrent boots/requests from inserting duplicate batches for the same hour.
      const claim = await tx.run(
        `INSERT INTO market_batches (hour_bucket_utc, generated_at, next_refresh_at) VALUES (?, ?, ?)
         ON CONFLICT (hour_bucket_utc) DO NOTHING`,
        hourBucketUtc,
        nowMs,
        nextRefreshAt,
      );
      if (claim.changes === 0) {
        return hourBucketUtc;
      }
    } else {
      await tx.run(
        `INSERT INTO market_batches (hour_bucket_utc, generated_at, next_refresh_at) VALUES (?, ?, ?)
         ON CONFLICT (hour_bucket_utc) DO UPDATE SET generated_at = EXCLUDED.generated_at, next_refresh_at = EXCLUDED.next_refresh_at`,
        hourBucketUtc,
        nowMs,
        nextRefreshAt,
      );
    }

    // Wipe/expire all previous unsold active listings
    const unsoldBirdIds = await tx.all<{ bird_id: string }>("SELECT bird_id FROM market_listings WHERE status = 'ACTIVE'");

    await tx.run("UPDATE market_listings SET status = 'EXPIRED' WHERE status = 'ACTIVE'");
    for (const row of unsoldBirdIds) {
      await tx.run("UPDATE birds SET status = 'SANCTUARY' WHERE id = ? AND current_owner_id IS NULL", row.bird_id);
    }

    for (let i = 0; i < MARKET_BATCH_SIZE; i++) {
      const spec = rollMarketConureSpec(rng);
      const genotype = createGenotypeForMutation(spec.mutation, spec.sex, spec.splits, rng);
      const actualSplits = deriveActualSplits(genotype);
      const visualPhenotype = deriveVisualPhenotype(genotype);

      const bird = await insertBirdRecord(tx, {
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

      await tx.run(
        `INSERT INTO market_listings (id, hour_bucket_utc, bird_id, price, is_split_carrier, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
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

export async function getActiveSystemMarket(
  db: AppDatabase | DbExecutor,
  viewerId: string,
): Promise<{
  hourBucketUtc: number;
  listings: SystemMarketListingDTO[];
}> {
  const clock = await getServerClock(db);
  const hourBucketUtc = await ensureHourlyMarketBatch(db, clock.effectiveNowMs);

  const rows = await db.all<
    BirdRow & { listing_id: string; hour_bucket_utc: number; price: number; listing_status: 'ACTIVE' | 'SOLD' }
  >(
    `SELECT ml.id as listing_id, ml.hour_bucket_utc, ml.price, ml.status as listing_status, b.*
     FROM market_listings ml
     JOIN birds b ON b.id = ml.bird_id
     WHERE ml.hour_bucket_utc = ? AND ml.status IN ('ACTIVE', 'SOLD')
     ORDER BY ml.created_at ASC, ml.id ASC`,
    hourBucketUtc,
  );

  const birdLookup = await loadAllBirdsMap(db);
  const ownerNames = await loadOwnerNamesMap(db);
  const discovered = await getUserDiscoveredGenes(db, viewerId);
  const mutationConfigs = await loadMutationConfigsMap(db);

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

export async function buySystemMarketListing(
  db: AppDatabase | DbExecutor,
  buyerId: string,
  listingId: string,
): Promise<{ bird: ConureDTO; newCoinsBalance: number; pricePaid: number }> {
  const clock = await getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  return withTransaction(db, async (tx) => {
    const listing = await tx.get<{ id: string; bird_id: string; price: number; status: string }>(
      'SELECT id, bird_id, price, status FROM market_listings WHERE id = ?',
      listingId,
    );

    if (!listing) {
      throw new MarketPurchaseError('Listing not found.', 404);
    }
    if (listing.status !== 'ACTIVE') {
      throw new MarketPurchaseError('This conure has already been sold or expired.', 409);
    }

    // Atomic claim prevents concurrent double-buys under PostgreSQL READ COMMITTED
    const claimed = await tx.run(
      "UPDATE market_listings SET status = 'SOLD', buyer_id = ?, sold_at = ? WHERE id = ? AND status = 'ACTIVE'",
      buyerId,
      nowMs,
      listingId,
    );
    if (claimed.changes === 0) {
      throw new MarketPurchaseError('This conure has already been sold or expired.', 409);
    }

    const buyer = await tx.get<{ id: string; coins: number; market_spent: number }>(
      'SELECT id, coins, market_spent FROM users WHERE id = ?',
      buyerId,
    );

    if (!buyer) {
      throw new MarketPurchaseError('Buyer account not found.', 404);
    }
    if (buyer.coins < listing.price) {
      throw new MarketPurchaseError(`Insufficient coins. Need ${listing.price.toLocaleString()} coins.`, 400);
    }

    const newCoins = buyer.coins - listing.price;
    await tx.run('UPDATE users SET coins = ?, market_spent = market_spent + ? WHERE id = ?', newCoins, listing.price, buyerId);

    const birdRow = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', listing.bird_id))!;
    const discovered = await getUserDiscoveredGenes(tx, buyerId);
    const actualSplits: string[] = JSON.parse(birdRow.actual_splits || '[]');
    const revealedSplits = actualSplits.filter((g) => discovered.has(g));

    await tx.run(
      "UPDATE birds SET current_owner_id = ?, status = 'READY', displayed_splits = ? WHERE id = ?",
      buyerId,
      JSON.stringify(revealedSplits),
      listing.bird_id,
    );

    const updatedRow = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', listing.bird_id))!;
    const birdLookup = await loadAllBirdsMap(tx);
    const ownerNames = await loadOwnerNamesMap(tx);

    return {
      bird: toSanitizedConureDTO(updatedRow, birdLookup, ownerNames, discovered, buyerId, nowMs, false),
      newCoinsBalance: newCoins,
      pricePaid: listing.price,
    };
  });
}

export function startMarketCronWorker(db: AppDatabase): NodeJS.Timeout {
  // Initial sync triggered asynchronously
  void ensureHourlyMarketBatch(db).catch((err) => {
    console.error('[marketWorker] Initial market sync failed:', err);
  });
  return setInterval(() => {
    void ensureHourlyMarketBatch(db).catch((err) => {
      console.error('[marketWorker] Failed hourly check:', err);
    });
  }, 5000);
}
