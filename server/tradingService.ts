import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ConureDTO, P2PListingDTO } from '../shared/api-types.js';
import { buildPedigreeTree } from '../shared/genetics/pedigree.js';
import {
  type BirdRow,
  computeLifecycleStatus,
  getUserDiscoveredGenes,
  loadAllBirdsMap,
  loadMutationConfigsMap,
  loadOwnerNamesMap,
  toSanitizedConureDTO,
} from './birdHelpers.js';
import { getServerClock } from './clock.js';
import { withTransaction } from './db.js';

export class TradingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
  }
}

export function listBirdOnP2P(
  db: DatabaseSync,
  sellerId: string,
  birdId: string,
  askingPrice: number,
  sellerNote = '',
): P2PListingDTO {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const cleanPrice = Math.round(askingPrice);
  if (!Number.isFinite(cleanPrice) || cleanPrice < 100 || cleanPrice > 100_000_000) {
    throw new TradingError('Asking price must be between 100 and 100,000,000 coins.', 400);
  }

  return withTransaction(db, () => {
    const bird = db.prepare('SELECT * FROM birds WHERE id = ?').get(birdId) as BirdRow | undefined;
    if (!bird) throw new TradingError('Bird not found.', 404);
    if (bird.current_owner_id !== sellerId) throw new TradingError('You do not own this bird.', 403);

    const status = computeLifecycleStatus(bird, nowMs);
    if (status === 'JUVENILE') throw new TradingError('Juveniles must mature before trading.', 400);
    if (status === 'BREEDING' || status === 'INCUBATING') throw new TradingError('Cannot list a bird currently in a breeding cage.', 400);
    if (status === 'MARKET_P2P' || status === 'MARKET_SYSTEM') throw new TradingError('Bird is already listed on a marketplace.', 409);

    const listingId = `p2p_${crypto.randomUUID()}`;
    db.prepare("UPDATE birds SET status = 'MARKET_P2P' WHERE id = ?").run(birdId);
    db.prepare(
      `INSERT INTO p2p_listings (id, seller_id, bird_id, asking_price, seller_note, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    ).run(listingId, sellerId, birdId, cleanPrice, sellerNote.trim().slice(0, 140), nowMs);

    const listings = getActiveP2PListings(db, sellerId);
    const created = listings.find((l) => l.listingId === listingId);
    if (!created) throw new TradingError('Failed to load created listing.', 500);
    return created;
  });
}

export function cancelP2PListing(db: DatabaseSync, sellerId: string, listingId: string): void {
  withTransaction(db, () => {
    const listing = db
      .prepare('SELECT id, seller_id, bird_id, status FROM p2p_listings WHERE id = ?')
      .get(listingId) as { id: string; seller_id: string; bird_id: string; status: string } | undefined;

    if (!listing) throw new TradingError('Listing not found.', 404);
    if (listing.seller_id !== sellerId) throw new TradingError('Only the seller can cancel this listing.', 403);
    if (listing.status !== 'ACTIVE') throw new TradingError('Listing is no longer active.', 409);

    db.prepare("UPDATE p2p_listings SET status = 'CANCELLED' WHERE id = ?").run(listingId);
    db.prepare("UPDATE birds SET status = 'READY' WHERE id = ?").run(listing.bird_id);
  });
}

export function getActiveP2PListings(db: DatabaseSync, viewerId: string): P2PListingDTO[] {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  const rows = db
    .prepare(
      `SELECT p.id as listing_id, p.seller_id, p.asking_price, p.seller_note, p.status as listing_status, p.created_at,
              u.display_name as seller_name, u.aviary_name as seller_aviary_name, b.*
       FROM p2p_listings p
       JOIN users u ON u.id = p.seller_id
       JOIN birds b ON b.id = p.bird_id
       WHERE p.status = 'ACTIVE'
       ORDER BY p.created_at DESC`,
    )
    .all() as unknown as Array<
    BirdRow & {
      listing_id: string;
      seller_id: string;
      asking_price: number;
      seller_note: string;
      listing_status: 'ACTIVE' | 'SOLD' | 'CANCELLED';
      created_at: number;
      seller_name: string;
      seller_aviary_name: string;
    }
  >;

  const birdLookup = loadAllBirdsMap(db);
  const ownerNames = loadOwnerNamesMap(db);
  const mutationConfigs = loadMutationConfigsMap(db);
  // Strictly apply BUYER / VIEWER personal Fog-of-War discovery state!
  const viewerDiscovered = getUserDiscoveredGenes(db, viewerId);

  return rows.map((row) => {
    const dto = toSanitizedConureDTO(row, birdLookup, ownerNames, viewerDiscovered, viewerId, nowMs, false, mutationConfigs);
    const pedigree = buildPedigreeTree(row.id, birdLookup, viewerDiscovered, viewerId, 3)!;
    return {
      listingId: row.listing_id,
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      sellerAviaryName: row.seller_aviary_name,
      askingPrice: row.asking_price,
      sellerNote: row.seller_note,
      status: row.listing_status,
      createdAt: row.created_at,
      bird: dto,
      pedigree,
    };
  });
}

export function buyP2PListing(
  db: DatabaseSync,
  buyerId: string,
  listingId: string,
): { bird: ConureDTO; newCoinsBalance: number; pricePaid: number } {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  return withTransaction(db, () => {
    const listing = db
      .prepare('SELECT id, seller_id, bird_id, asking_price, status FROM p2p_listings WHERE id = ?')
      .get(listingId) as
      | { id: string; seller_id: string; bird_id: string; asking_price: number; status: string }
      | undefined;

    if (!listing) throw new TradingError('P2P listing not found.', 404);
    if (listing.status !== 'ACTIVE') throw new TradingError('This listing has already been sold or cancelled.', 409);
    if (listing.seller_id === buyerId) throw new TradingError('You cannot buy your own listing.', 400);

    const buyer = db.prepare('SELECT id, coins, display_name FROM users WHERE id = ?').get(buyerId) as
      | { id: string; coins: number; display_name: string }
      | undefined;
    if (!buyer) throw new TradingError('Buyer not found.', 404);
    if (buyer.coins < listing.asking_price) {
      throw new TradingError(`Insufficient coins. Need ${listing.asking_price.toLocaleString()} coins.`, 400);
    }

    const newBuyerCoins = buyer.coins - listing.asking_price;
    db.prepare('UPDATE users SET coins = ?, market_spent = market_spent + ? WHERE id = ?').run(
      newBuyerCoins,
      listing.asking_price,
      buyerId,
    );
    db.prepare('UPDATE users SET coins = coins + ?, total_coins_earned = total_coins_earned + ? WHERE id = ?').run(
      listing.asking_price,
      listing.asking_price,
      listing.seller_id,
    );

    const birdRow = db.prepare('SELECT * FROM birds WHERE id = ?').get(listing.bird_id) as unknown as BirdRow;
    const buyerDiscovered = getUserDiscoveredGenes(db, buyerId);
    const actualSplits: string[] = JSON.parse(birdRow.actual_splits || '[]');
    const buyerVisibleSplits = actualSplits.filter((g) => buyerDiscovered.has(g));

    db.prepare("UPDATE birds SET current_owner_id = ?, status = 'READY', displayed_splits = ? WHERE id = ?").run(
      buyerId,
      JSON.stringify(buyerVisibleSplits),
      listing.bird_id,
    );

    db.prepare("UPDATE p2p_listings SET status = 'SOLD', buyer_id = ?, sold_at = ? WHERE id = ?").run(
      buyerId,
      nowMs,
      listingId,
    );

    db.prepare(
      'INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ).run(
      `ntf_${crypto.randomUUID()}`,
      listing.seller_id,
      'P2P_SALE',
      'P2P Sale Completed',
      `${buyer.display_name} purchased ${birdRow.name} (${birdRow.leg_band}) for ${listing.asking_price.toLocaleString()} coins!`,
      nowMs,
    );

    const updatedBird = db.prepare('SELECT * FROM birds WHERE id = ?').get(listing.bird_id) as unknown as BirdRow;
    const birdLookup = loadAllBirdsMap(db);
    const ownerNames = loadOwnerNamesMap(db);

    return {
      bird: toSanitizedConureDTO(updatedBird, birdLookup, ownerNames, buyerDiscovered, buyerId, nowMs, false),
      newCoinsBalance: newBuyerCoins,
      pricePaid: listing.asking_price,
    };
  });
}
