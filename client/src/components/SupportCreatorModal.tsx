import React, { useEffect, useState } from 'react';
import { Coffee, Feather, Heart, Send, Sparkles, X } from 'lucide-react';
import type { SupportConfigDTO } from '@shared/api-types';
import { api, ApiError } from '../api/client';
import { useGame } from '../context/GameContext';
import { FOREIGN_CURRENCIES, PaymentAccountCard, type PaymentRegion } from './PaymentAccountCard';

const FALLBACK_SUPPORT: SupportConfigDTO = {
  nayapayNumber: '03324261998',
  accountTitle: 'Salman Adil',
  internationalNumber: '+92 332 4261998',
  iban: '',
  kofiUrl: '',
  paypalEmail: '',
  wiseTag: '',
  binanceId: '',
  customForeignNote:
    'Foreign supporters can send directly to NayaPay Pakistan mobile wallet (+92 332 4261998) via Wise, Remitly, Taptap Send, WorldRemit, or Western Union.',
};

interface SupportCreatorModalProps {
  open: boolean;
  onClose: () => void;
  onGoToChoiceBird?: () => void;
}

export function SupportCreatorModal({ open, onClose, onGoToChoiceBird }: SupportCreatorModalProps) {
  const { user, pushToast } = useGame();
  const [config, setConfig] = useState<SupportConfigDTO>(FALLBACK_SUPPORT);
  const [region, setRegion] = useState<PaymentRegion>('PK');
  const [claimOpen, setClaimOpen] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [amount, setAmount] = useState('500');
  const [currency, setCurrency] = useState('PKR');
  const [paymentMethod, setPaymentMethod] = useState('NayaPay (03324261998)');
  const [referenceNote, setReferenceNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .getSupportConfig()
      .then((res) => setConfig(res.supportConfig))
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const handleRegionChange = (next: PaymentRegion) => {
    setRegion(next);
    if (next === 'PK') {
      setCurrency('PKR');
      setAmount('500');
      setPaymentMethod('NayaPay (03324261998)');
    } else {
      setCurrency('USD');
      setAmount('5');
      setPaymentMethod('Wise / Remitly (Foreign)');
    }
  };

  const handleSubmitTip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || busy) return;
    setBusy(true);
    try {
      await api.submitSupportPayment({
        senderName,
        amount: Number(amount),
        currency,
        paymentMethod,
        referenceNote,
      });
      pushToast({
        tone: 'green',
        title: 'Thank You!',
        message: 'Your support note was sent to the creator for verification.',
      });
      setSenderName('');
      setReferenceNote('');
      setClaimOpen(false);
    } catch (err) {
      pushToast({
        tone: 'red',
        title: 'Could Not Submit',
        message: err instanceof ApiError ? err.message : 'Please check your details.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="brass-panel max-h-[92dvh] w-full sm:max-w-lg overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#C8922A]/25 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E8B84B]/50 bg-[#233227] text-[#E8B84B]">
              <Coffee className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#F6EFE2]">
                Support the Creator
              </h2>
              <p className="text-xs text-[#9EB09F]">
                Buy Salman a coffee to support servers &amp; new conure updates
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#C8922A]/30 p-2 text-[#9EB09F] hover:border-[#E8B84B] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message */}
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-400/30 bg-rose-950/20 p-3 text-xs leading-relaxed text-[#E5DDD0]">
          <Heart className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          <span>
            Green Cheek Conure Tycoon is built with love as an independent avian genetics project. Every coffee helps keep the live marketplace and servers running!
          </span>
        </div>

        {/* NayaPay + Foreign Payment Card */}
        <PaymentAccountCard
          config={config}
          region={region}
          onRegionChange={handleRegionChange}
          selectedCurrency={currency}
          onSelectPreset={(amt, cur, method) => {
            setAmount(String(amt));
            setCurrency(cur);
            setPaymentMethod(method);
            if (user) setClaimOpen(true);
          }}
        />

        {/* Shortcut to Choice Bird in Market */}
        {user && onGoToChoiceBird && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onGoToChoiceBird();
            }}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#E8B84B]/60 bg-gradient-to-r from-[#26382B] to-[#1D2A21] px-4 py-3 text-left transition hover:border-[#E8B84B]"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Sparkles className="h-5 w-5 shrink-0 text-[#E8B84B]" />
              <div className="min-w-0">
                <div className="text-xs font-extrabold text-[#E8B84B]">
                  Want a Conure of Your Choice?
                </div>
                <div className="text-[11px] text-[#D9CEB8]">
                  Buy a coffee in the Market &amp; pick any mutation + gender!
                </div>
              </div>
            </div>
            <Feather className="h-4 w-4 shrink-0 text-[#E8B84B]" />
          </button>
        )}

        {/* Optional Log Tip Form for Logged-in Users */}
        {user && (
          <div className="border-t border-[#C8922A]/20 pt-3">
            {!claimOpen ? (
              <button
                type="button"
                onClick={() => setClaimOpen(true)}
                className="w-full rounded-xl border border-[#C8922A]/40 bg-[#17211A] py-2.5 text-xs font-bold text-[#D9CEB8] hover:border-[#E8B84B] hover:text-white"
              >
                Already Sent a Coffee? Notify Creator
              </button>
            ) : (
              <form onSubmit={handleSubmitTip} className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                  Notify Creator of Your Support
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-bold text-[#9EB09F]">Sender Name *</label>
                    <input
                      type="text"
                      required
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="Your name on receipt"
                      className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2 text-sm text-[#F6EFE2]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-[#9EB09F]">Amount *</label>
                      <input
                        type="number"
                        min={1}
                        step="any"
                        required
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="font-mono-num mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2 text-sm text-[#F6EFE2]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[#9EB09F]">Currency</label>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-2 py-2 text-sm text-[#F6EFE2]"
                      >
                        <option value="PKR">PKR</option>
                        {FOREIGN_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-bold text-[#9EB09F]">Method</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2 text-sm text-[#F6EFE2]"
                    >
                      <option value="NayaPay (03324261998)">NayaPay (03324261998)</option>
                      <option value="Raast / Bank Transfer">Raast / Bank Transfer</option>
                      <option value="JazzCash / Easypaisa">JazzCash / Easypaisa</option>
                      <option value="Wise / Remitly (Foreign)">Wise / Remitly (Foreign)</option>
                      <option value="Taptap Send / WorldRemit">Taptap Send / WorldRemit</option>
                      <option value="Other International">Other International</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#9EB09F]">Reference / Note</label>
                    <input
                      type="text"
                      value={referenceNote}
                      onChange={(e) => setReferenceNote(e.target.value)}
                      placeholder="TRX ID or kind note"
                      className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2 text-sm text-[#F6EFE2]"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setClaimOpen(false)}
                    className="rounded-lg border border-[#C8922A]/40 px-3 py-2 text-xs font-bold text-[#D9CEB8]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#E8B84B] px-4 py-2 text-xs font-extrabold text-[#141A15] hover:bg-[#F2C75C] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" /> {busy ? 'Sending...' : 'Send Support Note'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
