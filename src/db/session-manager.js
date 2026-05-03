const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SESSIONS_DIR = path.join(__dirname, '..', '..', 'sessions');
const TEMPLATE_PATH = path.join(SESSIONS_DIR, '_template.db');
const SEED_PATH = path.join(__dirname, 'seed.sql');
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

// In-memory map of sessionId -> { db, lastAccess }
const activeSessions = new Map();

// Listeners notified when a session is destroyed (e.g. game.js cleans up gameState)
const destroyListeners = [];

function onSessionDestroyed(fn) {
  destroyListeners.push(fn);
}

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function createTemplate() {
  ensureSessionsDir();
  // In test runs multiple files call createTemplate() in parallel — skip if already exists
  if (fs.existsSync(TEMPLATE_PATH)) return;
  const db = new Database(TEMPLATE_PATH);
  const seed = fs.readFileSync(SEED_PATH, 'utf-8');
  db.exec(seed);
  db.close();
  console.log('[db] Template database created');
}

function createSession() {
  const sessionId = uuidv4();
  const dbPath = path.join(SESSIONS_DIR, `${sessionId}.db`);
  fs.copyFileSync(TEMPLATE_PATH, dbPath);
  const db = new Database(dbPath);
  activeSessions.set(sessionId, { db, lastAccess: Date.now() });
  return sessionId;
}

function getSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.lastAccess = Date.now();
    return session.db;
  }
  // Try to reopen from file
  const dbPath = path.join(SESSIONS_DIR, `${sessionId}.db`);
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath);
    activeSessions.set(sessionId, { db, lastAccess: Date.now() });
    return db;
  }
  return null;
}

function destroySession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.db.close();
    activeSessions.delete(sessionId);
  }
  const dbPath = path.join(SESSIONS_DIR, `${sessionId}.db`);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  for (const fn of destroyListeners) {
    fn(sessionId);
  }
}

function cleanupStaleSessions() {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      console.log(`[db] Cleaning up stale session: ${sessionId}`);
      destroySession(sessionId);
    }
  }
}

/** Close all open databases (called on server shutdown). */
function shutdown() {
  for (const [sessionId, session] of activeSessions) {
    session.db.close();
    activeSessions.delete(sessionId);
  }
  console.log('[db] All sessions closed');
}

// Run cleanup every 5 minutes
setInterval(cleanupStaleSessions, 5 * 60 * 1000).unref();

module.exports = { createTemplate, createSession, getSession, destroySession, onSessionDestroyed, shutdown };
