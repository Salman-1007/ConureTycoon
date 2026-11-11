import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { buildPedigreeTree } from '../shared/genetics/pedigree.js';
import type { ShowCategory } from '../shared/genetics/showroom.js';
import {
  SESSION_COOKIE_NAME,
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
  PaymentServiceError,
  getLiveSpecialBird,
  getSupportConfig,
  listPaymentRequests,
  submitChoiceBirdPaymentRequest,
  submitSpecialBirdPaymentRequest,
  submitSupportRequest,
  updateSupportConfig,
} from './paymentService.js';
import {
  BreedingError,
  collectHatchedClutch,
  getActiveCagesForUser,
  previewBreedingPair,
  startBreedingPair,
} from './breedingService.js';
import {
  advanceDevTimeOffsetMs,
  getServerClock,
  isDevTimeToolsEnabled,
} from './clock.js';
import { withTransaction } from './db.js';
import {
  MarketPurchaseError,
  buySystemMarketListing,
  ensureHourlyMarketBatch,
  getActiveSystemMarket,
} from './marketWorker.js';
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
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function createApp(db: DatabaseSync) {
  seedWorldData(db);
  ensureMutationConfigsSynced(db);
  ensureHourlyMarketBatch(db);

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = extractSessionToken(req);
    const user = getUserBySessionToken(db, token);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    req.user = user;
    req.sessionToken = token;
    next();
  };

  const requireAdmin = (req: AuthedRequest, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
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
    res.json({ ok: true, devToolsEnabled: isDevTimeToolsEnabled() });
  });

  app.get('/api/time', (_req, res) => {
    res.json(getServerClock(db));
  });

  // Auth routes
  app.post('/api/auth/register', (req, res) => {
    try {
      const { username, password, displayName, aviaryName, startingCoins } = req.body ?? {};
      const { user, token } = registerUser(db, {
        username: String(username ?? ''),
        password: String(password ?? ''),
        displayName: String(displayName ?? ''),
        aviaryName: String(aviaryName ?? ''),
        startingCoins: startingCoins !== undefined ? Number(startingCoins) : undefined,
      });
      setSessionCookie(res, token);
      res.status(201).json({ user: buildUserProfileDTO(db, user), token });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      const { user, token } = authenticateUser(db, String(username ?? ''), String(password ?? ''));
      setSessionCookie(res, token);
      res.json({ user: buildUserProfileDTO(db, user), token });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = extractSessionToken(req);
    if (token) deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: buildUserProfileDTO(db, req.user!) });
  });

  // Aviary state
  app.get('/api/aviary', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const clock = getServerClock(db);
    const rows = db
      .prepare("SELECT * FROM birds WHERE current_owner_id = ? AND status <> 'SANCTUARY' ORDER BY hatch_timestamp DESC")
      .all(user.id) as unknown as BirdRow[];

    const birdLookup = loadAllBirdsMap(db);
    const ownerNames = loadOwnerNamesMap(db);
    const discovered = getUserDiscoveredGenes(db, user.id);
    const mutationConfigs = loadMutationConfigsMap(db);

    const birds = rows.map((row) =>
      toSanitizedConureDTO(row, birdLookup, ownerNames, discovered, user.id, clock.effectiveNowMs, false, mutationConfigs),
    );
    const activeCages = getActiveCagesForUser(db, user.id);

    res.json({
      user: buildUserProfileDTO(db, user),
      birds,
      activeCages,
      serverTime: clock,
    });
  });

  app.patch('/api/birds/:birdId/name', requireAuth, (req: AuthedRequest, res) => {
    const birdId = String(req.params.birdId);
    const cleanName = String(req.body?.name ?? '').trim().slice(0, 32);
    if (!cleanName) {
      res.status(400).json({ error: 'Bird name cannot be empty.' });
      return;
    }
    const bird = db.prepare('SELECT id, current_owner_id FROM birds WHERE id = ?').get(birdId) as
      | { id: string; current_owner_id: string | null }
      | undefined;
    if (!bird) {
      res.status(404).json({ error: 'Bird not found.' });
      return;
    }
    if (bird.current_owner_id !== req.user!.id) {
      res.status(403).json({ error: 'You do not own this conure.' });
      return;
    }
    db.prepare('UPDATE birds SET name = ? WHERE id = ?').run(cleanName, birdId);
    res.json({ ok: true, name: cleanName });
  });

  app.post('/api/birds/:birdId/sell', requireAuth, (req: AuthedRequest, res) => {
    try {
      const birdId = String(req.params.birdId);
      const userId = req.user!.id;
      const clock = getServerClock(db);

      const result = withTransaction(db, () => {
        const bird = db.prepare('SELECT * FROM birds WHERE id = ?').get(birdId) as BirdRow | undefined;
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
        db.prepare("UPDATE birds SET current_owner_id = NULL, status = 'SANCTUARY' WHERE id = ?").run(birdId);
        db.prepare('UPDATE users SET coins = coins + ?, total_coins_earned = total_coins_earned + ? WHERE id = ?').run(
          payout,
          payout,
          userId,
        );
        const updatedUser = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId) as { coins: number };
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

  app.get('/api/birds/:birdId/pedigree', requireAuth, (req: AuthedRequest, res) => {
    const birdId = String(req.params.birdId);
    const birdLookup = loadAllBirdsMap(db);
    if (!birdLookup.has(birdId)) {
      res.status(404).json({ error: 'Bird not found.' });
      return;
    }
    const discovered = getUserDiscoveredGenes(db, req.user!.id);
    const tree = buildPedigreeTree(birdId, birdLookup, discovered, req.user!.id, 3);
    res.json({ tree });
  });

  // System Hourly Marketplace
  app.get('/api/market/system', requireAuth, (req: AuthedRequest, res) => {
    const clock = getServerClock(db);
    const { hourBucketUtc, listings } = getActiveSystemMarket(db, req.user!.id);
    res.json({ serverTime: clock, hourBucketUtc, listings });
  });

  app.post('/api/market/system/:listingId/buy', requireAuth, (req: AuthedRequest, res) => {
    try {
      const listingId = String(req.params.listingId);
      const outcome = buySystemMarketListing(db, req.user!.id, listingId);
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
  app.get('/api/market/p2p', requireAuth, (req: AuthedRequest, res) => {
    const listings = getActiveP2PListings(db, req.user!.id);
    res.json({ listings });
  });

  app.post('/api/market/p2p', requireAuth, (req: AuthedRequest, res) => {
    try {
      const { birdId, askingPrice, sellerNote } = req.body ?? {};
      const listing = listBirdOnP2P(db, req.user!.id, String(birdId ?? ''), Number(askingPrice), String(sellerNote ?? ''));
      res.status(201).json({ listing });
    } catch (err) {
      if (err instanceof TradingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Could not list bird on P2P Trading Post.' });
    }
  });

  app.post('/api/market/p2p/:listingId/buy', requireAuth, (req: AuthedRequest, res) => {
    try {
      const listingId = String(req.params.listingId);
      const outcome = buyP2PListing(db, req.user!.id, listingId);
      res.json(outcome);
    } catch (err) {
      if (err instanceof TradingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'P2P purchase failed.' });
    }
  });

  app.delete('/api/market/p2p/:listingId', requireAuth, (req: AuthedRequest, res) => {
    try {
      cancelP2PListing(db, req.user!.id, String(req.params.listingId));
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
  app.post('/api/breeding/preview', requireAuth, (req: AuthedRequest, res) => {
    const { birdAId, birdBId } = req.body ?? {};
    const preview = previewBreedingPair(db, req.user!.id, String(birdAId ?? ''), String(birdBId ?? ''));
    res.json({
      eligible: preview.eligible,
      reason: preview.reason,
      inbreedingCoi: preview.inbreedingCoi,
      coiWarning: preview.coiWarning,
      commonAncestorLabels: preview.commonAncestorLabels,
    });
  });

  app.post('/api/breeding/pair', requireAuth, (req: AuthedRequest, res) => {
    try {
      const { birdAId, birdBId, acknowledgeInbreeding } = req.body ?? {};
      const cage = startBreedingPair(
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

  app.post('/api/breeding/collect/:cageId', requireAuth, (req: AuthedRequest, res) => {
    try {
      const outcome = collectHatchedClutch(db, req.user!.id, String(req.params.cageId));
      res.json(outcome);
    } catch (err) {
      if (err instanceof BreedingError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Could not hatch clutch.' });
    }
  });

  // Aviary Exhibition Showroom
  app.get('/api/showroom', requireAuth, (_req, res) => {
    res.json(getShowroomOverview(db));
  });

  app.post('/api/showroom/enter', requireAuth, (req: AuthedRequest, res) => {
    try {
      const { birdId, category } = req.body ?? {};
      const outcome = enterShowroom(db, req.user!.id, String(birdId ?? ''), String(category ?? '') as ShowCategory);
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
  app.post('/api/notifications/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE notifications SET read_flag = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  // Creator Support, Mutations Catalog & Choice/Special Bird Payments
  app.get('/api/support/config', (_req, res) => {
    res.json({ supportConfig: getSupportConfig(db) });
  });

  app.get('/api/mutations', (_req, res) => {
    res.json({ mutations: getMutationConfigs(db) });
  });

  app.get('/api/special-bird', (_req, res) => {
    res.json({ specialBird: getLiveSpecialBird(db) });
  });

  app.post('/api/payments/choice-bird', requireAuth, (req: AuthedRequest, res) => {
    try {
      const requestRecord = submitChoiceBirdPaymentRequest(db, req.user!.id, req.body ?? {});
      res.status(201).json({ ok: true, request: requestRecord });
    } catch (err) {
      if (err instanceof PaymentServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not submit choice bird payment claim.' });
    }
  });

  app.post('/api/payments/special-bird/:id', requireAuth, (req: AuthedRequest, res) => {
    try {
      const requestRecord = submitSpecialBirdPaymentRequest(
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

  app.post('/api/payments/support', requireAuth, (req: AuthedRequest, res) => {
    try {
      const requestRecord = submitSupportRequest(db, req.user!.id, req.body ?? {});
      res.status(201).json({ ok: true, request: requestRecord });
    } catch (err) {
      if (err instanceof PaymentServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not submit support notification.' });
    }
  });

  app.get('/api/payments/my-requests', requireAuth, (req: AuthedRequest, res) => {
    res.json({ requests: listPaymentRequests(db, req.user!.id) });
  });

  // Admin Panel Routes (salman / is_admin only)
  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    res.json(getAdminOverview(db));
  });

  app.get('/api/admin/users', requireAdmin, (_req, res) => {
    res.json({ users: getAdminUsers(db) });
  });

  app.post('/api/admin/users/:id/adjust-money', requireAdmin, (req, res) => {
    try {
      const result = adjustUserCoins(db, String(req.params.id), Number(req.body?.amount));
      res.json({ ok: true, coins: result.coins });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not adjust coins.' });
    }
  });

  app.delete('/api/admin/users/:id', requireAdmin, (req: AuthedRequest, res) => {
    try {
      deleteAdminUser(db, String(req.params.id), req.user!.id);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not delete user.' });
    }
  });

  app.get('/api/admin/birds', requireAdmin, (_req, res) => {
    res.json({ birds: getAdminBirds(db) });
  });

  app.get('/api/admin/mutations', requireAdmin, (_req, res) => {
    res.json({ mutations: getMutationConfigs(db) });
  });

  app.post('/api/admin/mutations', requireAdmin, (req, res) => {
    try {
      const mutation = upsertMutationConfig(db, req.body ?? {});
      res.json({ ok: true, mutation });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not save mutation.' });
    }
  });

  app.patch('/api/admin/mutations/:key/image', requireAdmin, (req, res) => {
    try {
      updateMutationImage(db, String(req.params.key), String(req.body?.imageUrl ?? ''));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not update mutation image.' });
    }
  });

  app.post('/api/admin/market/add', requireAdmin, (req, res) => {
    try {
      const added = injectMarketBird(db, req.body ?? {});
      res.status(201).json({ ok: true, ...added });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not inject market bird.' });
    }
  });

  app.get('/api/admin/special-birds', requireAdmin, (_req, res) => {
    res.json({ specialBirds: getAdminSpecialBirds(db) });
  });

  app.post('/api/admin/special-birds', requireAdmin, (req, res) => {
    try {
      const specialBird = createSpecialBird(db, req.body ?? {});
      res.status(201).json({ ok: true, specialBird });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not create special bird.' });
    }
  });

  app.patch('/api/admin/special-birds/:id/live', requireAdmin, (req, res) => {
    try {
      setSpecialBirdLive(db, String(req.params.id), Boolean(req.body?.isLive));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not update live status.' });
    }
  });

  app.get('/api/admin/payment-requests', requireAdmin, (_req, res) => {
    res.json({ requests: listPaymentRequests(db) });
  });

  app.post('/api/admin/payment-requests/:id/approve', requireAdmin, (req, res) => {
    try {
      const outcome = approvePaymentRequest(db, String(req.params.id));
      res.json({ ok: true, ...outcome });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not approve payment request.' });
    }
  });

  app.post('/api/admin/payment-requests/:id/reject', requireAdmin, (req, res) => {
    try {
      rejectPaymentRequest(db, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof AdminServiceError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: 'Could not reject payment request.' });
    }
  });

  app.patch('/api/admin/support-config', requireAdmin, (req, res) => {
    const supportConfig = updateSupportConfig(db, req.body ?? {});
    res.json({ ok: true, supportConfig });
  });

  app.get('/api/admin/chat/all', requireAdmin, (_req, res) => {
    res.json({ threads: getAdminChatThreads(db) });
  });

  app.get('/api/admin/chat/thread/:u1/:u2', requireAdmin, (req, res) => {
    res.json({ messages: getAdminChatThreadMessages(db, String(req.params.u1), String(req.params.u2)) });
  });

  app.get('/api/admin/audit-feed', requireAdmin, (_req, res) => {
    res.json({ activity: getAdminAuditFeed(db) });
  });

  // Gated Dev / Testing Time Tools (strictly disabled in production unless GCCT_ENABLE_DEV_TOOLS=true)
  app.post('/api/dev/advance-time', requireAuth, (req, res) => {
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
    advanceDevTimeOffsetMs(db, deltaMs);
    const clock = getServerClock(db);
    ensureHourlyMarketBatch(db, clock.effectiveNowMs);
    res.json({ serverTime: clock });
  });

  app.post('/api/dev/refresh-market', requireAuth, (_req, res) => {
    if (!isDevTimeToolsEnabled()) {
      res.status(403).json({ error: 'Developer tools are disabled in production.' });
      return;
    }
    const clock = getServerClock(db);
    ensureHourlyMarketBatch(db, clock.effectiveNowMs, true);
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
