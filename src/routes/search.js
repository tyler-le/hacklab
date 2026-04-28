const express = require('express');
const router = express.Router();
const sessionManager = require('../db/session-manager');

// GET /api/search?q=TERM&sessionId=X
// SQL is parameterized (safe), but HTML response reflects input unsanitized (XSS)
router.get('/search', (req, res) => {
  const { q, sessionId } = req.query;
  const db = sessionManager.getSession(sessionId);
  if (!db) return res.status(400).json({ error: 'Invalid session' });

  const term = q || '';
  const query = `SELECT username, department FROM users WHERE username LIKE ? OR department LIKE ?`;
  const rows = db.prepare(query).all(`%${term}%`, `%${term}%`);

  // Check for XSS patterns
  const hasScript = /<script[\s>]/i.test(term);
  const callsStealCookie = /stealCookie\s*\(/i.test(term);
  const hasHtml = /<[a-z][\s\S]*>/i.test(term);

  res.json({
    query: `SELECT username, department FROM users WHERE username LIKE '%${term}%' OR department LIKE '%${term}%'`,
    // Intentionally unsanitized — this is the XSS vulnerability
    renderedHtml: `Showing results for: ${term}`,
    results: rows,
    hasHtml,
    hasScript,
    stagePass: hasScript && callsStealCookie,
  });
});

// POST /api/steal-cookie — called by the stealCookie() function on the frontend
router.post('/steal-cookie', (req, res) => {
  res.json({
    stolen: true,
    cookie: 'session=admin_8f3k9x2m7q; path=/; HttpOnly=false',
    user: 'admin',
  });
});

module.exports = router;
