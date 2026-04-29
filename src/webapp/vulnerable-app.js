/**
 * Vulnerable Web App — serves responses to curl requests.
 * Mirrors the Node.js/Express API the player sees in routes.js on the virtual filesystem.
 */

const sessionManager = require('../db/session-manager');

/**
 * Handle a virtual HTTP request from curl.
 * @param {string} method - GET or POST
 * @param {string} url - e.g. "/login", "/api/employees/4"
 * @param {string} body - POST body (URL-encoded or JSON)
 * @param {string} sessionId - player session
 * @returns {{ status: number, headers: object, body: string, stagePass?: boolean, query?: string, queryResult?: object }}
 */
function handleRequest(method, url, body, sessionId) {
  const db = sessionManager.getSession(sessionId);
  if (!db) return { status: 500, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Internal Server Error"}' };

  const parsed = parseUrl(url);
  const route = parsed.pathname;
  const query = parsed.query;
  const postData = parseBody(body);

  // Route matching
  if (route === '/' || route === '/index') return handleIndex();
  if (route === '/login' && method === 'GET') return handleLoginPage();
  if (route === '/login' && method === 'POST') return handleLogin(postData, db);

  // /api/employees/:id
  const employeeMatch = route.match(/^\/api\/employees\/(\d+)$/);
  if (employeeMatch) return handleEmployee(parseInt(employeeMatch[1]), db);

  if (route === '/api/search') return handleSearch(query, db);
  if (route === '/api/admin/login' && method === 'POST') return handleAdminLogin(postData, db);
  if (route === '/api/admin/login' && method === 'GET') return handleAdminLoginPage();
  if (route === '/api/diagnostic') return handleDiagnostic(query);

  return {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Not Found', path: route }),
  };
}

function handleIndex() {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>MegaCorp Portal</title></head>
<body>
  <h1>Welcome to MegaCorp Employee Portal</h1>
  <nav>
    <a href="/login">Login</a> |
    <a href="/api/employees/1">My Profile</a> |
    <a href="/api/search?q=">Employee Search</a> |
    <a href="/api/diagnostic?host=localhost">Server Diagnostics</a>
  </nav>
</body>
</html>`,
  };
}

function handleLoginPage() {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>MegaCorp Login</title></head>
<body>
  <h1>MegaCorp Employee Portal</h1>
  <!-- default test account: admin / password123 -->
  <form method="POST" action="/login">
    <input name="user" placeholder="Username" />
    <input name="pass" type="password" placeholder="Password" />
    <button type="submit">Sign In</button>
  </form>
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
    const stagePass = row && user === 'admin' && pass === 'password123';

    if (row) {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, user: row.username, role: row.role }),
        stagePass,
        query: displayQuery,
        queryResult: { columns: ['username', 'role'], rows: [[row.username, row.role]] },
      };
    }
    return {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid credentials' }),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Employee not found with id=${id}` }),
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

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(responseData, null, 2),
    stagePass: isAdmin,
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

  const hasScript = /<script[\s>]/i.test(q);
  const callsStealCookie = /stealCookie\s*\(/i.test(q);

  const resultsHtml = rows.map(r =>
    `<tr><td>${escapeHtml(r.username)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.department)}</td></tr>`
  ).join('\n');

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    // BUG: q is NOT escaped in the "Showing results for" line — XSS vulnerability
    body: `<!DOCTYPE html>
<html>
<head><title>Employee Search</title></head>
<body>
  <h1>Employee Directory</h1>
  ${q ? `<p>Showing results for: ${q}</p>` : ''}
  <table border="1" cellpadding="8">
    <tr><th>Username</th><th>Email</th><th>Department</th></tr>
    ${resultsHtml}
  </table>
</body>
</html>`,
    stagePass: hasScript && callsStealCookie,
    query: displayQuery,
    queryResult: {
      columns: ['username', 'email', 'department'],
      rows: rows.map(r => [r.username, r.email, r.department]),
    },
  };
}

function handleAdminLoginPage() {
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html>
<head><title>Admin Login</title></head>
<body>
  <h1>MegaCorp Admin Panel</h1>
  <form method="POST" action="/api/admin/login">
    <input name="user" placeholder="Username" />
    <input name="pass" type="password" placeholder="Password" />
    <button type="submit">Login</button>
  </form>
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
    const hasOrTautology = /OR\s+[\d']\s*=\s*[\d']/i.test(sqlQuery) || /OR\s+1\s*=\s*1/i.test(sqlQuery);

    if (loginOk) {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, user: rows[0].username, role: rows[0].role }),
        stagePass: hasOrTautology && loginOk,
        query: sqlQuery,
        queryResult: { columns: ['username', 'role'], rows: rows.map(r => [r.username, r.role]) },
      };
    }
    return {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Access denied' }),
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

function handleDiagnostic(query) {
  const host = query.host || '';
  if (!host) {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Please provide a host parameter' }),
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

  // Simulate injected commands
  const injectedOutputs = [];
  if (hasSeparator) {
    const commands = parseShellCommands(host);
    for (let i = 1; i < commands.length; i++) {
      injectedOutputs.push(simulateCommand(commands[i]));
    }
  }

  const hasCat = /\bcat\b/.test(host);
  const hasSecretFile = /\/etc\/secrets\/api_keys/.test(host);
  const stagePass = hasSeparator && hasCat && hasSecretFile;

  const output = pingOutput + (injectedOutputs.length ? '\n' + injectedOutputs.join('\n') : '');

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: shellCmd, output }),
    stagePass,
  };
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
  const catMatch = cmd.match(/^cat\s+(.*)/);
  if (catMatch) {
    const content = FAKE_FS[catMatch[1].trim()];
    if (content) return content;
    return `cat: ${catMatch[1].trim()}: No such file or directory`;
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
  const [path, qs] = url.split('?', 2);
  const query = {};
  if (qs) {
    for (const part of qs.split('&')) {
      const [k, ...v] = part.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v.join('='));
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
    data[decodeURIComponent(k)] = decodeURIComponent(v.join('='));
  }
  return data;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { handleRequest };
