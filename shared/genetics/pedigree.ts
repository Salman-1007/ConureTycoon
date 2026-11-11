import { BASE_LOCUS_NAMES, getMutationMeta, normalizeGeneKey } from './catalog.js';
import type { BaseLocusKey, MutationKey, Sex, VisibleSplit } from './types.js';

export interface PedigreeBirdRecord {
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
  hatchTimestamp: number;
}

export interface PedigreeTreeNode {
  id: string;
  legBand: string;
  name: string;
  sex: Sex;
  visualPhenotype: MutationKey;
  phenotypeName: string;
  originalBreederName: string;
  generationDepth: number;
  visibleSplits: VisibleSplit[];
  father: PedigreeTreeNode | null;
  mother: PedigreeTreeNode | null;
}

export interface InbreedingAnalysis {
  coi: number; // Wright's F coefficient (0..1)
  warning: boolean; // True when F >= 0.125 or shared ancestor within 3 generations
  commonAncestorIds: string[];
  commonAncestorLabels: string[];
}

export function assertNoPedigreeCycle(
  birdId: string,
  fatherId: string | null,
  motherId: string | null,
  lookup: Map<string, Pick<PedigreeBirdRecord, 'id' | 'fatherId' | 'motherId'>>,
): void {
  if (fatherId === birdId || motherId === birdId) {
    throw new Error('Cycle detected: a bird cannot be its own parent');
  }

  const visitAncestors = (startId: string | null) => {
    if (!startId) return;
    const queue = [startId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (currentId === birdId) {
        throw new Error(`Cycle detected in pedigree: ${birdId} appears as its own ancestor`);
      }
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const node = lookup.get(currentId);
      if (node) {
        if (node.fatherId) queue.push(node.fatherId);
        if (node.motherId) queue.push(node.motherId);
      }
    }
  };

  visitAncestors(fatherId);
  visitAncestors(motherId);
}

/**
 * Computes Wright's Coefficient of Inbreeding (F) using exact kinship recurrence,
 * plus detects any common ancestors within 3 generations.
 */
export function analyzeInbreeding(
  sireId: string,
  damId: string,
  lookup: Map<string, Pick<PedigreeBirdRecord, 'id' | 'legBand' | 'name' | 'fatherId' | 'motherId' | 'generationDepth'>>,
): InbreedingAnalysis {
  const kinshipMemo = new Map<string, number>();
  const coiMemo = new Map<string, number>();

  const getCoi = (birdId: string | null, stack = new Set<string>()): number => {
    if (!birdId || stack.has(birdId)) return 0;
    if (coiMemo.has(birdId)) return coiMemo.get(birdId)!;
    const bird = lookup.get(birdId);
    if (!bird || !bird.fatherId || !bird.motherId) {
      coiMemo.set(birdId, 0);
      return 0;
    }
    stack.add(birdId);
    const val = getKinship(bird.fatherId, bird.motherId, stack);
    stack.delete(birdId);
    coiMemo.set(birdId, val);
    return val;
  };

  const getKinship = (aId: string | null, bId: string | null, stack = new Set<string>()): number => {
    if (!aId || !bId) return 0;
    if (stack.has(aId) || stack.has(bId)) return 0;
    const key = aId <= bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    if (kinshipMemo.has(key)) return kinshipMemo.get(key)!;

    if (aId === bId) {
      const val = 0.5 * (1 + getCoi(aId, stack));
      kinshipMemo.set(key, val);
      return val;
    }

    const a = lookup.get(aId);
    const b = lookup.get(bId);
    if (!a || !b) return 0;

    // Expand the deeper/younger node first (or expand whichever has parents)
    const expandA =
      a.generationDepth > b.generationDepth ||
      (a.generationDepth === b.generationDepth && Boolean(a.fatherId || a.motherId));

    let val = 0;
    if (expandA && (a.fatherId || a.motherId)) {
      stack.add(aId);
      val = 0.5 * (getKinship(a.fatherId, bId, stack) + getKinship(a.motherId, bId, stack));
      stack.delete(aId);
    } else if (b.fatherId || b.motherId) {
      stack.add(bId);
      val = 0.5 * (getKinship(aId, b.fatherId, stack) + getKinship(aId, b.motherId, stack));
      stack.delete(bId);
    }

    kinshipMemo.set(key, val);
    return val;
  };

  const collectAncestorsWithinDepth = (rootId: string, maxDepth: number): Set<string> => {
    const found = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (found.has(id)) continue;
      found.add(id);
      if (depth >= maxDepth) continue;
      const node = lookup.get(id);
      if (node?.fatherId) queue.push({ id: node.fatherId, depth: depth + 1 });
      if (node?.motherId) queue.push({ id: node.motherId, depth: depth + 1 });
    }
    return found;
  };

  const coi = Number(getKinship(sireId, damId).toFixed(4));
  const sireAncestors = collectAncestorsWithinDepth(sireId, 3);
  const damAncestors = collectAncestorsWithinDepth(damId, 3);
  const commonAncestorIds = [...sireAncestors].filter((id) => damAncestors.has(id));
  const commonAncestorLabels = commonAncestorIds.map((id) => {
    const rec = lookup.get(id);
    return rec ? `${rec.name} (${rec.legBand})` : id;
  });

  return {
    coi,
    warning: coi >= 0.125 || commonAncestorIds.length > 0,
    commonAncestorIds,
    commonAncestorLabels,
  };
}

/**
 * Computes Fog-of-War filtered visible splits for `bird` from the perspective of `viewerDiscoveredGenes`.
 * Never leaks MASKED actualSplits that have not been unlocked or proven by visual parentage.
 */
export function computeVisibleSplits(
  bird: PedigreeBirdRecord,
  father: PedigreeBirdRecord | null,
  mother: PedigreeBirdRecord | null,
  viewerDiscoveredGenes: Set<string>,
  viewerOwnsBird: boolean,
): VisibleSplit[] {
  const normalizedDiscovered = new Set([...viewerDiscoveredGenes].map((k) => normalizeGeneKey(k)));
  const visMeta = getMutationMeta(bird.visualPhenotype);
  const result = new Map<BaseLocusKey, VisibleSplit>();

  // 1. Confirmed splits (unlocked in viewer's discovery compendium or exposed in displayedSplits for this bird)
  const confirmedPool = viewerOwnsBird
    ? bird.displayedSplits.filter((g) => normalizedDiscovered.has(g))
    : bird.actualSplits.filter((g) => normalizedDiscovered.has(g));

  for (const gene of confirmedPool) {
    if (visMeta.expressedLoci.includes(gene)) continue;
    if (bird.sex === 'FEMALE' && (gene === 'CIN' || gene === 'OP')) continue;
    result.set(gene, {
      geneKey: gene,
      label: `Split ${BASE_LOCUS_NAMES[gene]}`,
      visibility: 'CONFIRMED',
      certaintyPct: 100,
      reason: 'Confirmed by aviary gene discovery & genomic ledger',
    });
  }

  // 2. Pedigree-Inferred splits (never leaking MASKED parent splits)
  const fatherMeta = father ? getMutationMeta(father.visualPhenotype) : null;
  const motherMeta = mother ? getMutationMeta(mother.visualPhenotype) : null;

  const autosomalLoci: Array<'TQ' | 'DIL'> = ['TQ', 'DIL'];
  for (const locus of autosomalLoci) {
    if (visMeta.expressedLoci.includes(locus) || result.has(locus)) continue;
    const fVisual = Boolean(fatherMeta?.expressedLoci.includes(locus));
    const mVisual = Boolean(motherMeta?.expressedLoci.includes(locus));
    if (fVisual || mVisual) {
      result.set(locus, {
        geneKey: locus,
        label: `Split ${BASE_LOCUS_NAMES[locus]}`,
        visibility: 'INFERRED',
        certaintyPct: 100,
        reason: 'Guaranteed 100% carrier from verified visual parent',
      });
      continue;
    }

    const fKnownSplit = Boolean(
      father &&
        normalizedDiscovered.has(locus) &&
        father.displayedSplits.includes(locus),
    );
    const mKnownSplit = Boolean(
      mother &&
        normalizedDiscovered.has(locus) &&
        mother.displayedSplits.includes(locus),
    );
    if (fKnownSplit && mKnownSplit) {
      result.set(locus, {
        geneKey: locus,
        label: `67% Poss. Split ${BASE_LOCUS_NAMES[locus]}`,
        visibility: 'INFERRED',
        certaintyPct: 67,
        reason: 'Offspring of two confirmed split parents (2/3 non-visual carrier odds)',
      });
    }
  }

  // Sex-linked inferred splits for MALES from visual parents
  if (bird.sex === 'MALE') {
    const zLoci: Array<'CIN' | 'OP'> = ['CIN', 'OP'];
    for (const locus of zLoci) {
      if (visMeta.expressedLoci.includes(locus) || result.has(locus)) continue;
      const fVisual = Boolean(fatherMeta?.expressedLoci.includes(locus));
      const mVisual = Boolean(motherMeta?.expressedLoci.includes(locus));
      if (fVisual || mVisual) {
        result.set(locus, {
          geneKey: locus,
          label: `Split ${BASE_LOCUS_NAMES[locus]}`,
          visibility: 'INFERRED',
          certaintyPct: 100,
          reason: mVisual
            ? 'Male offspring of visual Z-linked Dam is guaranteed 100% split'
            : 'Male offspring of visual Z-linked Sire is guaranteed 100% split',
        });
      }
    }
  }

  return [...result.values()];
}

export function buildPedigreeTree(
  rootId: string,
  lookup: Map<string, PedigreeBirdRecord>,
  viewerDiscoveredGenes: Set<string>,
  viewerId: string,
  maxDepth = 3,
  visited = new Set<string>(),
): PedigreeTreeNode | null {
  if (visited.has(rootId)) return null;
  const bird = lookup.get(rootId);
  if (!bird) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(rootId);

  const father = bird.fatherId ? lookup.get(bird.fatherId) ?? null : null;
  const mother = bird.motherId ? lookup.get(bird.motherId) ?? null : null;
  const meta = getMutationMeta(bird.visualPhenotype);

  return {
    id: bird.id,
    legBand: bird.legBand,
    name: bird.name,
    sex: bird.sex,
    visualPhenotype: bird.visualPhenotype,
    phenotypeName: meta.name,
    originalBreederName: bird.originalBreederName,
    generationDepth: bird.generationDepth,
    visibleSplits: computeVisibleSplits(
      bird,
      father,
      mother,
      viewerDiscoveredGenes,
      true,
    ),
    father:
      maxDepth > 1 && bird.fatherId
        ? buildPedigreeTree(bird.fatherId, lookup, viewerDiscoveredGenes, viewerId, maxDepth - 1, nextVisited)
        : null,
    mother:
      maxDepth > 1 && bird.motherId
        ? buildPedigreeTree(bird.motherId, lookup, viewerDiscoveredGenes, viewerId, maxDepth - 1, nextVisited)
        : null,
  };
}

export function countKnownAncestorsWithin3Gen(
  birdId: string,
  lookup: Map<string, Pick<PedigreeBirdRecord, 'id' | 'fatherId' | 'motherId'>>,
): number {
  const bird = lookup.get(birdId);
  if (!bird) return 0;

  let count = 0;
  const checkParent = (pId: string | null, depth: number) => {
    if (!pId || depth > 2) return;
    const p = lookup.get(pId);
    if (!p) return;
    count++;
    if (depth < 2) {
      checkParent(p.fatherId, depth + 1);
      checkParent(p.motherId, depth + 1);
    }
  };
  checkParent(bird.fatherId, 1);
  checkParent(bird.motherId, 1);
  return Math.min(6, count);
}
