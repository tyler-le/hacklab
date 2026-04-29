# HackLab v2: Open-Ended Shell Simulator

## Context
HackLab v1 teaches 5 web security vulnerabilities but feels too guardrailed — each stage has a fixed set of commands with canned responses. Players can't explore the server, poke around files, or discover vulnerabilities organically. V2 replaces the command-specific routing with a real shell simulator backed by a virtual filesystem, where `curl` hits actual vulnerable endpoints and `sqlite3` queries the real session database. The goal: players feel like they have a real shell on a compromised server and must explore to find each vulnerability.

## Stack (unchanged)
- Node.js + Express, better-sqlite3, ws, uuid

## Architecture Overview

### New Layer: Virtual Filesystem + Shell Simulator
Instead of routing specific commands (login, visit, search, ping) to handlers, the terminal now runs a **shell simulator** that supports standard Unix commands against a **virtual filesystem**.

```
Player types command
  → WebSocket → ShellSession.execute(cmd)
    → CommandParser splits pipes/chains
    → Built-in command handler (ls, cat, curl, sqlite3, etc.)
    → Returns stdout/stderr strings
  → WebSocket → terminal renders output
```

### Key Design Decisions
- **Browser tab**: Sandboxed iframe renders vulnerable HTML pages visually, with a "View Source" toggle to see raw HTML
- **Shell prompt**: Full prompt with cwd — `www-data@megacorp:/var/www$`
- **SQL Monitor**: Kept — shows real queries triggered by curl and sqlite3 commands
- **All tabs always visible** — no tab hiding per stage, players choose their tools

## Project Structure (new/changed files marked with *)

```
game/
  package.json
  server.js                          # Minor changes: mount vulnerable-app routes
  src/
    db/
      seed.sql                       # * Expand with more tables/data for exploration
      session-manager.js             # Unchanged
    shell/                           # * NEW — entire directory
      virtual-fs.js                  # * VirtualFS class (JSON tree, path resolution)
      fs-data.js                     # * Filesystem contents per stage
      shell.js                       # * ShellSession class (cwd, env, command dispatch)
      command-parser.js              # * Parse pipes, semicolons, &&, ||, redirects
      commands/                      # * One file per command
        ls.js
        cd.js
        cat.js
        grep.js
        find.js
        curl.js                      # * Bridges to vulnerable-app via internal HTTP
        sqlite3.js                   # * Interactive SQL mode against session DB
        core.js                      # * whoami, id, pwd, hostname, echo, env, history
    webapp/                          # * NEW — the "vulnerable web app" that curl hits
      vulnerable-app.js              # * Express sub-app with real HTML responses
      views/                         # * HTML templates for each vulnerable page
        login.html                   # * Stage 1: has HTML comment with credentials
        portal.html                  # * Stage 2: employee profile pages
        search.html                  # * Stage 3: reflects search term unsanitized
        admin-login.html             # * Stage 4: login form (SQL injection target)
        diagnostic.html              # * Stage 5: ping tool form
    routes/
      auth.js                        # Kept for Stage 4 SQL injection (string concat)
      profile.js                     # Kept for Stage 2 IDOR
      search.js                      # Kept for Stage 3 XSS reflection
      diagnostic.js                  # Kept for Stage 5 command injection
      game.js                        # * Refactor: simpler stage metadata API
    stages/
      stage-checker.js               # * Rewrite: open-ended missions, no command lists
      win-detector.js                # * NEW: passive detection via hooks
    terminal/
      ws-handler.js                  # * Refactor: thin dispatcher to ShellSession
  public/
    index.html                       # * Add iframe for Browser tab, always show all tabs
    css/style.css                    # * Add iframe/view-source toggle styles
    js/
      app.js                         # * Refactor: all tabs always visible, iframe logic
      terminal.js                    # * Dynamic prompt from server, view-source toggle
      query-display.js               # Unchanged
```

## Virtual Filesystem (`src/shell/virtual-fs.js`)

A `VirtualFS` class backed by a nested JS object. Each node is either a directory (object with children) or a file (string content).

**Core API:**
- `resolve(path)` — resolve relative/absolute path from cwd
- `stat(path)` — returns `{type: 'file'|'dir', size, permissions}`
- `readFile(path)` — returns string content or throws
- `readDir(path)` — returns `[{name, type}]`
- `exists(path)` — boolean

**No write operations** — the filesystem is read-only (players explore, not modify).

### Filesystem Layout (`src/shell/fs-data.js`)

Exports a function `buildFilesystem(stageId)` that returns the full FS tree. Content varies by stage to provide appropriate clues.

```
/
├── etc/
│   ├── hostname          → "megacorp-web-01"
│   ├── passwd            → realistic entries (www-data, postgres, root)
│   ├── hosts             → "127.0.0.1 localhost\n10.0.1.50 db.internal"
│   └── secrets/
│       └── api_keys.txt  → AWS keys, Stripe keys, DB URL (Stage 5 target)
├── var/
│   ├── www/
│   │   └── megacorp/
│   │       ├── index.php
│   │       ├── login.php         → Stage 1: contains HTML comment in source
│   │       ├── portal.php        → Stage 2: profile?id=N in the code
│   │       ├── search.php        → Stage 3: unsanitized echo of $_GET['q']
│   │       ├── admin-login.php   → Stage 4: SQL concat visible in source
│   │       ├── diagnostic.php    → Stage 5: shell_exec("ping -c1 ".$_GET['host'])
│   │       ├── config.php        → DB credentials (clue)
│   │       └── .htaccess
│   ├── log/
│   │   ├── apache2/
│   │   │   ├── access.log       → Fake log entries with clues
│   │   │   └── error.log
│   │   └── auth.log             → Failed login attempts (clue for Stage 1)
│   └── lib/
│       └── megacorp/
│           └── megacorp.db      → Path hint for sqlite3 command
├── home/
│   ├── admin/
│   │   ├── .bash_history        → Clue: shows admin ran sensitive commands
│   │   └── notes.txt            → "TODO: remove test account from login page"
│   └── www-data/
├── tmp/
│   └── debug.log
└── proc/
    └── version                  → Linux version string
```

**PHP source files** contain readable pseudo-PHP that shows the vulnerability in the code itself. For example, `admin-login.php` would show:
```php
<?php
$query = "SELECT * FROM users WHERE username='" . $_POST['user'] . "' AND password='" . $_POST['pass'] . "'";
$result = $db->query($query);
```

This lets players discover the vulnerability by reading server source code, not by being told what to type.

## Shell Simulator (`src/shell/shell.js`)

A `ShellSession` class instantiated per WebSocket connection.

**State:** cwd, env vars, command history, session DB reference, stage context
**Prompt:** `www-data@megacorp:{cwd}$` — sent to client with each response

### Supported Commands

| Command | Implementation |
|---------|---------------|
| `ls [-la] [path]` | List VirtualFS directory |
| `cd [path]` | Change cwd (updates prompt) |
| `cat [file]` | Read VirtualFS file |
| `grep [-r] pattern [path]` | Search file contents |
| `find [path] -name pattern` | Search filesystem |
| `head / tail [-n N] [file]` | Partial file read |
| `pwd` | Print cwd |
| `whoami` | `www-data` |
| `id` | uid/gid info |
| `hostname` | `megacorp-web-01` |
| `echo` | Echo args |
| `env / printenv` | Show env vars |
| `history` | Command history |
| `file [path]` | File type info |
| `curl [url]` | HTTP request to vulnerable-app (see below) |
| `sqlite3 [dbpath]` | Interactive SQL mode (see below) |
| `clear` | Clear terminal |
| `help` | List available commands |
| `hint` | Stage hint (kept as escape valve) |

### Command Parser (`src/shell/command-parser.js`)
- Splits on `;`, `&&`, `||` (sequential execution)
- Splits on `|` (pipe: stdout of left → stdin of right, simulated for grep)
- Handles quoted strings (`"..."`, `'...'`)
- Handles basic glob expansion for `*`
- Unknown commands → `bash: {cmd}: command not found`

### `curl` Command (`src/shell/commands/curl.js`)
The bridge between the shell and the vulnerable web app.

```
curl http://localhost/login.php
curl http://localhost/portal.php?id=4
curl -d "user=admin&pass=password123" http://localhost/login.php
curl http://localhost/search.php?q=<script>stealCookie()</script>
curl http://localhost/diagnostic.php?host=localhost;cat+/etc/secrets/api_keys.txt
```

Internally makes a function call to `vulnerable-app.js` handlers (not real HTTP — stays in-process). Returns the HTML response body as terminal output.

Supports: `-d` (POST data), `-X` (method), `-v` (verbose/show headers), `-o` (suppress body, show status). Default is GET.

### `sqlite3` Command (`src/shell/commands/sqlite3.js`)
Opens an interactive SQL prompt against the session's SQLite database.

```
www-data@megacorp:/var/www$ sqlite3 /var/lib/megacorp/megacorp.db
SQLite version 3.39.0
sqlite> SELECT * FROM users;
sqlite> .tables
sqlite> .schema users
sqlite> .quit
```

**Mode switch:** When sqlite3 is active, the prompt changes to `sqlite>` and all input is executed as SQL against the real session DB. `.quit` exits back to shell.

Supports: `.tables`, `.schema [table]`, `.quit`, and raw SQL statements. SQL queries are sent to the SQL Monitor panel.

## Vulnerable Web App (`src/webapp/vulnerable-app.js`)

An Express sub-app mounted at `/webapp/` (internal) that serves HTML responses to `curl` requests. This is the "MegaCorp website" that players interact with.

**Routes:**
- `GET /login.php` → HTML login page (with `<!-- test account: admin / password123 -->` comment)
- `POST /login.php` → Stage 1: parameterized check; Stage 4: string-concatenated SQL
- `GET /portal.php?id=N` → Employee profile page (no auth check — IDOR)
- `GET /search.php?q=TERM` → Search results page (reflects term unsanitized — XSS)
- `POST /diagnostic.php` → Ping tool (parses shell separators — command injection)

Each route returns full HTML documents (not JSON). The curl command displays the raw HTML in terminal. The Browser tab iframe can also load these pages for visual rendering.

**Reuses existing route logic** from `auth.js`, `profile.js`, `search.js`, `diagnostic.js` — but wraps responses in HTML templates instead of returning JSON.

## Stages (Redesigned)

### Stage 1: Information Leakage
**Scenario:** You have shell access to the MegaCorp web server as `www-data`. Find a way to log into their employee portal.
**Objective:** Log in to the portal with valid credentials.
**Discovery path (example, not prescribed):**
1. `ls /var/www/megacorp/` → see the PHP files
2. `cat /var/www/megacorp/login.php` → see the HTML with comment containing credentials
3. `curl -d "user=admin&pass=password123" http://localhost/login.php` → successful login
**Alt path:** `curl http://localhost/login.php` → view source in Browser tab → see comment → use Login tab
**Win condition:** Server receives valid login with admin/password123 (detected via auth.js hook)

### Stage 2: Broken Access Control (IDOR)
**Scenario:** You're logged in as jsmith (id=1). Find the admin's sensitive data.
**Objective:** Access the admin's profile to find their API keys.
**Discovery path:**
1. `cat /var/www/megacorp/portal.php` → see `$_GET['id']` used directly, no auth check
2. `curl http://localhost/portal.php?id=1` → see own profile
3. `curl http://localhost/portal.php?id=4` → see admin profile with API keys
**Alt path:** Use Browser tab URL bar to navigate to `/portal.php?id=4`
**Win condition:** Admin profile (id=4) accessed and sensitive fields returned

### Stage 3: Cross-Site Scripting (XSS)
**Scenario:** The employee directory has a search feature. Find a way to steal the admin's session cookie.
**Objective:** Execute JavaScript in the context of the search page to steal cookies.
**Discovery path:**
1. `cat /var/www/megacorp/search.php` → see `echo $_GET['q']` without escaping
2. `curl "http://localhost/search.php?q=<b>test</b>"` → see HTML rendered unescaped
3. `curl "http://localhost/search.php?q=<script>stealCookie()</script>"` → XSS executes
**Alt path:** Use Browser tab to load search page, see script execute visually in iframe
**Win condition:** Search request contains `<script` and `stealCookie()` (detected via search.js hook)

### Stage 4: SQL Injection
**Scenario:** MegaCorp has a separate admin login page. Bypass the authentication.
**Objective:** Log in without knowing any password.
**Discovery path:**
1. `cat /var/www/megacorp/admin-login.php` → see string concatenation in SQL query
2. `curl -d "user='" http://localhost/admin-login.php` → SQL error reveals query structure
3. `curl -d "user=' OR 1=1 --" http://localhost/admin-login.php` → bypass successful
**Alt path:** Use Login tab; or `sqlite3 /var/lib/megacorp/megacorp.db` → explore schema → craft injection
**Win condition:** SQL injection query returns rows (detected via auth.js Stage 4 hook)

### Stage 5: Command Injection
**Scenario:** MegaCorp has a server diagnostic tool. Exploit it to read secret files.
**Objective:** Read `/etc/secrets/api_keys.txt` via the diagnostic tool.
**Discovery path:**
1. `cat /var/www/megacorp/diagnostic.php` → see `shell_exec("ping -c1 " . $_GET['host'])`
2. `curl "http://localhost/diagnostic.php?host=localhost"` → normal ping output
3. `curl "http://localhost/diagnostic.php?host=localhost;cat /etc/secrets/api_keys.txt"` → secrets leaked
**Win condition:** Diagnostic input contains separator + `cat` + `/etc/secrets/api_keys.txt`

### Stage Metadata Changes
- **Mission text:** Brief scenario + objective only (no command lists, no step-by-step)
- **Hints:** Still available via `hint` command, 3 progressive hints per stage
- **Help commands removed** — replaced by generic `help` showing all shell commands
- **Success text:** Kept short, explains the vulnerability class and defense

## Win Detector (`src/stages/win-detector.js`)

Passive detection — hooks into existing route handlers and shell commands.

**Hooks:**
- `auth.js` → emits event on successful login (Stage 1) or SQL injection (Stage 4)
- `profile.js` → emits event when admin profile accessed (Stage 2)
- `search.js` → emits event when XSS payload detected (Stage 3)
- `diagnostic.js` → emits event when command injection detected (Stage 5)

Each hook calls `winDetector.check(sessionId, stageId, data)` which evaluates the win condition and emits a `stageComplete` event on the WebSocket if met.

## WebSocket Handler Changes (`src/terminal/ws-handler.js`)

Simplified to a thin dispatcher:

```
on 'init' → create ShellSession, send prompt + stage mission
on 'command' →
  if sqlite3 mode: execute SQL, return result + query for SQL Monitor
  else: ShellSession.execute(command)
    → returns { stdout, stderr, prompt, query?, queryResult?, stagePass? }
  send response to client
```

Response format adds:
- `prompt` — dynamic shell prompt string (reflects cwd)
- `sqliteMode` — boolean, true when in sqlite3 interactive mode

## Frontend Changes

### `public/index.html`
- **Browser tab:** Replace URL bar response div with sandboxed iframe (`sandbox="allow-scripts allow-same-origin"`) + View Source toggle button
- **All tabs always visible** — remove stage-specific tab hiding
- **Login tab:** Keep as-is but wire to `/webapp/login.php` or `/webapp/admin-login.php` depending on stage

### `public/js/terminal.js`
- **Dynamic prompt:** Use `response.prompt` from server instead of hardcoded `hacklab>`
- **SQLite mode indicator:** When `sqliteMode` is true, show `sqlite>` prompt
- **View Source toggle:** Button switches iframe between rendered HTML and raw source view

### `public/js/app.js`
- **Remove `updateTabsForStage()`** — all tabs always shown
- **Add iframe navigation:** When curl fetches a URL, also load it in the Browser tab iframe
- **Stage mission:** Fetch from server, display as brief scenario text

## Implementation Order

1. **Virtual Filesystem** — `virtual-fs.js`, `fs-data.js` (the foundation everything else depends on)
2. **Command Parser** — `command-parser.js` (pipes, semicolons, quoting)
3. **Shell Commands** — `commands/core.js`, `ls.js`, `cd.js`, `cat.js`, `grep.js`, `find.js`
4. **Shell Session** — `shell.js` (ties VirtualFS + commands together)
5. **Vulnerable Web App** — `vulnerable-app.js` + HTML views (curl targets)
6. **curl command** — `commands/curl.js` (bridges shell to web app)
7. **sqlite3 command** — `commands/sqlite3.js` (interactive SQL mode)
8. **Win Detector** — `win-detector.js` (hooks into routes)
9. **Stage Redesign** — Rewrite `stage-checker.js` with open-ended missions
10. **WebSocket Refactor** — Slim down `ws-handler.js` to use ShellSession
11. **Frontend Updates** — iframe Browser tab, dynamic prompts, always-visible tabs
12. **Seed Data Expansion** — Richer `seed.sql` with more tables/data for exploration
13. **End-to-End Testing** — All 5 stages via multiple discovery paths

## Verification

1. `npm install && npm start` — server starts on http://localhost:3000
2. Open browser → Stage 1 loads, terminal shows `www-data@megacorp:/var/www$`
3. Test shell basics: `ls`, `cd /etc`, `cat /etc/hostname`, `pwd`
4. Test each stage via the "exploration" path:
   - Stage 1: `cat /var/www/megacorp/login.php` → see credentials → `curl -d "user=admin&pass=password123" http://localhost/login.php`
   - Stage 2: `curl http://localhost/portal.php?id=4` (or use Browser tab URL bar)
   - Stage 3: `curl "http://localhost/search.php?q=<script>stealCookie()</script>"` (or load in Browser tab iframe)
   - Stage 4: `cat /var/www/megacorp/admin-login.php` → see SQL concat → `curl -d "user=' OR 1=1 --" http://localhost/admin-login.php`
   - Stage 5: `curl "http://localhost/diagnostic.php?host=localhost;cat /etc/secrets/api_keys.txt"`
5. Test sqlite3: `sqlite3 /var/lib/megacorp/megacorp.db` → `.tables` → `SELECT * FROM users;` → `.quit`
6. Verify SQL Monitor shows queries from both curl and sqlite3
7. Verify Browser tab renders HTML from curl targets with View Source toggle
8. Verify stage dots turn green only on win condition
9. Verify session isolation across browser tabs
