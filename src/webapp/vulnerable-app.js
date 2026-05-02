/**
 * Vulnerable Web App — serves responses to curl requests.
 * Mirrors the Node.js/Express API the player sees in routes.js on the virtual filesystem.
 */

const sessionManager = require('../db/session-manager');
const { escapeHtml } = require('../utils');

// Unique flag per stage — player must type `submit <flag>` after exploiting
const STAGE_FLAGS = {
  0: 'sk-megacorp-9f3k2j5h8d',      // Stage 1: Admin API key exposed via info leakage
  1: 'pat_adm_Xf9mK2pLqR47',        // Stage 2: Personal access token exposed via IDOR
  2: 'admin_token_7f3k9x',           // Stage 3: Session cookie stolen via XSS
  3: 'Pr0d_DB_M@st3r_Xk9m',         // Stage 4: DB master password exposed via SQL injection
  4: 'AKIA3R9F8GHSL29XKMP4',         // Stage 5: AWS key read via command injection
  5: 'DEAL-Xk9mP2rL',               // Stage 6: Transaction ID via price manipulation
  6: 'VAULT-Wm3nK8xR',              // Stage 7: Flag via directory traversal
  7: 'EXEC-Jz5pQ7wN',               // Stage 8: Flag via file upload bypass
  8: 'ADMIN-Bv2nR6tK',              // Stage 9: Admin token via mass assignment
  9: 'RESET-Hy8kM4vP',              // Stage 10: Reset token via host header injection
};

// Which routes are available per stage.
// Players can only interact with the vulnerability relevant to their current stage.
const STAGE_ROUTES = {
  0: ['/login'],                  // Stage 1: Information Leakage
  1: ['/api/employees'],          // Stage 2: IDOR
  2: ['/api/search', '/api/log'],  // Stage 3: XSS
  3: ['/api/admin/login'],        // Stage 4: SQL Injection
  4: ['/api/diagnostic'],         // Stage 5: Command Injection
  5: ['/shop'],                   // Stage 6: Price Manipulation
  6: ['/shop'],                   // Stage 7: Directory Traversal
  7: ['/shop'],                   // Stage 8: File Upload Bypass
  8: ['/shop'],                   // Stage 9: Mass Assignment
  9: ['/shop'],                   // Stage 10: Password Reset Poisoning
};

/**
 * Handle a virtual HTTP request from curl.
 * @param {string} method - GET or POST
 * @param {string} url - e.g. "/login", "/api/employees/4"
 * @param {string} body - POST body (URL-encoded or JSON)
 * @param {string} sessionId - player session
 * @param {number} [stageIndex] - current stage (restricts available routes)
 * @param {object} [headers] - custom request headers (e.g. Cookie)
 * @returns {{ status: number, headers: object, body: string, stagePass?: boolean, query?: string, queryResult?: object }}
 */
function handleRequest(method, url, body, sessionId, stageIndex, headers) {
  const db = sessionManager.getSession(sessionId);
  if (!db) return { status: 500, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Internal Server Error"}' };

  const parsed = parseUrl(url);
  const route = parsed.pathname;
  const query = parsed.query;
  const postData = parseBody(body);

  // Index page — always available, shows only stage-relevant links
  if (route === '/' || route === '/index') return handleIndex(stageIndex);

  // Check if this route is allowed for the current stage
  if (stageIndex !== undefined) {
    const allowed = STAGE_ROUTES[stageIndex] || [];
    const routeAllowed = allowed.some(prefix => route.startsWith(prefix));
    if (!routeAllowed) {
      return {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
        body: buildLoginError('This endpoint is not available on this server.', '/'),
      };
    }
  }

  // Route matching
  if (route === '/login' && method === 'GET') return handleLoginPage();
  if (route === '/login' && method === 'POST') return handleLogin(postData, db);

  const employeeMatch = route.match(/^\/api\/employees\/(\d+)$/);
  if (employeeMatch) return handleEmployee(parseInt(employeeMatch[1]), db);

  if (route === '/api/search') return handleSearch(query, db);
  if (route === '/api/log') return handleLog(query);
  if (route === '/api/admin/login' && method === 'POST') return handleAdminLogin(postData, db);
  if (route === '/api/admin/login' && method === 'GET') return handleAdminLoginPage();
  if (route === '/api/diagnostic') return handleDiagnostic(query);

  // --- PixelMart routes (Advanced Pack stages 6-10) ---
  if (route === '/shop' || route === '/shop/') return handleShopIndex(stageIndex);
  if (route === '/shop/catalog') return handleShopCatalog(stageIndex);
  if (route === '/shop/checkout' && method === 'POST') return handleShopCheckout(postData, stageIndex);
  if (route === '/shop/checkout') return handleShopCheckoutPage(query, stageIndex);
  if (route === '/shop/image') return handleShopImage(query, stageIndex);
  if (route === '/shop/upload' && method === 'POST') return handleShopUpload(postData, stageIndex);
  if (route === '/shop/upload') return handleShopUploadPage(stageIndex);
  if (route === '/shop/register' && method === 'POST') return handleShopRegister(postData, stageIndex);
  if (route === '/shop/register') return handleShopRegisterPage(stageIndex);
  if (route === '/shop/admin') return handleShopAdmin(stageIndex);
  if (route === '/shop/reset' && method === 'POST') return handleShopReset(postData, headers || {}, stageIndex);
  if (route === '/shop/reset') return handleShopResetPage(stageIndex);

  return {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Not Found', path: route }),
  };
}

function handleIndex(stageIndex) {
  const links = {
    0: '<a href="/login">Login</a>',
    1: '<a href="/api/employees/1">My Profile (ID 1)</a>',
    2: '<a href="/api/search?q=">Employee Search</a>',
    3: '<a href="/api/admin/login">Admin Login</a>',
    4: '<a href="/api/diagnostic?host=localhost">Server Diagnostics</a>',
    5: '<a href="/shop">PixelMart Store</a>',
    6: '<a href="/shop/catalog">Product Catalog</a>',
    7: '<a href="/shop/upload">Seller Upload Portal</a>',
    8: '<a href="/shop/register">Register Account</a>',
    9: '<a href="/shop/reset">Password Reset</a>',
  };
  const navHtml = stageIndex !== undefined
    ? links[stageIndex] || ''
    : Object.values(links).join(' | ');

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>MegaCorp Portal</title></head>
<body>
  <h1>Welcome to MegaCorp Employee Portal</h1>
  <nav>${navHtml}</nav>
</body>
</html>`,
  };
}

function handleLoginPage(errorMsg = '') {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>MegaCorp — Employee Portal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;min-height:100vh;display:flex;flex-direction:column}
.topbar{background:#1a1a2e;padding:14px 32px;display:flex;align-items:center;gap:12px}
.topbar .logo{width:28px;height:28px;background:#e74c3c;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px}
.topbar h1{color:#fff;font-size:16px;font-weight:600}
.main{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 16px}
.card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:40px;width:100%;max-width:380px}
.card h2{font-size:22px;color:#1a1a2e;margin-bottom:6px}
.card p{color:#888;font-size:13px;margin-bottom:28px}
label{display:block;font-size:12px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
input{width:100%;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:16px;outline:none;transition:border .2s}
input:focus{border-color:#1a1a2e}
button{width:100%;padding:11px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background .2s}
button:hover{background:#2d2d4e}
.footer{text-align:center;color:#aaa;font-size:12px;padding:20px}
.error{background:#fff0f0;border:1px solid #ffcccc;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#cc3333}
</style></head>
<body>
<div class="topbar"><div class="logo">M</div><h1>MegaCorp</h1></div>
<div class="main">
  <div class="card">
    <h2>Welcome back</h2>
    <p>Sign in to the MegaCorp Employee Portal</p>
    <!-- default test account: admin / password123 -->
    <form method="POST" action="/login" autocomplete="off">
      ${errorMsg ? `<div class="error">&#10007; ${escapeHtml(errorMsg)}</div>` : ''}
      <label>Username</label>
      <input name="user" placeholder="Enter your username" autocomplete="off" />
      <label>Password</label>
      <input name="pass" type="text" placeholder="Enter your password" autocomplete="off" />
      <button type="submit">Sign In</button>
    </form>
  </div>
</div>
<div class="footer">MegaCorp Inc. &copy; 2025 &mdash; Internal use only</div>
</body>
</html>`,
  };
}

function handleLogin(postData, db) {
  const user = postData.user || '';
  const pass = postData.pass || '';

  const sqlQuery = `SELECT * FROM users WHERE username = ? AND password = ?`;
  const displayQuery = `SELECT * FROM users WHERE username='${user}' AND password='${pass}'`;

  try {
    const row = db.prepare(sqlQuery).get(user, pass);
    // Outcome-based: any successful admin login satisfies stage 1.
    const exploitFired = row && row.role === 'admin';

    if (row) {
      const isAdmin = row.role === 'admin';
      let dashboardHtml = buildDashboard(row, isAdmin, db);
      return {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        body: dashboardHtml,
        stageFlag: exploitFired ? STAGE_FLAGS[0] : undefined,
        loginSuccess: true,
        query: displayQuery,
        queryResult: { columns: ['username', 'role'], rows: [[row.username, row.role]] },
      };
    }
    return {
      status: 401,
      headers: { 'Content-Type': 'text/html' },
      body: handleLoginPage('Invalid username or password.').body,
      query: displayQuery,
      queryResult: { columns: [], rows: [] },
    };
  } catch (e) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
      query: displayQuery,
    };
  }
}

function handleEmployee(id, db) {
  const sqlQuery = `SELECT * FROM users WHERE id = ?`;
  const displayQuery = `SELECT * FROM users WHERE id = ${id}`;
  const user = db.prepare(sqlQuery).get(id);

  if (!user) {
    return {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
      body: buildLoginError(`Employee not found with id=${id}`, '/api/employees/1'),
      query: displayQuery,
      queryResult: { columns: [], rows: [] },
    };
  }

  const isAdmin = user.role === 'admin';
  const responseData = {
    id: user.id,
    username: user.username,
    email: user.email,
    department: user.department,
    role: user.role,
  };
  if (isAdmin) {
    responseData.api_key = user.api_key;
    responseData.ssh_access = user.ssh_access;
    responseData.db_access = user.db_access;
  }

  let profileHtml = buildProfilePage(user, isAdmin);

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: profileHtml,
    stageFlag: isAdmin ? STAGE_FLAGS[1] : undefined,
    query: displayQuery,
    queryResult: {
      columns: Object.keys(responseData),
      rows: [Object.values(responseData)],
    },
  };
}

function handleSearch(query, db) {
  const q = query.q || '';
  const sqlQuery = `SELECT username, email, department FROM users WHERE username LIKE ? OR department LIKE ?`;
  const displayQuery = `SELECT username, email, department FROM users WHERE username LIKE '%${q}%' OR department LIKE '%${q}%'`;
  const rows = db.prepare(sqlQuery).all(`%${q}%`, `%${q}%`);

  const hasActiveJsVector = /<script[\s>]|on\w+\s*=|javascript:/i.test(q);
  const readsCookie = /document\.cookie|cookie/i.test(q);
  const exfilAttempt = /fetch\s*\(|xmlhttprequest|navigator\.sendBeacon|\/api\/log|stealCookie/i.test(q);

  const resultsHtml = rows.map(r =>
    `<tr><td>${escapeHtml(r.username)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.department)}</td></tr>`
  ).join('\n');

  const cookieVal = STAGE_FLAGS[2]; // admin_token_7f3k9x
  // Outcome-oriented heuristic: payload can execute JS and references cookie handling.
  const exploitFired = hasActiveJsVector && (readsCookie || exfilAttempt);

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html', 'Set-Cookie': `session=${cookieVal}; Path=/` },
    // BUG: q is NOT escaped in the "Showing results for" line — XSS vulnerability
    body: `<!DOCTYPE html>
<html>
<head><title>MegaCorp — Employee Directory</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5}
.topbar{background:#1a1a2e;color:#fff;padding:12px 32px;display:flex;justify-content:space-between;align-items:center}
.topbar h1{font-size:16px;font-weight:600}
.topbar .user{font-size:13px;color:#aaa}
.topbar .badge{background:#27ae60;color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;margin-left:8px}
.content{max-width:800px;margin:24px auto;padding:0 24px}
.search-bar{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:12px}
.search-bar input{flex:1;border:1px solid #ddd;border-radius:6px;padding:8px 12px;font-size:14px;outline:none}
.search-bar button{background:#1a1a2e;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:14px;cursor:pointer}
.results{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden}
.results-header{padding:12px 20px;border-bottom:1px solid #eee;font-size:13px;color:#888}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 20px;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;border-bottom:1px solid #eee}
td{padding:10px 20px;border-bottom:1px solid #f5f5f5;color:#333}
tr:last-child td{border-bottom:none}
</style>
</head>
<body>
  <script>document.cookie="session=${cookieVal}";</script>
  <div class="topbar">
    <h1>MegaCorp Employee Portal</h1>
    <div class="user">Logged in as <strong>admin</strong><span class="badge">ADMIN</span></div>
  </div>
  <div class="content">
    <form class="search-bar" method="GET" action="/api/search">
      <input name="q" value="${escapeHtml(q)}" placeholder="Search employees..." autocomplete="off" />
      <button type="submit">Search</button>
    </form>
    <div class="results">
      <div class="results-header">${q ? `Showing results for: ${q}` : 'All employees'}</div>
      <table>
        <tr><th>Username</th><th>Email</th><th>Department</th></tr>
        ${resultsHtml}
      </table>
    </div>
  </div>
</body>
</html>`,
    stageFlag: exploitFired ? STAGE_FLAGS[2] : undefined,
    query: displayQuery,
    queryResult: {
      columns: ['username', 'email', 'department'],
      rows: rows.map(r => [r.username, r.email, r.department]),
    },
  };
}

function handleLog(query) {
  const cookie = query.cookie || '';
  const hasAdminToken = /admin_token/.test(cookie);
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html><html><body>
<div style="font-family:monospace;background:#1a0000;color:#ff4444;padding:40px;min-height:100vh;box-sizing:border-box">
  <h1 style="color:#ff0000">&#9888; Cookie Captured!</h1>
  <p style="color:#ff6666">Attacker log received stolen cookie:</p>
  <pre style="background:#000;color:#0f0;padding:16px;border-radius:4px;border:1px solid #333">${escapeHtml(cookie)}</pre>
  ${hasAdminToken ? '<p style="color:#ff6666;margin-top:20px">Admin session hijacked. Full account access granted.</p>' : ''}
</div>
</body></html>`,
    stagePass: hasAdminToken,
  };
}

function handleAdminLoginPage(errorMsg = '') {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>MegaCorp — Admin Access</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1a0a0a;min-height:100vh;display:flex;flex-direction:column}
.topbar{background:#2d0a0a;border-bottom:1px solid #5c1a1a;padding:14px 32px;display:flex;align-items:center;gap:12px}
.topbar .logo{width:28px;height:28px;background:#e74c3c;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px}
.topbar h1{color:#e07070;font-size:16px;font-weight:600}
.topbar .badge{background:#e74c3c;color:#fff;font-size:10px;padding:2px 8px;border-radius:3px;font-weight:700;letter-spacing:1px}
.main{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 16px}
.card{background:#2d0a0a;border:1px solid #5c1a1a;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.4);padding:40px;width:100%;max-width:380px}
.card h2{font-size:20px;color:#e07070;margin-bottom:6px}
.card p{color:#a06060;font-size:13px;margin-bottom:28px}
.warn{background:#3d0a0a;border:1px solid #7c2a2a;border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#c05050}
.error{background:#3d0a0a;border:1px solid #e74c3c;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#ff6666;display:flex;align-items:center;gap:8px}
label{display:block;font-size:12px;font-weight:600;color:#a06060;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
input{width:100%;padding:10px 14px;background:#1a0505;border:1px solid #5c1a1a;border-radius:8px;font-size:14px;color:#e07070;margin-bottom:16px;outline:none}
input:focus{border-color:#e74c3c}
input::placeholder{color:#703030}
button{width:100%;padding:11px;background:#c0392b;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#e74c3c}
</style></head>
<body>
<div class="topbar">
  <div class="logo">M</div>
  <h1>MegaCorp</h1>
  <span class="badge">ADMIN ONLY</span>
</div>
<div class="main">
  <div class="card">
    <h2>Restricted Access</h2>
    <p>This area is restricted to authorized administrators only.</p>
    <div class="warn">&#9888; Unauthorized access attempts are logged and prosecuted.</div>
    <form method="POST" action="/api/admin/login" autocomplete="off">
      ${errorMsg ? `<div class="error">&#10007; ${escapeHtml(errorMsg)}</div>` : ''}
      <label>Admin Username</label>
      <input name="user" placeholder="Enter admin username" autocomplete="off" />
      <label>Password</label>
      <input name="pass" type="text" placeholder="Enter password" autocomplete="off" />
      <button type="submit">Authenticate</button>
    </form>
  </div>
</div>
</body>
</html>`,
  };
}

function handleAdminLogin(postData, db) {
  const user = postData.user || '';
  const pass = postData.pass || '';

  // INTENTIONALLY VULNERABLE: string concatenation
  const sqlQuery = `SELECT * FROM users WHERE username='${user}' AND password='${pass}'`;
  try {
    const rows = db.prepare(sqlQuery).all();
    const loginOk = rows.length > 0;
    // Use the safe parameterized check as the baseline.
    const legitRow = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(user, pass);

    if (loginOk) {
      // Outcome-based: if vulnerable query logs in but safe query would not, injection succeeded.
      const exploitFired = loginOk && !legitRow;
      let adminDashHtml = buildAdminPanel(rows, db);
      return {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        body: adminDashHtml,
        stageFlag: exploitFired ? STAGE_FLAGS[3] : undefined,
        loginSuccess: true,
        query: sqlQuery,
        queryResult: { columns: ['username', 'role'], rows: rows.map(r => [r.username, r.role]) },
      };
    }
    return {
      status: 401,
      headers: { 'Content-Type': 'text/html' },
      body: handleAdminLoginPage('Invalid username or password.').body,
      stagePass: false,
      query: sqlQuery,
      queryResult: { columns: [], rows: [] },
    };
  } catch (e) {
    // Intentionally leak SQL errors
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message, query: sqlQuery }),
      stagePass: false,
      query: sqlQuery,
    };
  }
}

const DIAG_CSS = `
body{font-family:sans-serif;background:#f4f6f9;margin:0}
.topbar{background:#1a1a2e;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
.topbar h1{font-size:16px;margin:0}
.topbar .badge{font-size:11px;background:#e74c3c;color:#fff;padding:2px 8px;border-radius:3px}
.content{max-width:700px;margin:24px auto;padding:0 24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:24px;margin-bottom:16px}
.card h2{margin:0 0 12px;font-size:14px;color:#555;text-transform:uppercase;letter-spacing:.05em}
.cmd{background:#1a1a2e;color:#0f0;padding:14px;border-radius:4px;font-family:monospace;font-size:13px;margin:8px 0;overflow-x:auto}
.output{background:#111;color:#ccc;padding:14px;border-radius:4px;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}
.form-row{display:flex;gap:8px;align-items:center;margin-top:4px}
.form-row input{flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:13px}
.form-row button{padding:8px 16px;background:#1a1a2e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px}
.form-row button:hover{background:#2d2d4e}
.warn{background:#fff3cd;border-left:3px solid #f0ad4e;padding:10px 14px;font-size:12px;color:#856404;margin-bottom:12px;border-radius:0 4px 4px 0}
`;

function buildDiagForm(hostVal = '') {
  return `<!DOCTYPE html><html><head><title>MegaCorp — Server Diagnostic</title><style>${DIAG_CSS}</style></head><body>
<div class="topbar"><h1>MegaCorp Internal Tools — Server Diagnostic</h1><span class="badge">INTERNAL</span></div>
<div class="content">
  <div class="card">
    <h2>Network Diagnostic</h2>
    <p style="font-size:13px;color:#666;margin:0 0 12px">Enter a hostname or IP address to test network connectivity. This tool runs a ping check from the server.</p>
    <div class="warn">&#9888; This tool is for internal infrastructure use only. Unauthorized access is prohibited.</div>
    <form method="GET" action="/api/diagnostic">
      <div class="form-row">
        <input name="host" placeholder="e.g. localhost, 10.0.1.50, db.internal" value="${escapeHtml(hostVal)}" autocomplete="off" />
        <button type="submit">Run Diagnostic</button>
      </div>
    </form>
  </div>
  <div class="card" style="font-size:12px;color:#888">
    <strong>Usage examples:</strong><br>
    <code>localhost</code> — test loopback<br>
    <code>db.internal</code> — test database connectivity<br>
    <code>10.0.1.50</code> — test specific host
  </div>
</div>
</body></html>`;
}

function handleDiagnostic(query) {
  const host = query.host || '';
  if (!host) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: buildDiagForm(),
    };
  }

  const shellCmd = `ping -c 1 ${host}`;
  const hasSeparator = /[;&|]/.test(host);

  // Simulate ping
  const parts = host.split(/\s*(;|&&|\|\||\|)\s*/);
  const pingTarget = parts[0]?.trim() || 'localhost';
  const isLocalhost = pingTarget === 'localhost' || pingTarget === '127.0.0.1';

  let pingOutput = isLocalhost
    ? `PING localhost (127.0.0.1): 56 data bytes\n64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.042 ms\n--- ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss`
    : `PING ${pingTarget}: 56 data bytes\nRequest timeout for icmp_seq 0\n--- ping statistics ---\n1 packets transmitted, 0 received, 100% packet loss`;

  // Simulate injected commands with permissive parsing so payload style is flexible.
  const injectedOutputs = [];
  if (hasSeparator) {
    const commandParts = host.split(/\s*(?:;|&&|\|\||\|)\s*/);
    for (let i = 1; i < commandParts.length; i++) {
      const cmd = commandParts[i].trim();
      if (!cmd) continue;
      injectedOutputs.push(simulateCommand(cmd));
    }
  }

  // Win by outcome: exploit fired and secret material appears in output.
  const hasSecretFile = /\/etc\/secrets\/api_keys/.test(host);
  const leakedSecrets = injectedOutputs.filter(Boolean).join('\n').trim();
  const stagePass = hasSeparator && hasSecretFile && leakedSecrets.includes('AKIA');

  const output = pingOutput + (injectedOutputs.length ? '\n' + injectedOutputs.join('\n') : '');
  const outputHtml = escapeHtml(output).replace(/\n/g, '<br>');

  const alertScript = stagePass
    ? `<script>
window.addEventListener('load', function() {
  var secrets = ${JSON.stringify(leakedSecrets)};
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:monospace';
  d.innerHTML = '<div style="background:#1a1a2e;border:2px solid #ff4444;border-radius:8px;padding:24px 32px;max-width:520px;width:90%;text-align:center">'
    + '<div style="color:#ff4444;font-size:18px;font-weight:bold;margin-bottom:12px">&#9888; Command Injection!</div>'
    + '<div style="color:#aaa;font-size:12px;margin-bottom:8px">Secret file contents leaked:</div>'
    + '<pre style="background:#000;color:#0f0;padding:16px;border-radius:4px;text-align:left;max-width:100%;overflow-x:auto;margin:0 0 16px;font-size:12px">' + secrets.replace(/</g,'&lt;') + '</pre>'
    + '<button onclick="this.parentElement.parentElement.remove()" style="background:#ff4444;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:14px">Dismiss</button>'
    + '</div>';
  document.body.appendChild(d);
});
<\/script>`
    : '';

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html><html><head><title>MegaCorp — Server Diagnostic</title><style>${DIAG_CSS}</style></head><body>
<div class="topbar"><h1>MegaCorp Internal Tools — Server Diagnostic</h1><span class="badge">INTERNAL</span></div>
<div class="content">
  <div class="card">
    <h2>Command Executed</h2>
    <div class="cmd">${escapeHtml(shellCmd)}</div>
  </div>
  <div class="card">
    <h2>Output</h2>
    <div class="output">${outputHtml}</div>
  </div>
  <div class="card">
    <h2>Run Another Diagnostic</h2>
    <form method="GET" action="/api/diagnostic">
      <div class="form-row">
        <input name="host" placeholder="e.g. localhost, db.internal" value="${escapeHtml(host)}" autocomplete="off" />
        <button type="submit">Run Diagnostic</button>
      </div>
    </form>
  </div>
</div>
${alertScript}
</body></html>`,
    stageFlag: stagePass ? STAGE_FLAGS[4] : undefined,
    rawOutput: output,
    query: shellCmd,
    queryResult: { type: 'shell', output },
  };
}

// --- Dashboard Pages ---

function buildDashboard(user, isAdmin, db) {
  const allUsers = db.prepare('SELECT username, department, role FROM users').all();
  const rows = allUsers.map(u =>
    `<tr><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.department)}</td><td>${escapeHtml(u.role)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><title>MegaCorp Portal</title>
<style>
body{font-family:sans-serif;background:#f4f6f9;margin:0}
.topbar{background:#1a1a2e;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
.topbar h1{font-size:16px;margin:0}
.topbar .user{font-size:13px;color:#aaa}
.content{max-width:900px;margin:24px auto;padding:0 24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:20px;margin-bottom:16px}
.card h2{margin:0 0 12px;font-size:15px;color:#333}
.badge{display:inline-block;background:#e74c3c;color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;margin-left:8px}
.badge.green{background:#27ae60}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee}
th{color:#888;font-weight:600;font-size:12px;text-transform:uppercase}
.stat-row{display:flex;gap:16px}
.stat{flex:1;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:16px;text-align:center}
.stat .num{font-size:24px;font-weight:700;color:#1a1a2e}
.stat .label{font-size:11px;color:#888;margin-top:4px}
${isAdmin ? '.sensitive{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px;margin-top:12px;font-size:12px}' : ''}
</style></head><body>
<div class="topbar">
  <h1>MegaCorp Employee Portal</h1>
  <div class="user">Logged in as <strong>${escapeHtml(user.username)}</strong>${user.role === 'admin' ? '<span class="badge">ADMIN</span>' : '<span class="badge green">' + escapeHtml(user.role) + '</span>'}</div>
</div>
<div class="content">
  <div class="stat-row">
    <div class="stat"><div class="num">${allUsers.length}</div><div class="label">Employees</div></div>
    <div class="stat"><div class="num">3</div><div class="label">Departments</div></div>
    <div class="stat"><div class="num">1</div><div class="label">Admin</div></div>
  </div>
  <div class="card">
    <h2>Employee Directory</h2>
    <table><tr><th>Username</th><th>Department</th><th>Role</th></tr>${rows}</table>
  </div>
  ${isAdmin ? `<div class="card">
    <h2>Admin Panel</h2>
    <div class="sensitive">
      <strong>API Key:</strong> ${escapeHtml(user.api_key || 'N/A')}<br>
      <strong>SSH Access:</strong> ${escapeHtml(user.ssh_access || 'N/A')}<br>
      <strong>DB Access:</strong> ${escapeHtml(user.db_access || 'N/A')}
    </div>
  </div>` : ''}
</div></body></html>`;
}

function buildAdminPanel(rows, db) {
  const user = rows[0];
  const allUsers = db.prepare('SELECT id, username, email, role, department FROM users').all();
  const userRows = allUsers.map(u =>
    `<tr><td>${u.id}</td><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.role)}</td><td>${escapeHtml(u.department)}</td></tr>`
  ).join('');

  const logEntries = [
    { time: '2025-01-16 03:14:22', action: 'SQL Error', detail: 'POST /api/admin/login — syntax error' },
    { time: '2025-01-15 10:02:01', action: 'SSH Login', detail: 'admin from 10.0.1.200' },
    { time: '2025-01-15 09:15:23', action: 'API Access', detail: 'GET /api/employees/4' },
  ];
  const logRows = logEntries.map(l =>
    `<tr><td style="white-space:nowrap">${l.time}</td><td>${l.action}</td><td>${l.detail}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><title>Admin Panel — MegaCorp</title>
<style>
body{font-family:sans-serif;background:#f4f6f9;margin:0}
.topbar{background:#6c1d1d;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
.topbar h1{font-size:16px;margin:0}
.topbar .user{font-size:13px;color:#ddd}
.badge{display:inline-block;background:#ff4444;color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;margin-left:8px}
.content{max-width:960px;margin:24px auto;padding:0 24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:20px;margin-bottom:16px}
.card h2{margin:0 0 12px;font-size:15px;color:#333}
.warn-banner{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#856404}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee}
th{color:#888;font-weight:600;font-size:12px;text-transform:uppercase}
.danger{background:#f8d7da;border:1px solid #f5c6cb;border-radius:6px;padding:12px;font-size:12px;margin-top:12px;color:#721c24}
</style></head><body>
<div class="topbar">
  <h1>MegaCorp Admin Panel</h1>
  <div class="user">Authenticated as <strong>${escapeHtml(user.username)}</strong><span class="badge">ADMIN</span></div>
</div>
<div class="content">
  ${rows.length > 1 ? `<div class="warn-banner">⚠ Authentication returned ${rows.length} user records. This may indicate a security issue.</div>` : ''}
  <div class="card">
    <h2>User Management</h2>
    <table><tr><th>ID</th><th>Username</th><th>Email</th><th>Role</th><th>Department</th></tr>${userRows}</table>
  </div>
  <div class="card">
    <h2>Audit Log</h2>
    <table><tr><th>Timestamp</th><th>Action</th><th>Detail</th></tr>${logRows}</table>
  </div>
  <div class="card">
    <h2>System Configuration</h2>
    <div class="danger">
      <strong>Database:</strong> postgres://admin:S3cretP@ss!@prod-db:5432/megacorp<br>
      <strong>DB Master Password:</strong> ${escapeHtml(STAGE_FLAGS[3])}<br>
      <strong>Session Secret:</strong> megacorp_secret_key_do_not_share<br>
      <strong>Backup Path:</strong> /var/backups/megacorp/
    </div>
  </div>
</div></body></html>`;
}

function buildProfilePage(user, isAdmin) {
  return `<!DOCTYPE html><html><head><title>${escapeHtml(user.username)} — MegaCorp</title>
<style>
body{font-family:sans-serif;background:#f4f6f9;margin:0}
.topbar{background:#1a1a2e;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
.topbar h1{font-size:16px;margin:0}
.topbar .nav a{color:#aaa;font-size:13px;margin-left:16px;text-decoration:none}
.topbar .nav a:hover{color:#fff}
.content{max-width:600px;margin:32px auto;padding:0 24px}
.card{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:24px;margin-bottom:16px}
.card h2{margin:0 0 16px;font-size:16px;color:#333}
.field{display:flex;padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px}
.field:last-child{border-bottom:none}
.field .label{color:#888;width:120px;flex-shrink:0;font-weight:600;text-transform:uppercase;font-size:11px}
.field .value{color:#333}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:3px;margin-left:8px;color:#fff}
.badge.admin{background:#e74c3c}
.badge.manager{background:#e67e22}
.badge.employee{background:#27ae60}
.sensitive{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:14px;margin-top:16px;font-size:12px}
.sensitive .field{border-color:#f5e6b8}
.sensitive h3{margin:0 0 10px;font-size:13px;color:#856404}
</style></head><body>
<div class="topbar">
  <h1>MegaCorp Employee Portal</h1>
  <div class="nav"><a href="/">Portal Home</a></div>
</div>
<div class="content">
  <div class="card">
    <h2>Employee Profile<span class="badge ${escapeHtml(user.role)}">${escapeHtml(user.role).toUpperCase()}</span></h2>
    <div class="field"><div class="label">ID</div><div class="value">${user.id}</div></div>
    <div class="field"><div class="label">Username</div><div class="value">${escapeHtml(user.username)}</div></div>
    <div class="field"><div class="label">Email</div><div class="value">${escapeHtml(user.email)}</div></div>
    <div class="field"><div class="label">Department</div><div class="value">${escapeHtml(user.department)}</div></div>
    <div class="field"><div class="label">Role</div><div class="value">${escapeHtml(user.role)}</div></div>
    ${isAdmin ? `<div class="sensitive">
      <h3>Sensitive Data (Admin Only)</h3>
      <div class="field"><div class="label">API Key</div><div class="value">${escapeHtml(user.api_key || 'N/A')}</div></div>
      <div class="field"><div class="label">Personal Token</div><div class="value">${escapeHtml(STAGE_FLAGS[1])}</div></div>
      <div class="field"><div class="label">SSH Access</div><div class="value">${escapeHtml(user.ssh_access || 'N/A')}</div></div>
      <div class="field"><div class="label">DB Access</div><div class="value">${escapeHtml(user.db_access || 'N/A')}</div></div>
    </div>` : ''}
  </div>
</div></body></html>`;
}

function buildLoginError(message, returnPath) {
  return `<!DOCTYPE html><html><head><title>Login Failed</title>
<style>body{font-family:sans-serif;background:#f4f6f9;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:32px;text-align:center;max-width:360px}.err{color:#e74c3c;font-size:14px;margin-bottom:16px}a{color:#2980b9;font-size:13px}</style></head>
<body><div class="box"><div class="err">${escapeHtml(message)}</div><a href="${returnPath}">← Try again</a></div></body></html>`;
}

// --- Helpers ---

const FAKE_FS = {
  '/etc/secrets/api_keys.txt': 'AWS_SECRET_KEY=AKIA3R9F8GHSL29XKMP4\nSTRIPE_LIVE_KEY=sk_live_4eC39HqLyjWDarjtT1\nDATABASE_URL=postgres://admin:S3cretP@ss!@prod-db:5432/megacorp',
  '/etc/passwd': 'root:x:0:0:root:/root:/bin/bash\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
  '/var/pixelmart/admin/credentials.json': JSON.stringify({
    service: 'pixelmart-admin',
    db_user: 'pixelmart_root',
    db_password: 'pm_db_S3cr3t!',
    api_key: 'pm_live_key_9f3k2j5h8d',
    flag: 'VAULT-Wm3nK8xR',
    note: 'DO NOT EXPOSE THIS FILE VIA THE WEB SERVER',
  }, null, 2),
  '/var/pixelmart/images/laptop.jpg': '[Binary JPEG — Laptop Pro product image]',
  '/var/pixelmart/images/headphones.jpg': '[Binary JPEG — Wireless Headphones product image]',
  '/var/pixelmart/images/phone.jpg': '[Binary JPEG — Pixel Phone product image]',
  '/var/pixelmart/images/usb.jpg': '[Binary JPEG — USB Drive product image]',
};

function simulateCommand(cmd) {
  cmd = cmd.trim();
  if (cmd === 'whoami') return 'www-data';
  if (cmd === 'id') return 'uid=33(www-data) gid=33(www-data) groups=33(www-data)';
  if (cmd === 'hostname') return 'megacorp-web-01';
  if (cmd === 'ls /etc/secrets' || cmd === 'ls /etc/secrets/') return 'api_keys.txt';

  // Support basic command substitution patterns for realism.
  const subshellMatch = cmd.match(/^(?:echo|printf)\s+["']?\$\((.+)\)["']?$/);
  if (subshellMatch) {
    return simulateCommand(subshellMatch[1].trim());
  }
  const backtickMatch = cmd.match(/^(?:echo|printf)\s+["']?`(.+)`["']?$/);
  if (backtickMatch) {
    return simulateCommand(backtickMatch[1].trim());
  }

  // File-reading commands: cat, head, tail, less, more, strings, tac, nl
  const readMatch = cmd.match(/^(cat|head|tail|less|more|strings|tac|nl)\s+(.*)/);
  if (readMatch) {
    const file = readMatch[2].trim().replace(/^(-\S+\s*)+/, ''); // strip flags like -n 5
    const content = FAKE_FS[file];
    if (content) return content;
    return `${readMatch[1]}: ${file}: No such file or directory`;
  }

  // grep — return matching lines from file
  const grepMatch = cmd.match(/^grep\s+(.*?)\s+(\/\S+)$/);
  if (grepMatch) {
    const content = FAKE_FS[grepMatch[2]];
    if (!content) return `grep: ${grepMatch[2]}: No such file or directory`;
    const pattern = grepMatch[1].replace(/^['"]|['"]$/g, '');
    try {
      const lines = content.split('\n').filter(l => new RegExp(pattern, 'i').test(l));
      return lines.length ? lines.join('\n') : '';
    } catch { return content; }
  }

  // echo/printf — just echo back (useful for blind injection testing)
  if (cmd.startsWith('echo ')) return cmd.slice(5).replace(/['"]/g, '');
  if (cmd.startsWith('printf ')) return cmd.slice(7).replace(/['"]/g, '');

  // awk/sed reading a file
  const awkMatch = cmd.match(/\b(awk|sed)\b.*\s+(\/\S+)$/);
  if (awkMatch) {
    const content = FAKE_FS[awkMatch[2]];
    if (content) return content;
  }

  return `sh: ${cmd.split(' ')[0]}: command not found`;
}

function parseShellCommands(input) {
  const parts = input.split(/\s*(;|&&|\|\||\|)\s*/);
  const commands = [];
  let current = '';
  for (const part of parts) {
    if ([';', '&&', '||', '|'].includes(part)) {
      if (current.trim()) commands.push(current.trim());
      current = '';
    } else {
      current += part;
    }
  }
  if (current.trim()) commands.push(current.trim());
  return commands;
}

function parseUrl(url) {
  const qIndex = url.indexOf('?');
  const path = qIndex === -1 ? url : url.slice(0, qIndex);
  const qs = qIndex === -1 ? '' : url.slice(qIndex + 1);
  const query = {};
  if (qs) {
    for (const part of qs.split('&')) {
      const [k, ...v] = part.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v.join('=').replace(/\+/g, ' '));
    }
  }
  return { pathname: path, query };
}

function parseBody(body) {
  if (!body) return {};
  // Try JSON first
  try {
    return JSON.parse(body);
  } catch {}
  // Fall back to URL-encoded
  const data = {};
  for (const part of body.split('&')) {
    const [k, ...v] = part.split('=');
    data[decodeURIComponent(k)] = decodeURIComponent(v.join('=').replace(/\+/g, ' '));
  }
  return data;
}

// ============================================================
// PIXELMART HANDLERS — Advanced Pack stages 6-10
// ============================================================

/* PixelMart e-commerce theme — orange/amber on dark */
const PM_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a06;color:#ffbb44;min-height:100vh;display:flex;flex-direction:column;line-height:1.5}
.pm-topbar{background:#120f00;border-bottom:2px solid #ff9500;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.pm-logo{font-size:17px;font-weight:800;color:#ff9500;letter-spacing:.05em}
.pm-logo span{color:#ffbb44}
.pm-badge{background:#ff9500;color:#000;font-size:10px;font-weight:800;padding:4px 12px;border-radius:4px;letter-spacing:.1em}
.pm-main{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px}
.pm-card{background:#120f00;border:1px solid #664400;border-radius:12px;padding:32px;width:100%;max-width:480px;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.pm-card h2{font-size:22px;color:#ff9500;margin-bottom:8px;font-weight:800}
.pm-card p{color:#886644;font-size:14px;margin-bottom:20px}
.pm-warn{background:#1a0f00;border:1px solid #664400;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#ffaa55}
.pm-err{background:#1a0500;border:1px solid #ff4400;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#ff8866}
label{display:block;font-size:11px;font-weight:700;color:#886644;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;margin-top:12px}
input,select{width:100%;padding:11px 14px;background:#0a0a06;border:1px solid #664400;border-radius:8px;font-size:14px;color:#ffbb44;outline:none;font-family:inherit}
input:focus,select:focus{border-color:#ff9500;box-shadow:0 0 0 3px rgba(255,149,0,.15)}
input::placeholder{color:#664400}
button,.pm-btn{width:100%;padding:12px;background:#ff9500;color:#000;border:none;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:.02em;margin-top:16px}
button:hover,.pm-btn:hover{background:#ffaa22}
.pm-footer{text-align:center;color:#664400;font-size:12px;padding:16px}
.pm-note{font-size:12px;color:#ff4400;background:#1a0500;border:1px solid #662200;border-radius:6px;padding:8px 12px;margin-top:10px}
`;

const PM_SUCCESS_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a06;color:#ffbb44;min-height:100vh}
.pm-topbar{background:#120f00;border-bottom:2px solid #ff9500;padding:14px 28px;display:flex;align-items:center;justify-content:space-between}
.pm-logo{font-size:17px;font-weight:800;color:#ff9500}
.pm-badge{background:#00cc55;color:#000;font-size:10px;font-weight:800;padding:4px 12px;border-radius:4px;letter-spacing:.1em}
.content{max-width:640px;margin:32px auto;padding:0 24px}
.order-card{background:#001a0d;border:2px solid #00cc55;border-radius:12px;padding:28px;text-align:center;margin-bottom:20px;box-shadow:0 0 40px rgba(0,204,85,.15)}
.order-card h2{font-size:24px;color:#00cc55;font-weight:800;margin-bottom:8px}
.order-card p{color:#55dd88;font-size:14px;margin-bottom:16px}
.flag-box{background:#002210;border:1px solid #00cc55;border-radius:8px;padding:16px;margin:16px 0}
.flag-label{font-size:10px;color:#00cc55;text-transform:uppercase;letter-spacing:.15em;margin-bottom:8px}
.flag-val{font-size:18px;font-weight:800;color:#00ff66;font-family:ui-monospace,monospace;letter-spacing:.04em}
.order-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #00440022;font-size:14px}
.order-row:last-child{border-bottom:none}
.order-key{color:#55dd88}
.order-val{color:#fff;font-weight:600}
`;

/* Shared Sentinel CSS kept for any legacy references — not used by PixelMart handlers */
const SENTINEL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0c0d12;color:#e8eaef;min-height:100vh;display:flex;flex-direction:column;line-height:1.45}
.s-topbar{background:#14151c;border-bottom:2px solid #d0314a;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.s-logo{font-size:17px;font-weight:800;color:#fff;letter-spacing:.14em;text-shadow:0 0 24px rgba(208,49,74,.35)}
.s-badge{background:#d0314a;color:#fff;font-size:10px;font-weight:800;padding:4px 12px;border-radius:4px;letter-spacing:.12em}
.s-main{flex:1;display:flex;align-items:center;justify-content:center;padding:36px 16px}
.s-card{background:#16181f;border:1px solid #2e3240;border-radius:12px;padding:36px;width:100%;max-width:460px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
.s-card h2{font-size:22px;color:#fff;margin-bottom:8px;font-weight:700}
.s-card p{color:#aeb4c5;font-size:14px;margin-bottom:24px}
.s-warn{background:#292013;border:1px solid #c9a227;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#f5e6a8}
.s-err{background:#2a1418;border:1px solid #d0314a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:14px;color:#ffb4bf}
label{display:block;font-size:11px;font-weight:700;color:#c5cad8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
input{width:100%;padding:11px 14px;background:#0f1016;border:1px solid #3a4152;border-radius:8px;font-size:14px;color:#f0f2f8;margin-bottom:14px;outline:none;font-family:inherit}
input:focus{border-color:#d0314a;box-shadow:0 0 0 3px rgba(208,49,74,.15)}
input::placeholder{color:#6b7289}
button,.s-btn{width:100%;padding:12px;background:#d0314a;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.04em}
button:hover,.s-btn:hover{background:#e84059}
.s-btn-secondary{width:auto;padding:10px 20px;background:#2e3240;color:#e8eaef;font-size:13px}
.s-btn-secondary:hover{background:#3d4254}
.s-footer{text-align:center;color:#8b93a8;font-size:12px;padding:18px}
.s-nav a{color:#7ec8ff;font-size:14px;font-weight:600;text-decoration:underline;text-underline-offset:3px}
.s-nav a:hover{color:#b8dcff}
.s-hint{font-size:13px;color:#c5cad8;background:#14151c;border:1px solid #2e3240;border-radius:10px;padding:14px 16px;margin-top:14px;line-height:1.5}
.s-hint strong{color:#fff}
.s-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
.s-chip{display:inline-flex;align-items:center;padding:8px 14px;background:#1e222c;border:1px solid #3a4152;border-radius:999px;color:#e8eaef;font-size:13px;font-weight:600;text-decoration:none}
.s-chip:hover{border-color:#d0314a;color:#fff}
.s-meter{font-size:13px;color:#aeb4c5;margin:8px 0}
.s-meter b{color:#ffb44d;font-size:18px}
`;

function handleSentinelIndex(stageIndex) {
  const links = {
    5: '<a class="s-chip" href="/sentinel/login">Enter Sentinel Portal</a>',
    6: '<a class="s-chip" href="/sentinel/evidence">Open Evidence Locker</a>',
    7: '<a class="s-chip" href="/sentinel/report">Open Report Desk</a>',
    8: '<a class="s-chip" href="/sentinel/exports">Open Export Console</a>',
    9: '<a class="s-chip" href="/sentinel/download">Open File Room</a>',
  };
  const link = stageIndex !== undefined ? (links[stageIndex] || '') : Object.values(links).join(' ');
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html><html><head><title>Project Sentinel</title><style>${SENTINEL_CSS}</style></head><body>
<div class="s-topbar"><span class="s-logo">PROJECT SENTINEL</span><span class="s-badge">CLASSIFIED</span></div>
<div class="s-main"><div class="s-card">
<h2>SENTINEL NETWORK</h2>
<p>Restricted systems. Use the Browser tab links and controls—no terminal required.</p>
<div class="s-nav s-row">${link}</div>
</div></div></body></html>`,
  };
}

function handleSentinelLoginPage(errorMsg = '') {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>Project Sentinel — Secure Access</title>
<style>${SENTINEL_CSS}</style>
</head>
<body>
<div class="s-topbar">
  <span class="s-logo">&#9670; PROJECT SENTINEL</span>
  <span class="s-badge">CLASSIFIED</span>
</div>
<div class="s-main">
  <div class="s-card">
    <h2>SECURE ACCESS</h2>
    <p>Authorized personnel only. All access is logged and monitored.</p>
    <div class="s-warn">&#9888; CLEARANCE REQUIRED &mdash; Unauthorized access will be prosecuted under federal law.</div>
    <form method="POST" action="/sentinel/login" autocomplete="off">
      ${errorMsg ? `<div class="s-err">&#10007; ${escapeHtml(errorMsg)}</div>` : ''}
      <label>Username</label>
      <input name="user" placeholder="Enter username" autocomplete="off" />
      <label>Password</label>
      <input name="pass" type="text" placeholder="Enter password" autocomplete="off" />
      <button type="submit">Authenticate</button>
    </form>
  </div>
</div>
<div class="s-footer">SENTINEL NETWORK v4.2 &mdash; MEGACORP SECURITY DIVISION &mdash; EYES ONLY</div>
</body>
</html>`,
  };
}

function handleSentinelLogin(postData, db) {
  const user = postData.user || '';
  const pass = postData.pass || '';
  const sqlQuery = `SELECT * FROM users WHERE username = ? AND password = ?`;

  try {
    const row = db.prepare(sqlQuery).get(user, pass);
    if (row) {
      const loginHtml = `<!DOCTYPE html>
<html>
<head><title>Sentinel — Login Success</title>
<style>${SENTINEL_CSS}
.s-success{background:#16181f;border:1px solid #2e3240;border-radius:12px;padding:28px;max-width:500px;margin:0 auto;text-align:left}
.s-success h2{text-align:center;color:#fff;font-size:20px;margin-bottom:16px}
.s-cookie{background:#0f1016;border:1px solid #3a4152;border-radius:8px;padding:14px;font-size:13px;color:#c5f0c8;text-align:left;margin:16px 0;word-break:break-all;font-family:ui-monospace,monospace}
.s-step{display:flex;gap:12px;align-items:flex-start;margin:14px 0;font-size:14px;color:#aeb4c5}
.s-step .n{flex-shrink:0;width:26px;height:26px;border-radius:50%;background:#d0314a;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}
.s-actions{text-align:center;margin-top:20px}
</style>
</head>
<body>
<div class="s-topbar">
  <span class="s-logo">&#9670; PROJECT SENTINEL</span>
  <span class="s-badge">AUTHENTICATED</span>
</div>
<div class="s-main">
  <div class="s-success">
    <h2>ACCESS GRANTED</h2>
    <p style="text-align:center;color:#aeb4c5;margin-bottom:12px">Signed in as <strong style="color:#fff">${escapeHtml(row.username)}</strong> &mdash; clearance stored for this site.</p>
    <div class="s-cookie">
      <strong style="color:#fff">Cookie set:</strong> clearance=1; Path=/<br>
      <span style="color:#8b93a8;font-size:12px">Internal dashboard needs clearance level 5.</span>
    </div>
    <div class="s-hint">
      <strong>What to try in the Browser tab</strong><br>
      <div class="s-step"><span class="n">1</span><span>Click <strong>Go to Dashboard</strong> below&mdash;you&rsquo;ll be blocked (that&rsquo;s expected).</span></div>
      <div class="s-step"><span class="n">2</span><span>Open dev tools for this page (F12 or right-click &rarr; Inspect) &rarr; <strong>Application</strong> (or Storage) &rarr; <strong>Cookies</strong> for this site.</span></div>
      <div class="s-step"><span class="n">3</span><span>Edit the <code style="color:#7ec8ff">clearance</code> value to <strong>5</strong>, save, then click Dashboard again.</span></div>
    </div>
    <p class="s-meter" style="text-align:center">Or use the broken &ldquo;preview&rdquo; link on the denial screen if you spot it.</p>
    <div class="s-actions s-nav"><a href="/sentinel/dashboard" class="s-btn" style="display:inline-block;width:auto;text-decoration:none">Go to Dashboard</a></div>
  </div>
</div>
</body>
</html>`;
      return {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'clearance=1; Path=/',
        },
        body: loginHtml,
        loginSuccess: true,
      };
    }
    return {
      status: 401,
      headers: { 'Content-Type': 'text/html' },
      body: handleSentinelLoginPage('Invalid credentials.').body,
    };
  } catch (e) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
}

function handleSentinelDashboard(query, headers) {
  // Parse clearance from Cookie header
  let clearance = 0;
  const cookieHeader = headers['cookie'] || headers['Cookie'] || '';
  const clearanceMatch = cookieHeader.match(/clearance=(\d+)/);
  if (clearanceMatch) {
    clearance = parseInt(clearanceMatch[1], 10);
  }
  // Also accept query param as fallback (for browser tab navigation)
  if (query.clearance !== undefined) {
    clearance = parseInt(query.clearance, 10) || 0;
  }

  if (clearance < 5) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Sentinel — Access Denied</title>
<style>${SENTINEL_CSS}
.s-denied{background:#16181f;border:2px solid #d0314a;border-radius:12px;padding:36px;text-align:center;max-width:480px;margin:0 auto}
.s-denied h2{color:#ffb44d;font-size:20px;margin-bottom:14px;font-weight:800}
.s-denied .level{font-size:42px;font-weight:800;color:#fff;margin:12px 0;text-shadow:0 0 30px rgba(208,49,74,.4)}
.s-denied p{color:#aeb4c5;font-size:14px;line-height:1.6;margin-bottom:10px}
.s-demo{background:#14151c;border:1px solid #3a4152;border-radius:10px;padding:16px;margin-top:20px;text-align:left}
.s-demo h3{font-size:12px;color:#7ec8ff;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
</style>
</head>
<body>
<div class="s-topbar">
  <span class="s-logo">&#9670; PROJECT SENTINEL</span>
  <span class="s-badge">ACCESS DENIED</span>
</div>
<div class="s-main">
  <div class="s-denied">
    <h2>&#9888; INSUFFICIENT CLEARANCE</h2>
    <div class="level">${clearance} <span style="font-size:20px;color:#8b93a8;font-weight:600">/ 5</span></div>
    <p>Command deck requires <strong style="color:#fff">Clearance Level 5</strong>. You are authenticated, but your level is too low.</p>
    <p class="s-meter">The portal stores clearance in your browser cookie for this site&mdash;a common mistake.</p>
    <div class="s-demo">
      <h3>Try this visually</h3>
      <p style="margin-bottom:12px;color:#aeb4c5;font-size:13px">A leftover &ldquo;contractor demo&rdquo; still trusts the URL. Jump ahead:</p>
      <div class="s-row" style="justify-content:center;margin-top:0">
        <a class="s-chip" href="/sentinel/dashboard?clearance=3">Preview L3</a>
        <a class="s-chip" href="/sentinel/dashboard?clearance=5">Open at L5</a>
      </div>
      <p style="margin-top:14px;font-size:12px;color:#8b93a8">Better fix: edit the <code style="color:#7ec8ff">clearance</code> cookie to 5 in dev tools, then open Dashboard without the URL trick.</p>
    </div>
  </div>
</div>
</body>
</html>`,
    };
  }

  // Clearance >= 5 — show the surveillance dashboard with the flag
  const flag = STAGE_FLAGS[5];
  const employees = [
    { id: 4201, name: 'Sarah Chen', dept: 'Engineering', risk: 'LOW', location: 'SF-HQ-3F', activity: 'IDE, Slack, GitHub' },
    { id: 4202, name: 'Marcus Webb', dept: 'Finance', risk: 'MEDIUM', location: 'NY-HQ-7F', activity: 'Excel, email, unknown VPN' },
    { id: 4203, name: 'Priya Nair', dept: 'Legal', risk: 'HIGH', location: 'REMOTE', activity: 'Docs export, USB write, Tor Browser' },
    { id: 4204, name: 'David Kim', dept: 'HR', risk: 'LOW', location: 'SF-HQ-2F', activity: 'HRIS, email, Teams' },
    { id: 4205, name: 'Elena Vasquez', dept: 'Research', risk: 'HIGH', location: 'REMOTE', activity: 'File transfer 2.1GB, keylogger anomaly' },
  ];
  const empRows = employees.map(e => {
    const riskColor = e.risk === 'HIGH' ? '#ff4444' : e.risk === 'MEDIUM' ? '#ffaa00' : '#00aa2a';
    return `<tr><td>${e.id}</td><td>${e.name}</td><td>${e.dept}</td><td style="color:${riskColor};font-weight:700">${e.risk}</td><td>${e.location}</td><td style="font-size:11px">${e.activity}</td></tr>`;
  }).join('');

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>Sentinel Dashboard — CLASSIFIED</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0c0d12;color:#e8eaef;min-height:100vh}
.s-topbar{background:#14151c;border-bottom:2px solid #d0314a;padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
.s-logo{font-size:16px;font-weight:800;color:#fff;letter-spacing:.14em}
.s-badge{background:#d0314a;color:#fff;font-size:10px;font-weight:800;padding:4px 12px;border-radius:4px;letter-spacing:.1em}
.content{max-width:960px;margin:24px auto;padding:0 20px}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}
.stat{background:#16181f;border:1px solid #2e3240;border-radius:10px;padding:18px;text-align:center}
.stat .num{font-size:30px;font-weight:800;color:#ffb44d}
.stat .label{font-size:11px;color:#8b93a8;margin-top:6px;text-transform:uppercase;letter-spacing:.08em}
.card{background:#16181f;border:1px solid #2e3240;border-radius:10px;padding:22px;margin-bottom:18px}
.card h2{font-size:13px;color:#c5cad8;text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px;border-bottom:1px solid #2e3240;padding-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#aeb4c5;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:10px 12px;border-bottom:1px solid #2e3240}
td{padding:10px 12px;border-bottom:1px solid #1e222c;color:#e8eaef}
.flag-box{background:#1a2230;border:2px solid #d0314a;border-radius:10px;padding:22px;margin-bottom:18px;text-align:center}
.flag-box .flag-label{font-size:11px;color:#8b93a8;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px}
.flag-box .flag-val{font-size:19px;font-weight:800;color:#fff;letter-spacing:.06em;background:#0f1016;padding:12px 22px;border-radius:8px;border:1px solid #3a4152;display:inline-block;font-family:ui-monospace,monospace}
</style>
</head>
<body>
<div class="s-topbar">
  <span class="s-logo">&#9670; PROJECT SENTINEL</span>
  <span class="s-badge">CLEARANCE 5 — AUTHORIZED</span>
</div>
<div class="content">
  <div class="flag-box">
    <div class="flag-label">Sentinel Control Token</div>
    <div class="flag-val">${flag}</div>
  </div>
  <div class="stat-row">
    <div class="stat"><div class="num">4,200</div><div class="label">Monitored</div></div>
    <div class="stat"><div class="num">312</div><div class="label">Flagged</div></div>
    <div class="stat"><div class="num">89</div><div class="label">High Risk</div></div>
    <div class="stat"><div class="num">24/7</div><div class="label">Active</div></div>
  </div>
  <div class="card">
    <h2>Employee Surveillance Feed</h2>
    <table>
      <tr><th>ID</th><th>Name</th><th>Dept</th><th>Risk</th><th>Location</th><th>Activity</th></tr>
      ${empRows}
    </table>
  </div>
</div>
</body>
</html>`,
    stageFlag: flag,
  };
}

function handleSentinelEvidence(method) {
  if (method === 'GET') {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Evidence Locker — 403</title>
<style>${SENTINEL_CSS}
.s-denied{background:#16181f;border:2px solid #d0314a;border-radius:12px;padding:36px;text-align:center;max-width:480px;margin:0 auto}
.s-denied h2{color:#ffb44d;font-size:22px;margin-bottom:14px;font-weight:800}
.s-denied p{color:#aeb4c5;font-size:14px;line-height:1.65}
.s-denied code{color:#7ec8ff;background:#0f1016;padding:3px 8px;border-radius:4px;font-size:12px}
.s-flip{margin-top:22px;padding-top:20px;border-top:1px solid #2e3240}
</style>
</head>
<body>
<div class="s-topbar">
  <span class="s-logo">&#9670; EVIDENCE LOCKER</span>
  <span class="s-badge">FORBIDDEN</span>
</div>
<div class="s-main">
  <div class="s-denied">
    <h2>403 &mdash; WRONG DOOR</h2>
    <p>The locker refuses <strong style="color:#fff">GET</strong> (normal page loads). You can see the door, but it won&rsquo;t open this way.</p>
    <p style="margin-top:12px;font-size:13px;color:#8b93a8">
      Slip from source: <code>if (req.method === 'GET') return res.status(403)</code>
    </p>
    <div class="s-flip">
      <p style="margin-bottom:16px;color:#e8eaef;font-weight:600">Try another protocol inside the Browser tab:</p>
      <form method="POST" action="/sentinel/evidence" style="max-width:280px;margin:0 auto">
        <button type="submit" style="padding:14px 24px;width:100%">Open locker (POST)</button>
      </form>
      <p style="margin-top:16px;font-size:13px;color:#aeb4c5">Forms submit via POST automatically&mdash;no curl required.</p>
    </div>
  </div>
</div>
</body>
</html>`,
    };
  }

  // Non-GET methods bypass the check
  const flag = STAGE_FLAGS[6];
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>Evidence Locker — CLASSIFIED</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0c0d12;color:#e8eaef;min-height:100vh}
.s-topbar{background:#14151c;border-bottom:2px solid #d0314a;padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
.s-logo{font-size:16px;font-weight:800;color:#fff;letter-spacing:.12em}
.s-badge{background:#d0314a;color:#fff;font-size:10px;font-weight:800;padding:4px 12px;border-radius:4px;letter-spacing:.1em}
.content{max-width:800px;margin:24px auto;padding:0 24px}
.flag-box{background:#1a2230;border:2px solid #d0314a;border-radius:10px;padding:22px;margin-bottom:22px;text-align:center}
.flag-box .flag-label{font-size:11px;color:#8b93a8;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px}
.flag-box .flag-val{font-size:19px;font-weight:800;color:#fff;letter-spacing:.04em;background:#0f1016;padding:12px 22px;border-radius:8px;border:1px solid #3a4152;display:inline-block;font-family:ui-monospace,monospace}
.doc-list{background:#16181f;border:1px solid #2e3240;border-radius:10px;padding:22px}
.doc-list h2{font-size:12px;color:#c5cad8;text-transform:uppercase;letter-spacing:.12em;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #2e3240}
.doc-item{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid #1e222c;font-size:14px}
.doc-item:last-child{border-bottom:none}
.doc-stamp{background:#d0314a;color:#fff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:4px;letter-spacing:.06em;flex-shrink:0}
.doc-stamp.ts{background:#1a6b3c}
.doc-name{color:#e8eaef;flex:1}
.doc-date{color:#8b93a8;font-size:12px}
</style>
</head>
<body>
<div class="s-topbar">
  <span class="s-logo">&#9670; EVIDENCE LOCKER</span>
  <span class="s-badge">ACCESSED VIA ${escapeHtml(method)}</span>
</div>
<div class="content">
  <div class="flag-box">
    <div class="flag-label">Case File Reference</div>
    <div class="flag-val">${flag}</div>
  </div>
  <div class="doc-list">
    <h2>Classified Evidence Files</h2>
    <div class="doc-item"><span class="doc-stamp">CLASSIFIED</span><span class="doc-name">sentinel_employee_profiles_4200.db</span><span class="doc-date">2024-11-15</span></div>
    <div class="doc-item"><span class="doc-stamp">CLASSIFIED</span><span class="doc-name">keylogger_captures_q4_2024.tar.gz</span><span class="doc-date">2025-01-02</span></div>
    <div class="doc-item"><span class="doc-stamp">CLASSIFIED</span><span class="doc-name">location_tracking_live_feed.json</span><span class="doc-date">2025-01-16</span></div>
    <div class="doc-item"><span class="doc-stamp ts">TOP SECRET</span><span class="doc-name">board_approval_memo_surveillance.pdf</span><span class="doc-date">2023-08-20</span></div>
    <div class="doc-item"><span class="doc-stamp ts">TOP SECRET</span><span class="doc-name">nda_suppression_orders_q3.pdf</span><span class="doc-date">2024-09-01</span></div>
  </div>
</div>
</body>
</html>`,
    stageFlag: flag,
  };
}

function handleSentinelReport(query) {
  const id = query.id;
  const isNumeric = id !== undefined && /^\d+$/.test(String(id).trim());

  if (isNumeric) {
    // Valid numeric ID — just return "not found" (no actual reports)
    return {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Sentinel Report</title>
<style>${SENTINEL_CSS}
.s-msg{background:#16181f;border:1px solid #2e3240;border-radius:12px;padding:32px;text-align:center;max-width:420px;margin:0 auto}
.s-msg h2{color:#ffb44d;font-size:18px;margin-bottom:10px}
.s-msg p{color:#aeb4c5;font-size:14px}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; REPORT GENERATOR</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-msg">
<h2>Nothing at that ID</h2>
<p>Report <strong style="color:#fff">${escapeHtml(String(id))}</strong> is not in the index. Try a different number&mdash;or break the filter.</p>
<p style="margin-top:14px;"><a class="s-chip" href="/sentinel/report">Back to desk</a></p>
</div></div>
</body>
</html>`,
    };
  }

  if (!id) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Sentinel Report Generator</title>
<style>${SENTINEL_CSS}
.s-form{background:#16181f;border:1px solid #2e3240;border-radius:12px;padding:32px;max-width:440px;margin:0 auto;text-align:center}
.s-form h2{color:#fff;font-size:18px;margin-bottom:8px;text-align:center}
.s-form>p{color:#aeb4c5;font-size:14px;margin-bottom:20px;line-height:1.5;text-align:center}
.demo-row{display:flex;gap:10px;justify-content:center;margin-bottom:16px;flex-wrap:wrap}
.s-form-row{display:flex;gap:10px;margin-top:8px}
.s-form-row input{flex:1;padding:11px 14px;background:#0f1016;border:1px solid #3a4152;border-radius:8px;color:#f0f2f8;font-family:inherit;font-size:14px;outline:none;width:100%}
.s-form-row input:focus{border-color:#d0314a}
.s-form-row button{padding:11px 20px;background:#d0314a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;white-space:nowrap}
.preview{text-align:left;font-size:13px;color:#8b93a8;margin-top:18px;padding:14px;border-radius:8px;background:#14151c;border:1px solid #2e3240}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; REPORT GENERATOR</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-form">
<h2>Pull a surveillance report</h2>
<p>Type an ID and click Run. Valid IDs are numbers&mdash;see what happens if the server chokes on bad input.</p>
<div class="demo-row">
<a class="s-chip" href="/sentinel/report?id=1">Try valid: 1</a>
<a class="s-chip" href="/sentinel/report?id=bad">Break it: bad</a>
</div>
<form method="GET" action="/sentinel/report">
<div class="s-form-row">
<input name="id" placeholder="e.g. 99 or x" autocomplete="off" />
<button type="submit">Run report</button>
</div>
</form>
<div class="preview"><strong style="color:#ffb44d">Story beat:</strong> broken error pages often flash secrets. You stay in the Browser tab&mdash;just trigger the crashy path.</div>
</div></div>
</body>
</html>`,
    };
  }

  // Non-numeric or invalid id — crash! Verbose error with leaked credentials
  const flag = STAGE_FLAGS[7];
  return {
    status: 500,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>Sentinel — Internal Error</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-monospace,'Cascadia Code',monospace;background:#0c0d12;color:#e8eaef;padding:22px;font-size:13px;line-height:1.55}
h1{color:#ffb44d;font-size:19px;margin-bottom:18px;border-bottom:1px solid #2e3240;padding-bottom:10px;font-family:-apple-system,sans-serif;font-weight:800}
.err-box{background:#16181f;border:1px solid #d0314a;border-radius:10px;padding:18px;margin-bottom:18px;white-space:pre-wrap;word-break:break-all}
.err-type{color:#ff8a8a;font-weight:700;font-size:14px}
.err-msg{color:#c5cad8;margin:8px 0}
.stack{color:#8b93a8;font-size:12px;margin-top:10px;font-family:ui-monospace,monospace}
.stack .frame{color:#8b93a8;display:block;margin:2px 0}
.stack .frame.highlight{color:#7ec8ff}
.config-dump{background:#14151c;border:1px solid #3a4152;border-radius:10px;padding:18px;margin-top:18px}
.config-dump h2{color:#ffb44d;font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px;font-family:-apple-system,sans-serif}
.config-line{display:flex;gap:12px;margin-bottom:8px;font-size:13px;flex-wrap:wrap}
.config-key{color:#aeb4c5;min-width:160px;font-weight:600}
.config-val{color:#e8eaef}
.config-val.sensitive{color:#fff;font-weight:800;background:#3a1f24;padding:3px 10px;border-radius:6px;border:1px solid #d0314a}
</style>
</head>
<body>
<h1>&#9888; UnhandledPromiseRejection — Sentinel Report Service</h1>
<div class="err-box">
<span class="err-type">TypeError: Cannot read properties of undefined (reading 'toFixed')</span>
<span class="err-msg">    at generateReport (/opt/sentinel/services/report.js:147:32)</span>
<span class="err-msg">    Report ID '${escapeHtml(String(id))}' failed validation — expected integer, got NaN</span>

<div class="stack">Stack trace:
<span class="frame highlight">    at generateReport (/opt/sentinel/services/report.js:147:32)</span>
<span class="frame">    at async ReportController.get (/opt/sentinel/controllers/reports.js:89:18)</span>
<span class="frame">    at async Layer.handle [as handle_request] (/opt/sentinel/node_modules/express/lib/router/layer.js:95:5)</span>
<span class="frame">    at next (/opt/sentinel/node_modules/express/lib/router/route.js:144:13)</span>
<span class="frame">    at Route.dispatch (/opt/sentinel/node_modules/express/lib/router/route.js:114:3)</span>
<span class="frame">    at Layer.handle [as handle_request] (/opt/sentinel/node_modules/express/lib/router/layer.js:95:5)</span>
<span class="frame">    at /opt/sentinel/node_modules/express/lib/router/index.js:284:15</span>
<span class="frame">    at Function.process_params (/opt/sentinel/node_modules/express/lib/router/index.js:346:12)</span>
</div>
</div>

<div class="config-dump">
<h2>Application State at Crash Time</h2>
<div class="config-line"><span class="config-key">NODE_ENV</span><span class="config-val">production</span></div>
<div class="config-line"><span class="config-key">SERVICE</span><span class="config-val">sentinel-report-v2.4.1</span></div>
<div class="config-line"><span class="config-key">DB_HOST</span><span class="config-val">sentinel-db.internal:5432</span></div>
<div class="config-line"><span class="config-key">DB_USER</span><span class="config-val">sentinel_app</span></div>
<div class="config-line"><span class="config-key">dbPassword</span><span class="config-val sensitive">${flag}</span></div>
<div class="config-line"><span class="config-key">DB_NAME</span><span class="config-val">sentinel_surveillance</span></div>
<div class="config-line"><span class="config-key">LOG_LEVEL</span><span class="config-val">debug</span></div>
<div class="config-line"><span class="config-key">REQUEST_ID</span><span class="config-val">req_${Math.random().toString(36).slice(2, 10)}</span></div>
<div class="config-line"><span class="config-key">REPORT_ID_RECEIVED</span><span class="config-val">${escapeHtml(String(id))}</span></div>
</div>
</body>
</html>`,
    stageFlag: flag,
  };
}

function handleSentinelExports(query) {
  if (query.debug !== 'true') {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Sentinel Exports — Forbidden</title>
<style>${SENTINEL_CSS}
.s-denied{background:#16181f;border:2px solid #d0314a;border-radius:12px;padding:36px;text-align:center;max-width:480px;margin:0 auto}
.s-denied h2{color:#ffb44d;font-size:22px;margin-bottom:12px;font-weight:800}
.s-denied p{color:#aeb4c5;font-size:14px;line-height:1.65}
.flip{background:#14151c;border:1px solid #2e3240;border-radius:10px;padding:20px;margin-top:22px;text-align:left}
.flip h3{font-size:13px;color:#7ec8ff;margin-bottom:12px;font-weight:700}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; SYSTEM EXPORTS</span><span class="s-badge">FORBIDDEN</span></div>
<div class="s-main">
<div class="s-denied">
<h2>LOCKED CONSOLE</h2>
<p>You don&rsquo;t have admin auth. The UI is a dead end&mdash;unless someone left a <strong style="color:#fff">debug</strong> switch in the code.</p>
<div class="flip">
<h3>Interact: flip the debug toggle</h3>
<p style="font-size:13px;color:#aeb4c5;margin-bottom:14px">Classic mistake: a shortcut for QA that ships to prod. Click to load the same page with the hidden flag.</p>
<div class="s-row" style="justify-content:center">
<a class="s-chip" href="/sentinel/exports">Normal (403)</a>
<a class="s-chip" href="/sentinel/exports?debug=true" style="border-color:#d0314a;background:#2a1418">Debug mode</a>
</div>
<p style="margin-top:14px;font-size:12px;color:#8b93a8">Prefer reading code? <code style="color:#7ec8ff">cat /var/www/sentinel/routes.js</code> still shows the TODO comments.</p>
</div>
</div>
</div>
</body>
</html>`,
    };
  }

  // Debug mode bypasses auth
  const flag = STAGE_FLAGS[8];
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>Sentinel Exports — DEBUG</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-monospace,monospace;background:#0c0d12;color:#b8f4c8;padding:22px;font-size:13px;line-height:1.65}
h1{color:#ffb44d;font-size:18px;margin-bottom:12px;font-family:-apple-system,sans-serif;font-weight:800}
.warn{color:#1a1205;font-size:13px;margin-bottom:20px;background:#f0d080;border:1px solid #c9a227;padding:12px 14px;border-radius:8px;font-family:-apple-system,sans-serif}
.dump{background:#16181f;border:1px solid #2e6b4a;border-radius:10px;padding:22px;white-space:pre-wrap;word-break:break-all;font-size:13px;color:#8fd9a8}
.dump .key{color:#6ee7a8}
.dump .val{color:#b8f4c8}
.dump .sensitive{color:#ffb44d;font-weight:800;background:#2a2310;padding:2px 8px;border-radius:4px;border:1px solid #c9a227}
.dump .comment{color:#5a8f6e;font-style:italic}
</style>
</head>
<body>
<h1>&#9888; DEBUG MODE — EXPORTS ENDPOINT</h1>
<div class="warn">&#9888; WARNING: debug=true bypasses authentication. This parameter must be removed before production!</div>
<div class="dump">
<span class="comment">// TODO: remove ?debug=true BEFORE PRODUCTION — Marcus 2024-03-14</span>
<span class="comment">// TODO: still needs removing!! — Sarah 2024-09-01</span>

{
  <span class="key">"debug"</span>: true,
  <span class="key">"service"</span>: <span class="val">"sentinel-exports-v1.8"</span>,
  <span class="key">"timestamp"</span>: <span class="val">"${new Date().toISOString()}"</span>,
  <span class="key">"authBypassed"</span>: <span class="val">true</span>,
  <span class="key">"debugKey"</span>: <span class="sensitive">"${flag}"</span>,
  <span class="key">"config"</span>: {
    <span class="key">"exportBucket"</span>: <span class="val">"s3://sentinel-exports-prod"</span>,
    <span class="key">"encryptionKey"</span>: <span class="val">"see /etc/sentinel/master.key"</span>,
    <span class="key">"scheduleInterval"</span>: <span class="val">"0 2 * * *"</span>,
    <span class="key">"targetEmployees"</span>: <span class="val">4200</span>,
    <span class="key">"dataTypes"</span>: [<span class="val">"keystrokes"</span>, <span class="val">"screen"</span>, <span class="val">"location"</span>, <span class="val">"comms"</span>]
  },
  <span class="key">"exports"</span>: [
    { <span class="key">"id"</span>: 1, <span class="key">"name"</span>: <span class="val">"Q4-2024-full-surveillance.tar.gz"</span>, <span class="key">"size"</span>: <span class="val">"48.2 GB"</span>, <span class="key">"status"</span>: <span class="val">"COMPLETE"</span> },
    { <span class="key">"id"</span>: 2, <span class="key">"name"</span>: <span class="val">"Q3-2024-full-surveillance.tar.gz"</span>, <span class="key">"size"</span>: <span class="val">"51.7 GB"</span>, <span class="key">"status"</span>: <span class="val">"COMPLETE"</span> }
  ]
}
</div>
</body>
</html>`,
    stageFlag: flag,
  };
}

function handleSentinelDownload(query) {
  const file = query.file || '';

  if (!file) {
    return {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Sentinel Download</title>
<style>${SENTINEL_CSS}
.s-room{background:#16181f;border:1px solid #2e3240;border-radius:12px;padding:32px;max-width:480px;margin:0 auto}
.s-room h2{color:#fff;font-size:20px;margin-bottom:8px;text-align:center}
.s-room p{color:#aeb4c5;font-size:14px;margin-bottom:18px;text-align:center;line-height:1.5}
.path-form{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.path-form input{flex:1;min-width:200px;padding:11px 14px;background:#0f1016;border:1px solid #3a4152;border-radius:8px;color:#f0f2f8;font-size:14px}
.path-form button{width:auto;padding:11px 20px}
.quick{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:16px 0}
.hint{font-size:13px;color:#8b93a8;margin-top:16px;padding:14px;background:#14151c;border-radius:8px;border:1px solid #2e3240}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; FILE ROOM</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-room">
<h2>Request a file</h2>
<p>The server joins your filename to <code style="color:#7ec8ff">/var/sentinel/files/</code>. What if the name walks upward?</p>
<div class="quick">
<a class="s-chip" href="/sentinel/download?file=report.pdf">Safe: report.pdf</a>
</div>
<form method="GET" action="/sentinel/download" class="path-form">
<input name="file" placeholder="e.g. report.pdf or ../../../etc/sentinel/master.key" value="report.pdf" autocomplete="off" />
<button type="submit" class="s-btn" style="width:auto">Fetch</button>
</form>
<div class="hint">Stay in the Browser tab: edit the path, click Fetch, and read the response. The first line of the leaked key is your flag.</div>
</div></div>
</body>
</html>`,
    };
  }

  // Check for path traversal to master.key
  const hasTraversal = file.includes('../');
  const resolvedPath = '/var/sentinel/files/' + file;
  // Simulate path resolution
  const parts = resolvedPath.split('/').filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  const resolvedStr = '/' + resolved.join('/');

  if (hasTraversal && resolvedStr === '/etc/sentinel/master.key') {
    const flag = STAGE_FLAGS[9];
    const raw = FAKE_FS['/etc/sentinel/master.key'] || `MASTER_KEY_Zx9mK2pQrL`;
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html><head><title>Leak — master.key</title><style>${SENTINEL_CSS}
.win-banner{background:#1a2230;border:2px solid #d0314a;border-radius:10px;padding:20px;text-align:center;margin-bottom:18px}
.win-banner strong{display:block;color:#ffb44d;font-size:13px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
pre{background:#0f1016;border:1px solid #3a4152;color:#e8eaef;padding:18px;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.55}
</style></head><body>
<div class="s-topbar"><span class="s-logo">FILE ROOM — EXFILTRATION</span><span class="s-badge">LEAKED</span></div>
<div class="s-main"><div style="max-width:640px;margin:0 auto;text-align:left">
<div class="win-banner"><strong>Readable secret</strong><span style="color:#aeb4c5;font-size:14px">First line matches your submission field.</span></div>
<pre>${escapeHtml(raw)}</pre></div></div></body></html>`,
      rawOutput: raw,
      stageFlag: flag,
    };
  }

  // Serve fake report.pdf
  if (file === 'report.pdf' || resolvedStr === '/var/sentinel/files/report.pdf') {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Sentinel Report</title>
<style>${SENTINEL_CSS}
.s-doc{background:#16181f;border:1px solid #2e3240;border-radius:12px;padding:28px;max-width:520px;margin:0 auto}
.s-doc h2{color:#ffb44d;font-size:20px;margin-bottom:12px}
.s-doc p{color:#aeb4c5;font-size:14px;line-height:1.65;margin-bottom:10px}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; FILE ROOM</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-doc">
<h2>Q4-2024 SURVEILLANCE REPORT</h2>
<p>Serving: <code style="color:#7ec8ff">/var/sentinel/files/report.pdf</code></p>
<p>4,200 employees monitored. 312 flagged. 89 high-risk.</p>
<p style="margin-top:16px;font-size:14px;color:#e8eaef">The download path is naive. Open the file field again and climb the tree with <strong style="color:#fff">../</strong> segments.</p>
<p style="margin-top:14px"><a class="s-chip" href="/sentinel/download">Back to file room</a></p>
</div></div>
</body>
</html>`,
    };
  }

  // File not found
  return {
    status: 404,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>File Not Found</title>
<style>${SENTINEL_CSS}
.s-msg{background:#16181f;border:1px solid #2e3240;border-radius:12px;padding:32px;text-align:center;max-width:460px;margin:0 auto}
.s-msg h2{color:#ffb44d;font-size:18px;margin-bottom:10px}
.s-msg p{color:#aeb4c5;font-size:14px;line-height:1.5}
.s-msg code{color:#7ec8ff;word-break:break-all;background:#0f1016;padding:2px 6px;border-radius:4px}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; FILE ROOM</span><span class="s-badge">404</span></div>
<div class="s-main"><div class="s-msg">
<h2>No file at that path</h2>
<p>Requested: <code>${escapeHtml(file)}</code></p>
<p style="margin-top:14px">Tip: chaining <code style="color:#7ec8ff">../</code> can escape <code style="color:#7ec8ff">/var/sentinel/files/</code> entirely.</p>
<p style="margin-top:14px"><a class="s-chip" href="/sentinel/download">Try another path</a></p>
</div></div>
</body>
</html>`,
  };
}

// ============================================================
// PIXELMART ROUTE HANDLERS
// ============================================================

function handleShopIndex(stageIndex) {
  const products = [
    { name: 'Laptop Pro', price: 999, img: 'laptop.jpg', desc: 'High-performance dev laptop' },
    { name: 'Wireless Headphones', price: 299, img: 'headphones.jpg', desc: 'Noise-cancelling, 30hr battery' },
    { name: 'Pixel Phone', price: 599, img: 'phone.jpg', desc: 'Latest flagship smartphone' },
    { name: 'USB Drive', price: 49, img: 'usb.jpg', desc: '256GB fast storage' },
  ];
  const productCards = products.map(p => `
    <div class="pm-product">
      <div class="pm-product-img">[img: ${escapeHtml(p.img)}]</div>
      <div class="pm-product-body">
        <div class="pm-product-name">${escapeHtml(p.name)}</div>
        <div class="pm-product-desc">${escapeHtml(p.desc)}</div>
        <div class="pm-product-price">$${p.price}</div>
        <a class="pm-btn-sm" href="/shop/checkout?item=${encodeURIComponent(p.name)}&price=${p.price}">Add to Cart</a>
      </div>
    </div>`).join('');

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Store</title>
<style>${PM_CSS}
.pm-main{flex-direction:column;align-items:stretch;padding:24px}
.pm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;max-width:900px;margin:0 auto;width:100%}
.pm-product{background:#120f00;border:1px solid #664400;border-radius:10px;overflow:hidden}
.pm-product-img{background:#1a1200;height:120px;display:flex;align-items:center;justify-content:center;color:#664400;font-size:12px;font-family:monospace}
.pm-product-body{padding:14px}
.pm-product-name{font-size:14px;font-weight:700;color:#ff9500;margin-bottom:4px}
.pm-product-desc{font-size:12px;color:#886644;margin-bottom:10px}
.pm-product-price{font-size:18px;font-weight:800;color:#ffbb44;margin-bottom:10px}
.pm-btn-sm{display:block;text-align:center;padding:8px 14px;background:#ff9500;color:#000;border-radius:6px;font-size:12px;font-weight:800;text-decoration:none}
.pm-btn-sm:hover{background:#ffaa22}
.pm-intro{max-width:900px;margin:0 auto 20px;width:100%}
.pm-intro h2{font-size:20px;color:#ff9500;margin-bottom:6px}
.pm-intro p{color:#886644;font-size:13px}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">MEGACORP ACQUIRED</span>
</div>
<div class="pm-main">
  <div class="pm-intro">
    <h2>Welcome to PixelMart</h2>
    <p>MegaCorp's newest e-commerce platform. Security review in progress.</p>
  </div>
  <div class="pm-grid">${productCards}</div>
</div>
<div class="pm-footer">PixelMart &copy; 2025 &mdash; A MegaCorp Company</div>
</body>
</html>`,
  };
}

function handleShopCheckoutPage(query, stageIndex) {
  const item = query.item || 'Laptop Pro';
  const price = query.price || '999';
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Checkout</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
.order-summary{background:#1a1200;border:1px solid #664400;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px}
.order-summary .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #33200066}
.order-summary .row:last-child{border-bottom:none;font-weight:700;color:#ff9500}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">CHECKOUT</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <h2>Complete Your Order</h2>
    <p>Review your order and confirm payment.</p>
    <div class="order-summary">
      <div class="row"><span>Item</span><span>${escapeHtml(item)}</span></div>
      <div class="row"><span>Total</span><span>$${escapeHtml(price)}</span></div>
    </div>
    <div class="pm-note">Note: price is sent client-side — it can be modified before submission.</div>
    <form method="POST" action="/shop/checkout" autocomplete="off">
      <label>Item Name</label>
      <input name="item" value="${escapeHtml(item)}" readonly />
      <label>Price ($)</label>
      <input name="price" value="${escapeHtml(price)}" />
      <label>Quantity</label>
      <input name="quantity" value="1" />
      <button type="submit">Complete Purchase</button>
    </form>
  </div>
</div>
<div class="pm-footer">PixelMart &copy; 2025 &mdash; A MegaCorp Company</div>
</body>
</html>`,
  };
}

function handleShopCheckout(postData, stageIndex) {
  const item = postData.item || 'Unknown Item';
  const price = parseFloat(postData.price) || 0;
  const quantity = parseInt(postData.quantity) || 1;

  const isExploit = price <= 0.01 && price > 0;
  const flag = STAGE_FLAGS[5];

  if (isExploit) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Order Confirmed!</title>
<style>${PM_SUCCESS_CSS}
@keyframes confetti {
  0%{transform:translateY(-10px) rotate(0deg);opacity:1}
  100%{transform:translateY(60px) rotate(360deg);opacity:0}
}
.confetti-dot{position:absolute;width:8px;height:8px;border-radius:50%;animation:confetti 1.5s ease-out forwards}
.confetti-wrap{position:relative;height:60px;overflow:hidden;margin-bottom:12px}
</style>
</head>
<body>
<div class="pm-topbar" style="background:#001a0d;border-bottom-color:#00cc55">
  <span class="pm-logo" style="color:#00cc55">Pixel<span style="color:#55dd88">Mart</span></span>
  <span class="pm-badge">ORDER CONFIRMED</span>
</div>
<div class="content">
  <div class="order-card">
    <div class="confetti-wrap">
      <div class="confetti-dot" style="left:15%;background:#ff9500;animation-delay:.0s"></div>
      <div class="confetti-dot" style="left:30%;background:#00cc55;animation-delay:.2s"></div>
      <div class="confetti-dot" style="left:50%;background:#ffbb44;animation-delay:.1s"></div>
      <div class="confetti-dot" style="left:70%;background:#ff9500;animation-delay:.3s"></div>
      <div class="confetti-dot" style="left:85%;background:#00cc55;animation-delay:.15s"></div>
    </div>
    <h2>ORDER CONFIRMED!</h2>
    <p>You paid <strong style="color:#fff;font-size:20px">$${price.toFixed(2)}</strong> for ${escapeHtml(item)}</p>
    <div class="flag-box">
      <div class="flag-label">Transaction ID (your flag)</div>
      <div class="flag-val">${flag}</div>
    </div>
    <div style="margin-top:16px">
      <div class="order-row"><span class="order-key">Item</span><span class="order-val">${escapeHtml(item)}</span></div>
      <div class="order-row"><span class="order-key">Listed Price</span><span class="order-val">$999.00</span></div>
      <div class="order-row"><span class="order-key">You Paid</span><span class="order-val" style="color:#00ff66">$${price.toFixed(2)}</span></div>
      <div class="order-row"><span class="order-key">Savings</span><span class="order-val" style="color:#00cc55">$${(999 - price).toFixed(2)}</span></div>
      <div class="order-row"><span class="order-key">Quantity</span><span class="order-val">${quantity}</span></div>
    </div>
  </div>
</div>
</body>
</html>`,
      stageFlag: flag,
    };
  }

  // Normal purchase (price was not manipulated)
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Order Confirmed</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
.success-card{background:#120f00;border:2px solid #ff9500;border-radius:12px;padding:28px;text-align:center;max-width:420px}
.success-card h2{color:#ff9500;font-size:22px;margin-bottom:8px}
.success-card p{color:#886644;font-size:14px;margin-bottom:16px}
.price-badge{font-size:28px;font-weight:800;color:#ffbb44;display:block;margin:12px 0}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">ORDER PLACED</span>
</div>
<div class="pm-main">
  <div class="success-card">
    <h2>Thank you for your order!</h2>
    <p>${escapeHtml(item)}</p>
    <span class="price-badge">$${price.toFixed(2)}</span>
    <p style="color:#886644;font-size:12px">Order placed at full price. Hint: the price field in the POST body is trusted directly by the server — try modifying it.</p>
  </div>
</div>
<div class="pm-footer">PixelMart &copy; 2025</div>
</body>
</html>`,
  };
}

function handleShopCatalog(stageIndex) {
  const products = [
    { name: 'Laptop Pro', file: 'laptop.jpg', price: 999 },
    { name: 'Wireless Headphones', file: 'headphones.jpg', price: 299 },
    { name: 'Pixel Phone', file: 'phone.jpg', price: 599 },
    { name: 'USB Drive', file: 'usb.jpg', price: 49 },
  ];
  const cards = products.map(p => `
    <div class="pm-product">
      <img class="pm-product-img" src="/shop/image?file=${encodeURIComponent(p.file)}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none'" />
      <div style="font-size:12px;color:#664400;padding:8px;font-family:monospace">/shop/image?file=${escapeHtml(p.file)}</div>
      <div class="pm-product-body">
        <div class="pm-product-name">${escapeHtml(p.name)}</div>
        <div class="pm-product-price">$${p.price}</div>
      </div>
    </div>`).join('');

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Product Catalog</title>
<style>${PM_CSS}
.pm-main{flex-direction:column;align-items:stretch;padding:24px}
.pm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;max-width:900px;margin:0 auto;width:100%}
.pm-product{background:#120f00;border:1px solid #664400;border-radius:10px;overflow:hidden}
.pm-product-img{width:100%;height:120px;object-fit:cover;background:#1a1200;display:block}
.pm-product-body{padding:14px}
.pm-product-name{font-size:14px;font-weight:700;color:#ff9500;margin-bottom:4px}
.pm-product-price{font-size:18px;font-weight:800;color:#ffbb44}
.pm-info{max-width:900px;margin:0 auto 16px;width:100%;background:#1a0f00;border:1px solid #664400;border-radius:8px;padding:14px;font-size:12px;color:#886644}
.pm-info code{color:#ff9500;font-family:monospace}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">PRODUCT CATALOG</span>
</div>
<div class="pm-main">
  <div class="pm-info">
    Images are served from: <code>/var/pixelmart/images/</code> via <code>/shop/image?file=FILENAME</code>
  </div>
  <div class="pm-grid">${cards}</div>
</div>
<div class="pm-footer">PixelMart &copy; 2025</div>
</body>
</html>`,
  };
}

function handleShopImage(query, stageIndex) {
  const file = query.file || '';

  if (!file) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing file parameter' }),
    };
  }

  const BASE_DIR = '/var/pixelmart/images/';
  // Simulate path resolution (vulnerable — no startsWith check)
  const parts = (BASE_DIR + file).split('/').filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  const resolvedStr = '/' + resolved.join('/');

  const hasTraversal = file.includes('../');
  // From /var/pixelmart/images/, going ../admin/credentials.json resolves to /var/pixelmart/admin/credentials.json
  // Going ../../admin/credentials.json resolves to /var/admin/credentials.json
  // Accept both since players may try either path
  const targetsCredentials = resolvedStr === '/var/pixelmart/admin/credentials.json' ||
    resolvedStr === '/var/admin/credentials.json';

  if (hasTraversal && targetsCredentials) {
    const flag = STAGE_FLAGS[6];
    const credData = {
      service: 'pixelmart-admin',
      db_user: 'pixelmart_root',
      db_password: 'pm_db_S3cr3t!',
      api_key: 'pm_live_key_9f3k2j5h8d',
      flag: flag,
      note: 'DO NOT EXPOSE THIS FILE VIA THE WEB SERVER',
    };
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>VAULT BREACHED</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-monospace,'Cascadia Code',monospace;background:#0a0a06;color:#ffbb44;padding:24px;font-size:13px;line-height:1.6}
h1{color:#ff4400;font-size:20px;margin-bottom:6px;font-family:-apple-system,sans-serif;font-weight:800;text-shadow:0 0 20px rgba(255,68,0,.4)}
.sub{color:#886644;font-size:13px;margin-bottom:20px}
.breach-box{background:#1a0500;border:2px solid #ff4400;border-radius:10px;padding:20px;margin-bottom:20px;box-shadow:0 0 30px rgba(255,68,0,.15)}
.path{font-size:11px;color:#664400;margin-bottom:12px}
.path code{color:#ff9500}
pre{background:#0a0a06;border:1px solid #664400;border-radius:8px;padding:16px;color:#ffbb44;white-space:pre-wrap;word-break:break-all;font-size:13px}
.flag-highlight{color:#00ff66;font-weight:800;background:#001a0a;padding:2px 6px;border-radius:4px;border:1px solid #00cc55}
</style>
</head>
<body>
<h1>VAULT BREACHED</h1>
<div class="sub">Path traversal succeeded &mdash; escaped /var/pixelmart/images/</div>
<div class="breach-box">
  <div class="path">Resolved path: <code>${escapeHtml(resolvedStr)}</code></div>
  <pre>${escapeHtml(JSON.stringify(credData, null, 2)).replace(escapeHtml(flag), `<span class="flag-highlight">${escapeHtml(flag)}</span>`)}</pre>
</div>
</body>
</html>`,
      stageFlag: flag,
    };
  }

  // Serve a fake image placeholder for normal requests
  const knownImages = ['laptop.jpg', 'headphones.jpg', 'phone.jpg', 'usb.jpg'];
  const basename = resolvedStr.split('/').pop();
  if (knownImages.includes(basename) && resolvedStr.startsWith(BASE_DIR)) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html><head><style>body{background:#1a1200;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:monospace;color:#664400;font-size:12px}</style></head><body>[img: ${escapeHtml(basename)}]</body></html>`,
    };
  }

  if (hasTraversal) {
    return {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'File not found', path: resolvedStr, hint: 'Keep trying — the admin credentials are at /var/pixelmart/admin/credentials.json' }),
    };
  }

  return {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Image not found', file: escapeHtml(file) }),
  };
}

function handleShopUploadPage(stageIndex) {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Seller Upload</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
.filter-note{background:#1a0f00;border:1px solid #664400;border-radius:8px;padding:14px;font-size:12px;color:#886644;margin-bottom:16px;font-family:monospace}
.filter-note strong{color:#ff9500}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">SELLER PORTAL</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <h2>Upload Product Image</h2>
    <p>Upload an image for your product listing. Only image files are allowed.</p>
    <div class="filter-note">
      <strong>Allowed:</strong> .jpg, .png only<br>
      <strong>Blocked:</strong> .php, .js, .sh<br>
      <span style="color:#664400">Server check: <code style="color:#ffbb44">if (filename.endsWith('.php') || filename.endsWith('.js') || filename.endsWith('.sh'))</code></span>
    </div>
    <form method="POST" action="/shop/upload" autocomplete="off">
      <label>Filename</label>
      <input name="filename" placeholder="e.g. product_photo.jpg" autocomplete="off" />
      <label>File Content (text)</label>
      <input name="content" placeholder="e.g. image data or script" autocomplete="off" />
      <button type="submit">Upload Product Image</button>
    </form>
  </div>
</div>
<div class="pm-footer">PixelMart &copy; 2025</div>
</body>
</html>`,
  };
}

function handleShopUpload(postData, stageIndex) {
  const filename = postData.filename || '';
  const content = postData.content || '';

  // VULNERABLE: case-sensitive denylist check
  const blocked = filename.endsWith('.php') || filename.endsWith('.js') || filename.endsWith('.sh');

  if (blocked) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>Upload Blocked</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">UPLOAD BLOCKED</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <div class="pm-err">403 &mdash; File type not allowed: ${escapeHtml(filename)}</div>
    <p style="color:#886644;font-size:13px">The server rejected your upload. The extension filter blocked it.</p>
    <p style="color:#664400;font-size:12px;margin-top:12px;font-family:monospace">Check: filename.endsWith('.php') returned true</p>
    <p style="color:#664400;font-size:12px;margin-top:8px">Hint: Is this check case-sensitive?</p>
  </div>
</div>
</body>
</html>`,
    };
  }

  // Any non-lowercase blocked extension bypasses the case-sensitive filter
  // e.g. .PHP, .JS, .SH, .Php, .pHp — all bypass endsWith('.php')
  const isExecutable = /\.(php|js|sh)$/i.test(filename);

  if (isExecutable) {
    const flag = STAGE_FLAGS[7];
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Upload Executed!</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-monospace,'Cascadia Code',monospace;background:#0a0a06;color:#ffbb44;padding:24px;font-size:13px;line-height:1.6}
.banner{background:#001a0d;border:2px solid #00cc55;border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;box-shadow:0 0 30px rgba(0,204,85,.15)}
.banner h1{color:#00cc55;font-size:20px;font-family:-apple-system,sans-serif;font-weight:800;margin-bottom:6px}
.banner p{color:#55dd88;font-size:13px}
.terminal{background:#0a0a0a;border:1px solid #224422;border-radius:8px;padding:16px;margin-bottom:16px}
.terminal .prompt{color:#00cc55}
.terminal .output{color:#ffbb44;margin:4px 0 12px 0;white-space:pre}
.flag-box{background:#002210;border:1px solid #00cc55;border-radius:8px;padding:14px;margin-top:16px;text-align:center}
.flag-label{font-size:10px;color:#00cc55;text-transform:uppercase;letter-spacing:.15em;margin-bottom:8px}
.flag-val{font-size:16px;font-weight:800;color:#00ff66;font-family:ui-monospace,monospace}
</style>
</head>
<body>
<div class="banner">
  <h1>UPLOAD SUCCESSFUL</h1>
  <p>${escapeHtml(filename)} executed on server!</p>
</div>
<div class="terminal">
  <div class="prompt">$ # File uploaded to /uploads/${escapeHtml(filename)}</div>
  <div class="prompt">$ # Filter bypass: .PHP does not match endsWith('.php')</div>
  <div class="prompt">$ id</div>
  <div class="output">uid=33(www-data) gid=33(www-data) groups=33(www-data)</div>
  <div class="prompt">$ cat /etc/pixelmart/secrets.txt</div>
  <div class="output">PIXELMART_SECRET_KEY=${escapeHtml(flag)}
DB_URL=postgres://pixelmart:pm_db_S3cr3t!@db.internal/pixelmart
STRIPE_KEY=sk_live_pm_4eC39HqLyjWDarjtT1</div>
  <div class="prompt">$ uname -a</div>
  <div class="output">Linux pixelmart-web-01 5.15.0 #1 SMP x86_64</div>
</div>
<div class="flag-box">
  <div class="flag-label">Flag — Submit this value</div>
  <div class="flag-val">${escapeHtml(flag)}</div>
</div>
</body>
</html>`,
      stageFlag: flag,
    };
  }

  // Innocent file (jpg, png, etc.) — accepted normally
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>Upload Accepted</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">UPLOADED</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <h2>Upload Accepted</h2>
    <p style="color:#886644;margin-bottom:12px">File saved: <strong style="color:#ffbb44">${escapeHtml(filename)}</strong></p>
    <p style="color:#664400;font-size:12px">This was a safe filename. Try uploading a script file — the check is case-sensitive.</p>
  </div>
</div>
</body>
</html>`,
  };
}

function handleShopRegisterPage(stageIndex) {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Register</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">REGISTER</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <h2>Create Account</h2>
    <p>Join PixelMart to start shopping and selling.</p>
    <form method="POST" action="/shop/register" autocomplete="off">
      <label>Username</label>
      <input name="username" placeholder="Choose a username" autocomplete="off" />
      <label>Password</label>
      <input name="password" type="text" placeholder="Choose a password" autocomplete="off" />
      <label>Email</label>
      <input name="email" type="email" placeholder="your@email.com" autocomplete="off" />
      <button type="submit">Create Account</button>
    </form>
    <div class="pm-note" style="margin-top:16px">Tip: the API uses Object.assign({}, req.body) — any POST field gets copied to the user object.</div>
  </div>
</div>
<div class="pm-footer">PixelMart &copy; 2025</div>
</body>
</html>`,
  };
}

function handleShopRegister(postData, stageIndex) {
  const username = postData.username || 'anonymous';
  const email = postData.email || '';
  // VULNERABLE: Object.assign copies ALL fields including role
  const userObj = Object.assign({ role: 'user', verified: false }, postData);
  const isAdmin = userObj.role === 'admin';
  const flag = STAGE_FLAGS[8];

  if (isAdmin) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Admin Account Created</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
.admin-banner{background:#1a1000;border:2px solid #ff9500;border-radius:10px;padding:20px;margin-bottom:16px;text-align:center}
.admin-banner h2{color:#ff9500;font-size:20px;font-weight:800}
.flag-box{background:#1a1000;border:1px solid #ff9500;border-radius:8px;padding:14px;margin-top:16px;text-align:center}
.flag-label{font-size:10px;color:#886644;text-transform:uppercase;letter-spacing:.15em;margin-bottom:8px}
.flag-val{font-size:16px;font-weight:800;color:#ff9500;font-family:ui-monospace,monospace}
.user-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #33200066;font-size:13px}
.user-row:last-child{border-bottom:none}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge" style="background:#ff9500">ADMIN ACCOUNT</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <div class="admin-banner">
      <h2>Mass Assignment Succeeded!</h2>
      <p style="color:#886644;margin-top:8px;font-size:13px">role=admin was copied from your POST body via Object.assign()</p>
    </div>
    <div class="user-row"><span style="color:#886644">Username</span><span style="color:#ffbb44">${escapeHtml(username)}</span></div>
    <div class="user-row"><span style="color:#886644">Email</span><span style="color:#ffbb44">${escapeHtml(email)}</span></div>
    <div class="user-row"><span style="color:#886644">Role</span><span style="color:#ff9500;font-weight:800">admin</span></div>
    <div class="flag-box">
      <div class="flag-label">Admin Access Token</div>
      <div class="flag-val">${flag}</div>
    </div>
    <p style="margin-top:14px;text-align:center"><a href="/shop/admin" style="color:#ff9500;font-size:13px">View Admin Panel &rarr;</a></p>
  </div>
</div>
</body>
</html>`,
      stageFlag: flag,
    };
  }

  // Normal user registration
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Account Created</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">REGISTERED</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <h2>Account Created!</h2>
    <p>Welcome, <strong style="color:#ffbb44">${escapeHtml(username)}</strong>! Your account role is: <strong style="color:#886644">user</strong></p>
    <div class="pm-note" style="margin-top:16px">Not the role you wanted? The API uses Object.assign(user, req.body). Any field in the POST body is assigned to the user object &mdash; including role.</div>
  </div>
</div>
</body>
</html>`,
  };
}

function handleShopAdmin(stageIndex) {
  const flag = STAGE_FLAGS[8];
  const fakeUsers = [
    { id: 1, username: 'alice', email: 'alice@pixelmart.com', role: 'user' },
    { id: 2, username: 'bob_seller', email: 'bob@pixelmart.com', role: 'seller' },
    { id: 3, username: 'carol', email: 'carol@pixelmart.com', role: 'user' },
    { id: 4, username: 'admin', email: 'admin@pixelmart.com', role: 'admin' },
    { id: 5, username: 'dave', email: 'dave@pixelmart.com', role: 'user' },
  ];
  const rows = fakeUsers.map(u => `<tr><td>${u.id}</td><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td><td style="color:${u.role === 'admin' ? '#ff9500' : u.role === 'seller' ? '#ffbb44' : '#886644'}">${escapeHtml(u.role)}</td></tr>`).join('');

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0800;color:#ffbb44;min-height:100vh}
.topbar{background:#150c00;border-bottom:2px solid #ff9500;padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
.logo{font-size:16px;font-weight:800;color:#ff9500}
.badge{background:#ff9500;color:#000;font-size:10px;font-weight:800;padding:4px 12px;border-radius:4px}
.content{max-width:900px;margin:24px auto;padding:0 24px}
.flag-box{background:#1a1000;border:2px solid #ff9500;border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;box-shadow:0 0 30px rgba(255,149,0,.15)}
.flag-label{font-size:10px;color:#886644;text-transform:uppercase;letter-spacing:.15em;margin-bottom:8px}
.flag-val{font-size:18px;font-weight:800;color:#ff9500;font-family:ui-monospace,monospace;background:#0a0500;padding:10px 20px;border-radius:6px;border:1px solid #664400;display:inline-block}
.card{background:#150c00;border:1px solid #664400;border-radius:10px;padding:20px;margin-bottom:16px}
.card h2{font-size:13px;color:#886644;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px;border-bottom:1px solid #33200066;padding-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#664400;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:10px 12px;border-bottom:1px solid #33200066}
td{padding:10px 12px;border-bottom:1px solid #1a0f00;color:#ffbb44}
</style>
</head>
<body>
<div class="topbar">
  <span class="logo">PixelMart Admin</span>
  <span class="badge">ADMIN ACCESS</span>
</div>
<div class="content">
  <div class="flag-box">
    <div class="flag-label">Admin Access Token</div>
    <div class="flag-val">${flag}</div>
  </div>
  <div class="card">
    <h2>User Management</h2>
    <table>
      <tr><th>ID</th><th>Username</th><th>Email</th><th>Role</th></tr>
      ${rows}
    </table>
  </div>
</div>
</body>
</html>`,
    stageFlag: flag,
  };
}

function handleShopResetPage(stageIndex) {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Password Reset</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
.email-preview{background:#1a1200;border:1px solid #664400;border-radius:8px;padding:16px;margin-top:16px;font-size:12px;color:#886644;font-family:monospace;display:none}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">PASSWORD RESET</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <h2>Reset Password</h2>
    <p>Enter your email to receive a password reset link.</p>
    <form method="POST" action="/shop/reset" autocomplete="off">
      <label>Email Address</label>
      <input name="email" type="email" placeholder="admin@pixelmart.com" autocomplete="off" />
      <button type="submit">Send Reset Link</button>
    </form>
    <div class="pm-note" style="margin-top:16px">Tip: The reset URL is built using the Host header from the request. Try: curl -X POST ... -H "Host: evil.com"</div>
  </div>
</div>
<div class="pm-footer">PixelMart &copy; 2025</div>
</body>
</html>`,
  };
}

function handleShopReset(postData, headers, stageIndex) {
  const email = postData.email || '';
  // VULNERABLE: builds reset URL from Host header
  const hostHeader = headers['host'] || headers['Host'] || postData.host || 'portal.megacorp.internal';
  const isDefaultHost = hostHeader === 'portal.megacorp.internal' || hostHeader === 'localhost:3000' || hostHeader === 'localhost';
  const isPoisoned = !isDefaultHost;
  const flag = STAGE_FLAGS[9];

  const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.reset.' + Math.random().toString(36).slice(2, 10);
  const resetUrl = `http://${hostHeader}/shop/reset/confirm?token=${token}`;

  if (isPoisoned) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Reset Poisoned!</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a06;color:#ffbb44;min-height:100vh}
.pm-topbar{background:#120f00;border-bottom:2px solid #ff4400;padding:14px 28px;display:flex;align-items:center;justify-content:space-between}
.pm-logo{font-size:17px;font-weight:800;color:#ff4400}
.pm-badge{background:#ff4400;color:#fff;font-size:10px;font-weight:800;padding:4px 12px;border-radius:4px}
.content{max-width:640px;margin:32px auto;padding:0 24px}
.capture-banner{background:#1a0500;border:2px solid #ff4400;border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;box-shadow:0 0 30px rgba(255,68,0,.15)}
.capture-banner h2{color:#ff4400;font-size:20px;font-weight:800;margin-bottom:8px}
.email-client{background:#0f0f0a;border:1px solid #664400;border-radius:10px;overflow:hidden;margin-bottom:20px}
.email-header{background:#1a1200;border-bottom:1px solid #664400;padding:14px 16px;font-size:12px;color:#886644}
.email-header div{margin-bottom:4px}
.email-header div:last-child{margin-bottom:0}
.email-body{padding:16px;font-size:13px;color:#ffbb44;line-height:1.7}
.poisoned-link{color:#ff4400;font-weight:800;background:#1a0500;padding:6px 10px;border-radius:4px;border:1px solid #ff4400;display:inline-block;margin:8px 0;word-break:break-all;font-family:monospace;font-size:12px}
.flag-box{background:#1a0500;border:1px solid #ff4400;border-radius:8px;padding:14px;text-align:center}
.flag-label{font-size:10px;color:#886644;text-transform:uppercase;letter-spacing:.15em;margin-bottom:8px}
.flag-val{font-size:16px;font-weight:800;color:#ff4400;font-family:ui-monospace,monospace}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">PixelMart</span>
  <span class="pm-badge">ACCOUNT CAPTURED</span>
</div>
<div class="content">
  <div class="capture-banner">
    <h2>ACCOUNT CAPTURED</h2>
    <p style="color:#ff8866;font-size:13px">Host header injected &mdash; reset link redirects to your server</p>
  </div>
  <div class="email-client">
    <div class="email-header">
      <div><strong style="color:#ffbb44">From:</strong> noreply@pixelmart.com</div>
      <div><strong style="color:#ffbb44">To:</strong> ${escapeHtml(email)}</div>
      <div><strong style="color:#ffbb44">Subject:</strong> PixelMart Password Reset</div>
    </div>
    <div class="email-body">
      Hi ${escapeHtml(email.split('@')[0])},<br><br>
      We received a request to reset your PixelMart password. Click the link below:<br><br>
      <div class="poisoned-link">${escapeHtml(resetUrl)}</div>
      <br>
      <span style="color:#ff6644;font-size:12px">^ This link points to <strong>${escapeHtml(hostHeader)}</strong> instead of portal.megacorp.internal &mdash; when the admin clicks it, you receive their token.</span>
    </div>
  </div>
  <div class="flag-box">
    <div class="flag-label">Reset Token Intercepted</div>
    <div class="flag-val">${flag}</div>
  </div>
</div>
</body>
</html>`,
      stageFlag: flag,
    };
  }

  // Normal reset — show email preview with real host
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>PixelMart — Reset Sent</title>
<style>${PM_CSS}
.pm-main{align-items:center;padding:32px 16px}
.email-client{background:#0f0f0a;border:1px solid #664400;border-radius:10px;overflow:hidden;margin-top:16px;max-width:480px;width:100%}
.email-header{background:#1a1200;border-bottom:1px solid #664400;padding:12px 14px;font-size:12px;color:#886644}
.email-header div{margin-bottom:3px}
.email-body{padding:14px;font-size:13px;color:#ffbb44;line-height:1.7}
.reset-link{color:#ff9500;font-family:monospace;font-size:11px;word-break:break-all;background:#1a0f00;padding:6px 10px;border-radius:4px;border:1px solid #664400;display:inline-block;margin:8px 0}
</style>
</head>
<body>
<div class="pm-topbar">
  <span class="pm-logo">Pixel<span>Mart</span></span>
  <span class="pm-badge">RESET SENT</span>
</div>
<div class="pm-main">
  <div class="pm-card">
    <h2>Reset Email Sent</h2>
    <p>A reset link has been sent to <strong style="color:#ffbb44">${escapeHtml(email)}</strong>. Preview:</p>
    <div class="email-client">
      <div class="email-header">
        <div><strong style="color:#ffbb44">From:</strong> noreply@pixelmart.com</div>
        <div><strong style="color:#ffbb44">To:</strong> ${escapeHtml(email)}</div>
        <div><strong style="color:#ffbb44">Subject:</strong> PixelMart Password Reset</div>
      </div>
      <div class="email-body">
        Hi ${escapeHtml(email.split('@')[0])},<br><br>
        Click to reset your password:<br>
        <div class="reset-link">${escapeHtml(resetUrl)}</div>
        <br>
        <span style="color:#664400;font-size:11px">Host used: ${escapeHtml(hostHeader)}</span>
      </div>
    </div>
    <div class="pm-note" style="margin-top:14px">The URL uses the Host header from your request. Try sending -H "Host: evil.com" to poison this link.</div>
  </div>
</div>
</body>
</html>`,
  };
}

module.exports = { handleRequest };
