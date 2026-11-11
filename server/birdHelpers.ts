import crypto from 'node:crypto';
import type { BirdLifecycleStatus, ConureDTO } from '../shared/api-types.js';
import { getMutationMeta, normalizeGeneKey } from '../shared/genetics/catalog.js';
import { computeVisibleSplits, type PedigreeBirdRecord } from '../shared/genetics/pedigree.js';
import type { BaseLocusKey, BirdGenotype, MutationKey, Sex } from '../shared/genetics/types.js';
import type { DbExecutor } from './db.js';

export const PLAYER_LEVELS = [
  { level: 1, title: 'Hatchling Keeper', xpRequired: 0 },
  { level: 2, title: 'Canopy Fancier', xpRequired: 500 },
  { level: 3, title: 'Aviculturist', xpRequired: 1700 },
  { level: 4, title: 'Mutation Specialist', xpRequired: 4200 },
  { level: 5, title: 'Line Breeder', xpRequired: 7500 },
  { level: 6, title: 'Master Aviculturist', xpRequired: 12000 },
  { level: 7, title: 'Grand Curator', xpRequired: 20000 },
  { level: 8, title: 'Conure Tycoon Legend', xpRequired: 35000 },
];

export function getLevelInfo(xp: number) {
  const current = [...PLAYER_LEVELS].reverse().find((l) => xp >= l.xpRequired) ?? PLAYER_LEVELS[0];
  const next = PLAYER_LEVELS.find((l) => l.xpRequired > current.xpRequired) ?? current;
  return { current, next };
}

export interface BirdRow {
  id: string;
  leg_band: string;
  name: string;
  sex: Sex;
  visual_phenotype: MutationKey;
  chromosome_payload: string;
  actual_splits: string;
  displayed_splits: string;
  plumage_symmetry: number;
  father_id: string | null;
  mother_id: string | null;
  original_breeder_id: string;
  original_breeder_name: string;
  current_owner_id: string | null;
  hatch_timestamp: number;
  genetics_reveal_at?: number;
  genetics_processed?: number;
  maturation_timestamp: number;
  cooldown_until: number;
  generation_depth: number;
  breed_count: number;
  status: string;
}

export const CONURE_NAMES = [
  'Emerald',
  'Kiwi',
  'Mango',
  'Mochi',
  'Zuzu',
  'Rio',
  'Saffron',
  'Pebble',
  'Clover',
  'Tango',
  'Juniper',
  'Bramble',
  'Pippin',
  'Nori',
  'Zephyr',
  'Coral',
  'Skye',
  'Solstice',
  'Lumi',
  'Calypso',
];

export function randomConureName(): string {
  return CONURE_NAMES[Math.floor(Math.random() * CONURE_NAMES.length)];
}

export function parseJsonArray<T = string>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function generateUniqueLegBand(db: DbExecutor, nowMs: number): Promise<string> {
  const year = new Date(nowMs).getUTCFullYear();
  for (let i = 0; i < 16; i++) {
    const code = crypto.randomBytes(2).toString('hex').toUpperCase();
    const band = `GCC-${year}-${code}`;
    const exists = await db.get('SELECT 1 FROM birds WHERE leg_band = ?', band);
    if (!exists) return band;
  }
  return `GCC-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function computeSanctuaryValue(row: Pick<BirdRow, 'visual_phenotype' | 'plumage_symmetry' | 'generation_depth'>): number {
  const meta = getMutationMeta(row.visual_phenotype);
  return Math.round((meta.basePrice * 0.65 + row.plumage_symmetry * 4 + (row.generation_depth - 1) * 150) / 50) * 50;
}

export function computeLifecycleStatus(row: BirdRow, nowMs: number): BirdLifecycleStatus {
  if (row.status === 'MARKET_SYSTEM' || row.status === 'MARKET_P2P' || row.status === 'SANCTUARY') {
    return row.status;
  }
  if (row.status === 'BREEDING' || row.status === 'INCUBATING') {
    return row.status;
  }
  if (nowMs < row.maturation_timestamp) {
    return 'JUVENILE';
  }
  if (nowMs < row.cooldown_until) {
    return 'COOLDOWN';
  }
  return 'READY';
}

export async function getUserDiscoveredGenes(db: DbExecutor, userId: string): Promise<Set<string>> {
  const rows = await db.all<{ gene_key: string }>('SELECT gene_key FROM user_discovered_genes WHERE user_id = ?', userId);
  return new Set(rows.map((r) => normalizeGeneKey(r.gene_key)));
}

export function toPedigreeRecord(row: BirdRow): PedigreeBirdRecord {
  return {
    id: row.id,
    legBand: row.leg_band,
    name: row.name,
    sex: row.sex,
    visualPhenotype: row.visual_phenotype,
    actualSplits: parseJsonArray<BaseLocusKey>(row.actual_splits),
    displayedSplits: parseJsonArray<BaseLocusKey>(row.displayed_splits),
    fatherId: row.father_id,
    motherId: row.mother_id,
    originalBreederId: row.original_breeder_id,
    originalBreederName: row.original_breeder_name,
    generationDepth: row.generation_depth,
    hatchTimestamp: row.hatch_timestamp,
  };
}

export async function loadAllBirdsMap(db: DbExecutor): Promise<Map<string, PedigreeBirdRecord>> {
  const rows = await db.all<BirdRow>('SELECT * FROM birds');
  return new Map(rows.map((r) => [r.id, toPedigreeRecord(r)]));
}

export async function loadOwnerNamesMap(db: DbExecutor): Promise<Map<string, string>> {
  const rows = await db.all<{ id: string; display_name: string }>('SELECT id, display_name FROM users');
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

export interface MutationConfigRow {
  mutation_key: string;
  name: string;
  chromosome_label: string;
  inheritance_mode: string;
  visual_description: string;
  image_url: string | null;
  base_price: number;
  rarity: string;
  rarity_score: number;
  accent_hex: string;
  base_phenotype: string;
  is_custom: number;
  updated_at: number;
}

export async function loadMutationConfigsMap(db: DbExecutor): Promise<Map<string, MutationConfigRow>> {
  const rows = await db.all<MutationConfigRow>('SELECT * FROM mutation_configs');
  return new Map(rows.map((r) => [r.mutation_key, r]));
}

export function resolveMutationAssetUrl(
  mutationKey: string,
  override?: MutationConfigRow,
): string {
  if (override?.image_url && override.image_url.trim().length > 0) {
    return override.image_url.trim();
  }
  const meta = getMutationMeta(mutationKey);
  return `/assets/conures/${meta.assetFile}`;
}

export function toSanitizedConureDTO(
  row: BirdRow,
  birdLookup: Map<string, PedigreeBirdRecord>,
  ownerNames: Map<string, string>,
  viewerDiscoveredGenes: Set<string>,
  viewerId: string | null,
  nowMs: number,
  maskAllSplits = false,
  mutationConfigs?: Map<string, MutationConfigRow>,
): ConureDTO {
  const meta = getMutationMeta(row.visual_phenotype);
  const override = mutationConfigs?.get(row.visual_phenotype);
  const record = birdLookup.get(row.id) ?? toPedigreeRecord(row);
  const father = row.father_id ? birdLookup.get(row.father_id) ?? null : null;
  const mother = row.mother_id ? birdLookup.get(row.mother_id) ?? null : null;

  const revealAt = row.genetics_reveal_at ?? 0;
  const geneticsRevealed = revealAt <= 0 || nowMs >= revealAt;

  const visibleSplits =
    maskAllSplits || !geneticsRevealed
      ? []
      : computeVisibleSplits(
          record,
          father,
          mother,
          viewerDiscoveredGenes,
          Boolean(viewerId && row.current_owner_id === viewerId),
        );

  return {
    id: row.id,
    legBand: row.leg_band,
    name: row.name,
    sex: row.sex,
    visualPhenotype: geneticsRevealed ? row.visual_phenotype : 'WT',
    phenotypeName: geneticsRevealed ? override?.name || meta.name : 'Downy Chick (Genetics Developing)',
    rarity: geneticsRevealed ? override?.rarity || meta.rarity : 'Downy Chick',
    assetUrl: geneticsRevealed
      ? resolveMutationAssetUrl(row.visual_phenotype, override)
      : '/assets/conures/chick_downy.svg',
    accentHex: geneticsRevealed ? override?.accent_hex || meta.accentHex : '#D8C79D',
    visibleSplits,
    plumageSymmetry: Number(row.plumage_symmetry.toFixed(1)),
    fatherId: row.father_id,
    motherId: row.mother_id,
    originalBreederId: row.original_breeder_id,
    originalBreederName: row.original_breeder_name,
    currentOwnerId: row.current_owner_id,
    currentOwnerName: row.current_owner_id ? ownerNames.get(row.current_owner_id) ?? null : null,
    hatchTimestamp: row.hatch_timestamp,
    geneticsRevealTimestamp: revealAt,
    geneticsRevealed,
    maturationTimestamp: row.maturation_timestamp,
    cooldownUntil: row.cooldown_until,
    generationDepth: row.generation_depth,
    breedCount: row.breed_count,
    lifecycleStatus: computeLifecycleStatus(row, nowMs),
    sanctuaryValue: computeSanctuaryValue(row),
  };
}

export async function insertBirdRecord(
  db: DbExecutor,
  params: {
    id?: string;
    name: string;
    genotype: BirdGenotype;
    visualPhenotype: MutationKey;
    actualSplits: BaseLocusKey[];
    displayedSplits: BaseLocusKey[];
    plumageSymmetry: number;
    fatherId: string | null;
    motherId: string | null;
    originalBreederId: string;
    originalBreederName: string;
    currentOwnerId: string | null;
    hatchTimestamp: number;
    geneticsRevealTimestamp?: number;
    geneticsProcessed?: boolean;
    maturationTimestamp: number;
    generationDepth: number;
    status: BirdRow['status'];
  },
): Promise<BirdRow> {
  const id = params.id ?? `bird_${crypto.randomUUID()}`;
  const legBand = await generateUniqueLegBand(db, params.hatchTimestamp);
  const geneticsReveal = params.geneticsRevealTimestamp ?? 0;
  const geneticsProcessed = params.geneticsProcessed !== undefined ? (params.geneticsProcessed ? 1 : 0) : geneticsReveal <= 0 ? 1 : 0;

  await db.run(
    `INSERT INTO birds (
      id, leg_band, name, sex, visual_phenotype, chromosome_payload,
      actual_splits, displayed_splits, plumage_symmetry,
      father_id, mother_id, original_breeder_id, original_breeder_name,
      current_owner_id, hatch_timestamp, genetics_reveal_at, genetics_processed, maturation_timestamp,
      cooldown_until, generation_depth, breed_count, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
    id,
    legBand,
    params.name,
    params.genotype.sex,
    params.visualPhenotype,
    JSON.stringify(params.genotype),
    JSON.stringify(params.actualSplits),
    JSON.stringify(params.displayedSplits),
    params.plumageSymmetry,
    params.fatherId,
    params.motherId,
    params.originalBreederId,
    params.originalBreederName,
    params.currentOwnerId,
    params.hatchTimestamp,
    geneticsReveal,
    geneticsProcessed,
    params.maturationTimestamp,
    params.generationDepth,
    params.status,
  );

  return (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', id))!;
}
