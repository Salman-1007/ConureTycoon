import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
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
  fosterClutch,
  previewBreedingPair,
  startBreedingPair,
  syncAviaryChickReveals,
} from '../server/breedingService.js';
import { advanceDevTimeOffsetMs, getServerClock } from '../server/clock.js';
import { type AppDatabase, createDatabase } from '../server/db.js';
import { createGenotypeForMutation } from '../shared/genetics/engine.js';
import { BREEDING_CONFIG } from '../src/config/breeding.js';

describe('Breeding Timers, Zero Cooldown, Fostering & Admin Test Lab Rules', () => {
  it('enforces random 1-6h laying, 6h hatch, 3h downy + 3h maturation, zero cooldown, and fostering (>5 50/50 risk)', async () => {
    const db = await createDatabase(':memory:');
    const { user } = await registerUser(db, {
      username: 'breeder_test',
      password: 'secret',
      displayName: 'Tester',
      aviaryName: 'Canopy Lab',
      startingCoins: 10000,
    });

    const nowMs = (await getServerClock(db)).effectiveNowMs;
    const adultHatch = nowMs - 24 * 3600_000;
    const adultMaturation = nowMs - 12 * 3600_000;

    // Give 4 distinct breeding adults: TQ pair + CIN pair
    const tqMale = await insertBirdRecord(db, {
      id: 'bird_tqm',
      name: 'Teal King',
      genotype: createGenotypeForMutation('TQ', 'MALE'),
      visualPhenotype: 'TQ',
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 88,
      fatherId: null,
      motherId: null,
      originalBreederId: user.id,
      originalBreederName: user.display_name,
      currentOwnerId: user.id,
      generationDepth: 1,
      status: 'READY',
      hatchTimestamp: adultHatch,
      maturationTimestamp: adultMaturation,
    });
    const tqFemale = await insertBirdRecord(db, {
      id: 'bird_tqf',
      name: 'Teal Queen',
      genotype: createGenotypeForMutation('TQ', 'FEMALE'),
      visualPhenotype: 'TQ',
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 87,
      fatherId: null,
      motherId: null,
      originalBreederId: user.id,
      originalBreederName: user.display_name,
      currentOwnerId: user.id,
      generationDepth: 1,
      status: 'READY',
      hatchTimestamp: adultHatch,
      maturationTimestamp: adultMaturation,
    });
    const cinMale = await insertBirdRecord(db, {
      id: 'bird_cinm',
      name: 'Cinnabar',
      genotype: createGenotypeForMutation('CIN', 'MALE'),
      visualPhenotype: 'CIN',
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 86,
      fatherId: null,
      motherId: null,
      originalBreederId: user.id,
      originalBreederName: user.display_name,
      currentOwnerId: user.id,
      generationDepth: 1,
      status: 'READY',
      hatchTimestamp: adultHatch,
      maturationTimestamp: adultMaturation,
    });
    const cinFemale = await insertBirdRecord(db, {
      id: 'bird_cinf',
      name: 'Amber',
      genotype: createGenotypeForMutation('CIN', 'FEMALE'),
      visualPhenotype: 'CIN',
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 85,
      fatherId: null,
      motherId: null,
      originalBreederId: user.id,
      originalBreederName: user.display_name,
      currentOwnerId: user.id,
      generationDepth: 1,
      status: 'READY',
      hatchTimestamp: adultHatch,
      maturationTimestamp: adultMaturation,
    });

    // 1. Check random lay delay falls inside [1h, 6h] and hatchReadyAt === laidAt + 6h
    const cage1 = await startBreedingPair(db, user.id, tqMale.id, tqFemale.id);
    const cage2 = await startBreedingPair(db, user.id, cinMale.id, cinFemale.id);

    for (const c of [cage1, cage2]) {
      const layDelay = c.laidAt - c.startedAt;
      expect(layDelay).toBeGreaterThanOrEqual(BREEDING_CONFIG.MIN_LAY_DELAY_MS);
      expect(layDelay).toBeLessThanOrEqual(BREEDING_CONFIG.MAX_LAY_DELAY_MS);
      expect(c.hatchReadyAt - c.laidAt).toBe(BREEDING_CONFIG.INCUBATION_DURATION_MS);
      expect(c.eggsLaid).toBe(false);
    }

    // Cannot foster or hatch before eggs are laid
    await expect(fosterClutch(db, user.id, cage1.id, cage2.id)).rejects.toThrow();
    await expect(collectHatchedClutch(db, user.id, cage1.id)).rejects.toThrow();

    // Advance past 6h max lay window so both pairs have laid eggs, but before incubation finishes
    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.MAX_LAY_DELAY_MS);
    await expect(collectHatchedClutch(db, user.id, cage1.id)).rejects.toThrow();

    // 2. Foster Cage 1 (TQ pair) eggs into Cage 2 (CIN pair) -> combined eggs = 6..10 (> 5 safe cap!)
    const fosterOutcome = await fosterClutch(db, user.id, cage1.id, cage2.id);
    expect(fosterOutcome.transferredCount).toBe(cage1.clutchSize);
    expect(fosterOutcome.totalInTarget).toBe(cage1.clutchSize + cage2.clutchSize);
    expect(fosterOutcome.extraRiskCount).toBe(Math.max(0, fosterOutcome.totalInTarget - 5));

    // Donor TQ pair must be immediately READY with zero cooldown and able to re-pair right now!
    const tqmPostFoster = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', tqMale.id))!;
    const tqfPostFoster = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', tqFemale.id))!;
    expect(tqmPostFoster.status).toBe('READY');
    expect(tqmPostFoster.cooldown_until).toBe(0);
    expect(tqfPostFoster.status).toBe('READY');
    expect(tqfPostFoster.cooldown_until).toBe(0);

    const instantRepair = await startBreedingPair(db, user.id, tqMale.id, tqFemale.id, false, {
      layDelayMsOverride: BREEDING_CONFIG.MIN_LAY_DELAY_MS,
    });
    expect(instantRepair.clutchSize).toBeGreaterThanOrEqual(3);

    // Advance another 6h so incubation completes on fostered Cage 2 and hatch it
    // Force failing 50/50 survival check (0.99 >= 0.5) on any chicks beyond index 4
    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.INCUBATION_DURATION_MS);
    const hatchCapped = await collectHatchedClutch(db, user.id, cage2.id, { survivalRng: () => 0.99 });
    expect(hatchCapped.chicks).toHaveLength(5);
    expect(hatchCapped.fosterOverloadTotal).toBe(fosterOutcome.totalInTarget);
    expect(hatchCapped.fosterLostCount).toBe(fosterOutcome.totalInTarget - 5);

    // Zero cooldown after hatching too: CIN pair is immediately READY!
    const cinmPostHatch = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', cinMale.id))!;
    const cinfPostHatch = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', cinFemale.id))!;
    expect(cinmPostHatch.status).toBe('READY');
    expect(cinmPostHatch.cooldown_until).toBe(0);
    expect(cinfPostHatch.status).toBe('READY');
    expect(cinfPostHatch.cooldown_until).toBe(0);

    // 3. Test 100% pass survivalRng on an overloaded nest preserves all fostered chicks & true biological parents
    const extraPair = await startBreedingPair(db, user.id, cinMale.id, cinFemale.id, false, {
      layDelayMsOverride: BREEDING_CONFIG.MIN_LAY_DELAY_MS,
    });
    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.MIN_LAY_DELAY_MS);
    const secondFoster = await fosterClutch(db, user.id, extraPair.id, instantRepair.id);
    expect(secondFoster.totalInTarget).toBeGreaterThan(5);

    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.INCUBATION_DURATION_MS);
    const hatchAllSurvived = await collectHatchedClutch(db, user.id, instantRepair.id, { survivalRng: () => 0.1 });
    expect(hatchAllSurvived.chicks).toHaveLength(secondFoster.totalInTarget);
    expect(hatchAllSurvived.fosterLostCount).toBe(0);

    // Verify foster chicks still record true biological parents (cinMale & cinFemale on the transferred subset)
    const lookupSurvived = await loadAllBirdsMap(db);
    const bioCinChicks = hatchAllSurvived.chicks.filter(
      (c) => lookupSurvived.get(c.id)!.fatherId === cinMale.id && lookupSurvived.get(c.id)!.motherId === cinFemale.id,
    );
    expect(bioCinChicks.length).toBe(secondFoster.transferredCount);

    // 4. Verify 3h Downy -> +3h Genetics Revealed -> +3h Adult (6h total post-hatch)
    const sampleChick = hatchAllSurvived.chicks[0];
    expect(sampleChick.geneticsRevealed).toBe(false);
    expect(sampleChick.visualPhenotype).toBe('WT');
    expect(sampleChick.phenotypeName).toBe('Downy Chick (Genetics Developing)');
    expect(sampleChick.assetUrl).toBe('/assets/conures/chick_downy.svg');
    expect(sampleChick.lifecycleStatus).toBe('JUVENILE');

    // +3h -> Feathers & genetics appear, yet still JUVENILE
    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.CHICK_GENETICS_REVEAL_MS);
    const revealRes = await syncAviaryChickReveals(db, user.id);
    expect(revealRes.newlyDiscoveredGenes.length).toBeGreaterThan(0);

    const clock3h = await getServerClock(db);
    const discovered3h = await getUserDiscoveredGenes(db, user.id);
    const ownersMap = await loadOwnerNamesMap(db);
    const sampleRow = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', sampleChick.id))!;
    const chickAt3h = toSanitizedConureDTO(
      sampleRow,
      lookupSurvived,
      ownersMap,
      discovered3h,
      user.id,
      clock3h.effectiveNowMs,
    );
    expect(chickAt3h.geneticsRevealed).toBe(true);
    expect(chickAt3h.phenotypeName).not.toBe('Downy Chick (Genetics Developing)');
    expect(chickAt3h.lifecycleStatus).toBe('JUVENILE');
    expect((await previewBreedingPair(db, user.id, chickAt3h.id, cinFemale.id, clock3h.effectiveNowMs)).eligible).toBe(false);

    // +3h more (+6h total post-hatch) -> Adult READY!
    await advanceDevTimeOffsetMs(db, BREEDING_CONFIG.MATURATION_DURATION_MS - BREEDING_CONFIG.CHICK_GENETICS_REVEAL_MS);
    const clock6h = await getServerClock(db);
    const chickAt6h = toSanitizedConureDTO(
      sampleRow,
      lookupSurvived,
      ownersMap,
      discovered3h,
      user.id,
      clock6h.effectiveNowMs,
    );
    expect(chickAt6h.lifecycleStatus).toBe('READY');

    await db.close();
  });

  describe('HTTP Admin-Only Test Lab & Foster Route', () => {
    let db: AppDatabase;
    let server: http.Server;
    let baseUrl = '';

    beforeAll(async () => {
      db = await createDatabase(':memory:');
      const app = createApp(db);
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    });

    it('restricts Test Lab endpoints strictly to salman (admin) and supports POST /api/breeding/foster', async () => {
      const postJson = async (path: string, body: unknown, token?: string) => {
        const res = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
      };

      const regPlayer = await postJson('/api/auth/register', {
        username: 'normal_player',
        password: 'password123',
        displayName: 'Normal',
        aviaryName: 'Normal Aviary',
      });
      expect(regPlayer.status).toBe(201);
      expect(regPlayer.json.user.isAdmin).toBe(false);
      expect(regPlayer.json.user.devToolsEnabled).toBe(false);
      const playerToken = regPlayer.json.token as string;

      const regAdmin = await postJson('/api/auth/register', {
        username: 'salman',
        password: 'password123',
        displayName: 'Salman',
        aviaryName: 'Salman Aviary',
      });
      expect(regAdmin.status).toBe(201);
      expect(regAdmin.json.user.isAdmin).toBe(true);
      expect(regAdmin.json.user.devToolsEnabled).toBe(true);
      const adminToken = regAdmin.json.token as string;

      // Non-admin blocked from both Test Lab endpoints
      expect((await postJson('/api/dev/advance-time', { hours: 6 }, playerToken)).status).toBe(403);
      expect((await postJson('/api/dev/refresh-market', {}, playerToken)).status).toBe(403);

      // Admin allowed on both Test Lab endpoints
      expect((await postJson('/api/dev/advance-time', { hours: 1 }, adminToken)).status).toBe(200);
      expect((await postJson('/api/dev/refresh-market', {}, adminToken)).status).toBe(200);

      // Ensure player has at least 2 adult males and 2 adult females, then pair 2 cages & foster via HTTP
      const nowHttp = (await getServerClock(db)).effectiveNowMs;
      await insertBirdRecord(db, {
        name: 'Foster Sire Extra',
        genotype: createGenotypeForMutation('WT', 'MALE'),
        visualPhenotype: 'WT',
        actualSplits: [],
        displayedSplits: [],
        plumageSymmetry: 80,
        fatherId: null,
        motherId: null,
        originalBreederId: regPlayer.json.user.id,
        originalBreederName: 'Normal',
        currentOwnerId: regPlayer.json.user.id,
        generationDepth: 1,
        status: 'READY',
        hatchTimestamp: nowHttp - 24 * 3600_000,
        maturationTimestamp: nowHttp - 12 * 3600_000,
      });
      await insertBirdRecord(db, {
        name: 'Foster Dam Extra',
        genotype: createGenotypeForMutation('WT', 'FEMALE'),
        visualPhenotype: 'WT',
        actualSplits: [],
        displayedSplits: [],
        plumageSymmetry: 80,
        fatherId: null,
        motherId: null,
        originalBreederId: regPlayer.json.user.id,
        originalBreederName: 'Normal',
        currentOwnerId: regPlayer.json.user.id,
        generationDepth: 1,
        status: 'READY',
        hatchTimestamp: nowHttp - 24 * 3600_000,
        maturationTimestamp: nowHttp - 12 * 3600_000,
      });

      const aviaryRes = await fetch(`${baseUrl}/api/aviary`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      const aviary = await aviaryRes.json();
      const males = aviary.birds.filter((b: any) => b.sex === 'MALE' && b.lifecycleStatus === 'READY');
      const females = aviary.birds.filter((b: any) => b.sex === 'FEMALE' && b.lifecycleStatus === 'READY');

      const p1 = await postJson(
        '/api/breeding/pair',
        { birdAId: males[0].id, birdBId: females[0].id, acknowledgeInbreeding: true },
        playerToken,
      );
      const p2 = await postJson(
        '/api/breeding/pair',
        { birdAId: males[1].id, birdBId: females[1].id, acknowledgeInbreeding: true },
        playerToken,
      );
      expect(p1.status).toBe(201);
      expect(p2.status).toBe(201);

      // Advance +6h as admin so eggs are laid
      await postJson('/api/dev/advance-time', { hours: 6 }, adminToken);

      const fosterRes = await postJson(
        '/api/breeding/foster',
        { sourceCageId: p1.json.cage.id, targetCageId: p2.json.cage.id },
        playerToken,
      );
      expect(fosterRes.status).toBe(200);
      expect(fosterRes.json.transferredCount).toBe(p1.json.cage.clutchSize);
      expect(fosterRes.json.totalInTarget).toBe(p1.json.cage.clutchSize + p2.json.cage.clutchSize);
    });
  });
});
