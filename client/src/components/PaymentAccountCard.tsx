import React, { useState } from 'react';
import { Check, Coffee, Copy, ExternalLink, Globe, Smartphone } from 'lucide-react';
import type { SupportConfigDTO } from '@shared/api-types';

export type PaymentRegion = 'PK' | 'INTL';

export const FOREIGN_CURRENCIES = [
  { code: 'USD', symbol: '$', approxPerUsdInPkr: 278 },
  { code: 'GBP', symbol: '£', approxPerUsdInPkr: 355 },
  { code: 'EUR', symbol: '€', approxPerUsdInPkr: 300 },
  { code: 'CAD', symbol: 'C$', approxPerUsdInPkr: 200 },
  { code: 'AUD', symbol: 'A$', approxPerUsdInPkr: 182 },
  { code: 'AED', symbol: 'AED ', approxPerUsdInPkr: 76 },
  { code: 'SAR', symbol: 'SAR ', approxPerUsdInPkr: 74 },
] as const;

interface PaymentAccountCardProps {
  config: SupportConfigDTO;
  region: PaymentRegion;
  onRegionChange: (region: PaymentRegion) => void;
  selectedCurrency?: string;
  onSelectPreset?: (amount: number, currency: string, method: string) => void;
}

export function PaymentAccountCard({
  config,
  region,
  onRegionChange,
  selectedCurrency = 'USD',
  onSelectPreset,
}: PaymentAccountCardProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [intlCur, setIntlCur] = useState<string>(
    FOREIGN_CURRENCIES.some((c) => c.code === selectedCurrency) ? selectedCurrency : 'USD',
  );

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // Fallback ignored if clipboard permission unavailable
    }
  };

  const curMeta = FOREIGN_CURRENCIES.find((c) => c.code === intlCur) ?? FOREIGN_CURRENCIES[0];

  return (
    <div className="rounded-xl border border-[#E8B84B]/40 bg-[#121A14] p-3.5 sm:p-4 space-y-3">
      {/* Region Switcher */}
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#0D130F] p-1 border border-[#C8922A]/25">
        <button
          type="button"
          onClick={() => onRegionChange('PK')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-bold transition ${
            region === 'PK' ? 'bg-[#E8B84B] text-[#141A15]' : 'text-[#9EB09F] hover:text-white'
          }`}
        >
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Pakistan (NayaPay)</span>
        </button>
        <button
          type="button"
          onClick={() => onRegionChange('INTL')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-bold transition ${
            region === 'INTL' ? 'bg-[#E8B84B] text-[#141A15]' : 'text-[#9EB09F] hover:text-white'
          }`}
        >
          <Globe className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Foreign / Global</span>
        </button>
      </div>

      {region === 'PK' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/35 bg-emerald-950/25 p-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                NayaPay / Raast / JazzCash / Easypaisa
              </div>
              <div className="font-mono-num mt-0.5 text-lg sm:text-xl font-extrabold tracking-wide text-[#F6EFE2]">
                {config.nayapayNumber}
              </div>
              <div className="text-xs text-[#9EB09F]">
                Account Title: <strong className="text-[#D9CEB8]">{config.accountTitle}</strong>
              </div>
            </div>
            <button
              type="button"
              onClick={() => copyValue('pk', config.nayapayNumber)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E8B84B]/50 bg-[#1C2820] px-3 py-2 text-xs font-bold text-[#E8B84B] hover:bg-[#25362B]"
            >
              {copiedKey === 'pk' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey === 'pk' ? 'Copied!' : 'Copy No.'}
            </button>
          </div>

          {onSelectPreset && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-[#9EB09F]">Quick Coffee Tiers (PKR):</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {[
                  { label: '☕ Rs 300', amount: 300 },
                  { label: '☕☕ Rs 500', amount: 500 },
                  { label: '🦜 Rs 1,000', amount: 1000 },
                  { label: '👑 Rs 2,000', amount: 2000 },
                ].map((tier) => (
                  <button
                    key={tier.amount}
                    type="button"
                    onClick={() => onSelectPreset(tier.amount, 'PKR', 'NayaPay (03324261998)')}
                    className="rounded-lg border border-[#C8922A]/35 bg-[#18231B] px-2 py-1.5 text-xs font-bold text-[#E8B84B] hover:border-[#E8B84B] hover:bg-[#233227]"
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-sky-400/35 bg-sky-950/25 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                  International → NayaPay Pakistan Wallet
                </div>
                <div className="font-mono-num mt-0.5 text-lg font-extrabold text-[#F6EFE2]">
                  {config.internationalNumber}
                </div>
                <div className="text-xs text-[#9EB09F]">
                  Recipient: <strong className="text-[#D9CEB8]">{config.accountTitle}</strong> · Wallet: <strong className="text-[#D9CEB8]">NayaPay</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyValue('intl', config.internationalNumber)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/50 bg-[#17242C] px-3 py-2 text-xs font-bold text-sky-200 hover:bg-[#1E313B]"
              >
                {copiedKey === 'intl' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey === 'intl' ? 'Copied!' : 'Copy +92'}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-[#C6D2C7]">
              {config.customForeignNote}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {['Wise', 'Remitly', 'Taptap Send', 'WorldRemit', 'Western Union'].map((app) => (
                <span
                  key={app}
                  className="rounded-md border border-sky-400/30 bg-[#101B22] px-2 py-0.5 text-[10px] font-bold text-sky-200"
                >
                  {app}
                </span>
              ))}
            </div>
          </div>

          {/* Optional extra creator channels if configured in Admin */}
          {(config.iban || config.wiseTag || config.paypalEmail || config.kofiUrl || config.binanceId) && (
            <div className="space-y-1.5 rounded-xl border border-[#C8922A]/30 bg-[#17211A] p-3 text-xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#E8B84B]">
                Direct Global Channels
              </div>
              {config.iban && (
                <DetailRow label="Bank IBAN" value={config.iban} onCopy={() => copyValue('iban', config.iban)} copied={copiedKey === 'iban'} />
              )}
              {config.wiseTag && (
                <DetailRow label="Wise Tag" value={config.wiseTag} onCopy={() => copyValue('wise', config.wiseTag)} copied={copiedKey === 'wise'} />
              )}
              {config.paypalEmail && (
                <DetailRow label="PayPal" value={config.paypalEmail} onCopy={() => copyValue('pp', config.paypalEmail)} copied={copiedKey === 'pp'} />
              )}
              {config.binanceId && (
                <DetailRow label="Binance Pay" value={config.binanceId} onCopy={() => copyValue('bn', config.binanceId)} copied={copiedKey === 'bn'} />
              )}
              {config.kofiUrl && (
                <a
                  href={config.kofiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#E8B84B] px-3 py-1.5 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C]"
                >
                  <Coffee className="h-3.5 w-3.5" /> Open Coffee Link <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {/* Currency & Coffee Tier Helper */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#9EB09F]">Foreign Coffee Estimator:</span>
              <select
                value={intlCur}
                onChange={(e) => setIntlCur(e.target.value)}
                className="rounded-lg border border-[#C8922A]/40 bg-[#18221B] px-2.5 py-1 text-xs font-bold text-[#F6EFE2]"
              >
                {FOREIGN_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: '☕ Coffee', amt: 2 },
                { label: '☕☕ Double', amt: 5 },
                { label: '🦜 Patron', amt: 10 },
              ].map((tier) => {
                const approxPkr = Math.round((tier.amt * curMeta.approxPerUsdInPkr) / 50) * 50;
                return (
                  <button
                    key={tier.amt}
                    type="button"
                    onClick={() => onSelectPreset?.(tier.amt, curMeta.code, 'Wise / Remitly (Foreign)')}
                    className="rounded-lg border border-[#C8922A]/35 bg-[#18231B] px-2 py-2 text-center hover:border-[#E8B84B] hover:bg-[#233227]"
                  >
                    <div className="text-xs font-extrabold text-[#E8B84B]">
                      {tier.label} {curMeta.symbol}{tier.amt}
                    </div>
                    <div className="font-mono-num text-[10px] text-[#9EB09F]">≈ Rs {approxPkr.toLocaleString()}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 truncate">
        <span className="text-[#9EB09F]">{label}: </span>
        <span className="font-mono-num font-bold text-[#F6EFE2]">{value}</span>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded border border-[#C8922A]/40 px-2 py-0.5 text-[10px] font-bold text-[#E8B84B]"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
