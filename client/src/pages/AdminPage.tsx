import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  Check,
  Coins,
  CreditCard,
  Dna,
  DollarSign,
  Eye,
  Feather,
  Globe,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Store,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  AdminActivityItemDTO,
  AdminBirdDTO,
  AdminChatMessageDTO,
  AdminChatThreadDTO,
  AdminOverviewDTO,
  AdminUserDTO,
  MutationConfigDTO,
  PaymentRequestDTO,
  SpecialBirdDTO,
  SupportConfigDTO,
} from '@shared/api-types';
import { MUTATION_CATALOG } from '@shared/genetics/catalog';
import { api } from '../api/client';
import { useGame } from '../context/GameContext';
import { formatCoins } from '../components/format';

type AdminTab =
  | 'overview'
  | 'users'
  | 'conures'
  | 'mutations'
  | 'add-market-bird'
  | 'special-bird'
  | 'payments'
  | 'chat-audit';

interface AdminPageProps {
  onExit: () => void;
}

const ALL_MUTATION_OPTIONS = Object.values(MUTATION_CATALOG);
const SPLIT_ELIGIBLE_GENES = [
  { key: 'CIN', name: 'Cinnamon (Z^cin)' },
  { key: 'OP', name: 'Yellow-Sided / Opaline (Z^op)' },
  { key: 'TQ', name: 'Turquoise (tq)' },
  { key: 'DIL', name: 'Dilute (dil)' },
];

export function AdminPage({ onExit }: AdminPageProps) {
  const { user, refreshAviary, pushToast } = useGame();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);

  // Tab data
  const [overview, setOverview] = useState<AdminOverviewDTO | null>(null);
  const [users, setUsers] = useState<AdminUserDTO[]>([]);
  const [birds, setBirds] = useState<AdminBirdDTO[]>([]);
  const [mutations, setMutations] = useState<MutationConfigDTO[]>([]);
  const [specialBirds, setSpecialBirds] = useState<SpecialBirdDTO[]>([]);
  const [payments, setPayments] = useState<PaymentRequestDTO[]>([]);
  const [threads, setThreads] = useState<AdminChatThreadDTO[]>([]);
  const [selectedThread, setSelectedThread] = useState<AdminChatThreadDTO | null>(null);
  const [threadMessages, setThreadMessages] = useState<AdminChatMessageDTO[]>([]);
  const [auditFeed, setAuditFeed] = useState<AdminActivityItemDTO[]>([]);
  const [supportConfig, setSupportConfig] = useState<SupportConfigDTO | null>(null);

  // Filters & interactive states
  const [userSearch, setUserSearch] = useState('');
  const [birdSearch, setBirdSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [adjustModalUser, setAdjustModalUser] = useState<AdminUserDTO | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('1000');
  const [deleteTargetUser, setDeleteTargetUser] = useState<AdminUserDTO | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  // Mutation editor state
  const [editingImageKey, setEditingImageKey] = useState<string | null>(null);
  const [editingImageUrl, setEditingImageUrl] = useState('');
  const [showMutationForm, setShowMutationForm] = useState(false);
  const [mutForm, setMutForm] = useState({
    key: '',
    name: '',
    chromosomeLabel: 'Autosomal Recessive',
    inheritanceMode: 'Recessive',
    visualDescription: '',
    imageUrl: '',
    basePrice: '3500',
    rarity: 'Uncommon',
    rarityScore: '55',
    accentHex: '#43AA8B',
    basePhenotype: '',
  });

  // Add Market Bird form
  const [marketForm, setMarketForm] = useState({
    name: '',
    mutationKey: 'TQ',
    gender: 'MALE' as 'MALE' | 'FEMALE',
    symmetry: '88',
    price: '1850',
    splits: [] as string[],
  });

  // Special Bird form
  const [specialForm, setSpecialForm] = useState({
    name: '',
    mutationKey: 'SUNCHK',
    gender: 'FEMALE' as 'MALE' | 'FEMALE',
    symmetry: '96',
    splits: [] as string[],
    pricePkr: '1500',
    imageUrl: '',
    description: '',
    stock: '5',
  });

  // Support config form
  const [showSupportEditor, setShowSupportEditor] = useState(false);
  const [supportForm, setSupportForm] = useState<Partial<SupportConfigDTO>>({});

  const notify = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      pushToast({
        tone: type === 'success' ? 'green' : type === 'error' ? 'red' : 'sky',
        title: type === 'success' ? 'Admin Action Complete' : type === 'error' ? 'Admin Error' : 'Notice',
        message,
      });
    },
    [pushToast],
  );

  const loadTabData = useCallback(
    async (targetTab: AdminTab) => {
      setLoading(true);
      try {
        if (targetTab === 'overview') {
          const [ov, feed] = await Promise.all([api.adminOverview(), api.adminAuditFeed()]);
          setOverview(ov);
          setAuditFeed(feed.activity);
        } else if (targetTab === 'users') {
          const res = await api.adminUsers();
          setUsers(res.users);
        } else if (targetTab === 'conures') {
          const res = await api.adminBirds();
          setBirds(res.birds);
        } else if (targetTab === 'mutations') {
          const [mutRes, supRes] = await Promise.all([api.adminMutations(), api.getSupportConfig()]);
          setMutations(mutRes.mutations);
          setSupportConfig(supRes.supportConfig);
          setSupportForm(supRes.supportConfig);
        } else if (targetTab === 'add-market-bird') {
          const res = await api.adminMutations();
          setMutations(res.mutations);
        } else if (targetTab === 'special-bird') {
          const [sbRes, mutRes] = await Promise.all([api.adminSpecialBirds(), api.adminMutations()]);
          setSpecialBirds(sbRes.specialBirds);
          setMutations(mutRes.mutations);
        } else if (targetTab === 'payments') {
          const res = await api.adminPaymentRequests();
          setPayments(res.requests);
        } else if (targetTab === 'chat-audit') {
          const [tRes, fRes] = await Promise.all([api.adminChatThreads(), api.adminAuditFeed()]);
          setThreads(tRes.threads);
          setAuditFeed(fRes.activity);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Failed to load admin data', 'error');
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    loadTabData(tab);
  }, [tab, loadTabData]);

  // Filtered lists
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.aviaryName.toLowerCase().includes(q),
    );
  }, [users, userSearch]);

  const filteredBirds = useMemo(() => {
    const q = birdSearch.trim().toLowerCase();
    if (!q) return birds;
    return birds.filter(
      (b) =>
        b.legBand.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        b.phenotypeName.toLowerCase().includes(q) ||
        (b.ownerUsername || '').toLowerCase().includes(q),
    );
  }, [birds, birdSearch]);

  const filteredPayments = useMemo(() => {
    if (paymentFilter === 'all') return payments;
    return payments.filter((p) => p.status === paymentFilter);
  }, [payments, paymentFilter]);

  const pendingPaymentsCount = useMemo(
    () =>
      payments.filter((p) => p.status === 'pending').length ||
      overview?.pendingPayments ||
      user?.pendingPaymentsCount ||
      0,
    [payments, overview, user?.pendingPaymentsCount],
  );

  const economyCoinsTotal = useMemo(
    () => users.reduce((sum, u) => sum + u.coins, 0),
    [users],
  );

  const handleAdjustCoins = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalUser) return;
    const amt = Number(adjustAmount);
    if (!Number.isFinite(amt) || amt === 0) {
      notify('Enter a non-zero coin delta', 'error');
      return;
    }
    setBusyActionId(adjustModalUser.id);
    try {
      const res = await api.adminAdjustMoney(adjustModalUser.id, amt);
      notify(`Updated @${adjustModalUser.username}'s coins to ${formatCoins(res.coins)}.`, 'success');
      setAdjustModalUser(null);
      await Promise.all([loadTabData('users'), refreshAviary()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Coin adjustment failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTargetUser) return;
    setBusyActionId(deleteTargetUser.id);
    try {
      await api.adminDeleteUser(deleteTargetUser.id);
      notify(`Deleted user @${deleteTargetUser.username}.`, 'info');
      setDeleteTargetUser(null);
      await loadTabData('users');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete user failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSaveImageUrl = async (key: string) => {
    setBusyActionId(key);
    try {
      await api.adminUpdateMutationImage(key, editingImageUrl.trim());
      notify(`Updated asset URL for ${key}.`, 'success');
      setEditingImageKey(null);
      await loadTabData('mutations');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Image update failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSaveMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mutForm.name.trim()) {
      notify('Mutation name is required', 'error');
      return;
    }
    setBusyActionId('save-mutation');
    try {
      await api.adminSaveMutation({
        key: mutForm.key.trim() || undefined,
        name: mutForm.name.trim(),
        chromosomeLabel: mutForm.chromosomeLabel.trim(),
        inheritanceMode: mutForm.inheritanceMode.trim(),
        visualDescription: mutForm.visualDescription.trim(),
        imageUrl: mutForm.imageUrl.trim(),
        basePrice: Number(mutForm.basePrice) || 2500,
        rarity: mutForm.rarity,
        rarityScore: Number(mutForm.rarityScore) || 50,
        accentHex: mutForm.accentHex,
        basePhenotype: mutForm.basePhenotype.trim(),
      });
      notify(`Saved mutation "${mutForm.name}".`, 'success');
      setShowMutationForm(false);
      await loadTabData('mutations');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Save mutation failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSaveSupportConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyActionId('support-config');
    try {
      const res = await api.adminUpdateSupportConfig(supportForm);
      setSupportConfig(res.supportConfig);
      setSupportForm(res.supportConfig);
      notify('Creator & foreign payment methods updated.', 'success');
      setShowSupportEditor(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleInjectMarketBird = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyActionId('inject-bird');
    try {
      const res = await api.adminAddMarketBird({
        name: marketForm.name.trim() || undefined,
        mutationKey: marketForm.mutationKey,
        gender: marketForm.gender,
        symmetry: Number(marketForm.symmetry) || 88,
        price: Number(marketForm.price) || 1800,
        splits: marketForm.splits,
      });
      notify(`Injected ${res.legBand} into this hour's Wild Exchange!`, 'success');
      setMarketForm((prev) => ({ ...prev, name: '', splits: [] }));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Injection failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleCreateSpecialBird = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!specialForm.name.trim()) {
      notify('Enter a special bird name', 'error');
      return;
    }
    setBusyActionId('create-special');
    try {
      await api.adminAddSpecialBird({
        name: specialForm.name.trim(),
        mutationKey: specialForm.mutationKey,
        gender: specialForm.gender,
        symmetry: Number(specialForm.symmetry) || 96,
        splits: specialForm.splits,
        pricePkr: Number(specialForm.pricePkr) || 1500,
        imageUrl: specialForm.imageUrl.trim() || undefined,
        description: specialForm.description.trim() || undefined,
        stock: Number(specialForm.stock) || 1,
      });
      notify(`Special Bird "${specialForm.name}" created! Toggle Make Live when ready.`, 'success');
      setSpecialForm((prev) => ({ ...prev, name: '', description: '', imageUrl: '' }));
      await loadTabData('special-bird');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Special bird creation failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleToggleSpecialLive = async (sb: SpecialBirdDTO) => {
    setBusyActionId(sb.id);
    try {
      await api.adminSetSpecialLive(sb.id, !sb.isLive);
      notify(sb.isLive ? `${sb.name} taken offline.` : `${sb.name} is now LIVE in Market!`, 'success');
      await loadTabData('special-bird');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Toggle failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleApprovePayment = async (req: PaymentRequestDTO) => {
    setBusyActionId(req.id);
    try {
      const res = await api.adminApprovePayment(req.id);
      if (res.deliveredBirdLegBand) {
        notify(
          `Approved! Delivered ${res.deliveredBirdName} (${res.deliveredBirdLegBand}) to @${req.username}'s aviary.`,
          'success',
        );
      } else {
        notify(`Approved support coffee claim from ${req.senderName}!`, 'success');
      }
      await Promise.all([loadTabData('payments'), refreshAviary()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Approval failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRejectPayment = async (req: PaymentRequestDTO) => {
    setBusyActionId(req.id);
    try {
      await api.adminRejectPayment(req.id);
      notify(`Rejected payment claim #${req.id.slice(0, 6)}.`, 'info');
      await Promise.all([loadTabData('payments'), refreshAviary()]);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rejection failed', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleInspectThread = async (t: AdminChatThreadDTO) => {
    setSelectedThread(t);
    setBusyActionId(`thread-${t.u1Id}-${t.u2Id}`);
    try {
      const res = await api.adminInspectThread(t.u1Id, t.u2Id);
      setThreadMessages(res.messages);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not inspect chat thread', 'error');
    } finally {
      setBusyActionId(null);
    }
  };

  const TABS: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'conures', label: 'Conures', icon: Feather },
    { id: 'mutations', label: 'Mutations & Art', icon: Dna },
    { id: 'add-market-bird', label: 'Inject Market', icon: Store },
    { id: 'special-bird', label: 'Special Bird', icon: Sparkles },
    { id: 'payments', label: 'Payments', icon: CreditCard, badge: pendingPaymentsCount },
    { id: 'chat-audit', label: 'Chat & Audit', icon: MessageSquare },
  ];

  const mutationOptionList = useMemo(() => {
    if (mutations.length > 0) return mutations;
    return ALL_MUTATION_OPTIONS.map((m) => ({
      key: m.key,
      name: m.name,
      rarity: m.rarity,
      imageUrl: `/assets/conures/${m.assetFile}`,
    }));
  }, [mutations]);

  const mutationNameForKey = (k: string) =>
    (MUTATION_CATALOG as Record<string, { name: string } | undefined>)[k]?.name ??
    mutations.find((m) => m.key === k)?.name ??
    k;

  const marketPreviewImg = (() => {
    const found = mutationOptionList.find((m) => m.key === marketForm.mutationKey);
    return found?.imageUrl || '/assets/conures/normal_green.png';
  })();

  return (
    <div className="space-y-5">
      {/* Top Admin Banner */}
      <div className="brass-panel rounded-2xl border border-[#E8B84B]/45 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E8B84B]">
              <Shield className="h-4 w-4" /> Admin Command Center · Signed in as @{user?.username}
            </div>
            <h1 className="font-display mt-1 text-xl font-bold text-[#F6EFE2] sm:text-2xl">
              Conure Tycoon Ecosystem Control
            </h1>
            <p className="mt-1 text-xs text-[#9EB09F]">
              Full registry oversight: approve NayaPay / foreign coffee gifts to auto-deliver choice birds, inject Wild Market conures, manage Special Birds, adjust breeder balances, and inspect activity logs.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              onClick={() => loadTabData(tab)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#C8922A]/40 bg-[#18231C] px-3 py-2 text-xs font-bold text-[#F6EFE2] hover:border-[#E8B84B]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#27392B] px-3 py-2 text-xs font-bold text-[#F6EFE2] hover:bg-[#324937]"
            >
              Back to Hub
            </button>
          </div>
        </div>

        {/* Horizontally scrollable tab bar on mobile, wrapped on desktop */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:flex-wrap">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                  active
                    ? 'bg-[#E8B84B] text-[#141A15] shadow-md'
                    : 'border border-[#C8922A]/25 bg-[#141D17] text-[#C8D3C2] hover:border-[#E8B84B]/50 hover:text-[#F6EFE2]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
                {t.badge && t.badge > 0 ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${
                      active ? 'bg-[#141A15] text-[#E8B84B]' : 'bg-rose-600 text-white'
                    }`}
                  >
                    {t.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {overview && (
            <>
              {overview.pendingPayments > 0 && (
                <button
                  type="button"
                  onClick={() => setTab('payments')}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-400/50 bg-amber-950/35 px-4 py-3 text-left transition hover:bg-amber-950/55"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-5 w-5 shrink-0 text-[#E8B84B]" />
                    <div>
                      <div className="text-sm font-bold text-[#F6EFE2]">
                        {overview.pendingPayments} Pending Payment Claim{overview.pendingPayments > 1 ? 's' : ''} Waiting Review
                      </div>
                      <div className="text-xs text-amber-200/80">
                        Verify NayaPay / foreign transfers &amp; click Approve to deliver chosen birds directly to users.
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-[#E8B84B] px-3 py-1.5 text-xs font-extrabold text-[#141A15]">
                    Open Payments →
                  </span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[
                  { label: 'Total Breeders', value: overview.users.toLocaleString(), icon: Users, color: 'text-emerald-300' },
                  { label: 'Total Conures', value: overview.birds.toLocaleString(), icon: Feather, color: 'text-[#E8B84B]' },
                  { label: 'Wild Market Live', value: overview.activeMarketListings.toLocaleString(), icon: Store, color: 'text-sky-300' },
                  { label: 'P2P Open Listings', value: overview.p2pListings.toLocaleString(), icon: Award, color: 'text-purple-300' },
                  { label: 'Active Nest Cages', value: overview.activeCages.toLocaleString(), icon: Dna, color: 'text-teal-300' },
                  { label: 'Showroom Entries', value: overview.showroomEntries.toLocaleString(), icon: Sparkles, color: 'text-amber-300' },
                  { label: 'Pending Payments', value: overview.pendingPayments.toLocaleString(), icon: CreditCard, color: 'text-rose-300' },
                ].map((stat) => {
                  const StatIcon = stat.icon;
                  return (
                    <div key={stat.label} className="rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4">
                      <div className="flex items-center justify-between text-xs text-[#9EB09F]">
                        <span>{stat.label}</span>
                        <StatIcon className={`h-4 w-4 ${stat.color}`} />
                      </div>
                      <div className={`font-mono-num mt-2 text-2xl font-extrabold ${stat.color}`}>{stat.value}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Recent Economy Activity */}
          <div className="rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-[#F6EFE2]">
                <Activity className="h-4 w-4 text-[#E8B84B]" /> Latest Economy &amp; Hatchery Feed
              </div>
              <button
                type="button"
                onClick={() => setTab('chat-audit')}
                className="text-xs font-semibold text-[#E8B84B] hover:underline"
              >
                Full Audit →
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {auditFeed.slice(0, 14).map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 rounded-xl border border-[#C8922A]/15 bg-[#101813] px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <span className="rounded bg-[#1E2E23] px-1.5 py-0.5 text-[10px] font-bold text-[#E8B84B] mr-1.5">
                      {item.kind}
                    </span>
                    <span className="font-semibold text-[#F6EFE2]">{item.summary}</span>
                    <div className="text-[11px] text-[#9EB09F]">{item.detail}</div>
                  </div>
                  <div className="shrink-0 text-[10px] text-[#7D917E]">
                    {new Date(item.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
              {auditFeed.length === 0 && (
                <div className="py-6 text-center text-xs text-[#9EB09F]">No activity logged yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USERS */}
      {tab === 'users' && (
        <div className="space-y-3 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
                Registered Breeders ({filteredUsers.length})
              </h2>
              <p className="text-xs text-[#9EB09F]">
                Total Economy Supply: <span className="font-mono-num font-bold text-[#E8B84B]">{formatCoins(economyCoinsTotal)}</span>
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9EB09F]" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search username, display, aviary..."
                className="w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] py-2 pl-9 pr-3 text-xs text-[#F6EFE2] outline-none focus:border-[#E8B84B]"
              />
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filteredUsers.map((u) => (
              <div key={u.id} className="rounded-xl border border-[#C8922A]/20 bg-[#101813] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-bold text-[#F6EFE2]">
                      @{u.username}
                      {u.isAdmin && (
                        <span className="rounded bg-[#E8B84B] px-1.5 py-0.5 text-[9px] font-extrabold text-[#141A15]">
                          ADMIN
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#9EB09F]">
                      {u.displayName} · {u.aviaryName}
                    </div>
                  </div>
                  <span className="font-mono-num text-xs font-extrabold text-[#E8B84B]">
                    {formatCoins(u.coins)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-[#9EB09F]">
                  <span>{u.birdCount} conures · Lv.{u.level}</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustModalUser(u);
                        setAdjustAmount('1000');
                      }}
                      className="rounded-lg border border-emerald-400/35 bg-emerald-950/35 px-2.5 py-1 text-[11px] font-bold text-emerald-200"
                    >
                      💰 Coins
                    </button>
                    {!u.isAdmin && (
                      <button
                        type="button"
                        onClick={() => setDeleteTargetUser(u)}
                        className="rounded-lg border border-rose-500/35 bg-rose-950/35 px-2.5 py-1 text-[11px] font-bold text-rose-200"
                      >
                        ✕ Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#C8922A]/25 text-[11px] uppercase tracking-wider text-[#9EB09F]">
                  <th className="py-2.5 pr-3">Breeder</th>
                  <th className="py-2.5 pr-3">Aviary</th>
                  <th className="py-2.5 pr-3">Level</th>
                  <th className="py-2.5 pr-3">Birds</th>
                  <th className="py-2.5 pr-3">Coins</th>
                  <th className="py-2.5 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C8922A]/15">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-[#101813]/70">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5 font-bold text-[#F6EFE2]">
                        @{u.username}
                        {u.isAdmin && (
                          <span className="rounded bg-[#E8B84B] px-1.5 py-0.5 text-[9px] font-extrabold text-[#141A15]">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#9EB09F]">{u.displayName}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-[#C8D3C2]">{u.aviaryName}</td>
                    <td className="py-2.5 pr-3 text-[#C8D3C2]">Lv.{u.level}</td>
                    <td className="py-2.5 pr-3 font-mono-num text-[#F6EFE2]">{u.birdCount}</td>
                    <td className="py-2.5 pr-3 font-mono-num font-bold text-[#E8B84B]">{formatCoins(u.coins)}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustModalUser(u);
                            setAdjustAmount('1000');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-950/30 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40"
                        >
                          <DollarSign className="h-3 w-3" /> Coins
                        </button>
                        {!u.isAdmin && (
                          <button
                            type="button"
                            onClick={() => setDeleteTargetUser(u)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-950/30 px-2.5 py-1 text-[11px] font-bold text-rose-200 hover:bg-rose-900/40"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CONURES */}
      {tab === 'conures' && (
        <div className="space-y-3 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
              All Ecosystem Conures ({filteredBirds.length})
            </h2>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#9EB09F]" />
              <input
                type="text"
                value={birdSearch}
                onChange={(e) => setBirdSearch(e.target.value)}
                placeholder="Search band, name, phenotype, owner..."
                className="w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] py-2 pl-9 pr-3 text-xs text-[#F6EFE2] outline-none focus:border-[#E8B84B]"
              />
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="space-y-2 md:hidden">
            {filteredBirds.slice(0, 80).map((b) => (
              <div key={b.id} className="rounded-xl border border-[#C8922A]/20 bg-[#101813] p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-[#F6EFE2]">{b.name}</div>
                    <div className="font-mono-num text-[10px] text-[#E8B84B]">{b.legBand}</div>
                  </div>
                  <span className="rounded-full bg-[#1C2A20] px-2 py-0.5 text-[10px] font-bold text-[#C8D3C2]">
                    {b.sex === 'MALE' ? '♂ Male' : '♀ Female'}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-[#9EB09F]">
                  {b.phenotypeName} · Owner:{' '}
                  <strong className="text-[#F6EFE2]">{b.ownerUsername ? `@${b.ownerUsername}` : 'Wild Market'}</strong>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-[#9EB09F]">
                  <span>Symmetry {b.plumageSymmetry}% · Gen F{b.generationDepth}</span>
                  <span>{b.status}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#C8922A]/25 text-[11px] uppercase tracking-wider text-[#9EB09F]">
                  <th className="py-2 pr-3">Leg Band / Name</th>
                  <th className="py-2 pr-3">Phenotype</th>
                  <th className="py-2 pr-3">Sex</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Symmetry / Gen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C8922A]/15">
                {filteredBirds.slice(0, 120).map((b) => (
                  <tr key={b.id} className="hover:bg-[#101813]/70">
                    <td className="py-2 pr-3">
                      <div className="font-bold text-[#F6EFE2]">{b.name}</div>
                      <div className="font-mono-num text-[10px] text-[#E8B84B]">{b.legBand}</div>
                    </td>
                    <td className="py-2 pr-3 text-[#C8D3C2]">{b.phenotypeName}</td>
                    <td className="py-2 pr-3">{b.sex === 'MALE' ? '♂ Male' : '♀ Female'}</td>
                    <td className="py-2 pr-3 text-[#C8D3C2]">
                      {b.ownerUsername ? `@${b.ownerUsername} (${b.ownerAviaryName})` : 'Wild / Market'}
                    </td>
                    <td className="py-2 pr-3 text-[#9EB09F]">{b.status}</td>
                    <td className="py-2 pr-3 font-mono-num text-[#E8B84B]">
                      {b.plumageSymmetry}% · F{b.generationDepth}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: MUTATIONS & ART + CREATOR SUPPORT CONFIG */}
      {tab === 'mutations' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
                Mutations, Art URLs &amp; Support Settings ({mutations.length})
              </h2>
              <p className="text-xs text-[#9EB09F]">
                Override conure artwork URLs live, add custom mutations, or configure optional foreign payment links.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowSupportEditor((s) => !s)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-950/35 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-950/55"
              >
                <Globe className="h-3.5 w-3.5" /> Creator / Foreign Settings
              </button>
              <button
                type="button"
                onClick={() => setShowMutationForm((s) => !s)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#E8B84B] px-3 py-2 text-xs font-extrabold text-[#141A15]"
              >
                <Plus className="h-3.5 w-3.5" /> Add / Edit Mutation
              </button>
            </div>
          </div>

          {showSupportEditor && supportConfig && (
            <form
              onSubmit={handleSaveSupportConfig}
              className="space-y-3 rounded-2xl border border-sky-400/40 bg-[#101813] p-4"
            >
              <div className="text-sm font-bold text-[#F6EFE2]">
                Creator &amp; Foreign Remittance Configuration
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: 'nayapayNumber', label: 'NayaPay Number (PK)' },
                  { key: 'accountTitle', label: 'Account Title' },
                  { key: 'internationalNumber', label: 'International Wallet (+92)' },
                  { key: 'iban', label: 'NayaPay / Bank IBAN (Optional)' },
                  { key: 'wiseTag', label: 'WiseTag (Optional)' },
                  { key: 'paypalEmail', label: 'PayPal Email / Handle (Optional)' },
                  { key: 'kofiUrl', label: 'Ko-fi / BuyMeACoffee URL (Optional)' },
                  { key: 'binanceId', label: 'Binance Pay ID (Optional)' },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-[11px] font-semibold text-[#9EB09F]">{f.label}</label>
                    <input
                      type="text"
                      value={String(supportForm[f.key as keyof SupportConfigDTO] ?? '')}
                      onChange={(e) => setSupportForm((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2] outline-none focus:border-[#E8B84B]"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#9EB09F]">Foreign Transfer Instructions</label>
                <textarea
                  rows={2}
                  value={supportForm.customForeignNote || ''}
                  onChange={(e) => setSupportForm((p) => ({ ...p, customForeignNote: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2] outline-none focus:border-[#E8B84B]"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busyActionId === 'support-config'}
                  className="rounded-xl bg-[#E8B84B] px-4 py-2 text-xs font-extrabold text-[#141A15]"
                >
                  Save Payment Settings
                </button>
                <button
                  type="button"
                  onClick={() => setShowSupportEditor(false)}
                  className="rounded-xl border border-[#C8922A]/30 px-4 py-2 text-xs text-[#9EB09F]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {showMutationForm && (
            <form
              onSubmit={handleSaveMutation}
              className="space-y-3 rounded-2xl border border-[#E8B84B]/45 bg-[#101813] p-4"
            >
              <div className="text-sm font-bold text-[#F6EFE2]">Add or Update Mutation Config</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="text-[11px] text-[#9EB09F]">Key (optional slug for new)</label>
                  <input
                    type="text"
                    value={mutForm.key}
                    onChange={(e) => setMutForm((p) => ({ ...p, key: e.target.value }))}
                    placeholder="e.g. LAVENDER"
                    className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9EB09F]">Display Name *</label>
                  <input
                    type="text"
                    required
                    value={mutForm.name}
                    onChange={(e) => setMutForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Mooncheek Conure"
                    className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9EB09F]">Rarity Tier</label>
                  <select
                    value={mutForm.rarity}
                    onChange={(e) => setMutForm((p) => ({ ...p, rarity: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2]"
                  >
                    <option value="Baseline">Baseline</option>
                    <option value="Common Mutation">Common Mutation</option>
                    <option value="Uncommon">Uncommon</option>
                    <option value="Double Recessive">Double Recessive</option>
                    <option value="Signature Triple">Signature Triple</option>
                    <option value="Quadruple Sovereign">Quadruple Sovereign</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[#9EB09F]">Base Coins Value</label>
                  <input
                    type="number"
                    value={mutForm.basePrice}
                    onChange={(e) => setMutForm((p) => ({ ...p, basePrice: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9EB09F]">Image URL (optional)</label>
                  <input
                    type="text"
                    value={mutForm.imageUrl}
                    onChange={(e) => setMutForm((p) => ({ ...p, imageUrl: e.target.value }))}
                    placeholder="/assets/conures/... or https://..."
                    className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9EB09F]">Accent Color</label>
                  <input
                    type="text"
                    value={mutForm.accentHex}
                    onChange={(e) => setMutForm((p) => ({ ...p, accentHex: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#9EB09F]">Visual Description</label>
                <input
                  type="text"
                  value={mutForm.visualDescription}
                  onChange={(e) => setMutForm((p) => ({ ...p, visualDescription: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-[#C8922A]/30 bg-[#151F18] px-3 py-2 text-xs text-[#F6EFE2]"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busyActionId === 'save-mutation'}
                  className="rounded-xl bg-[#E8B84B] px-4 py-2 text-xs font-extrabold text-[#141A15]"
                >
                  Save Mutation
                </button>
                <button
                  type="button"
                  onClick={() => setShowMutationForm(false)}
                  className="rounded-xl border border-[#C8922A]/30 px-4 py-2 text-xs text-[#9EB09F]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mutations.map((m) => (
              <div key={m.key} className="rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-sm font-bold text-[#F6EFE2]">{m.name}</div>
                    <div className="text-[11px] text-[#9EB09F]">
                      {m.rarity} · {m.inheritanceMode}
                    </div>
                  </div>
                  <span className="font-mono-num text-xs font-bold text-[#E8B84B]">
                    {formatCoins(m.basePrice)}
                  </span>
                </div>

                {m.imageUrl && (
                  <div className="studio-frame mt-2.5 h-28 w-full overflow-hidden rounded-xl border border-[#C8922A]/20">
                    <img src={m.imageUrl} alt={m.name} className="h-full w-full object-contain p-2" />
                  </div>
                )}

                <p className="mt-2 line-clamp-2 text-[11px] text-[#9EB09F]">{m.visualDescription}</p>

                {editingImageKey === m.key ? (
                  <div className="mt-3 space-y-2">
                    <input
                      type="text"
                      value={editingImageUrl}
                      onChange={(e) => setEditingImageUrl(e.target.value)}
                      placeholder="/assets/conures/... or https://..."
                      className="w-full rounded-lg border border-[#E8B84B]/40 bg-[#101813] px-2.5 py-1.5 text-xs text-[#F6EFE2]"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveImageUrl(m.key)}
                        className="rounded-lg bg-[#E8B84B] px-3 py-1 text-[11px] font-extrabold text-[#141A15]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingImageKey(null)}
                        className="rounded-lg border border-[#C8922A]/30 px-2.5 py-1 text-[11px] text-[#9EB09F]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingImageKey(m.key);
                      setEditingImageUrl(m.imageUrl || '');
                    }}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#C8922A]/30 bg-[#101813] py-1.5 text-[11px] font-semibold text-[#E8B84B] hover:border-[#E8B84B]"
                  >
                    <ImageIcon className="h-3.5 w-3.5" /> Update Image URL
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: ADD MARKET BIRD */}
      {tab === 'add-market-bird' && (
        <form
          onSubmit={handleInjectMarketBird}
          className="grid grid-cols-1 gap-5 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5 lg:grid-cols-3"
        >
          <div className="space-y-4 lg:col-span-2">
            <div>
              <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
                Inject Conure into Current Hour&apos;s Wild Exchange
              </h2>
              <p className="text-xs text-[#9EB09F]">
                Spawns immediately inside the active UTC Wild Market rotation for any breeder to buy with Coins.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Mutation *</label>
                <select
                  value={marketForm.mutationKey}
                  onChange={(e) => setMarketForm((p) => ({ ...p, mutationKey: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/35 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
                >
                  {mutationOptionList.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name} ({m.rarity})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Gender *</label>
                <select
                  value={marketForm.gender}
                  onChange={(e) =>
                    setMarketForm((p) => ({ ...p, gender: e.target.value as 'MALE' | 'FEMALE' }))
                  }
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/35 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
                >
                  <option value="MALE">♂ Male (Cock)</option>
                  <option value="FEMALE">♀ Female (Hen)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Custom Name (Optional)</label>
                <input
                  type="text"
                  value={marketForm.name}
                  onChange={(e) => setMarketForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Auto-named if empty"
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/35 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Market Price (Coins)</label>
                <input
                  type="number"
                  min={50}
                  value={marketForm.price}
                  onChange={(e) => setMarketForm((p) => ({ ...p, price: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/35 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#C8D3C2]">
                Symmetry Score: <span className="font-mono-num text-[#E8B84B]">{marketForm.symmetry}%</span>
              </label>
              <input
                type="range"
                min={70}
                max={100}
                value={marketForm.symmetry}
                onChange={(e) => setMarketForm((p) => ({ ...p, symmetry: e.target.value }))}
                className="mt-1 w-full accent-[#E8B84B]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#C8D3C2]">Hidden Split Carriers (Fog-of-War)</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SPLIT_ELIGIBLE_GENES.map((g) => {
                  const selected = marketForm.splits.includes(g.key);
                  return (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() =>
                        setMarketForm((p) => ({
                          ...p,
                          splits: selected ? p.splits.filter((s) => s !== g.key) : [...p.splits, g.key],
                        }))
                      }
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                        selected
                          ? 'bg-[#E8B84B] text-[#141A15]'
                          : 'border border-[#C8922A]/25 bg-[#101813] text-[#9EB09F]'
                      }`}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={busyActionId === 'inject-bird'}
              className="w-full rounded-xl bg-[#E8B84B] py-3 text-sm font-extrabold text-[#141A15] shadow hover:bg-[#F2C75C] sm:w-auto sm:px-6"
            >
              {busyActionId === 'inject-bird' ? 'Injecting...' : 'Inject into Wild Market Now'}
            </button>
          </div>

          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#C8922A]/25 bg-[#101813] p-5 text-center">
            <div className="studio-frame h-36 w-full max-w-[12rem] overflow-hidden rounded-xl border border-[#C8922A]/25">
              <img
                src={marketPreviewImg}
                alt={mutationNameForKey(marketForm.mutationKey)}
                className="h-full w-full object-contain p-2"
              />
            </div>
            <div className="mt-3 font-display text-base font-bold text-[#F6EFE2]">
              {mutationNameForKey(marketForm.mutationKey)}
            </div>
            <div className="text-xs text-[#9EB09F]">
              {marketForm.gender} · {marketForm.symmetry}% Symmetry · {formatCoins(Number(marketForm.price) || 0)}
            </div>
          </div>
        </form>
      )}

      {/* TAB 6: SPECIAL BIRD */}
      {tab === 'special-bird' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <form
            onSubmit={handleCreateSpecialBird}
            className="space-y-3 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5"
          >
            <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
              Create Special Featured Conure
            </h2>
            <p className="text-xs text-[#9EB09F]">
              Create a limited-stock flagship bird sold via NayaPay / foreign transfer, then click &quot;Make Live&quot;.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Bird Name *</label>
                <input
                  type="text"
                  required
                  value={specialForm.name}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Royal Suncheek Crown"
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Mutation *</label>
                <select
                  value={specialForm.mutationKey}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, mutationKey: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
                >
                  {mutationOptionList.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Gender *</label>
                <select
                  value={specialForm.gender}
                  onChange={(e) =>
                    setSpecialForm((p) => ({ ...p, gender: e.target.value as 'MALE' | 'FEMALE' }))
                  }
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
                >
                  <option value="FEMALE">♀ Female</option>
                  <option value="MALE">♂ Male</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Price (PKR)</label>
                <input
                  type="number"
                  min={100}
                  value={specialForm.pricePkr}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, pricePkr: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Stock</label>
                <input
                  type="number"
                  min={1}
                  value={specialForm.stock}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, stock: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#C8D3C2]">Symmetry %</label>
                <input
                  type="number"
                  min={75}
                  max={100}
                  value={specialForm.symmetry}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, symmetry: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#C8D3C2]">Custom Image URL (optional)</label>
              <input
                type="text"
                value={specialForm.imageUrl}
                onChange={(e) => setSpecialForm((p) => ({ ...p, imageUrl: e.target.value }))}
                placeholder="Uses mutation art if blank"
                className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#C8D3C2]">Description / Pitch</label>
              <textarea
                rows={2}
                value={specialForm.description}
                onChange={(e) => setSpecialForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Show-grade showpiece bloodline..."
                className="mt-1 w-full rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-2 text-xs text-[#F6EFE2]"
              />
            </div>
            <button
              type="submit"
              disabled={busyActionId === 'create-special'}
              className="w-full rounded-xl bg-[#E8B84B] py-2.5 text-xs font-extrabold text-[#141A15]"
            >
              Create Special Bird
            </button>
          </form>

          <div className="space-y-3 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5">
            <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
              Configured Special Birds ({specialBirds.length})
            </h2>
            <div className="space-y-2.5">
              {specialBirds.map((sb) => (
                <div
                  key={sb.id}
                  className="flex flex-col gap-2 rounded-xl border border-[#C8922A]/20 bg-[#101813] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-[#F6EFE2]">
                      {sb.name}
                      {sb.isLive && (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#9EB09F]">
                      {sb.mutationName || mutationNameForKey(sb.mutationKey)} · {sb.sex} · Rs. {sb.pricePkr} · Stock: {sb.stock}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSpecialLive(sb)}
                    disabled={busyActionId === sb.id}
                    className={`rounded-xl px-3 py-1.5 text-xs font-extrabold ${
                      sb.isLive
                        ? 'border border-rose-500/40 bg-rose-950/40 text-rose-200'
                        : 'bg-[#E8B84B] text-[#141A15]'
                    }`}
                  >
                    {sb.isLive ? 'Take Offline' : 'Make Live'}
                  </button>
                </div>
              ))}
              {specialBirds.length === 0 && (
                <div className="py-8 text-center text-xs text-[#9EB09F]">No Special Birds configured yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: PAYMENTS */}
      {tab === 'payments' && (
        <div className="space-y-4 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
                Payment Verification Queue ({filteredPayments.length})
              </h2>
              <p className="text-xs text-[#9EB09F]">
                When you click <strong className="text-emerald-300">Approve &amp; Deliver Bird</strong>, the exact requested conure (mutation + gender) is minted straight into that breeder&apos;s Aviary!
              </p>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setPaymentFilter(status)}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase ${
                    paymentFilter === status
                      ? 'bg-[#E8B84B] text-[#141A15]'
                      : 'border border-[#C8922A]/25 bg-[#101813] text-[#9EB09F]'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredPayments.map((req) => (
              <div
                key={req.id}
                className={`rounded-2xl border p-4 ${
                  req.status === 'pending'
                    ? 'border-[#E8B84B]/50 bg-[#1B271F]'
                    : 'border-[#C8922A]/20 bg-[#101813]'
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[#E8B84B]/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#E8B84B]">
                        {req.requestType.replace('_', ' ')}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                          req.status === 'approved'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                            : req.status === 'rejected'
                              ? 'bg-rose-950 text-rose-300 border border-rose-500/40'
                              : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {req.status}
                      </span>
                      <span className="text-[11px] text-[#9EB09F]">
                        {new Date(req.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-sm text-[#F6EFE2]">
                      Breeder: <strong className="text-[#E8B84B]">@{req.username}</strong> ({req.aviaryName}) · Sender Name:{' '}
                      <strong className="text-emerald-300">{req.senderName}</strong>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#C8D3C2]">
                      <span>
                        Amount: <strong className="text-[#F6EFE2]">{req.currency} {req.amount}</strong>
                      </span>
                      <span>
                        Channel: <strong className="text-[#F6EFE2]">{req.paymentMethod}</strong>
                      </span>
                      {req.senderPhone && (
                        <span>
                          Phone/Acct: <strong className="font-mono-num text-[#E8B84B]">{req.senderPhone}</strong>
                        </span>
                      )}
                    </div>

                    {req.requestedMutation && (
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-[#C8922A]/30 bg-[#101813] px-3 py-1.5 text-xs">
                        <span className="text-[#9EB09F]">Requested Conure:</span>
                        <strong className="text-[#E8B84B]">
                          {req.requestedMutationName || mutationNameForKey(req.requestedMutation)}
                        </strong>
                        <span className="rounded bg-[#213126] px-2 py-0.5 font-bold text-[#F6EFE2]">
                          {req.requestedGender === 'FEMALE' ? '♀ Female' : '♂ Male'}
                        </span>
                        {req.desiredBirdName && (
                          <span className="text-[#C8D3C2]">Name: &quot;{req.desiredBirdName}&quot;</span>
                        )}
                      </div>
                    )}

                    {req.specialBirdName && (
                      <div className="inline-flex items-center gap-2 rounded-xl border border-amber-400/35 bg-[#101813] px-3 py-1.5 text-xs">
                        <span className="text-[#9EB09F]">Special Bird:</span>
                        <strong className="text-[#E8B84B]">{req.specialBirdName}</strong>
                      </div>
                    )}

                    {req.referenceNote && (
                      <div className="text-xs italic text-[#9EB09F]">Ref / Note: &quot;{req.referenceNote}&quot;</div>
                    )}
                  </div>

                  {req.status === 'pending' && (
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => handleApprovePayment(req)}
                        disabled={busyActionId === req.id}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-[#0B1710] hover:bg-emerald-400 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                        {busyActionId === req.id
                          ? 'Delivering...'
                          : req.requestedMutation || req.specialBirdId
                            ? 'Approve & Deliver Bird'
                            : 'Approve Gift'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectPayment(req)}
                        disabled={busyActionId === req.id}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-900/50"
                      >
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {filteredPayments.length === 0 && (
              <div className="py-12 text-center text-xs text-[#9EB09F]">
                No payment claims matching filter &quot;{paymentFilter}&quot;.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 8: CHAT & AUDIT */}
      {tab === 'chat-audit' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* DM Inspector */}
          <div className="space-y-3 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5">
            <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
              DM Thread Audit ({threads.length})
            </h2>
            {threads.length === 0 ? (
              <div className="rounded-xl border border-[#C8922A]/15 bg-[#101813] p-6 text-center text-xs text-[#9EB09F]">
                No direct breeder chat messages recorded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {threads.map((t) => (
                  <button
                    key={`${t.u1Id}-${t.u2Id}`}
                    type="button"
                    onClick={() => handleInspectThread(t)}
                    className="flex w-full items-center justify-between rounded-xl border border-[#C8922A]/20 bg-[#101813] p-3 text-left text-xs hover:border-[#E8B84B]"
                  >
                    <div>
                      <span className="font-bold text-[#F6EFE2]">@{t.u1Username}</span> ↔{' '}
                      <span className="font-bold text-[#F6EFE2]">@{t.u2Username}</span>
                      <div className="text-[11px] text-[#9EB09F]">
                        {t.messageCount} messages · {t.snippet}
                      </div>
                    </div>
                    <Eye className="h-4 w-4 text-[#E8B84B]" />
                  </button>
                ))}
              </div>
            )}

            {selectedThread && (
              <div className="mt-3 rounded-xl border border-[#E8B84B]/35 bg-[#101813] p-3">
                <div className="mb-2 text-xs font-bold text-[#E8B84B]">
                  Transcript: @{selectedThread.u1Username} ↔ @{selectedThread.u2Username}
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
                  {threadMessages.map((m) => (
                    <div key={m.id} className="rounded-lg bg-[#151F18] px-2.5 py-1.5">
                      <span className="font-bold text-[#E8B84B]">@{m.username}:</span>{' '}
                      <span className="text-[#F6EFE2]">{m.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Economy & Notification Audit Feed */}
          <div className="space-y-3 rounded-2xl border border-[#C8922A]/25 bg-[#151F18] p-4 sm:p-5">
            <h2 className="font-display text-lg font-bold text-[#F6EFE2]">
              Economy &amp; Activity Audit Feed
            </h2>
            <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {auditFeed.map((a) => (
                <div key={a.id} className="rounded-xl border border-[#C8922A]/15 bg-[#101813] p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-[#1E2E23] px-1.5 py-0.5 text-[10px] font-bold text-[#E8B84B]">
                      {a.kind}
                    </span>
                    <span className="text-[10px] text-[#7D917E]">
                      {new Date(a.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 font-semibold text-[#F6EFE2]">{a.summary}</div>
                  <div className="text-[11px] text-[#9EB09F]">{a.detail}</div>
                </div>
              ))}
              {auditFeed.length === 0 && (
                <div className="py-8 text-center text-xs text-[#9EB09F]">No economy events logged yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Adjust Coins Modal */}
      {adjustModalUser && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <form
            onSubmit={handleAdjustCoins}
            className="brass-panel w-full max-w-md rounded-t-2xl p-5 sm:rounded-2xl"
          >
            <h3 className="font-display text-lg font-bold text-[#F6EFE2]">
              Adjust Balance · @{adjustModalUser.username}
            </h3>
            <p className="mt-1 text-xs text-[#9EB09F]">
              Current Balance: <strong className="text-[#E8B84B]">{formatCoins(adjustModalUser.coins)}</strong>. Use negative values to deduct.
            </p>
            <input
              type="number"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              className="mt-3 w-full rounded-xl border border-[#C8922A]/40 bg-[#101813] px-3 py-2.5 text-sm text-[#F6EFE2]"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={busyActionId === adjustModalUser.id}
                className="flex-1 rounded-xl bg-[#E8B84B] py-2.5 text-xs font-extrabold text-[#141A15]"
              >
                Apply Coin Change
              </button>
              <button
                type="button"
                onClick={() => setAdjustModalUser(null)}
                className="rounded-xl border border-[#C8922A]/30 px-4 py-2.5 text-xs text-[#9EB09F]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteTargetUser && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="brass-panel w-full max-w-md rounded-t-2xl border border-rose-500/40 p-5 sm:rounded-2xl">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-display text-lg font-bold">Confirm Breeder Deletion</h3>
            </div>
            <p className="mt-2 text-xs text-[#C8D3C2]">
              Delete <strong>@{deleteTargetUser.username}</strong> ({deleteTargetUser.aviaryName}) and clean up their birds, sessions, and market listings? This cannot be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={busyActionId === deleteTargetUser.id}
                className="flex-1 rounded-xl bg-rose-600 py-2.5 text-xs font-extrabold text-white"
              >
                {busyActionId === deleteTargetUser.id ? 'Deleting...' : 'Delete Forever'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTargetUser(null)}
                className="rounded-xl border border-[#C8922A]/30 px-4 py-2.5 text-xs text-[#9EB09F]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
