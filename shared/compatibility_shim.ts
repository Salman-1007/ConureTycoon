/**
 * Stage 1 Compatibility Shim (`compatibility_shim.ts`)
 * Maps legacy Pigeon Tycoon (Kabootar Baaz) records from `mainfiles.zip`
 * to the new Green Cheek Conure Tycoon (GCCT) chromosomal & pedigree entity model.
 */

import type { BirdGenotype, MutationKey, Sex } from './genetics/types.js';
import { deriveActualSplits, deriveVisualPhenotype } from './genetics/engine.js';

export interface LegacyPigeon {
  id: string;
  name: string;
  breed: string;
  gender: 'male' | 'female';
  age: number;
  generation: number;
  isHomeBred: boolean;
  stamina: number;
  flyHeight: number;
  homeReturn: number;
  agility: number;
  heatResistance: number;
  overallRating: number;
  isBreeding?: boolean;
  isIncubating?: boolean;
  juvenileUntilCompetitions?: number;
  plumageColor?: string;
  purchasePrice?: number;
  marketValue?: number;
  fatherBreed?: string;
  motherBreed?: string;
  sold?: boolean;
}

export interface LegacyPlayerState {
  name: string;
  loftName: string;
  money: number;
  level: number;
  xp: number;
  totalCompetitions: number;
  totalWins: number;
  bestScore: number;
  totalMoneyEarned: number;
  joinedAt: number;
  marketSpent: number;
}

export interface LegacyGameState {
  hasSave: boolean;
  player: LegacyPlayerState;
  pigeons: LegacyPigeon[];
  achievements: string[];
}

export interface AdaptedConureRecord {
  id: string;
  legBand: string;
  name: string;
  sex: Sex;
  visualPhenotype: MutationKey;
  chromosomePayload: BirdGenotype;
  actualSplits: MutationKey[];
  plumageSymmetry: number;
  fatherId: string | null;
  motherId: string | null;
  originalBreederId: string;
  originalBreederName: string;
  currentOwnerId: string;
  hatchTimestamp: number;
  maturationTimestamp: number;
  generationDepth: number;
}

const LEGACY_BREED_TO_MUTATION: Record<string, MutationKey> = {
  Lakha: 'WT',
  Lahori: 'WT',
  Teddy: 'WT',
  CheenaChapra: 'OP',
  Golden: 'OP',
  Kamghar: 'CIN',
  Qasoori: 'PINE',
  Salar: 'TQ',
  Sialkoti: 'TQ_YS',
  Kalsira: 'DIL',
};

function genotypeForLegacyMutation(sex: Sex, mutation: MutationKey): BirdGenotype {
  const cin = mutation === 'CIN' || mutation === 'PINE' || mutation === 'TQ_CIN' || mutation === 'TQ_PINE' || mutation === 'SUNCHK' || mutation === 'MOONCHK';
  const op = mutation === 'OP' || mutation === 'PINE' || mutation === 'TQ_YS' || mutation === 'TQ_PINE' || mutation === 'SUNCHK' || mutation === 'MOONCHK';
  const tq = mutation === 'TQ' || mutation === 'TQ_CIN' || mutation === 'TQ_YS' || mutation === 'TQ_PINE' || mutation === 'MINT' || mutation === 'MOONCHK';
  const dil = mutation === 'DIL' || mutation === 'SUNCHK' || mutation === 'MINT' || mutation === 'MOONCHK';

  return {
    sex,
    zChromosomes:
      sex === 'MALE'
        ? [
            { cinnamon: cin, opaline: op },
            { cinnamon: cin, opaline: op },
          ]
        : [{ cinnamon: cin, opaline: op }],
    autosomalLoci: {
      turquoise: [tq, tq],
      dilute: [dil, dil],
    },
  };
}

export function generateLegBand(year: number, seedHex?: string): string {
  const suffix = (seedHex ?? Math.random().toString(16).slice(2, 6)).toUpperCase().slice(0, 4).padEnd(4, '0');
  return `GCC-${year}-${suffix}`;
}

export function adaptLegacyPigeonToConure(
  legacy: LegacyPigeon,
  ownerId: string,
  breederName: string,
  nowMs = Date.now(),
): AdaptedConureRecord {
  const sex: Sex = legacy.gender === 'male' ? 'MALE' : 'FEMALE';
  const targetMutation = LEGACY_BREED_TO_MUTATION[legacy.breed] ?? 'WT';
  const genotype = genotypeForLegacyMutation(sex, targetMutation);
  const visualPhenotype = deriveVisualPhenotype(genotype);
  const actualSplits = deriveActualSplits(genotype);

  // Preserve visual quality signal as Aviary Trait (Plumage Symmetry) while purging flight stats
  const clampedSymmetry = Math.max(65, Math.min(99, Math.round(legacy.overallRating || 78)));
  const isJuvenile = (legacy.juvenileUntilCompetitions ?? 0) > 0;
  const hashSuffix = legacy.id.replace(/[^a-zA-Z0-9]/g, '').slice(-4) || '0001';

  return {
    id: legacy.id,
    legBand: generateLegBand(new Date(nowMs).getUTCFullYear(), hashSuffix),
    name: legacy.name || 'Emerald',
    sex,
    visualPhenotype,
    chromosomePayload: genotype,
    actualSplits,
    plumageSymmetry: clampedSymmetry,
    fatherId: null,
    motherId: null,
    originalBreederId: ownerId,
    originalBreederName: breederName,
    currentOwnerId: ownerId,
    hatchTimestamp: nowMs - 24 * 60 * 60 * 1000,
    maturationTimestamp: isJuvenile ? nowMs + 6 * 60 * 60 * 1000 : nowMs - 12 * 60 * 60 * 1000,
    generationDepth: Math.max(1, legacy.generation || 1),
  };
}

export function adaptLegacyPlayerToAviaryProfile(legacy: LegacyPlayerState) {
  return {
    displayName: legacy.name || 'Aviary Keeper',
    aviaryName: legacy.loftName ? legacy.loftName.replace(/\bloft\b/gi, 'Aviary') : 'Emerald Canopy Aviary',
    coins: Math.max(0, Math.round(legacy.money ?? 15000)),
    xp: Math.max(0, Math.round(legacy.xp ?? 0)),
    level: Math.max(1, legacy.level ?? 1),
    totalShows: legacy.totalCompetitions ?? 0,
    totalShowWins: legacy.totalWins ?? 0,
    bestShowScore: legacy.bestScore ?? 0,
    totalCoinsEarned: Math.max(0, Math.round(legacy.totalMoneyEarned ?? 0)),
    marketSpent: Math.max(0, Math.round(legacy.marketSpent ?? 0)),
    joinedAt: legacy.joinedAt || Date.now(),
  };
}
