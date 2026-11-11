import { describe, expect, it } from 'vitest';
import {
  conceiveOffspring,
  createGenotypeForMutation,
  deriveActualSplits,
  deriveVisualPhenotype,
  getDiscoveryKeysForVisualPhenotype,
} from '../shared/genetics/engine.js';
import type { BirdGenotype } from '../shared/genetics/types.js';

describe('Green Cheek Conure Genetics Engine (Stage 2)', () => {
  it('enforces sex-linked dominance/hemizygosity: females express Z mutations immediately and are never Z-split', () => {
    const cinFemale = createGenotypeForMutation('CIN', 'FEMALE');
    expect(deriveVisualPhenotype(cinFemale)).toBe('CIN');
    expect(deriveActualSplits(cinFemale)).toEqual([]);

    // Trying to assign sex-linked split to a female has no effect on splits
    const wtFemale = createGenotypeForMutation('WT', 'FEMALE', ['CIN', 'OP', 'TQ']);
    expect(deriveVisualPhenotype(wtFemale)).toBe('WT');
    expect(deriveActualSplits(wtFemale)).toEqual(['TQ']);
  });

  it('produces sex-linked 100% Cinnamon daughters and 100% split-Cinnamon sons from Cinnamon Male x Normal Female', () => {
    const cinMale = createGenotypeForMutation('CIN', 'MALE');
    const wtFemale = createGenotypeForMutation('WT', 'FEMALE');

    let males = 0;
    let females = 0;
    for (let i = 0; i < 400; i++) {
      const chick = conceiveOffspring(cinMale, wtFemale);
      const pheno = deriveVisualPhenotype(chick);
      const splits = deriveActualSplits(chick);
      if (chick.sex === 'FEMALE') {
        females++;
        expect(pheno).toBe('CIN');
        expect(splits).toEqual([]);
      } else {
        males++;
        expect(pheno).toBe('WT');
        expect(splits).toEqual(['CIN']);
      }
    }
    expect(males).toBeGreaterThan(140);
    expect(females).toBeGreaterThan(140);
  });

  it('produces 100% Pineapple offspring when Pineapple Male breeds with Pineapple Female', () => {
    const pineMale = createGenotypeForMutation('PINE', 'MALE');
    const pineFemale = createGenotypeForMutation('PINE', 'FEMALE');

    for (let i = 0; i < 100; i++) {
      const chick = conceiveOffspring(pineMale, pineFemale);
      expect(deriveVisualPhenotype(chick)).toBe('PINE');
      expect(deriveActualSplits(chick)).toEqual([]);
    }
  });

  it('validates cis (coupling) vs trans (repulsion) Z-chromosome crossover rate r = 0.25', () => {
    // Coupling (Cis) male: Z^{cin,op} / Z^{+,+} crossed with Normal Female (ZW)
    // Daughters receive W from dam, so their phenotype directly reveals sire's Z gamete!
    const cisMale: BirdGenotype = {
      sex: 'MALE',
      zChromosomes: [
        { cinnamon: true, opaline: true },
        { cinnamon: false, opaline: false },
      ],
      autosomalLoci: { turquoise: [false, false], dilute: [false, false] },
    };
    const wtFemale = createGenotypeForMutation('WT', 'FEMALE');

    let daughterTotal = 0;
    let recombinantDaughters = 0; // CIN or OP alone
    for (let i = 0; i < 4000; i++) {
      const chick = conceiveOffspring(cisMale, wtFemale);
      if (chick.sex === 'FEMALE') {
        daughterTotal++;
        const pheno = deriveVisualPhenotype(chick);
        if (pheno === 'CIN' || pheno === 'OP') recombinantDaughters++;
      }
    }
    const observedRate = recombinantDaughters / daughterTotal;
    expect(observedRate).toBeGreaterThan(0.2);
    expect(observedRate).toBeLessThan(0.3);

    // Repulsion (Trans) male: Z^{cin,+} / Z^{+,op} crossed with Normal Female (ZW)
    // Recombinant daughters are WT or PINE!
    const transMale: BirdGenotype = {
      sex: 'MALE',
      zChromosomes: [
        { cinnamon: true, opaline: false },
        { cinnamon: false, opaline: true },
      ],
      autosomalLoci: { turquoise: [false, false], dilute: [false, false] },
    };
    let transDaughters = 0;
    let transRecombinants = 0;
    for (let i = 0; i < 4000; i++) {
      const chick = conceiveOffspring(transMale, wtFemale);
      if (chick.sex === 'FEMALE') {
        transDaughters++;
        const pheno = deriveVisualPhenotype(chick);
        if (pheno === 'WT' || pheno === 'PINE') transRecombinants++;
      }
    }
    const observedTransRate = transRecombinants / transDaughters;
    expect(observedTransRate).toBeGreaterThan(0.2);
    expect(observedTransRate).toBeLessThan(0.3);
  });

  it('derives all 12 official visual phenotypes accurately from homozygous/hemizygous alleles', () => {
    const expected: Array<Parameters<typeof createGenotypeForMutation>[0]> = [
      'WT',
      'CIN',
      'OP',
      'PINE',
      'TQ',
      'DIL',
      'TQ_CIN',
      'TQ_YS',
      'TQ_PINE',
      'MINT',
      'SUNCHK',
      'MOONCHK',
    ];
    for (const key of expected) {
      for (const sex of ['MALE', 'FEMALE'] as const) {
        const g = createGenotypeForMutation(key, sex);
        expect(deriveVisualPhenotype(g)).toBe(key);
        expect(deriveActualSplits(g)).toEqual([]);
      }
    }
  });

  it('produces Mooncheek (4-way combo) and verifies 1,000-clutch multi-locus Mendelian proportions', () => {
    // Double-het Mooncheek cross: Turquoise Pineapple /dil male x Mooncheek female
    const sire = createGenotypeForMutation('TQ_PINE', 'MALE', ['DIL']);
    const dam = createGenotypeForMutation('MOONCHK', 'FEMALE');

    let totalChicks = 0;
    let mooncheekCount = 0;
    let tqPineCount = 0;

    // 1,000 simulated clutches (~4 chicks/clutch = ~4,000 chicks)
    for (let c = 0; c < 1000; c++) {
      const clutchSize = 4;
      for (let i = 0; i < clutchSize; i++) {
        totalChicks++;
        const chick = conceiveOffspring(sire, dam);
        const pheno = deriveVisualPhenotype(chick);
        if (pheno === 'MOONCHK') mooncheekCount++;
        if (pheno === 'TQ_PINE') tqPineCount++;
      }
    }
    // Since sire is /dil and dam is dil/dil, 50% of offspring are DIL -> 50% MOONCHK, 50% TQ_PINE
    const mooncheekRatio = mooncheekCount / totalChicks;
    expect(mooncheekCount + tqPineCount).toBe(totalChicks);
    expect(mooncheekRatio).toBeGreaterThan(0.45);
    expect(mooncheekRatio).toBeLessThan(0.55);
  });

  it('unlocks underlying base loci and combo keys when discovering a multi-locus mutation', () => {
    const keys = getDiscoveryKeysForVisualPhenotype('MOONCHK');
    expect(keys).toContain('TQ');
    expect(keys).toContain('DIL');
    expect(keys).toContain('CIN');
    expect(keys).toContain('OP');
    expect(keys).toContain('MOONCHK');
    expect(keys).toContain('MINT');
    expect(keys).toContain('SUNCHK');
  });
});
