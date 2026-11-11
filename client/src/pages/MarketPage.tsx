import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Coffee, Coins, Info, Send, ShoppingBag, Sparkles, Star } from 'lucide-react';
import type { SpecialBirdDTO, SupportConfigDTO } from '@shared/api-types';
import { api, ApiError } from '../api/client';
import { ChoiceBirdPanel } from '../components/ChoiceBirdPanel';
import { ConureCard } from '../components/ConureCard';
import { formatCoins, formatDuration } from '../components/format';
import { PaymentAccountCard, type PaymentRegion } from '../components/PaymentAccountCard';
import { useGame } from '../context/GameContext';

type FilterMode = 'ALL' | 'MALE' | 'FEMALE' | 'WT' | 'MUTATIONS';
type SortMode = 'DEFAULT' | 'PRICE_ASC' | 'PRICE_DESC' | 'SYMMETRY';

export function MarketPage() {
  const {
    user,
    systemMarket,
    serverTime,
    effectiveNowMs,
    marketSection,
    setMarketSection,
    refreshAviary,
    refreshMarket,
    pushToast,
  } = useGame();

  const [filter, setFilter] = useState<FilterMode>('ALL');
  const [sort, setSort] = useState<SortMode>('DEFAULT');
  const [buyingId, setBuyingId] = useState<string | null>(null);

  // Special Bird state
  const [liveSpecial, setLiveSpecial] = useState<SpecialBirdDTO | null>(null);
  const [supportConfig, setSupportConfig] = useState<SupportConfigDTO | null>(null);
  const [specialRegion, setSpecialRegion] = useState<PaymentRegion>('PK');
  const [specialSenderName, setSpecialSenderName] = useState('');
  const [specialSenderPhone, setSpecialSenderPhone] = useState('');
  const [specialRefNote, setSpecialRefNote] = useState('');
  const [specialMethod, setSpecialMethod] = useState('NayaPay (03324261998)');
  const [specialBusy, setSpecialBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getLiveSpecialBird().catch(() => null),
      api.getSupportConfig().catch(() => null),
    ]).then(([sb, sc]) => {
      if (sb?.specialBird) setLiveSpecial(sb.specialBird);
      else if (marketSection === 'special') setMarketSection('wild');
      if (sc?.supportConfig) setSupportConfig(sc.supportConfig);
    });
  }, [marketSection, setMarketSection]);

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

  const handleClaimSpecialBird = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveSpecial || specialBusy) return;
    setSpecialBusy(true);
    try {
      await api.submitSpecialBirdPayment(liveSpecial.id, {
        senderName: specialSenderName,
        senderPhone: specialSenderPhone,
        referenceNote: specialRefNote,
        paymentMethod: specialMethod,
        currency: specialRegion === 'PK' ? 'PKR' : 'USD',
        amount: specialRegion === 'PK' ? liveSpecial.pricePkr : Math.max(5, Math.round(liveSpecial.pricePkr / 280)),
      });
      pushToast({
        tone: 'green',
        title: 'Special Bird Claim Submitted',
        message: `Admin Salman will verify ${specialSenderName}'s transfer and deliver ${liveSpecial.name}!`,
      });
      setSpecialSenderName('');
      setSpecialSenderPhone('');
      setSpecialRefNote('');
    } catch (err) {
      pushToast({
        tone: 'red',
        title: 'Claim Failed',
        message: err instanceof ApiError ? err.message : 'Please check your sender name.',
      });
    } finally {
      setSpecialBusy(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header Banner */}
      <div className="brass-panel flex flex-col gap-4 rounded-2xl p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
            <ShoppingBag className="h-4 w-4" /> Canopy Wild Exchange · Hourly Stock
          </div>
          <h1 className="font-display mt-1 text-xl font-bold text-[#F6EFE2] sm:text-2xl">
            Conure Marketplace
          </h1>
          <p className="mt-1 text-xs text-[#9EB09F]">
            10 fresh foundation conures spawn strictly at <span className="font-mono-num text-[#E8B84B]">:00 UTC</span> every hour — or buy the creator a coffee to receive any custom mutation &amp; gender of your choice!
          </p>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          {/* Prominent Get Bird of Your Choice Icon Button */}
          <button
            type="button"
            onClick={() => setMarketSection('choice')}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-left transition ${
              marketSection === 'choice'
                ? 'border-[#E8B84B] bg-[#E8B84B] text-[#141A15] shadow-lg'
                : 'border-amber-400/60 bg-gradient-to-r from-[#2A2212] to-[#1D281E] text-[#F6EFE2] hover:border-[#E8B84B]'
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                marketSection === 'choice' ? 'bg-[#141A15]/15 text-[#141A15]' : 'bg-[#E8B84B]/20 text-[#E8B84B]'
              }`}
            >
              <Coffee className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-extrabold leading-tight">Get Bird of Your Choice</div>
              <div
                className={`text-[10px] ${
                  marketSection === 'choice' ? 'text-[#141A15]/80' : 'text-[#E8B84B]'
                }`}
              >
                Buy a coffee · Pick mutation &amp; gender
              </div>
            </div>
          </button>

          <div className="flex items-center gap-3 rounded-xl border border-[#E8B84B]/40 bg-[#141D17] px-4 py-2.5 shrink-0">
            <Clock className="h-5 w-5 text-[#E8B84B]" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#9EB09F]">Next UTC Rotation</div>
              <div className="font-mono-num text-lg font-extrabold text-[#E8B84B] sm:text-xl">
                {formatDuration(timeLeft)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Market Section Switcher */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        <button
          type="button"
          onClick={() => setMarketSection('wild')}
          className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${
            marketSection === 'wild'
              ? 'bg-[#E8B84B] text-[#141A15] shadow'
              : 'border border-[#C8922A]/30 bg-[#18221B] text-[#D9CEB8] hover:border-[#E8B84B]/60'
          }`}
        >
          <ShoppingBag className="h-4 w-4" /> Wild Exchange (Coins)
        </button>

        <button
          type="button"
          onClick={() => setMarketSection('choice')}
          className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${
            marketSection === 'choice'
              ? 'bg-[#E8B84B] text-[#141A15] shadow'
              : 'border border-[#C8922A]/30 bg-[#18221B] text-[#D9CEB8] hover:border-[#E8B84B]/60'
          }`}
        >
          <Coffee className="h-4 w-4" /> Get Bird of Your Choice
        </button>

        {liveSpecial && (
          <button
            type="button"
            onClick={() => setMarketSection('special')}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${
              marketSection === 'special'
                ? 'bg-emerald-400 text-[#0F1812] shadow'
                : 'border border-emerald-400/40 bg-emerald-950/35 text-emerald-200 hover:border-emerald-300'
            }`}
          >
            <Sparkles className="h-4 w-4" /> Featured Special Bird · {liveSpecial.name}
          </button>
        )}
      </div>

      {/* CHOICE BIRD TAB */}
      {marketSection === 'choice' && <ChoiceBirdPanel />}

      {/* SPECIAL BIRD TAB */}
      {marketSection === 'special' && liveSpecial && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="brass-panel space-y-4 rounded-2xl p-4 sm:p-5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-950/50 px-3 py-1 text-[11px] font-bold text-emerald-300">
              <Star className="h-3.5 w-3.5" /> Limited Featured Conure · {liveSpecial.stock} left
            </div>
            <div className="studio-frame h-52 w-full overflow-hidden rounded-xl border border-[#C8922A]/25">
              <img
                src={liveSpecial.imageUrl}
                alt={liveSpecial.name}
                className="h-full w-full object-contain p-3"
              />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-[#F6EFE2]">{liveSpecial.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#E8B84B]">
                <span>{liveSpecial.mutationName}</span>
                <span>·</span>
                <span>{liveSpecial.sex === 'MALE' ? '♂ Male' : '♀ Female'}</span>
                <span>·</span>
                <span>{liveSpecial.plumageSymmetry}% Symmetry</span>
                <span>·</span>
                <span className="font-mono-num font-extrabold">Rs. {liveSpecial.pricePkr} PKR</span>
              </div>
              {liveSpecial.description && (
                <p className="mt-2 text-xs text-[#C8D3C2]">{liveSpecial.description}</p>
              )}
            </div>

            {supportConfig && (
              <PaymentAccountCard
                config={supportConfig}
                region={specialRegion}
                onRegionChange={(r) => {
                  setSpecialRegion(r);
                  setSpecialMethod(r === 'PK' ? 'NayaPay (03324261998)' : 'Wise / Remitly (Foreign)');
                }}
              />
            )}
          </div>

          <form
            onSubmit={handleClaimSpecialBird}
            className="brass-panel space-y-4 rounded-2xl p-4 sm:p-5"
          >
            <h3 className="font-display text-lg font-bold text-[#F6EFE2]">
              Claim {liveSpecial.name} After Payment
            </h3>
            <p className="text-xs text-[#9EB09F]">
              Send <strong className="text-[#E8B84B]">Rs. {liveSpecial.pricePkr} PKR</strong> (or foreign equivalent) to NayaPay{' '}
              <strong className="font-mono-num text-[#E8B84B]">03324261998</strong>, then enter your sender name below. Once Salman approves, this bird lands in your Aviary!
            </p>

            <div>
              <label className="text-xs font-semibold text-[#C8D3C2]">Payment Channel</label>
              <input
                type="text"
                value={specialMethod}
                onChange={(e) => setSpecialMethod(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#C8922A]/35 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#C8D3C2]">
                Sender Name * (Name shown on your payment receipt)
              </label>
              <input
                type="text"
                required
                value={specialSenderName}
                onChange={(e) => setSpecialSenderName(e.target.value)}
                placeholder="e.g. Ali Raza"
                className="mt-1 w-full rounded-xl border border-[#E8B84B]/45 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Sender Phone / Last 4 Digits</label>
                <input
                  type="text"
                  value={specialSenderPhone}
                  onChange={(e) => setSpecialSenderPhone(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/35 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">TRX ID / Reference Note</label>
                <input
                  type="text"
                  value={specialRefNote}
                  onChange={(e) => setSpecialRefNote(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/35 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={specialBusy || !specialSenderName.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 py-3 text-sm font-extrabold text-[#0E1811] shadow-lg transition hover:bg-emerald-300 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {specialBusy ? 'Submitting...' : 'I Have Paid · Claim Special Bird'}
            </button>
          </form>
        </div>
      )}

      {/* WILD EXCHANGE TAB */}
      {marketSection === 'wild' && (
        <>
          {/* Savvy Breeder Tip */}
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-950/20 px-4 py-2.5 text-xs text-[#D9CEB8]">
            <Info className="h-4 w-4 shrink-0 text-[#E8B84B] mt-0.5" />
            <span>
              <strong>Breeder Insight:</strong> 30% of Exchange birds are Normal Green carriers hiding 1–2 masked splits. Split carriers receive a subtle +5% to +10% price offset within the 2,800–4,200 coin band!
            </span>
          </div>

          {/* Filters & Sort */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:flex-wrap sm:pb-0">
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
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
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
              className="w-full rounded-lg border border-[#C8922A]/40 bg-[#18221B] px-3 py-2 text-xs font-bold text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none sm:w-auto sm:py-1.5"
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
                          className="rounded-lg bg-[#E8B84B] px-3.5 py-2 text-xs font-extrabold text-[#141A15] transition hover:bg-[#F2C75C] disabled:opacity-40 sm:py-1.5"
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
        </>
      )}
    </div>
  );
}
