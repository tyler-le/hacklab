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
};

// Which routes are available per stage.
// Players can only interact with the vulnerability relevant to their current stage.
const STAGE_ROUTES = {
  0: ['/login'],                  // Stage 1: Information Leakage
  1: ['/api/employees'],          // Stage 2: IDOR
  2: ['/api/search', '/api/log'],  // Stage 3: XSS
  3: ['/api/admin/login'],        // Stage 4: SQL Injection
  4: ['/api/diagnostic'],         // Stage 5: Command Injection
};

/**
 * Handle a virtual HTTP request from curl.
 * @param {string} method - GET or POST
 * @param {string} url - e.g. "/login", "/api/employees/4"
 * @param {string} body - POST body (URL-encoded or JSON)
 * @param {string} sessionId - player session
 * @param {number} [stageIndex] - current stage (restricts available routes)
 * @returns {{ status: number, headers: object, body: string, stagePass?: boolean, query?: string, queryResult?: object }}
 */
function handleRequest(method, url, body, sessionId, stageIndex) {
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

module.exports = { handleRequest };
