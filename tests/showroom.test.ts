import { describe, expect, it } from 'vitest';
import { createGenotypeForMutation } from '../shared/genetics/engine.js';
import { registerUser } from '../server/auth.js';
import { insertBirdRecord } from '../server/birdHelpers.js';
import { getServerClock } from '../server/clock.js';
import { createDatabase } from '../server/db.js';
import { seedWorldData } from '../server/seed.js';
import { enterShowroom, getShowroomOverview } from '../server/showroomService.js';

describe('Aviary Exhibition Showroom & Seasonal Badges (Stage 8)', () => {
  it('judges entries deterministically, updates leaderboards, and awards seasonal prestige badges', async () => {
    const db = await createDatabase(':memory:');
    await seedWorldData(db);

    const { user } = await registerUser(db, {
      username: 'showbreeder',
      password: 'secret',
      displayName: 'Zara',
      aviaryName: 'Radiant Plumage',
      startingCoins: 15000,
    });

    const clock = await getServerClock(db);
    const moonGeno = createGenotypeForMutation('MOONCHK', 'FEMALE');
    const champion = await insertBirdRecord(db, {
      name: 'Luna',
      genotype: moonGeno,
      visualPhenotype: 'MOONCHK',
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 96,
      fatherId: null,
      motherId: null,
      originalBreederId: user.id,
      originalBreederName: user.display_name,
      currentOwnerId: user.id,
      hatchTimestamp: clock.effectiveNowMs - 48 * 3600_000,
      maturationTimestamp: clock.effectiveNowMs - 24 * 3600_000,
      generationDepth: 1,
      status: 'READY',
    });

    const outcome = await enterShowroom(db, user.id, champion.id, 'COLOR_MUTATION');
    expect(outcome.entry.rankPosition).toBe(1);
    expect(outcome.entry.breakdown.totalScore).toBeGreaterThan(70);
    expect(outcome.prizeCoins).toBe(6500);
    expect(outcome.awardedBadge?.badgeTitle).toContain('Master Mooncheek Breeder');

    const overview = await getShowroomOverview(db);
    expect(overview.leaderboards.COLOR_MUTATION[0].birdName).toBe('Luna');

    await db.close();
  });
});
