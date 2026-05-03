'use strict';

// Mock Stripe before any requires so the lazy require('stripe') inside game.js gets the mock
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_fake' }),
        retrieve: jest.fn().mockResolvedValue({ payment_status: 'paid' }),
      },
    },
  }));
});

// Mock turso so game.js verify-payment doesn't fail when no Turso is configured
jest.mock('../../src/db/turso', () => ({ getTursoClient: () => null }));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');
const sessionManager = require('../../src/db/session-manager');
const gameRouter = require('../../src/routes/game');
const { getGameState } = require('../../src/routes/game');

const JWT_SECRET = 'test-paywall-secret';

let app;
let sessionId;

function makeAuthCookie() {
  const token = jwt.sign({ userId: 'u-paywall', email: 'paywall@test.com' }, JWT_SECRET, { expiresIn: '1d' });
  return `hacklab_token=${token}`;
}

beforeAll(() => {
  sessionManager.createTemplate();
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.TURSO_URL = ''; // ensure Turso is disabled in tests

  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', gameRouter);
  // Mount auth routes so sign-out tests can call /api/auth/*
  const authRouter = require('../../src/routes/auth');
  app.use('/api/auth', authRouter);
});

beforeEach(async () => {
  const res = await request(app).post('/api/session');
  sessionId = res.body.sessionId;
});

afterEach(() => {
  if (sessionId) sessionManager.destroySession(sessionId);
});

afterAll(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.JWT_SECRET;
});

// ─── Checkout flow ────────────────────────────────────────────────────────────
describe('POST /api/checkout', () => {
  it('returns 401 with requiresAuth: true when no auth cookie', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send({ sessionId });
    expect(res.status).toBe(401);
    expect(res.body.requiresAuth).toBe(true);
  });

  it('returns a Stripe checkout URL when authenticated', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .set('Cookie', makeAuthCookie())
      .send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('checkout.stripe.com');
  });
});

// ─── Payment verification — paid ─────────────────────────────────────────────
describe('POST /api/verify-payment — successful payment', () => {
  it('returns unlocked: true and full stageCount when payment_status is paid', async () => {
    const res = await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_paid', sessionId });
    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(true);
    expect(res.body.stageCount).toBe(10);
  });

  it('sets advancedUnlocked on the game session', async () => {
    await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_paid', sessionId });
    const state = getGameState(sessionId);
    expect(state.advancedUnlocked).toBe(true);
  });

  it('advanced stages 5–9 become accessible after unlock', async () => {
    await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_paid', sessionId });

    for (const idx of [5, 6, 7, 8, 9]) {
      const res = await request(app)
        .post('/api/stage/switch')
        .send({ sessionId, stageIndex: idx });
      expect(res.status).toBe(200);
      expect(res.body.currentStage).toBe(idx);
    }
  });

  it('stage 5 resolves to price_tamper after unlock', async () => {
    await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_paid', sessionId });
    const res = await request(app)
      .post('/api/stage/switch')
      .send({ sessionId, stageIndex: 5 });
    expect(res.body.stage.id).toBe('price_tamper');
  });

  it('can advance through all 10 stages after unlock', async () => {
    await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_paid', sessionId });

    // Complete and advance through all 10 stages
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/stage/switch').send({ sessionId, stageIndex: i });
      const completeRes = await request(app).post('/api/stage/complete').send({ sessionId });
      expect(completeRes.body.completedStages).toContain(i);
    }

    const state = getGameState(sessionId);
    expect(state.completedStages.size).toBe(10);
  });
});

// ─── Payment verification — not paid ─────────────────────────────────────────
describe('POST /api/verify-payment — unpaid / failed payment', () => {
  beforeEach(() => {
    // Override retrieve to return an unpaid status
    const Stripe = require('stripe');
    Stripe.mockImplementation(() => ({
      checkout: {
        sessions: {
          retrieve: jest.fn().mockResolvedValue({ payment_status: 'unpaid' }),
        },
      },
    }));
  });

  afterEach(() => {
    // Restore the paid mock
    const Stripe = require('stripe');
    Stripe.mockImplementation(() => ({
      checkout: {
        sessions: {
          retrieve: jest.fn().mockResolvedValue({ payment_status: 'paid' }),
        },
      },
    }));
  });

  it('returns unlocked: false when payment_status is unpaid', async () => {
    const res = await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_unpaid', sessionId });
    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(false);
  });

  it('advanced stages remain blocked when payment is unpaid', async () => {
    await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_unpaid', sessionId });

    const res = await request(app)
      .post('/api/stage/switch')
      .send({ sessionId, stageIndex: 5 });
    expect(res.status).toBe(403);
    expect(res.body.paymentRequired).toBe(true);
  });

  it('does not set advancedUnlocked when payment is unpaid', async () => {
    await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_unpaid', sessionId });
    const state = getGameState(sessionId);
    expect(state.advancedUnlocked).toBeFalsy();
  });
});

// ─── Sign-out revokes access ──────────────────────────────────────────────────
// The client calls signOut() which POSTs /api/auth/logout to clear the JWT
// cookie, then resets advancedUnlocked = false and stageCount = FREE_STAGE_COUNT.
// These tests verify the server-side contract that drives that client reset.
describe('sign-out revokes authenticated state', () => {
  it('POST /api/auth/logout clears the JWT cookie', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', makeAuthCookie());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(setCookie.some(c => c.includes('hacklab_token=') && c.includes('Expires='))).toBe(true);
  });

  it('GET /api/auth/me returns null after sign-out', async () => {
    // Sign out to clear the cookie
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', makeAuthCookie());
    // Extract the cleared cookie value from Set-Cookie (value will be empty)
    const clearedCookie = logoutRes.headers['set-cookie'][0].split(';')[0]; // e.g. "hacklab_token="

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', clearedCookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user).toBeNull();
  });

  it('POST /api/checkout returns 401 after sign-out', async () => {
    // Unlock via payment while authenticated
    await request(app)
      .post('/api/verify-payment')
      .set('Cookie', makeAuthCookie())
      .send({ session_id: 'cs_paid', sessionId });

    // Attempt checkout after sign-out (no cookie)
    const res = await request(app)
      .post('/api/checkout')
      .send({ sessionId });
    expect(res.status).toBe(401);
    expect(res.body.requiresAuth).toBe(true);
  });
});
