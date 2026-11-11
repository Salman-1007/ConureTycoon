import React, { useState } from 'react';
import { Coins, GitBranch, PlusCircle, Store, Trash2, X } from 'lucide-react';
import type { P2PListingDTO } from '@shared/api-types';
import { api, ApiError } from '../api/client';
import { ConureCard } from '../components/ConureCard';
import { formatCoins, getLiveBirdStatus } from '../components/format';
import { PedigreeTree } from '../components/PedigreeTree';
import { useGame } from '../context/GameContext';

export function TradingPostPage() {
  const { user, birds, p2pListings, effectiveNowMs, refreshAll, pushToast } = useGame();
  const [inspecting, setInspecting] = useState<P2PListingDTO | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBirdId, setSelectedBirdId] = useState('');
  const [price, setPrice] = useState('6000');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const listableBirds = birds.filter((b) => {
    const st = getLiveBirdStatus(b, effectiveNowMs);
    return st === 'READY' || st === 'COOLDOWN';
  });

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBirdId || busy) return;
    setBusy(true);
    try {
      await api.createP2PListing({
        birdId: selectedBirdId,
        askingPrice: Number(price),
        sellerNote: note,
      });
      await refreshAll();
      pushToast({ tone: 'gold', title: 'P2P Listing Published', message: 'Your conure is now on the Trading Post.' });
      setCreateOpen(false);
      setNote('');
    } catch (err) {
      pushToast({ tone: 'red', title: 'Listing Error', message: err instanceof ApiError ? err.message : 'Error.' });
    } finally {
      setBusy(false);
    }
  };

  const handleBuy = async (listing: P2PListingDTO) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.buyP2PListing(listing.listingId);
      await refreshAll();
      setInspecting(null);
      pushToast({
        tone: 'green',
        title: 'P2P Acquisition Complete',
        message: `Acquired ${res.bird.name} (${res.bird.legBand}) from ${listing.sellerName} for ${formatCoins(listing.askingPrice)}.`,
      });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Purchase Failed', message: err instanceof ApiError ? err.message : 'Error.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (listingId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.cancelP2PListing(listingId);
      await refreshAll();
      pushToast({ tone: 'sky', title: 'Listing Cancelled', message: 'Bird returned to your aviary.' });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Error', message: err instanceof ApiError ? err.message : 'Failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="brass-panel flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <Store className="h-4 w-4" /> Player-to-Player Trading Post
          </div>
          <h1 className="font-display mt-1 text-2xl font-bold text-[#F6EFE2]">Breeder Exchange</h1>
          <p className="mt-1 text-xs text-[#9EB09F]">
            Independent breeder marketplace with custom pricing and full public 3-generation pedigree inspection. Unmasked splits remain filtered by your personal gene discovery progress.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (listableBirds[0] && !selectedBirdId) setSelectedBirdId(listableBirds[0].id);
            setCreateOpen(true);
          }}
          disabled={listableBirds.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-[#E8B84B] px-4 py-2.5 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C] disabled:opacity-40 shrink-0"
        >
          <PlusCircle className="h-4 w-4" /> List a Conure
        </button>
      </div>

      {/* Listings */}
      {p2pListings.length === 0 ? (
        <div className="brass-panel rounded-2xl p-10 text-center text-sm text-[#9EB09F]">
          No active P2P listings right now. List one of your mature conures to open trade!
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {p2pListings.map((item) => {
            const isMine = item.sellerId === user?.id;
            const canAfford = (user?.coins ?? 0) >= item.askingPrice;
            return (
              <ConureCard
                key={item.listingId}
                bird={item.bird}
                nowMs={effectiveNowMs}
                hideStatus
                subtitle={`Seller: ${item.sellerName} (${item.sellerAviaryName})`}
                footer={
                  <div className="space-y-2.5">
                    {item.sellerNote && (
                      <p className="rounded-lg bg-[#141D17] px-2.5 py-1.5 text-[11px] italic text-[#C6D2C7]">
                        “{item.sellerNote}”
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 font-mono-num text-sm font-extrabold text-[#E8B84B]">
                        <Coins className="h-4 w-4" /> {formatCoins(item.askingPrice)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setInspecting(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#C8922A]/45 bg-[#17211A] px-2.5 py-1.5 text-[11px] font-bold text-[#D9CEB8] hover:border-[#E8B84B]"
                        >
                          <GitBranch className="h-3.5 w-3.5" /> Pedigree
                        </button>
                        {isMine ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleCancel(item.listingId)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-1.5 text-[11px] font-bold text-rose-200 hover:bg-rose-900/50"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!canAfford || busy}
                            onClick={() => handleBuy(item)}
                            className="rounded-lg bg-[#E8B84B] px-3 py-1.5 text-[11px] font-extrabold text-[#141A15] hover:bg-[#F2C75C] disabled:opacity-40"
                          >
                            {canAfford ? 'Buy' : 'Low Coins'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      {/* Pedigree Inspection Modal prior to purchase */}
      {inspecting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setInspecting(null)}
        >
          <div
            className="brass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#C8922A]/25 pb-3">
              <div>
                <h2 className="font-display text-xl font-bold text-[#F6EFE2]">
                  {inspecting.bird.name} · Public Pedigree &amp; Breeder Provenance
                </h2>
                <p className="text-xs text-[#9EB09F]">
                  Offered by {inspecting.sellerName} ({inspecting.sellerAviaryName}) for{' '}
                  <strong className="text-[#E8B84B]">{formatCoins(inspecting.askingPrice)}</strong>
                </p>
              </div>
              <button type="button" onClick={() => setInspecting(null)} className="text-[#9EB09F] hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <PedigreeTree tree={inspecting.pedigree} />

            <div className="flex justify-end gap-2 pt-2 border-t border-[#C8922A]/20">
              <button
                type="button"
                onClick={() => setInspecting(null)}
                className="rounded-lg border border-[#C8922A]/40 px-4 py-2 text-xs font-bold text-[#D9CEB8]"
              >
                Close
              </button>
              {inspecting.sellerId !== user?.id && (
                <button
                  type="button"
                  disabled={(user?.coins ?? 0) < inspecting.askingPrice || busy}
                  onClick={() => handleBuy(inspecting)}
                  className="rounded-lg bg-[#E8B84B] px-5 py-2 text-xs font-extrabold text-[#141A15] disabled:opacity-40"
                >
                  Buy for {formatCoins(inspecting.askingPrice)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create P2P Listing Modal */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setCreateOpen(false)}
        >
          <form
            onSubmit={handleCreateListing}
            onClick={(e) => e.stopPropagation()}
            className="brass-panel w-full max-w-md rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-[#F6EFE2]">Create P2P Listing</h2>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-[#9EB09F] hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Select Conure</label>
              <select
                value={selectedBirdId}
                onChange={(e) => setSelectedBirdId(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#121914] px-3 py-2 text-sm text-[#F6EFE2]"
              >
                {listableBirds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.legBand}) — {b.phenotypeName} {b.sex === 'MALE' ? '♂' : '♀'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Custom Asking Price (Coins)
              </label>
              <input
                type="number"
                min={100}
                step={50}
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="font-mono-num mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#121914] px-3 py-2 text-sm text-[#F6EFE2]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Seller Note
              </label>
              <textarea
                rows={2}
                maxLength={140}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Highlight lineage or traits..."
                className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#121914] px-3 py-2 text-sm text-[#F6EFE2]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg border border-[#C8922A]/40 px-4 py-2 text-xs font-bold text-[#D9CEB8]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-[#E8B84B] px-5 py-2 text-xs font-extrabold text-[#141A15]"
              >
                Publish Listing
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
