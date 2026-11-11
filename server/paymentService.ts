import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  PaymentRequestDTO,
  PaymentRequestType,
  SpecialBirdDTO,
  SupportConfigDTO,
} from '../shared/api-types.js';
import { MUTATION_CATALOG, getMutationMeta, normalizeGeneKey } from '../shared/genetics/catalog.js';
import type { Sex } from '../shared/genetics/types.js';
import { loadMutationConfigsMap, parseJsonArray, resolveMutationAssetUrl } from './birdHelpers.js';

export const SUPPORT_CONFIG_META_KEY = 'support_config_v1';

export const DEFAULT_SUPPORT_CONFIG: SupportConfigDTO = {
  nayapayNumber: '03324261998',
  accountTitle: 'Salman Adil',
  internationalNumber: '+92 332 4261998',
  iban: '',
  kofiUrl: process.env.CREATOR_KOFI_URL ?? '',
  paypalEmail: process.env.CREATOR_PAYPAL_EMAIL ?? '',
  wiseTag: process.env.CREATOR_WISE_TAG ?? '',
  binanceId: process.env.CREATOR_BINANCE_ID ?? '',
  customForeignNote:
    'Foreign supporters can send directly to NayaPay Pakistan mobile wallet (+92 332 4261998) via Wise, Remitly, Taptap Send, WorldRemit, or Western Union.',
};

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function getSupportConfig(db: DatabaseSync): SupportConfigDTO {
  const row = db.prepare('SELECT meta_value FROM system_meta WHERE meta_key = ?').get(SUPPORT_CONFIG_META_KEY) as
    | { meta_value: string }
    | undefined;
  if (!row) return { ...DEFAULT_SUPPORT_CONFIG };
  try {
    const parsed = JSON.parse(row.meta_value) as Partial<SupportConfigDTO>;
    return {
      nayapayNumber: parsed.nayapayNumber?.trim() || DEFAULT_SUPPORT_CONFIG.nayapayNumber,
      accountTitle: parsed.accountTitle?.trim() || DEFAULT_SUPPORT_CONFIG.accountTitle,
      internationalNumber: parsed.internationalNumber?.trim() || DEFAULT_SUPPORT_CONFIG.internationalNumber,
      iban: parsed.iban?.trim() ?? '',
      kofiUrl: parsed.kofiUrl?.trim() ?? DEFAULT_SUPPORT_CONFIG.kofiUrl,
      paypalEmail: parsed.paypalEmail?.trim() ?? DEFAULT_SUPPORT_CONFIG.paypalEmail,
      wiseTag: parsed.wiseTag?.trim() ?? DEFAULT_SUPPORT_CONFIG.wiseTag,
      binanceId: parsed.binanceId?.trim() ?? DEFAULT_SUPPORT_CONFIG.binanceId,
      customForeignNote: parsed.customForeignNote?.trim() || DEFAULT_SUPPORT_CONFIG.customForeignNote,
    };
  } catch {
    return { ...DEFAULT_SUPPORT_CONFIG };
  }
}

export function updateSupportConfig(db: DatabaseSync, patch: Partial<SupportConfigDTO>): SupportConfigDTO {
  const current = getSupportConfig(db);
  const next: SupportConfigDTO = {
    nayapayNumber: (patch.nayapayNumber ?? current.nayapayNumber).trim().slice(0, 40) || '03324261998',
    accountTitle: (patch.accountTitle ?? current.accountTitle).trim().slice(0, 80) || 'Salman Adil',
    internationalNumber:
      (patch.internationalNumber ?? current.internationalNumber).trim().slice(0, 40) || '+92 332 4261998',
    iban: (patch.iban ?? current.iban).trim().slice(0, 64),
    kofiUrl: (patch.kofiUrl ?? current.kofiUrl).trim().slice(0, 200),
    paypalEmail: (patch.paypalEmail ?? current.paypalEmail).trim().slice(0, 120),
    wiseTag: (patch.wiseTag ?? current.wiseTag).trim().slice(0, 120),
    binanceId: (patch.binanceId ?? current.binanceId).trim().slice(0, 80),
    customForeignNote: (patch.customForeignNote ?? current.customForeignNote).trim().slice(0, 400),
  };

  db.prepare(
    `INSERT INTO system_meta (meta_key, meta_value) VALUES (?, ?)
     ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value`,
  ).run(SUPPORT_CONFIG_META_KEY, JSON.stringify(next));

  return next;
}

export interface SpecialBirdRow {
  id: string;
  name: string;
  mutation_key: string;
  sex: Sex;
  plumage_symmetry: number;
  splits_json: string;
  price_pkr: number;
  image_url: string;
  description: string;
  is_live: number;
  stock: number;
  created_at: number;
}

export function mapSpecialBirdRow(db: DatabaseSync, row: SpecialBirdRow): SpecialBirdDTO {
  const overrides = loadMutationConfigsMap(db);
  const override = overrides.get(row.mutation_key);
  const meta = getMutationMeta(row.mutation_key);
  return {
    id: row.id,
    name: row.name,
    mutationKey: row.mutation_key,
    mutationName: override?.name || meta.name,
    sex: row.sex,
    plumageSymmetry: row.plumage_symmetry,
    splits: parseJsonArray<string>(row.splits_json),
    pricePkr: row.price_pkr,
    imageUrl: row.image_url.trim() || resolveMutationAssetUrl(row.mutation_key, override),
    description: row.description,
    isLive: Boolean(row.is_live),
    stock: row.stock,
    createdAt: row.created_at,
  };
}

export function getLiveSpecialBird(db: DatabaseSync): SpecialBirdDTO | null {
  const row = db
    .prepare(
      `SELECT * FROM special_birds
       WHERE is_live = 1 AND (stock > 0 OR stock = -1)
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as SpecialBirdRow | undefined;
  return row ? mapSpecialBirdRow(db, row) : null;
}

export function submitChoiceBirdPaymentRequest(
  db: DatabaseSync,
  userId: string,
  payload: {
    mutationKey: string;
    gender: string;
    desiredBirdName?: string;
    amount: number;
    currency?: string;
    paymentMethod?: string;
    senderName: string;
    senderPhone?: string;
    referenceNote?: string;
  },
): PaymentRequestDTO {
  const senderName = String(payload.senderName ?? '').trim().slice(0, 80);
  if (!senderName) {
    throw new PaymentServiceError('Please enter the sender name used for the payment.');
  }

  const rawMutation = String(payload.mutationKey ?? '').trim();
  const normKey = normalizeGeneKey(rawMutation);
  const overrides = loadMutationConfigsMap(db);
  if (!overrides.has(rawMutation) && !(normKey in MUTATION_CATALOG)) {
    throw new PaymentServiceError('Please select a valid conure mutation from the list.');
  }
  const resolvedMutationKey = overrides.has(rawMutation) ? rawMutation : normKey;

  const gender = String(payload.gender ?? '').toUpperCase();
  if (gender !== 'MALE' && gender !== 'FEMALE') {
    throw new PaymentServiceError('Please choose Male or Female for your conure.');
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentServiceError('Please enter the amount you sent to buy the creator a coffee.');
  }

  const currency = String(payload.currency ?? 'PKR').trim().toUpperCase().slice(0, 8) || 'PKR';
  const paymentMethod = String(payload.paymentMethod ?? 'NayaPay').trim().slice(0, 64) || 'NayaPay';
  const desiredBirdName = String(payload.desiredBirdName ?? '').trim().slice(0, 32);
  const senderPhone = String(payload.senderPhone ?? '').trim().slice(0, 64);
  const referenceNote = String(payload.referenceNote ?? '').trim().slice(0, 240);

  return insertPaymentRequest(db, {
    userId,
    requestType: 'CHOICE_BIRD',
    specialBirdId: null,
    requestedMutation: resolvedMutationKey,
    requestedGender: gender,
    desiredBirdName,
    amount,
    currency,
    paymentMethod,
    senderName,
    senderPhone,
    referenceNote,
  });
}

export function submitSpecialBirdPaymentRequest(
  db: DatabaseSync,
  userId: string,
  specialBirdId: string,
  payload: {
    senderName: string;
    senderPhone?: string;
    referenceNote?: string;
    paymentMethod?: string;
    currency?: string;
    amount?: number;
  },
): PaymentRequestDTO {
  const sb = db
    .prepare('SELECT * FROM special_birds WHERE id = ? AND is_live = 1 AND (stock > 0 OR stock = -1)')
    .get(specialBirdId) as SpecialBirdRow | undefined;
  if (!sb) {
    throw new PaymentServiceError('This special conure is currently unavailable.', 404);
  }

  const senderName = String(payload.senderName ?? '').trim().slice(0, 80);
  const senderPhone = String(payload.senderPhone ?? '').trim().slice(0, 64);
  const referenceNote = String(payload.referenceNote ?? '').trim().slice(0, 240);
  if (!senderName) {
    throw new PaymentServiceError('Sender name is required.');
  }
  if (!senderPhone && !referenceNote) {
    throw new PaymentServiceError('Please enter your phone/account ID or transaction reference.');
  }

  return insertPaymentRequest(db, {
    userId,
    requestType: 'SPECIAL_BIRD',
    specialBirdId: sb.id,
    requestedMutation: sb.mutation_key,
    requestedGender: sb.sex,
    desiredBirdName: sb.name,
    amount: Number.isFinite(Number(payload.amount)) && Number(payload.amount) > 0 ? Number(payload.amount) : sb.price_pkr,
    currency: String(payload.currency ?? 'PKR').trim().toUpperCase().slice(0, 8) || 'PKR',
    paymentMethod: String(payload.paymentMethod ?? 'NayaPay').trim().slice(0, 64) || 'NayaPay',
    senderName,
    senderPhone,
    referenceNote,
  });
}

export function submitSupportRequest(
  db: DatabaseSync,
  userId: string,
  payload: {
    senderName: string;
    amount: number;
    currency?: string;
    paymentMethod?: string;
    referenceNote?: string;
  },
): PaymentRequestDTO {
  const senderName = String(payload.senderName ?? '').trim().slice(0, 80);
  if (!senderName) {
    throw new PaymentServiceError('Please provide your sender name.');
  }
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentServiceError('Please enter a valid support amount.');
  }

  return insertPaymentRequest(db, {
    userId,
    requestType: 'SUPPORT',
    specialBirdId: null,
    requestedMutation: null,
    requestedGender: null,
    desiredBirdName: '',
    amount,
    currency: String(payload.currency ?? 'PKR').trim().toUpperCase().slice(0, 8) || 'PKR',
    paymentMethod: String(payload.paymentMethod ?? 'NayaPay').trim().slice(0, 64) || 'NayaPay',
    senderName,
    senderPhone: '',
    referenceNote: String(payload.referenceNote ?? '').trim().slice(0, 240),
  });
}

function insertPaymentRequest(
  db: DatabaseSync,
  params: {
    userId: string;
    requestType: PaymentRequestType;
    specialBirdId: string | null;
    requestedMutation: string | null;
    requestedGender: Sex | null;
    desiredBirdName: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    senderName: string;
    senderPhone: string;
    referenceNote: string;
  },
): PaymentRequestDTO {
  const id = `pay_${crypto.randomUUID()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO payment_requests (
      id, user_id, request_type, special_bird_id, requested_mutation, requested_gender,
      desired_bird_name, amount, currency, payment_method, sender_name, sender_phone,
      reference_note, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    id,
    params.userId,
    params.requestType,
    params.specialBirdId,
    params.requestedMutation,
    params.requestedGender,
    params.desiredBirdName,
    params.amount,
    params.currency,
    params.paymentMethod,
    params.senderName,
    params.senderPhone,
    params.referenceNote,
    now,
  );

  const created = listPaymentRequests(db, params.userId, id);
  return created[0]!;
}

interface JoinedPaymentRow {
  id: string;
  user_id: string;
  username: string;
  aviary_name: string;
  request_type: PaymentRequestType;
  special_bird_id: string | null;
  special_bird_name: string | null;
  requested_mutation: string | null;
  requested_gender: Sex | null;
  desired_bird_name: string;
  amount: number;
  currency: string;
  payment_method: string;
  sender_name: string;
  sender_phone: string;
  reference_note: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  reviewed_at: number | null;
}

export function listPaymentRequests(
  db: DatabaseSync,
  filterUserId?: string,
  singleId?: string,
): PaymentRequestDTO[] {
  const whereParts: string[] = [];
  const args: Array<string> = [];
  if (filterUserId) {
    whereParts.push('pr.user_id = ?');
    args.push(filterUserId);
  }
  if (singleId) {
    whereParts.push('pr.id = ?');
    args.push(singleId);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT pr.*, u.username, u.aviary_name, sb.name AS special_bird_name
       FROM payment_requests pr
       JOIN users u ON u.id = pr.user_id
       LEFT JOIN special_birds sb ON sb.id = pr.special_bird_id
       ${whereSql}
       ORDER BY pr.created_at DESC
       LIMIT 200`,
    )
    .all(...args) as unknown as JoinedPaymentRow[];

  const overrides = loadMutationConfigsMap(db);
  return rows.map((r) => {
    const mutKey = r.requested_mutation;
    const override = mutKey ? overrides.get(mutKey) : undefined;
    const meta = mutKey ? getMutationMeta(mutKey) : null;
    return {
      id: r.id,
      userId: r.user_id,
      username: r.username,
      aviaryName: r.aviary_name,
      requestType: r.request_type,
      specialBirdId: r.special_bird_id,
      specialBirdName: r.special_bird_name,
      requestedMutation: mutKey,
      requestedMutationName: mutKey ? override?.name || meta?.name || mutKey : null,
      requestedMutationImage: mutKey ? resolveMutationAssetUrl(mutKey, override) : null,
      requestedGender: r.requested_gender,
      desiredBirdName: r.desired_bird_name,
      amount: r.amount,
      currency: r.currency,
      paymentMethod: r.payment_method,
      senderName: r.sender_name,
      senderPhone: r.sender_phone,
      referenceNote: r.reference_note,
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    };
  });
}
