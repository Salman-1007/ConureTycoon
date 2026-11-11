import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { type AppDatabase, createDatabase } from '../server/db.js';

describe('Admin Panel (salman), Support Config & Choice Bird Payments', () => {
  let db: AppDatabase;
  let server: http.Server;
  let baseUrl = '';

  const apiCall = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

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

  it('grants admin strictly to username=salman, enforces 403 for others, and supports full choice bird + special bird approval workflows', async () => {
    // 1. Register admin user 'salman' and regular user 'buyer_alex'
    const regSalman = await apiCall('POST', '/api/auth/register', {
      username: 'salman',
      password: 'salmanpass123',
      displayName: 'Salman Adil',
      aviaryName: 'Salman Crown Aviary',
      startingCoins: 15000,
    });
    expect(regSalman.status).toBe(201);
    expect(regSalman.json.user.isAdmin).toBe(true);
    const adminToken = regSalman.json.token as string;

    const regAlex = await apiCall('POST', '/api/auth/register', {
      username: 'buyer_alex',
      password: 'alexpass123',
      displayName: 'Alex Morgan',
      aviaryName: 'London Canopy',
      startingCoins: 10000,
    });
    expect(regAlex.status).toBe(201);
    expect(regAlex.json.user.isAdmin).toBe(false);
    const alexId = regAlex.json.user.id as string;
    const alexToken = regAlex.json.token as string;

    // 2. Non-admin gets 403 on admin routes
    const denied = await apiCall('GET', '/api/admin/overview', undefined, alexToken);
    expect(denied.status).toBe(403);

    // 3. Support config includes NayaPay 03324261998 and foreign +92 number
    const supRes = await apiCall('GET', '/api/support/config');
    expect(supRes.status).toBe(200);
    expect(supRes.json.supportConfig.nayapayNumber).toBe('03324261998');
    expect(supRes.json.supportConfig.internationalNumber).toContain('3324261998'.slice(-7));

    // 4. Choice bird submission requires senderName
    const badClaim = await apiCall(
      'POST',
      '/api/payments/choice-bird',
      {
        mutationKey: 'MOONCHK',
        gender: 'FEMALE',
        amount: 500,
        currency: 'PKR',
        paymentMethod: 'NayaPay',
        senderName: '',
      },
      alexToken,
    );
    expect(badClaim.status).toBe(400);

    // 5. Submit valid Choice Bird coffee gift claim
    const choiceRes = await apiCall(
      'POST',
      '/api/payments/choice-bird',
      {
        mutationKey: 'MOONCHK',
        gender: 'FEMALE',
        desiredBirdName: 'Luna Queen',
        amount: 10,
        currency: 'USD',
        paymentMethod: 'Wise (+92 332 4261998)',
        senderName: 'Alex Morgan UK',
        senderPhone: '+447700900123',
        referenceNote: 'WISE-88412',
      },
      alexToken,
    );
    expect(choiceRes.status).toBe(201);
    const choiceReqId = choiceRes.json.request.id as string;
    expect(choiceRes.json.request.status).toBe('pending');
    expect(choiceRes.json.request.requestedMutation).toBe('MOONCHK');
    expect(choiceRes.json.request.requestedGender).toBe('FEMALE');

    // Check admin sees pending count on overview & profile
    const salmanAviary = await apiCall('GET', '/api/aviary', undefined, adminToken);
    expect(salmanAviary.json.user.pendingPaymentsCount).toBe(1);

    const overviewBefore = await apiCall('GET', '/api/admin/overview', undefined, adminToken);
    expect(overviewBefore.status).toBe(200);
    expect(overviewBefore.json.pendingPayments).toBe(1);
    expect(overviewBefore.json.users).toBe(2);

    // 6. Salman approves the Choice Bird payment -> delivers Mooncheek Female 'Luna Queen' to Alex's aviary
    const approveChoice = await apiCall(
      'POST',
      `/api/admin/payment-requests/${choiceReqId}/approve`,
      {},
      adminToken,
    );
    expect(approveChoice.status).toBe(200);
    expect(approveChoice.json.deliveredBirdName).toBe('Luna Queen');
    expect(approveChoice.json.deliveredBirdLegBand).toBeTruthy();

    const alexAviaryAfter = await apiCall('GET', '/api/aviary', undefined, alexToken);
    const delivered = alexAviaryAfter.json.birds.find(
      (b: any) => b.legBand === approveChoice.json.deliveredBirdLegBand,
    );
    expect(delivered).toBeDefined();
    expect(delivered.name).toBe('Luna Queen');
    expect(delivered.sex).toBe('FEMALE');
    expect(delivered.visualPhenotype).toBe('MOONCHK');
    expect(delivered.lifecycleStatus).toBe('READY');

    // 7. Reject workflow for support coffee claim
    const tipRes = await apiCall(
      'POST',
      '/api/payments/support',
      {
        senderName: 'Mistake Transfer',
        amount: 500,
        currency: 'PKR',
        paymentMethod: 'NayaPay',
      },
      alexToken,
    );
    expect(tipRes.status).toBe(201);
    const rejectRes = await apiCall(
      'POST',
      `/api/admin/payment-requests/${tipRes.json.request.id}/reject`,
      {},
      adminToken,
    );
    expect(rejectRes.status).toBe(200);

    // 8. Admin Adjust Coins
    const adjRes = await apiCall(
      'POST',
      `/api/admin/users/${alexId}/adjust-money`,
      { amount: 2500 },
      adminToken,
    );
    expect(adjRes.status).toBe(200);
    expect(adjRes.json.coins).toBe(12500);

    // 9. Admin Inject Market Bird -> visible in Wild Exchange
    const injectRes = await apiCall(
      'POST',
      '/api/admin/market/add',
      {
        name: 'Salman Special Drop',
        mutationKey: 'SUNCHK',
        gender: 'MALE',
        symmetry: 97,
        price: 3333,
        splits: ['TQ'],
      },
      adminToken,
    );
    expect(injectRes.status).toBe(201);
    const marketRes = await apiCall('GET', '/api/market/system', undefined, alexToken);
    const injectedListing = marketRes.json.listings.find(
      (l: any) => l.bird.legBand === injectRes.json.legBand,
    );
    expect(injectedListing).toBeDefined();
    expect(injectedListing.price).toBe(3333);
    expect(injectedListing.bird.visualPhenotype).toBe('SUNCHK');

    // 10. Admin Create Special Bird + Make Live -> Buyer claims -> Admin approves -> Stock decrements
    const createSpecial = await apiCall(
      'POST',
      '/api/admin/special-birds',
      {
        name: 'Emerald Emperor',
        mutationKey: 'MINT',
        gender: 'MALE',
        symmetry: 98,
        pricePkr: 2000,
        stock: 2,
        description: 'Top-tier breeder stock',
      },
      adminToken,
    );
    expect(createSpecial.status).toBe(201);
    const sbId = createSpecial.json.specialBird.id as string;

    const liveToggle = await apiCall(
      'PATCH',
      `/api/admin/special-birds/${sbId}/live`,
      { isLive: true },
      adminToken,
    );
    expect(liveToggle.status).toBe(200);

    const publicSpecial = await apiCall('GET', '/api/special-bird');
    expect(publicSpecial.json.specialBird.id).toBe(sbId);
    expect(publicSpecial.json.specialBird.stock).toBe(2);

    const claimSpecial = await apiCall(
      'POST',
      `/api/payments/special-bird/${sbId}`,
      { senderName: 'Alex Special Buyer' },
      alexToken,
    );
    expect(claimSpecial.status).toBe(201);

    const approveSpecial = await apiCall(
      'POST',
      `/api/admin/payment-requests/${claimSpecial.json.request.id}/approve`,
      {},
      adminToken,
    );
    expect(approveSpecial.status).toBe(200);
    expect(approveSpecial.json.deliveredBirdName).toBe('Emerald Emperor');

    const publicSpecialAfter = await apiCall('GET', '/api/special-bird');
    expect(publicSpecialAfter.json.specialBird.stock).toBe(1);

    // 11. Admin mutation image update + support config update + audit/chat + delete disposable user
    const imgUp = await apiCall(
      'PATCH',
      '/api/admin/mutations/MINT/image',
      { imageUrl: '/assets/conures/mint.png' },
      adminToken,
    );
    expect(imgUp.status).toBe(200);

    const supPatch = await apiCall(
      'PATCH',
      '/api/admin/support-config',
      { wiseTag: 'wise.com/pay/me/salman' },
      adminToken,
    );
    expect(supPatch.status).toBe(200);
    expect(supPatch.json.supportConfig.wiseTag).toBe('wise.com/pay/me/salman');

    const [threadsRes, auditRes, birdsRes, usersRes] = await Promise.all([
      apiCall('GET', '/api/admin/chat/all', undefined, adminToken),
      apiCall('GET', '/api/admin/audit-feed', undefined, adminToken),
      apiCall('GET', '/api/admin/birds', undefined, adminToken),
      apiCall('GET', '/api/admin/users', undefined, adminToken),
    ]);
    expect(threadsRes.status).toBe(200);
    expect(auditRes.status).toBe(200);
    expect(birdsRes.status).toBe(200);
    expect(usersRes.status).toBe(200);

    const delAlex = await apiCall('DELETE', `/api/admin/users/${alexId}`, undefined, adminToken);
    expect(delAlex.status).toBe(200);
  });
});
