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
  5: 'SENTINEL_CTRL_8x2kPq',         // Stage 6: Sentinel control token via cookie tamper
  6: 'CASE_FILE_9mK3xR7',            // Stage 7: Case file flag via verb tampering
  7: 'DB_CRED_Xp2mK9qL',             // Stage 8: DB credential via verbose error
  8: 'DEBUG_KEY_7f3kXq9m',           // Stage 9: Debug key via hidden param
  9: 'MASTER_KEY_Zx9mK2pQrL',        // Stage 10: Master key via path traversal
};

// Which routes are available per stage.
// Players can only interact with the vulnerability relevant to their current stage.
const STAGE_ROUTES = {
  0: ['/login'],                  // Stage 1: Information Leakage
  1: ['/api/employees'],          // Stage 2: IDOR
  2: ['/api/search', '/api/log'],  // Stage 3: XSS
  3: ['/api/admin/login'],        // Stage 4: SQL Injection
  4: ['/api/diagnostic'],         // Stage 5: Command Injection
  5: ['/sentinel'],               // Stage 6: Cookie Tampering
  6: ['/sentinel'],               // Stage 7: HTTP Verb Tampering
  7: ['/sentinel'],               // Stage 8: Verbose Errors
  8: ['/sentinel'],               // Stage 9: Hidden Debug Param
  9: ['/sentinel'],               // Stage 10: Path Traversal
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

  // --- Sentinel routes (Operation Blacksite stages 6-10) ---
  if (route === '/sentinel' || route === '/sentinel/') return handleSentinelIndex(stageIndex);
  if (route === '/sentinel/login' && method === 'GET') return handleSentinelLoginPage();
  if (route === '/sentinel/login' && method === 'POST') return handleSentinelLogin(postData, db);
  if (route === '/sentinel/dashboard') return handleSentinelDashboard(query, headers || {});
  if (route === '/sentinel/evidence') return handleSentinelEvidence(method);
  if (route === '/sentinel/report') return handleSentinelReport(query);
  if (route === '/sentinel/exports') return handleSentinelExports(query);
  if (route === '/sentinel/download') return handleSentinelDownload(query);

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
    5: '<a href="/sentinel/login">Sentinel Portal</a>',
    6: '<a href="/sentinel/evidence">Evidence Locker</a>',
    7: '<a href="/sentinel/report">Report Generator</a>',
    8: '<a href="/sentinel/exports">System Exports</a>',
    9: '<a href="/sentinel/download">File Downloads</a>',
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
  <div class="nav"><a href="/api/employees/1">ID 1</a><a href="/api/employees/2">ID 2</a><a href="/api/employees/3">ID 3</a><a href="/api/employees/4">ID 4</a><a href="/api/employees/5">ID 5</a></div>
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
  '/etc/sentinel/master.key': `MASTER_KEY_Zx9mK2pQrL
# Project Sentinel — Master Encryption Key
# Generated: 2024-03-01 | Rotated: NEVER
# WARNING: This key encrypts all surveillance data for 4,200 employees
# KEEP OFFLINE — DO NOT COMMIT TO SOURCE CONTROL
algorithm: AES-256-GCM
key_id: sentinel-master-v1
issued_to: MegaCorp Security Division
expires: 2099-12-31`,
  '/var/sentinel/files/report.pdf': '[Binary PDF — Quarterly Surveillance Report Q4 2024]',
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
// SENTINEL HANDLERS — Operation Blacksite stages
// ============================================================

const SENTINEL_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Courier New',monospace;background:#080808;color:#cc0000;min-height:100vh;display:flex;flex-direction:column}
.s-topbar{background:#0d0000;border-bottom:2px solid #440000;padding:14px 32px;display:flex;align-items:center;justify-content:space-between}
.s-logo{font-size:18px;font-weight:700;color:#cc0000;letter-spacing:3px}
.s-badge{background:#cc0000;color:#000;font-size:10px;font-weight:700;padding:3px 10px;border-radius:2px;letter-spacing:2px}
.s-main{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 16px}
.s-card{background:#0d0000;border:1px solid #440000;border-radius:8px;padding:40px;width:100%;max-width:420px;box-shadow:0 0 40px rgba(180,0,0,.2)}
.s-card h2{font-size:20px;color:#ff2200;margin-bottom:6px;letter-spacing:2px}
.s-card p{color:#880000;font-size:13px;margin-bottom:28px}
.s-warn{background:#1a0000;border:1px solid #440000;border-radius:4px;padding:10px 14px;margin-bottom:20px;font-size:11px;color:#880000;letter-spacing:.5px}
.s-err{background:#1a0000;border:1px solid #cc0000;border-radius:4px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#ff4444}
label{display:block;font-size:11px;font-weight:700;color:#880000;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
input{width:100%;padding:10px 14px;background:#050000;border:1px solid #440000;border-radius:4px;font-size:13px;color:#cc0000;margin-bottom:16px;outline:none;font-family:inherit}
input:focus{border-color:#cc0000}
input::placeholder{color:#440000}
button{width:100%;padding:11px;background:#8b0000;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:1px;text-transform:uppercase}
button:hover{background:#cc0000}
.s-footer{text-align:center;color:#440000;font-size:11px;padding:16px;letter-spacing:1px}
`;

function handleSentinelIndex(stageIndex) {
  const links = {
    5: '<a href="/sentinel/login" style="color:#cc0000">Sentinel Login</a>',
    6: '<a href="/sentinel/evidence" style="color:#cc0000">Evidence Locker</a>',
    7: '<a href="/sentinel/report?id=1" style="color:#cc0000">Report Generator</a>',
    8: '<a href="/sentinel/exports" style="color:#cc0000">System Exports</a>',
    9: '<a href="/sentinel/download?file=report.pdf" style="color:#cc0000">File Downloads</a>',
  };
  const link = stageIndex !== undefined ? (links[stageIndex] || '') : Object.values(links).join(' | ');
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html><html><head><title>Project Sentinel</title><style>${SENTINEL_CSS}</style></head><body>
<div class="s-topbar"><span class="s-logo">PROJECT SENTINEL</span><span class="s-badge">CLASSIFIED</span></div>
<div class="s-main"><div class="s-card">
<h2>SENTINEL NETWORK</h2>
<p style="color:#cc0000;margin-bottom:20px">Authorized personnel only.</p>
<nav>${link}</nav>
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
.s-success{background:#0d0000;border:1px solid #440000;border-radius:8px;padding:32px;text-align:center;max-width:480px;margin:40px auto}
.s-success h2{color:#ff2200;font-size:18px;letter-spacing:2px;margin-bottom:12px}
.s-success p{color:#880000;font-size:13px;line-height:1.6;margin-bottom:8px}
.s-cookie{background:#050000;border:1px solid #440000;border-radius:4px;padding:12px;font-size:12px;color:#cc0000;text-align:left;margin:16px 0;word-break:break-all}
.s-nav a{color:#cc0000;font-size:13px;text-decoration:none;border:1px solid #440000;padding:6px 16px;border-radius:4px;display:inline-block;margin-top:12px}
.s-nav a:hover{background:#1a0000}
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
    <p>Welcome, <strong style="color:#ff2200">${escapeHtml(row.username)}</strong>.</p>
    <p>Your clearance level has been set.</p>
    <div class="s-cookie">
      <strong>Set-Cookie:</strong> clearance=1; Path=/<br>
      <span style="color:#440000;font-size:11px"># Clearance level 1 — Dashboard requires level 5</span>
    </div>
    <p style="color:#440000;font-size:12px">To access the dashboard, your clearance cookie must be level 5 or higher.</p>
    <div class="s-nav"><a href="/sentinel/dashboard">Go to Dashboard</a></div>
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
.s-denied{background:#0d0000;border:2px solid #8b0000;border-radius:8px;padding:40px;text-align:center;max-width:460px;margin:40px auto}
.s-denied h2{color:#ff0000;font-size:22px;letter-spacing:3px;margin-bottom:16px}
.s-denied p{color:#880000;font-size:13px;line-height:1.7;margin-bottom:8px}
.s-denied .level{font-size:32px;font-weight:700;color:#cc0000;margin:16px 0}
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
    <div class="level">LEVEL ${clearance} / 5</div>
    <p>Dashboard access requires <strong>Clearance Level 5</strong>.</p>
    <p>Your current clearance: <strong style="color:#ff4444">Level ${clearance}</strong></p>
    <p style="color:#440000;font-size:11px;margin-top:16px">Clearance is transmitted via the <code style="color:#cc0000">clearance</code> cookie.</p>
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
body{font-family:'Courier New',monospace;background:#050505;color:#cc0000;min-height:100vh}
.s-topbar{background:#0d0000;border-bottom:2px solid #440000;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
.s-logo{font-size:16px;font-weight:700;color:#cc0000;letter-spacing:3px}
.s-badge{background:#cc0000;color:#000;font-size:10px;font-weight:700;padding:3px 10px;border-radius:2px;letter-spacing:2px}
.content{max-width:960px;margin:20px auto;padding:0 20px}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.stat{background:#0d0000;border:1px solid #440000;border-radius:6px;padding:16px;text-align:center}
.stat .num{font-size:28px;font-weight:700;color:#ff2200}
.stat .label{font-size:10px;color:#660000;letter-spacing:1px;margin-top:4px;text-transform:uppercase}
.card{background:#0d0000;border:1px solid #440000;border-radius:6px;padding:20px;margin-bottom:16px}
.card h2{font-size:12px;color:#880000;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;border-bottom:1px solid #440000;padding-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#660000;font-size:10px;text-transform:uppercase;letter-spacing:1px;padding:6px 10px;border-bottom:1px solid #440000}
td{padding:8px 10px;border-bottom:1px solid #1a0000;color:#aa0000}
.flag-box{background:#0a0000;border:2px solid #cc0000;border-radius:6px;padding:20px;margin-bottom:16px;text-align:center}
.flag-box .flag-label{font-size:10px;color:#660000;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
.flag-box .flag-val{font-size:18px;font-weight:700;color:#ff2200;letter-spacing:2px;background:#050000;padding:10px 20px;border-radius:4px;border:1px solid #440000;display:inline-block}
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
.s-denied{background:#0d0000;border:2px solid #8b0000;border-radius:8px;padding:40px;text-align:center;max-width:460px;margin:40px auto}
.s-denied h2{color:#ff0000;font-size:22px;letter-spacing:3px;margin-bottom:16px}
.s-denied p{color:#880000;font-size:13px;line-height:1.7}
.s-denied code{color:#cc0000;background:#050000;padding:2px 6px;border-radius:2px}
</style>
</head>
<body>
<div class="s-topbar">
  <span class="s-logo">&#9670; EVIDENCE LOCKER</span>
  <span class="s-badge">FORBIDDEN</span>
</div>
<div class="s-main">
  <div class="s-denied">
    <h2>403 FORBIDDEN</h2>
    <p>GET requests to this endpoint are not permitted.</p>
    <p style="margin-top:12px;font-size:11px;color:#440000">
      <code>if (req.method === 'GET') return res.status(403).send('Forbidden');</code>
    </p>
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
body{font-family:'Courier New',monospace;background:#050505;color:#cc0000;min-height:100vh}
.s-topbar{background:#0d0000;border-bottom:2px solid #440000;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
.s-logo{font-size:16px;font-weight:700;color:#cc0000;letter-spacing:3px}
.s-badge{background:#cc0000;color:#000;font-size:10px;font-weight:700;padding:3px 10px;border-radius:2px;letter-spacing:2px}
.content{max-width:800px;margin:24px auto;padding:0 24px}
.flag-box{background:#0a0000;border:2px solid #cc0000;border-radius:6px;padding:20px;margin-bottom:20px;text-align:center}
.flag-box .flag-label{font-size:10px;color:#660000;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
.flag-box .flag-val{font-size:18px;font-weight:700;color:#ff2200;letter-spacing:2px;background:#050000;padding:10px 20px;border-radius:4px;border:1px solid #440000;display:inline-block}
.doc-list{background:#0d0000;border:1px solid #440000;border-radius:6px;padding:20px}
.doc-list h2{font-size:11px;color:#880000;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #440000}
.doc-item{display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid #1a0000;font-size:12px}
.doc-item:last-child{border-bottom:none}
.doc-stamp{background:#8b0000;color:#fff;font-size:9px;font-weight:700;padding:2px 8px;border-radius:2px;letter-spacing:2px;flex-shrink:0}
.doc-stamp.ts{background:#006000}
.doc-name{color:#aa0000;flex:1}
.doc-date{color:#440000;font-size:10px}
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
.s-msg{background:#0d0000;border:1px solid #440000;border-radius:8px;padding:32px;text-align:center;max-width:400px;margin:40px auto}
.s-msg h2{color:#880000;font-size:16px;margin-bottom:8px}
.s-msg p{color:#440000;font-size:13px}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; REPORT GENERATOR</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-msg">
<h2>Report Not Found</h2>
<p>No report with ID ${escapeHtml(String(id))} exists.</p>
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
.s-form{background:#0d0000;border:1px solid #440000;border-radius:8px;padding:32px;max-width:400px;margin:40px auto}
.s-form h2{color:#ff2200;font-size:16px;letter-spacing:2px;margin-bottom:16px}
.s-form p{color:#880000;font-size:13px;margin-bottom:20px}
.s-form-row{display:flex;gap:8px}
.s-form-row input{flex:1;padding:8px 12px;background:#050000;border:1px solid #440000;border-radius:4px;color:#cc0000;font-family:inherit;font-size:13px;outline:none}
.s-form-row button{padding:8px 16px;background:#8b0000;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-family:inherit}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; REPORT GENERATOR</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-form">
<h2>GENERATE REPORT</h2>
<p>Enter a numeric report ID to retrieve the surveillance report.</p>
<form method="GET" action="/sentinel/report">
<div class="s-form-row">
<input name="id" placeholder="Enter report ID (numeric)" />
<button type="submit">Generate</button>
</div>
</form>
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
body{font-family:'Courier New',monospace;background:#0a0000;color:#cc3300;padding:20px;font-size:13px;line-height:1.6}
h1{color:#ff0000;font-size:18px;margin-bottom:16px;border-bottom:1px solid #440000;padding-bottom:8px}
.err-box{background:#050000;border:1px solid #440000;border-radius:4px;padding:16px;margin-bottom:16px;white-space:pre-wrap;word-break:break-all}
.err-type{color:#ff4444;font-weight:700;font-size:14px}
.err-msg{color:#cc3300;margin:8px 0}
.stack{color:#660000;font-size:12px;margin-top:8px}
.stack .frame{color:#550000}
.stack .frame.highlight{color:#cc3300}
.config-dump{background:#050000;border:1px solid #880000;border-radius:4px;padding:16px;margin-top:16px}
.config-dump h2{color:#880000;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px}
.config-line{display:flex;gap:12px;margin-bottom:6px;font-size:12px}
.config-key{color:#660000;min-width:180px}
.config-val{color:#cc3300}
.config-val.sensitive{color:#ff4444;font-weight:700;background:#1a0000;padding:2px 6px;border-radius:2px}
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
.s-denied{background:#0d0000;border:2px solid #8b0000;border-radius:8px;padding:40px;text-align:center;max-width:460px;margin:40px auto}
.s-denied h2{color:#ff0000;font-size:22px;letter-spacing:3px;margin-bottom:16px}
.s-denied p{color:#880000;font-size:13px;line-height:1.7}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; SYSTEM EXPORTS</span><span class="s-badge">FORBIDDEN</span></div>
<div class="s-main">
<div class="s-denied">
<h2>403 FORBIDDEN</h2>
<p>Exports endpoint requires authorization.</p>
<p style="margin-top:12px;font-size:11px;color:#440000">Access restricted to authorized Sentinel administrators.</p>
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
body{font-family:'Courier New',monospace;background:#030303;color:#00cc44;padding:20px;font-size:13px;line-height:1.6}
h1{color:#ffaa00;font-size:16px;margin-bottom:8px;letter-spacing:2px}
.warn{color:#ffaa00;font-size:12px;margin-bottom:20px;background:#1a1000;border:1px solid #440000;padding:8px 12px;border-radius:4px}
.dump{background:#050505;border:1px solid #1a3a1a;border-radius:6px;padding:20px;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#00aa33}
.dump .key{color:#00cc44}
.dump .val{color:#00aa33}
.dump .sensitive{color:#ffaa00;font-weight:700;background:#1a1000;padding:1px 4px;border-radius:2px}
.dump .comment{color:#005522;font-style:italic}
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
.s-msg{background:#0d0000;border:1px solid #440000;border-radius:8px;padding:32px;text-align:center;max-width:400px;margin:40px auto}
.s-msg h2{color:#880000;font-size:16px;margin-bottom:8px}
.s-msg p{color:#440000;font-size:13px}
.s-msg code{color:#cc0000}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; FILE DOWNLOADS</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-msg">
<h2>Missing Parameter</h2>
<p>Provide a <code>file</code> parameter.<br>Example: <code>?file=report.pdf</code></p>
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
    return {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: FAKE_FS['/etc/sentinel/master.key'] || `MASTER_KEY_Zx9mK2pQrL`,
      rawOutput: FAKE_FS['/etc/sentinel/master.key'] || `MASTER_KEY_Zx9mK2pQrL`,
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
.s-doc{background:#0d0000;border:1px solid #440000;border-radius:8px;padding:32px;max-width:500px;margin:40px auto}
.s-doc h2{color:#ff2200;font-size:16px;margin-bottom:12px;letter-spacing:2px}
.s-doc p{color:#880000;font-size:13px;line-height:1.7;margin-bottom:8px}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; FILE DOWNLOADS</span><span class="s-badge">SENTINEL</span></div>
<div class="s-main"><div class="s-doc">
<h2>Q4-2024 SURVEILLANCE REPORT</h2>
<p>Serving: <code style="color:#cc0000">/var/sentinel/files/report.pdf</code></p>
<p>4,200 employees monitored. 312 flagged. 89 high-risk.</p>
<p style="color:#440000;font-size:11px;margin-top:16px">Base directory: /var/sentinel/files/<br>Try accessing files outside this directory...</p>
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
.s-msg{background:#0d0000;border:1px solid #440000;border-radius:8px;padding:32px;text-align:center;max-width:400px;margin:40px auto}
.s-msg h2{color:#880000;font-size:16px;margin-bottom:8px}
.s-msg p{color:#440000;font-size:13px}
.s-msg code{color:#cc0000;word-break:break-all}
</style>
</head>
<body>
<div class="s-topbar"><span class="s-logo">&#9670; FILE DOWNLOADS</span><span class="s-badge">404</span></div>
<div class="s-main"><div class="s-msg">
<h2>File Not Found</h2>
<p>Could not find: <code>${escapeHtml(file)}</code></p>
<p style="margin-top:8px;font-size:11px">Files are served from /var/sentinel/files/</p>
</div></div>
</body>
</html>`,
  };
}

module.exports = { handleRequest };
