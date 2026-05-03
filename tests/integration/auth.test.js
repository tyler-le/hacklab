'use strict';

// Mock @libsql/client before any requires
jest.mock('@libsql/client', () => ({
  createClient: jest.fn(() => mockDb),
}));

// Mock resend
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ id: 'email-id-123' }),
    },
  })),
}));

const mockDb = {
  execute: jest.fn(),
  batch: jest.fn(),
};

const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');

const SECRET = 'test-auth-integration-secret';

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.TURSO_URL = 'libsql://test.turso.io';
  process.env.TURSO_AUTH_TOKEN = 'test-token';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.FROM_EMAIL = 'noreply@test.com';
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.TURSO_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.FROM_EMAIL;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function buildApp() {
  const app = express();
  app.use(express.json());
  // Re-require to pick up the mocks
  const authRoutes = require('../../src/routes/auth');
  app.use('/api/auth', authRoutes);
  return app;
}

// ─── POST /api/auth/send-link ─────────────────────────────────────────────────
describe('POST /api/auth/send-link', () => {
  it('returns { sent: true } with valid email', async () => {
    // Simulate: no existing user found, then insert user, insert token
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })           // SELECT existing user
      .mockResolvedValueOnce({ rows: [] })           // INSERT user
      .mockResolvedValueOnce({ rows: [] });          // INSERT token

    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/send-link')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
  });

  it('returns 400 for invalid email (no @)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/send-link')
      .send({ email: 'notanemail' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 for missing email', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/send-link')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 503 when RESEND_API_KEY is not set', async () => {
    delete process.env.RESEND_API_KEY;
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/send-link')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(503);
    process.env.RESEND_API_KEY = 're_test_key';
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('returns { user: null } with no cookie', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('returns { user: { id, email } } with valid JWT cookie', async () => {
    const token = jwt.sign({ userId: 'u-abc', email: 'user@example.com' }, SECRET, { expiresIn: '1d' });
    const app = buildApp();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `hacklab_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'u-abc', email: 'user@example.com' });
  });

  it('returns { user: null } with invalid JWT cookie', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'hacklab_token=notavalidtoken');

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('clears the cookie and returns { ok: true }', async () => {
    const token = jwt.sign({ userId: 'u-abc', email: 'user@example.com' }, SECRET, { expiresIn: '1d' });
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `hacklab_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // The Set-Cookie header should clear the cookie
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(setCookie.some(c => c.includes('hacklab_token=;') || c.includes('hacklab_token=') && c.includes('Expires='))).toBe(true);
  });
});

// ─── GET /api/auth/verify ─────────────────────────────────────────────────────
describe('GET /api/auth/verify', () => {
  it('returns 400 for missing token', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/auth/verify');
    expect(res.status).toBe(400);
  });

  it('returns 400 for token not found in DB', async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] }); // token lookup returns nothing

    const app = buildApp();
    const res = await request(app).get('/api/auth/verify?token=fake-token');
    expect(res.status).toBe(400);
  });

  it('returns 400 for already-used token', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ token: 'tok', user_id: 'u1', expires_at: now + 900, used: 1 }],
    });

    const app = buildApp();
    const res = await request(app).get('/api/auth/verify?token=tok');
    expect(res.status).toBe(400);
  });

  it('returns 400 for expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockDb.execute.mockResolvedValueOnce({
      rows: [{ token: 'tok', user_id: 'u1', expires_at: now - 1, used: 0 }],
    });

    const app = buildApp();
    const res = await request(app).get('/api/auth/verify?token=tok');
    expect(res.status).toBe(400);
  });

  // ─── Happy path + auth=success cross-tab redirect ──────────────────────────
  function mockVerifySuccess(now) {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ token: 'tok', user_id: 'u1', expires_at: now + 900, used: 0 }] }) // SELECT token
      .mockResolvedValueOnce({ rows: [] })                                                                 // UPDATE set used
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'test@example.com' }] });                        // SELECT user
  }

  it('sets JWT cookie and returns self-closing HTML on valid token', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockVerifySuccess(now);

    const app = buildApp();
    const res = await request(app).get('/api/auth/verify?token=tok');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    // Cookie must be set
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(setCookie.some(c => c.startsWith('hacklab_token='))).toBe(true);
    // HTML must write the cross-tab storage event and call window.close()
    expect(res.text).toContain('hacklab-auth-event');
    expect(res.text).toContain('window.close()');
  });

  it('return link defaults to /play when no next param is given', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockVerifySuccess(now);

    const app = buildApp();
    const res = await request(app).get('/api/auth/verify?token=tok');
    expect(res.text).toContain('href="/play"');
  });

  it('return link uses the next param when provided', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockVerifySuccess(now);

    const app = buildApp();
    const res = await request(app).get('/api/auth/verify?token=tok&next=%2Fplay%3Funlock%3D1');
    expect(res.text).toContain('href="/play?unlock=1"');
  });

  it('rejects non-relative next params (open-redirect guard)', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockVerifySuccess(now);

    const app = buildApp();
    const res = await request(app)
      .get('/api/auth/verify?token=tok&next=https%3A%2F%2Fevil.com');
    expect(res.status).toBe(200);
    // Falls back to /play, not the external URL
    expect(res.text).toContain('href="/play"');
    expect(res.text).not.toContain('evil.com');
  });

  it('JWT in the cookie is valid and contains the user id and email', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockVerifySuccess(now);

    const app = buildApp();
    const res = await request(app).get('/api/auth/verify?token=tok');
    const cookieHeader = res.headers['set-cookie'][0];
    const token = cookieHeader.split(';')[0].replace('hacklab_token=', '');
    const payload = jwt.verify(token, SECRET);
    expect(payload.userId).toBe('u1');
    expect(payload.email).toBe('test@example.com');
  });
});
