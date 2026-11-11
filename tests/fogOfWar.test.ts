import { describe, expect, it } from 'vitest';
import { createGenotypeForMutation } from '../shared/genetics/engine.js';
import { BREEDING_CONFIG } from '../src/config/breeding.js';
import { registerUser } from '../server/auth.js';
import {
  type BirdRow,
  getUserDiscoveredGenes,
  insertBirdRecord,
  loadAllBirdsMap,
  loadOwnerNamesMap,
  toSanitizedConureDTO,
} from '../server/birdHelpers.js';
import {
  collectHatchedClutch,
  previewBreedingPair,
  startBreedingPair,
  syncAviaryChickReveals,
} from '../server/breedingService.js';
import { advanceDevTimeOffsetMs, getServerClock } from '../server/clock.js';
import { createDatabase } from '../server/db.js';
import { buyP2PListing, getActiveP2PListings, listBirdOnP2P } from '../server/tradingService.js';

describe('Breeding Lifecycle, Fog-of-War Retroactive Reveal & Buyer-Scoped P2P (Stages 5, 6, 8)', () => {
  it('enforces maturation & cooldown timers, triggers Genomic Breakthrough on first visual hatch, and respects buyer Fog-of-War in P2P', async () => {
    const db = await createDatabase(':memory:');
    const { user: alice } = await registerUser(db, {
      username: 'alice',
      password: 'secret',
      displayName: 'Alice',
      aviaryName: 'Emerald Aviary',
      startingCoins: 15000,
    });
    const { user: bob } = await registerUser(db, {
      username: 'bob',
      password: 'secret',
      displayName: 'Bob',
      aviaryName: 'Oak Aviary',
      startingCoins: 15000,
    });

    // Alice starts with only WT discovered; verify her starter /TQ and /CIN splits are MASKED
    const aliceDiscoveredBefore = await getUserDiscoveredGenes(db, alice.id);
    expect([...aliceDiscoveredBefore]).toEqual(['WT']);

    const clock0 = await getServerClock(db);
    const aliceRows = await db.all<BirdRow>('SELECT * FROM birds WHERE current_owner_id = ?', alice.id);
    const lookup0 = await loadAllBirdsMap(db);
    const owners0 = await loadOwnerNamesMap(db);
    for (const row of aliceRows) {
      const dto = toSanitizedConureDTO(row, lookup0, owners0, aliceDiscoveredBefore, alice.id, clock0.effectiveNowMs);
      expect(dto.visibleSplits).toEqual([]);
    }

    // Give Alice a visual Turquoise male & Turquoise female to guarantee a visual Turquoise chick on hatch,
    // plus keep a WT male carrying hidden /TQ split ('Bramble') to verify retroactive aviary unmasking!
    const tqMaleGeno = createGenotypeForMutation('TQ', 'MALE');
    const tqFemaleGeno = createGenotypeForMutation('TQ', 'FEMALE');
    const tqMale = await insertBirdRecord(db, {
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
    const tqFemale = await insertBirdRecord(db, {
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
    const cage = await startBreedingPair(db, alice.id, tqMale.id, tqFemale.id);
    expect(cage.clutchSize).toBeGreaterThanOrEqual(BREEDING_CONFIG.CLUTCH_MIN_SIZE);
    expect(cage.clutchSize).toBeLessThanOrEqual(BREEDING_CONFIG.CLUTCH_MAX_SIZE);

    // Trying to collect before lay + 6h incubation finishes must throw
    await expect(collectHatchedClutch(db, alice.id, cage.id)).rejects.toThrow();

    // Advance dev test clock by max lay window (6h) + incubation (6h) = 12h
    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.MAX_LAY_DELAY_MS + BREEDING_CONFIG.INCUBATION_DURATION_MS);
    const hatchOutcome = await collectHatchedClutch(db, alice.id, cage.id);

    expect(hatchOutcome.chicks.length).toBe(cage.clutchSize);
    // Downy chicks do not display genetics or trigger breakthroughs until +3h after hatch
    expect(hatchOutcome.chicks.every((c) => !c.geneticsRevealed && c.visualPhenotype === 'WT')).toBe(true);
    expect(hatchOutcome.newlyDiscoveredGenes).toEqual([]);

    // Zero post-breed cooldown: parents are immediately READY right after hatch
    const tqMaleAfterHatch = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', tqMale.id))!;
    expect(tqMaleAfterHatch.status).toBe('READY');
    expect(tqMaleAfterHatch.cooldown_until).toBe(0);

    // Advance +3h so chicks grow feathers and reveal genetics -> unlocks TQ & retroactive splits!
    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.CHICK_GENETICS_REVEAL_MS);
    const revealOutcome = await syncAviaryChickReveals(db, alice.id);
    expect(revealOutcome.newlyDiscoveredGenes).toContain('TQ');
    expect(revealOutcome.notifications.some((n) => n.message.includes('Genomic Breakthrough'))).toBe(true);
    // Starter birds Bramble & Clover carried hidden /TQ, so they MUST be retroactively revealed!
    expect(revealOutcome.retroactivelyRevealedBirdIds.length).toBeGreaterThanOrEqual(2);

    // Chicks remain JUVENILE until +6h total post-hatch (+3h after genetics reveal)
    const clockAfterReveal = await getServerClock(db);
    const firstChick = hatchOutcome.chicks[0];
    expect(firstChick.lifecycleStatus).toBe('JUVENILE');
    const previewJuv = await previewBreedingPair(db, alice.id, firstChick.id, tqMale.id, clockAfterReveal.effectiveNowMs);
    expect(previewJuv.eligible).toBe(false);

    // Verify Bramble (Alice's WT /TQ bird) now shows CONFIRMED Split Turquoise!
    const brambleRow = (await db.get<BirdRow>("SELECT * FROM birds WHERE current_owner_id = ? AND name = 'Bramble'", alice.id))!;
    const lookup1 = await loadAllBirdsMap(db);
    const aliceDiscoveredAfter = await getUserDiscoveredGenes(db, alice.id);
    const brambleDto = toSanitizedConureDTO(brambleRow, lookup1, owners0, aliceDiscoveredAfter, alice.id, clockAfterReveal.effectiveNowMs);
    expect(brambleDto.visibleSplits.some((s) => s.geneKey === 'TQ' && s.visibility === 'CONFIRMED')).toBe(true);

    // Now Alice lists Bramble on P2P Trading Post!
    // Alice sees Bramble's Split Turquoise, BUT Bob (who has ONLY WT discovered!) MUST NOT see Bramble's masked /TQ split!
    const p2pListing = await listBirdOnP2P(db, alice.id, brambleRow.id, 5000, 'Proven split male');
    expect(p2pListing.bird.visibleSplits.some((s) => s.geneKey === 'TQ')).toBe(true);

    const bobListingsView = await getActiveP2PListings(db, bob.id);
    const bobViewOfBramble = bobListingsView.find((l) => l.listingId === p2pListing.listingId)!;
    expect(bobViewOfBramble.bird.visibleSplits).toEqual([]);

    // Bob buys Bramble from Alice; coins transfer atomically, and Bramble's /TQ remains masked for Bob until Bob unlocks TQ!
    const p2pBuy = await buyP2PListing(db, bob.id, p2pListing.listingId);
    expect(p2pBuy.newCoinsBalance).toBe(10000);
    expect(p2pBuy.bird.visibleSplits).toEqual([]);
    const aliceRow = (await db.get<{ coins: number }>('SELECT coins FROM users WHERE id = ?', alice.id))!;
    expect(aliceRow.coins).toBe(20000);

    await db.close();
  });
});
