const express = require('express');
const router = express.Router();
const sessionManager = require('../db/session-manager');

// GET /api/profile?id=N&sessionId=X
// INTENTIONALLY VULNERABLE: no authorization check
router.get('/profile', (req, res) => {
  const { id, sessionId } = req.query;
  const db = sessionManager.getSession(sessionId);
  if (!db) return res.status(400).json({ error: 'Invalid session' });

  if (!id) {
    return res.status(400).json({ error: "Missing required parameter 'id'" });
  }

  const numId = parseInt(id);
  if (isNaN(numId)) {
    return res.status(400).json({ error: 'Invalid id parameter' });
  }

  const query = `SELECT * FROM users WHERE id = ?`;
  const user = db.prepare(query).get(numId);

  if (!user) {
    return res.status(404).json({
      error: `No employee found with id=${numId}`,
      hint: 'There are 5 employees in the system. Keep trying different IDs.',
    });
  }

  // Return the full user record — intentionally no field filtering
  const isAdmin = user.role === 'admin';

  res.json({
    query: `SELECT * FROM users WHERE id = ${numId}`,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      department: user.department,
      role: user.role,
      // Admin-only sensitive fields are returned because there's no access control
      ...(isAdmin && {
        api_key: user.api_key,
        ssh_access: user.ssh_access,
        db_access: user.db_access,
      }),
    },
    stagePass: isAdmin,
  });
});

module.exports = router;
