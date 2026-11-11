import { getMutationMeta } from './catalog.js';
import type { MutationKey } from './types.js';

export type ShowCategory = 'NOVICE' | 'COLOR_MUTATION' | 'MASTER_PEDIGREE';

export interface ShowCategoryInfo {
  key: ShowCategory;
  title: string;
  subtitle: string;
  entryFee: number;
  firstPrize: number;
  secondPrize: number;
  thirdPrize: number;
  xpReward: number;
  eligibilityNote: string;
}

export const SHOW_CATEGORIES: Record<ShowCategory, ShowCategoryInfo> = {
  NOVICE: {
    key: 'NOVICE',
    title: 'Novice Class',
    subtitle: 'Open exhibition for foundation & early-generation conures',
    entryFee: 250,
    firstPrize: 2500,
    secondPrize: 1000,
    thirdPrize: 500,
    xpReward: 120,
    eligibilityNote: 'Any mature healthy conure',
  },
  COLOR_MUTATION: {
    key: 'COLOR_MUTATION',
    title: 'Color Mutation Class',
    subtitle: 'Judges vibrant psittacin reduction, melanin balance & rare combos',
    entryFee: 750,
    firstPrize: 6500,
    secondPrize: 2600,
    thirdPrize: 1300,
    xpReward: 260,
    eligibilityNote: 'Requires a visual mutation (non-Wild-Type)',
  },
  MASTER_PEDIGREE: {
    key: 'MASTER_PEDIGREE',
    title: 'Master Pedigree Class',
    subtitle: 'Premier division rewarding multi-generation aviary bloodlines & low COI',
    entryFee: 1500,
    firstPrize: 15000,
    secondPrize: 6000,
    thirdPrize: 3000,
    xpReward: 480,
    eligibilityNote: 'Requires Generation 2+ home-bred conure with verified parents',
  },
};

export interface ShowScoreBreakdown {
  plumageSymmetry: number; // 0..100
  mutationRarityScore: number; // 0..100
  lineagePurityBonus: number; // 0..100
  totalScore: number; // Deterministic: (Symmetry * 0.3) + (Rarity * 0.4) + (Purity * 0.3)
}

export function isEligibleForShowCategory(
  category: ShowCategory,
  bird: {
    visualPhenotype: MutationKey;
    generationDepth: number;
    fatherId: string | null;
    motherId: string | null;
    isMature: boolean;
  },
): { eligible: boolean; reason?: string } {
  if (!bird.isMature) {
    return { eligible: false, reason: 'Juvenile chicks must complete maturation before entering exhibitions.' };
  }
  if (category === 'COLOR_MUTATION' && bird.visualPhenotype === 'WT') {
    return { eligible: false, reason: 'Color Mutation Class requires a bird visually expressing a mutation.' };
  }
  if (category === 'MASTER_PEDIGREE' && (bird.generationDepth < 2 || !bird.fatherId || !bird.motherId)) {
    return { eligible: false, reason: 'Master Pedigree Class requires a Gen 2+ conure with verified biological parents.' };
  }
  return { eligible: true };
}

/**
 * Deterministic Judge Scoring Algorithm (Part VII.2):
 * Score = (Plumage Symmetry * 0.3) + (Mutation Rarity Score * 0.4) + (Lineage Purity Bonus * 0.3)
 */
export function calculateShowScore(params: {
  plumageSymmetry: number;
  visualPhenotype: MutationKey;
  generationDepth: number;
  knownAncestorsCount: number; // 0..6 within 3 generations
  inbreedingCoi: number;
}): ShowScoreBreakdown {
  const meta = getMutationMeta(params.visualPhenotype);
  const symmetry = Math.max(50, Math.min(100, Number(params.plumageSymmetry.toFixed(2))));
  const rarity = meta.rarityScore;

  const genComponent = Math.min(40, Math.max(0, params.generationDepth - 1) * 12);
  const pedigreeComponent = Math.min(40, (params.knownAncestorsCount / 6) * 40);
  const baseLineage = 20;
  const coiPenalty = Math.min(30, params.inbreedingCoi * 80);
  const purity = Math.max(10, Math.min(100, Number((baseLineage + genComponent + pedigreeComponent - coiPenalty).toFixed(2))));

  const totalScore = Number((symmetry * 0.3 + rarity * 0.4 + purity * 0.3).toFixed(2));
  return {
    plumageSymmetry: symmetry,
    mutationRarityScore: rarity,
    lineagePurityBonus: purity,
    totalScore,
  };
}

export function getSeasonalBadgeForWin(visualPhenotype: MutationKey, year: number): { key: string; title: string } {
  const meta = getMutationMeta(visualPhenotype);
  if (visualPhenotype === 'WT') {
    return { key: `MASTER_CONSERVATOR_${year}`, title: `Master Conservator ${year}` };
  }
  return {
    key: `MASTER_${meta.key}_${year}`,
    title: `Master ${meta.name} Breeder ${year}`,
  };
}
