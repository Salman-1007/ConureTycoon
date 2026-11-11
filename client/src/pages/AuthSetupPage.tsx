import React, { useState } from 'react';
import { Feather, Lock, Sparkles, UserPlus } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useGame } from '../context/GameContext';
import { formatCoins } from '../components/format';

const SHOWCASE_IMAGES = [
  { label: 'Normal Green', src: '/assets/conures/normal_green.png' },
  { label: 'Pineapple', src: '/assets/conures/pineapple.png' },
  { label: 'Turquoise', src: '/assets/conures/turquoise.png' },
  { label: 'Suncheek', src: '/assets/conures/suncheek.png' },
  { label: 'Mint', src: '/assets/conures/mint.png' },
  { label: 'Mooncheek', src: '/assets/conures/mooncheek.png' },
];

export function AuthSetupPage() {
  const { refreshAll, pushToast } = useGame();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [aviaryName, setAviaryName] = useState('');
  const [startingCoins, setStartingCoins] = useState(15000);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') {
        await api.register({
          username,
          password,
          displayName: displayName || username,
          aviaryName: aviaryName || `${displayName || username}'s Canopy Aviary`,
          startingCoins,
        });
        await refreshAll();
        pushToast({
          tone: 'gold',
          title: 'Aviary Established',
          message: 'Welcome! You start with 3 Normal Green foundation conures and NORMAL_GREEN unlocked.',
        });
      } else {
        await api.login({ username, password });
        await refreshAll();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to authenticate.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-8 md:py-12">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-12 items-center">
        {/* Hero Showcase */}
        <div className="lg:col-span-7 space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E8B84B]/40 bg-[#1B271E] px-3.5 py-1 text-xs font-bold text-[#E8B84B]">
            <Sparkles className="h-3.5 w-3.5" /> Pyrrhura molinae · Biological Breeding &amp; Economy Simulator
          </div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-[#F6EFE2] md:text-5xl">
            Green Cheek Conure Tycoon
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-[#C6D2C7] md:text-base">
            Build an authentic avian breeding sanctuary driven by real ZZ/ZW sex-linked chromosomes, autosomal recessive loci, Z-chromosome crossover recombination (<span className="font-mono-num text-[#E8B84B]">r = 0.25</span>), Fog-of-War gene discovery, server-authoritative hourly markets, P2P trading, and pedigree exhibition shows.
          </p>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {SHOWCASE_IMAGES.map((item) => (
              <div key={item.label} className="brass-panel overflow-hidden rounded-xl">
                <div className="studio-frame aspect-square w-full p-1">
                  <img src={item.src} alt={item.label} className="h-full w-full object-contain" />
                </div>
                <div className="px-1.5 py-1 text-center text-[10px] font-bold text-[#D9CEB8] truncate">
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Auth / Setup Card */}
        <div className="brass-panel lg:col-span-5 rounded-2xl p-6">
          <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-[#111914] p-1 border border-[#C8922A]/25">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                mode === 'register' ? 'bg-[#E8B84B] text-[#141A15]' : 'text-[#9EB09F] hover:text-white'
              }`}
            >
              <UserPlus className="h-4 w-4" /> Establish Aviary
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                mode === 'login' ? 'bg-[#E8B84B] text-[#141A15]' : 'text-[#9EB09F] hover:text-white'
              }`}
            >
              <Lock className="h-4 w-4" /> Sign In
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. canopy_breeder"
                className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 4 characters"
                className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
              />
            </div>

            {mode === 'register' && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Breeder Name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Irfan"
                      className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">Aviary Name</label>
                    <input
                      type="text"
                      value={aviaryName}
                      onChange={(e) => setAviaryName(e.target.value)}
                      placeholder="Emerald Canopy Aviary"
                      className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                    Starting Capital
                  </label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {[10000, 15000, 20000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setStartingCoins(amt)}
                        className={`font-mono-num rounded-lg border py-2 text-xs font-bold transition ${
                          startingCoins === amt
                            ? 'border-[#E8B84B] bg-[#2B3D30] text-[#E8B84B]'
                            : 'border-[#C8922A]/25 bg-[#131C16] text-[#9EB09F] hover:text-white'
                        }`}
                      >
                        {formatCoins(amt)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="rounded-lg border border-rose-500/50 bg-rose-950/50 px-3 py-2 text-xs font-semibold text-rose-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E8B84B] py-3 text-sm font-extrabold text-[#141A15] shadow-lg transition hover:bg-[#F2C75C] disabled:opacity-50"
            >
              <Feather className="h-4 w-4" />
              {busy ? 'Opening Aviary...' : mode === 'register' ? 'Establish Aviary & Begin' : 'Enter Saved Aviary'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
