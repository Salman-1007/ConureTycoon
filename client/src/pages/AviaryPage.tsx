import React, { useMemo, useState } from 'react';
import { AlertTriangle, Egg, Feather, Heart, Sparkles, X } from 'lucide-react';
import type { ConureDTO, HatchResponseDTO, PairPreviewResponseDTO } from '@shared/api-types';
import { api, ApiError } from '../api/client';
import { BirdDetailModal } from '../components/BirdDetailModal';
import { ConureCard } from '../components/ConureCard';
import { formatDuration, getLiveBirdStatus } from '../components/format';
import { useGame } from '../context/GameContext';

type AviaryFilter = 'ALL' | 'MALE' | 'FEMALE' | 'READY' | 'JUVENILE' | 'BREEDING' | 'COOLDOWN' | 'MARKET_P2P';

interface AviaryPageProps {
  onSendToShowroom: (bird: ConureDTO) => void;
}

export function AviaryPage({ onSendToShowroom }: AviaryPageProps) {
  const { birds, activeCages, effectiveNowMs, refreshAviary, pushToast } = useGame();
  const [filter, setFilter] = useState<AviaryFilter>('ALL');
  const [selectedBird, setSelectedBird] = useState<ConureDTO | null>(null);
  const [pairSource, setPairSource] = useState<ConureDTO | null>(null);
  const [pairConfirm, setPairConfirm] = useState<{
    birdA: ConureDTO;
    birdB: ConureDTO;
    preview: PairPreviewResponseDTO;
  } | null>(null);
  const [hatchResult, setHatchResult] = useState<HatchResponseDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    return birds.filter((b) => {
      const live = getLiveBirdStatus(b, effectiveNowMs);
      if (filter === 'MALE') return b.sex === 'MALE';
      if (filter === 'FEMALE') return b.sex === 'FEMALE';
      if (filter === 'READY') return live === 'READY';
      if (filter === 'JUVENILE') return live === 'JUVENILE';
      if (filter === 'BREEDING') return live === 'BREEDING' || live === 'INCUBATING';
      if (filter === 'COOLDOWN') return live === 'COOLDOWN';
      if (filter === 'MARKET_P2P') return live === 'MARKET_P2P';
      return true;
    });
  }, [birds, filter, effectiveNowMs]);

  const handleRequestPair = async (bird: ConureDTO) => {
    const live = getLiveBirdStatus(bird, effectiveNowMs);
    if (live !== 'READY') {
      pushToast({ tone: 'red', title: 'Unavailable', message: `${bird.name} is currently ${live}.` });
      return;
    }

    if (!pairSource) {
      setPairSource(bird);
      return;
    }

    if (pairSource.id === bird.id) {
      setPairSource(null);
      return;
    }

    if (pairSource.sex === bird.sex) {
      pushToast({
        tone: 'red',
        title: 'Incompatible Sexes',
        message: 'A breeding pair requires 1 Male (ZZ) and 1 Female (ZW).',
      });
      return;
    }

    setBusy(true);
    try {
      const preview = await api.previewPair(pairSource.id, bird.id);
      if (!preview.eligible) {
        pushToast({ tone: 'red', title: 'Cannot Pair', message: preview.reason ?? 'Ineligible pair.' });
        return;
      }
      setPairConfirm({ birdA: pairSource, birdB: bird, preview });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Preview Error', message: err instanceof ApiError ? err.message : 'Error.' });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPair = async (acknowledgeInbreeding: boolean) => {
    if (!pairConfirm || busy) return;
    setBusy(true);
    try {
      await api.startPair(pairConfirm.birdA.id, pairConfirm.birdB.id, acknowledgeInbreeding);
      await refreshAviary();
      pushToast({
        tone: 'green',
        title: 'Breeding Pair Assigned',
        message: `${pairConfirm.birdA.name} & ${pairConfirm.birdB.name} are now incubating a clutch!`,
      });
      setPairConfirm(null);
      setPairSource(null);
    } catch (err) {
      pushToast({ tone: 'red', title: 'Pairing Failed', message: err instanceof ApiError ? err.message : 'Error.' });
    } finally {
      setBusy(false);
    }
  };

  const handleHatch = async (cageId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await api.collectHatch(cageId);
      await refreshAviary();
      setHatchResult(outcome);
      if (outcome.notifications.length > 0) {
        for (const n of outcome.notifications) {
          pushToast({ tone: 'green', title: n.title, message: n.message });
        }
      }
    } catch (err) {
      pushToast({ tone: 'red', title: 'Cannot Hatch', message: err instanceof ApiError ? err.message : 'Wait longer.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="brass-panel flex flex-col gap-3 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <Feather className="h-4 w-4" /> Aviary Sanctuary &amp; Breeding Wing
          </div>
          <h1 className="font-display mt-1 text-2xl font-bold text-[#F6EFE2]">Your Flock ({birds.length})</h1>
          <p className="mt-1 text-xs text-[#9EB09F]">
            Inspect closed leg bands, explore 3-generation pedigrees, and assign compatible Male (ZZ) + Female (ZW) pairs to breeding cages.
          </p>
        </div>

        {pairSource ? (
          <div className="flex items-center gap-3 rounded-xl border border-amber-400/60 bg-amber-950/35 px-4 py-2.5">
            <Heart className="h-5 w-5 text-rose-400 animate-pulse" />
            <div className="text-xs">
              <div className="font-bold text-[#F6EFE2]">
                Pairing: {pairSource.name} ({pairSource.sex === 'MALE' ? '♂ ZZ' : '♀ ZW'})
              </div>
              <div className="text-[#E8B84B]">
                Select a Ready {pairSource.sex === 'MALE' ? 'Female ♀' : 'Male ♂'} to inspect COI &amp; pair.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPairSource(null)}
              className="rounded-lg border border-[#C8922A]/40 px-2.5 py-1 text-xs font-bold text-[#D9CEB8] hover:text-white"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      {/* Active Breeding Cages */}
      {activeCages.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <Egg className="h-4 w-4" /> Active Breeding Cages ({activeCages.length})
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeCages.map((cage) => {
              const remaining = Math.max(0, cage.hatchReadyAt - effectiveNowMs);
              const ready = remaining <= 0;
              const totalDur = Math.max(1, cage.hatchReadyAt - cage.startedAt);
              const pct = Math.min(100, Math.round(((totalDur - remaining) / totalDur) * 100));
              return (
                <div key={cage.id} className="brass-panel rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#E8B84B]">Clutch of {cage.clutchSize} Eggs</span>
                    {cage.coiWarning && (
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200 border border-amber-400/40">
                        COI {(cage.inbreedingCoi * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-[#141D17] p-2.5 border border-[#C8922A]/20">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-sky-300">♂ {cage.male.name}</div>
                      <div className="truncate text-[11px] text-[#9EB09F]">{cage.male.phenotypeName}</div>
                    </div>
                    <Heart className="h-4 w-4 text-rose-400 shrink-0" />
                    <div className="min-w-0 text-right">
                      <div className="truncate text-xs font-bold text-rose-300">♀ {cage.female.name}</div>
                      <div className="truncate text-[11px] text-[#9EB09F]">{cage.female.phenotypeName}</div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#9EB09F]">{ready ? 'Incubation Complete' : 'Incubating'}</span>
                      <span className="font-mono-num font-bold text-[#F6EFE2]">
                        {ready ? 'READY!' : formatDuration(remaining)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#111914]">
                      <div
                        className={`h-full transition-all ${ready ? 'bg-emerald-400' : 'bg-[#E8B84B]'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!ready || busy}
                    onClick={() => handleHatch(cage.id)}
                    className={`w-full rounded-xl py-2 text-xs font-extrabold transition ${
                      ready
                        ? 'bg-emerald-400 text-[#0F1F14] hover:bg-emerald-300'
                        : 'bg-[#18231B] text-[#7D8F7F] border border-[#C8922A]/20'
                    }`}
                  >
                    {ready ? `Hatch ${cage.clutchSize} Chicks!` : 'Incubating Eggs...'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['ALL', 'All'],
            ['READY', 'Ready'],
            ['MALE', 'Males ♂'],
            ['FEMALE', 'Females ♀'],
            ['JUVENILE', 'Juveniles'],
            ['BREEDING', 'Breeding'],
            ['COOLDOWN', 'Resting'],
            ['MARKET_P2P', 'P2P Listed'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              filter === key
                ? 'border-[#E8B84B] bg-[#E8B84B] text-[#141A15]'
                : 'border-[#C8922A]/30 bg-[#18221B] text-[#D9CEB8] hover:border-[#E8B84B]/60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Aviary Grid */}
      {filtered.length === 0 ? (
        <div className="brass-panel rounded-2xl p-10 text-center text-sm text-[#9EB09F]">
          No conures match this filter. Visit the Wild Exchange or Breeding Cages to grow your flock.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((bird) => {
            const live = getLiveBirdStatus(bird, effectiveNowMs);
            const isPairingCompatible =
              pairSource &&
              pairSource.id !== bird.id &&
              pairSource.sex !== bird.sex &&
              live === 'READY';
            return (
              <ConureCard
                key={bird.id}
                bird={bird}
                nowMs={effectiveNowMs}
                selected={pairSource?.id === bird.id}
                onClick={() => {
                  if (pairSource && isPairingCompatible) {
                    handleRequestPair(bird);
                  } else {
                    setSelectedBird(bird);
                  }
                }}
                footer={
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBird(bird);
                      }}
                      className="rounded-lg border border-[#C8922A]/40 bg-[#17211A] px-2.5 py-1 text-[11px] font-bold text-[#D9CEB8] hover:border-[#E8B84B]"
                    >
                      Inspect &amp; Pedigree
                    </button>
                    <button
                      type="button"
                      disabled={live !== 'READY' || busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRequestPair(bird);
                      }}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-extrabold transition disabled:opacity-35 ${
                        isPairingCompatible
                          ? 'bg-emerald-400 text-[#0F1F14] hover:bg-emerald-300'
                          : pairSource?.id === bird.id
                            ? 'bg-[#E8B84B] text-[#141A15]'
                            : 'bg-[#253629] text-[#E8B84B] hover:bg-[#314736]'
                      }`}
                    >
                      {pairSource?.id === bird.id ? 'Selected' : isPairingCompatible ? 'Pair Here' : 'Pair'}
                    </button>
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      {/* Bird Inspection Modal */}
      <BirdDetailModal
        bird={selectedBird}
        onClose={() => setSelectedBird(null)}
        onStartPair={(b) => handleRequestPair(b)}
        onGoToShowroom={onSendToShowroom}
      />

      {/* Pair Confirmation & COI Warning Modal */}
      {pairConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="brass-panel w-full max-w-lg rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-[#F6EFE2]">Confirm Breeding Assignment</h2>
              <button type="button" onClick={() => setPairConfirm(null)} className="text-[#9EB09F] hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#C8922A]/30 bg-[#141D17] p-3.5 text-xs">
              <div>
                <div className="text-[10px] uppercase text-sky-300 font-bold">Sire (ZZ)</div>
                <div className="font-bold text-[#F6EFE2]">{pairConfirm.birdA.sex === 'MALE' ? pairConfirm.birdA.name : pairConfirm.birdB.name}</div>
                <div className="text-[#E8B84B]">{pairConfirm.birdA.sex === 'MALE' ? pairConfirm.birdA.phenotypeName : pairConfirm.birdB.phenotypeName}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-rose-300 font-bold">Dam (ZW)</div>
                <div className="font-bold text-[#F6EFE2]">{pairConfirm.birdA.sex === 'FEMALE' ? pairConfirm.birdA.name : pairConfirm.birdB.name}</div>
                <div className="text-[#E8B84B]">{pairConfirm.birdA.sex === 'FEMALE' ? pairConfirm.birdA.phenotypeName : pairConfirm.birdB.phenotypeName}</div>
              </div>
            </div>

            {pairConfirm.preview.coiWarning ? (
              <div className="rounded-xl border border-amber-400/60 bg-amber-950/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-extrabold text-amber-200">
                  <AlertTriangle className="h-5 w-5 text-amber-300" />
                  Inbreeding Coefficient Alert (COI F = {(pairConfirm.preview.inbreedingCoi * 100).toFixed(1)}%)
                </div>
                <p className="text-xs text-amber-100/90 leading-relaxed">
                  Shared ancestors appear within 3 generations ({pairConfirm.preview.commonAncestorLabels.join(', ')}). High inbreeding reduces plumage symmetry and lowers Showroom Lineage Purity scores.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                Clean outcross pairing (COI <span className="font-mono-num font-bold">0.0%</span>). Clutch size will roll 3–5 eggs with 6-hour incubation.
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPairConfirm(null)}
                className="rounded-lg border border-[#C8922A]/40 px-4 py-2 text-xs font-bold text-[#D9CEB8] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleConfirmPair(pairConfirm.preview.coiWarning)}
                className={`rounded-lg px-4 py-2 text-xs font-extrabold ${
                  pairConfirm.preview.coiWarning
                    ? 'bg-amber-400 text-[#1A1308] hover:bg-amber-300'
                    : 'bg-[#E8B84B] text-[#141A15] hover:bg-[#F2C75C]'
                }`}
              >
                {pairConfirm.preview.coiWarning ? 'Acknowledge & Pair Anyway' : 'Place in Breeding Cage'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hatch Celebration Modal */}
      {hatchResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="brass-panel max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#C8922A]/25 pb-3">
              <div>
                <h2 className="font-display text-2xl font-bold text-[#F6EFE2]">
                  Clutch Hatched! ({hatchResult.chicks.length} Chicks)
                </h2>
                <p className="text-xs text-[#9EB09F]">
                  Chicks enter the juvenile maturation phase (6h) while parents rest for 12h post-fledge.
                </p>
              </div>
              <button type="button" onClick={() => setHatchResult(null)} className="text-[#9EB09F] hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {hatchResult.notifications.length > 0 && (
              <div className="rounded-xl border border-emerald-400/60 bg-emerald-950/45 p-4 space-y-1.5">
                {hatchResult.notifications.map((n) => (
                  <div key={n.id} className="flex items-start gap-2.5 text-xs text-emerald-100">
                    <Sparkles className="h-4 w-4 text-emerald-300 shrink-0 mt-0.5" />
                    <div>
                      <strong>{n.title}:</strong> {n.message}
                      {hatchResult.retroactivelyRevealedBirdIds.length > 0 && (
                        <span className="ml-1 text-emerald-300 font-bold">
                          ({hatchResult.retroactivelyRevealedBirdIds.length} carrier(s) unmasked in your flock!)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {hatchResult.chicks.map((chick) => (
                <ConureCard key={chick.id} bird={chick} nowMs={effectiveNowMs} />
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setHatchResult(null)}
                className="rounded-xl bg-[#E8B84B] px-5 py-2.5 text-xs font-extrabold text-[#141A15]"
              >
                Welcome Chicks to Aviary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
