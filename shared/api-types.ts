import type { PedigreeTreeNode } from './genetics/pedigree.js';
import type { ShowCategory, ShowScoreBreakdown } from './genetics/showroom.js';
import type { MutationKey, Sex, VisibleSplit } from './genetics/types.js';

export type BirdLifecycleStatus =
  | 'READY'
  | 'BREEDING'
  | 'INCUBATING'
  | 'JUVENILE'
  | 'COOLDOWN'
  | 'MARKET_SYSTEM'
  | 'MARKET_P2P'
  | 'SANCTUARY';

export interface ConureDTO {
  id: string;
  legBand: string;
  name: string;
  sex: Sex;
  visualPhenotype: MutationKey;
  phenotypeName: string;
  rarity: string;
  assetUrl: string;
  accentHex: string;
  visibleSplits: VisibleSplit[];
  plumageSymmetry: number;
  fatherId: string | null;
  motherId: string | null;
  originalBreederId: string;
  originalBreederName: string;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  hatchTimestamp: number;
  geneticsRevealTimestamp: number;
  geneticsRevealed: boolean;
  maturationTimestamp: number;
  cooldownUntil: number;
  generationDepth: number;
  breedCount: number;
  lifecycleStatus: BirdLifecycleStatus;
  sanctuaryValue: number;
}

export interface BreedingCageDTO {
  id: string;
  male: ConureDTO;
  female: ConureDTO;
  inbreedingCoi: number;
  coiWarning: boolean;
  clutchSize: number;
  fosteredCount: number;
  startedAt: number;
  laidAt: number;
  eggsLaid: boolean;
  hatchReadyAt: number;
  hatched: boolean;
}

export interface SystemMarketListingDTO {
  listingId: string;
  hourBucketUtc: number;
  price: number;
  status: 'ACTIVE' | 'SOLD';
  bird: ConureDTO;
}

export interface P2PListingDTO {
  listingId: string;
  sellerId: string;
  sellerName: string;
  sellerAviaryName: string;
  askingPrice: number;
  sellerNote: string;
  status: 'ACTIVE' | 'SOLD' | 'CANCELLED';
  createdAt: number;
  bird: ConureDTO;
  pedigree: PedigreeTreeNode;
}

export interface DiscoveredGeneDTO {
  geneKey: string;
  unlockedAt: number;
}

export interface UserBadgeDTO {
  badgeKey: string;
  badgeTitle: string;
  awardedAt: number;
}

export interface NotificationDTO {
  id: string;
  kind: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
}

export interface UserProfileDTO {
  id: string;
  username: string;
  displayName: string;
  aviaryName: string;
  coins: number;
  xp: number;
  level: number;
  levelTitle: string;
  nextLevelXp: number;
  totalShows: number;
  totalShowWins: number;
  bestShowScore: number;
  totalCoinsEarned: number;
  marketSpent: number;
  createdAt: number;
  discoveredGenes: DiscoveredGeneDTO[];
  badges: UserBadgeDTO[];
  notifications: NotificationDTO[];
  devToolsEnabled: boolean;
  isAdmin: boolean;
  pendingPaymentsCount?: number;
}

export interface ServerTimeDTO {
  serverUtcMs: number;
  effectiveNowMs: number;
  timeOffsetMs: number;
  currentHourBucketUtc: number;
  nextRefreshUtcMs: number;
}

export interface ShowroomLeaderboardRowDTO {
  entryId: string;
  seasonKey: string;
  category: ShowCategory;
  rankPosition: number;
  userId: string;
  breederName: string;
  aviaryName: string;
  birdId: string;
  birdName: string;
  legBand: string;
  visualPhenotype: MutationKey;
  phenotypeName: string;
  breakdown: ShowScoreBreakdown;
  prizeCoins: number;
  enteredAt: number;
}

export interface ShowroomOverviewDTO {
  seasonKey: string;
  leaderboards: Record<ShowCategory, ShowroomLeaderboardRowDTO[]>;
  recentEntries: ShowroomLeaderboardRowDTO[];
}

export interface AviaryStateDTO {
  user: UserProfileDTO;
  birds: ConureDTO[];
  activeCages: BreedingCageDTO[];
  serverTime: ServerTimeDTO;
  autoHatched?: HatchResponseDTO[];
}

export interface PairPreviewResponseDTO {
  eligible: boolean;
  reason?: string;
  inbreedingCoi: number;
  coiWarning: boolean;
  commonAncestorLabels: string[];
}

export interface HatchResponseDTO {
  cageId: string;
  chicks: ConureDTO[];
  newlyDiscoveredGenes: string[];
  retroactivelyRevealedBirdIds: string[];
  notifications: NotificationDTO[];
  fosterOverloadTotal?: number;
  fosterLostCount?: number;
}

export interface FosterClutchResponseDTO {
  sourceCageId: string;
  targetCage: BreedingCageDTO;
  transferredCount: number;
  totalInTarget: number;
  extraRiskCount: number;
  freedParents: [string, string];
}

export interface MutationConfigDTO {
  key: string;
  name: string;
  chromosomeLabel: string;
  inheritanceMode: string;
  visualDescription: string;
  imageUrl: string;
  basePrice: number;
  rarity: string;
  rarityScore: number;
  accentHex: string;
  basePhenotype: string;
  isCustom: boolean;
}

export interface SupportConfigDTO {
  nayapayNumber: string;
  accountTitle: string;
  internationalNumber: string;
  iban: string;
  kofiUrl: string;
  paypalEmail: string;
  wiseTag: string;
  binanceId: string;
  customForeignNote: string;
}

export interface SpecialBirdDTO {
  id: string;
  name: string;
  mutationKey: string;
  mutationName: string;
  sex: Sex;
  plumageSymmetry: number;
  splits: string[];
  pricePkr: number;
  imageUrl: string;
  description: string;
  isLive: boolean;
  stock: number;
  createdAt: number;
}

export type PaymentRequestType = 'CHOICE_BIRD' | 'SPECIAL_BIRD' | 'SUPPORT';
export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentRequestDTO {
  id: string;
  userId: string;
  username: string;
  aviaryName: string;
  requestType: PaymentRequestType;
  specialBirdId: string | null;
  specialBirdName: string | null;
  requestedMutation: string | null;
  requestedMutationName: string | null;
  requestedMutationImage: string | null;
  requestedGender: Sex | null;
  desiredBirdName: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  senderName: string;
  senderPhone: string;
  referenceNote: string;
  status: PaymentRequestStatus;
  createdAt: number;
  reviewedAt: number | null;
}

export interface AdminOverviewDTO {
  users: number;
  birds: number;
  showroomEntries: number;
  pendingPayments: number;
  activeMarketListings: number;
  activeCages: number;
  p2pListings: number;
}

export interface AdminUserDTO {
  id: string;
  username: string;
  displayName: string;
  aviaryName: string;
  coins: number;
  xp: number;
  level: number;
  totalShows: number;
  totalShowWins: number;
  birdCount: number;
  isAdmin: boolean;
  createdAt: number;
}

export interface AdminBirdDTO {
  id: string;
  legBand: string;
  name: string;
  sex: Sex;
  visualPhenotype: string;
  phenotypeName: string;
  assetUrl: string;
  ownerUsername: string | null;
  ownerAviaryName: string | null;
  status: string;
  plumageSymmetry: number;
  generationDepth: number;
  hatchTimestamp: number;
}

export interface AdminChatThreadDTO {
  u1Id: string;
  u2Id: string;
  u1Username: string;
  u1Aviary: string;
  u2Username: string;
  u2Aviary: string;
  messageCount: number;
  lastActivity: number;
  snippet: string;
}

export interface AdminChatMessageDTO {
  id: string;
  userId: string;
  recipientId: string | null;
  username: string;
  aviaryName: string;
  message: string;
  createdAt: number;
}

export interface AdminActivityItemDTO {
  id: string;
  kind: 'P2P_SALE' | 'MARKET_BUY' | 'SHOWROOM' | 'PAYMENT';
  summary: string;
  detail: string;
  timestamp: number;
}
