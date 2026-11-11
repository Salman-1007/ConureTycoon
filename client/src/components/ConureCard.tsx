import React from 'react';
import { Sparkles, ShieldCheck, HelpCircle } from 'lucide-react';
import type { ConureDTO } from '@shared/api-types';
import { formatDuration, getLiveBirdStatus, rarityBadgeStyle, statusBadgeStyle } from './format';

interface ConureCardProps {
  bird: ConureDTO;
  nowMs: number;
  selected?: boolean;
  hideStatus?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;
  subtitle?: string;
}

export function ConureCard({
  bird,
  nowMs,
  selected = false,
  hideStatus = false,
  onClick,
  footer,
  subtitle,
}: ConureCardProps) {
  const liveStatus = getLiveBirdStatus(bird, nowMs);
  const statusBadge = statusBadgeStyle(liveStatus);
  const isMale = bird.sex === 'MALE';

  return (
    <div
      onClick={onClick}
      className={`brass-panel group flex flex-col overflow-hidden rounded-xl transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:border-[#E8B84B]/80' : ''
      } ${selected ? 'ring-2 ring-[#E8B84B] border-[#E8B84B]' : ''}`}
    >
      {/* Clean Studio White Background Specimen Frame */}
      <div className="studio-frame relative aspect-[4/3] w-full overflow-hidden">
        <img
          src={bird.assetUrl}
          alt={`${bird.phenotypeName} Green Cheek Conure`}
          className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span className="font-mono-num rounded bg-[#141E17]/88 px-2 py-0.5 text-[11px] font-bold tracking-tight text-[#F5EFE2] shadow">
            {bird.legBand}
          </span>
        </div>
        <div className="absolute top-2 right-2">
          <span
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold shadow ${
              isMale ? 'bg-sky-700 text-white' : 'bg-rose-700 text-white'
            }`}
            title={isMale ? 'Male (ZZ)' : 'Female (ZW)'}
          >
            {isMale ? '♂' : '♀'}
          </span>
        </div>
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm bg-[#141E17]/80 ${rarityBadgeStyle(bird.rarity)}`}>
            {bird.rarity}
          </span>
          {!hideStatus ? (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm bg-[#141E17]/85 ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          ) : null}
        </div>
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-[#F6EFE2]">{bird.name}</h3>
            <p className="truncate text-xs font-semibold text-[#E8B84B]">{bird.phenotypeName}</p>
          </div>
          <span className="font-mono-num shrink-0 rounded bg-[#141C16] px-1.5 py-0.5 text-[11px] text-[#A8BAA8] border border-[#C8922A]/25">
            Gen {bird.generationDepth}
          </span>
        </div>

        {subtitle ? <p className="text-xs text-[#9EB09F]">{subtitle}</p> : null}

        <div className="flex items-center justify-between text-xs text-[#9EB09F]">
          <span>Symmetry: <strong className="font-mono-num text-[#F6EFE2]">{bird.plumageSymmetry}</strong></span>
          <span>Breeder: <strong className="text-[#D9CEB8]">{bird.originalBreederName}</strong></span>
        </div>

        {/* Live Juvenile / Cooldown Timer */}
        {liveStatus === 'JUVENILE' && (
          <div className="rounded-lg bg-sky-950/60 border border-sky-400/30 px-2.5 py-1 text-[11px] text-sky-200 flex justify-between">
            <span>Maturing</span>
            <span className="font-mono-num font-bold">{formatDuration(bird.maturationTimestamp - nowMs)}</span>
          </div>
        )}
        {liveStatus === 'COOLDOWN' && (
          <div className="rounded-lg bg-orange-950/50 border border-orange-400/30 px-2.5 py-1 text-[11px] text-orange-200 flex justify-between">
            <span>Rest Cooldown</span>
            <span className="font-mono-num font-bold">{formatDuration(bird.cooldownUntil - nowMs)}</span>
          </div>
        )}

        {/* Fog-of-War Visible Splits */}
        {bird.visibleSplits.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {bird.visibleSplits.map((split) => (
              <span
                key={split.geneKey}
                title={split.reason}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                  split.visibility === 'CONFIRMED'
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                    : 'border-sky-400/40 bg-sky-500/15 text-sky-200'
                }`}
              >
                {split.visibility === 'CONFIRMED' ? <ShieldCheck className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}
                {split.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[11px] text-[#7D8F7F]">
            <Sparkles className="h-3 w-3 opacity-60" />
            <span>No revealed split carriers</span>
          </div>
        )}

        {footer ? <div className="mt-auto pt-2 border-t border-[#C8922A]/20">{footer}</div> : null}
      </div>
    </div>
  );
}
