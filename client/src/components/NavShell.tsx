import React, { useState } from 'react';
import {
  Award,
  Bell,
  BookOpen,
  Clock,
  Coffee,
  Coins,
  Feather,
  FlaskConical,
  Home,
  LogOut,
  RefreshCw,
  Shield,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { type NavTab, useGame } from '../context/GameContext';
import { formatCoins, formatDuration } from './format';
import { SupportCreatorModal } from './SupportCreatorModal';

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'hub', label: 'Hub', shortLabel: 'Hub', icon: Home },
  { id: 'market', label: 'Wild Market', shortLabel: 'Market', icon: ShoppingBag },
  { id: 'aviary', label: 'Aviary', shortLabel: 'Aviary', icon: Feather },
  { id: 'trading', label: 'Trading Post', shortLabel: 'Trades', icon: Store },
  { id: 'showroom', label: 'Showroom', shortLabel: 'Show', icon: Award },
  { id: 'compendium', label: 'Compendium', shortLabel: 'Guide', icon: BookOpen },
];

export function NavShell({ children }: { children: React.ReactNode }) {
  const {
    user,
    activeTab,
    setActiveTab,
    openChoiceBird,
    supportOpen,
    setSupportOpen,
    serverTime,
    effectiveNowMs,
    activeCages,
    toasts,
    dismissToast,
    refreshAll,
    pushToast,
    logout,
  } = useGame();
  const [notifOpen, setNotifOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [devBusy, setDevBusy] = useState(false);

  if (!user) return <>{children}</>;

  const unreadCount = user.notifications.filter((n) => !n.read).length;
  const readyToHatchCount = activeCages.filter((c) => effectiveNowMs >= c.hatchReadyAt).length;
  const marketLeft = serverTime ? Math.max(0, serverTime.nextRefreshUtcMs - effectiveNowMs) : 0;

  const handleOpenNotifs = async () => {
    setNotifOpen((o) => !o);
    setDevOpen(false);
    if (unreadCount > 0) {
      await api.markNotificationsRead().catch(() => {});
      await refreshAll();
    }
  };

  const handleDevAdvance = async (hours: number) => {
    setDevBusy(true);
    try {
      await api.devAdvanceTime(hours);
      await refreshAll();
      pushToast({ tone: 'sky', title: 'Test Clock Advanced', message: `Server clock moved forward +${hours}h.` });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Error', message: err instanceof ApiError ? err.message : 'Failed.' });
    } finally {
      setDevBusy(false);
    }
  };

  const handleDevRefreshMarket = async () => {
    setDevBusy(true);
    try {
      await api.devRefreshMarket();
      await refreshAll();
      pushToast({ tone: 'gold', title: 'Market Rotated', message: 'Generated 10 fresh hourly conures.' });
    } catch (err) {
      pushToast({ tone: 'red', title: 'Error', message: err instanceof ApiError ? err.message : 'Failed.' });
    } finally {
      setDevBusy(false);
    }
  };

  return (
    <div className="min-h-screen pb-24 lg:pb-10">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 border-b border-[#C8922A]/30 bg-[#101813]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          {/* Brand */}
          <button
            type="button"
            onClick={() => setActiveTab('hub')}
            className="flex min-w-0 items-center gap-2 text-left sm:gap-2.5"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E8B84B]/60 bg-[#233227] text-[#E8B84B] shadow sm:h-9 sm:w-9">
              <Feather className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display truncate text-sm font-bold leading-tight text-[#F6EFE2] sm:text-base">
                <span className="sm:hidden">Conure Tycoon</span>
                <span className="hidden sm:inline">Green Cheek Conure Tycoon</span>
              </div>
              <div className="truncate text-[10px] text-[#9EB09F] sm:text-[11px]">
                {user.aviaryName} · Lv.{user.level}
              </div>
            </div>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${
                    active
                      ? 'bg-[#E8B84B] text-[#141A15] shadow'
                      : 'text-[#D9CEB8] hover:bg-[#1E2B21] hover:text-[#F6EFE2]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {item.id === 'aviary' && readyToHatchCount > 0 && (
                    <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-black text-white">
                      {readyToHatchCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Status Cluster */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* UTC Market Countdown Pill */}
            <button
              type="button"
              onClick={() => setActiveTab('market')}
              title="Next :00 UTC System Market Rotation"
              className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-[#C8922A]/35 bg-[#18221B] px-2.5 py-1.5 text-xs text-[#D9CEB8] hover:border-[#E8B84B]"
            >
              <Clock className="h-3.5 w-3.5 text-[#E8B84B]" />
              <span className="font-mono-num font-bold">{formatDuration(marketLeft)}</span>
            </button>

            {/* Support the Creator Icon (Always Visible) */}
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              title="Support the Creator (NayaPay 03324261998 / Global)"
              aria-label="Support the Creator"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-[#272013] px-2.5 py-1.5 text-xs font-bold text-[#E8B84B] hover:border-[#E8B84B] hover:bg-[#332917]"
            >
              <Coffee className="h-4 w-4" />
              <span className="hidden xl:inline">Support</span>
            </button>

            {/* Small Admin Panel Icon (Only for username=salman / admins) */}
            {user.isAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'admin' ? 'hub' : 'admin')}
                title="Admin Panel"
                aria-label="Admin Panel"
                className={`relative rounded-lg border p-2 transition ${
                  activeTab === 'admin'
                    ? 'border-[#E8B84B] bg-[#E8B84B] text-[#141A15] shadow'
                    : 'border-emerald-400/45 bg-[#15281C] text-emerald-300 hover:border-emerald-300'
                }`}
              >
                <Shield className="h-4 w-4" />
                {(user.pendingPaymentsCount ?? 0) > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                    {user.pendingPaymentsCount}
                  </span>
                )}
              </button>
            )}

            {/* Coins Pill */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-[#E8B84B]/50 bg-[#232F24] px-2 py-1.5 text-[11px] font-extrabold text-[#E8B84B] sm:gap-1.5 sm:px-3 sm:text-xs">
              <Coins className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono-num">{formatCoins(user.coins)}</span>
            </div>

            {/* Admin Test Clock (Admin Only) */}
            {user.isAdmin && user.devToolsEnabled && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setDevOpen((o) => !o);
                    setNotifOpen(false);
                  }}
                  title="Admin Testing Time Controls"
                  className="inline-flex items-center gap-1 rounded-lg border border-sky-400/40 bg-sky-950/50 p-2 text-xs font-bold text-sky-200 hover:bg-sky-900/60 sm:px-2.5 sm:py-1.5"
                >
                  <FlaskConical className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden xl:inline">Test Lab</span>
                </button>
                {devOpen && (
                  <div className="brass-panel fixed inset-x-3 top-14 z-50 rounded-xl p-4 shadow-2xl sm:inset-x-auto sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:w-72">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                        Admin Test Lab Clock
                      </span>
                      <button type="button" onClick={() => setDevOpen(false)} className="text-[#9EB09F] hover:text-white">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-[#9EB09F]">
                      Fast-forward server UTC timers (1–6h laying, 6h hatch, 3h chick genetics, +3h adulthood &amp; :00 market drops).
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={devBusy}
                        onClick={() => handleDevAdvance(1)}
                        className="rounded-lg border border-sky-400/40 bg-sky-950/60 px-2.5 py-2 text-xs font-bold text-sky-100 hover:bg-sky-900"
                      >
                        +1 Hour
                      </button>
                      <button
                        type="button"
                        disabled={devBusy}
                        onClick={() => handleDevAdvance(3)}
                        className="rounded-lg border border-sky-400/40 bg-sky-950/60 px-2.5 py-2 text-xs font-bold text-sky-100 hover:bg-sky-900"
                      >
                        +3 Hours (Genes)
                      </button>
                      <button
                        type="button"
                        disabled={devBusy}
                        onClick={() => handleDevAdvance(6)}
                        className="rounded-lg border border-sky-400/40 bg-sky-950/60 px-2.5 py-2 text-xs font-bold text-sky-100 hover:bg-sky-900"
                      >
                        +6 Hours (Hatch)
                      </button>
                      <button
                        type="button"
                        disabled={devBusy}
                        onClick={handleDevRefreshMarket}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#E8B84B]/50 bg-[#233227] px-2.5 py-2 text-xs font-bold text-[#E8B84B] hover:bg-[#2C3F31]"
                      >
                        <RefreshCw className="h-3 w-3" /> Market Drop
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={handleOpenNotifs}
                aria-label="Notifications"
                className="relative rounded-lg border border-[#C8922A]/35 bg-[#18221B] p-2 text-[#D9CEB8] hover:border-[#E8B84B]"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                    {unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="brass-panel fixed inset-x-3 top-14 z-50 max-h-[70dvh] overflow-y-auto rounded-xl p-4 shadow-2xl sm:inset-x-auto sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:max-h-96 sm:w-80">
                  <div className="flex items-center justify-between border-b border-[#C8922A]/20 pb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Aviary Log</span>
                    <button type="button" onClick={() => setNotifOpen(false)} className="text-[#9EB09F] hover:text-white">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {user.notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-[#9EB09F]">No notifications yet.</p>
                    ) : (
                      user.notifications.map((n) => (
                        <div key={n.id} className="rounded-lg border border-[#C8922A]/20 bg-[#141D17] p-2.5 text-xs">
                          <div className="font-bold text-[#E8B84B]">{n.title}</div>
                          <div className="mt-0.5 text-[#D9CEB8] leading-snug">{n.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={logout}
              title="Switch Breeder / Logout"
              aria-label="Logout"
              className="rounded-lg border border-[#C8922A]/30 bg-[#18221B] p-2 text-[#9EB09F] hover:border-rose-400/50 hover:text-rose-200"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">{children}</main>

      {/* Mobile Bottom Nav */}
      <nav className="pb-safe fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-[#C8922A]/35 bg-[#101813]/95 px-1 pt-2 backdrop-blur-md lg:hidden">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative flex min-w-[48px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-[10px] font-bold ${
                active ? 'text-[#E8B84B]' : 'text-[#9EB09F]'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.shortLabel}</span>
              {item.id === 'aviary' && readyToHatchCount > 0 && (
                <span className="absolute right-1 top-0 h-2.5 w-2.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Toast Stack */}
      <div className="fixed inset-x-3 bottom-20 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:max-w-sm lg:bottom-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`brass-panel flex items-start gap-3 rounded-xl px-4 py-3 shadow-2xl border-l-4 ${
              t.tone === 'green'
                ? 'border-l-emerald-400'
                : t.tone === 'red'
                  ? 'border-l-rose-400'
                  : t.tone === 'sky'
                    ? 'border-l-sky-400'
                    : 'border-l-[#E8B84B]'
            }`}
          >
            <div className="flex-1 text-xs">
              <div className="font-extrabold text-[#F6EFE2]">{t.title}</div>
              <div className="mt-0.5 text-[#D9CEB8]">{t.message}</div>
            </div>
            <button type="button" onClick={() => dismissToast(t.id)} className="text-[#9EB09F] hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Support the Creator Modal */}
      <SupportCreatorModal
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        onGoToChoiceBird={openChoiceBird}
      />
    </div>
  );
}
