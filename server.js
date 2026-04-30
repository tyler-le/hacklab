const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const sessionManager = require('./src/db/session-manager');
const { handleWebSocket } = require('./src/terminal/ws-handler');
const gameRoutes = require('./src/routes/game');
const { getGameState } = require('./src/routes/game');
const { handleRequest: handleWebappRequest } = require('./src/webapp/vulnerable-app');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Initialize template database
sessionManager.createTemplate();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Game API routes (session management, stage switching, hints)
app.use('/api', gameRoutes);

// Webapp routes — serves HTML for the Browser tab iframe.
// Proxies requests to the vulnerable app so curl and the iframe see the same responses.
app.all('/webapp/*', (req, res) => {
  const reqPath = req.params[0] ? '/' + req.params[0] : '/';
  const sessionId = req.query.sessionId || req.body?.sessionId;

  let sid = sessionId;
  if (!sid || !sessionManager.getSession(sid)) {
    sid = sessionManager.createSession();
  }

  const body = req.method === 'POST' ? require('querystring').stringify(req.body || {}) : null;
  const state = getGameState(sid);
  const result = handleWebappRequest(req.method, reqPath + (req._parsedUrl.search || ''), body, sid, state.currentStage);
  res.status(result.status).set(result.headers || {}).send(result.body);
});

// WebSocket connections (terminal interaction)
wss.on('connection', (ws) => {
  handleWebSocket(ws);
});

server.listen(PORT, () => {
  console.log(`[server] HackLab running at http://localhost:${PORT}`);
});

// Graceful shutdown
function shutdown() {
  console.log('[server] Shutting down...');
  wss.clients.forEach(ws => ws.close());
  server.close(() => {
    sessionManager.shutdown();
    process.exit(0);
  });
  // Force exit after 5s if connections don't close
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
