'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getTursoClient } = require('../db/turso');

const COOKIE_NAME = 'hacklab_token';

function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-secret-change-in-prod';
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const re = new RegExp('(?:^|;)\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)');
  const m = cookieHeader.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

// ─── requireAuth middleware ───────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!token) return res.status(401).json({ requiresAuth: true });

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ requiresAuth: true });
  }
}

// ─── GET /api/progress ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const db = getTursoClient();
  if (!db) return res.json({ found: false });

  try {
    const result = await db.execute({
      sql: 'SELECT completed_stages, current_stage, advanced_unlocked, stripe_session_id FROM user_progress WHERE user_id = ?',
      args: [req.userId],
    });

    if (!result.rows.length) return res.json({ found: false });

    const row = result.rows[0];
    return res.json({
      found: true,
      completedStages: JSON.parse(row.completed_stages || '[]'),
      currentStage: row.current_stage,
      advancedUnlocked: !!row.advanced_unlocked,
      stripeSessionId: row.stripe_session_id || null,
    });
  } catch (err) {
    console.error('[progress] GET error:', err.message);
    return res.json({ found: false });
  }
});

// ─── POST /api/progress ───────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const db = getTursoClient();
  if (!db) return res.json({ ok: true });

  const { completedStages, currentStage, advancedUnlocked, stripeSessionId } = req.body || {};

  try {
    const stages = JSON.stringify(Array.isArray(completedStages) ? completedStages : []);
    const stage = Number.isInteger(currentStage) ? currentStage : 0;
    const unlocked = advancedUnlocked ? 1 : 0;

    // Never overwrite stripe_session_id with null if it already has a value
    await db.execute({
      sql: `INSERT INTO user_progress (user_id, completed_stages, current_stage, advanced_unlocked, stripe_session_id, updated_at)
            VALUES (?, ?, ?, ?, ?, unixepoch())
            ON CONFLICT(user_id) DO UPDATE SET
              completed_stages = excluded.completed_stages,
              current_stage = excluded.current_stage,
              advanced_unlocked = MAX(advanced_unlocked, excluded.advanced_unlocked),
              stripe_session_id = CASE WHEN stripe_session_id IS NOT NULL THEN stripe_session_id ELSE excluded.stripe_session_id END,
              updated_at = unixepoch()`,
      args: [req.userId, stages, stage, unlocked, stripeSessionId || null],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[progress] POST error:', err.message);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;
