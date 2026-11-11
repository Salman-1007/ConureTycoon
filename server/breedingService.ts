import crypto from 'node:crypto';
import type {
  BreedingCageDTO,
  FosterClutchResponseDTO,
  HatchResponseDTO,
  NotificationDTO,
  PairPreviewResponseDTO,
} from '../shared/api-types.js';
import { getMutationMeta } from '../shared/genetics/catalog.js';
import {
  conceiveOffspring,
  deriveActualSplits,
  deriveVisualPhenotype,
  getDiscoveryKeysForVisualPhenotype,
} from '../shared/genetics/engine.js';
import { analyzeInbreeding, assertNoPedigreeCycle } from '../shared/genetics/pedigree.js';
import type { BaseLocusKey, BirdGenotype } from '../shared/genetics/types.js';
import { BREEDING_CONFIG } from '../src/config/breeding.js';
import {
  type BirdRow,
  computeLifecycleStatus,
  getUserDiscoveredGenes,
  insertBirdRecord,
  loadAllBirdsMap,
  loadMutationConfigsMap,
  loadOwnerNamesMap,
  parseJsonArray,
  randomConureName,
  toSanitizedConureDTO,
} from './birdHelpers.js';
import { getServerClock } from './clock.js';
import { type AppDatabase, type DbExecutor, withTransaction } from './db.js';

export interface BreedingCageRow {
  id: string;
  owner_id: string;
  male_id: string;
  female_id: string;
  inbreeding_coi: number;
  coi_warning: number;
  clutch_payload: string;
  started_at: number;
  laid_at?: number;
  fostered_count?: number;
  hatch_ready_at: number;
  hatched: number;
  hatched_at: number | null;
}

export interface ClutchOffspringSpec {
  genotype: BirdGenotype;
  fatherId: string;
  motherId: string;
  generationDepth: number;
  parentSymmetryAvg: number;
  inbreedingCoi: number;
  hatchReadyAt: number;
}

export class BreedingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly preview?: PairPreviewResponseDTO,
  ) {
    super(message);
  }
}

async function parseClutchSpecs(cage: BreedingCageRow, db: DbExecutor): Promise<ClutchOffspringSpec[]> {
  const raw = JSON.parse(cage.clutch_payload || '[]') as Array<ClutchOffspringSpec | BirdGenotype>;
  if (raw.length === 0) return [];
  if ('genotype' in raw[0]) {
    return raw as ClutchOffspringSpec[];
  }
  const maleRow = await db.get<{ plumage_symmetry: number; generation_depth: number }>(
    'SELECT plumage_symmetry, generation_depth FROM birds WHERE id = ?',
    cage.male_id,
  );
  const femaleRow = await db.get<{ plumage_symmetry: number; generation_depth: number }>(
    'SELECT plumage_symmetry, generation_depth FROM birds WHERE id = ?',
    cage.female_id,
  );
  const symAvg = ((maleRow?.plumage_symmetry ?? 82) + (femaleRow?.plumage_symmetry ?? 82)) / 2;
  const genDepth = Math.max(maleRow?.generation_depth ?? 1, femaleRow?.generation_depth ?? 1) + 1;

  return (raw as BirdGenotype[]).map((genotype) => ({
    genotype,
    fatherId: cage.male_id,
    motherId: cage.female_id,
    generationDepth: genDepth,
    parentSymmetryAvg: symAvg,
    inbreedingCoi: cage.inbreeding_coi,
    hatchReadyAt: cage.hatch_ready_at,
  }));
}

export async function previewBreedingPair(
  db: DbExecutor,
  ownerId: string,
  birdAId: string,
  birdBId: string,
  nowMs?: number,
): Promise<PairPreviewResponseDTO & { maleRow?: BirdRow; femaleRow?: BirdRow }> {
  const effectiveNow = nowMs ?? (await getServerClock(db)).effectiveNowMs;
  const rowA = await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', birdAId);
  const rowB = await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', birdBId);

  if (!rowA || !rowB) {
    return { eligible: false, reason: 'Selected bird could not be found.', inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
  }
  if (rowA.id === rowB.id) {
    return { eligible: false, reason: 'Cannot pair a conure with itself.', inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
  }
  if (rowA.current_owner_id !== ownerId || rowB.current_owner_id !== ownerId) {
    return { eligible: false, reason: 'Both birds must belong to your aviary.', inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
  }
  if (rowA.sex === rowB.sex) {
    return { eligible: false, reason: 'Breeding requires exactly 1 verified Male (ZZ) and 1 verified Female (ZW).', inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
  }

  const maleRow = rowA.sex === 'MALE' ? rowA : rowB;
  const femaleRow = rowA.sex === 'FEMALE' ? rowA : rowB;

  for (const bird of [maleRow, femaleRow]) {
    const status = computeLifecycleStatus(bird, effectiveNow);
    if (status === 'MARKET_SYSTEM' || status === 'MARKET_P2P') {
      return { eligible: false, reason: `${bird.name} is currently listed on the marketplace.`, inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
    }
    if (status === 'JUVENILE') {
      return { eligible: false, reason: `${bird.name} is still a juvenile and must complete maturation before breeding.`, inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
    }
    if (status === 'BREEDING' || status === 'INCUBATING') {
      return { eligible: false, reason: `${bird.name} is already assigned to a breeding cage.`, inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
    }
    if (status === 'COOLDOWN') {
      return { eligible: false, reason: `${bird.name} is resting in post-fledge breeding cooldown.`, inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
    }
    if (status !== 'READY') {
      return { eligible: false, reason: `${bird.name} is not available for breeding (${status}).`, inbreedingCoi: 0, coiWarning: false, commonAncestorLabels: [] };
    }
  }

  const birdLookup = await loadAllBirdsMap(db);
  const inbreeding = analyzeInbreeding(maleRow.id, femaleRow.id, birdLookup);

  return {
    eligible: true,
    inbreedingCoi: inbreeding.coi,
    coiWarning: inbreeding.warning,
    commonAncestorLabels: inbreeding.commonAncestorLabels,
    maleRow,
    femaleRow,
  };
}

export async function startBreedingPair(
  db: AppDatabase | DbExecutor,
  ownerId: string,
  birdAId: string,
  birdBId: string,
  acknowledgeInbreeding = false,
  options?: { layDelayMsOverride?: number },
): Promise<BreedingCageDTO> {
  const clock = await getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  return withTransaction(db, async (tx) => {
    const preview = await previewBreedingPair(tx, ownerId, birdAId, birdBId, nowMs);
    if (!preview.eligible || !preview.maleRow || !preview.femaleRow) {
      throw new BreedingError(preview.reason ?? 'Pair is not eligible for breeding.', 400, preview);
    }

    if (preview.coiWarning && !acknowledgeInbreeding) {
      throw new BreedingError(
        `Inbreeding warning: COI F=${(preview.inbreedingCoi * 100).toFixed(1)}% with common ancestor(s) within 3 generations.`,
        409,
        preview,
      );
    }

    const { maleRow, femaleRow } = preview;
    const maleGenotype: BirdGenotype = JSON.parse(maleRow.chromosome_payload);
    const femaleGenotype: BirdGenotype = JSON.parse(femaleRow.chromosome_payload);

    // Roll clutch size between CLUTCH_MIN_SIZE (3) and CLUTCH_MAX_SIZE (5)
    const minSize = BREEDING_CONFIG.CLUTCH_MIN_SIZE;
    const maxSize = preview.inbreedingCoi >= 0.25 ? Math.max(minSize, BREEDING_CONFIG.CLUTCH_MAX_SIZE - 1) : BREEDING_CONFIG.CLUTCH_MAX_SIZE;
    const clutchSize = minSize + Math.floor(Math.random() * (maxSize - minSize + 1));

    // Birds lay randomly between 1-6 hours after pairing; eggs then hatch 6 hours later
    const minLay = BREEDING_CONFIG.MIN_LAY_DELAY_MS;
    const maxLay = BREEDING_CONFIG.MAX_LAY_DELAY_MS;
    const layDelayMs =
      options?.layDelayMsOverride !== undefined
        ? Math.max(0, options.layDelayMsOverride)
        : minLay + Math.floor(Math.random() * (maxLay - minLay + 1));

    const laidAt = nowMs + layDelayMs;
    const hatchReadyAt = laidAt + BREEDING_CONFIG.INCUBATION_DURATION_MS;
    const chickGenDepth = Math.max(maleRow.generation_depth, femaleRow.generation_depth) + 1;
    const parentSymAvg = (maleRow.plumage_symmetry + femaleRow.plumage_symmetry) / 2;

    const clutchSpecs: ClutchOffspringSpec[] = [];
    for (let i = 0; i < clutchSize; i++) {
      clutchSpecs.push({
        genotype: conceiveOffspring(maleGenotype, femaleGenotype),
        fatherId: maleRow.id,
        motherId: femaleRow.id,
        generationDepth: chickGenDepth,
        parentSymmetryAvg: parentSymAvg,
        inbreedingCoi: preview.inbreedingCoi,
        hatchReadyAt,
      });
    }

    const cageId = `cage_${crypto.randomUUID()}`;

    await tx.run(
      `INSERT INTO breeding_cages (
        id, owner_id, male_id, female_id, inbreeding_coi, coi_warning,
        clutch_payload, started_at, laid_at, fostered_count, hatch_ready_at, hatched
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
      cageId,
      ownerId,
      maleRow.id,
      femaleRow.id,
      preview.inbreedingCoi,
      preview.coiWarning ? 1 : 0,
      JSON.stringify(clutchSpecs),
      nowMs,
      laidAt,
      hatchReadyAt,
    );

    await tx.run("UPDATE birds SET status = 'BREEDING' WHERE id IN (?, ?)", maleRow.id, femaleRow.id);

    const birdLookup = await loadAllBirdsMap(tx);
    const ownerNames = await loadOwnerNamesMap(tx);
    const discovered = await getUserDiscoveredGenes(tx, ownerId);
    const mutationConfigs = await loadMutationConfigsMap(tx);
    const updatedMale = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', maleRow.id))!;
    const updatedFemale = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', femaleRow.id))!;

    return {
      id: cageId,
      male: toSanitizedConureDTO(updatedMale, birdLookup, ownerNames, discovered, ownerId, nowMs, false, mutationConfigs),
      female: toSanitizedConureDTO(updatedFemale, birdLookup, ownerNames, discovered, ownerId, nowMs, false, mutationConfigs),
      inbreedingCoi: preview.inbreedingCoi,
      coiWarning: preview.coiWarning,
      clutchSize,
      fosteredCount: 0,
      startedAt: nowMs,
      laidAt,
      eggsLaid: nowMs >= laidAt,
      hatchReadyAt,
      hatched: false,
    };
  });
}

export async function getActiveCagesForUser(db: DbExecutor, ownerId: string): Promise<BreedingCageDTO[]> {
  const clock = await getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const rows = await db.all<BreedingCageRow>(
    'SELECT * FROM breeding_cages WHERE owner_id = ? AND hatched = 0 ORDER BY started_at ASC',
    ownerId,
  );

  if (rows.length === 0) return [];
  const birdLookup = await loadAllBirdsMap(db);
  const ownerNames = await loadOwnerNamesMap(db);
  const discovered = await getUserDiscoveredGenes(db, ownerId);
  const mutationConfigs = await loadMutationConfigsMap(db);

  const results: BreedingCageDTO[] = [];
  for (const cage of rows) {
    const maleRow = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', cage.male_id))!;
    const femaleRow = (await db.get<BirdRow>('SELECT * FROM birds WHERE id = ?', cage.female_id))!;
    const clutch = JSON.parse(cage.clutch_payload || '[]') as unknown[];
    const laidAt = cage.laid_at && cage.laid_at > 0 ? cage.laid_at : cage.started_at;
    results.push({
      id: cage.id,
      male: toSanitizedConureDTO(maleRow, birdLookup, ownerNames, discovered, ownerId, nowMs, false, mutationConfigs),
      female: toSanitizedConureDTO(femaleRow, birdLookup, ownerNames, discovered, ownerId, nowMs, false, mutationConfigs),
      inbreedingCoi: cage.inbreeding_coi,
      coiWarning: Boolean(cage.coi_warning),
      clutchSize: clutch.length,
      fosteredCount: cage.fostered_count ?? 0,
      startedAt: cage.started_at,
      laidAt,
      eggsLaid: nowMs >= laidAt,
      hatchReadyAt: cage.hatch_ready_at,
      hatched: Boolean(cage.hatched),
    });
  }
  return results;
}

/**
 * Fosters a cage's laid eggs/chicks to another active pair's cage.
 * Immediately frees the donor parents with zero cooldown while preserving biological lineage.
 * Exceeding 5 offspring in the foster cage introduces 50/50 survival risk for extra chicks at hatch.
 */
export async function fosterClutch(
  db: AppDatabase | DbExecutor,
  ownerId: string,
  sourceCageId: string,
  targetCageId: string,
): Promise<FosterClutchResponseDTO> {
  const clock = await getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  return withTransaction(db, async (tx) => {
    if (sourceCageId === targetCageId) {
      throw new BreedingError('Select a different active pair to foster into.', 400);
    }

    const source = await tx.get<BreedingCageRow>('SELECT * FROM breeding_cages WHERE id = ?', sourceCageId);
    const target = await tx.get<BreedingCageRow>('SELECT * FROM breeding_cages WHERE id = ?', targetCageId);
    if (!source || !target) {
      throw new BreedingError('Selected breeding cage could not be found.', 404);
    }
    if (source.owner_id !== ownerId || target.owner_id !== ownerId) {
      throw new BreedingError('Both breeding cages must belong to your aviary.', 403);
    }
    if (source.hatched || target.hatched) {
      throw new BreedingError('Cannot foster from or to an already completed cage.', 409);
    }

    const sourceLaidAt = source.laid_at && source.laid_at > 0 ? source.laid_at : source.started_at;
    if (nowMs < sourceLaidAt) {
      const minsLeft = Math.ceil((sourceLaidAt - nowMs) / 60000);
      throw new BreedingError(`Eggs have not been laid yet (${minsLeft} min remaining before laying).`, 400);
    }

    const sourceSpecs = await parseClutchSpecs(source, tx);
    const targetSpecs = await parseClutchSpecs(target, tx);
    if (sourceSpecs.length === 0) {
      throw new BreedingError('Source cage has no eggs or chicks to foster.', 400);
    }

    const combinedSpecs = [...targetSpecs, ...sourceSpecs];
    const targetLaidAt = target.laid_at && target.laid_at > 0 ? target.laid_at : target.started_at;
    const nextLaidAt = Math.min(targetLaidAt, sourceLaidAt);
    const nextHatchReadyAt = Math.max(target.hatch_ready_at, source.hatch_ready_at);
    const nextFosteredCount = (target.fostered_count ?? 0) + sourceSpecs.length;

    const claimedSource = await tx.run(
      "UPDATE breeding_cages SET clutch_payload = '[]', hatched = 1, hatched_at = ? WHERE id = ? AND hatched = 0",
      nowMs,
      source.id,
    );
    if (claimedSource.changes === 0) {
      throw new BreedingError('Source cage has already been completed or fostered.', 409);
    }

    await tx.run(
      `UPDATE breeding_cages
       SET clutch_payload = ?, fostered_count = ?, laid_at = ?, hatch_ready_at = ?
       WHERE id = ?`,
      JSON.stringify(combinedSpecs),
      nextFosteredCount,
      nextLaidAt,
      nextHatchReadyAt,
      target.id,
    );

    // Free donor parents immediately with zero cooldown
    await tx.run(
      "UPDATE birds SET status = 'READY', cooldown_until = 0, breed_count = breed_count + 1 WHERE id IN (?, ?)",
      source.male_id,
      source.female_id,
    );

    const sourceMale = (await tx.get<{ name: string }>('SELECT name FROM birds WHERE id = ?', source.male_id))!;
    const sourceFemale = (await tx.get<{ name: string }>('SELECT name FROM birds WHERE id = ?', source.female_id))!;

    const extraRiskCount = Math.max(0, combinedSpecs.length - BREEDING_CONFIG.FOSTER_SAFE_MAX_CHICKS);

    const updatedTargetRow = (await tx.get<BreedingCageRow>('SELECT * FROM breeding_cages WHERE id = ?', target.id))!;
    const targetMale = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', updatedTargetRow.male_id))!;
    const targetFemale = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', updatedTargetRow.female_id))!;
    const birdLookup = await loadAllBirdsMap(tx);
    const ownerNames = await loadOwnerNamesMap(tx);
    const discovered = await getUserDiscoveredGenes(tx, ownerId);
    const mutationConfigs = await loadMutationConfigsMap(tx);

    return {
      sourceCageId: source.id,
      targetCage: {
        id: updatedTargetRow.id,
        male: toSanitizedConureDTO(targetMale, birdLookup, ownerNames, discovered, ownerId, nowMs, false, mutationConfigs),
        female: toSanitizedConureDTO(targetFemale, birdLookup, ownerNames, discovered, ownerId, nowMs, false, mutationConfigs),
        inbreedingCoi: updatedTargetRow.inbreeding_coi,
        coiWarning: Boolean(updatedTargetRow.coi_warning),
        clutchSize: combinedSpecs.length,
        fosteredCount: nextFosteredCount,
        startedAt: updatedTargetRow.started_at,
        laidAt: nextLaidAt,
        eggsLaid: nowMs >= nextLaidAt,
        hatchReadyAt: nextHatchReadyAt,
        hatched: false,
      },
      transferredCount: sourceSpecs.length,
      totalInTarget: combinedSpecs.length,
      extraRiskCount,
      freedParents: [sourceMale.name, sourceFemale.name],
    };
  });
}

/**
 * Unlocks visual genetics & splits once chicks pass the 3-hour post-hatch feather growth milestone.
 */
export async function syncAviaryChickReveals(
  db: AppDatabase | DbExecutor,
  ownerId: string,
  nowMs?: number,
): Promise<{
  newlyDiscoveredGenes: string[];
  retroactivelyRevealedBirdIds: string[];
  notifications: NotificationDTO[];
}> {
  const effectiveNow = nowMs ?? (await getServerClock(db)).effectiveNowMs;

  return withTransaction(db, async (tx) => {
    const pendingRows = await tx.all<BirdRow>(
      `SELECT * FROM birds
       WHERE current_owner_id = ? AND genetics_processed = 0 AND genetics_reveal_at <= ?
       ORDER BY hatch_timestamp ASC`,
      ownerId,
      effectiveNow,
    );

    if (pendingRows.length === 0) {
      return { newlyDiscoveredGenes: [], retroactivelyRevealedBirdIds: [], notifications: [] };
    }

    const discoveredSet = await getUserDiscoveredGenes(tx, ownerId);
    const newlyDiscoveredKeys: string[] = [];
    const primaryDiscoveryMutations: string[] = [];
    const createdNotifications: NotificationDTO[] = [];
    const revealedIds: string[] = [];

    for (const chick of pendingRows) {
      revealedIds.push(chick.id);
      const unlockKeys = getDiscoveryKeysForVisualPhenotype(chick.visual_phenotype);
      let unlockedNewPrimary = false;
      for (const geneKey of unlockKeys) {
        if (!discoveredSet.has(geneKey)) {
          discoveredSet.add(geneKey);
          newlyDiscoveredKeys.push(geneKey);
          await tx.run(
            `INSERT INTO user_discovered_genes (user_id, gene_key, unlocked_at) VALUES (?, ?, ?)
             ON CONFLICT (user_id, gene_key) DO NOTHING`,
            ownerId,
            geneKey,
            effectiveNow,
          );
          if (geneKey === chick.visual_phenotype || (unlockKeys.length === 1 && geneKey === unlockKeys[0])) {
            unlockedNewPrimary = true;
          }
        }
      }
      if (unlockedNewPrimary && !primaryDiscoveryMutations.includes(chick.visual_phenotype)) {
        primaryDiscoveryMutations.push(chick.visual_phenotype);
      }

      const actualSplits = parseJsonArray<BaseLocusKey>(chick.actual_splits);
      const displayedSplits = actualSplits.filter((g) => discoveredSet.has(g));
      await tx.run(
        'UPDATE birds SET genetics_processed = 1, displayed_splits = ? WHERE id = ?',
        JSON.stringify(displayedSplits),
        chick.id,
      );
    }

    const retroactivelyRevealedBirdIds: string[] = [];
    if (newlyDiscoveredKeys.length > 0) {
      const ownerFlock = await tx.all<{ id: string; actual_splits: string; displayed_splits: string }>(
        'SELECT id, actual_splits, displayed_splits FROM birds WHERE current_owner_id = ?',
        ownerId,
      );

      for (const bird of ownerFlock) {
        const actual = parseJsonArray<BaseLocusKey>(bird.actual_splits);
        const displayed = parseJsonArray<BaseLocusKey>(bird.displayed_splits);
        const additions = actual.filter((g) => discoveredSet.has(g) && !displayed.includes(g));
        if (additions.length > 0) {
          const updated = [...displayed, ...additions];
          await tx.run('UPDATE birds SET displayed_splits = ? WHERE id = ?', JSON.stringify(updated), bird.id);
          if (!revealedIds.includes(bird.id)) {
            retroactivelyRevealedBirdIds.push(bird.id);
          }
        }
      }

      const uniqueBreakthroughNames = [
        ...new Set(
          (primaryDiscoveryMutations.length > 0 ? primaryDiscoveryMutations : newlyDiscoveredKeys).map(
            (k) => getMutationMeta(k).name,
          ),
        ),
      ];
      for (const mutName of uniqueBreakthroughNames) {
        const notifId = `ntf_${crypto.randomUUID()}`;
        const title = `Genomic Breakthrough: ${mutName}`;
        const message = `Genomic Breakthrough: Your aviary has unlocked the ${mutName} gene! Hidden carriers across your flock are now identified.`;
        await tx.run(
          'INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
          notifId,
          ownerId,
          'GENOMIC_BREAKTHROUGH',
          title,
          message,
          effectiveNow,
        );
        createdNotifications.push({
          id: notifId,
          kind: 'GENOMIC_BREAKTHROUGH',
          title,
          message,
          read: false,
          createdAt: effectiveNow,
        });
      }

      const xpBonus = new Set(newlyDiscoveredKeys).size * 150;
      await tx.run('UPDATE users SET xp = xp + ? WHERE id = ?', xpBonus, ownerId);
    }

    return {
      newlyDiscoveredGenes: [...new Set(newlyDiscoveredKeys)],
      retroactivelyRevealedBirdIds,
      notifications: createdNotifications,
    };
  });
}

/**
 * Resolves a hatched clutch once incubation completes.
 * First 5 chicks survive 100%; extra chicks beyond 5 roll a 50/50 survival check.
 * Newly hatched chicks stay downy for 3h (genetics revealed at +3h) and become adult at +6h.
 * Parents are immediately released with zero cooldown.
 */
export async function collectHatchedClutch(
  db: AppDatabase | DbExecutor,
  ownerId: string,
  cageId: string,
  options?: { survivalRng?: () => number },
): Promise<HatchResponseDTO> {
  const clock = await getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const survivalRng = options?.survivalRng ?? Math.random;

  return withTransaction(db, async (tx) => {
    const cage = await tx.get<BreedingCageRow>('SELECT * FROM breeding_cages WHERE id = ?', cageId);
    if (!cage) {
      throw new BreedingError('Breeding cage not found.', 404);
    }
    if (cage.owner_id !== ownerId) {
      throw new BreedingError('You do not own this breeding cage.', 403);
    }
    if (cage.hatched) {
      throw new BreedingError('This clutch has already been hatched and collected.', 409);
    }
    const laidAt = cage.laid_at && cage.laid_at > 0 ? cage.laid_at : cage.started_at;
    if (nowMs < laidAt) {
      const minsLeft = Math.ceil((laidAt - nowMs) / 60000);
      throw new BreedingError(`Pair is nesting — eggs will be laid in ~${minsLeft} min.`, 400);
    }
    if (nowMs < cage.hatch_ready_at) {
      const minsLeft = Math.ceil((cage.hatch_ready_at - nowMs) / 60000);
      throw new BreedingError(`Eggs are still incubating (${minsLeft} min remaining).`, 400);
    }

    // Atomic claim before inserting chicks prevents duplicate hatches on double-submit
    const claimed = await tx.run('UPDATE breeding_cages SET hatched = 1, hatched_at = ? WHERE id = ? AND hatched = 0', nowMs, cageId);
    if (claimed.changes === 0) {
      throw new BreedingError('This clutch has already been hatched and collected.', 409);
    }

    const owner = (await tx.get<{ id: string; display_name: string; xp: number }>(
      'SELECT id, display_name, xp FROM users WHERE id = ?',
      ownerId,
    ))!;
    const maleRow = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', cage.male_id))!;
    const femaleRow = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', cage.female_id))!;

    const birdLookup = await loadAllBirdsMap(tx);
    const clutchSpecs = await parseClutchSpecs(cage, tx);
    const discoveredSet = await getUserDiscoveredGenes(tx, ownerId);

    // First 5 chicks survive safely; any extra chicks beyond 5 have a 50/50 survival chance
    const safeLimit = BREEDING_CONFIG.FOSTER_SAFE_MAX_CHICKS;
    const survivingSpecs: ClutchOffspringSpec[] = [];
    for (let i = 0; i < clutchSpecs.length; i++) {
      if (i < safeLimit) {
        survivingSpecs.push(clutchSpecs[i]);
      } else if (survivalRng() < BREEDING_CONFIG.FOSTER_OVER_LIMIT_SURVIVAL_CHANCE) {
        survivingSpecs.push(clutchSpecs[i]);
      }
    }

    const fosterLostCount = clutchSpecs.length - survivingSpecs.length;
    const isOvercrowded = clutchSpecs.length > safeLimit;

    const insertedChickIds: string[] = [];
    const createdNotifications: NotificationDTO[] = [];
    const geneticsRevealAt = nowMs + BREEDING_CONFIG.CHICK_GENETICS_REVEAL_MS;
    const maturationAt = nowMs + BREEDING_CONFIG.MATURATION_DURATION_MS;

    for (const spec of survivingSpecs) {
      const chickId = `bird_${crypto.randomUUID()}`;
      assertNoPedigreeCycle(chickId, spec.fatherId, spec.motherId, birdLookup);

      const visualPhenotype = deriveVisualPhenotype(spec.genotype);
      const actualSplits = deriveActualSplits(spec.genotype);
      const coiSymPenalty = spec.inbreedingCoi * 18;
      const symDelta = (Math.random() - 0.42) * 12;
      const plumageSymmetry = Math.max(62, Math.min(99.5, Number((spec.parentSymmetryAvg + symDelta - coiSymPenalty).toFixed(1))));
      const initialDisplayedSplits = actualSplits.filter((g) => discoveredSet.has(g));

      const chickRow = await insertBirdRecord(tx, {
        id: chickId,
        name: randomConureName(),
        genotype: spec.genotype,
        visualPhenotype,
        actualSplits,
        displayedSplits: initialDisplayedSplits,
        plumageSymmetry,
        fatherId: spec.fatherId,
        motherId: spec.motherId,
        originalBreederId: ownerId,
        originalBreederName: owner.display_name,
        currentOwnerId: ownerId,
        hatchTimestamp: nowMs,
        geneticsRevealTimestamp: geneticsRevealAt,
        geneticsProcessed: false,
        maturationTimestamp: maturationAt,
        generationDepth: spec.generationDepth,
        status: 'READY',
      });

      insertedChickIds.push(chickRow.id);
      birdLookup.set(chickRow.id, {
        id: chickRow.id,
        legBand: chickRow.leg_band,
        name: chickRow.name,
        sex: chickRow.sex,
        visualPhenotype: chickRow.visual_phenotype,
        actualSplits,
        displayedSplits: initialDisplayedSplits,
        fatherId: spec.fatherId,
        motherId: spec.motherId,
        originalBreederId: ownerId,
        originalBreederName: owner.display_name,
        generationDepth: spec.generationDepth,
        hatchTimestamp: nowMs,
      });
    }

    if (isOvercrowded) {
      const notifId = `ntf_${crypto.randomUUID()}`;
      const title = fosterLostCount > 0 ? 'Foster Overcrowding Loss' : 'Overcrowded Foster Success!';
      const message =
        fosterLostCount > 0
          ? `${maleRow.name} & ${femaleRow.name} hatched ${survivingSpecs.length} of ${clutchSpecs.length} chicks (${clutchSpecs.length - safeLimit} above the 5-chick safe limit; ${fosterLostCount} did not survive).`
          : `${maleRow.name} & ${femaleRow.name} beat the odds and raised all ${survivingSpecs.length} chicks in an overcrowded nest!`;
      await tx.run(
        'INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        notifId,
        ownerId,
        'FOSTER_OUTCOME',
        title,
        message,
        nowMs,
      );
      createdNotifications.push({
        id: notifId,
        kind: 'FOSTER_OUTCOME',
        title,
        message,
        read: false,
        createdAt: nowMs,
      });
    }

    // Release parents immediately with zero cooldown & award breeder XP
    await tx.run(
      "UPDATE birds SET status = 'READY', cooldown_until = 0, breed_count = breed_count + 1 WHERE id IN (?, ?)",
      maleRow.id,
      femaleRow.id,
    );
    const xpGain = survivingSpecs.length * 45;
    await tx.run('UPDATE users SET xp = xp + ? WHERE id = ?', xpGain, ownerId);

    const ownerNames = await loadOwnerNamesMap(tx);
    const mutationConfigs = await loadMutationConfigsMap(tx);
    const chicks = [];
    for (const id of insertedChickIds) {
      const row = (await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', id))!;
      chicks.push(toSanitizedConureDTO(row, birdLookup, ownerNames, discoveredSet, ownerId, nowMs, false, mutationConfigs));
    }

    return {
      cageId,
      chicks,
      newlyDiscoveredGenes: [],
      retroactivelyRevealedBirdIds: [],
      notifications: createdNotifications,
      ...(isOvercrowded ? { fosterOverloadTotal: clutchSpecs.length, fosterLostCount } : {}),
    };
  });
}
