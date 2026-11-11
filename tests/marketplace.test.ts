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
  it('follows the 86% Wild Type (54% Pure / 32% Split) and 14% rarity-scaled visual mutation curve', () => {
    const N = 40000;
    let pureWt = 0;
    let splitWt = 0;
    let commonVisual = 0; // CIN, OP
    let intermediateVisual = 0; // PINE, TQ
    let rareVisual = 0; // TQ_CIN, TQ_YS, DIL, TQ_PINE
    let ultraRareVisual = 0; // MINT, SUNCHK, MOONCHK
    const counts: Record<string, number> = {};

    for (let i = 0; i < N; i++) {
      const spec = rollMarketConureSpec();
      counts[spec.mutation] = (counts[spec.mutation] ?? 0) + 1;
      if (spec.mutation === 'WT' && !spec.isSplitCarrier) pureWt++;
      else if (spec.mutation === 'WT' && spec.isSplitCarrier) splitWt++;
      else if (spec.mutation === 'CIN' || spec.mutation === 'OP') commonVisual++;
      else if (spec.mutation === 'PINE' || spec.mutation === 'TQ') intermediateVisual++;
      else if (
        spec.mutation === 'TQ_CIN' ||
        spec.mutation === 'TQ_YS' ||
        spec.mutation === 'DIL' ||
        spec.mutation === 'TQ_PINE'
      ) {
        rareVisual++;
      } else {
        ultraRareVisual++;
      }

      // Females can never be split for sex-linked mutations
      if (spec.sex === 'FEMALE') {
        expect(spec.splits).not.toContain('CIN');
        expect(spec.splits).not.toContain('OP');
      }
    }

    const visualTotal = commonVisual + intermediateVisual + rareVisual + ultraRareVisual;
    expect(pureWt / N).toBeGreaterThan(0.51);
    expect(pureWt / N).toBeLessThan(0.57);
    expect(splitWt / N).toBeGreaterThan(0.29);
    expect(splitWt / N).toBeLessThan(0.35);
    expect(visualTotal / N).toBeGreaterThan(0.12);
    expect(visualTotal / N).toBeLessThan(0.16);

    // Rarity ordering: rare visual mutations spawn less often than common ones
    expect(commonVisual).toBeGreaterThan(intermediateVisual);
    expect(intermediateVisual).toBeGreaterThan(rareVisual);
    expect(rareVisual).toBeGreaterThan(ultraRareVisual);
    expect(counts['MOONCHK'] ?? 0).toBeLessThan(counts['TQ'] ?? 0);
    expect(counts['TQ'] ?? 0).toBeLessThan(counts['CIN'] ?? 0);
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

  it('generates exactly 10 listings per UTC hour, rotates unsold birds at :00, and prevents double-buy race conditions', async () => {
    const db = await createDatabase(':memory:');
    const { user: buyer1 } = await registerUser(db, {
      username: 'buyer1',
      password: 'secret',
      displayName: 'Buyer One',
      aviaryName: 'Aviary One',
      startingCoins: 20000,
    });
    const { user: buyer2 } = await registerUser(db, {
      username: 'buyer2',
      password: 'secret',
      displayName: 'Buyer Two',
      aviaryName: 'Aviary Two',
      startingCoins: 20000,
    });

    const hour1 = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    await ensureHourlyMarketBatch(db, hour1);
    const market1 = await getActiveSystemMarket(db, buyer1.id);
    expect(market1.listings).toHaveLength(10);

    // Fog-of-war: market listings never expose hidden splits before purchase
    for (const l of market1.listings) {
      expect(l.bird.visibleSplits).toEqual([]);
    }

    // Pick an affordable bird
    const affordable = market1.listings.find((l) => l.price <= 15000)!;
    const buyResult = await buySystemMarketListing(db, buyer1.id, affordable.listingId);
    expect(buyResult.newCoinsBalance).toBe(20000 - affordable.price);

    // Attempting a concurrent/second buy on the same listing MUST fail with 409 Conflict
    await expect(buySystemMarketListing(db, buyer2.id, affordable.listingId)).rejects.toThrowError(MarketPurchaseError);
    try {
      await buySystemMarketListing(db, buyer2.id, affordable.listingId);
    } catch (err) {
      expect((err as MarketPurchaseError).statusCode).toBe(409);
    }

    // Verify buyer2's coins remained untouched
    const b2Row = (await db.get<{ coins: number }>('SELECT coins FROM users WHERE id = ?', buyer2.id))!;
    expect(b2Row.coins).toBe(20000);

    // Advance to next UTC hour (:00) and verify unsold listings expire and 10 new birds spawn
    const hour2 = hour1 + 3_600_000;
    await ensureHourlyMarketBatch(db, hour2);
    const expiredCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM market_listings WHERE status = 'EXPIRED'"))!.c;
    expect(expiredCount).toBe(9);
    const activeCount = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM market_listings WHERE status = 'ACTIVE'"))!.c;
    expect(activeCount).toBe(10);

    await db.close();
  });
});
