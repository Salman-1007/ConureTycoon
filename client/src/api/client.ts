import type {
  AdminActivityItemDTO,
  AdminBirdDTO,
  AdminChatMessageDTO,
  AdminChatThreadDTO,
  AdminOverviewDTO,
  AdminUserDTO,
  AviaryStateDTO,
  BreedingCageDTO,
  ConureDTO,
  FosterClutchResponseDTO,
  HatchResponseDTO,
  MutationConfigDTO,
  P2PListingDTO,
  PairPreviewResponseDTO,
  PaymentRequestDTO,
  ServerTimeDTO,
  ShowroomOverviewDTO,
  SpecialBirdDTO,
  SupportConfigDTO,
  SystemMarketListingDTO,
  UserProfileDTO,
} from '@shared/api-types';
import type { PedigreeTreeNode } from '@shared/genetics/pedigree';
import type { ShowCategory } from '@shared/genetics/showroom';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
  }
}

const API_BASE = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const targetUrl = API_BASE && url.startsWith('/') ? `${API_BASE}${url}` : url;
  const res = await fetch(targetUrl, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data);
  }
  return data as T;
}

export const api = {
  getTime: () => request<ServerTimeDTO>('/api/time'),
  getMe: () => request<{ user: UserProfileDTO }>('/api/auth/me'),
  register: (body: {
    username: string;
    password: string;
    displayName: string;
    aviaryName: string;
    startingCoins?: number;
  }) =>
    request<{ user: UserProfileDTO; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { username: string; password: string }) =>
    request<{ user: UserProfileDTO; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getAviary: () => request<AviaryStateDTO>('/api/aviary'),
  renameBird: (birdId: string, name: string) =>
    request<{ ok: boolean; name: string }>(`/api/birds/${birdId}/name`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  sellBirdToSanctuary: (birdId: string) =>
    request<{ payout: number; newCoinsBalance: number }>(`/api/birds/${birdId}/sell`, {
      method: 'POST',
    }),
  getPedigree: (birdId: string) => request<{ tree: PedigreeTreeNode }>(`/api/birds/${birdId}/pedigree`),

  getSystemMarket: () =>
    request<{ serverTime: ServerTimeDTO; hourBucketUtc: number; listings: SystemMarketListingDTO[] }>(
      '/api/market/system',
    ),
  buySystemListing: (listingId: string) =>
    request<{ bird: ConureDTO; newCoinsBalance: number; pricePaid: number }>(
      `/api/market/system/${listingId}/buy`,
      { method: 'POST' },
    ),

  getP2PMarket: () => request<{ listings: P2PListingDTO[] }>('/api/market/p2p'),
  createP2PListing: (body: { birdId: string; askingPrice: number; sellerNote: string }) =>
    request<{ listing: P2PListingDTO }>('/api/market/p2p', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  buyP2PListing: (listingId: string) =>
    request<{ bird: ConureDTO; newCoinsBalance: number; pricePaid: number }>(`/api/market/p2p/${listingId}/buy`, {
      method: 'POST',
    }),
  cancelP2PListing: (listingId: string) =>
    request<{ ok: boolean }>(`/api/market/p2p/${listingId}`, {
      method: 'DELETE',
    }),

  previewPair: (birdAId: string, birdBId: string) =>
    request<PairPreviewResponseDTO>('/api/breeding/preview', {
      method: 'POST',
      body: JSON.stringify({ birdAId, birdBId }),
    }),
  startPair: (birdAId: string, birdBId: string, acknowledgeInbreeding: boolean) =>
    request<{ cage: BreedingCageDTO }>('/api/breeding/pair', {
      method: 'POST',
      body: JSON.stringify({ birdAId, birdBId, acknowledgeInbreeding }),
    }),
  collectHatch: (cageId: string) =>
    request<HatchResponseDTO>(`/api/breeding/collect/${cageId}`, {
      method: 'POST',
    }),
  fosterClutch: (sourceCageId: string, targetCageId: string) =>
    request<FosterClutchResponseDTO>('/api/breeding/foster', {
      method: 'POST',
      body: JSON.stringify({ sourceCageId, targetCageId }),
    }),

  getShowroom: () => request<ShowroomOverviewDTO>('/api/showroom'),
  enterShowroom: (birdId: string, category: ShowCategory) =>
    request<{
      entry: ShowroomOverviewDTO['recentEntries'][number];
      prizeCoins: number;
      xpAwarded: number;
      awardedBadge: { badgeKey: string; badgeTitle: string } | null;
    }>('/api/showroom/enter', {
      method: 'POST',
      body: JSON.stringify({ birdId, category }),
    }),

  markNotificationsRead: () => request<{ ok: boolean }>('/api/notifications/read', { method: 'POST' }),

  devAdvanceTime: (hours: number) =>
    request<{ serverTime: ServerTimeDTO }>('/api/dev/advance-time', {
      method: 'POST',
      body: JSON.stringify({ hours }),
    }),
  devRefreshMarket: () =>
    request<{ serverTime: ServerTimeDTO }>('/api/dev/refresh-market', {
      method: 'POST',
    }),

  // Support Creator, Mutations & Choice / Special Bird Payments
  getSupportConfig: () => request<{ supportConfig: SupportConfigDTO }>('/api/support/config'),
  getMutations: () => request<{ mutations: MutationConfigDTO[] }>('/api/mutations'),
  getLiveSpecialBird: () => request<{ specialBird: SpecialBirdDTO | null }>('/api/special-bird'),
  submitChoiceBirdPayment: (body: {
    mutationKey: string;
    gender: 'MALE' | 'FEMALE';
    desiredBirdName?: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    senderName: string;
    senderPhone?: string;
    referenceNote?: string;
  }) =>
    request<{ ok: boolean; request: PaymentRequestDTO }>('/api/payments/choice-bird', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submitSpecialBirdPayment: (
    specialBirdId: string,
    body: {
      senderName: string;
      senderPhone?: string;
      referenceNote?: string;
      paymentMethod?: string;
      currency?: string;
      amount?: number;
    },
  ) =>
    request<{ ok: boolean; request: PaymentRequestDTO }>(`/api/payments/special-bird/${specialBirdId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submitSupportPayment: (body: {
    senderName: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    referenceNote?: string;
  }) =>
    request<{ ok: boolean; request: PaymentRequestDTO }>('/api/payments/support', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getMyPaymentRequests: () => request<{ requests: PaymentRequestDTO[] }>('/api/payments/my-requests'),

  // Admin Panel (salman)
  adminOverview: () => request<AdminOverviewDTO>('/api/admin/overview'),
  adminUsers: () => request<{ users: AdminUserDTO[] }>('/api/admin/users'),
  adminAdjustMoney: (id: string, amount: number) =>
    request<{ ok: boolean; coins: number }>(`/api/admin/users/${id}/adjust-money`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  adminDeleteUser: (id: string) => request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  adminBirds: () => request<{ birds: AdminBirdDTO[] }>('/api/admin/birds'),
  adminMutations: () => request<{ mutations: MutationConfigDTO[] }>('/api/admin/mutations'),
  adminSaveMutation: (body: {
    key?: string;
    name: string;
    chromosomeLabel?: string;
    inheritanceMode?: string;
    visualDescription?: string;
    imageUrl?: string;
    basePrice?: number;
    rarity?: string;
    rarityScore?: number;
    accentHex?: string;
    basePhenotype?: string;
  }) =>
    request<{ ok: boolean; mutation: MutationConfigDTO }>('/api/admin/mutations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminUpdateMutationImage: (key: string, imageUrl: string) =>
    request<{ ok: boolean }>(`/api/admin/mutations/${encodeURIComponent(key)}/image`, {
      method: 'PATCH',
      body: JSON.stringify({ imageUrl }),
    }),
  adminAddMarketBird: (body: {
    name?: string;
    mutationKey: string;
    gender: 'MALE' | 'FEMALE';
    symmetry: number;
    price: number;
    splits: string[];
  }) =>
    request<{ ok: boolean; listingId: string; legBand: string }>('/api/admin/market/add', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminSpecialBirds: () => request<{ specialBirds: SpecialBirdDTO[] }>('/api/admin/special-birds'),
  adminAddSpecialBird: (body: {
    name: string;
    mutationKey: string;
    gender: 'MALE' | 'FEMALE';
    symmetry?: number;
    splits?: string[];
    pricePkr: number;
    imageUrl?: string;
    description?: string;
    stock?: number;
  }) =>
    request<{ ok: boolean; specialBird: SpecialBirdDTO }>('/api/admin/special-birds', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminSetSpecialLive: (id: string, isLive: boolean) =>
    request<{ ok: boolean }>(`/api/admin/special-birds/${id}/live`, {
      method: 'PATCH',
      body: JSON.stringify({ isLive }),
    }),
  adminPaymentRequests: () => request<{ requests: PaymentRequestDTO[] }>('/api/admin/payment-requests'),
  adminApprovePayment: (id: string) =>
    request<{ ok: boolean; deliveredBirdLegBand: string | null; deliveredBirdName: string | null }>(
      `/api/admin/payment-requests/${id}/approve`,
      { method: 'POST' },
    ),
  adminRejectPayment: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/payment-requests/${id}/reject`, { method: 'POST' }),
  adminUpdateSupportConfig: (body: Partial<SupportConfigDTO>) =>
    request<{ ok: boolean; supportConfig: SupportConfigDTO }>('/api/admin/support-config', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminChatThreads: () => request<{ threads: AdminChatThreadDTO[] }>('/api/admin/chat/all'),
  adminInspectThread: (u1: string, u2: string) =>
    request<{ messages: AdminChatMessageDTO[] }>(`/api/admin/chat/thread/${u1}/${u2}`),
  adminAuditFeed: () => request<{ activity: AdminActivityItemDTO[] }>('/api/admin/audit-feed'),
};
