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

const request = require('supertest');
const express = require('express');
const sessionManager = require('../../src/db/session-manager');
const gameRouter = require('../../src/routes/game');
const { getGameState } = require('../../src/routes/game');

let app;
let sessionId;

beforeAll(() => {
  sessionManager.createTemplate();
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';

  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', gameRouter);
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
});

// ─── Checkout flow ────────────────────────────────────────────────────────────
describe('POST /api/checkout', () => {
  it('returns a Stripe checkout URL when configured', async () => {
    const res = await request(app)
      .post('/api/checkout')
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
