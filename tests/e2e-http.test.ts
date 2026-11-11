import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { SESSION_TTL_MS, createSession } from '../server/auth.js';
import { type AppDatabase, createDatabase } from '../server/db.js';

describe('Stage 10 HTTP End-to-End & Concurrent Stress Tests', () => {
  let db: AppDatabase;
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    db = await createDatabase(':memory:');
    const app = createApp(db);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  });

  it('handles full HTTP registration, concurrent market buys, breeding timers, pedigree, P2P, and showroom', async () => {
    const postJson = async (path: string, body: unknown, token?: string) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return { status: res.status, json };
    };

    const getJson = async (path: string, token?: string) => {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      return { status: res.status, json };
    };

    // 1. Register Player A & Player B
    const regA = await postJson('/api/auth/register', {
      username: 'http_alice',
      password: 'password123',
      displayName: 'Alice',
      aviaryName: 'Alice Canopy',
      startingCoins: 20000,
    });
    expect(regA.status).toBe(201);
    const tokenA = regA.json.token as string;
    expect(regA.json.user.discoveredGenes.map((g: any) => g.geneKey)).toEqual(['WT']);

    const regB = await postJson('/api/auth/register', {
      username: 'http_bob',
      password: 'password123',
      displayName: 'Bob',
      aviaryName: 'Bob Canopy',
      startingCoins: 20000,
    });
    expect(regB.status).toBe(201);
    const tokenB = regB.json.token as string;

    // 2. Concurrent Race-Condition Market Buy Test (5 simultaneous HTTP buys on 1 listing)
    const mkt = await getJson('/api/market/system', tokenA);
    expect(mkt.status).toBe(200);
    expect(mkt.json.listings).toHaveLength(10);
    const targetListing = mkt.json.listings.find((l: any) => l.price <= 15000);
    expect(targetListing).toBeTruthy();

    const raceResults = await Promise.all([
      postJson(`/api/market/system/${targetListing.listingId}/buy`, {}, tokenA),
      postJson(`/api/market/system/${targetListing.listingId}/buy`, {}, tokenB),
      postJson(`/api/market/system/${targetListing.listingId}/buy`, {}, tokenA),
      postJson(`/api/market/system/${targetListing.listingId}/buy`, {}, tokenB),
      postJson(`/api/market/system/${targetListing.listingId}/buy`, {}, tokenA),
    ]);
    const successes = raceResults.filter((r) => r.status === 200);
    const conflicts = raceResults.filter((r) => r.status === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(4);

    // 3. Breeding Lifecycle & Hatch via HTTP
    const aviaryA = await getJson('/api/aviary', tokenA);
    const maleA = aviaryA.json.birds.find((b: any) => b.sex === 'MALE' && b.lifecycleStatus === 'READY');
    const femaleA = aviaryA.json.birds.find((b: any) => b.sex === 'FEMALE' && b.lifecycleStatus === 'READY');

    const pairRes = await postJson(
      '/api/breeding/pair',
      { birdAId: maleA.id, birdBId: femaleA.id, acknowledgeInbreeding: true },
      tokenA,
    );
    expect(pairRes.status).toBe(201);
    const cageId = pairRes.json.cage.id as string;

    // Trying to collect immediately must return 400
    const premature = await postJson(`/api/breeding/collect/${cageId}`, {}, tokenA);
    expect(premature.status).toBe(400);

    // Non-admin user must receive 403 on Test Lab dev time controls
    const nonAdminAdv = await postJson('/api/dev/advance-time', { hours: 12 }, tokenA);
    expect(nonAdminAdv.status).toBe(403);
    expect(regA.json.user.devToolsEnabled).toBe(false);

    // Admin (salman) advances dev time +12h (1-6h lay window + 6h incubation) and hatches
    const regAdmin = await postJson('/api/auth/register', {
      username: 'salman',
      password: 'password123',
      displayName: 'Salman Admin',
      aviaryName: 'Salman Sanctum',
    });
    expect(regAdmin.status).toBe(201);
    expect(regAdmin.json.user.isAdmin).toBe(true);
    expect(regAdmin.json.user.devToolsEnabled).toBe(true);
    const adminToken = regAdmin.json.token as string;

    const adv = await postJson('/api/dev/advance-time', { hours: 12 }, adminToken);
    expect(adv.status).toBe(200);

    const hatch = await postJson(`/api/breeding/collect/${cageId}`, {}, tokenA);
    expect(hatch.status).toBe(200);
    expect(hatch.json.chicks.length).toBeGreaterThanOrEqual(3);
    expect(hatch.json.chicks.length).toBeLessThanOrEqual(5);

    // Inspect 3-Gen Pedigree of a newly hatched chick (remains downy until +3h)
    const chickId = hatch.json.chicks[0].id as string;
    const ped = await getJson(`/api/birds/${chickId}/pedigree`, tokenA);
    expect(ped.status).toBe(200);
    expect(ped.json.tree.father.id).toBe(maleA.id);
    expect(ped.json.tree.mother.id).toBe(femaleA.id);

    // 4. P2P Trading Post List + Buy between Alice and Bob
    // List third starter bird Pebble directly (and parents have zero cooldown!)
    const pebble = aviaryA.json.birds.find((b: any) => b.name === 'Pebble');
    const p2pCreate = await postJson(
      '/api/market/p2p',
      { birdId: pebble.id, askingPrice: 4500, sellerNote: 'Foundation male' },
      tokenA,
    );
    expect(p2pCreate.status).toBe(201);
    const p2pId = p2pCreate.json.listing.listingId as string;

    const p2pBuy = await postJson(`/api/market/p2p/${p2pId}/buy`, {}, tokenB);
    expect(p2pBuy.status).toBe(200);

    // 5. Showroom Deterministic Entry
    const aviaryB = await getJson('/api/aviary', tokenB);
    const bBird = aviaryB.json.birds[0];
    const showRes = await postJson('/api/showroom/enter', { birdId: bBird.id, category: 'NOVICE' }, tokenB);
    expect(showRes.status).toBe(200);
    expect(showRes.json.entry.breakdown.totalScore).toBeGreaterThan(20);
  });

  it('locks down dev time controls automatically when NODE_ENV=production', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.GCCT_ENABLE_DEV_TOOLS;
    try {
      const reg = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'prod_guard',
          password: 'password123',
          displayName: 'Prod',
          aviaryName: 'Prod Aviary',
        }),
      });
      const regJson = await reg.json();
      const devRes = await fetch(`${baseUrl}/api/dev/advance-time`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${regJson.token}`,
        },
        body: JSON.stringify({ hours: 6 }),
      });
      expect(devRes.status).toBe(403);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('sets session cookies and database sessions to expire after 10 days', async () => {
    const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
    expect(SESSION_TTL_MS).toBe(tenDaysMs);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'http_alice', password: 'password123' }),
    });
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Max-Age=864000');

    const loginJson = await loginRes.json();
    const row = await db.get<{ user_id: string; created_at: number; expires_at: number }>(
      'SELECT user_id, created_at, expires_at FROM sessions WHERE token = ?',
      loginJson.token,
    );
    expect(row).toBeTruthy();
    expect(row!.expires_at - row!.created_at).toBe(tenDaysMs);

    const nearExpiryToken = await createSession(db, row!.user_id, Date.now() - (tenDaysMs - 60_000));
    const nearExpiryMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${nearExpiryToken}` },
    });
    expect(nearExpiryMe.status).toBe(200);

    const expiredToken = await createSession(db, row!.user_id, Date.now() - (tenDaysMs + 1_000));
    const expiredMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(expiredMe.status).toBe(401);
  });
});
