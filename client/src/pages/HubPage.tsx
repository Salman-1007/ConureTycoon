import React from 'react';
import { Award, BookOpen, Clock, Dna, Feather, Heart, ShoppingBag, Sparkles, Store } from 'lucide-react';
import { useGame } from '../context/GameContext';
import { formatCoins, formatDuration, getLiveBirdStatus } from '../components/format';

export function HubPage() {
  const { user, birds, activeCages, systemMarket, p2pListings, serverTime, effectiveNowMs, setActiveTab } = useGame();
  if (!user) return null;

  const readyCount = birds.filter((b) => getLiveBirdStatus(b, effectiveNowMs) === 'READY').length;
  const readyToHatch = activeCages.filter((c) => effectiveNowMs >= c.hatchReadyAt).length;
  const activeMarketCount = systemMarket.filter((l) => l.status === 'ACTIVE').length;
  const marketLeft = serverTime ? Math.max(0, serverTime.nextRefreshUtcMs - effectiveNowMs) : 0;

  const unreadBreakthrough = user.notifications.find((n) => !n.read && n.kind === 'GENOMIC_BREAKTHROUGH');

  const xpPercent =
    user.nextLevelXp <= 0
      ? 100
      : Math.min(100, Math.max(6, Math.round((user.xp / user.nextLevelXp) * 100)));

  const wings = [
    {
      tab: 'market' as const,
      title: '60-Min Wild Exchange',
      subtitle: `${activeMarketCount} conures available · Refreshes in ${formatDuration(marketLeft)}`,
      icon: ShoppingBag,
      accent: 'text-amber-300',
    },
    {
      tab: 'aviary' as const,
      title: 'Aviary & Breeding Cages',
      subtitle: `${birds.length} conures (${readyCount} ready) · ${activeCages.length} active clutches`,
      icon: Feather,
      accent: 'text-emerald-300',
    },
    {
      tab: 'trading' as const,
      title: 'P2P Trading Post',
      subtitle: `${p2pListings.length} breeder listings with public 3-gen pedigrees`,
      icon: Store,
      accent: 'text-sky-300',
    },
    {
      tab: 'showroom' as const,
      title: 'Exhibition Showroom',
      subtitle: `Compete in Novice, Color Mutation & Master Pedigree classes`,
      icon: Award,
      accent: 'text-rose-300',
    },
    {
      tab: 'compendium' as const,
      title: 'Gene Compendium & Ledger',
      subtitle: `${user.discoveredGenes.length} / 12 mutations unlocked · ${user.badges.length} prestige badges`,
      icon: BookOpen,
      accent: 'text-lime-300',
    },
  ];

  return (
    <div className="space-y-6">
      {unreadBreakthrough && (
        <div className="brass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border-emerald-400/60 bg-emerald-950/35 p-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-emerald-300 shrink-0" />
            <div>
              <div className="text-sm font-extrabold text-emerald-200">{unreadBreakthrough.title}</div>
              <div className="text-xs text-[#D9CEB8]">{unreadBreakthrough.message}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('aviary')}
            className="rounded-lg bg-emerald-400 px-3.5 py-1.5 text-xs font-extrabold text-[#102016]"
          >
            Inspect Revealed Flock
          </button>
        </div>
      )}

      {/* Aviary Banner */}
      <section className="brass-panel rounded-2xl p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-[#E8B84B]">
              Breeder Ledger · {user.displayName}
            </div>
            <h1 className="font-display mt-1 text-3xl font-extrabold text-[#F6EFE2]">{user.aviaryName}</h1>
            <div className="mt-3 max-w-md space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-bold text-[#D9CEB8]">Level {user.level} · {user.levelTitle}</span>
                <span className="font-mono-num text-[#9EB09F]">{user.xp.toLocaleString()} XP</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#111914] border border-[#C8922A]/30">
                <div className="h-full bg-gradient-to-r from-[#C8922A] to-[#E8B84B]" style={{ width: `${xpPercent}%` }} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox label="Treasury" value={formatCoins(user.coins)} />
            <StatBox label="Flock Size" value={`${birds.length}`} />
            <StatBox label="Genes Found" value={`${user.discoveredGenes.length}/12`} />
            <StatBox label="Show Wins" value={`${user.totalShowWins}`} />
          </div>
        </div>
      </section>

      {/* Active Hatch Alert */}
      {readyToHatch > 0 && (
        <div className="brass-panel flex items-center justify-between gap-4 rounded-xl border-amber-300/70 p-4">
          <div className="flex items-center gap-3">
            <Heart className="h-5 w-5 text-amber-300" />
            <span className="text-sm font-bold text-[#F6EFE2]">
              {readyToHatch} breeding {readyToHatch === 1 ? 'clutch has' : 'clutches have'} completed incubation and {readyToHatch === 1 ? 'is' : 'are'} ready to hatch!
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('aviary')}
            className="rounded-lg bg-[#E8B84B] px-4 py-2 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C]"
          >
            Open Nest Boxes
          </button>
        </div>
      )}

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {wings.map((w) => {
          const Icon = w.icon;
          return (
            <button
              key={w.tab}
              type="button"
              onClick={() => setActiveTab(w.tab)}
              className="brass-panel group flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition hover:-translate-y-0.5 hover:border-[#E8B84B]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#C8922A]/40 bg-[#141E17]">
                <Icon className={`h-5 w-5 ${w.accent}`} />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-[#F6EFE2] group-hover:text-[#E8B84B]">{w.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-[#9EB09F]">{w.subtitle}</p>
              </div>
            </button>
          );
        })}

        {/* Quick Biology Briefing */}
        <div className="brass-panel flex flex-col justify-between rounded-2xl p-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
              <Dna className="h-4 w-4" /> Avian Genetics Rulebook
            </div>
            <ul className="mt-2.5 space-y-1.5 text-xs text-[#C6D2C7]">
              <li>• Males (<span className="font-mono-num text-sky-300">ZZ</span>) carry hidden sex-linked splits; Females (<span className="font-mono-num text-rose-300">ZW</span>) express Z traits immediately.</li>
              <li>• Cinnamon &amp; Yellow-Sided cross over at <span className="font-mono-num text-[#E8B84B]">r = 0.25</span> to produce Pineapple.</li>
              <li>• Hatching any visual mutation reveals all hidden carriers of that gene across your flock!</li>
            </ul>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#9EB09F]">
            <Clock className="h-3.5 w-3.5 text-[#E8B84B]" />
            <span>UTC Server Sync Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#C8922A]/30 bg-[#141D17] px-3.5 py-2.5 text-center">
      <div className="font-mono-num text-sm font-extrabold text-[#E8B84B]">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[#9EB09F]">{label}</div>
    </div>
  );
}
