import React, { useState } from 'react';
import { Feather } from 'lucide-react';
import type { ConureDTO } from '@shared/api-types';
import { NavShell } from './components/NavShell';
import { GameProvider, useGame } from './context/GameContext';
import { AuthSetupPage } from './pages/AuthSetupPage';
import { AviaryPage } from './pages/AviaryPage';
import { CompendiumPage } from './pages/CompendiumPage';
import { HubPage } from './pages/HubPage';
import { MarketPage } from './pages/MarketPage';
import { ShowroomPage } from './pages/ShowroomPage';
import { TradingPostPage } from './pages/TradingPostPage';

function MainRouter() {
  const { user, loading, activeTab, setActiveTab } = useGame();
  const [showroomPreselect, setShowroomPreselect] = useState<ConureDTO | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#E8B84B]/60 bg-[#1F2D23] text-[#E8B84B] animate-pulse">
          <Feather className="h-6 w-6" />
        </div>
        <div className="font-display text-xl font-bold text-[#F6EFE2]">Green Cheek Conure Tycoon</div>
        <div className="text-xs text-[#9EB09F]">Synchronizing with UTC server ledger...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthSetupPage />;
  }

  return (
    <NavShell>
      {activeTab === 'hub' && <HubPage />}
      {activeTab === 'market' && <MarketPage />}
      {activeTab === 'aviary' && (
        <AviaryPage
          onSendToShowroom={(bird) => {
            setShowroomPreselect(bird);
            setActiveTab('showroom');
          }}
        />
      )}
      {activeTab === 'trading' && <TradingPostPage />}
      {activeTab === 'showroom' && (
        <ShowroomPage
          preselectedBird={showroomPreselect}
          onClearPreselect={() => setShowroomPreselect(null)}
        />
      )}
      {activeTab === 'compendium' && <CompendiumPage />}
    </NavShell>
  );
}

export default function App() {
  return (
    <GameProvider>
      <MainRouter />
    </GameProvider>
  );
}
