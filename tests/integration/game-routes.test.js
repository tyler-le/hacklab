'use strict';

// Mock turso so game.js doesn't need a real DB connection
jest.mock('../../src/db/turso', () => ({ getTursoClient: () => null }));

const request = require('supertest');
const express = require('express');
const sessionManager = require('../../src/db/session-manager');
const gameRouter = require('../../src/routes/game');

// Build a minimal Express app with just the game routes
let app;
let sessionId;

beforeAll(() => {
  sessionManager.createTemplate();
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', gameRouter);
});

beforeEach(async () => {
  // Create a fresh session before each test
  const res = await request(app).post('/api/session');
  sessionId = res.body.sessionId;
});

afterEach(() => {
  if (sessionId) sessionManager.destroySession(sessionId);
});

// ─── Session management ───────────────────────────────────────────────────────
describe('POST /api/session', () => {
  it('creates a new session and returns a sessionId', async () => {
    const res = await request(app).post('/api/session');
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
  });
});

describe('GET /api/session/:id', () => {
  it('returns game state for valid session', async () => {
    const res = await request(app).get(`/api/session/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.currentStage).toBe(0);
    expect(res.body.completedStages).toEqual([]);
    expect(res.body.stage.id).toBe('intro');
  });

  it('returns 404 for invalid session', async () => {
    const res = await request(app).get('/api/session/non-existent-id');
    expect(res.status).toBe(404);
  });
});

// ─── Stage switching ──────────────────────────────────────────────────────────
describe('POST /api/stage/switch', () => {
  it('switches to a valid free stage (0–4)', async () => {
    const res = await request(app)
      .post('/api/stage/switch')
      .send({ sessionId, stageIndex: 2 });
    expect(res.status).toBe(200);
    expect(res.body.currentStage).toBe(2);
    expect(res.body.stage.id).toBe('xss');
  });

  it('returns 400 for negative stage index', async () => {
    const res = await request(app)
      .post('/api/stage/switch')
      .send({ sessionId, stageIndex: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for out-of-range stage index', async () => {
    const res = await request(app)
      .post('/api/stage/switch')
      .send({ sessionId, stageIndex: 999 });
    expect(res.status).toBe(400);
  });

  // ── Paywall ──
  it('returns 403 with paymentRequired when accessing stage 5 without unlock', async () => {
    const res = await request(app)
      .post('/api/stage/switch')
      .send({ sessionId, stageIndex: 5 });
    expect(res.status).toBe(403);
    expect(res.body.paymentRequired).toBe(true);
    expect(res.body.error).toMatch(/Advanced Pack/);
  });

  it('returns 403 with paymentRequired for stages 6–9 without unlock', async () => {
    for (const idx of [6, 7, 8, 9]) {
      const res = await request(app)
        .post('/api/stage/switch')
        .send({ sessionId, stageIndex: idx });
      expect(res.status).toBe(403);
      expect(res.body.paymentRequired).toBe(true);
    }
  });
});

// ─── Stage completion & advancement ───────────────────────────────────────────
describe('POST /api/stage/next', () => {
  it('returns 400 when current stage is not completed', async () => {
    const res = await request(app)
      .post('/api/stage/next')
      .send({ sessionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Complete the current stage/);
  });

  it('advances to next stage after completing current', async () => {
    // Mark stage 0 as completed
    await request(app).post('/api/stage/complete').send({ sessionId });
    const res = await request(app).post('/api/stage/next').send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.currentStage).toBe(1);
  });

  it('returns 400 at the last stage (index 9) when no more stages exist', async () => {
    // Unlock advanced pack on this session's state so we can switch to stage 9
    const { getGameState } = require('../../src/routes/game');
    const state = getGameState(sessionId);
    state.advancedUnlocked = true;

    // Switch to last stage and complete it
    await request(app).post('/api/stage/switch').send({ sessionId, stageIndex: 9 });
    await request(app).post('/api/stage/complete').send({ sessionId });

    const res = await request(app).post('/api/stage/next').send({ sessionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No more stages/);
  });
});

describe('POST /api/stage/complete', () => {
  it('marks current stage as completed', async () => {
    const res = await request(app)
      .post('/api/stage/complete')
      .send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.completedStages).toContain(0);
  });

  it('completing multiple stages accumulates completedStages', async () => {
    await request(app).post('/api/stage/complete').send({ sessionId });
    await request(app).post('/api/stage/switch').send({ sessionId, stageIndex: 1 });
    await request(app).post('/api/stage/complete').send({ sessionId });
    const res = await request(app).get(`/api/session/${sessionId}`);
    expect(res.body.completedStages).toContain(0);
    expect(res.body.completedStages).toContain(1);
  });
});

// ─── Hints ────────────────────────────────────────────────────────────────────
describe('POST /api/hint', () => {
  it('returns first hint at hintIndex 0', async () => {
    const res = await request(app)
      .post('/api/hint')
      .send({ sessionId, hintIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.hint).toBeTruthy();
    expect(res.body.hintIndex).toBe(0);
  });

  it('returns null hint and message when no more hints available', async () => {
    const res = await request(app)
      .post('/api/hint')
      .send({ sessionId, hintIndex: 999 });
    expect(res.status).toBe(200);
    expect(res.body.hint).toBeNull();
    expect(res.body.message).toMatch(/No more hints/);
  });
});

// ─── Stage metadata ───────────────────────────────────────────────────────────
describe('GET /api/stage/:index', () => {
  it('returns stage metadata for valid index', async () => {
    const res = await request(app).get('/api/stage/0');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('intro');
    expect(res.body.title).toBeTruthy();
  });

  it('returns 404 for invalid index', async () => {
    const res = await request(app).get('/api/stage/999');
    expect(res.status).toBe(404);
  });
});

// ─── Payment endpoints ────────────────────────────────────────────────────────
describe('POST /api/checkout (paywall)', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send({ sessionId });
    expect(res.status).toBe(401);
    expect(res.body.requiresAuth).toBe(true);
  });
});

describe('POST /api/verify-payment (paywall)', () => {
  it('returns 503 when Stripe is not configured', async () => {
    const res = await request(app)
      .post('/api/verify-payment')
      .send({ session_id: 'cs_test_fake', sessionId });
    expect(res.status).toBe(503);
  });
});

// ─── Reset ────────────────────────────────────────────────────────────────────
describe('POST /api/reset', () => {
  it('resets game and returns a new sessionId', async () => {
    const res = await request(app)
      .post('/api/reset')
      .send({ sessionId });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.sessionId).not.toBe(sessionId);
    // Update sessionId for cleanup
    sessionId = res.body.sessionId;
  });

  it('new session after reset starts at stage 0 with no completions', async () => {
    const resetRes = await request(app).post('/api/reset').send({ sessionId });
    sessionId = resetRes.body.sessionId;
    const stateRes = await request(app).get(`/api/session/${sessionId}`);
    expect(stateRes.body.currentStage).toBe(0);
    expect(stateRes.body.completedStages).toEqual([]);
  });
});
