import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ShowroomLeaderboardRowDTO, ShowroomOverviewDTO } from '../shared/api-types.js';
import { getMutationMeta } from '../shared/genetics/catalog.js';
import { analyzeInbreeding, countKnownAncestorsWithin3Gen } from '../shared/genetics/pedigree.js';
import {
  SHOW_CATEGORIES,
  type ShowCategory,
  calculateShowScore,
  getSeasonalBadgeForWin,
  isEligibleForShowCategory,
} from '../shared/genetics/showroom.js';
import type { MutationKey } from '../shared/genetics/types.js';
import { type BirdRow, computeLifecycleStatus, getLevelInfo, loadAllBirdsMap } from './birdHelpers.js';
import { getServerClock } from './clock.js';
import { withTransaction } from './db.js';

export class ShowroomError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
  }
}

export function getSeasonKey(nowMs: number): string {
  const year = new Date(nowMs).getUTCFullYear();
  return `${year}`;
}

export function getShowroomOverview(db: DatabaseSync): ShowroomOverviewDTO {
  const clock = getServerClock(db);
  const seasonKey = getSeasonKey(clock.effectiveNowMs);

  const rows = db
    .prepare(
      `SELECT se.*, u.display_name as breeder_name, u.aviary_name, b.name as bird_name, b.leg_band, b.visual_phenotype
       FROM showroom_entries se
       JOIN users u ON u.id = se.user_id
       JOIN birds b ON b.id = se.bird_id
       WHERE se.season_key = ?
       ORDER BY se.total_score DESC, se.entered_at ASC`,
    )
    .all(seasonKey) as Array<{
    id: string;
    season_key: string;
    category: ShowCategory;
    user_id: string;
    bird_id: string;
    symmetry_score: number;
    rarity_score: number;
    purity_bonus: number;
    total_score: number;
    rank_position: number;
    prize_coins: number;
    entered_at: number;
    breeder_name: string;
    aviary_name: string;
    bird_name: string;
    leg_band: string;
    visual_phenotype: MutationKey;
  }>;

  const mapRow = (r: (typeof rows)[number], rank: number): ShowroomLeaderboardRowDTO => ({
    entryId: r.id,
    seasonKey: r.season_key,
    category: r.category,
    rankPosition: rank,
    userId: r.user_id,
    breederName: r.breeder_name,
    aviaryName: r.aviary_name,
    birdId: r.bird_id,
    birdName: r.bird_name,
    legBand: r.leg_band,
    visualPhenotype: r.visual_phenotype,
    phenotypeName: getMutationMeta(r.visual_phenotype).name,
    breakdown: {
      plumageSymmetry: r.symmetry_score,
      mutationRarityScore: r.rarity_score,
      lineagePurityBonus: r.purity_bonus,
      totalScore: r.total_score,
    },
    prizeCoins: r.prize_coins,
    enteredAt: r.entered_at,
  });

  const leaderboards: Record<ShowCategory, ShowroomLeaderboardRowDTO[]> = {
    NOVICE: [],
    COLOR_MUTATION: [],
    MASTER_PEDIGREE: [],
  };

  for (const cat of ['NOVICE', 'COLOR_MUTATION', 'MASTER_PEDIGREE'] as const) {
    leaderboards[cat] = rows
      .filter((r) => r.category === cat)
      .sort((a, b) => b.total_score - a.total_score)
      .slice(0, 12)
      .map((r, idx) => mapRow(r, idx + 1));
  }

  const recentEntries = [...rows]
    .sort((a, b) => b.entered_at - a.entered_at)
    .slice(0, 10)
    .map((r) => mapRow(r, r.rank_position));

  return { seasonKey, leaderboards, recentEntries };
}

export function enterShowroom(
  db: DatabaseSync,
  userId: string,
  birdId: string,
  category: ShowCategory,
): {
  entry: ShowroomLeaderboardRowDTO;
  prizeCoins: number;
  xpAwarded: number;
  awardedBadge: { badgeKey: string; badgeTitle: string } | null;
} {
  const catInfo = SHOW_CATEGORIES[category];
  if (!catInfo) throw new ShowroomError('Invalid exhibition category.', 400);

  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const seasonKey = getSeasonKey(nowMs);
  const seasonYear = new Date(nowMs).getUTCFullYear();

  return withTransaction(db, () => {
    const user = db.prepare('SELECT id, display_name, aviary_name, coins, xp, best_show_score FROM users WHERE id = ?').get(userId) as
      | { id: string; display_name: string; aviary_name: string; coins: number; xp: number; best_show_score: number }
      | undefined;
    if (!user) throw new ShowroomError('User not found.', 404);
    if (user.coins < catInfo.entryFee) {
      throw new ShowroomError(`Need ${catInfo.entryFee.toLocaleString()} coins to enter ${catInfo.title}.`, 400);
    }

    const bird = db.prepare('SELECT * FROM birds WHERE id = ?').get(birdId) as BirdRow | undefined;
    if (!bird) throw new ShowroomError('Bird not found.', 404);
    if (bird.current_owner_id !== userId) throw new ShowroomError('You do not own this conure.', 403);

    const status = computeLifecycleStatus(bird, nowMs);
    if (status === 'MARKET_P2P' || status === 'MARKET_SYSTEM' || status === 'BREEDING' || status === 'INCUBATING') {
      throw new ShowroomError(`Cannot enter ${bird.name} while status is ${status}.`, 400);
    }

    const eligibility = isEligibleForShowCategory(category, {
      visualPhenotype: bird.visual_phenotype,
      generationDepth: bird.generation_depth,
      fatherId: bird.father_id,
      motherId: bird.mother_id,
      isMature: nowMs >= bird.maturation_timestamp,
    });
    if (!eligibility.eligible) {
      throw new ShowroomError(eligibility.reason ?? 'Bird is not eligible for this division.', 400);
    }

    const birdLookup = loadAllBirdsMap(db);
    const knownAncestors = countKnownAncestorsWithin3Gen(bird.id, birdLookup);
    let birdCoi = 0;
    if (bird.father_id && bird.mother_id) {
      birdCoi = analyzeInbreeding(bird.father_id, bird.mother_id, birdLookup).coi;
    }

    const breakdown = calculateShowScore({
      plumageSymmetry: bird.plumage_symmetry,
      visualPhenotype: bird.visual_phenotype,
      generationDepth: bird.generation_depth,
      knownAncestorsCount: knownAncestors,
      inbreedingCoi: birdCoi,
    });

    // Rank against existing top seasonal entries in this category
    const existingScores = db
      .prepare('SELECT total_score FROM showroom_entries WHERE season_key = ? AND category = ? ORDER BY total_score DESC')
      .all(seasonKey, category) as Array<{ total_score: number }>;

    const betterCount = existingScores.filter((s) => s.total_score > breakdown.totalScore).length;
    const rankPosition = betterCount + 1;

    const prizeCoins =
      rankPosition === 1
        ? catInfo.firstPrize
        : rankPosition === 2
          ? catInfo.secondPrize
          : rankPosition === 3
            ? catInfo.thirdPrize
            : Math.round(catInfo.entryFee * 0.5);

    const xpAwarded = rankPosition === 1 ? catInfo.xpReward : Math.round(catInfo.xpReward * 0.5);
    const netCoins = user.coins - catInfo.entryFee + prizeCoins;
    const nextXp = user.xp + xpAwarded;
    const nextLevel = getLevelInfo(nextXp).current.level;

    db.prepare(
      `UPDATE users SET
         coins = ?,
         xp = ?,
         level = ?,
         total_shows = total_shows + 1,
         total_show_wins = total_show_wins + ?,
         best_show_score = MAX(best_show_score, ?),
         total_coins_earned = total_coins_earned + ?
       WHERE id = ?`,
    ).run(netCoins, nextXp, nextLevel, rankPosition === 1 ? 1 : 0, breakdown.totalScore, prizeCoins, userId);

    const entryId = `shw_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO showroom_entries (
        id, season_key, category, user_id, bird_id,
        symmetry_score, rarity_score, purity_bonus, total_score,
        rank_position, prize_coins, xp_awarded, entered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entryId,
      seasonKey,
      category,
      userId,
      bird.id,
      breakdown.plumageSymmetry,
      breakdown.mutationRarityScore,
      breakdown.lineagePurityBonus,
      breakdown.totalScore,
      rankPosition,
      prizeCoins,
      xpAwarded,
      nowMs,
    );

    let awardedBadge: { badgeKey: string; badgeTitle: string } | null = null;
    if (rankPosition <= 3) {
      const badge = getSeasonalBadgeForWin(bird.visual_phenotype, seasonYear);
      const alreadyHas = db
        .prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_key = ?')
        .get(userId, badge.key);
      if (!alreadyHas) {
        db.prepare('INSERT INTO user_badges (user_id, badge_key, badge_title, awarded_at) VALUES (?, ?, ?, ?)').run(
          userId,
          badge.key,
          badge.title,
          nowMs,
        );
        awardedBadge = { badgeKey: badge.key, badgeTitle: badge.title };
        db.prepare(
          'INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        ).run(
          `ntf_${crypto.randomUUID()}`,
          userId,
          'SHOWROOM_TROPHY',
          `Prestige Badge: ${badge.title}`,
          `${bird.name} (${bird.leg_band}) placed #${rankPosition} in ${catInfo.title} with ${breakdown.totalScore} pts, earning "${badge.title}"!`,
          nowMs,
        );
      }
    }

    return {
      entry: {
        entryId,
        seasonKey,
        category,
        rankPosition,
        userId,
        breederName: user.display_name,
        aviaryName: user.aviary_name,
        birdId: bird.id,
        birdName: bird.name,
        legBand: bird.leg_band,
        visualPhenotype: bird.visual_phenotype,
        phenotypeName: getMutationMeta(bird.visual_phenotype).name,
        breakdown,
        prizeCoins,
        enteredAt: nowMs,
      },
      prizeCoins,
      xpAwarded,
      awardedBadge,
    };
  });
}
