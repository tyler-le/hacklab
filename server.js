const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const sessionManager = require('./src/db/session-manager');
const { handleWebSocket } = require('./src/terminal/ws-handler');
const authRoutes = require('./src/routes/auth');
const profileRoutes = require('./src/routes/profile');
const searchRoutes = require('./src/routes/search');
const diagnosticRoutes = require('./src/routes/diagnostic');
const gameRoutes = require('./src/routes/game');
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

// API routes
app.use('/api', authRoutes);
app.use('/api', profileRoutes);
app.use('/api', searchRoutes);
app.use('/api', diagnosticRoutes);
app.use('/api', gameRoutes);

// Webapp routes (serve HTML for Browser tab iframe)
app.all('/webapp/*', (req, res) => {
  const path = req.params[0] ? '/' + req.params[0] : '/';
  const sessionId = req.query.sessionId || req.body?.sessionId;
  // Try to find a valid session, or create a temporary one
  let sid = sessionId;
  if (!sid || !sessionManager.getSession(sid)) {
    // Use the first available session or create one
    sid = sessionManager.createSession();
  }
  const body = req.method === 'POST' ? require('querystring').stringify(req.body || {}) : null;
  const result = handleWebappRequest(req.method, path + (req._parsedUrl.search || ''), body, sid);
  res.status(result.status).set(result.headers || {}).send(result.body);
});

// WebSocket connections
wss.on('connection', (ws) => {
  handleWebSocket(ws);
});

server.listen(PORT, () => {
  console.log(`[server] HackLab running at http://localhost:${PORT}`);
});
