import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BreedingCageDTO,
  ConureDTO,
  P2PListingDTO,
  ServerTimeDTO,
  ShowroomOverviewDTO,
  SystemMarketListingDTO,
  UserProfileDTO,
} from '@shared/api-types';
import { api } from '../api/client';

export type NavTab = 'hub' | 'market' | 'aviary' | 'trading' | 'showroom' | 'compendium' | 'admin';
export type MarketSection = 'wild' | 'choice' | 'special';

export interface ToastNotice {
  id: string;
  tone: 'gold' | 'green' | 'red' | 'sky';
  title: string;
  message: string;
}

interface GameContextValue {
  user: UserProfileDTO | null;
  birds: ConureDTO[];
  activeCages: BreedingCageDTO[];
  systemMarket: SystemMarketListingDTO[];
  p2pListings: P2PListingDTO[];
  showroom: ShowroomOverviewDTO | null;
  serverTime: ServerTimeDTO | null;
  effectiveNowMs: number;
  loading: boolean;
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  marketSection: MarketSection;
  setMarketSection: (section: MarketSection) => void;
  openChoiceBird: () => void;
  supportOpen: boolean;
  setSupportOpen: (open: boolean) => void;
  toasts: ToastNotice[];
  pushToast: (toast: Omit<ToastNotice, 'id'>) => void;
  dismissToast: (id: string) => void;
  refreshAviary: () => Promise<void>;
  refreshMarket: () => Promise<void>;
  refreshP2P: () => Promise<void>;
  refreshShowroom: () => Promise<void>;
  refreshAll: () => Promise<void>;
  logout: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfileDTO | null>(null);
  const [birds, setBirds] = useState<ConureDTO[]>([]);
  const [activeCages, setActiveCages] = useState<BreedingCageDTO[]>([]);
  const [systemMarket, setSystemMarket] = useState<SystemMarketListingDTO[]>([]);
  const [p2pListings, setP2PListings] = useState<P2PListingDTO[]>([]);
  const [showroom, setShowroom] = useState<ShowroomOverviewDTO | null>(null);
  const [serverTime, setServerTime] = useState<ServerTimeDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('hub');
  const [marketSection, setMarketSection] = useState<MarketSection>('wild');
  const [supportOpen, setSupportOpen] = useState(false);

  const openChoiceBird = useCallback(() => {
    setMarketSection('choice');
    setActiveTab('market');
  }, []);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  // Server clock delta tracking (drift-proof against local client clock changes)
  const serverDeltaRef = useRef<number>(0);
  const [effectiveNowMs, setEffectiveNowMs] = useState<number>(Date.now());

  const syncClock = useCallback((st: ServerTimeDTO) => {
    serverDeltaRef.current = st.effectiveNowMs - Date.now();
    setServerTime(st);
    setEffectiveNowMs(st.effectiveNowMs);
  }, []);

  const pushToast = useCallback((toast: Omit<ToastNotice, 'id'>) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshAviary = useCallback(async () => {
    const data = await api.getAviary();
    setUser(data.user);
    setBirds(data.birds);
    setActiveCages(data.activeCages);
    syncClock(data.serverTime);

    if (data.autoHatched && data.autoHatched.length > 0) {
      for (const hatched of data.autoHatched) {
        const fosterNotice = hatched.notifications.find((n) => n.kind === 'FOSTER_OUTCOME');
        if (fosterNotice) {
          pushToast({
            tone: hatched.fosterLostCount && hatched.fosterLostCount > 0 ? 'gold' : 'green',
            title: fosterNotice.title,
            message: fosterNotice.message,
          });
        } else {
          pushToast({
            tone: 'green',
            title: 'Eggs Hatched Automatically!',
            message: `${hatched.chicks.length} downy chick(s) joined your aviary. Parents are immediately Ready!`,
          });
        }
      }
    }
  }, [syncClock, pushToast]);

  const refreshMarket = useCallback(async () => {
    const data = await api.getSystemMarket();
    setSystemMarket(data.listings);
    syncClock(data.serverTime);
  }, [syncClock]);

  const refreshP2P = useCallback(async () => {
    const data = await api.getP2PMarket();
    setP2PListings(data.listings);
  }, []);

  const refreshShowroom = useCallback(async () => {
    const data = await api.getShowroom();
    setShowroom(data);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshAviary(), refreshMarket(), refreshP2P(), refreshShowroom()]);
  }, [refreshAviary, refreshMarket, refreshP2P, refreshShowroom]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await refreshAviary();
        if (mounted) {
          await Promise.all([refreshMarket(), refreshP2P(), refreshShowroom()]);
        }
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshAviary, refreshMarket, refreshP2P, refreshShowroom]);

  // 1-second UI tick using server-calibrated clock delta + hourly market rollover refresh
  const lastBucketRef = useRef<number | null>(null);
  useEffect(() => {
    if (!serverTime) return;
    lastBucketRef.current = serverTime.currentHourBucketUtc;
  }, [serverTime]);

  const lastAviarySyncRef = useRef<number>(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now() + serverDeltaRef.current;
      setEffectiveNowMs(now);
      if (user && serverTime && now >= serverTime.nextRefreshUtcMs) {
        const currentBucket = Math.floor(now / 3_600_000) * 3_600_000;
        if (lastBucketRef.current !== currentBucket) {
          lastBucketRef.current = currentBucket;
          refreshMarket().catch(() => {});
        }
      }
      const hasDueCage = activeCages.some((c) => now >= c.hatchReadyAt);
      const hasDueReveal = birds.some(
        (b) => !b.geneticsRevealed && b.geneticsRevealTimestamp > 0 && now >= b.geneticsRevealTimestamp,
      );
      if (user && (hasDueCage || hasDueReveal) && Date.now() - lastAviarySyncRef.current > 3000) {
        lastAviarySyncRef.current = Date.now();
        refreshAviary().catch(() => {});
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [user, serverTime, activeCages, birds, refreshMarket, refreshAviary]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setBirds([]);
    setActiveCages([]);
    setSystemMarket([]);
    setP2PListings([]);
    setShowroom(null);
    setActiveTab('hub');
  }, []);

  const value = useMemo<GameContextValue>(
    () => ({
      user,
      birds,
      activeCages,
      systemMarket,
      p2pListings,
      showroom,
      serverTime,
      effectiveNowMs,
      loading,
      activeTab,
      setActiveTab,
      marketSection,
      setMarketSection,
      openChoiceBird,
      supportOpen,
      setSupportOpen,
      toasts,
      pushToast,
      dismissToast,
      refreshAviary,
      refreshMarket,
      refreshP2P,
      refreshShowroom,
      refreshAll,
      logout,
    }),
    [
      user,
      birds,
      activeCages,
      systemMarket,
      p2pListings,
      showroom,
      serverTime,
      effectiveNowMs,
      loading,
      activeTab,
      marketSection,
      openChoiceBird,
      supportOpen,
      toasts,
      pushToast,
      dismissToast,
      refreshAviary,
      refreshMarket,
      refreshP2P,
      refreshShowroom,
      refreshAll,
      logout,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
}
