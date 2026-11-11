import React, { useEffect, useState } from 'react';
import { Award, Medal, Sparkles, Trophy } from 'lucide-react';
import type { ConureDTO, ShowroomLeaderboardRowDTO } from '@shared/api-types';
import { SHOW_CATEGORIES, type ShowCategory, isEligibleForShowCategory } from '@shared/genetics/showroom';
import { api, ApiError } from '../api/client';
import { formatCoins, getLiveBirdStatus } from '../components/format';
import { useGame } from '../context/GameContext';

interface ShowroomPageProps {
  preselectedBird: ConureDTO | null;
  onClearPreselect: () => void;
}

export function ShowroomPage({ preselectedBird, onClearPreselect }: ShowroomPageProps) {
  const { user, birds, showroom, effectiveNowMs, refreshAll, pushToast } = useGame();
  const [category, setCategory] = useState<ShowCategory>('NOVICE');
  const [selectedBirdId, setSelectedBirdId] = useState('');
  const [lastOutcome, setLastOutcome] = useState<{
    entry: ShowroomLeaderboardRowDTO;
    prizeCoins: number;
    xpAwarded: number;
    awardedBadge: { badgeKey: string; badgeTitle: string } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preselectedBird) {
      setSelectedBirdId(preselectedBird.id);
      if (preselectedBird.generationDepth >= 2 && preselectedBird.fatherId && preselectedBird.motherId) {
        setCategory('MASTER_PEDIGREE');
      } else if (preselectedBird.visualPhenotype !== 'WT') {
        setCategory('COLOR_MUTATION');
      } else {
        setCategory('NOVICE');
      }
      onClearPreselect();
    }
  }, [preselectedBird, onClearPreselect]);

  const catInfo = SHOW_CATEGORIES[category];
  const eligibleBirds = birds.filter((b) => {
    const live = getLiveBirdStatus(b, effectiveNowMs);
    if (live !== 'READY' && live !== 'COOLDOWN') return false;
    return isEligibleForShowCategory(category, {
      visualPhenotype: b.visualPhenotype,
      generationDepth: b.generationDepth,
      fatherId: b.fatherId,
      motherId: b.motherId,
      isMature: effectiveNowMs >= b.maturationTimestamp,
    }).eligible;
  });

  useEffect(() => {
    if (!eligibleBirds.some((b) => b.id === selectedBirdId)) {
      setSelectedBirdId(eligibleBirds[0]?.id ?? '');
    }
  }, [category, eligibleBirds, selectedBirdId]);

  const handleEnterShow = async () => {
    if (!selectedBirdId || busy) return;
    setBusy(true);
    try {
      const res = await api.enterShowroom(selectedBirdId, category);
      setLastOutcome(res);
      await refreshAll();
      pushToast({
        tone: res.entry.rankPosition === 1 ? 'gold' : 'green',
        title: `Placed #${res.entry.rankPosition} in ${catInfo.title}`,
        message: `Score ${res.entry.breakdown.totalScore} pts · Won ${formatCoins(res.prizeCoins)} & +${res.xpAwarded} XP!`,
      });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Entry Failed', message: err instanceof ApiError ? err.message : 'Error.' });
    } finally {
      setBusy(false);
    }
  };

  const leaderboard = showroom?.leaderboards[category] ?? [];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="brass-panel rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
          <Award className="h-4 w-4" /> Aviary Exhibition Showroom · Season {showroom?.seasonKey ?? '2026'}
        </div>
        <h1 className="font-display text-2xl font-bold text-[#F6EFE2]">Conure Exhibition Arena</h1>
        <p className="text-xs text-[#9EB09F] max-w-3xl">
          Deterministic avian exhibition judging replaces flight racing. Judges score every specimen strictly on{' '}
          <span className="font-mono-num text-[#E8B84B]">
            (Plumage Symmetry × 0.3) + (Mutation Rarity × 0.4) + (Lineage Purity × 0.3)
          </span>
          . Top placements award coins, XP, and permanent Prestige Breeder Badges.
        </p>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(['NOVICE', 'COLOR_MUTATION', 'MASTER_PEDIGREE'] as const).map((catKey) => {
          const info = SHOW_CATEGORIES[catKey];
          const active = category === catKey;
          return (
            <button
              key={catKey}
              type="button"
              onClick={() => setCategory(catKey)}
              className={`brass-panel rounded-2xl p-4 text-left transition ${
                active ? 'ring-2 ring-[#E8B84B] border-[#E8B84B]' : 'opacity-80 hover:opacity-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold text-[#F6EFE2]">{info.title}</span>
                <Trophy className={`h-5 w-5 ${active ? 'text-[#E8B84B]' : 'text-[#7D8F7F]'}`} />
              </div>
              <p className="mt-1 text-xs text-[#9EB09F]">{info.subtitle}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-[#D9CEB8]">Entry: <strong className="font-mono-num text-[#E8B84B]">{formatCoins(info.entryFee)}</strong></span>
                <span className="text-emerald-300 font-bold">1st: {formatCoins(info.firstPrize)}</span>
              </div>
              <div className="mt-1.5 text-[10px] text-[#9EB09F]">{info.eligibilityNote}</div>
            </button>
          );
        })}
      </div>

      {/* Entry & Judge Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="brass-panel lg:col-span-5 rounded-2xl p-5 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#F6EFE2]">Enter {catInfo.title}</h2>
          {eligibleBirds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#C8922A]/35 bg-[#141D17] p-4 text-xs text-[#9EB09F]">
              No eligible mature conures in your aviary for this division ({catInfo.eligibilityNote}).
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                  Select Exhibit Specimen
                </label>
                <select
                  value={selectedBirdId}
                  onChange={(e) => setSelectedBirdId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#C8922A]/40 bg-[#121914] px-3 py-2.5 text-sm text-[#F6EFE2]"
                >
                  {eligibleBirds.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.legBand}) · {b.phenotypeName} · Sym {b.plumageSymmetry} · Gen {b.generationDepth}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={!selectedBirdId || busy || (user?.coins ?? 0) < catInfo.entryFee}
                onClick={handleEnterShow}
                className="w-full rounded-xl bg-[#E8B84B] py-3 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C] disabled:opacity-40"
              >
                {busy ? 'Judging...' : `Submit Specimen (${formatCoins(catInfo.entryFee)})`}
              </button>
            </>
          )}

          {lastOutcome && (
            <div className="rounded-xl border border-[#E8B84B]/50 bg-[#141D17] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Official Scorecard</span>
                <span className="font-mono-num rounded-full bg-[#E8B84B] px-2.5 py-0.5 text-xs font-black text-[#141A15]">
                  Rank #{lastOutcome.entry.rankPosition}
                </span>
              </div>
              <div className="text-sm font-bold text-[#F6EFE2]">
                {lastOutcome.entry.birdName} ({lastOutcome.entry.phenotypeName})
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded bg-[#1B271E] p-2">
                  <div className="font-mono-num font-bold text-[#F6EFE2]">{lastOutcome.entry.breakdown.plumageSymmetry}</div>
                  <div className="text-[#9EB09F]">Symmetry ×0.3</div>
                </div>
                <div className="rounded bg-[#1B271E] p-2">
                  <div className="font-mono-num font-bold text-[#F6EFE2]">{lastOutcome.entry.breakdown.mutationRarityScore}</div>
                  <div className="text-[#9EB09F]">Rarity ×0.4</div>
                </div>
                <div className="rounded bg-[#1B271E] p-2">
                  <div className="font-mono-num font-bold text-[#F6EFE2]">{lastOutcome.entry.breakdown.lineagePurityBonus}</div>
                  <div className="text-[#9EB09F]">Purity ×0.3</div>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-[#9EB09F]">Final Total Score</span>
                <span className="font-mono-num text-base font-extrabold text-[#E8B84B]">
                  {lastOutcome.entry.breakdown.totalScore} pts
                </span>
              </div>
              {lastOutcome.awardedBadge && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-400/50 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-200">
                  <Sparkles className="h-4 w-4 text-emerald-300" />
                  Unlocked Badge: {lastOutcome.awardedBadge.badgeTitle}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Seasonal Leaderboard */}
        <div className="brass-panel lg:col-span-7 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-[#F6EFE2]">{catInfo.title} Leaderboard</h2>
            <Medal className="h-5 w-5 text-[#E8B84B]" />
          </div>
          {leaderboard.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#9EB09F]">No entries recorded yet this season.</p>
          ) : (
            <div className="divide-y divide-[#C8922A]/20">
              {leaderboard.map((row) => {
                const isMine = row.userId === user?.id;
                return (
                  <div
                    key={row.entryId}
                    className={`flex items-center justify-between gap-3 py-2.5 px-2 rounded-lg ${
                      isMine ? 'bg-[#E8B84B]/12' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono-num w-7 text-sm font-extrabold text-[#E8B84B]">#{row.rankPosition}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-[#F6EFE2]">
                          {row.birdName} <span className="text-xs font-normal text-[#9EB09F]">({row.phenotypeName})</span>
                        </div>
                        <div className="truncate text-xs text-[#9EB09F]">
                          {row.breederName} · {row.aviaryName}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono-num text-sm font-extrabold text-[#E8B84B]">
                        {row.breakdown.totalScore.toFixed(2)}
                      </div>
                      <div className="font-mono-num text-[10px] text-[#9EB09F]">{row.legBand}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
