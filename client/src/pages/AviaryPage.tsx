import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Egg, Feather, Heart, X } from 'lucide-react';
import type { BreedingCageDTO, ConureDTO, PairPreviewResponseDTO } from '@shared/api-types';
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
  const [fosterSource, setFosterSource] = useState<BreedingCageDTO | null>(null);
  const [fosterTargetId, setFosterTargetId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const filterCounts = useMemo(() => {
    const counts: Record<AviaryFilter, number> = {
      ALL: birds.length,
      READY: 0,
      MALE: 0,
      FEMALE: 0,
      JUVENILE: 0,
      BREEDING: 0,
      COOLDOWN: 0,
      MARKET_P2P: 0,
    };
    for (const b of birds) {
      const live = getLiveBirdStatus(b, effectiveNowMs);
      if (b.sex === 'MALE') counts.MALE++;
      else counts.FEMALE++;
      if (live === 'READY') counts.READY++;
      else if (live === 'JUVENILE') counts.JUVENILE++;
      else if (live === 'BREEDING' || live === 'INCUBATING') counts.BREEDING++;
      else if (live === 'COOLDOWN') counts.COOLDOWN++;
      else if (live === 'MARKET_P2P') counts.MARKET_P2P++;
    }
    return counts;
  }, [birds, effectiveNowMs]);

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

  const handleFoster = async () => {
    if (!fosterSource || !fosterTargetId || busy) return;
    setBusy(true);
    try {
      const res = await api.fosterClutch(fosterSource.id, fosterTargetId);
      await refreshAviary();
      setFosterSource(null);
      setFosterTargetId('');
      pushToast({
        tone: res.extraRiskCount > 0 ? 'gold' : 'green',
        title: 'Clutch Fostered!',
        message:
          res.extraRiskCount > 0
            ? `Moved ${res.transferredCount} egg(s) (${res.totalInTarget} total — ${res.extraRiskCount} face 50/50 survival risk). Original parents are free!`
            : `Moved ${res.transferredCount} egg(s) to foster parents (${res.totalInTarget}/5 safe). Original parents are immediately Ready!`,
      });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Foster Failed', message: err instanceof ApiError ? err.message : 'Unable to foster clutch.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="brass-panel flex flex-col gap-2.5 rounded-2xl p-3.5 sm:gap-3 sm:p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#E8B84B] sm:text-xs">
            <Feather className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> Aviary Sanctuary &amp; Breeding Wing
          </div>
          <h1 className="font-display mt-0.5 text-xl font-bold text-[#F6EFE2] sm:mt-1 sm:text-2xl">Your Flock ({birds.length})</h1>
          <p className="mt-0.5 text-[11px] text-[#9EB09F] sm:mt-1 sm:text-xs">
            Tap any conure to inspect pedigrees, or pair a Ready Male (ZZ) + Female (ZW) — laying &amp; hatching proceed automatically.
          </p>
        </div>

        {pairSource ? (
          <div className="sticky top-14 z-30 flex items-center justify-between gap-3 rounded-xl border border-amber-400/60 bg-[#1B2216]/95 px-3.5 py-2.5 shadow-xl backdrop-blur-md md:static md:justify-start md:bg-amber-950/35 md:px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <Heart className="h-5 w-5 shrink-0 text-rose-400 animate-pulse" />
              <div className="min-w-0 text-xs">
                <div className="truncate font-bold text-[#F6EFE2]">
                  Pairing: {pairSource.name} ({pairSource.sex === 'MALE' ? '♂ ZZ' : '♀ ZW'})
                </div>
                <div className="truncate text-[#E8B84B]">
                  Tap a Ready {pairSource.sex === 'MALE' ? 'Female ♀' : 'Male ♂'} to inspect COI &amp; pair.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPairSource(null)}
              className="shrink-0 rounded-lg border border-[#C8922A]/40 px-2.5 py-1 text-xs font-bold text-[#D9CEB8] hover:text-white"
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
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeCages.map((cage) => {
              const eggsLaid = effectiveNowMs >= cage.laidAt;
              const layRemaining = Math.max(0, cage.laidAt - effectiveNowMs);
              const hatchRemaining = Math.max(0, cage.hatchReadyAt - effectiveNowMs);
              const ready = eggsLaid && hatchRemaining <= 0;

              let pct = 100;
              if (!eggsLaid) {
                const layDur = Math.max(1, cage.laidAt - cage.startedAt);
                pct = Math.min(100, Math.round(((layDur - layRemaining) / layDur) * 100));
              } else if (!ready) {
                const incDur = Math.max(1, cage.hatchReadyAt - cage.laidAt);
                pct = Math.min(100, Math.round(((incDur - hatchRemaining) / incDur) * 100));
              }

              const otherCages = activeCages.filter((c) => c.id !== cage.id);
              return (
                <div key={cage.id} className="brass-panel rounded-2xl p-3 sm:p-4 space-y-2.5 sm:space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
                    <span className="font-bold text-[#E8B84B]">
                      {eggsLaid ? `Clutch of ${cage.clutchSize} Eggs` : 'Pair Nesting · Laying Soon'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {cage.fosteredCount > 0 && (
                        <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-200 border border-sky-400/40">
                          +{cage.fosteredCount} Fostered
                        </span>
                      )}
                      {eggsLaid && cage.clutchSize > 5 && (
                        <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-200 border border-rose-400/40">
                          &gt;5 Chick Risk
                        </span>
                      )}
                      {cage.coiWarning && (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200 border border-amber-400/40">
                          COI {(cage.inbreedingCoi * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
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
                      <span className="text-[#9EB09F]">
                        {!eggsLaid ? 'Preparing & Laying (1-6h)' : ready ? 'Incubation Complete' : 'Incubating Eggs (6h)'}
                      </span>
                      <span className="font-mono-num font-bold text-[#F6EFE2]">
                        {!eggsLaid ? formatDuration(layRemaining) : ready ? 'READY!' : formatDuration(hatchRemaining)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#111914]">
                      <div
                        className={`h-full transition-all ${
                          ready ? 'bg-emerald-400' : eggsLaid ? 'bg-[#E8B84B]' : 'bg-sky-400'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  {eggsLaid && cage.clutchSize > 5 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/35 px-2.5 py-2 text-[11px] text-amber-100">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        Overcrowded nest ({cage.clutchSize} eggs): first 5 survive 100%, extra {cage.clutchSize - 5} have 50/50 hatch survival.
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <div
                      className={`w-full rounded-xl border py-2 px-3 text-center text-[11px] font-bold ${
                        ready
                          ? 'border-emerald-400/50 bg-emerald-950/45 text-emerald-200'
                          : eggsLaid
                            ? 'border-[#C8922A]/30 bg-[#18231B] text-[#E8B84B]'
                            : 'border-sky-400/30 bg-[#142026] text-sky-200'
                      }`}
                    >
                      {!eggsLaid
                        ? 'Nesting · Laying Automatically'
                        : ready
                          ? 'Hatching Automatically...'
                          : 'Incubating · Auto-Hatches When Ready'}
                    </div>
                    {eggsLaid && otherCages.length > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const sortedTargets = [...otherCages].sort((a, b) => a.clutchSize - b.clutchSize);
                          setFosterSource(cage);
                          setFosterTargetId(sortedTargets[0]?.id ?? '');
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#C8922A]/35 bg-[#141D17] py-1.5 text-[11px] font-bold text-[#E8B84B] hover:border-[#E8B84B]"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" /> Foster Eggs to Another Pair
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Filter Pills */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:flex-wrap sm:pb-0">
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
            className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition sm:px-3 sm:text-xs ${
              filter === key
                ? 'border-[#E8B84B] bg-[#E8B84B] text-[#141A15]'
                : 'border-[#C8922A]/30 bg-[#18221B] text-[#D9CEB8] hover:border-[#E8B84B]/60'
            }`}
          >
            {label} <span className="font-mono-num opacity-75">({filterCounts[key]})</span>
          </button>
        ))}
      </div>

      {/* Aviary Grid (2 side-by-side on mobile, expanding on larger screens) */}
      {filtered.length === 0 ? (
        <div className="brass-panel rounded-2xl p-8 text-center text-sm text-[#9EB09F] sm:p-10">
          No conures match this filter. Visit the Wild Exchange or Breeding Cages to grow your flock.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
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
                compactOnMobile
                selected={pairSource?.id === bird.id}
                onClick={() => {
                  if (pairSource && isPairingCompatible) {
                    handleRequestPair(bird);
                  } else {
                    setSelectedBird(bird);
                  }
                }}
                footer={
                  <div className="flex items-center gap-1.5 sm:justify-between sm:gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBird(bird);
                      }}
                      className="flex-1 sm:flex-none rounded-lg border border-[#C8922A]/40 bg-[#17211A] px-2 py-1.5 text-[11px] font-bold text-[#D9CEB8] hover:border-[#E8B84B] sm:px-2.5 sm:py-1"
                    >
                      <span className="sm:hidden">Inspect</span>
                      <span className="hidden sm:inline">Inspect &amp; Pedigree</span>
                    </button>
                    <button
                      type="button"
                      disabled={live !== 'READY' || busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRequestPair(bird);
                      }}
                      className={`flex-1 sm:flex-none rounded-lg px-2 py-1.5 text-[11px] font-extrabold transition disabled:opacity-35 sm:px-2.5 sm:py-1 ${
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="brass-panel max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-4 sm:rounded-2xl sm:p-6 space-y-4">
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
                Clean outcross pairing (COI <span className="font-mono-num font-bold">0.0%</span>). Clutch size will roll 3–5 eggs and hatch automatically after laying + 6h incubation.
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

      {/* Foster Clutch Modal */}
      {fosterSource && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="brass-panel max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-4 sm:rounded-2xl sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#C8922A]/25 pb-3">
              <div>
                <h2 className="font-display text-xl font-bold text-[#F6EFE2]">Foster Eggs to Another Pair</h2>
                <p className="text-xs text-[#9EB09F]">
                  Frees {fosterSource.male.name} &times; {fosterSource.female.name} immediately while preserving true biological pedigree.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFosterSource(null);
                  setFosterTargetId('');
                }}
                className="text-[#9EB09F] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl border border-[#C8922A]/25 bg-[#121A14] p-3 text-xs text-[#D5E0D6]">
              Transferring <strong className="text-[#E8B84B]">{fosterSource.clutchSize} egg(s)</strong> from{' '}
              <strong>{fosterSource.male.name} &times; {fosterSource.female.name}</strong>. Up to <strong>5 chicks</strong> in a foster nest survive 100%; every extra chick beyond 5 carries a <strong>50/50 survival chance</strong>.
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#9EB09F]">Select Foster Parents</div>
              {activeCages
                .filter((c) => c.id !== fosterSource.id)
                .map((target) => {
                  const combined = target.clutchSize + fosterSource.clutchSize;
                  const extra = Math.max(0, combined - 5);
                  const selected = fosterTargetId === target.id;
                  return (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => setFosterTargetId(target.id)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        selected
                          ? 'border-[#E8B84B] bg-[#1E2A21]'
                          : 'border-[#C8922A]/25 bg-[#141D17] hover:border-[#C8922A]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-bold text-[#F6EFE2]">
                        <span>
                          ♂ {target.male.name} &times; ♀ {target.female.name}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            extra > 0
                              ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                              : 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                          }`}
                        >
                          {combined} total eggs {extra > 0 ? `(${extra} @ 50/50)` : '(Safe)'}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-[#9EB09F]">
                        Currently incubating {target.clutchSize} egg(s) &middot;{' '}
                        {target.eggsLaid || effectiveNowMs >= target.laidAt
                          ? `Hatches in ${formatDuration(Math.max(0, target.hatchReadyAt - effectiveNowMs))}`
                          : 'Still laying'}
                      </div>
                    </button>
                  );
                })}
            </div>

            {(() => {
              const target = activeCages.find((c) => c.id === fosterTargetId);
              if (!target) return null;
              const combined = target.clutchSize + fosterSource.clutchSize;
              const extra = Math.max(0, combined - 5);
              if (extra <= 0) return null;
              return (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 p-3 text-xs text-amber-100">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Warning: fostering into this cage puts <strong>{combined} eggs</strong> under one pair. Up to 5 will survive safely, while the extra <strong>{extra} chick(s)</strong> only have a 50/50 survival chance!
                  </span>
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setFosterSource(null);
                  setFosterTargetId('');
                }}
                className="rounded-xl border border-[#C8922A]/30 px-4 py-2 text-xs font-bold text-[#9EB09F]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!fosterTargetId || busy}
                onClick={handleFoster}
                className="rounded-xl bg-[#E8B84B] px-5 py-2 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C] disabled:opacity-50"
              >
                Confirm Foster Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
