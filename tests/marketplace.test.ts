import { describe, expect, it } from 'vitest';
import { MUTATION_CATALOG } from '../shared/genetics/catalog.js';
import { registerUser } from '../server/auth.js';
import { createDatabase } from '../server/db.js';
import {
  MarketPurchaseError,
  buySystemMarketListing,
  computeMarketPrice,
  ensureHourlyMarketBatch,
  getActiveSystemMarket,
  rollMarketConureSpec,
} from '../server/marketWorker.js';

describe('Server-Authoritative Hourly Marketplace (Stage 4)', () => {
  it('follows the 80% Common (50% Pure WT / 30% Split WT) and 20% Visual (10% Interm / 10% Rare) spawn curve', () => {
    const N = 10000;
    let pureWt = 0;
    let splitWt = 0;
    let intermediate = 0;
    let rare = 0;

    for (let i = 0; i < N; i++) {
      const spec = rollMarketConureSpec();
      if (spec.mutation === 'WT' && !spec.isSplitCarrier) pureWt++;
      else if (spec.mutation === 'WT' && spec.isSplitCarrier) splitWt++;
      else if (spec.mutation === 'OP' || spec.mutation === 'PINE') intermediate++;
      else rare++;

      // Females can never be split for sex-linked mutations
      if (spec.sex === 'FEMALE') {
        expect(spec.splits).not.toContain('CIN');
        expect(spec.splits).not.toContain('OP');
      }
    }

    expect(pureWt / N).toBeGreaterThan(0.47);
    expect(pureWt / N).toBeLessThan(0.53);
    expect(splitWt / N).toBeGreaterThan(0.27);
    expect(splitWt / N).toBeLessThan(0.33);
    expect(intermediate / N).toBeGreaterThan(0.08);
    expect(intermediate / N).toBeLessThan(0.12);
    expect(rare / N).toBeGreaterThan(0.08);
    expect(rare / N).toBeLessThan(0.12);
  });

  it('prices listings within +-20% rounded to 50 and biases split carriers upward', () => {
    for (const key of ['WT', 'OP', 'TQ', 'DIL', 'MINT', 'SUNCHK', 'MOONCHK'] as const) {
      const base = MUTATION_CATALOG[key].basePrice;
      const min = Math.round((base * 0.8) / 50) * 50;
      const max = Math.round((base * 1.2) / 50) * 50;
      for (let i = 0; i < 100; i++) {
        const p = computeMarketPrice(base, false);
        expect(p % 50).toBe(0);
        expect(p).toBeGreaterThanOrEqual(min);
        expect(p).toBeLessThanOrEqual(max);

        const pSplit = computeMarketPrice(base, true);
        expect(pSplit % 50).toBe(0);
        expect(pSplit).toBeGreaterThanOrEqual(min);
        expect(pSplit).toBeLessThanOrEqual(max);
      }
    }
  });

  it('generates exactly 10 listings per UTC hour, rotates unsold birds at :00, and prevents double-buy race conditions', () => {
    const db = createDatabase(':memory:');
    const { user: buyer1 } = registerUser(db, {
      username: 'buyer1',
      password: 'secret',
      displayName: 'Buyer One',
      aviaryName: 'Aviary One',
      startingCoins: 20000,
    });
    const { user: buyer2 } = registerUser(db, {
      username: 'buyer2',
      password: 'secret',
      displayName: 'Buyer Two',
      aviaryName: 'Aviary Two',
      startingCoins: 20000,
    });

    const hour1 = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    ensureHourlyMarketBatch(db, hour1);
    const market1 = getActiveSystemMarket(db, buyer1.id);
    expect(market1.listings).toHaveLength(10);

    // Fog-of-war: market listings never expose hidden splits before purchase
    for (const l of market1.listings) {
      expect(l.bird.visibleSplits).toEqual([]);
    }

    // Pick an affordable bird
    const affordable = market1.listings.find((l) => l.price <= 15000)!;
    const buyResult = buySystemMarketListing(db, buyer1.id, affordable.listingId);
    expect(buyResult.newCoinsBalance).toBe(20000 - affordable.price);

    // Attempting a concurrent/second buy on the same listing MUST fail with 409 Conflict
    expect(() => buySystemMarketListing(db, buyer2.id, affordable.listingId)).toThrowError(MarketPurchaseError);
    try {
      buySystemMarketListing(db, buyer2.id, affordable.listingId);
    } catch (err) {
      expect((err as MarketPurchaseError).statusCode).toBe(409);
    }

    // Verify buyer2's coins remained untouched
    const b2Row = db.prepare('SELECT coins FROM users WHERE id = ?').get(buyer2.id) as { coins: number };
    expect(b2Row.coins).toBe(20000);

    // Advance to next UTC hour (:00) and verify unsold listings expire and 10 new birds spawn
    const hour2 = hour1 + 3_600_000;
    ensureHourlyMarketBatch(db, hour2);
    const expiredCount = (db.prepare("SELECT COUNT(*) as c FROM market_listings WHERE status = 'EXPIRED'").get() as { c: number }).c;
    expect(expiredCount).toBe(9);
    const activeCount = (db.prepare("SELECT COUNT(*) as c FROM market_listings WHERE status = 'ACTIVE'").get() as { c: number }).c;
    expect(activeCount).toBe(10);

    db.close();
  });
});
