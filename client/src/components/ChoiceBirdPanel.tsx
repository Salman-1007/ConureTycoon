import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Coffee, Feather, Sparkles, XCircle } from 'lucide-react';
import type { MutationConfigDTO, PaymentRequestDTO, SupportConfigDTO } from '@shared/api-types';
import { api, ApiError } from '../api/client';
import { useGame } from '../context/GameContext';
import { rarityBadgeStyle } from './format';
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

export function ChoiceBirdPanel() {
  const { pushToast } = useGame();
  const [mutations, setMutations] = useState<MutationConfigDTO[]>([]);
  const [supportConfig, setSupportConfig] = useState<SupportConfigDTO>(FALLBACK_SUPPORT);
  const [myRequests, setMyRequests] = useState<PaymentRequestDTO[]>([]);
  const [region, setRegion] = useState<PaymentRegion>('PK');

  const [selectedMutation, setSelectedMutation] = useState('MOONCHK');
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('MALE');
  const [desiredName, setDesiredName] = useState('');
  const [amount, setAmount] = useState('500');
  const [currency, setCurrency] = useState('PKR');
  const [paymentMethod, setPaymentMethod] = useState('NayaPay (03324261998)');
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [referenceNote, setReferenceNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submittedMsg, setSubmittedMsg] = useState('');

  const loadData = async () => {
    const [mutRes, supRes, reqRes] = await Promise.all([
      api.getMutations().catch(() => null),
      api.getSupportConfig().catch(() => null),
      api.getMyPaymentRequests().catch(() => null),
    ]);
    if (mutRes?.mutations.length) {
      setMutations(mutRes.mutations);
      if (!mutRes.mutations.some((m) => m.key === selectedMutation)) {
        setSelectedMutation(mutRes.mutations[0].key);
      }
    }
    if (supRes?.supportConfig) setSupportConfig(supRes.supportConfig);
    if (reqRes?.requests) setMyRequests(reqRes.requests);
  };

  useEffect(() => {
    loadData();
  }, []);

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

  const activeMut = mutations.find((m) => m.key === selectedMutation) ?? mutations[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSubmittedMsg('');
    setBusy(true);
    try {
      await api.submitChoiceBirdPayment({
        mutationKey: selectedMutation,
        gender,
        desiredBirdName: desiredName,
        amount: Number(amount),
        currency,
        paymentMethod,
        senderName,
        senderPhone,
        referenceNote,
      });
      setSubmittedMsg(
        `Claim received from ${senderName}! Once the creator verifies your transfer, your ${activeMut?.name ?? selectedMutation} (${gender === 'MALE' ? 'Male ♂' : 'Female ♀'}) will be delivered directly to your aviary.`,
      );
      setSenderName('');
      setSenderPhone('');
      setReferenceNote('');
      setDesiredName('');
      pushToast({
        tone: 'green',
        title: 'Bird Request Submitted',
        message: 'Added to creator payment verification queue.',
      });
      await loadData();
    } catch (err) {
      pushToast({
        tone: 'red',
        title: 'Submission Failed',
        message: err instanceof ApiError ? err.message : 'Please check all required fields.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro Banner */}
      <div className="brass-panel rounded-2xl p-4 sm:p-6 space-y-2 border-[#E8B84B]/50">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#E8B84B]/45 bg-[#233227] px-3 py-1 text-xs font-bold text-[#E8B84B]">
          <Coffee className="h-3.5 w-3.5" /> Buy the Creator a Coffee · Get Any Bird of Your Choice
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F6EFE2]">
          Pick Any Green Cheek Conure Mutation &amp; Gender
        </h2>
        <p className="text-xs sm:text-sm leading-relaxed text-[#D9CEB8]">
          Buy the creator a coffee by sending any amount to NayaPay{' '}
          <span className="font-mono-num font-extrabold text-[#E8B84B]">{supportConfig.nayapayNumber}</span>{' '}
          (or via Wise / Remitly / Taptap Send for foreign players). Select any bird from the dropdown, choose its gender, enter your sender name, and once approved your bird will be delivered straight to your aviary!
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* Left: Live Selected Bird Preview + Payment Details */}
        <div className="lg:col-span-5 space-y-4">
          {activeMut && (
            <div className="brass-panel overflow-hidden rounded-2xl">
              <div className="studio-frame relative aspect-[4/3] w-full">
                <img
                  src={activeMut.imageUrl}
                  alt={activeMut.name}
                  className="h-full w-full object-contain p-3"
                />
                <div className="absolute top-2.5 left-2.5">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold bg-[#141E17]/85 ${rarityBadgeStyle(activeMut.rarity)}`}
                  >
                    {activeMut.rarity}
                  </span>
                </div>
                <div className="absolute top-2.5 right-2.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold text-white shadow ${
                      gender === 'MALE' ? 'bg-sky-700' : 'bg-rose-700'
                    }`}
                  >
                    {gender === 'MALE' ? '♂ Male (ZZ)' : '♀ Female (ZW)'}
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-bold text-[#F6EFE2]">{activeMut.name}</h3>
                  <span className="font-mono-num text-xs font-bold text-[#E8B84B]">{activeMut.key}</span>
                </div>
                <div className="font-mono-num text-[11px] text-sky-300">{activeMut.chromosomeLabel}</div>
                <p className="text-xs leading-relaxed text-[#C6D2C7]">{activeMut.visualDescription}</p>
              </div>
            </div>
          )}

          <PaymentAccountCard
            config={supportConfig}
            region={region}
            onRegionChange={handleRegionChange}
            selectedCurrency={currency}
            onSelectPreset={(amt, cur, method) => {
              setAmount(String(amt));
              setCurrency(cur);
              setPaymentMethod(method);
            }}
          />
        </div>

        {/* Right: Bird Choice + I Have Paid Form */}
        <form onSubmit={handleSubmit} className="brass-panel lg:col-span-7 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-[#C8922A]/25 pb-3">
            <Sparkles className="h-5 w-5 text-[#E8B84B]" />
            <h3 className="font-display text-lg font-bold text-[#F6EFE2]">
              Customize Your Bird &amp; Confirm Payment
            </h3>
          </div>

          {/* 1. Bird Dropbox */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
              Select Bird Mutation *
            </label>
            <select
              value={selectedMutation}
              onChange={(e) => setSelectedMutation(e.target.value)}
              required
              className="mt-1.5 w-full rounded-xl border border-[#C8922A]/45 bg-[#111914] px-3 py-2.5 text-sm font-semibold text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
            >
              {mutations.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} ({m.rarity})
                </option>
              ))}
            </select>
          </div>

          {/* 2. Gender Picker + Optional Call Name */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Choose Gender *
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGender('MALE')}
                  className={`rounded-xl border py-2.5 text-xs font-extrabold transition ${
                    gender === 'MALE'
                      ? 'border-sky-400 bg-sky-700/80 text-white shadow'
                      : 'border-[#C8922A]/35 bg-[#111914] text-[#9EB09F] hover:text-white'
                  }`}
                >
                  ♂ Male (ZZ)
                </button>
                <button
                  type="button"
                  onClick={() => setGender('FEMALE')}
                  className={`rounded-xl border py-2.5 text-xs font-extrabold transition ${
                    gender === 'FEMALE'
                      ? 'border-rose-400 bg-rose-700/80 text-white shadow'
                      : 'border-[#C8922A]/35 bg-[#111914] text-[#9EB09F] hover:text-white'
                  }`}
                >
                  ♀ Female (ZW)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Custom Bird Name (Optional)
              </label>
              <input
                type="text"
                maxLength={32}
                value={desiredName}
                onChange={(e) => setDesiredName(e.target.value)}
                placeholder="e.g. Celestia or leave auto"
                className="mt-1.5 w-full rounded-xl border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
              />
            </div>
          </div>

          {/* 3. Coffee Amount & Currency + Payment Method */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Coffee Amount Sent *
              </label>
              <input
                type="number"
                min={1}
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="font-mono-num mt-1.5 w-full rounded-xl border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2]"
              >
                <option value="PKR">PKR (Rs)</option>
                {FOREIGN_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
                Payment Channel
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[#C8922A]/40 bg-[#111914] px-3 py-2.5 text-sm text-[#F6EFE2]"
              >
                <option value="NayaPay (03324261998)">NayaPay (03324261998)</option>
                <option value="Raast / Bank Transfer">Raast / Bank Transfer</option>
                <option value="JazzCash / Easypaisa">JazzCash / Easypaisa</option>
                <option value="Wise / Remitly (Foreign)">Wise / Remitly (Foreign)</option>
                <option value="Taptap Send / WorldRemit">Taptap Send / WorldRemit</option>
                <option value="Other International">Other International</option>
              </select>
            </div>
          </div>

          {/* 4. Sender Name (Required) + Optional Phone / TRX Reference */}
          <div className="rounded-xl border border-amber-400/35 bg-amber-950/20 p-3.5 space-y-3">
            <div className="text-xs font-bold text-[#E8B84B]">
              Already paid? Tell us who sent it so the admin can approve &amp; deliver your bird:
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#D9CEB8]">
                  Sender Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="Exact name shown on transfer"
                  className="mt-1 w-full rounded-lg border border-[#C8922A]/45 bg-[#111914] px-3 py-2 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#D9CEB8]">
                  Phone / Account ID (Optional)
                </label>
                <input
                  type="text"
                  maxLength={64}
                  value={senderPhone}
                  onChange={(e) => setSenderPhone(e.target.value)}
                  placeholder="e.g. 03XX-XXXXXXX"
                  className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#D9CEB8]">
                Transaction Reference / Note (Optional)
              </label>
              <input
                type="text"
                maxLength={240}
                value={referenceNote}
                onChange={(e) => setReferenceNote(e.target.value)}
                placeholder="TRX ID or any message for Salman"
                className="mt-1 w-full rounded-lg border border-[#C8922A]/40 bg-[#111914] px-3 py-2 text-sm text-[#F6EFE2] focus:border-[#E8B84B] focus:outline-none"
              />
            </div>
          </div>

          {submittedMsg && (
            <div className="rounded-xl border border-emerald-400/50 bg-emerald-950/35 p-3 text-xs font-semibold text-emerald-200">
              {submittedMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || mutations.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E8B84B] py-3 text-sm font-extrabold text-[#141A15] shadow-lg transition hover:bg-[#F2C75C] disabled:opacity-50"
          >
            <Feather className="h-4 w-4" />
            {busy ? 'Submitting Payment Claim...' : 'I Have Paid — Deliver My Chosen Conure'}
          </button>
        </form>
      </div>

      {/* Player's Recent Claims */}
      {myRequests.length > 0 && (
        <div className="brass-panel rounded-2xl p-4 sm:p-5 space-y-3">
          <h3 className="font-display text-base font-bold text-[#F6EFE2]">Your Payment &amp; Gift Requests</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {myRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#C8922A]/30 bg-[#141D17] p-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-bold text-[#F6EFE2]">
                    {req.requestedMutationName ?? req.specialBirdName ?? 'Creator Support'}
                    {req.requestedGender ? ` (${req.requestedGender === 'MALE' ? '♂' : '♀'})` : ''}
                  </div>
                  <div className="truncate text-[11px] text-[#9EB09F]">
                    Sender: {req.senderName} · {req.currency} {req.amount}
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                    req.status === 'approved'
                      ? 'border-emerald-400/50 bg-emerald-950/50 text-emerald-200'
                      : req.status === 'rejected'
                        ? 'border-rose-400/50 bg-rose-950/50 text-rose-200'
                        : 'border-amber-400/50 bg-amber-950/50 text-amber-200'
                  }`}
                >
                  {req.status === 'approved' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : req.status === 'rejected' ? (
                    <XCircle className="h-3 w-3" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
