import React from 'react';
import { Sparkles, ShieldCheck, HelpCircle } from 'lucide-react';
import type { ConureDTO } from '@shared/api-types';
import { formatDuration, getLiveBirdStatus, rarityBadgeStyle, statusBadgeStyle } from './format';

interface ConureCardProps {
  bird: ConureDTO;
  nowMs: number;
  selected?: boolean;
  hideStatus?: boolean;
  compactOnMobile?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;
  subtitle?: string;
}

export function ConureCard({
  bird,
  nowMs,
  selected = false,
  hideStatus = false,
  compactOnMobile = false,
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
      <div className={`studio-frame relative w-full overflow-hidden ${compactOnMobile ? 'aspect-[5/4] sm:aspect-[4/3]' : 'aspect-[4/3]'}`}>
        <img
          src={bird.assetUrl}
          alt={`${bird.phenotypeName} Green Cheek Conure`}
          className={`h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03] ${compactOnMobile ? 'p-1.5 sm:p-2' : 'p-2'}`}
          loading="lazy"
        />
        <div className={`absolute flex items-center gap-1.5 ${compactOnMobile ? 'top-1.5 left-1.5 sm:top-2 sm:left-2' : 'top-2 left-2'}`}>
          <span
            className={`font-mono-num rounded bg-[#141E17]/88 font-bold tracking-tight text-[#F5EFE2] shadow ${
              compactOnMobile ? 'px-1.5 py-0.5 text-[9px] sm:px-2 sm:text-[11px]' : 'px-2 py-0.5 text-[11px]'
            }`}
          >
            {bird.legBand}
          </span>
        </div>
        <div className={`absolute ${compactOnMobile ? 'top-1.5 right-1.5 sm:top-2 sm:right-2' : 'top-2 right-2'}`}>
          <span
            className={`inline-flex items-center justify-center rounded-full font-extrabold shadow ${
              compactOnMobile ? 'h-6 w-6 text-xs sm:h-7 sm:w-7 sm:text-sm' : 'h-7 w-7 text-sm'
            } ${isMale ? 'bg-sky-700 text-white' : 'bg-rose-700 text-white'}`}
            title={isMale ? 'Male (ZZ)' : 'Female (ZW)'}
          >
            {isMale ? '♂' : '♀'}
          </span>
        </div>
        <div
          className={`absolute flex items-center justify-between gap-1 ${
            compactOnMobile ? 'bottom-1.5 left-1.5 right-1.5 sm:bottom-2 sm:left-2 sm:right-2' : 'bottom-2 left-2 right-2'
          }`}
        >
          <span
            className={`min-w-0 truncate rounded-full border font-bold backdrop-blur-sm bg-[#141E17]/80 ${
              compactOnMobile ? 'px-1.5 py-0.5 text-[9px] sm:px-2 sm:text-[10px]' : 'px-2 py-0.5 text-[10px]'
            } ${rarityBadgeStyle(bird.rarity)}`}
          >
            {bird.rarity}
          </span>
          {!hideStatus ? (
            <span
              className={`shrink-0 rounded-full border font-bold backdrop-blur-sm bg-[#141E17]/85 ${
                compactOnMobile ? 'px-1.5 py-0.5 text-[9px] sm:px-2 sm:text-[10px]' : 'px-2 py-0.5 text-[10px]'
              } ${statusBadge.cls}`}
            >
              {statusBadge.label}
            </span>
          ) : null}
        </div>
      </div>

      {/* Card Body */}
      <div className={`flex flex-1 flex-col ${compactOnMobile ? 'gap-1.5 p-2.5 sm:gap-2 sm:p-3.5' : 'gap-2 p-3.5'}`}>
        <div className="flex items-start justify-between gap-1.5 sm:gap-2">
          <div className="min-w-0">
            <h3 className={`truncate font-bold text-[#F6EFE2] ${compactOnMobile ? 'text-xs sm:text-base' : 'text-base'}`}>
              {bird.name}
            </h3>
            <p className={`truncate font-semibold text-[#E8B84B] ${compactOnMobile ? 'text-[10px] sm:text-xs' : 'text-xs'}`}>
              {bird.phenotypeName}
            </p>
          </div>
          <span
            className={`font-mono-num shrink-0 rounded bg-[#141C16] text-[#A8BAA8] border border-[#C8922A]/25 ${
              compactOnMobile ? 'px-1 py-0.5 text-[9px] sm:px-1.5 sm:text-[11px]' : 'px-1.5 py-0.5 text-[11px]'
            }`}
          >
            Gen {bird.generationDepth}
          </span>
        </div>

        {subtitle ? <p className={compactOnMobile ? 'text-[10px] sm:text-xs text-[#9EB09F]' : 'text-xs text-[#9EB09F]'}>{subtitle}</p> : null}

        <div className={`flex items-center justify-between gap-1 text-[#9EB09F] ${compactOnMobile ? 'text-[10px] sm:text-xs' : 'text-xs'}`}>
          <span className="shrink-0">
            {compactOnMobile ? (
              <>
                Sym<span className="hidden sm:inline">metry</span>:{' '}
              </>
            ) : (
              'Symmetry: '
            )}
            <strong className="font-mono-num text-[#F6EFE2]">{bird.plumageSymmetry}</strong>
          </span>
          <span className="min-w-0 truncate text-right">
            {compactOnMobile ? <span className="hidden sm:inline">Breeder: </span> : 'Breeder: '}
            <strong className="text-[#D9CEB8]">{bird.originalBreederName}</strong>
          </span>
        </div>

        {/* Live Juvenile / Cooldown Timer */}
        {liveStatus === 'JUVENILE' && (
          !bird.geneticsRevealed && nowMs < bird.geneticsRevealTimestamp ? (
            <div
              className={`rounded-lg bg-amber-950/60 border border-amber-400/35 text-amber-200 flex justify-between gap-1 ${
                compactOnMobile ? 'px-1.5 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-[11px]' : 'px-2.5 py-1 text-[11px]'
              }`}
            >
              <span>{compactOnMobile ? <><span className="sm:hidden">Genes</span><span className="hidden sm:inline">Genetics Reveal</span></> : 'Genetics Reveal'}</span>
              <span className="font-mono-num font-bold">{formatDuration(bird.geneticsRevealTimestamp - nowMs)}</span>
            </div>
          ) : (
            <div
              className={`rounded-lg bg-sky-950/60 border border-sky-400/30 text-sky-200 flex justify-between gap-1 ${
                compactOnMobile ? 'px-1.5 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-[11px]' : 'px-2.5 py-1 text-[11px]'
              }`}
            >
              <span>{compactOnMobile ? <><span className="sm:hidden">Adult</span><span className="hidden sm:inline">Adult Ready In</span></> : 'Adult Ready In'}</span>
              <span className="font-mono-num font-bold">{formatDuration(bird.maturationTimestamp - nowMs)}</span>
            </div>
          )
        )}
        {liveStatus === 'COOLDOWN' && (
          <div
            className={`rounded-lg bg-orange-950/50 border border-orange-400/30 text-orange-200 flex justify-between gap-1 ${
              compactOnMobile ? 'px-1.5 py-0.5 text-[9px] sm:px-2.5 sm:py-1 sm:text-[11px]' : 'px-2.5 py-1 text-[11px]'
            }`}
          >
            <span>{compactOnMobile ? <><span className="sm:hidden">Rest</span><span className="hidden sm:inline">Rest Cooldown</span></> : 'Rest Cooldown'}</span>
            <span className="font-mono-num font-bold">{formatDuration(bird.cooldownUntil - nowMs)}</span>
          </div>
        )}

        {/* Fog-of-War Visible Splits */}
        {!bird.geneticsRevealed && nowMs < bird.geneticsRevealTimestamp ? (
          <div className={`flex items-center gap-1 text-amber-200/80 ${compactOnMobile ? 'text-[10px] sm:text-[11px]' : 'text-[11px]'}`}>
            <Sparkles className="h-3 w-3 shrink-0 opacity-80" />
            <span className="truncate">
              {compactOnMobile ? (
                <>
                  <span className="sm:hidden">Downy · +3h reveal</span>
                  <span className="hidden sm:inline">Downy chick · feathers reveal genetics at +3h</span>
                </>
              ) : (
                'Downy chick · feathers reveal genetics at +3h'
              )}
            </span>
          </div>
        ) : bird.visibleSplits.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {bird.visibleSplits.map((split) => (
              <span
                key={split.geneKey}
                title={split.reason}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-bold ${
                  compactOnMobile ? 'text-[9px] sm:text-[10px]' : 'text-[10px]'
                } ${
                  split.visibility === 'CONFIRMED'
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                    : 'border-sky-400/40 bg-sky-500/15 text-sky-200'
                }`}
              >
                {split.visibility === 'CONFIRMED' ? <ShieldCheck className="h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" /> : <HelpCircle className="h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" />}
                {split.label}
              </span>
            ))}
          </div>
        ) : (
          <div className={`flex items-center gap-1 text-[#7D8F7F] ${compactOnMobile ? 'text-[10px] sm:text-[11px]' : 'text-[11px]'}`}>
            <Sparkles className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">
              {compactOnMobile ? (
                <>
                  <span className="sm:hidden">No revealed splits</span>
                  <span className="hidden sm:inline">No revealed split carriers</span>
                </>
              ) : (
                'No revealed split carriers'
              )}
            </span>
          </div>
        )}

        {footer ? <div className={`mt-auto border-t border-[#C8922A]/20 ${compactOnMobile ? 'pt-1.5 sm:pt-2' : 'pt-2'}`}>{footer}</div> : null}
      </div>
    </div>
  );
}
