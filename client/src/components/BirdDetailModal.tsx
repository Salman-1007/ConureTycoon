import React, { useEffect, useState } from 'react';
import { Award, Dna, Edit3, GitBranch, Heart, Store, Tag, X } from 'lucide-react';
import type { ConureDTO } from '@shared/api-types';
import { getMutationMeta } from '@shared/genetics/catalog';
import type { PedigreeTreeNode } from '@shared/genetics/pedigree';
import { api, ApiError } from '../api/client';
import { useGame } from '../context/GameContext';
import { formatCoins, formatDuration, getLiveBirdStatus, rarityBadgeStyle, statusBadgeStyle } from './format';
import { PedigreeTree } from './PedigreeTree';

interface BirdDetailModalProps {
  bird: ConureDTO | null;
  onClose: () => void;
  onStartPair: (bird: ConureDTO) => void;
  onGoToShowroom: (bird: ConureDTO) => void;
}

export function BirdDetailModal({ bird, onClose, onStartPair, onGoToShowroom }: BirdDetailModalProps) {
  const { effectiveNowMs, refreshAviary, refreshP2P, pushToast } = useGame();
  const [tab, setTab] = useState<'overview' | 'pedigree' | 'p2p'>('overview');
  const [nameInput, setNameInput] = useState('');
  const [pedigree, setPedigree] = useState<PedigreeTreeNode | null>(null);
  const [loadingPedigree, setLoadingPedigree] = useState(false);
  const [p2pPrice, setP2pPrice] = useState('');
  const [p2pNote, setP2pNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bird) return;
    setNameInput(bird.name);
    setTab('overview');
    setPedigree(null);
    const meta = getMutationMeta(bird.visualPhenotype);
    setP2pPrice(String(Math.round(meta.basePrice * 1.15)));
    setP2pNote('');
  }, [bird]);

  useEffect(() => {
    if (!bird || tab !== 'pedigree' || pedigree) return;
    setLoadingPedigree(true);
    api
      .getPedigree(bird.id)
      .then((res) => setPedigree(res.tree))
      .catch(() => {})
      .finally(() => setLoadingPedigree(false));
  }, [bird, tab, pedigree]);

  if (!bird) return null;

  const meta = getMutationMeta(bird.visualPhenotype);
  const liveStatus = getLiveBirdStatus(bird, effectiveNowMs);
  const statusInfo = statusBadgeStyle(liveStatus);

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim() || busy) return;
    setBusy(true);
    try {
      await api.renameBird(bird.id, nameInput.trim());
      await refreshAviary();
      pushToast({ tone: 'green', title: 'Renamed', message: `Leg band ${bird.legBand} updated to ${nameInput.trim()}.` });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Error', message: err instanceof ApiError ? err.message : 'Rename failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSellSanctuary = async () => {
    if (busy) return;
    if (!window.confirm(`Release ${bird.name} (${bird.legBand}) to the Avian Sanctuary for ${formatCoins(bird.sanctuaryValue)}?`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.sellBirdToSanctuary(bird.id);
      await refreshAviary();
      pushToast({ tone: 'gold', title: 'Sanctuary Sale', message: `Received ${formatCoins(res.payout)}.` });
      onClose();
    } catch (err) {
      pushToast({ tone: 'red', title: 'Cannot Sell', message: err instanceof ApiError ? err.message : 'Sale failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleListP2P = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.createP2PListing({
        birdId: bird.id,
        askingPrice: Number(p2pPrice),
        sellerNote: p2pNote,
      });
      await Promise.all([refreshAviary(), refreshP2P()]);
      pushToast({
        tone: 'gold',
        title: 'Listed on Trading Post',
        message: `${bird.name} is now listed for ${formatCoins(Number(p2pPrice))}.`,
      });
      onClose();
    } catch (err) {
      pushToast({ tone: 'red', title: 'Listing Failed', message: err instanceof ApiError ? err.message : 'Could not list.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="brass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-5 md:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#C8922A]/25 pb-4">
          <div className="flex items-center gap-4">
            <div className="studio-frame h-24 w-28 shrink-0 overflow-hidden rounded-xl">
              <img src={bird.assetUrl} alt={bird.phenotypeName} className="h-full w-full object-contain p-1.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl font-bold text-[#F6EFE2]">{bird.name}</h2>
                <span className="font-mono-num rounded bg-[#141C16] px-2 py-0.5 text-xs font-bold text-[#E8B84B] border border-[#C8922A]/35">
                  {bird.legBand}
                </span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusInfo.cls}`}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-[#E8B84B]">
                {bird.phenotypeName} · {bird.sex === 'MALE' ? '♂ Male (ZZ)' : '♀ Female (ZW)'} · Gen {bird.generationDepth}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${rarityBadgeStyle(bird.rarity)}`}>
                  {bird.rarity}
                </span>
                <span className="text-xs text-[#9EB09F]">Breeder: {bird.originalBreederName}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#C8922A]/30 p-2 text-[#9EB09F] hover:border-[#E8B84B] hover:text-[#F6EFE2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div className="mt-4 flex flex-wrap gap-2 border-b border-[#C8922A]/20 pb-3">
          <button
            type="button"
            onClick={() => setTab('overview')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
              tab === 'overview' ? 'bg-[#E8B84B] text-[#141A15]' : 'bg-[#18221B] text-[#D8CFC0] hover:bg-[#223026]'
            }`}
          >
            <Dna className="h-4 w-4" /> Genetics & Actions
          </button>
          <button
            type="button"
            onClick={() => setTab('pedigree')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
              tab === 'pedigree' ? 'bg-[#E8B84B] text-[#141A15]' : 'bg-[#18221B] text-[#D8CFC0] hover:bg-[#223026]'
            }`}
          >
            <GitBranch className="h-4 w-4" /> 3-Gen Pedigree
          </button>
          <button
            type="button"
            onClick={() => setTab('p2p')}
            disabled={liveStatus !== 'READY' && liveStatus !== 'COOLDOWN'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
              tab === 'p2p' ? 'bg-[#E8B84B] text-[#141A15]' : 'bg-[#18221B] text-[#D8CFC0] hover:bg-[#223026]'
            }`}
          >
            <Store className="h-4 w-4" /> List on P2P Trading Post
          </button>
        </div>

        {/* Tab Content */}
        {tab === 'overview' && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[#C8922A]/25 bg-[#151E18] p-3.5 space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Biological Phenotype</div>
                <p className="text-xs leading-relaxed text-[#D9CEB8]">{meta.visualDescription}</p>
                <div className="pt-1 text-xs text-[#9EB09F]">
                  Locus: <span className="font-mono-num text-[#F6EFE2]">{meta.chromosomeLabel}</span>
                </div>
                <div className="text-xs text-[#9EB09F]">
                  Mode: <span className="text-[#F6EFE2]">{meta.inheritanceMode}</span>
                </div>
              </div>

              <div className="rounded-xl border border-[#C8922A]/25 bg-[#151E18] p-3.5 space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Aviary Traits & Lifecycle</div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#9EB09F]">Plumage Symmetry</span>
                  <span className="font-mono-num font-bold text-[#F6EFE2]">{bird.plumageSymmetry} / 100</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#9EB09F]">Clutches Bred</span>
                  <span className="font-mono-num font-bold text-[#F6EFE2]">{bird.breedCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#9EB09F]">Sanctuary Appraisal</span>
                  <span className="font-mono-num font-bold text-[#E8B84B]">{formatCoins(bird.sanctuaryValue)}</span>
                </div>
                {liveStatus === 'JUVENILE' && (
                  <div className="text-xs text-sky-300">
                    Maturation remaining: <span className="font-mono-num font-bold">{formatDuration(bird.maturationTimestamp - effectiveNowMs)}</span>
                  </div>
                )}
                {liveStatus === 'COOLDOWN' && (
                  <div className="text-xs text-orange-300">
                    Post-fledge rest: <span className="font-mono-num font-bold">{formatDuration(bird.cooldownUntil - effectiveNowMs)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Fog-of-War Splits */}
            <div className="rounded-xl border border-[#C8922A]/25 bg-[#151E18] p-3.5">
              <div className="text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Known Split Carriers (Fog-of-War Ledger)</div>
              {bird.visibleSplits.length > 0 ? (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {bird.visibleSplits.map((s) => (
                    <div
                      key={s.geneKey}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs"
                    >
                      <div className="font-bold text-emerald-200">
                        {s.label} · {s.visibility} ({s.certaintyPct}%)
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#9EB09F]">{s.reason}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-[#9EB09F]">
                  No confirmed or pedigree-inferred splits revealed yet. Undiscovered recessive genes remain masked until your aviary hatches a visual mutation of that locus.
                </p>
              )}
            </div>

            {/* Rename */}
            <form onSubmit={handleRename} className="flex flex-wrap gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={32}
                className="flex-1 rounded-lg border border-[#C8922A]/40 bg-[#121914] px-3 py-2 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
                placeholder="Conure call name"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8922A]/50 bg-[#233227] px-4 py-2 text-xs font-bold text-[#E8B84B] hover:bg-[#2C3F31]"
              >
                <Edit3 className="h-3.5 w-3.5" /> Rename
              </button>
            </form>

            {/* Primary Actions */}
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                disabled={liveStatus !== 'READY'}
                onClick={() => {
                  onStartPair(bird);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#E8B84B] px-4 py-2.5 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C] disabled:opacity-40"
              >
                <Heart className="h-4 w-4" /> Select for Breeding Pair
              </button>
              <button
                type="button"
                disabled={liveStatus !== 'READY' && liveStatus !== 'COOLDOWN'}
                onClick={() => {
                  onGoToShowroom(bird);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8922A]/60 bg-[#233227] px-4 py-2.5 text-xs font-bold text-[#F6EFE2] hover:bg-[#2E4133] disabled:opacity-40"
              >
                <Award className="h-4 w-4 text-[#E8B84B]" /> Enter Exhibition Showroom
              </button>
              <button
                type="button"
                disabled={busy || liveStatus === 'BREEDING' || liveStatus === 'INCUBATING' || liveStatus === 'MARKET_P2P'}
                onClick={handleSellSanctuary}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-950/40 px-4 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-900/50 disabled:opacity-40"
              >
                <Tag className="h-4 w-4" /> Release ({formatCoins(bird.sanctuaryValue)})
              </button>
            </div>
          </div>
        )}

        {tab === 'pedigree' && (
          <div className="mt-4">
            {loadingPedigree ? (
              <div className="py-10 text-center text-sm text-[#9EB09F]">Loading 3-generation lineage ledger...</div>
            ) : pedigree ? (
              <PedigreeTree tree={pedigree} />
            ) : (
              <div className="py-8 text-center text-sm text-rose-300">Could not load pedigree tree.</div>
            )}
          </div>
        )}

        {tab === 'p2p' && (
          <form onSubmit={handleListP2P} className="mt-4 space-y-4">
            <div className="rounded-xl border border-[#C8922A]/25 bg-[#151E18] p-4 text-xs text-[#D9CEB8]">
              List <strong className="text-[#F6EFE2]">{bird.name}</strong> on the Player-to-Player Trading Post at any custom asking price. Buyers inspect full 3-generation pedigrees prior to purchase, while unmasked splits remain gated by each buyer's personal gene discovery state.
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Asking Price (Coins)
              </label>
              <input
                type="number"
                min={100}
                step={50}
                required
                value={p2pPrice}
                onChange={(e) => setP2pPrice(e.target.value)}
                className="font-mono-num mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#121914] px-3 py-2 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Breeder Note (Optional)
              </label>
              <textarea
                rows={2}
                maxLength={140}
                value={p2pNote}
                onChange={(e) => setP2pNote(e.target.value)}
                placeholder="e.g., Proven outcross line, great symmetry..."
                className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#121914] px-3 py-2 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-[#E8B84B] px-5 py-2.5 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C]"
            >
              Publish P2P Listing
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
