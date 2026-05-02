# HackLab v2.0

Browser-based security training game that teaches 5 web vulnerabilities through an interactive shell simulator.

## Quick Start

```
npm install
npm run dev     # starts with --watch for auto-reload
```

Server runs at http://localhost:3000. No build step — plain JS, no bundler.

## Architecture

```
Browser (index.html)
  ├─ WebSocket ──► ws-handler.js ──► ShellSession.execute(cmd)
  │                                    ├─ Built-in commands (ls, cat, grep, etc.)
  │                                    ├─ curl ──► vulnerable-app.js (virtual HTTP)
  │                                    └─ sqlite3 ──► session SQLite DB
  └─ HTTP ──► /webapp/* ──► vulnerable-app.js (iframe rendering)
              /api/*    ──► game.js (stage switching, hints)
```

**Key insight**: There are no real shell commands or HTTP requests. The terminal is a shell *simulator* backed by a virtual filesystem (JSON tree). `curl` calls `vulnerable-app.js` in-process. `sqlite3` queries the real session SQLite DB.

### Server-side

- **`server.js`** — Express + WebSocket server. Mounts game API routes and the `/webapp/*` proxy for iframe rendering.
- **`src/terminal/ws-handler.js`** — WebSocket message handler. Dispatches commands to ShellSession, checks win conditions, provides near-miss feedback (nudges).
- **`src/shell/shell.js`** — ShellSession class. Manages cwd, history, sqlite mode. Dispatches to command handlers.
- **`src/shell/virtual-fs.js`** — Read-only in-memory filesystem. Nested JS object where dirs are objects and files are strings.
- **`src/shell/fs-data.js`** — The filesystem content (fake /etc, /var/www/megacorp, /home, etc). Contains clues players need to discover.
- **`src/shell/commands/`** — One file per command (ls, cat, grep, curl, sqlite3, etc).
- **`src/webapp/vulnerable-app.js`** — The "MegaCorp web app" that curl and the iframe hit. Contains intentional vulnerabilities for each stage. Also builds dashboard HTML pages for successful logins.
- **`src/stages/stage-checker.js`** — Stage definitions: missions, hints, success messages.
- **`src/stages/win-detector.js`** — Checks `result.stagePass` flag set by vulnerable-app route handlers.
- **`src/routes/game.js`** — REST API for stage switching, hints, session management. In-memory gameState map.
- **`src/db/session-manager.js`** — Creates per-player SQLite databases (copied from template). 30-min TTL cleanup.
- **`src/utils.js`** — Shared `escapeHtml` helper.

### Client-side (public/)

- **`index.html`** — Single-page layout: mission panel, SQL/shell monitor, terminal + browser tabs, success/completion modals.
- **`js/terminal.js`** — WebSocket connection, command input, history, tab completion, iframe form interception, browser tab rendering.
- **`js/app.js`** — UI state: stage dots, tab switching, per-stage state persistence (terminal, query panel, browser), success/completion modals, resize handles.
- **`js/query-display.js`** — SQL tokenizer with syntax highlighting, shell command display, result table rendering.
- **`css/style.css`** — Terminal hacker aesthetic (Fira Mono, green-on-black, CRT scanlines).

## The 5 Stages

| # | Vulnerability | Win Condition | Key File |
|---|--------------|---------------|----------|
| 1 | Information Leakage | Login as admin with leaked creds (admin/password123) | `handleLogin()` in vulnerable-app.js |
| 2 | IDOR | Access admin profile at /api/employees/4 | `handleEmployee()` |
| 3 | XSS | Inject `<script>stealCookie()</script>` via /api/search | `handleSearch()` |
| 4 | SQL Injection | Bypass /api/admin/login with `' OR 1=1 --` | `handleAdminLogin()` |
| 5 | Command Injection | Read /etc/secrets/api_keys.txt via /api/diagnostic | `handleDiagnostic()` |

Win conditions are evaluated inside each handler in `vulnerable-app.js` (sets `stagePass: true`). The win-detector just surfaces that flag.

## Data Flow for a Command

1. Player types in terminal → `terminal.js` sends via WebSocket
2. `ws-handler.js` receives → calls `shell.execute(command)`
3. `shell.js` parses pipes/chains → dispatches to command handler
4. Command handler (e.g. `curl.js`) calls `vulnerable-app.handleRequest()` → returns `{ stdout, stagePass, query, queryResult }`
5. `ws-handler.js` checks win condition, generates nudge feedback, sends response
6. `terminal.js` renders output, updates SQL monitor, triggers success modal if stage passed

## Sessions

Each player gets an isolated SQLite database (copied from `sessions/_template.db`). Session ID stored in `localStorage`. Sessions expire after 30 minutes of inactivity. Game state (current stage, completed stages) is in-memory only — not persisted across server restarts.

## Commands

`npm start` — production start
`npm run dev` — development with auto-reload
`npm test` — run all unit + integration tests
`npm run test:unit` — unit tests only
`npm run test:integration` — integration tests only
`npx playwright test tests/e2e` — E2E tests (requires server running on port 3000)

## Testing Policy

- **Always run tests after making changes.** Run `npm test` before considering any task complete.
- **Keep tests in sync with requirements.** When a stage, route, or game mechanic changes, update the corresponding tests in `tests/unit/`, `tests/integration/`, or `tests/e2e/` immediately — don't leave tests that pass against stale behavior.
- **New features need new tests.** Adding a stage, a route, or a paywall rule means adding test coverage for the happy path and the primary sad paths.
- Test files mirror the source structure: unit tests in `tests/unit/`, integration tests in `tests/integration/`, E2E in `tests/e2e/`.

## Deployment

Deployed on Railway. No environment variables required — `PORT` is auto-set by Railway.

## Common Patterns

- **Adding a new shell command**: Create `src/shell/commands/yourcommand.js`, add case to `_executeOne()` in `shell.js`, add to tab completion list in `_completeCommand()`, add to `help()` output in `core.js`.
- **Adding filesystem content**: Edit the tree in `src/shell/fs-data.js`. Directories are objects, files are strings.
- **Adding a new stage**: Add to `STAGES` array in `stage-checker.js`, add route handler in `vulnerable-app.js` with `stagePass` logic, add nudge in `getNudge()` in `ws-handler.js`, update `STAGE_IDS` / `MONITOR_TITLES` in frontend.
- **Changing vulnerable app responses**: Edit handlers in `src/webapp/vulnerable-app.js`. Login success pages are built by `buildDashboard()` / `buildAdminPanel()`.
