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

// --- PixelMart route snippets (Advanced Pack) ---
const PIXELMART_ROUTE_SNIPPETS = {
  // Stage 6: Price Manipulation
  5: [
    '// ============================================================',
    '// POST /shop/orders',
    '// VULNERABLE: price is read directly from req.body!',
    '// ============================================================',
    'router.post("/shop/orders", (req, res) => {',
    '  const { item, price, quantity } = req.body;',
    '',
    '  // VULNERABLE: using client-supplied price, never looked up server-side!',
    '  // TODO: look up price from product catalog in DB using item name',
    '  const total = parseFloat(price) * parseInt(quantity);',
    '',
    '  // Process payment at whatever price the client sent',
    '  const order = processPayment(item, total);',
    '  res.json({ success: true, order });',
    '});',
    '',
    '// GET /shop/cart?item=NAME&price=PRICE — shows cart with item and price',
    'router.get("/shop/cart", (req, res) => {',
    '  const { item, price } = req.query;',
    '  // Price passed through from product listing — client controls it',
    '  res.send(renderCartPage(item, price));',
    '});',
  ].join('\n'),

  // Stage 7: Directory Traversal
  6: [
    '// ============================================================',
    '// GET /shop/image?file=FILENAME',
    '// VULNERABLE: path.join without startsWith check allows traversal',
    '// ============================================================',
    'const BASE_DIR = "/var/pixelmart/images/";',
    '',
    'router.get("/shop/image", (req, res) => {',
    '  const file = req.query.file;',
    '  if (!file) return res.status(400).json({ error: "Missing file" });',
    '',
    '  // VULNERABLE: path.join allows ../ traversal out of BASE_DIR!',
    '  const filePath = path.join(BASE_DIR, file);',
    '',
    '  // Missing check: if (!filePath.startsWith(BASE_DIR)) return 403;',
    '  fs.readFile(filePath, (err, data) => {',
    '    if (err) return res.status(404).json({ error: "Not found" });',
    '    res.send(data);',
    '  });',
    '});',
  ].join('\n'),

  // Stage 8: File Upload Bypass
  7: [
    '// ============================================================',
    '// POST /shop/upload',
    '// VULNERABLE: case-sensitive denylist — .PHP bypasses .php check',
    '// ============================================================',
    'router.post("/shop/upload", (req, res) => {',
    '  const { filename, content } = req.body;',
    '',
    '  // VULNERABLE: case-sensitive check — .PHP, .JS, .SH bypass this!',
    '  if (filename.endsWith(".php") || filename.endsWith(".js") || filename.endsWith(".sh")) {',
    '    return res.status(403).json({ error: "File type not allowed" });',
    '  }',
    '',
    '  // BUG: .PHP passes this check because endsWith is case-sensitive',
    '  // Fix: filename.toLowerCase().endsWith(".php") || use allowlist',
    '  saveFile("/uploads/" + filename, content);',
    '  res.json({ success: true, path: "/uploads/" + filename });',
    '});',
  ].join('\n'),

  // Stage 9: Mass Assignment
  8: [
    '// ============================================================',
    '// POST /shop/register',
    '// VULNERABLE: Object.assign copies all req.body fields to user',
    '// ============================================================',
    'router.post("/shop/register", (req, res) => {',
    '  // VULNERABLE: all POST body fields are merged into user object!',
    '  // If the client sends role=admin, it gets set.',
    '  const user = Object.assign({ role: "user", verified: false }, req.body);',
    '',
    '  // Fix: explicitly whitelist allowed fields:',
    '  // const user = { username: req.body.username, password: req.body.password,',
    '  //   email: req.body.email, role: "user" };',
    '  db.insert("users", user);',
    '  res.json({ success: true, user: { username: user.username, role: user.role } });',
    '});',
  ].join('\n'),

  // Stage 10: Password Reset Poisoning
  9: [
    '// ============================================================',
    '// POST /shop/reset',
    '// VULNERABLE: reset URL built from req.headers.host',
    '// ============================================================',
    'router.post("/shop/reset", (req, res) => {',
    '  const { email } = req.body;',
    '  const token = generateResetToken(email);',
    '',
    '  // VULNERABLE: attacker controls the Host header!',
    '  // Fix: use process.env.BASE_URL instead of req.headers.host',
    '  const resetUrl = `http://${req.headers.host}/shop/reset/confirm?token=${token}`;',
    '',
    '  sendEmail(email, { subject: "Password Reset", body: resetUrl });',
    '  res.json({ success: true, preview: resetUrl });',
    '});',
  ].join('\n'),
};

const PIXELMART_NOTES = {
  5: [
    'TODO List (PixelMart admin):',
    '- CRITICAL: /shop/orders trusts client-supplied price param!',
    '- Price should be looked up server-side from product catalog',
    '- Any user can buy any item for $0.01 by modifying the POST body',
    '- Fix: look up price from DB using item name, never trust input',
    '',
    'Products and prices:',
    '  Laptop Pro: $999',
    '  Wireless Headphones: $299',
    '  Pixel Phone: $599',
    '  USB Drive: $49',
  ].join('\n'),
  6: [
    'TODO List (PixelMart admin):',
    '- /shop/image?file= is vulnerable to path traversal',
    '- path.join() used without path.resolve() validation',
    '- Can read ANY file the web server can access outside /var/pixelmart/images/',
    '- Fix: use path.resolve() then check startsWith(BASE_DIR)',
    '',
    'Image base dir: /var/pixelmart/images/',
    'WARNING: web server has read access outside this directory!',
  ].join('\n'),
  7: [
    'TODO List (PixelMart admin):',
    '- Upload filter blocks .php, .js, .sh — but check is case-sensitive!',
    '- shell.PHP bypasses the filter completely',
    '- Files go to /uploads/ and are served directly — no sandboxing',
    '- Fix: lowercase the filename before checking, use allowlist not denylist',
    '',
    'Blocked extensions (current, broken): .php, .js, .sh',
    'What bypasses it: .PHP, .JS, .SH, .Php, etc.',
  ].join('\n'),
  8: [
    'TODO List (PixelMart admin):',
    '- Registration endpoint uses Object.assign(user, req.body) — DANGEROUS',
    '- Any field in the POST body gets assigned to the user object',
    '- The \'role\' field defaults to \'user\' but can be overridden by the client',
    '- Fix: explicitly whitelist allowed fields: { username, password, email }',
    '',
    'User roles: \'user\' (default), \'seller\', \'admin\'',
    'Admin panel: /shop/admin',
  ].join('\n'),
  9: [
    'TODO List (PixelMart admin):',
    '- Password reset builds URL from request Host header — NEVER do this!',
    '- Attacker can set Host: evil.com to redirect reset link to their server',
    '- Reset token is valid and can be used to take over any account',
    '- Fix: hardcode base URL in server config, never trust Host header for URL generation',
    '',
    'Reset endpoint: /shop/reset',
    'Reset URL format: http://{HOST}/shop/reset/confirm?token={TOKEN}',
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
  const isPixelMartStage = stage >= 5;

  // Build PixelMart filesystem entries if in advanced stages
  const pixelMartVar = isPixelMartStage ? {
    pixelmart: {
      images: {
        'laptop.jpg': '[Binary JPEG — Laptop Pro product image]',
        'headphones.jpg': '[Binary JPEG — Wireless Headphones product image]',
        'phone.jpg': '[Binary JPEG — Pixel Phone product image]',
        'usb.jpg': '[Binary JPEG — USB Drive product image]',
      },
      admin: {},
      uploads: {},
    },
    www: {
      pixelmart: {
        'routes.js': ROUTES_HEADER + (PIXELMART_ROUTE_SNIPPETS[stage] || '') + ROUTES_FOOTER,
        'notes.txt': PIXELMART_NOTES[stage] || PIXELMART_NOTES[5],
        'server.js': [
          'const express = require("express");',
          'const path = require("path");',
          'const fs = require("fs");',
          'const db = require("./db");',
          'const routes = require("./routes");',
          '',
          'const app = express();',
          'app.use(express.json());',
          'app.use(express.urlencoded({ extended: true }));',
          '',
          '// PixelMart e-commerce API',
          'app.use("/shop", routes);',
          '',
          '// Static uploads — served directly (no sandbox!)',
          'app.use("/uploads", express.static("/var/pixelmart/uploads"));',
          '',
          'app.listen(3002, () => {',
          '  console.log("PixelMart running on port 3002");',
          '});',
        ].join('\n'),
      },
    },
  } : {};

  const pixelMartBashHistory = isPixelMartStage ? [
    'cd /var/www/pixelmart',
    'cat routes.js',
    'cat notes.txt',
    'ls /var/pixelmart/images/',
    'curl http://portal.megacorp.internal/shop',
    'curl "http://portal.megacorp.internal/shop/image?file=laptop.jpg"',
    'curl -X POST http://portal.megacorp.internal/shop/orders -d "item=Laptop+Pro&price=0.01&quantity=1"',
    'curl -X POST http://portal.megacorp.internal/shop/upload -d "filename=shell.PHP&content=test"',
    'curl -X POST http://portal.megacorp.internal/shop/register -d "username=hacker&password=test&email=h@x.com&role=admin"',
    'curl -X POST http://portal.megacorp.internal/shop/reset -d "email=admin@pixelmart.com" -H "Host: evil.com"',
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
          'notes.txt': isPixelMartStage ? 'This MegaCorp portal is no longer the focus — check /var/www/pixelmart/ instead.' : (NOTES[stage] || NOTES[0]),
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
        ...(isPixelMartStage ? pixelMartVar.www : {}),
      },
      ...(isPixelMartStage ? { pixelmart: pixelMartVar.pixelmart } : {}),
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
        '.bash_history': pixelMartBashHistory,
        'notes.txt': isPixelMartStage ? (PIXELMART_NOTES[stage] || PIXELMART_NOTES[5]) : (NOTES[stage] || NOTES[0]),
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
