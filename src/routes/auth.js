const express = require('express');
const router = express.Router();
const sessionManager = require('../db/session-manager');

// POST /api/login
// Stage 1: parameterized (safe) — vulnerability is info leakage, not SQL injection
// Stage 4: string concatenation (vulnerable) — intentionally injectable
router.post('/login', (req, res) => {
  const { username, password, sessionId, stage } = req.body;
  const db = sessionManager.getSession(sessionId);
  if (!db) return res.status(400).json({ error: 'Invalid session' });

  if (stage === 'sql_injection') {
    // INTENTIONALLY VULNERABLE: string concatenation
    const query = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;
    try {
      const rows = db.prepare(query).all();
      const loginOk = rows.length > 0;

      // Check for OR tautology — this is the win condition
      const hasOrTautology = /OR\s+[\d']\s*=\s*[\d']/i.test(query) || /OR\s+1\s*=\s*1/i.test(query);

      res.json({
        query,
        success: loginOk,
        user: loginOk ? { username: rows[0].username, role: rows[0].role } : null,
        rows: loginOk ? rows.map(r => ({ username: r.username, role: r.role })) : [],
        stagePass: hasOrTautology && loginOk,
        error: loginOk ? null : 'Invalid username or password.',
      });
    } catch (e) {
      // Intentionally leak SQL errors
      res.json({
        query,
        success: false,
        error: e.message,
        stagePass: false,
      });
    }
  } else {
    // Stage 1: parameterized query (safe)
    const query = `SELECT * FROM users WHERE username = ? AND password = ?`;
    const displayQuery = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;
    try {
      const user = db.prepare(query).get(username, password);
      const isStage1Pass = user && username === 'admin' && password === 'password123';

      res.json({
        query: displayQuery,
        success: !!user,
        user: user ? { username: user.username, role: user.role } : null,
        stagePass: isStage1Pass,
        error: user ? null : 'Invalid username or password.',
      });
    } catch (e) {
      res.json({ query: displayQuery, success: false, error: e.message, stagePass: false });
    }
  }
});

module.exports = router;
