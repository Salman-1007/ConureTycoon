import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  BreedingCageDTO,
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
  loadOwnerNamesMap,
  parseJsonArray,
  randomConureName,
  toSanitizedConureDTO,
} from './birdHelpers.js';
import { getServerClock } from './clock.js';
import { withTransaction } from './db.js';

export interface BreedingCageRow {
  id: string;
  owner_id: string;
  male_id: string;
  female_id: string;
  inbreeding_coi: number;
  coi_warning: number;
  clutch_payload: string;
  started_at: number;
  hatch_ready_at: number;
  hatched: number;
  hatched_at: number | null;
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

export function previewBreedingPair(
  db: DatabaseSync,
  ownerId: string,
  birdAId: string,
  birdBId: string,
  nowMs?: number,
): PairPreviewResponseDTO & { maleRow?: BirdRow; femaleRow?: BirdRow } {
  const effectiveNow = nowMs ?? getServerClock(db).effectiveNowMs;
  const rowA = db.prepare('SELECT * FROM birds WHERE id = ?').get(birdAId) as BirdRow | undefined;
  const rowB = db.prepare('SELECT * FROM birds WHERE id = ?').get(birdBId) as BirdRow | undefined;

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

  const birdLookup = loadAllBirdsMap(db);
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

export function startBreedingPair(
  db: DatabaseSync,
  ownerId: string,
  birdAId: string,
  birdBId: string,
  acknowledgeInbreeding = false,
): BreedingCageDTO {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  return withTransaction(db, () => {
    const preview = previewBreedingPair(db, ownerId, birdAId, birdBId, nowMs);
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

    const clutchGenotypes: BirdGenotype[] = [];
    for (let i = 0; i < clutchSize; i++) {
      clutchGenotypes.push(conceiveOffspring(maleGenotype, femaleGenotype));
    }

    const cageId = `cage_${crypto.randomUUID()}`;
    const hatchReadyAt = nowMs + BREEDING_CONFIG.INCUBATION_DURATION_MS;

    db.prepare(
      `INSERT INTO breeding_cages (
        id, owner_id, male_id, female_id, inbreeding_coi, coi_warning,
        clutch_payload, started_at, hatch_ready_at, hatched
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      cageId,
      ownerId,
      maleRow.id,
      femaleRow.id,
      preview.inbreedingCoi,
      preview.coiWarning ? 1 : 0,
      JSON.stringify(clutchGenotypes),
      nowMs,
      hatchReadyAt,
    );

    db.prepare("UPDATE birds SET status = 'BREEDING' WHERE id IN (?, ?)").run(maleRow.id, femaleRow.id);

    const birdLookup = loadAllBirdsMap(db);
    const ownerNames = loadOwnerNamesMap(db);
    const discovered = getUserDiscoveredGenes(db, ownerId);
    const updatedMale = db.prepare('SELECT * FROM birds WHERE id = ?').get(maleRow.id) as unknown as BirdRow;
    const updatedFemale = db.prepare('SELECT * FROM birds WHERE id = ?').get(femaleRow.id) as unknown as BirdRow;

    return {
      id: cageId,
      male: toSanitizedConureDTO(updatedMale, birdLookup, ownerNames, discovered, ownerId, nowMs),
      female: toSanitizedConureDTO(updatedFemale, birdLookup, ownerNames, discovered, ownerId, nowMs),
      inbreedingCoi: preview.inbreedingCoi,
      coiWarning: preview.coiWarning,
      clutchSize,
      startedAt: nowMs,
      hatchReadyAt,
      hatched: false,
    };
  });
}

export function getActiveCagesForUser(db: DatabaseSync, ownerId: string): BreedingCageDTO[] {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;
  const rows = db
    .prepare('SELECT * FROM breeding_cages WHERE owner_id = ? AND hatched = 0 ORDER BY started_at ASC')
    .all(ownerId) as unknown as BreedingCageRow[];

  if (rows.length === 0) return [];
  const birdLookup = loadAllBirdsMap(db);
  const ownerNames = loadOwnerNamesMap(db);
  const discovered = getUserDiscoveredGenes(db, ownerId);

  return rows.map((cage) => {
    const maleRow = db.prepare('SELECT * FROM birds WHERE id = ?').get(cage.male_id) as unknown as BirdRow;
    const femaleRow = db.prepare('SELECT * FROM birds WHERE id = ?').get(cage.female_id) as unknown as BirdRow;
    const clutch: BirdGenotype[] = JSON.parse(cage.clutch_payload || '[]');
    return {
      id: cage.id,
      male: toSanitizedConureDTO(maleRow, birdLookup, ownerNames, discovered, ownerId, nowMs),
      female: toSanitizedConureDTO(femaleRow, birdLookup, ownerNames, discovered, ownerId, nowMs),
      inbreedingCoi: cage.inbreeding_coi,
      coiWarning: Boolean(cage.coi_warning),
      clutchSize: clutch.length,
      startedAt: cage.started_at,
      hatchReadyAt: cage.hatch_ready_at,
      hatched: Boolean(cage.hatched),
    };
  });
}

/**
 * Resolves a hatched clutch once incubation completes.
 * Triggers Stage 6 Fog-of-War Gene Discovery + Retroactive Aviary Unmasking!
 */
export function collectHatchedClutch(db: DatabaseSync, ownerId: string, cageId: string): HatchResponseDTO {
  const clock = getServerClock(db);
  const nowMs = clock.effectiveNowMs;

  return withTransaction(db, () => {
    const cage = db.prepare('SELECT * FROM breeding_cages WHERE id = ?').get(cageId) as BreedingCageRow | undefined;
    if (!cage) {
      throw new BreedingError('Breeding cage not found.', 404);
    }
    if (cage.owner_id !== ownerId) {
      throw new BreedingError('You do not own this breeding cage.', 403);
    }
    if (cage.hatched) {
      throw new BreedingError('This clutch has already been hatched and collected.', 409);
    }
    if (nowMs < cage.hatch_ready_at) {
      const minsLeft = Math.ceil((cage.hatch_ready_at - nowMs) / 60000);
      throw new BreedingError(`Eggs are still incubating (${minsLeft} min remaining).`, 400);
    }

    const owner = db.prepare('SELECT id, display_name, xp FROM users WHERE id = ?').get(ownerId) as {
      id: string;
      display_name: string;
      xp: number;
    };
    const maleRow = db.prepare('SELECT * FROM birds WHERE id = ?').get(cage.male_id) as unknown as BirdRow;
    const femaleRow = db.prepare('SELECT * FROM birds WHERE id = ?').get(cage.female_id) as unknown as BirdRow;

    const birdLookup = loadAllBirdsMap(db);
    const clutch: BirdGenotype[] = JSON.parse(cage.clutch_payload || '[]');
    const discoveredSet = getUserDiscoveredGenes(db, ownerId);

    const chickGenDepth = Math.max(maleRow.generation_depth, femaleRow.generation_depth) + 1;
    const parentSymAvg = (maleRow.plumage_symmetry + femaleRow.plumage_symmetry) / 2;
    const coiSymPenalty = cage.inbreeding_coi * 18;

    const insertedChickIds: string[] = [];
    const newlyDiscoveredKeys: string[] = [];
    const createdNotifications: NotificationDTO[] = [];
    const primaryDiscoveryMutations: string[] = [];

    for (const zygote of clutch) {
      const chickId = `bird_${crypto.randomUUID()}`;
      assertNoPedigreeCycle(chickId, maleRow.id, femaleRow.id, birdLookup);

      const visualPhenotype = deriveVisualPhenotype(zygote);
      const actualSplits = deriveActualSplits(zygote);
      const symDelta = (Math.random() - 0.42) * 12;
      const plumageSymmetry = Math.max(62, Math.min(99.5, Number((parentSymAvg + symDelta - coiSymPenalty).toFixed(1))));

      // Check if visual mutation unlocks new gene(s) BEFORE setting displayedSplits
      const unlockKeys = getDiscoveryKeysForVisualPhenotype(visualPhenotype);
      let unlockedNewPrimary = false;
      for (const geneKey of unlockKeys) {
        if (!discoveredSet.has(geneKey)) {
          discoveredSet.add(geneKey);
          newlyDiscoveredKeys.push(geneKey);
          db.prepare('INSERT OR IGNORE INTO user_discovered_genes (user_id, gene_key, unlocked_at) VALUES (?, ?, ?)').run(
            ownerId,
            geneKey,
            nowMs,
          );
          if (geneKey === visualPhenotype || (unlockKeys.length === 1 && geneKey === unlockKeys[0])) {
            unlockedNewPrimary = true;
          }
        }
      }
      if (unlockedNewPrimary && !primaryDiscoveryMutations.includes(visualPhenotype)) {
        primaryDiscoveryMutations.push(visualPhenotype);
      }

      const initialDisplayedSplits = actualSplits.filter((g) => discoveredSet.has(g));

      const chickRow = insertBirdRecord(db, {
        id: chickId,
        name: randomConureName(),
        genotype: zygote,
        visualPhenotype,
        actualSplits,
        displayedSplits: initialDisplayedSplits,
        plumageSymmetry,
        fatherId: maleRow.id,
        motherId: femaleRow.id,
        originalBreederId: ownerId,
        originalBreederName: owner.display_name,
        currentOwnerId: ownerId,
        hatchTimestamp: nowMs,
        maturationTimestamp: nowMs + BREEDING_CONFIG.MATURATION_DURATION_MS,
        generationDepth: chickGenDepth,
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
        fatherId: maleRow.id,
        motherId: femaleRow.id,
        originalBreederId: ownerId,
        originalBreederName: owner.display_name,
        generationDepth: chickGenDepth,
        hatchTimestamp: nowMs,
      });
    }

    // Retroactive Aviary Unmasking Job across owner's existing flock (Part III.2)
    const retroactivelyRevealedBirdIds: string[] = [];
    if (newlyDiscoveredKeys.length > 0) {
      const ownerFlock = db
        .prepare('SELECT id, actual_splits, displayed_splits FROM birds WHERE current_owner_id = ?')
        .all(ownerId) as Array<{ id: string; actual_splits: string; displayed_splits: string }>;

      for (const bird of ownerFlock) {
        const actual = parseJsonArray<BaseLocusKey>(bird.actual_splits);
        const displayed = parseJsonArray<BaseLocusKey>(bird.displayed_splits);
        const additions = actual.filter((g) => discoveredSet.has(g) && !displayed.includes(g));
        if (additions.length > 0) {
          const updated = [...displayed, ...additions];
          db.prepare('UPDATE birds SET displayed_splits = ? WHERE id = ?').run(JSON.stringify(updated), bird.id);
          if (!insertedChickIds.includes(bird.id)) {
            retroactivelyRevealedBirdIds.push(bird.id);
          }
          const lookupRec = birdLookup.get(bird.id);
          if (lookupRec) lookupRec.displayedSplits = updated;
        }
      }

      // Notify player for each genomic breakthrough
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
        db.prepare(
          'INSERT INTO notifications (id, user_id, kind, title, message, read_flag, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        ).run(notifId, ownerId, 'GENOMIC_BREAKTHROUGH', title, message, nowMs);
        createdNotifications.push({
          id: notifId,
          kind: 'GENOMIC_BREAKTHROUGH',
          title,
          message,
          read: false,
          createdAt: nowMs,
        });
      }
    }

    // Release parents into post-fledge cooldown & award breeder XP
    const cooldownUntil = nowMs + BREEDING_CONFIG.BREEDING_COOLDOWN_MS;
    db.prepare("UPDATE birds SET status = 'READY', cooldown_until = ?, breed_count = breed_count + 1 WHERE id IN (?, ?)").run(
      cooldownUntil,
      maleRow.id,
      femaleRow.id,
    );
    db.prepare('UPDATE breeding_cages SET hatched = 1, hatched_at = ? WHERE id = ?').run(nowMs, cageId);
    const xpGain = clutch.length * 45 + newlyDiscoveredKeys.length * 150;
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(xpGain, ownerId);

    const ownerNames = loadOwnerNamesMap(db);
    const chicks = insertedChickIds.map((id) => {
      const row = db.prepare('SELECT * FROM birds WHERE id = ?').get(id) as unknown as BirdRow;
      return toSanitizedConureDTO(row, birdLookup, ownerNames, discoveredSet, ownerId, nowMs);
    });

    return {
      cageId,
      chicks,
      newlyDiscoveredGenes: [...new Set(newlyDiscoveredKeys)],
      retroactivelyRevealedBirdIds,
      notifications: createdNotifications,
    };
  });
}
