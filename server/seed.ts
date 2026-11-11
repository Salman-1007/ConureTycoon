import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  conceiveOffspring,
  createGenotypeForMutation,
  deriveActualSplits,
  deriveVisualPhenotype,
} from '../shared/genetics/engine.js';
import { calculateShowScore, type ShowCategory } from '../shared/genetics/showroom.js';
import type { OfficialMutationKey, Sex } from '../shared/genetics/types.js';
import { insertBirdRecord } from './birdHelpers.js';
import { getServerClock } from './clock.js';
import { withTransaction } from './db.js';
import { ensureSystemExchangeAccount } from './marketWorker.js';
import { getSeasonKey } from './showroomService.js';

export function seedWorldData(db: DatabaseSync): void {
  const alreadySeeded = db.prepare("SELECT meta_value FROM system_meta WHERE meta_key = 'world_seeded_v1'").get();
  if (alreadySeeded) return;

  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const seasonKey = getSeasonKey(nowMs);

  withTransaction(db, () => {
    ensureSystemExchangeAccount(db);

    const npcs = [
      {
        id: 'npc_elena',
        username: 'elena_suncrest',
        displayName: 'Elena Vance',
        aviaryName: 'Suncrest Avian Sanctuary',
      },
      {
        id: 'npc_marcus',
        username: 'marcus_sapphire',
        displayName: 'Marcus Lin',
        aviaryName: 'Sapphire Wing Aviary',
      },
      {
        id: 'npc_tariq',
        username: 'tariq_canopy',
        displayName: 'Ustad Tariq',
        aviaryName: 'Emerald Valley Aviary',
      },
    ];

    for (const npc of npcs) {
      db.prepare(
        `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, aviary_name, coins, xp, level, is_npc, created_at)
         VALUES (?, ?, 'LOCKED', ?, ?, 50000, 4500, 4, 1, ?)`,
      ).run(npc.id, npc.username, npc.displayName, npc.aviaryName, nowMs - 30 * 24 * 60 * 60 * 1000);
    }

    const oldHatch = nowMs - 60 * 24 * 60 * 60 * 1000;
    const oldMature = nowMs - 45 * 24 * 60 * 60 * 1000;

    const makeSeedBird = (params: {
      name: string;
      mut: OfficialMutationKey;
      sex: Sex;
      splits?: Array<'CIN' | 'OP' | 'TQ' | 'DIL'>;
      breeder: { id: string; displayName: string };
      symmetry: number;
      fatherId?: string | null;
      motherId?: string | null;
      gen?: number;
      status?: 'READY' | 'MARKET_P2P';
    }) => {
      const g = createGenotypeForMutation(params.mut, params.sex, params.splits ?? []);
      return insertBirdRecord(db, {
        name: params.name,
        genotype: g,
        visualPhenotype: deriveVisualPhenotype(g),
        actualSplits: deriveActualSplits(g),
        displayedSplits: deriveActualSplits(g),
        plumageSymmetry: params.symmetry,
        fatherId: params.fatherId ?? null,
        motherId: params.motherId ?? null,
        originalBreederId: params.breeder.id,
        originalBreederName: params.breeder.displayName,
        currentOwnerId: params.breeder.id,
        hatchTimestamp: oldHatch,
        maturationTimestamp: oldMature,
        generationDepth: params.gen ?? 1,
        status: params.status ?? 'READY',
      });
    };

    // Build authentic 3-generation pedigreed birds for P2P Trading Post & Showroom benchmarks
    const gf1 = makeSeedBird({ name: 'Atlas', mut: 'TQ', sex: 'MALE', breeder: npcs[1], symmetry: 84 });
    const gm1 = makeSeedBird({ name: 'Willow', mut: 'CIN', sex: 'FEMALE', breeder: npcs[1], symmetry: 82 });
    const f1 = makeSeedBird({
      name: 'Cobalt',
      mut: 'WT',
      sex: 'MALE',
      splits: ['TQ', 'CIN'],
      breeder: npcs[1],
      symmetry: 86,
      fatherId: gf1.id,
      motherId: gm1.id,
      gen: 2,
    });
    const m1 = makeSeedBird({ name: 'Nectar', mut: 'OP', sex: 'FEMALE', splits: ['TQ'], breeder: npcs[0], symmetry: 85 });

    const p2pShowcase1 = makeSeedBird({
      name: 'Azure Breeze',
      mut: 'TQ_CIN',
      sex: 'FEMALE',
      breeder: npcs[1],
      symmetry: 88.5,
      fatherId: f1.id,
      motherId: m1.id,
      gen: 3,
      status: 'MARKET_P2P',
    });

    const p2pShowcase2 = makeSeedBird({
      name: 'Saffron Crest',
      mut: 'PINE',
      sex: 'MALE',
      splits: ['TQ'],
      breeder: npcs[0],
      symmetry: 84.0,
      fatherId: gf1.id,
      motherId: m1.id,
      gen: 2,
      status: 'MARKET_P2P',
    });

    const p2pShowcase3 = makeSeedBird({
      name: 'Veridian Mist',
      mut: 'DIL',
      sex: 'MALE',
      breeder: npcs[2],
      symmetry: 81.5,
      gen: 1,
      status: 'MARKET_P2P',
    });

    const p2pShowcase4 = makeSeedBird({
      name: 'Pistachio',
      mut: 'WT',
      sex: 'FEMALE',
      splits: ['TQ'],
      breeder: npcs[2],
      symmetry: 82.0,
      fatherId: gf1.id,
      motherId: gm1.id,
      gen: 2,
      status: 'MARKET_P2P',
    });

    // Insert 4 realistic P2P listings
    const p2pItems = [
      {
        sellerId: npcs[1].id,
        birdId: p2pShowcase1.id,
        price: 13800,
        note: '3rd-gen linebred Turquoise Cinnamon hen from clean outcrossed stock.',
      },
      {
        sellerId: npcs[0].id,
        birdId: p2pShowcase2.id,
        price: 5400,
        note: 'Bright Pineapple male with Turquoise sire on pedigree.',
      },
      {
        sellerId: npcs[2].id,
        birdId: p2pShowcase3.id,
        price: 19500,
        note: 'Strong foundation American Dilute male ready for Suncheek/Mint projects.',
      },
      {
        sellerId: npcs[2].id,
        birdId: p2pShowcase4.id,
        price: 4600,
        note: 'Normal Green hen from visual Turquoise sire — great starter breeder.',
      },
    ];

    for (const item of p2pItems) {
      db.prepare(
        `INSERT INTO p2p_listings (id, seller_id, bird_id, asking_price, seller_note, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      ).run(`p2p_${crypto.randomUUID()}`, item.sellerId, item.birdId, item.price, item.note, nowMs - 3600_000);
    }

    // Seed Showroom seasonal benchmark entries (without inflating above player achievability)
    const showNoviceBird = makeSeedBird({ name: 'Jade Wing', mut: 'CIN', sex: 'MALE', breeder: npcs[2], symmetry: 79 });
    const showColorBird = makeSeedBird({ name: 'Sunbeam', mut: 'TQ_YS', sex: 'FEMALE', breeder: npcs[0], symmetry: 84 });
    const showMasterChildGeno = conceiveOffspring(
      createGenotypeForMutation('TQ_PINE', 'MALE'),
      createGenotypeForMutation('TQ_PINE', 'FEMALE'),
    );
    const showMasterBird = insertBirdRecord(db, {
      name: 'Celestia',
      genotype: showMasterChildGeno,
      visualPhenotype: deriveVisualPhenotype(showMasterChildGeno),
      actualSplits: [],
      displayedSplits: [],
      plumageSymmetry: 87,
      fatherId: f1.id,
      motherId: m1.id,
      originalBreederId: npcs[1].id,
      originalBreederName: npcs[1].displayName,
      currentOwnerId: npcs[1].id,
      hatchTimestamp: oldHatch,
      maturationTimestamp: oldMature,
      generationDepth: 3,
      status: 'READY',
    });

    const benchmarkDefs: Array<{
      cat: ShowCategory;
      userId: string;
      birdId: string;
      mut: OfficialMutationKey;
      sym: number;
      gen: number;
      ancestors: number;
    }> = [
      { cat: 'NOVICE', userId: npcs[2].id, birdId: showNoviceBird.id, mut: 'CIN', sym: 79, gen: 1, ancestors: 0 },
      { cat: 'COLOR_MUTATION', userId: npcs[0].id, birdId: showColorBird.id, mut: 'TQ_YS', sym: 84, gen: 1, ancestors: 0 },
      { cat: 'MASTER_PEDIGREE', userId: npcs[1].id, birdId: showMasterBird.id, mut: 'TQ_PINE', sym: 87, gen: 3, ancestors: 4 },
    ];

    for (const bm of benchmarkDefs) {
      const score = calculateShowScore({
        plumageSymmetry: bm.sym,
        visualPhenotype: bm.mut,
        generationDepth: bm.gen,
        knownAncestorsCount: bm.ancestors,
        inbreedingCoi: 0,
      });
      db.prepare(
        `INSERT INTO showroom_entries (
          id, season_key, category, user_id, bird_id,
          symmetry_score, rarity_score, purity_bonus, total_score,
          rank_position, prize_coins, xp_awarded, entered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?)`,
      ).run(
        `shw_${crypto.randomUUID()}`,
        seasonKey,
        bm.cat,
        bm.userId,
        bm.birdId,
        score.plumageSymmetry,
        score.mutationRarityScore,
        score.lineagePurityBonus,
        score.totalScore,
        nowMs - 86400_000,
      );
    }

    db.prepare("INSERT INTO system_meta (meta_key, meta_value) VALUES ('world_seeded_v1', 'true')").run();
  });
}
