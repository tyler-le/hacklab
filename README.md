# HackLab

A free browser game where you learn real web security vulnerabilities by exploiting them. No setup, no downloads — just open the terminal and start hacking.

**[Play at playhacklab.com](https://playhacklab.com)**

---

## What is it?

HackLab drops you into a live terminal with shell access to a fake company's server. Each level gives you a real vulnerability to find and exploit. No guided walkthroughs until you ask for a hint.

**Free — 5 levels:**
| # | Vulnerability | OWASP |
|---|--------------|-------|
| 1 | Information Leakage | A05 — Security Misconfiguration |
| 2 | Broken Access Control (IDOR) | A01 — Broken Access Control |
| 3 | Cross-Site Scripting (XSS) | A03 — Injection |
| 4 | SQL Injection | A03 — Injection |
| 5 | Command Injection | A03 — Injection |

**Operation Blacksite — 5 advanced levels ($0.99):**
| # | Vulnerability | OWASP |
|---|--------------|-------|
| 6 | Price Manipulation | A04 — Insecure Design |
| 7 | Directory Traversal | A01 — Broken Access Control |
| 8 | Server-Side Request Forgery | A10 — SSRF |
| 9 | Mass Assignment | A04 — Insecure Design |
| 10 | Password Reset Poisoning | A01 — Broken Access Control |

---

## Running locally

```bash
npm install
npm run dev
```

Server runs at `http://localhost:3000`. No build step — plain JS, no bundler.

---

## Architecture

```
Browser
  ├─ WebSocket ──► ws-handler.js ──► ShellSession.execute(cmd)
  │                                    ├─ Built-in commands (ls, cat, grep, etc.)
  │                                    ├─ curl ──► vulnerable-app.js (virtual HTTP)
  │                                    └─ sqlite3 ──► session SQLite DB
  └─ HTTP ──► /webapp/* ──► vulnerable-app.js (iframe rendering)
              /api/*    ──► game.js (stage switching, hints)
```

There are no real shell commands or HTTP requests. The terminal is a simulator backed by a virtual filesystem. `curl` calls `vulnerable-app.js` in-process. `sqlite3` queries a real per-session SQLite database.

**Key files:**
- `src/webapp/vulnerable-app.js` — the intentionally vulnerable MegaCorp web app
- `src/shell/shell.js` — shell simulator, dispatches to command handlers
- `src/shell/fs-data.js` — virtual filesystem content (clues, source code, secrets)
- `src/stages/stage-checker.js` — stage definitions, missions, hints, success messages
- `src/routes/game.js` — REST API for session management, stage switching, hints
- `public/js/terminal.js` — WebSocket client, terminal rendering
- `public/js/app.js` — UI state, modals, paywall, stage dots

---

## Testing

```bash
npm test                        # unit + integration tests
npm run test:unit               # unit tests only
npm run test:integration        # integration tests only
npx playwright test tests/e2e   # E2E tests (requires server on port 3000)
```

Tests run automatically on every push via GitHub Actions.

---

## Deployment

Deployed on [Railway](https://railway.app). The only required environment variable in production is `STRIPE_SECRET_KEY` for the paywall. `PORT` is set automatically by Railway.

---

## Built by

[Tyler Le](https://buymeacoffee.com/tylerle) — if you enjoy it, buy me a coffee ☕
