'use strict';

// ─── Mocks (must be before any requires) ──────────────────────────────────────

const mockTursoExecute = jest.fn();
const mockTursoDb = { execute: mockTursoExecute, batch: jest.fn() };

jest.mock('@libsql/client', () => ({
  createClient: jest.fn(() => mockTursoDb),
}));

// Stripe mock — default: payment is paid
const mockStripeRetrieve = jest.fn().mockResolvedValue({ payment_status: 'paid' });
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { retrieve: mockStripeRetrieve, create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test' }) } },
  }))
);

// ─── Setup ────────────────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const sessionManager = require('../../src/db/session-manager');
const { handleWebSocket } = require('../../src/terminal/ws-handler');

const SECRET = 'migration-test-secret';
const TEST_USER_ID = 'user-abc-123';
const TEST_EMAIL = 'player@example.com';

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.TURSO_URL = 'libsql://test.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'test-token';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  sessionManager.createTemplate();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.TURSO_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.STRIPE_SECRET_KEY;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTursoExecute.mockResolvedValue({ rows: [] }); // default: no stored progress
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAuthCookie(userId = TEST_USER_ID, email = TEST_EMAIL) {
  const token = jwt.sign({ userId, email }, SECRET, { expiresIn: '1d' });
  return `hacklab_token=${token}`;
}

/** Minimal mock WebSocket that captures sent messages and exposes emit() */
class MockWS {
  constructor() {
    this._handlers = {};
    this.sent = [];
  }
  on(event, fn) { this._handlers[event] = fn; }
  send(data) { this.sent.push(JSON.parse(data)); }
  emit(event, data) {
    if (this._handlers[event]) this._handlers[event](data);
  }
  lastSent() { return this.sent[this.sent.length - 1]; }
  initMsg() { return this.sent.find(m => m.type === 'init'); }
}

/** Simulate a WebSocket connect + init handshake. Returns the init response. */
async function wsInit({ userId = null, savedProgress = {}, sessionId = null } = {}) {
  const ws = new MockWS();
  handleWebSocket(ws, userId);
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'init', sessionId, savedProgress })));
  await new Promise(r => setTimeout(r, 30));
  return ws.initMsg();
}

/** Simulate submitting a flag over WebSocket. Returns { ws, sent[] }. */
async function wsSubmitFlag(userId, stageIndex, flag) {
  const sessionId = sessionManager.createSession();
  const { getGameState } = require('../../src/routes/game');
  const state = getGameState(sessionId);
  state.currentStage = stageIndex;
  if (!state.pendingFlags) state.pendingFlags = {};
  state.pendingFlags[stageIndex] = flag;

  const ws = new MockWS();
  handleWebSocket(ws, userId);
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'init', sessionId, savedProgress: {} })));
  await new Promise(r => setTimeout(r, 20));

  ws.sent = [];
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'command', command: `submit ${flag}` })));
  await new Promise(r => setTimeout(r, 20));

  sessionManager.destroySession(sessionId);
  return ws.sent;
}

function buildCheckoutApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const gameRoutes = require('../../src/routes/game');
  app.use('/api', gameRoutes);
  return app;
}

// ─── 1. Anonymous user — no localStorage ──────────────────────────────────────
describe('Anonymous user — no localStorage', () => {
  it('starts at stage 0 with no completed stages', async () => {
    const msg = await wsInit({ userId: null, savedProgress: {} });
    expect(msg.currentStage).toBe(0);
    expect(msg.completedStages).toEqual([]);
    expect(msg.advancedUnlocked).toBe(false);
  });

  it('does not call Turso (no userId)', async () => {
    await wsInit({ userId: null, savedProgress: {} });
    expect(mockTursoExecute).not.toHaveBeenCalled();
  });

  it('does not re-verify Stripe when no STRIPE_SECRET_KEY', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await wsInit({ userId: null, savedProgress: { stripeSessionId: 'cs_test' } });
    expect(mockStripeRetrieve).not.toHaveBeenCalled();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  });
});

// ─── 2. Anonymous user — with localStorage progress ───────────────────────────
describe('Anonymous user — localStorage progress applied', () => {
  it('restores completed stages from savedProgress', async () => {
    const msg = await wsInit({
      userId: null,
      savedProgress: { completedStages: [0, 1, 2], currentStage: 3 },
    });
    expect(msg.completedStages).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(msg.currentStage).toBe(3);
  });

  it('clamps currentStage to free stage count for unpaid users', async () => {
    const msg = await wsInit({
      userId: null,
      savedProgress: { completedStages: [0, 1], currentStage: 9 },
    });
    expect(msg.currentStage).toBe(4); // FREE_STAGE_COUNT - 1
  });

  it('ignores out-of-range stage indices for free users', async () => {
    const msg = await wsInit({
      userId: null,
      savedProgress: { completedStages: [0, 5, 9], currentStage: 0 },
    });
    expect(msg.completedStages).toContain(0);
    expect(msg.completedStages).not.toContain(5);
    expect(msg.completedStages).not.toContain(9);
  });

  it('re-verifies Stripe unlock from localStorage stripeSessionId', async () => {
    const msg = await wsInit({
      userId: null,
      savedProgress: { completedStages: [0], currentStage: 0, stripeSessionId: 'cs_paid' },
    });
    expect(mockStripeRetrieve).toHaveBeenCalledWith('cs_paid');
    expect(msg.advancedUnlocked).toBe(true);
  });

  it('does not unlock when Stripe says unpaid', async () => {
    mockStripeRetrieve.mockResolvedValueOnce({ payment_status: 'unpaid' });
    const msg = await wsInit({
      userId: null,
      savedProgress: { stripeSessionId: 'cs_unpaid' },
    });
    expect(msg.advancedUnlocked).toBe(false);
  });
});

// ─── 3. First-time authenticated user — migration from localStorage ───────────
describe('First-time authenticated user — migrates localStorage to Turso', () => {
  it('saves localStorage stages to Turso on first connect', async () => {
    // Turso has no row for this user
    mockTursoExecute.mockResolvedValueOnce({ rows: [] }); // SELECT returns empty
    mockTursoExecute.mockResolvedValueOnce({ rows: [] }); // INSERT/upsert

    const msg = await wsInit({
      userId: TEST_USER_ID,
      savedProgress: { completedStages: [0, 1], currentStage: 2 },
    });

    expect(msg.completedStages).toEqual(expect.arrayContaining([0, 1]));
    expect(msg.currentStage).toBe(2);

    // Turso should have been called for SELECT then INSERT
    const calls = mockTursoExecute.mock.calls;
    const insertCall = calls.find(c => c[0].sql && c[0].sql.includes('INSERT INTO user_progress'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[0].args).toContain('[0,1]'); // serialised completed stages
  });

  it('saves stripeSessionId to Turso even when Stripe verify fails (Stripe is down)', async () => {
    mockStripeRetrieve.mockRejectedValueOnce(new Error('Stripe unavailable'));
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [] })  // SELECT — no row
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    await wsInit({
      userId: TEST_USER_ID,
      savedProgress: { completedStages: [0], currentStage: 1, stripeSessionId: 'cs_paid_123' },
    });

    const calls = mockTursoExecute.mock.calls;
    const insertCall = calls.find(c => c[0].sql && c[0].sql.includes('INSERT INTO user_progress'));
    expect(insertCall).toBeTruthy();
    // stripeSessionId must be in the args so it isn't lost
    expect(insertCall[0].args).toContain('cs_paid_123');
  });

  it('saves stripeSessionId AND unlocks when Stripe confirms paid', async () => {
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [] })  // SELECT
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    const msg = await wsInit({
      userId: TEST_USER_ID,
      savedProgress: { completedStages: [0, 1], currentStage: 2, stripeSessionId: 'cs_paid_456' },
    });

    expect(mockStripeRetrieve).toHaveBeenCalledWith('cs_paid_456');
    expect(msg.advancedUnlocked).toBe(true);

    const insertCall = mockTursoExecute.mock.calls.find(c =>
      c[0].sql && c[0].sql.includes('INSERT INTO user_progress')
    );
    expect(insertCall[0].args).toContain('cs_paid_456');
    // advancedUnlocked = 1
    expect(insertCall[0].args).toContain(1);
  });

  it('creates a Turso row even when no localStorage progress exists', async () => {
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [] })  // SELECT — no row
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    await wsInit({ userId: TEST_USER_ID, savedProgress: {} });

    const insertCall = mockTursoExecute.mock.calls.find(c =>
      c[0].sql && c[0].sql.includes('INSERT INTO user_progress')
    );
    expect(insertCall).toBeTruthy();
  });
});

// ─── 4. Returning authenticated user — Turso is authoritative ─────────────────
describe('Returning authenticated user — Turso progress takes precedence', () => {
  it('loads progress from Turso and ignores client savedProgress', async () => {
    // Turso has stages 0,1,2 at currentStage 3
    mockTursoExecute.mockResolvedValueOnce({
      rows: [{
        completed_stages: '[0,1,2]',
        current_stage: 3,
        advanced_unlocked: 0,
        stripe_session_id: null,
      }],
    });

    const msg = await wsInit({
      userId: TEST_USER_ID,
      // Client sends stale/different data — should be ignored
      savedProgress: { completedStages: [0], currentStage: 0 },
    });

    expect(msg.completedStages).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(msg.currentStage).toBe(3);
  });

  it('does not call Stripe when advancedUnlocked is already true in Turso', async () => {
    mockTursoExecute.mockResolvedValueOnce({
      rows: [{
        completed_stages: '[0,1,2,3,4]',
        current_stage: 5,
        advanced_unlocked: 1,
        stripe_session_id: 'cs_old',
      }],
    });

    const msg = await wsInit({
      userId: TEST_USER_ID,
      savedProgress: {},
    });

    expect(mockStripeRetrieve).not.toHaveBeenCalled();
    expect(msg.advancedUnlocked).toBe(true);
    expect(msg.stageCount).toBe(10);
  });

  it('re-verifies Stripe from Turso stripeSessionId when advancedUnlocked is false', async () => {
    // Turso has a stripeSessionId but advancedUnlocked is somehow false (edge case)
    mockTursoExecute.mockResolvedValueOnce({
      rows: [{
        completed_stages: '[0]',
        current_stage: 1,
        advanced_unlocked: 0,
        stripe_session_id: 'cs_verify_me',
      }],
    });

    const msg = await wsInit({ userId: TEST_USER_ID, savedProgress: {} });

    expect(mockStripeRetrieve).toHaveBeenCalledWith('cs_verify_me');
    expect(msg.advancedUnlocked).toBe(true);
  });

  it('survives server restart — progress restored from Turso without localStorage', async () => {
    // Simulate: server restarted, in-memory state is empty, user has no localStorage
    mockTursoExecute.mockResolvedValueOnce({
      rows: [{
        completed_stages: '[0,1,2,3,4]',
        current_stage: 4,
        advanced_unlocked: 0,
        stripe_session_id: null,
      }],
    });

    const msg = await wsInit({
      userId: TEST_USER_ID,
      savedProgress: {}, // no localStorage (cleared or different device)
    });

    expect(msg.completedStages).toEqual(expect.arrayContaining([0, 1, 2, 3, 4]));
    expect(msg.currentStage).toBe(4);
  });

  it('does not call Turso INSERT when progress already exists (no double-write)', async () => {
    mockTursoExecute.mockResolvedValueOnce({
      rows: [{ completed_stages: '[0]', current_stage: 1, advanced_unlocked: 0, stripe_session_id: null }],
    });

    await wsInit({ userId: TEST_USER_ID, savedProgress: {} });

    const insertCall = mockTursoExecute.mock.calls.find(c =>
      c[0].sql && c[0].sql.includes('INSERT INTO user_progress')
    );
    expect(insertCall).toBeUndefined();
  });
});

// ─── 5. Stage completion saves to Turso ──────────────────────────────────────
describe('Stage completion — Turso save behavior', () => {
  it('calls Turso save when authenticated user submits correct flag', async () => {
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [] })  // loadUserProgress on init
      .mockResolvedValueOnce({ rows: [] })  // saveUserProgress on init (first connect)
      .mockResolvedValueOnce({ rows: [] }); // saveUserProgress on stage complete

    const results = await wsSubmitFlag(TEST_USER_ID, 0, 'test-flag');
    const correctResult = results.find(r => r.flagResult === 'correct');
    expect(correctResult).toBeTruthy();

    const saveCalls = mockTursoExecute.mock.calls.filter(c =>
      c[0].sql && c[0].sql.includes('INSERT INTO user_progress')
    );
    // Should have at least one save after completion
    expect(saveCalls.length).toBeGreaterThan(0);
  });

  it('does NOT call Turso when anonymous user submits correct flag', async () => {
    const results = await wsSubmitFlag(null, 0, 'anon-flag');
    const correctResult = results.find(r => r.flagResult === 'correct');
    expect(correctResult).toBeTruthy();
    expect(mockTursoExecute).not.toHaveBeenCalled();
  });
});

// ─── 6. Purchase flow — checkout requires auth ────────────────────────────────
describe('POST /api/checkout — requires authentication', () => {
  const app = buildCheckoutApp();

  it('returns 401 with requiresAuth: true when not signed in', async () => {
    const sessionRes = await request(app).post('/api/session');
    const { sessionId } = sessionRes.body;
    const res = await request(app).post('/api/checkout').send({ sessionId });
    expect(res.status).toBe(401);
    expect(res.body.requiresAuth).toBe(true);
    sessionManager.destroySession(sessionId);
  });

  it('proceeds to Stripe when signed in', async () => {
    const sessionRes = await request(app).post('/api/session');
    const { sessionId } = sessionRes.body;
    const res = await request(app)
      .post('/api/checkout')
      .set('Cookie', makeAuthCookie())
      .send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('checkout.stripe.com');
    sessionManager.destroySession(sessionId);
  });
});

// ─── 7. Purchase verification saves to Turso ─────────────────────────────────
describe('POST /api/verify-payment — saves unlock to Turso for auth users', () => {
  const app = buildCheckoutApp();

  it('saves advancedUnlocked and stripeSessionId to Turso when signed in', async () => {
    const sessionRes = await request(app).post('/api/session');
    const { sessionId } = sessionRes.body;

    const res = await request(app)
      .post('/api/verify-payment')
      .set('Cookie', makeAuthCookie())
      .send({ session_id: 'cs_test_paid', sessionId });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(true);

    const upsertCall = mockTursoExecute.mock.calls.find(c =>
      c[0].sql && c[0].sql.includes('advanced_unlocked = 1')
    );
    expect(upsertCall).toBeTruthy();
    // stripeSessionId should be in the args
    expect(upsertCall[0].args).toContain('cs_test_paid');

    sessionManager.destroySession(sessionId);
  });

  it('still unlocks in-memory even when Turso is unavailable', async () => {
    mockTursoExecute.mockRejectedValueOnce(new Error('Turso down'));

    const sessionRes = await request(app).post('/api/session');
    const { sessionId } = sessionRes.body;

    const res = await request(app)
      .post('/api/verify-payment')
      .set('Cookie', makeAuthCookie())
      .send({ session_id: 'cs_test_paid', sessionId });

    // Payment still succeeds — Turso failure is silent
    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(true);

    sessionManager.destroySession(sessionId);
  });

  it('unlocks in-memory without Turso when not signed in (anonymous)', async () => {
    const sessionRes = await request(app).post('/api/session');
    const { sessionId } = sessionRes.body;

    const res = await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_paid', sessionId });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(true);

    sessionManager.destroySession(sessionId);
  });
});

// ─── 8. Auth verify endpoint edge cases ───────────────────────────────────────
describe('GET /api/auth/verify — full happy path and edge cases', () => {
  function buildAuthApp() {
    const app = express();
    app.use(express.json());
    jest.resetModules();
    const authRoutes = require('../../src/routes/auth');
    app.use('/api/auth', authRoutes);
    return app;
  }

  it('sets JWT cookie and redirects to /play on valid token', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-123', expires_at: now + 900, used: 0 }] }) // token lookup
      .mockResolvedValueOnce({ rows: [] })  // mark used
      .mockResolvedValueOnce({ rows: [{ email: 'player@example.com' }] }); // get email

    const app = buildAuthApp();
    const res = await request(app).get('/api/auth/verify?token=valid-token');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/play');
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(setCookie.some(c => c.includes('hacklab_token='))).toBe(true);
  });

  it('respects the next param in redirect', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-123', expires_at: now + 900, used: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ email: 'player@example.com' }] });

    const app = buildAuthApp();
    const res = await request(app).get('/api/auth/verify?token=valid-token&next=/play%3Funlock%3D1');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/play?unlock=1');
  });

  it('rejects tokens used more than once', async () => {
    const now = Math.floor(Date.now() / 1000);
    // First use: valid
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-1', expires_at: now + 900, used: 1 }] });

    const app = buildAuthApp();
    const res = await request(app).get('/api/auth/verify?token=already-used');
    expect(res.status).toBe(400);
  });

  it('rejects expired tokens', async () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    mockTursoExecute.mockResolvedValueOnce({
      rows: [{ user_id: 'u-1', expires_at: past, used: 0 }],
    });

    const app = buildAuthApp();
    const res = await request(app).get('/api/auth/verify?token=expired-token');
    expect(res.status).toBe(400);
  });
});

// ─── 9. Send-link — existing vs new user ─────────────────────────────────────
describe('POST /api/auth/send-link — find-or-create user', () => {
  function buildAuthApp() {
    const app = express();
    app.use(express.json());
    jest.resetModules();
    process.env.RESEND_API_KEY = 're_test';
    const authRoutes = require('../../src/routes/auth');
    app.use('/api/auth', authRoutes);
    return app;
  }

  it('does not INSERT user if email already exists', async () => {
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] }) // SELECT finds user
      .mockResolvedValueOnce({ rows: [] });  // INSERT token

    const app = buildAuthApp();
    const res = await request(app)
      .post('/api/auth/send-link')
      .send({ email: 'existing@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);

    // Should not have called INSERT users
    const userInsert = mockTursoExecute.mock.calls.find(c =>
      c[0].sql && c[0].sql.includes('INSERT INTO users')
    );
    expect(userInsert).toBeUndefined();
  });

  it('normalizes email to lowercase before lookup', async () => {
    mockTursoExecute
      .mockResolvedValueOnce({ rows: [] })  // SELECT
      .mockResolvedValueOnce({ rows: [] }) // INSERT user
      .mockResolvedValueOnce({ rows: [] }); // INSERT token

    const app = buildAuthApp();
    await request(app)
      .post('/api/auth/send-link')
      .send({ email: 'User@EXAMPLE.COM' });

    const selectCall = mockTursoExecute.mock.calls.find(c =>
      c[0].sql && c[0].sql.includes('SELECT id FROM users')
    );
    expect(selectCall[0].args[0]).toBe('user@example.com');
  });
});

// ─── 10. Turso resilience — game still works if Turso is down ─────────────────
describe('Turso resilience — graceful degradation', () => {
  it('anonymous user can still play if Turso is down (not called)', async () => {
    const msg = await wsInit({
      userId: null,
      savedProgress: { completedStages: [0, 1], currentStage: 2 },
    });
    expect(msg.currentStage).toBe(2);
    expect(mockTursoExecute).not.toHaveBeenCalled();
  });

  it('authenticated user falls back gracefully if Turso SELECT throws', async () => {
    mockTursoExecute.mockRejectedValueOnce(new Error('connection refused'));

    // Should not throw — ws-handler catches Turso errors
    const msg = await wsInit({
      userId: TEST_USER_ID,
      savedProgress: { completedStages: [0], currentStage: 1 },
    });

    // Falls back to savedProgress
    expect(msg).toBeTruthy();
    expect(msg.currentStage).toBeGreaterThanOrEqual(0);
  });
});
