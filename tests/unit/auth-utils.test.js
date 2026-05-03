'use strict';

// Mock turso before requiring auth
jest.mock('../../src/db/turso', () => ({ getTursoClient: () => null }));

const jwt = require('jsonwebtoken');

const SECRET = 'test-secret-for-auth-utils';

// We need to test getUserIdFromCookies from auth.js but with a known secret.
// Patch the env before requiring the module.
beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

// Require after env is set
const { getUserIdFromCookies } = require('../../src/routes/auth');

describe('getUserIdFromCookies', () => {
  it('returns null when cookieHeader is undefined', () => {
    expect(getUserIdFromCookies(undefined)).toBeNull();
  });

  it('returns null when cookieHeader is empty string', () => {
    expect(getUserIdFromCookies('')).toBeNull();
  });

  it('returns null when hacklab_token cookie is missing', () => {
    expect(getUserIdFromCookies('other_cookie=abc123')).toBeNull();
  });

  it('returns null for a malformed JWT', () => {
    expect(getUserIdFromCookies('hacklab_token=notajwt')).toBeNull();
  });

  it('returns null for an expired JWT', () => {
    const expired = jwt.sign({ userId: 'user-123', email: 'a@b.com' }, SECRET, { expiresIn: -1 });
    expect(getUserIdFromCookies(`hacklab_token=${expired}`)).toBeNull();
  });

  it('returns userId for a valid JWT cookie', () => {
    const token = jwt.sign({ userId: 'user-abc', email: 'test@example.com' }, SECRET, { expiresIn: '1h' });
    const result = getUserIdFromCookies(`hacklab_token=${token}`);
    expect(result).toBe('user-abc');
  });

  it('works when hacklab_token is not the first cookie', () => {
    const token = jwt.sign({ userId: 'user-xyz', email: 'x@y.com' }, SECRET, { expiresIn: '1h' });
    const cookieHeader = `session=abc; hacklab_token=${token}; foo=bar`;
    expect(getUserIdFromCookies(cookieHeader)).toBe('user-xyz');
  });
});

describe('JWT sign and verify round-trip', () => {
  it('can sign a token and decode it back', () => {
    const payload = { userId: 'u1', email: 'a@example.com' };
    const token = jwt.sign(payload, SECRET, { expiresIn: '1d' });
    const decoded = jwt.verify(token, SECRET);
    expect(decoded.userId).toBe('u1');
    expect(decoded.email).toBe('a@example.com');
  });

  it('expired token throws on verify', () => {
    const token = jwt.sign({ userId: 'u1' }, SECRET, { expiresIn: -1 });
    expect(() => jwt.verify(token, SECRET)).toThrow();
  });
});
