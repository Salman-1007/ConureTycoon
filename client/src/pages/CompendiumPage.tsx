import React from 'react';
import { Award, BookOpen, CheckCircle2, Dna, Lock, ShieldCheck } from 'lucide-react';
import { MUTATION_CATALOG, OFFICIAL_MUTATION_KEYS, normalizeGeneKey } from '@shared/genetics/catalog';
import { formatCoins, rarityBadgeStyle } from '../components/format';
import { useGame } from '../context/GameContext';

export function CompendiumPage() {
  const { user, birds } = useGame();
  if (!user) return null;

  const unlockedSet = new Set(user.discoveredGenes.map((g) => normalizeGeneKey(g.geneKey)));
  const unlockedCount = OFFICIAL_MUTATION_KEYS.filter((k) => unlockedSet.has(k)).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="brass-panel flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <BookOpen className="h-4 w-4" /> Gene Discovery Compendium &amp; Career Ledger
          </div>
          <h1 className="font-display mt-1 text-2xl font-bold text-[#F6EFE2]">
            Mutation Atlas ({unlockedCount} / 12 Discovered)
          </h1>
          <p className="mt-1 text-xs text-[#9EB09F]">
            You begin with Normal Green unlocked. Hatching a visual mutation in your aviary unlocks its entry here and retroactively unmasks all hidden carriers across your flock!
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-[#C8922A]/35 bg-[#141D17] px-4 py-2.5 text-center">
            <div className="font-mono-num text-lg font-extrabold text-[#E8B84B]">{unlockedCount}/12</div>
            <div className="text-[10px] uppercase text-[#9EB09F]">Mutations</div>
          </div>
          <div className="rounded-xl border border-[#C8922A]/35 bg-[#141D17] px-4 py-2.5 text-center">
            <div className="font-mono-num text-lg font-extrabold text-[#E8B84B]">{user.badges.length}</div>
            <div className="text-[10px] uppercase text-[#9EB09F]">Trophy Badges</div>
          </div>
        </div>
      </div>

      {/* 12 Official Mutations Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {OFFICIAL_MUTATION_KEYS.map((key) => {
          const meta = MUTATION_CATALOG[key];
          const unlocked = unlockedSet.has(key);
          const ownedCount = birds.filter((b) => b.visualPhenotype === key).length;

          return (
            <div
              key={key}
              className={`brass-panel overflow-hidden rounded-2xl flex flex-col ${
                unlocked ? '' : 'opacity-80'
              }`}
            >
              <div className="studio-frame relative aspect-[4/3] w-full overflow-hidden">
                <img
                  src={`/assets/conures/${meta.assetFile}`}
                  alt={unlocked ? meta.name : 'Undiscovered Mutation'}
                  className={`h-full w-full object-contain p-2 transition ${
                    unlocked ? '' : 'brightness-[0.12] contrast-150 grayscale opacity-75'
                  }`}
                />
                {!unlocked && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#101813]/55 text-center p-4">
                    <Lock className="h-7 w-7 text-[#E8B84B] mb-1.5" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#F6EFE2]">
                      Fog of War Locked
                    </span>
                    <span className="mt-1 text-[11px] text-[#D9CEB8]">
                      Hatch a visual specimen to unlock &amp; expose carriers
                    </span>
                  </div>
                )}
                <div className="absolute top-2 left-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold bg-[#141E17]/85 ${rarityBadgeStyle(meta.rarity)}`}>
                    {meta.rarity}
                  </span>
                </div>
                {unlocked && (
                  <div className="absolute top-2 right-2 rounded-full bg-emerald-500/90 p-1 text-white shadow">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1.5 p-3.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-base font-bold text-[#F6EFE2]">{meta.name}</h3>
                  <span className="font-mono-num text-[11px] font-bold text-[#E8B84B]">{meta.key}</span>
                </div>
                <div className="font-mono-num text-[11px] text-sky-300">{meta.chromosomeLabel}</div>
                <div className="text-[11px] text-[#9EB09F] font-semibold">{meta.inheritanceMode}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#D9CEB8]">{meta.visualDescription}</p>
                <div className="mt-auto flex items-center justify-between pt-2 border-t border-[#C8922A]/20 text-[11px]">
                  <span className="text-[#9EB09F]">Base Value: <strong className="font-mono-num text-[#E8B84B]">{formatCoins(meta.basePrice)}</strong></span>
                  <span className="text-[#9EB09F]">In Aviary: <strong className="font-mono-num text-[#F6EFE2]">{ownedCount}</strong></span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Career Stats, Prestige Badges & Chromosomal Reference */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="brass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <Award className="h-4 w-4" /> Career &amp; Prestige Breeder Badges
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
            <MetricCard label="Shows Entered" value={`${user.totalShows}`} />
            <MetricCard label="1st Place Wins" value={`${user.totalShowWins}`} />
            <MetricCard label="Best Score" value={`${user.bestShowScore.toFixed(1)}`} />
            <MetricCard label="Total Earned" value={formatCoins(user.totalCoinsEarned)} />
            <MetricCard label="Market Invested" value={formatCoins(user.marketSpent)} />
            <MetricCard label="Flock Count" value={`${birds.length}`} />
          </div>

          <div className="pt-2 border-t border-[#C8922A]/20">
            <div className="text-xs font-bold text-[#D9CEB8] mb-2">Earned Prestige Badges</div>
            {user.badges.length === 0 ? (
              <p className="text-xs text-[#9EB09F]">
                Place in the Top 3 at the Aviary Exhibition Showroom to earn seasonal prestige badges (e.g. &ldquo;Master Turquoise Breeder 2026&rdquo;).
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {user.badges.map((b) => (
                  <span
                    key={b.badgeKey}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E8B84B]/60 bg-[#233227] px-3 py-1.5 text-xs font-bold text-[#E8B84B]"
                  >
                    <ShieldCheck className="h-4 w-4" /> {b.badgeTitle}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="brass-panel rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <Dna className="h-4 w-4" /> Chromosomal Linkage &amp; Crossover Reference
          </div>
          <div className="space-y-2 text-xs leading-relaxed text-[#D9CEB8]">
            <p>
              <strong>Sex-Linked Loci (ZZ / ZW):</strong> Cinnamon (<span className="font-mono-num text-[#E8B84B]">Z^cin</span>) and Yellow-Sided (<span className="font-mono-num text-[#E8B84B]">Z^op</span>) sit on the Z sex chromosome. Males (ZZ) require two copies to express visually; one copy makes an unexpressed split carrier. Females (ZW) carry a single Z chromosome and express any Z mutation immediately — females can never be split for sex-linked genes.
            </p>
            <p>
              <strong>Linkage &amp; Recombination (r = 0.25):</strong> Heterozygous males carrying both Cinnamon and Yellow-Sided undergo crossing over during meiosis at 25% probability — separating a cis Pineapple carrier (<span className="font-mono-num">Z^cin,op / Z^+,+</span>) into single CIN/OP gametes or uniting trans alleles (<span className="font-mono-num">Z^cin,+ / Z^+,op</span>) into Pineapple (<span className="font-mono-num">Z^cin,op</span>) offspring.
            </p>
            <p>
              <strong>Autosomal Loci (tq &amp; dil):</strong> Turquoise and American Dilute sort independently across both sexes and combine multiplicatively with sex-linked traits to unlock Mint, Suncheek, Turquoise Pineapple, and the 4-way Mooncheek.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#C8922A]/25 bg-[#141D17] p-3">
      <div className="font-mono-num text-sm font-extrabold text-[#F6EFE2]">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[#9EB09F]">{label}</div>
    </div>
  );
}
