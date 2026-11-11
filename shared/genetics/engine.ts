import { RECOMBINATION_CROSSOVER_RATE, getMutationMeta } from './catalog.js';
import type {
  BaseLocusKey,
  BirdGenotype,
  Gamete,
  MutationKey,
  OfficialMutationKey,
  Sex,
  ZChromosomeGenes,
} from './types.js';

export type RandomFn = () => number;

export function assertValidGenotype(genotype: BirdGenotype): void {
  if (genotype.sex === 'MALE' && (!genotype.zChromosomes[0] || !genotype.zChromosomes[1])) {
    throw new Error('Male genotype (ZZ) must contain two Z chromosomes');
  }
  if (genotype.sex === 'FEMALE' && !genotype.zChromosomes[0]) {
    throw new Error('Female genotype (ZW) must contain one Z chromosome');
  }
}

export function isZVisual(genotype: BirdGenotype, trait: 'cinnamon' | 'opaline'): boolean {
  assertValidGenotype(genotype);
  if (genotype.sex === 'FEMALE') {
    return genotype.zChromosomes[0][trait];
  }
  return Boolean(genotype.zChromosomes[0][trait] && genotype.zChromosomes[1]![trait]);
}

export function isAutosomalVisual(genotype: BirdGenotype, locus: 'turquoise' | 'dilute'): boolean {
  const [a, b] = genotype.autosomalLoci[locus];
  return a && b;
}

export function deriveVisualPhenotype(genotype: BirdGenotype): MutationKey {
  const tq = isAutosomalVisual(genotype, 'turquoise');
  const dil = isAutosomalVisual(genotype, 'dilute');
  const cin = isZVisual(genotype, 'cinnamon');
  const op = isZVisual(genotype, 'opaline');

  if (tq && dil && cin && op) return 'MOONCHK';
  if (!tq && dil && cin && op) return 'SUNCHK';
  if (tq && dil && !cin && !op) return 'MINT';
  if (tq && dil && cin && !op) return 'MINT_CIN';
  if (tq && dil && !cin && op) return 'MINT_YS';
  if (tq && !dil && cin && op) return 'TQ_PINE';
  if (tq && !dil && cin && !op) return 'TQ_CIN';
  if (tq && !dil && !cin && op) return 'TQ_YS';
  if (tq && !dil && !cin && !op) return 'TQ';
  if (!tq && dil && cin && !op) return 'DIL_CIN';
  if (!tq && dil && !cin && op) return 'DIL_OP';
  if (!tq && dil && !cin && !op) return 'DIL';
  if (!tq && !dil && cin && op) return 'PINE';
  if (!tq && !dil && cin && !op) return 'CIN';
  if (!tq && !dil && !cin && op) return 'OP';
  return 'WT';
}

/**
 * Extracts all unexpressed carrier loci (splits) present in the genotype.
 * Note: Females (ZW) can NEVER be split for sex-linked mutations (CIN, OP).
 */
export function deriveActualSplits(genotype: BirdGenotype): BaseLocusKey[] {
  assertValidGenotype(genotype);
  const splits: BaseLocusKey[] = [];

  if (genotype.sex === 'MALE') {
    const z1 = genotype.zChromosomes[0];
    const z2 = genotype.zChromosomes[1]!;
    if (z1.cinnamon !== z2.cinnamon) splits.push('CIN');
    if (z1.opaline !== z2.opaline) splits.push('OP');
  }

  const [tqA, tqB] = genotype.autosomalLoci.turquoise;
  if (tqA !== tqB) splits.push('TQ');

  const [dilA, dilB] = genotype.autosomalLoci.dilute;
  if (dilA !== dilB) splits.push('DIL');

  return splits;
}

/**
 * Generates one gamete from the Sire (ZZ) subject to r = 0.25 recombination
 * between Cinnamon (CIN) and Yellow-Sided (OP) on the Z chromosome.
 */
export function generateSireGamete(
  sire: BirdGenotype,
  rng: RandomFn = Math.random,
  crossoverRate = RECOMBINATION_CROSSOVER_RATE,
): Gamete {
  assertValidGenotype(sire);
  if (sire.sex !== 'MALE') {
    throw new Error('generateSireGamete requires a MALE genotype');
  }

  const z1 = sire.zChromosomes[0];
  const z2 = sire.zChromosomes[1]!;
  let zGenes: ZChromosomeGenes;

  if (rng() < crossoverRate) {
    // Recombination event exchanges alleles between Z1 and Z2
    const pickFirst = rng() < 0.5;
    zGenes = pickFirst
      ? { cinnamon: z1.cinnamon, opaline: z2.opaline }
      : { cinnamon: z2.cinnamon, opaline: z1.opaline };
  } else {
    // Non-recombinant chromatid passed intact
    const src = rng() < 0.5 ? z1 : z2;
    zGenes = { cinnamon: src.cinnamon, opaline: src.opaline };
  }

  return {
    sexChromosome: 'Z',
    zGenes,
    autosomal: {
      turquoise: sire.autosomalLoci.turquoise[rng() < 0.5 ? 0 : 1],
      dilute: sire.autosomalLoci.dilute[rng() < 0.5 ? 0 : 1],
    },
  };
}

/**
 * Generates one gamete from the Dam (ZW).
 * 50/50 probability of Z or W chromosome. W carries no Z-locus alleles.
 */
export function generateDamGamete(dam: BirdGenotype, rng: RandomFn = Math.random): Gamete {
  assertValidGenotype(dam);
  if (dam.sex !== 'FEMALE') {
    throw new Error('generateDamGamete requires a FEMALE genotype');
  }

  const isZ = rng() < 0.5;
  const damZ = dam.zChromosomes[0];

  return {
    sexChromosome: isZ ? 'Z' : 'W',
    zGenes: isZ ? { cinnamon: damZ.cinnamon, opaline: damZ.opaline } : { cinnamon: false, opaline: false },
    autosomal: {
      turquoise: dam.autosomalLoci.turquoise[rng() < 0.5 ? 0 : 1],
      dilute: dam.autosomalLoci.dilute[rng() < 0.5 ? 0 : 1],
    },
  };
}

/**
 * Combines a Sire Z-gamete and a Dam Z/W-gamete into a biological zygote.
 */
export function combineGametes(sireGamete: Gamete, damGamete: Gamete): BirdGenotype {
  if (sireGamete.sexChromosome !== 'Z') {
    throw new Error('Sire gamete must carry a Z chromosome');
  }

  const isMale = damGamete.sexChromosome === 'Z';
  const zChromosomes: BirdGenotype['zChromosomes'] = isMale
    ? [
        { cinnamon: damGamete.zGenes.cinnamon, opaline: damGamete.zGenes.opaline },
        { cinnamon: sireGamete.zGenes.cinnamon, opaline: sireGamete.zGenes.opaline },
      ]
    : [{ cinnamon: sireGamete.zGenes.cinnamon, opaline: sireGamete.zGenes.opaline }];

  return {
    sex: isMale ? 'MALE' : 'FEMALE',
    zChromosomes,
    autosomalLoci: {
      turquoise: [damGamete.autosomal.turquoise, sireGamete.autosomal.turquoise],
      dilute: [damGamete.autosomal.dilute, sireGamete.autosomal.dilute],
    },
  };
}

export function conceiveOffspring(
  sire: BirdGenotype,
  dam: BirdGenotype,
  rng: RandomFn = Math.random,
): BirdGenotype {
  const sireGamete = generateSireGamete(sire, rng);
  const damGamete = generateDamGamete(dam, rng);
  return combineGametes(sireGamete, damGamete);
}

/**
 * Constructs a pure visual genotype (zero extra hidden splits) for a target mutation.
 */
export function createGenotypeForMutation(
  mutation: MutationKey,
  sex: Sex,
  splits: BaseLocusKey[] = [],
  rng: RandomFn = Math.random,
): BirdGenotype {
  const meta = getMutationMeta(mutation);
  const visCin = meta.expressedLoci.includes('CIN');
  const visOp = meta.expressedLoci.includes('OP');
  const visTq = meta.expressedLoci.includes('TQ');
  const visDil = meta.expressedLoci.includes('DIL');

  let zChromosomes: BirdGenotype['zChromosomes'];
  if (sex === 'FEMALE') {
    zChromosomes = [{ cinnamon: visCin, opaline: visOp }];
  } else {
    const z1: ZChromosomeGenes = { cinnamon: visCin, opaline: visOp };
    const z2: ZChromosomeGenes = { cinnamon: visCin, opaline: visOp };

    if (!visCin && splits.includes('CIN')) {
      z1.cinnamon = true;
    }
    if (!visOp && splits.includes('OP')) {
      // If splitting both CIN and OP on a normal male, randomly choose Cis (coupling) or Trans (repulsion)
      if (!visCin && splits.includes('CIN')) {
        if (rng() < 0.5) z1.opaline = true; // Cis: Z^{cin,op} / Z^{+,+}
        else z2.opaline = true; // Trans: Z^{cin,+} / Z^{+,op}
      } else {
        z2.opaline = true;
      }
    }
    zChromosomes = [z1, z2];
  }

  const turquoise: [boolean, boolean] = visTq
    ? [true, true]
    : splits.includes('TQ')
      ? [true, false]
      : [false, false];

  const dilute: [boolean, boolean] = visDil
    ? [true, true]
    : splits.includes('DIL')
      ? [true, false]
      : [false, false];

  return {
    sex,
    zChromosomes,
    autosomalLoci: { turquoise, dilute },
  };
}

/**
 * Returns the discovery gene keys unlocked when a chick visually expresses `phenotype`.
 * Unlocking a combo mutation (e.g. TQ_CIN or MOONCHK) unlocks both the combo key AND
 * its underlying expressed loci so hidden carriers across the aviary are revealed.
 */
export function getDiscoveryKeysForVisualPhenotype(phenotype: MutationKey): string[] {
  if (phenotype === 'WT') return [];
  const meta = getMutationMeta(phenotype);
  const keys = new Set<string>(meta.expressedLoci);
  if (meta.isOfficialCatalogue) {
    keys.add(meta.key);
  }
  // Composite visual combos implied by multi-locus phenotypes
  if (meta.expressedLoci.includes('CIN') && meta.expressedLoci.includes('OP')) {
    keys.add('PINE');
  }
  if (meta.expressedLoci.includes('TQ') && meta.expressedLoci.includes('CIN')) {
    keys.add('TQ_CIN');
  }
  if (meta.expressedLoci.includes('TQ') && meta.expressedLoci.includes('OP')) {
    keys.add('TQ_YS');
  }
  if (meta.expressedLoci.includes('TQ') && meta.expressedLoci.includes('CIN') && meta.expressedLoci.includes('OP')) {
    keys.add('TQ_PINE');
  }
  if (meta.expressedLoci.includes('TQ') && meta.expressedLoci.includes('DIL')) {
    keys.add('MINT');
  }
  if (meta.expressedLoci.includes('DIL') && meta.expressedLoci.includes('CIN') && meta.expressedLoci.includes('OP')) {
    keys.add('SUNCHK');
  }
  return [...keys];
}

export function isMaleCisSplitPineapple(genotype: BirdGenotype): boolean {
  if (genotype.sex !== 'MALE') return false;
  const z1 = genotype.zChromosomes[0];
  const z2 = genotype.zChromosomes[1]!;
  const hasCis1 = z1.cinnamon && z1.opaline && !z2.cinnamon && !z2.opaline;
  const hasCis2 = z2.cinnamon && z2.opaline && !z1.cinnamon && !z1.opaline;
  return hasCis1 || hasCis2;
}
