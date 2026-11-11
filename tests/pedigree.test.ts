import { describe, expect, it } from 'vitest';
import {
  adaptLegacyPigeonToConure,
  adaptLegacyPlayerToAviaryProfile,
} from '../shared/compatibility_shim.js';
import {
  analyzeInbreeding,
  assertNoPedigreeCycle,
  buildPedigreeTree,
  computeVisibleSplits,
  type PedigreeBirdRecord,
} from '../shared/genetics/pedigree.js';
import {
  calculateShowScore,
  isEligibleForShowCategory,
} from '../shared/genetics/showroom.js';

function makeBird(
  id: string,
  sex: 'MALE' | 'FEMALE',
  visualPhenotype: PedigreeBirdRecord['visualPhenotype'] = 'WT',
  fatherId: string | null = null,
  motherId: string | null = null,
  generationDepth = 1,
  actualSplits: PedigreeBirdRecord['actualSplits'] = [],
  displayedSplits: PedigreeBirdRecord['displayedSplits'] = [],
): PedigreeBirdRecord {
  return {
    id,
    legBand: `GCC-2026-${id.toUpperCase()}`,
    name: id,
    sex,
    visualPhenotype,
    actualSplits,
    displayedSplits,
    fatherId,
    motherId,
    originalBreederId: 'user-1',
    originalBreederName: 'Canopy Breeder',
    generationDepth,
    hatchTimestamp: 1700000000000,
  };
}

describe('Pedigree, Inbreeding, Fog-of-War & Compatibility Shim', () => {
  it('detects full-sibling (F = 0.25) and half-sibling (F = 0.125) inbreeding warnings', () => {
    const f = makeBird('f', 'MALE');
    const m1 = makeBird('m1', 'FEMALE');
    const m2 = makeBird('m2', 'FEMALE');
    const s1 = makeBird('s1', 'MALE', 'WT', 'f', 'm1', 2);
    const s2 = makeBird('s2', 'FEMALE', 'WT', 'f', 'm1', 2);
    const halfSis = makeBird('hs', 'FEMALE', 'WT', 'f', 'm2', 2);
    const unrelated = makeBird('u', 'FEMALE');

    const map = new Map([f, m1, m2, s1, s2, halfSis, unrelated].map((b) => [b.id, b]));

    const fullSib = analyzeInbreeding('s1', 's2', map);
    expect(fullSib.coi).toBeCloseTo(0.25, 3);
    expect(fullSib.warning).toBe(true);

    const halfSib = analyzeInbreeding('s1', 'hs', map);
    expect(halfSib.coi).toBeCloseTo(0.125, 3);
    expect(halfSib.warning).toBe(true);

    const outcross = analyzeInbreeding('s1', 'u', map);
    expect(outcross.coi).toBe(0);
    expect(outcross.warning).toBe(false);
  });

  it('prevents pedigree cycles cleanly', () => {
    const a = makeBird('a', 'MALE', 'WT', 'b', null, 2);
    const b = makeBird('b', 'MALE', 'WT', null, null, 1);
    const map = new Map([a, b].map((x) => [x.id, x]));

    expect(() => assertNoPedigreeCycle('a', 'a', null, map)).toThrow();
    expect(() => assertNoPedigreeCycle('b', 'a', null, map)).toThrow();
  });

  it('masks undiscovered splits while showing INFERRED 100% and 67% possible splits only from known parentage', () => {
    const tqDad = makeBird('dad', 'MALE', 'TQ');
    const wtMom = makeBird('mom', 'FEMALE', 'WT', null, null, 1, ['TQ'], []);
    const childFromVisual = makeBird('c1', 'FEMALE', 'WT', 'dad', 'mom', 2, ['TQ'], []);

    const wtSplitMomKnown = makeBird('mom2', 'FEMALE', 'WT', null, null, 1, ['TQ'], ['TQ']);
    const wtSplitDadKnown = makeBird('dad2', 'MALE', 'WT', null, null, 1, ['TQ'], ['TQ']);
    const childFromTwoSplits = makeBird('c2', 'MALE', 'WT', 'dad2', 'mom2', 2, ['TQ'], []);

    // Viewer only knows WT: childFromVisual gets 100% inferred split because dad is visually TQ!
    const splitsVisualParent = computeVisibleSplits(childFromVisual, tqDad, wtMom, new Set(['WT']), true);
    expect(splitsVisualParent.some((s) => s.geneKey === 'TQ' && s.visibility === 'INFERRED' && s.certaintyPct === 100)).toBe(true);

    // Undiscovered TQ: childFromTwoSplits does NOT leak parent masked/ununlocked splits
    const maskedSplits = computeVisibleSplits(childFromTwoSplits, wtSplitDadKnown, wtSplitMomKnown, new Set(['WT']), true);
    expect(maskedSplits).toEqual([]);

    // Once TQ is discovered in compendium and parents are known splits, child shows 67% Possible Split
    const possSplits = computeVisibleSplits(childFromTwoSplits, wtSplitDadKnown, wtSplitMomKnown, new Set(['WT', 'TQ']), true);
    expect(possSplits.some((s) => s.geneKey === 'TQ' && s.visibility === 'INFERRED' && s.certaintyPct === 67)).toBe(true);
  });

  it('builds a 3-generation pedigree tree safely', () => {
    const gf = makeBird('gf', 'MALE', 'TQ');
    const gm = makeBird('gm', 'FEMALE', 'WT');
    const f = makeBird('f', 'MALE', 'WT', 'gf', 'gm', 2);
    const m = makeBird('m', 'FEMALE', 'CIN', null, null, 1);
    const subj = makeBird('subj', 'MALE', 'WT', 'f', 'm', 3);
    const map = new Map([gf, gm, f, m, subj].map((x) => [x.id, x]));

    const tree = buildPedigreeTree('subj', map, new Set(['WT', 'TQ', 'CIN']), 'user-1', 3);
    expect(tree?.father?.father?.id).toBe('gf');
    expect(tree?.mother?.id).toBe('m');
    expect(tree?.visibleSplits.some((s) => s.geneKey === 'CIN' && s.certaintyPct === 100)).toBe(true);
  });

  it('adapts legacy Pigeon and Player records via compatibility_shim', () => {
    const conure = adaptLegacyPigeonToConure(
      {
        id: 'pigeon_123',
        name: 'Rustam',
        breed: 'Salar',
        gender: 'male',
        age: 2,
        generation: 3,
        isHomeBred: true,
        stamina: 85,
        flyHeight: 82,
        homeReturn: 88,
        agility: 80,
        heatResistance: 84,
        overallRating: 84,
      },
      'user-1',
      'Irfan',
    );
    expect(conure.visualPhenotype).toBe('TQ');
    expect(conure.sex).toBe('MALE');
    expect(conure.legBand).toMatch(/^GCC-\d{4}-/);

    const profile = adaptLegacyPlayerToAviaryProfile({
      name: 'Irfan',
      loftName: 'Sialkot da Sher Loft',
      money: 12000,
      level: 2,
      xp: 600,
      totalCompetitions: 4,
      totalWins: 2,
      bestScore: 30,
      totalMoneyEarned: 15000,
      joinedAt: 1700000000000,
      marketSpent: 4000,
    });
    expect(profile.aviaryName).toContain('Aviary');
    expect(profile.coins).toBe(12000);
  });

  it('computes deterministic showroom score and validates category eligibility', () => {
    const score = calculateShowScore({
      plumageSymmetry: 90,
      visualPhenotype: 'MOONCHK',
      generationDepth: 4,
      knownAncestorsCount: 6,
      inbreedingCoi: 0,
    });
    expect(score.totalScore).toBeCloseTo(90 * 0.3 + 100 * 0.4 + 96 * 0.3, 1);

    expect(
      isEligibleForShowCategory('MASTER_PEDIGREE', {
        visualPhenotype: 'WT',
        generationDepth: 1,
        fatherId: null,
        motherId: null,
        isMature: true,
      }).eligible,
    ).toBe(false);
  });
});
