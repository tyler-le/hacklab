'use strict';
const { getTursoClient } = require('./turso');
async function initSchema() {
  const db = getTursoClient();
  if (!db) return;
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))` },
    { sql: `CREATE TABLE IF NOT EXISTS magic_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)` },
    { sql: `CREATE TABLE IF NOT EXISTS user_progress (user_id TEXT PRIMARY KEY, completed_stages TEXT NOT NULL DEFAULT '[]', current_stage INTEGER NOT NULL DEFAULT 0, advanced_unlocked INTEGER NOT NULL DEFAULT 0, stripe_session_id TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()))` },
  ], 'write');
}
module.exports = { initSchema };
