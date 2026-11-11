import { describe, expect, it } from 'vitest';
import { createGenotypeForMutation } from '../shared/genetics/engine.js';
import { BREEDING_CONFIG } from '../src/config/breeding.js';
import { registerUser } from '../server/auth.js';
import { insertBirdRecord, loadAllBirdsMap, loadOwnerNamesMap, toSanitizedConureDTO, getUserDiscoveredGenes } from '../server/birdHelpers.js';
import { collectHatchedClutch, previewBreedingPair, startBreedingPair } from '../server/breedingService.js';
import { advanceDevTimeOffsetMs, getServerClock } from '../server/clock.js';
import { createDatabase } from '../server/db.js';
import { buyP2PListing, getActiveP2PListings, listBirdOnP2P } from '../server/tradingService.js';

describe('Breeding Lifecycle, Fog-of-War Retroactive Reveal & Buyer-Scoped P2P (Stages 5, 6, 8)', () => {
  it('enforces maturation & cooldown timers, triggers Genomic Breakthrough on first visual hatch, and respects buyer Fog-of-War in P2P', () => {
    const db = createDatabase(':memory:');
    const { user: alice } = registerUser(db, {
      username: 'alice',
      password: 'secret',
      displayName: 'Alice',
      aviaryName: 'Emerald Aviary',
      startingCoins: 15000,
    });
    const { user: bob } = registerUser(db, {
      username: 'bob',
      password: 'secret',
      displayName: 'Bob',
      aviaryName: 'Oak Aviary',
      startingCoins: 15000,
    });

    // Alice starts with only WT discovered; verify her starter /TQ and /CIN splits are MASKED
    const aliceDiscoveredBefore = getUserDiscoveredGenes(db, alice.id);
    expect([...aliceDiscoveredBefore]).toEqual(['WT']);

    const clock0 = getServerClock(db);
    const aliceRows = db.prepare('SELECT * FROM birds WHERE current_owner_id = ?').all(alice.id) as any[];
    const lookup0 = loadAllBirdsMap(db);
    const owners0 = loadOwnerNamesMap(db);
    for (const row of aliceRows) {
      const dto = toSanitizedConureDTO(row, lookup0, owners0, aliceDiscoveredBefore, alice.id, clock0.effectiveNowMs);
      expect(dto.visibleSplits).toEqual([]);
    }

    // Give Alice a visual Turquoise male & Turquoise female to guarantee a visual Turquoise chick on hatch,
    // plus keep a WT male carrying hidden /TQ split ('Bramble') to verify retroactive aviary unmasking!
    const tqMaleGeno = createGenotypeForMutation('TQ', 'MALE');
    const tqFemaleGeno = createGenotypeForMutation('TQ', 'FEMALE');
    const tqMale = insertBirdRecord(db, {
      name: 'Teal King',
      genotype: tqMaleGeno,
      visualPhenotype: 'TQ',
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 88,
      fatherId: null,
      motherId: null,
      originalBreederId: alice.id,
      originalBreederName: alice.display_name,
      currentOwnerId: alice.id,
      hatchTimestamp: clock0.effectiveNowMs - 24 * 3600_000,
      maturationTimestamp: clock0.effectiveNowMs - 12 * 3600_000,
      generationDepth: 1,
      status: 'READY',
    });
    const tqFemale = insertBirdRecord(db, {
      name: 'Teal Queen',
      genotype: tqFemaleGeno,
      visualPhenotype: 'TQ',
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 87,
      fatherId: null,
      motherId: null,
      originalBreederId: alice.id,
      originalBreederName: alice.display_name,
      currentOwnerId: alice.id,
      hatchTimestamp: clock0.effectiveNowMs - 24 * 3600_000,
      maturationTimestamp: clock0.effectiveNowMs - 12 * 3600_000,
      generationDepth: 1,
      status: 'READY',
    });

    // Pair Teal King & Teal Queen
    const cage = startBreedingPair(db, alice.id, tqMale.id, tqFemale.id);
    expect(cage.clutchSize).toBeGreaterThanOrEqual(BREEDING_CONFIG.CLUTCH_MIN_SIZE);
    expect(cage.clutchSize).toBeLessThanOrEqual(BREEDING_CONFIG.CLUTCH_MAX_SIZE);

    // Trying to collect before 6h incubation finishes must throw
    expect(() => collectHatchedClutch(db, alice.id, cage.id)).toThrow();

    // Advance dev test clock by 6 hours
    advanceDevTimeOffsetMs(db, BREEDING_CONFIG.INCUBATION_DURATION_MS);
    const hatchOutcome = collectHatchedClutch(db, alice.id, cage.id);

    expect(hatchOutcome.chicks.length).toBe(cage.clutchSize);
    expect(hatchOutcome.newlyDiscoveredGenes).toContain('TQ');
    expect(hatchOutcome.notifications.some((n) => n.message.includes('Genomic Breakthrough'))).toBe(true);
    // Starter birds Bramble & Clover carried hidden /TQ, so they MUST be retroactively revealed!
    expect(hatchOutcome.retroactivelyRevealedBirdIds.length).toBeGreaterThanOrEqual(2);

    // Verify juvenile chicks cannot breed yet, and parents are in COOLDOWN
    const clockAfterHatch = getServerClock(db);
    const firstChick = hatchOutcome.chicks[0];
    expect(firstChick.lifecycleStatus).toBe('JUVENILE');
    const previewJuv = previewBreedingPair(db, alice.id, firstChick.id, tqMale.id, clockAfterHatch.effectiveNowMs);
    expect(previewJuv.eligible).toBe(false);

    // Verify Bramble (Alice's WT /TQ bird) now shows CONFIRMED Split Turquoise!
    const brambleRow = db.prepare("SELECT * FROM birds WHERE current_owner_id = ? AND name = 'Bramble'").get(alice.id) as any;
    const lookup1 = loadAllBirdsMap(db);
    const aliceDiscoveredAfter = getUserDiscoveredGenes(db, alice.id);
    const brambleDto = toSanitizedConureDTO(brambleRow, lookup1, owners0, aliceDiscoveredAfter, alice.id, clockAfterHatch.effectiveNowMs);
    expect(brambleDto.visibleSplits.some((s) => s.geneKey === 'TQ' && s.visibility === 'CONFIRMED')).toBe(true);

    // Now Alice lists Bramble on P2P Trading Post!
    // Alice sees Bramble's Split Turquoise, BUT Bob (who has ONLY WT discovered!) MUST NOT see Bramble's masked /TQ split!
    const p2pListing = listBirdOnP2P(db, alice.id, brambleRow.id, 5000, 'Proven split male');
    expect(p2pListing.bird.visibleSplits.some((s) => s.geneKey === 'TQ')).toBe(true);

    const bobListingsView = getActiveP2PListings(db, bob.id);
    const bobViewOfBramble = bobListingsView.find((l) => l.listingId === p2pListing.listingId)!;
    expect(bobViewOfBramble.bird.visibleSplits).toEqual([]);

    // Bob buys Bramble from Alice; coins transfer atomically, and Bramble's /TQ remains masked for Bob until Bob unlocks TQ!
    const p2pBuy = buyP2PListing(db, bob.id, p2pListing.listingId);
    expect(p2pBuy.newCoinsBalance).toBe(10000);
    expect(p2pBuy.bird.visibleSplits).toEqual([]);
    const aliceRow = db.prepare('SELECT coins FROM users WHERE id = ?').get(alice.id) as { coins: number };
    expect(aliceRow.coins).toBe(20000);

    db.close();
  });
});
