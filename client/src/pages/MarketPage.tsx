import React, { useMemo, useState } from 'react';
import { Clock, Coins, Info, ShoppingBag } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { ConureCard } from '../components/ConureCard';
import { formatCoins, formatDuration } from '../components/format';
import { useGame } from '../context/GameContext';

type FilterMode = 'ALL' | 'MALE' | 'FEMALE' | 'WT' | 'MUTATIONS';
type SortMode = 'DEFAULT' | 'PRICE_ASC' | 'PRICE_DESC' | 'SYMMETRY';

export function MarketPage() {
  const { user, systemMarket, serverTime, effectiveNowMs, refreshAviary, refreshMarket, pushToast } = useGame();
  const [filter, setFilter] = useState<FilterMode>('ALL');
  const [sort, setSort] = useState<SortMode>('DEFAULT');
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const timeLeft = serverTime ? Math.max(0, serverTime.nextRefreshUtcMs - effectiveNowMs) : 0;

  const filtered = useMemo(() => {
    const list = systemMarket.filter((item) => {
      if (filter === 'MALE') return item.bird.sex === 'MALE';
      if (filter === 'FEMALE') return item.bird.sex === 'FEMALE';
      if (filter === 'WT') return item.bird.visualPhenotype === 'WT';
      if (filter === 'MUTATIONS') return item.bird.visualPhenotype !== 'WT';
      return true;
    });
    if (sort === 'PRICE_ASC') return [...list].sort((a, b) => a.price - b.price);
    if (sort === 'PRICE_DESC') return [...list].sort((a, b) => b.price - a.price);
    if (sort === 'SYMMETRY') return [...list].sort((a, b) => b.bird.plumageSymmetry - a.bird.plumageSymmetry);
    return list;
  }, [systemMarket, filter, sort]);

  const handleBuy = async (listingId: string, name: string, price: number) => {
    if (buyingId) return;
    setBuyingId(listingId);
    try {
      const res = await api.buySystemListing(listingId);
      await Promise.all([refreshAviary(), refreshMarket()]);
      pushToast({
        tone: 'green',
        title: 'Conure Acquired',
        message: `${res.bird.name} (${res.bird.legBand}) joined your aviary for ${formatCoins(price)}.`,
      });
    } catch (err) {
      await refreshMarket();
      pushToast({
        tone: 'red',
        title: 'Purchase Failed',
        message: err instanceof ApiError ? err.message : `Could not buy ${name}.`,
      });
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="brass-panel flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <ShoppingBag className="h-4 w-4" /> Canopy Wild Exchange · Hourly Stock
          </div>
          <h1 className="font-display mt-1 text-2xl font-bold text-[#F6EFE2]">System Marketplace</h1>
          <p className="mt-1 text-xs text-[#9EB09F]">
            10 fresh foundation conures spawn strictly at <span className="font-mono-num text-[#E8B84B]">:00 UTC</span> every hour. Prices carry ±20% variance; hidden split carriers remain masked under Fog of War.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-[#E8B84B]/40 bg-[#141D17] px-4 py-3 shrink-0">
          <Clock className="h-5 w-5 text-[#E8B84B]" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#9EB09F]">Next UTC Rotation</div>
            <div className="font-mono-num text-xl font-extrabold text-[#E8B84B]">{formatDuration(timeLeft)}</div>
          </div>
        </div>
      </div>

      {/* Savvy Breeder Tip */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-950/20 px-4 py-2.5 text-xs text-[#D9CEB8]">
        <Info className="h-4 w-4 shrink-0 text-[#E8B84B] mt-0.5" />
        <span>
          <strong>Breeder Insight:</strong> 30% of Exchange birds are Normal Green carriers hiding 1–2 masked splits. Split carriers receive a subtle +5% to +10% price offset within the 2,800–4,200 coin band!
        </span>
      </div>

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['ALL', 'All (10)'],
              ['MALE', 'Males ♂'],
              ['FEMALE', 'Females ♀'],
              ['WT', 'Normal Green'],
              ['MUTATIONS', 'Visual Mutations'],
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

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="rounded-lg border border-[#C8922A]/40 bg-[#18221B] px-3 py-1.5 text-xs font-bold text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
        >
          <option value="DEFAULT">Sort: Exchange Order</option>
          <option value="PRICE_ASC">Price: Low to High</option>
          <option value="PRICE_DESC">Price: High to Low</option>
          <option value="SYMMETRY">Plumage Symmetry</option>
        </select>
      </div>

      {/* Listings Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((item) => {
          const sold = item.status === 'SOLD';
          const canAfford = (user?.coins ?? 0) >= item.price;
          return (
            <div key={item.listingId} className={sold ? 'opacity-55' : ''}>
              <ConureCard
                bird={item.bird}
                nowMs={effectiveNowMs}
                hideStatus
                footer={
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 font-mono-num text-sm font-extrabold text-[#E8B84B]">
                      <Coins className="h-4 w-4" />
                      {sold ? 'SOLD' : formatCoins(item.price)}
                    </div>
                    <button
                      type="button"
                      disabled={sold || !canAfford || buyingId === item.listingId}
                      onClick={() => handleBuy(item.listingId, item.bird.name, item.price)}
                      className="rounded-lg bg-[#E8B84B] px-3.5 py-1.5 text-xs font-extrabold text-[#141A15] transition hover:bg-[#F2C75C] disabled:opacity-40"
                    >
                      {sold ? 'Acquired' : buyingId === item.listingId ? 'Buying...' : !canAfford ? 'Low Coins' : 'Acquire'}
                    </button>
                  </div>
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
