'use strict';

// Mock @libsql/client before any requires
jest.mock('@libsql/client', () => ({
  createClient: jest.fn(() => mockDb),
}));

const mockDb = {
  execute: jest.fn(),
  batch: jest.fn(),
};

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');

const SECRET = 'test-progress-integration-secret';

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.TURSO_URL = 'libsql://test.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'test-token';
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.TURSO_URL;
  delete process.env.TURSO_AUTH_TOKEN;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function buildApp() {
  const app = express();
  app.use(express.json());
  const progressRoutes = require('../../src/routes/progress');
  app.use('/api/progress', progressRoutes);
  return app;
}

function makeAuthCookie(userId = 'u-test', email = 'test@example.com') {
  const token = jwt.sign({ userId, email }, SECRET, { expiresIn: '1d' });
  return `hacklab_token=${token}`;
}

// ─── Auth guard ───────────────────────────────────────────────────────────────
describe('GET /api/progress without auth', () => {
  it('returns 401 with requiresAuth: true', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/progress');
    expect(res.status).toBe(401);
    expect(res.body.requiresAuth).toBe(true);
  });
});

describe('POST /api/progress without auth', () => {
  it('returns 401 with requiresAuth: true', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/progress')
      .send({ completedStages: [0], currentStage: 1, advancedUnlocked: false });
    expect(res.status).toBe(401);
    expect(res.body.requiresAuth).toBe(true);
  });
});

// ─── Authenticated flows ──────────────────────────────────────────────────────
describe('GET /api/progress with auth — no existing row', () => {
  it('returns { found: false } when no progress row exists', async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const app = buildApp();
    const res = await request(app)
      .get('/api/progress')
      .set('Cookie', makeAuthCookie());

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });
});

describe('POST /api/progress then GET', () => {
  it('saves data and GET returns it', async () => {
    // POST — upsert succeeds
    mockDb.execute.mockResolvedValueOnce({ rows: [] }); // INSERT/upsert

    const app = buildApp();
    const postRes = await request(app)
      .post('/api/progress')
      .set('Cookie', makeAuthCookie('u-save'))
      .send({
        completedStages: [0, 1],
        currentStage: 2,
        advancedUnlocked: false,
        stripeSessionId: null,
      });

    expect(postRes.status).toBe(200);
    expect(postRes.body.ok).toBe(true);

    // GET — return the stored row
    mockDb.execute.mockResolvedValueOnce({
      rows: [{
        completed_stages: '[0,1]',
        current_stage: 2,
        advanced_unlocked: 0,
        stripe_session_id: null,
      }],
    });

    const getRes = await request(app)
      .get('/api/progress')
      .set('Cookie', makeAuthCookie('u-save'));

    expect(getRes.status).toBe(200);
    expect(getRes.body.found).toBe(true);
    expect(getRes.body.completedStages).toEqual([0, 1]);
    expect(getRes.body.currentStage).toBe(2);
    expect(getRes.body.advancedUnlocked).toBe(false);
  });
});
