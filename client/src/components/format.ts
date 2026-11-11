import type { BirdLifecycleStatus, ConureDTO } from '@shared/api-types';

export function formatCoins(n: number): string {
  return `${Math.round(n).toLocaleString()} Coins`;
}

export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function getLiveBirdStatus(bird: ConureDTO, nowMs: number): BirdLifecycleStatus {
  if (
    bird.lifecycleStatus === 'BREEDING' ||
    bird.lifecycleStatus === 'INCUBATING' ||
    bird.lifecycleStatus === 'MARKET_SYSTEM' ||
    bird.lifecycleStatus === 'MARKET_P2P' ||
    bird.lifecycleStatus === 'SANCTUARY'
  ) {
    return bird.lifecycleStatus;
  }
  if (nowMs < bird.maturationTimestamp) return 'JUVENILE';
  if (nowMs < bird.cooldownUntil) return 'COOLDOWN';
  return 'READY';
}

export function statusBadgeStyle(status: BirdLifecycleStatus): { label: string; cls: string } {
  switch (status) {
    case 'READY':
      return { label: 'Ready', cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' };
    case 'BREEDING':
    case 'INCUBATING':
      return { label: 'Breeding', cls: 'border-amber-400/50 bg-amber-400/15 text-amber-200' };
    case 'JUVENILE':
      return { label: 'Juvenile', cls: 'border-sky-400/50 bg-sky-400/15 text-sky-200' };
    case 'COOLDOWN':
      return { label: 'Resting', cls: 'border-orange-400/50 bg-orange-400/15 text-orange-200' };
    case 'MARKET_P2P':
      return { label: 'P2P Listed', cls: 'border-purple-400/50 bg-purple-400/15 text-purple-200' };
    default:
      return { label: status, cls: 'border-stone-500/40 bg-stone-500/15 text-stone-300' };
  }
}

export function rarityBadgeStyle(rarity: string): string {
  switch (rarity) {
    case 'Ultra-Rare':
      return 'border-amber-300/70 bg-amber-400/20 text-amber-200';
    case 'Rare':
      return 'border-rose-400/60 bg-rose-500/15 text-rose-200';
    case 'Intermediate':
      return 'border-teal-400/60 bg-teal-500/15 text-teal-200';
    case 'Common Mutation':
      return 'border-lime-400/50 bg-lime-500/15 text-lime-200';
    default:
      return 'border-stone-400/40 bg-stone-500/15 text-stone-300';
  }
}
