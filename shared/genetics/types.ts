export type Sex = 'MALE' | 'FEMALE';

export type BaseLocusKey = 'CIN' | 'OP' | 'TQ' | 'DIL';

export type OfficialMutationKey =
  | 'WT'
  | 'CIN'
  | 'OP'
  | 'PINE'
  | 'TQ'
  | 'DIL'
  | 'SUNCHK'
  | 'MINT'
  | 'TQ_CIN'
  | 'TQ_YS'
  | 'TQ_PINE'
  | 'MOONCHK';

export type MutationKey =
  | OfficialMutationKey
  | 'DIL_CIN'
  | 'DIL_OP'
  | 'MINT_CIN'
  | 'MINT_YS';

export interface ZChromosomeGenes {
  cinnamon: boolean;
  opaline: boolean;
}

export interface Gamete {
  sexChromosome: 'Z' | 'W';
  zGenes: ZChromosomeGenes;
  autosomal: {
    turquoise: boolean;
    dilute: boolean;
  };
}

export interface BirdGenotype {
  sex: Sex;
  zChromosomes: [ZChromosomeGenes, ZChromosomeGenes?]; // 2 for Male (ZZ), 1 for Female (ZW)
  autosomalLoci: {
    turquoise: [boolean, boolean]; // [maternal_allele, paternal_allele]
    dilute: [boolean, boolean];
  };
}

export type SplitVisibility = 'CONFIRMED' | 'INFERRED' | 'MASKED';

export interface VisibleSplit {
  geneKey: BaseLocusKey;
  label: string;
  visibility: 'CONFIRMED' | 'INFERRED';
  certaintyPct: number; // 100 for confirmed/visual-parent guaranteed, 67 for 2/3 Mendelian possible split
  reason: string;
}

export type RarityTier = 'Baseline' | 'Common Mutation' | 'Intermediate' | 'Rare' | 'Ultra-Rare';

export interface MutationMetadata {
  key: MutationKey;
  name: string;
  chromosomeLabel: string;
  inheritanceMode: string;
  visualDescription: string;
  assetFile: string;
  basePrice: number;
  rarity: RarityTier;
  rarityScore: number; // 0-100 deterministic score used in Showroom
  lineageBonusWeight: number;
  expressedLoci: BaseLocusKey[];
  isOfficialCatalogue: boolean;
  accentHex: string;
}

export interface PedigreeParentSnapshot {
  id: string;
  legBand: string;
  name: string;
  sex: Sex;
  visualPhenotype: MutationKey;
  actualSplits: BaseLocusKey[];
  displayedSplits: BaseLocusKey[];
  fatherId: string | null;
  motherId: string | null;
  originalBreederId: string;
  originalBreederName: string;
  generationDepth: number;
}
