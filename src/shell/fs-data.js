/**
 * Filesystem contents for the virtual shell.
 * Returns a nested object: directories are objects, files are strings.
 * Accepts a stage index so each level only exposes the relevant vulnerable code.
 */

// --- Per-stage routes.js source code ---
// Each stage shows only the route the player needs to exploit.

const ROUTES_HEADER = [
  'const express = require("express");',
  'const { execSync } = require("child_process");',
  'const db = require("./db");',
  'const router = express.Router();',
  '',
].join('\n');

const ROUTES_FOOTER = '\nmodule.exports = router;';

const ROUTE_SNIPPETS = {
  // Stage 1: Information Leakage — credentials in HTML comment
  0: [
    '// ============================================================',
    '// GET /login',
    '// Serves the login page.',
    '// ============================================================',
    'router.get("/login", (req, res) => {',
    '  // TODO: remove this before production!!!',
    '  // <!-- default test account: admin / password123 -->',
    '  res.send(`',
    '    <h1>MegaCorp Employee Portal</h1>',
    '    <!-- default test account: admin / password123 -->',
    '    <form method="POST" action="/login">',
    '      <input name="user" placeholder="Username" />',
    '      <input name="pass" type="password" placeholder="Password" />',
    '      <button type="submit">Sign In</button>',
    '    </form>',
    '  `);',
    '});',
    '',
    '// ============================================================',
    '// POST /login',
    '// Authenticates a user with parameterized query (safe).',
    '// ============================================================',
    'router.post("/login", (req, res) => {',
    '  const { user, pass } = req.body;',
    '  const row = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(user, pass);',
    '  if (row) {',
    '    res.json({ success: true, user: row.username, role: row.role });',
    '  } else {',
    '    res.status(401).json({ error: "Invalid credentials" });',
    '  }',
    '});',
  ].join('\n'),

  // Stage 2: IDOR — no authorization check on employee profiles
  1: [
    '// ============================================================',
    '// GET /api/employees/:id',
    '// Returns employee profile by ID.',
    '// NOTE: No authorization check — any user can view any profile!',
    '// TODO: add permission check before release',
    '// ============================================================',
    'router.get("/api/employees/:id", (req, res) => {',
    '  const id = parseInt(req.params.id);',
    '  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);',
    '  if (!user) return res.status(404).json({ error: "Employee not found" });',
    '  res.json(user);',
    '});',
  ].join('\n'),

  // Stage 3: XSS — user input inserted into HTML without escaping
  2: [
    '// ============================================================',
    '// GET /api/search?q=TERM',
    '// Searches employee directory. Results are rendered into HTML.',
    '// NOTE: Admin browses this page while logged in (session cookie set)',
    '// ============================================================',
    'router.get("/api/search", (req, res) => {',
    '  const q = req.query.q || "";',
    '  const rows = db.prepare(',
    '    "SELECT username, email, department FROM users WHERE username LIKE ? OR department LIKE ?"',
    '  ).all(`%${q}%`, `%${q}%`);',
    '',
    '  // Set admin session cookie',
    '  res.setHeader("Set-Cookie", "session=admin_token_7f3k9x; Path=/");',
    '',
    '  // BUG: User input is inserted directly into HTML without escaping!',
    '  const html = `',
    '    <h1>Employee Directory</h1>',
    '    <p>Showing results for: ${q}</p>',
    '    <table>${rows.map(r => `<tr><td>${r.username}</td><td>${r.email}</td></tr>`).join("")}</table>',
    '  `;',
    '  res.send(html);',
    '});',
  ].join('\n'),

  // Stage 4: SQL Injection — string concatenation in SQL query
  3: [
    '// ============================================================',
    '// POST /api/admin/login',
    '// Admin login — VULNERABLE: uses string concatenation for SQL!',
    '// ============================================================',
    'router.post("/api/admin/login", (req, res) => {',
    '  const { user, pass } = req.body;',
    '',
    '  // VULNERABLE: string concatenation instead of parameterized query!',
    "  const query = `SELECT * FROM users WHERE username='${user}' AND password='${pass}'`;",
    '  try {',
    '    const rows = db.prepare(query).all();',
    '    if (rows.length > 0) {',
    '      res.json({ success: true, user: rows[0].username, role: rows[0].role });',
    '    } else {',
    '      res.status(401).json({ error: "Access denied" });',
    '    }',
    '  } catch (err) {',
    '    // Oops — leaking SQL errors to the client',
    '    res.status(500).json({ error: err.message, query });',
    '  }',
    '});',
  ].join('\n'),

  // Stage 5: Command Injection — user input passed to shell
  4: [
    '// ============================================================',
    '// GET /api/diagnostic?host=HOST',
    '// Server health check — pings a host.',
    '// VULNERABLE: user input passed directly to shell command!',
    '// ============================================================',
    'router.get("/api/diagnostic", (req, res) => {',
    '  const host = req.query.host;',
    '  if (!host) return res.json({ error: "Please provide a host parameter" });',
    '',
    '  // VULNERABLE: user input goes directly into shell command!',
    '  const cmd = `ping -c 1 ${host}`;',
    '  try {',
    '    const output = execSync(cmd, { timeout: 5000 }).toString();',
    '    res.json({ command: cmd, output });',
    '  } catch (err) {',
    '    res.json({ command: cmd, output: err.stdout?.toString() || err.message });',
    '  }',
    '});',
  ].join('\n'),
};

// --- Sentinel route snippets (Operation Blacksite) ---
const SENTINEL_ROUTE_SNIPPETS = {
  // Stage 6: Cookie Tampering
  5: [
    '// ============================================================',
    '// GET /sentinel/dashboard',
    '// Requires clearance >= 5 (read from cookie)',
    '// ============================================================',
    'router.get("/sentinel/dashboard", (req, res) => {',
    '  const clearance = parseInt(req.cookies.clearance || "0");',
    '  if (clearance < 5) {',
    '    return res.status(403).send("Insufficient clearance level.");',
    '  }',
    '  // Show surveillance dashboard with SENTINEL_CTRL_8x2kPq token',
    '  res.send(buildDashboard());',
    '});',
    '',
    '// POST /sentinel/login',
    '// Sets clearance=1 cookie on success',
    'router.post("/sentinel/login", (req, res) => {',
    '  const { user, pass } = req.body;',
    '  const row = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(user, pass);',
    '  if (row) {',
    '    // Clearance starts at 1 — can this be tampered?',
    '    res.cookie("clearance", "1", { path: "/" });',
    '    res.redirect("/sentinel/dashboard");',
    '  } else {',
    '    res.status(401).send("Invalid credentials");',
    '  }',
    '});',
  ].join('\n'),

  // Stage 7: HTTP Verb Tampering
  6: [
    '// ============================================================',
    '// /sentinel/evidence',
    '// VULNERABLE: only blocks GET — other methods bypass the check!',
    '// ============================================================',
    'router.all("/sentinel/evidence", (req, res) => {',
    '  if (req.method === "GET") {',
    '    return res.status(403).send("Forbidden — GET requests are not permitted.");',
    '  }',
    '  // BUG: Only GET is blocked — POST, PUT, DELETE all get through!',
    '  res.send(buildEvidenceLocker());',
    '});',
  ].join('\n'),

  // Stage 8: Verbose Errors
  7: [
    '// ============================================================',
    '// GET /sentinel/report?id=NUMBER',
    '// VULNERABLE: unhandled error exposes config/credentials',
    '// ============================================================',
    'router.get("/sentinel/report", async (req, res) => {',
    '  const id = parseInt(req.query.id); // NaN if non-numeric!',
    '  try {',
    '    // Crashes if id is NaN — parseInt("x") === NaN',
    '    const report = await db.prepare("SELECT * FROM reports WHERE id = ?").get(id);',
    '    if (!report) return res.status(404).send("Report not found");',
    '    res.json(report);',
    '  } catch (err) {',
    '    // VULNERABLE: full error + config leaked to client in debug mode!',
    '    res.status(500).json({',
    '      error: err.message,',
    '      stack: err.stack,',
    '      config: app.get("config"), // exposes dbPassword!',
    '    });',
    '  }',
    '});',
  ].join('\n'),

  // Stage 9: Hidden Debug Param
  8: [
    '// ============================================================',
    '// GET /sentinel/exports',
    '// VULNERABLE: ?debug=true bypasses auth — never removed!',
    '// TODO: remove ?debug=true BEFORE PRODUCTION — Marcus 2024-03-14',
    '// ============================================================',
    'router.get("/sentinel/exports", (req, res) => {',
    '  // TODO: remove this before going live!!!',
    '  if (req.query.debug === "true") {',
    '    return res.json({',
    '      debug: true,',
    '      debugKey: process.env.DEBUG_KEY,',
    '      config: app.locals.config,',
    '    });',
    '  }',
    '',
    '  if (!req.session.adminAuth) {',
    '    return res.status(403).send("Forbidden");',
    '  }',
    '  res.json(getExportList());',
    '});',
  ].join('\n'),

  // Stage 10: Path Traversal
  9: [
    '// ============================================================',
    '// GET /sentinel/download?file=FILENAME',
    '// VULNERABLE: path.join without sanitization allows traversal',
    '// ============================================================',
    'const BASE_DIR = "/var/sentinel/files/";',
    '',
    'router.get("/sentinel/download", (req, res) => {',
    '  const file = req.query.file;',
    '  if (!file) return res.status(400).send("Missing file parameter");',
    '',
    '  // VULNERABLE: path.join allows ../ traversal out of BASE_DIR!',
    '  const filePath = path.join(BASE_DIR, file);',
    '',
    '  // Missing check: filePath.startsWith(BASE_DIR)',
    '  fs.readFile(filePath, "utf8", (err, data) => {',
    '    if (err) return res.status(404).send("File not found");',
    '    res.send(data);',
    '  });',
    '});',
  ].join('\n'),
};

const SENTINEL_NOTES = {
  5: [
    'TODO List (Sentinel admin):',
    '- Cookie-based clearance is NOT secure — needs server-side session',
    '- jsmith logged in with clearance=1, but cookie can be tampered',
    '- Dashboard requires clearance=5',
    '',
    'Credentials: jsmith / password123',
    'Endpoint: /sentinel/login → /sentinel/dashboard',
  ].join('\n'),
  6: [
    'TODO List (Sentinel admin):',
    '- Evidence locker only blocks GET — POST/PUT/DELETE bypass the check!',
    '- Need to implement proper auth middleware, not method filtering',
    '- Fix: use auth middleware before the route, not inside it',
  ].join('\n'),
  7: [
    'TODO List (Sentinel admin):',
    '- Report generator crashes on non-numeric IDs',
    '- Error handler is leaking app config to the client — CRITICAL',
    '- Must wrap parseInt and validate before hitting the DB',
    '- Disable debug mode in production!',
  ].join('\n'),
  8: [
    'TODO List (Sentinel admin):',
    '- REMOVE ?debug=true from exports endpoint before next deploy',
    '- This was left in for testing and completely bypasses auth',
    '- Marcus added it, Sarah flagged it, nobody removed it',
  ].join('\n'),
  9: [
    'TODO List (Sentinel admin):',
    '- Path traversal in /sentinel/download — URGENT',
    '- path.join(BASE_DIR, file) does not prevent ../ escaping the base',
    '- Fix: use path.resolve() and check startsWith(BASE_DIR)',
    '- /etc/sentinel/master.key must NOT be accessible from the web',
    '',
    'Note: master.key is at /etc/sentinel/master.key',
  ].join('\n'),
};

// Per-stage admin notes — only hint at the current vulnerability
const NOTES = {
  0: [
    'TODO List (admin):',
    '- Remove test account credentials from login page HTML',
    '- Why did I leave that comment in the source code??',
  ].join('\n'),
  1: [
    'TODO List (admin):',
    '- Fix /api/employees/:id to check user permissions before returning data',
    '- Anyone can view any profile right now — just change the ID number',
    '',
    'Employee IDs:',
    '  1 - jsmith (Sales)',
    '  2 - amendes (Marketing)',
    '  3 - kwilson (Engineering)',
    '  4 - admin (IT)',
    '  5 - dbrown (HR)',
  ].join('\n'),
  2: [
    'TODO List (admin):',
    '- Sanitize search input on /api/search (Karen reported weird HTML showing up)',
    '- User input goes straight into the page without escaping!',
    '- Admin session cookie is set on every search page load — is that safe?',
  ].join('\n'),
  3: [
    'TODO List (admin):',
    '- Switch /api/admin/login to use parameterized queries like /login',
    '- The admin login concatenates user input directly into SQL — this is dangerous',
  ].join('\n'),
  4: [
    'TODO List (admin):',
    '- Restrict /api/diagnostic to admin IPs only',
    '- User input goes directly into a shell command — anyone could inject commands',
    '- Rotate API keys in /etc/secrets/ (last rotated 6+ months ago!)',
  ].join('\n'),
};

function buildFilesystem(stageIndex) {
  const stage = stageIndex || 0;
  const isSentinelStage = stage >= 5;

  // Build sentinel filesystem entries if in Blacksite stages
  const sentinelEtc = isSentinelStage ? {
    sentinel: {
      'master.key': [
        'MASTER_KEY_Zx9mK2pQrL',
        '# Project Sentinel — Master Encryption Key',
        '# Generated: 2024-03-01 | Rotated: NEVER',
        '# WARNING: This key encrypts all surveillance data for 4,200 employees',
        '# KEEP OFFLINE — DO NOT COMMIT TO SOURCE CONTROL',
        'algorithm: AES-256-GCM',
        'key_id: sentinel-master-v1',
        'issued_to: MegaCorp Security Division',
        'expires: 2099-12-31',
      ].join('\n'),
      'config.json': JSON.stringify({
        service: 'sentinel-network',
        version: '4.2.1',
        baseDir: '/var/sentinel/files/',
        dbHost: 'sentinel-db.internal:5432',
        dbUser: 'sentinel_app',
        keyFile: '/etc/sentinel/master.key',
      }, null, 2),
    },
  } : {};

  const sentinelVar = isSentinelStage ? {
    sentinel: {
      files: {
        'report.pdf': '[Binary PDF — Quarterly Surveillance Report Q4 2024]',
        'README.txt': 'Files are served via /sentinel/download?file=FILENAME\nBase directory: /var/sentinel/files/',
      },
    },
    www: {
      sentinel: {
        'routes.js': ROUTES_HEADER + (SENTINEL_ROUTE_SNIPPETS[stage] || '') + ROUTES_FOOTER,
        'notes.txt': SENTINEL_NOTES[stage] || SENTINEL_NOTES[5],
        'server.js': [
          'const express = require("express");',
          'const path = require("path");',
          'const fs = require("fs");',
          'const cookieParser = require("cookie-parser");',
          'const db = require("./db");',
          'const routes = require("./routes");',
          '',
          'const app = express();',
          'app.use(express.json());',
          'app.use(express.urlencoded({ extended: true }));',
          'app.use(cookieParser());',
          '',
          '// Sentinel monitoring service — CLASSIFIED',
          'app.use("/sentinel", routes);',
          '',
          'app.locals.config = {',
          '  dbPassword: process.env.SENTINEL_DB_PASS,',
          '  keyFile: "/etc/sentinel/master.key",',
          '};',
          '',
          'app.listen(3001, () => {',
          '  console.log("Sentinel network running on port 3001");',
          '});',
        ].join('\n'),
      },
    },
  } : {};

  const sentinelBashHistory = isSentinelStage ? [
    'cd /var/www/sentinel',
    'cat routes.js',
    'cat /etc/sentinel/master.key',
    'curl -d "user=jsmith&pass=password123" http://portal.megacorp.internal/sentinel/login',
    'curl -H "Cookie: clearance=5" http://portal.megacorp.internal/sentinel/dashboard',
    'curl -X POST http://portal.megacorp.internal/sentinel/evidence',
    'curl "http://portal.megacorp.internal/sentinel/report?id=x"',
    'curl "http://portal.megacorp.internal/sentinel/exports?debug=true"',
    'curl "http://portal.megacorp.internal/sentinel/download?file=../../../etc/sentinel/master.key"',
  ].join('\n') : [
    'cd /var/www/megacorp',
    'cat routes.js',
    'sqlite3 /var/lib/megacorp/megacorp.db "SELECT * FROM users"',
    'cat /etc/secrets/api_keys.txt',
    'curl http://portal.megacorp.internal/api/diagnostic?host=localhost',
    'pm2 restart megacorp',
  ].join('\n');

  return {
    etc: {
      hostname: 'megacorp-web-01',
      hosts: '127.0.0.1\tlocalhost\n10.0.1.50\tdb.internal\n10.0.1.10\tmail.internal',
      passwd: [
        'root:x:0:0:root:/root:/bin/bash',
        'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
        'postgres:x:26:26:PostgreSQL Server:/var/lib/pgsql:/bin/bash',
        'admin:x:1000:1000:MegaCorp Admin:/home/admin:/bin/bash',
        'jsmith:x:1001:1001:John Smith:/home/jsmith:/bin/bash',
      ].join('\n'),
      'resolv.conf': 'nameserver 10.0.1.1\nsearch megacorp.local',
      crontab: '# MegaCorp crontab\n0 2 * * * /usr/local/bin/backup.sh\n*/5 * * * * /usr/local/bin/health-check.sh',
      secrets: {
        'api_keys.txt': [
          '# MegaCorp Production API Keys',
          '# Last rotated: 2024-01-15 (overdue!)',
          '',
          'AWS_SECRET_KEY=AKIA3R9F8GHSL29XKMP4',
          'STRIPE_LIVE_KEY=sk_live_4eC39HqLyjWDarjtT1',
          'DATABASE_URL=postgres://admin:S3cretP@ss!@prod-db:5432/megacorp',
          'SLACK_WEBHOOK=https://hooks.slack.com/services/T0DEADBEEF/B0DEADBEEF/xyzzy',
        ].join('\n'),
      },
      ...sentinelEtc,
    },
    var: {
      www: {
        megacorp: {
          'package.json': [
            '{',
            '  "name": "megacorp-portal",',
            '  "version": "1.0.0",',
            '  "description": "MegaCorp Employee Portal",',
            '  "main": "server.js",',
            '  "dependencies": {',
            '    "express": "^4.21.0",',
            '    "better-sqlite3": "^11.7.0",',
            '    "child_process": "^1.0.2"',
            '  }',
            '}',
          ].join('\n'),
          'server.js': [
            'const express = require("express");',
            'const db = require("./db");',
            'const routes = require("./routes");',
            '',
            'const app = express();',
            'app.use(express.json());',
            'app.use(express.urlencoded({ extended: true }));',
            '',
            '// Serve the frontend',
            'app.use(express.static("public"));',
            '',
            '// Mount API routes',
            'app.use(routes);',
            '',
            'app.listen(3000, () => {',
            '  console.log("MegaCorp Portal running on http://portal.megacorp.internal");',
            '});',
          ].join('\n'),
          'db.js': [
            'const Database = require("better-sqlite3");',
            'const path = require("path");',
            '',
            '// Connect to SQLite database',
            'const db = new Database(path.join(__dirname, "../../../var/lib/megacorp/megacorp.db"));',
            '',
            '// Database credentials (also in /etc/secrets/api_keys.txt)',
            '// DB_USER: megacorp_app',
            '// DB_PASS: mc_db_2024!',
            '',
            'module.exports = db;',
          ].join('\n'),
          'routes.js': ROUTES_HEADER + (ROUTE_SNIPPETS[stage] || '') + ROUTES_FOOTER,
          'notes.txt': NOTES[stage] || NOTES[0],
          node_modules: {
            '.package-lock.json': '{ "lockfileVersion": 3 }',
          },
          '.env': [
            '# MegaCorp environment variables',
            'PORT=3000',
            'DB_PATH=/var/lib/megacorp/megacorp.db',
            'SESSION_SECRET=megacorp_secret_key_do_not_share',
          ].join('\n'),
        },
        ...(isSentinelStage ? sentinelVar.www : {}),
      },
      ...(isSentinelStage ? { sentinel: sentinelVar.sentinel } : {}),
      log: {
        nginx: {
          'access.log': [
            '10.0.1.100 - admin [15/Jan/2025:09:15:23 +0000] "GET /api/employees/4 HTTP/1.1" 200 1532',
            '10.0.1.100 - admin [15/Jan/2025:09:15:45 +0000] "GET /api/diagnostic?host=localhost HTTP/1.1" 200 892',
            '10.0.1.55 - jsmith [15/Jan/2025:09:22:10 +0000] "GET /api/employees/1 HTTP/1.1" 200 1204',
            '10.0.1.55 - jsmith [15/Jan/2025:09:22:15 +0000] "GET /api/search?q=wilson HTTP/1.1" 200 756',
            '10.0.1.200 - - [15/Jan/2025:10:01:33 +0000] "POST /login HTTP/1.1" 401 52',
            '10.0.1.200 - - [15/Jan/2025:10:01:45 +0000] "POST /login HTTP/1.1" 401 52',
            '10.0.1.200 - - [15/Jan/2025:10:02:01 +0000] "POST /login HTTP/1.1" 200 1532',
          ].join('\n'),
          'error.log': [
            '[Wed Jan 15 10:01:33 2025] [error] [client 10.0.1.200] Authentication failed for user: root',
            '[Wed Jan 15 10:01:45 2025] [error] [client 10.0.1.200] Authentication failed for user: administrator',
            '[Thu Jan 16 03:14:22 2025] [warn] SqliteError: near "\'": syntax error — POST /api/admin/login',
          ].join('\n'),
        },
        'auth.log': [
          'Jan 15 10:01:33 megacorp-web-01 sshd[1234]: Failed password for root from 10.0.1.200 port 44322 ssh2',
          'Jan 15 10:01:45 megacorp-web-01 sshd[1235]: Failed password for admin from 10.0.1.200 port 44323 ssh2',
          'Jan 15 10:02:01 megacorp-web-01 sshd[1236]: Accepted password for admin from 10.0.1.200 port 44324 ssh2',
          'Jan 16 02:00:00 megacorp-web-01 CRON[5678]: pam_unix(cron:session): session opened for user root',
        ].join('\n'),
      },
      lib: {
        megacorp: {
          'megacorp.db': '[SQLite 3 database — use sqlite3 command to open]',
        },
      },
    },
    home: {
      admin: {
        '.bash_history': sentinelBashHistory,
        'notes.txt': isSentinelStage ? (SENTINEL_NOTES[stage] || SENTINEL_NOTES[5]) : (NOTES[stage] || NOTES[0]),
        '.ssh': {
          'authorized_keys': 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ... admin@megacorp',
        },
      },
      jsmith: {
        '.bash_history': 'ls\npwd\nwhoami',
        'readme.txt': [
          'Welcome to MegaCorp! Your profile is at http://portal.megacorp.internal/api/employees/1',
          '',
          'Employee Directory:',
          '  ID 1 - jsmith (Sales)',
          '  ID 2 - amendes (Marketing)',
          '  ID 3 - kwilson (Engineering)',
          '  ID 4 - admin (IT)',
          '  ID 5 - dbrown (HR)',
        ].join('\n'),
      },
      'www-data': {},
    },
    tmp: {
      'debug.log': 'MegaCorp Debug Log\n[2025-01-15 09:00:00] Server started\n[2025-01-15 09:15:23] Admin login from 10.0.1.100\n[2025-01-16 03:14:22] SqliteError in /api/admin/login — possible injection attempt?',
    },
    proc: {
      version: 'Linux version 5.15.0-generic (buildd@lcy02-amd64-045) (gcc (Ubuntu 11.4.0-1ubuntu1~22.04) 11.4.0) #1 SMP x86_64',
    },
  };
}

module.exports = { buildFilesystem };
