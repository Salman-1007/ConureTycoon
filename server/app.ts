import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { buildPedigreeTree } from '../shared/genetics/pedigree.js';
import type { ShowCategory } from '../shared/genetics/showroom.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  type UserRow,
  authenticateUser,
  buildUserProfileDTO,
  deleteSession,
  getUserBySessionToken,
  registerUser,
} from './auth.js';
import {
  AdminServiceError,
  adjustUserCoins,
  approvePaymentRequest,
  createSpecialBird,
  deleteAdminUser,
  ensureMutationConfigsSynced,
  getAdminAuditFeed,
  getAdminBirds,
  getAdminChatThreadMessages,
  getAdminChatThreads,
  getAdminOverview,
  getAdminSpecialBirds,
  getAdminUsers,
  getMutationConfigs,
  injectMarketBird,
  rejectPaymentRequest,
  setSpecialBirdLive,
  updateMutationImage,
  upsertMutationConfig,
} from './adminService.js';
import {
  type BirdRow,
  computeLifecycleStatus,
  computeSanctuaryValue,
  getUserDiscoveredGenes,
  loadAllBirdsMap,
  loadMutationConfigsMap,
  loadOwnerNamesMap,
  toSanitizedConureDTO,
} from './birdHelpers.js';
import {
  BreedingError,
  collectHatchedClutch,
  fosterClutch,
  getActiveCagesForUser,
  previewBreedingPair,
  startBreedingPair,
  syncAviaryChickReveals,
} from './breedingService.js';
import {
  advanceDevTimeOffsetMs,
  getServerClock,
  isDevTimeToolsEnabled,
} from './clock.js';
import { type AppDatabase, withTransaction } from './db.js';
import {
  MarketPurchaseError,
  buySystemMarketListing,
  ensureHourlyMarketBatch,
  getActiveSystemMarket,
} from './marketWorker.js';
import {
  PaymentServiceError,
  getLiveSpecialBird,
  getSupportConfig,
  listPaymentRequests,
  submitChoiceBirdPaymentRequest,
  submitSpecialBirdPaymentRequest,
  submitSupportRequest,
  updateSupportConfig,
} from './paymentService.js';
import { seedWorldData } from './seed.js';
import { ShowroomError, enterShowroom, getShowroomOverview } from './showroomService.js';
import {
  TradingError,
  buyP2PListing,
  cancelP2PListing,
  getActiveP2PListings,
  listBirdOnP2P,
} from './tradingService.js';

interface AuthedRequest extends Request {
  user?: UserRow;
  sessionToken?: string;
}

function extractSessionToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string): void {
  const crossSite = process.env.COOKIE_SAME_SITE === 'none';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true'),
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export async function initializeAppData(db: AppDatabase): Promise<void> {
  await seedWorldData(db);
  await ensureMutationConfigsSynced(db);
  await ensureHourlyMarketBatch(db);
}

export function createApp(db: AppDatabase) {
  const bootstrapPromise = initializeAppData(db).catch((err) => {
    console.error('[GCCT App] Bootstrap failed:', err);
  });

  const app = express();
  app.set('trust proxy', 1);

  // Optional CORS support for split Vercel frontend + Render backend deployments
  app.use((req, res, next) => {
    const allowedRaw = process.env.CORS_ORIGIN?.trim();
    const requestOrigin = req.headers.origin;
    if (allowedRaw && requestOrigin) {
      const allowedList = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean);
      if (allowedList.includes('*') || allowedList.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Guarantee seed & market initialization before any API handler executes
  app.use('/api', async (_req, _res, next) => {
    await bootstrapPromise;
    next();
  });

  const requireAuth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const token = extractSessionToken(req);
      const user = await getUserBySessionToken(db, token);
      if (!user) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      req.user = user;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireAdmin = (req: AuthedRequest, res: Response, next: NextFunction) => {
    void requireAuth(req, res, () => {
      const user = req.user!;
      const isAdmin = user.username.toLowerCase() === 'salman' || Boolean(user.is_admin);
      if (!isAdmin) {
        res.status(403).json({ error: 'Admin access required (salman).' });
        return;
      }
      next();
    });
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, devToolsEnabled: isDevTimeToolsEnabled(), dbDialect: db.dialect });
  });

  app.get('/api/time', async (_req, res) => {
    res.json(await getServerClock(db));
  });

  // Auth routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { username, password, displayName, aviaryName, startingCoins } = req.body ?? {};
      const { user, token } = await registerUser(db, {
        username: String(username ?? ''),
        password: String(password ?? ''),
        displayName: String(displayName ?? ''),
        aviaryName: String(aviaryName ?? ''),
        startingCoins: startingCoins !== undefined ? Number(startingCoins) : undefined,
      });
      setSessionCookie(res, token);
      res.status(201).json({ user: await buildUserProfileDTO(db, user), token });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      const { user, token } = await authenticateUser(db, String(username ?? ''), String(password ?? ''));
      setSessionCookie(res, token);
      res.json({ user: await buildUserProfileDTO(db, user), token });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = extractSessionToken(req);
    if (token) await deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthedRequest, res) => {
    res.json({ user: await buildUserProfileDTO(db, req.user!) });
  });

  // Aviary state
  app.get('/api/aviary', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.user!;
    const clock = await getServerClock(db);
    await syncAviaryChickReveals(db, user.id, clock.effectiveNowMs);
    const freshUser = (await db.get<UserRow>('SELECT * FROM users WHERE id = ?', user.id)) ?? user;

    const rows = await db.all<BirdRow>(
      "SELECT * FROM birds WHERE current_owner_id = ? AND status <> 'SANCTUARY' ORDER BY hatch_timestamp DESC",
      user.id,
    );

    const birdLookup = await loadAllBirdsMap(db);
    const ownerNames = await loadOwnerNamesMap(db);
    const discovered = await getUserDiscoveredGenes(db, user.id);
    const mutationConfigs = await loadMutationConfigsMap(db);

    const birds = rows.map((row) =>
      toSanitizedConureDTO(row, birdLookup, ownerNames, discovered, user.id, clock.effectiveNowMs, false, mutationConfigs),
    );
    const activeCages = await getActiveCagesForUser(db, user.id);

    res.json({
      user: await buildUserProfileDTO(db, freshUser),
      birds,
      activeCages,
      serverTime: clock,
    });
  });

  app.patch('/api/birds/:birdId/name', requireAuth, async (req: AuthedRequest, res) => {
    const birdId = String(req.params.birdId);
    const cleanName = String(req.body?.name ?? '').trim().slice(0, 32);
    if (!cleanName) {
      res.status(400).json({ error: 'Bird name cannot be empty.' });
      return;
    }
    const bird = await db.get<{ id: string; current_owner_id: string | null }>(
      'SELECT id, current_owner_id FROM birds WHERE id = ?',
      birdId,
    );
    if (!bird) {
      res.status(404).json({ error: 'Bird not found.' });
      return;
    }
    if (bird.current_owner_id !== req.user!.id) {
      res.status(403).json({ error: 'You do not own this conure.' });
      return;
    }
    await db.run('UPDATE birds SET name = ? WHERE id = ?', cleanName, birdId);
    res.json({ ok: true, name: cleanName });
  });

  app.post('/api/birds/:birdId/sell', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const birdId = String(req.params.birdId);
      const userId = req.user!.id;
      const clock = await getServerClock(db);

      const result = await withTransaction(db, async (tx) => {
        const bird = await tx.get<BirdRow>('SELECT * FROM birds WHERE id = ?', birdId);
        if (!bird) throw new TradingError('Conure not found.', 404);
        if (bird.current_owner_id !== userId) throw new TradingError('You do not own this conure.', 403);

        const status = computeLifecycleStatus(bird, clock.effectiveNowMs);
        if (status === 'BREEDING' || status === 'INCUBATING') {
          throw new TradingError('Cannot sell a bird currently in a breeding cage.', 400);
        }
        if (status === 'MARKET_P2P' || status === 'MARKET_SYSTEM') {
          throw new TradingError('Cancel your market listing before selling to the Sanctuary.', 400);
        }

        const payout = computeSanctuaryValue(bird);
        // Transfer bird to sanctuary while keeping its immutable pedigree row intact!
        await tx.run("UPDATE birds SET current_owner_id = NULL, status = 'SANCTUARY' WHERE id = ?", birdId);
        await tx.run(
          'UPDATE users SET coins = coins + ?, total_coins_earned = total_coins_earned + ? WHERE id = ?',
          payout,
          payout,
          userId,
        );
        const updatedUser = (await tx.get<{ coins: number }>('SELECT coins FROM users WHERE id = ?', userId))!;
        return { payout, newCoinsBalance: updatedUser.coins };
      });

      res.json(result);
    } catch (err) {
      if (err instanceof TradingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Could not complete sanctuary sale.' });
    }
  });

  app.get('/api/birds/:birdId/pedigree', requireAuth, async (req: AuthedRequest, res) => {
    const birdId = String(req.params.birdId);
    const birdLookup = await loadAllBirdsMap(db);
    if (!birdLookup.has(birdId)) {
      res.status(404).json({ error: 'Bird not found.' });
      return;
    }
    const clock = await getServerClock(db);
    await syncAviaryChickReveals(db, req.user!.id, clock.effectiveNowMs);
    const discovered = await getUserDiscoveredGenes(db, req.user!.id);
    const tree = buildPedigreeTree(birdId, birdLookup, discovered, req.user!.id, 3);
    const row = await db.get<{ genetics_reveal_at?: number }>('SELECT genetics_reveal_at FROM birds WHERE id = ?', birdId);
    if (tree && row?.genetics_reveal_at && clock.effectiveNowMs < row.genetics_reveal_at) {
      tree.visualPhenotype = 'WT';
      tree.phenotypeName = 'Downy Chick (Genetics Developing)';
      tree.visibleSplits = [];
    }
    res.json({ tree });
  });

  // System Hourly Marketplace
  app.get('/api/market/system', requireAuth, async (req: AuthedRequest, res) => {
    const clock = await getServerClock(db);
    const { hourBucketUtc, listings } = await getActiveSystemMarket(db, req.user!.id);
    res.json({ serverTime: clock, hourBucketUtc, listings });
  });

  app.post('/api/market/system/:listingId/buy', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const listingId = String(req.params.listingId);
      const outcome = await buySystemMarketListing(db, req.user!.id, listingId);
      res.json(outcome);
    } catch (err) {
      if (err instanceof MarketPurchaseError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Purchase failed.' });
    }
  });

  // P2P Trading Post
  app.get('/api/market/p2p', requireAuth, async (req: AuthedRequest, res) => {
    const listings = await getActiveP2PListings(db, req.user!.id);
    res.json({ listings });
  });

  app.post('/api/market/p2p', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { birdId, askingPrice, sellerNote } = req.body ?? {};
      const listing = await listBirdOnP2P(db, req.user!.id, String(birdId ?? ''), Number(askingPrice), String(sellerNote ?? ''));
      res.status(201).json({ listing });
    } catch (err) {
      if (err instanceof TradingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Could not list bird on P2P Trading Post.' });
    }
  });

  app.post('/api/market/p2p/:listingId/buy', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const listingId = String(req.params.listingId);
      const outcome = await buyP2PListing(db, req.user!.id, listingId);
      res.json(outcome);
    } catch (err) {
      if (err instanceof TradingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'P2P purchase failed.' });
    }
  });

  app.delete('/api/market/p2p/:listingId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      await cancelP2PListing(db, req.user!.id, String(req.params.listingId));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof TradingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Cancel listing failed.' });
    }
  });

  // Breeding Facility
  app.post('/api/breeding/preview', requireAuth, async (req: AuthedRequest, res) => {
    const { birdAId, birdBId } = req.body ?? {};
    const preview = await previewBreedingPair(db, req.user!.id, String(birdAId ?? ''), String(birdBId ?? ''));
    res.json({
      eligible: preview.eligible,
      reason: preview.reason,
      inbreedingCoi: preview.inbreedingCoi,
      coiWarning: preview.coiWarning,
      commonAncestorLabels: preview.commonAncestorLabels,
    });
  });

  app.post('/api/breeding/pair', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { birdAId, birdBId, acknowledgeInbreeding } = req.body ?? {};
      const cage = await startBreedingPair(
        db,
        req.user!.id,
        String(birdAId ?? ''),
        String(birdBId ?? ''),
        Boolean(acknowledgeInbreeding),
      );
      res.status(201).json({ cage });
    } catch (err) {
      if (err instanceof BreedingError) {
        res.status(err.statusCode).json({ error: err.message, preview: err.preview });
        return;
      }
      res.status(500).json({ error: 'Could not assign breeding pair.' });
    }
  });

  app.post('/api/breeding/collect/:cageId', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const outcome = await collectHatchedClutch(db, req.user!.id, String(req.params.cageId));
      res.json(outcome);
    } catch (err) {
      if (err instanceof BreedingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Could not hatch clutch.' });
    }
  });

  app.post('/api/breeding/foster', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { sourceCageId, targetCageId } = req.body ?? {};
      const outcome = await fosterClutch(db, req.user!.id, String(sourceCageId ?? ''), String(targetCageId ?? ''));
      res.json(outcome);
    } catch (err) {
      if (err instanceof BreedingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Could not foster clutch.' });
    }
  });

  // Aviary Exhibition Showroom
  app.get('/api/showroom', requireAuth, async (_req, res) => {
    res.json(await getShowroomOverview(db));
  });

  app.post('/api/showroom/enter', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { birdId, category } = req.body ?? {};
      const outcome = await enterShowroom(db, req.user!.id, String(birdId ?? ''), String(category ?? '') as ShowCategory);
      res.json(outcome);
    } catch (err) {
      if (err instanceof ShowroomError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Showroom entry failed.' });
    }
  });

  // Notifications
  app.post('/api/notifications/read', requireAuth, async (req: AuthedRequest, res) => {
    await db.run('UPDATE notifications SET read_flag = 1 WHERE user_id = ?', req.user!.id);
    res.json({ ok: true });
  });

  // Creator Support, Mutations Catalog & Choice/Special Bird Payments
  app.get('/api/support/config', async (_req, res) => {
    res.json({ supportConfig: await getSupportConfig(db) });
  });

  app.get('/api/mutations', async (_req, res) => {
    res.json({ mutations: await getMutationConfigs(db) });
  });

  app.get('/api/special-bird', async (_req, res) => {
    res.json({ specialBird: await getLiveSpecialBird(db) });
  });

  app.post('/api/payments/choice-bird', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const requestRecord = await submitChoiceBirdPaymentRequest(db, req.user!.id, req.body ?? {});
      res.status(201).json({ ok: true, request: requestRecord });
    } catch (err) {
      if (err instanceof PaymentServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not submit choice bird payment claim.' });
    }
  });

  app.post('/api/payments/special-bird/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const requestRecord = await submitSpecialBirdPaymentRequest(
        db,
        req.user!.id,
        String(req.params.id),
        req.body ?? {},
      );
      res.status(201).json({ ok: true, request: requestRecord });
    } catch (err) {
      if (err instanceof PaymentServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not submit special bird payment claim.' });
    }
  });

  app.post('/api/payments/support', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const requestRecord = await submitSupportRequest(db, req.user!.id, req.body ?? {});
      res.status(201).json({ ok: true, request: requestRecord });
    } catch (err) {
      if (err instanceof PaymentServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not submit support notification.' });
    }
  });

  app.get('/api/payments/my-requests', requireAuth, async (req: AuthedRequest, res) => {
    res.json({ requests: await listPaymentRequests(db, req.user!.id) });
  });

  // Admin Panel Routes (salman / is_admin only)
  app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
    res.json(await getAdminOverview(db));
  });

  app.get('/api/admin/users', requireAdmin, async (_req, res) => {
    res.json({ users: await getAdminUsers(db) });
  });

  app.post('/api/admin/users/:id/adjust-money', requireAdmin, async (req, res) => {
    try {
      const result = await adjustUserCoins(db, String(req.params.id), Number(req.body?.amount));
      res.json({ ok: true, coins: result.coins });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not adjust coins.' });
    }
  });

  app.delete('/api/admin/users/:id', requireAdmin, async (req: AuthedRequest, res) => {
    try {
      await deleteAdminUser(db, String(req.params.id), req.user!.id);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not delete user.' });
    }
  });

  app.get('/api/admin/birds', requireAdmin, async (_req, res) => {
    res.json({ birds: await getAdminBirds(db) });
  });

  app.get('/api/admin/mutations', requireAdmin, async (_req, res) => {
    res.json({ mutations: await getMutationConfigs(db) });
  });

  app.post('/api/admin/mutations', requireAdmin, async (req, res) => {
    try {
      const mutation = await upsertMutationConfig(db, req.body ?? {});
      res.json({ ok: true, mutation });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not save mutation.' });
    }
  });

  app.patch('/api/admin/mutations/:key/image', requireAdmin, async (req, res) => {
    try {
      await updateMutationImage(db, String(req.params.key), String(req.body?.imageUrl ?? ''));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not update mutation image.' });
    }
  });

  app.post('/api/admin/market/add', requireAdmin, async (req, res) => {
    try {
      const added = await injectMarketBird(db, req.body ?? {});
      res.status(201).json({ ok: true, ...added });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not inject market bird.' });
    }
  });

  app.get('/api/admin/special-birds', requireAdmin, async (_req, res) => {
    res.json({ specialBirds: await getAdminSpecialBirds(db) });
  });

  app.post('/api/admin/special-birds', requireAdmin, async (req, res) => {
    try {
      const specialBird = await createSpecialBird(db, req.body ?? {});
      res.status(201).json({ ok: true, specialBird });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not create special bird.' });
    }
  });

  app.patch('/api/admin/special-birds/:id/live', requireAdmin, async (req, res) => {
    try {
      await setSpecialBirdLive(db, String(req.params.id), Boolean(req.body?.isLive));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not update live status.' });
    }
  });

  app.get('/api/admin/payment-requests', requireAdmin, async (_req, res) => {
    res.json({ requests: await listPaymentRequests(db) });
  });

  app.post('/api/admin/payment-requests/:id/approve', requireAdmin, async (req, res) => {
    try {
      const outcome = await approvePaymentRequest(db, String(req.params.id));
      res.json({ ok: true, ...outcome });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not approve payment request.' });
    }
  });

  app.post('/api/admin/payment-requests/:id/reject', requireAdmin, async (req, res) => {
    try {
      await rejectPaymentRequest(db, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not reject payment request.' });
    }
  });

  app.patch('/api/admin/support-config', requireAdmin, async (req, res) => {
    const supportConfig = await updateSupportConfig(db, req.body ?? {});
    res.json({ ok: true, supportConfig });
  });

  app.get('/api/admin/chat/all', requireAdmin, async (_req, res) => {
    res.json({ threads: await getAdminChatThreads(db) });
  });

  app.get('/api/admin/chat/thread/:u1/:u2', requireAdmin, async (req, res) => {
    res.json({ messages: await getAdminChatThreadMessages(db, String(req.params.u1), String(req.params.u2)) });
  });

  app.get('/api/admin/audit-feed', requireAdmin, async (_req, res) => {
    res.json({ activity: await getAdminAuditFeed(db) });
  });

  // Gated Admin Test Lab Time Tools (Admin Only, disabled in production unless GCCT_ENABLE_DEV_TOOLS=true)
  app.post('/api/dev/advance-time', requireAdmin, async (req, res) => {
    if (!isDevTimeToolsEnabled()) {
      res.status(403).json({ error: 'Developer time tools are disabled in production.' });
      return;
    }
    const hours = Number(req.body?.hours ?? 0);
    const minutes = Number(req.body?.minutes ?? 0);
    const deltaMs = (Number.isFinite(hours) ? hours * 3_600_000 : 0) + (Number.isFinite(minutes) ? minutes * 60_000 : 0);
    if (deltaMs <= 0 || deltaMs > 7 * 24 * 3_600_000) {
      res.status(400).json({ error: 'Provide a positive duration up to 7 days.' });
      return;
    }
    await advanceDevTimeOffsetMs(db, deltaMs);
    const clock = await getServerClock(db);
    await ensureHourlyMarketBatch(db, clock.effectiveNowMs);
    res.json({ serverTime: clock });
  });

  app.post('/api/dev/refresh-market', requireAdmin, async (_req, res) => {
    if (!isDevTimeToolsEnabled()) {
      res.status(403).json({ error: 'Developer tools are disabled in production.' });
      return;
    }
    const clock = await getServerClock(db);
    await ensureHourlyMarketBatch(db, clock.effectiveNowMs, true);
    res.json({ serverTime: clock });
  });

  // Serve compiled production frontend if present
  const distClient = path.resolve(process.cwd(), 'dist-client');
  if (fs.existsSync(distClient)) {
    app.use(express.static(distClient));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distClient, 'index.html'));
    });
  }

  return app;
}
