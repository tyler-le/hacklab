'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { getTursoClient } = require('../db/turso');

const COOKIE_NAME = 'hacklab_token';
const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-secret-change-in-prod';
}

// ─── Utility: parse a specific cookie from a Cookie header string ─────────────
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const re = new RegExp('(?:^|;)\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)');
  const m = cookieHeader.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

// ─── Exported helper: extract userId from a Cookie header string ──────────────
function getUserIdFromCookies(cookieHeader) {
  const token = parseCookie(cookieHeader, COOKIE_NAME);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret());
    return payload.userId || null;
  } catch {
    return null;
  }
}

// ─── POST /api/auth/send-link ─────────────────────────────────────────────────
router.post('/send-link', async (req, res) => {
  const { email, next } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: 'Email service not configured' });
  }

  const db = getTursoClient();
  if (!db) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    // Find or create user
    let userId;
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email.toLowerCase()],
    });

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
    } else {
      userId = uuidv4();
      await db.execute({
        sql: 'INSERT INTO users (id, email) VALUES (?, ?)',
        args: [userId, email.toLowerCase()],
      });
    }

    // Create magic token
    const token = uuidv4();
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    await db.execute({
      sql: 'INSERT INTO magic_tokens (token, user_id, expires_at) VALUES (?, ?, ?)',
      args: [token, userId, expiresAt],
    });

    // Send email via Resend
    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const nextPath = next || '/play';
    const link = `${origin}/api/auth/verify?token=${token}&next=${encodeURIComponent(nextPath)}`;

    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'noreply@playhacklab.com',
      to: email,
      subject: 'Sign in to HackLab',
      html: buildMagicLinkEmail(link),
    });

    res.json({ sent: true });
  } catch (err) {
    console.error('[auth] send-link error:', err.message);
    res.status(500).json({ error: 'Failed to send link. Please try again.' });
  }
});

// ─── GET /api/auth/verify ─────────────────────────────────────────────────────
router.get('/verify', async (req, res) => {
  const { token, next } = req.query;
  if (!token) return res.status(400).send('Missing token');

  const db = getTursoClient();
  if (!db) return res.status(503).send('Database not configured');

  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await db.execute({
      sql: 'SELECT token, user_id, expires_at, used FROM magic_tokens WHERE token = ?',
      args: [token],
    });

    if (!result.rows.length) {
      return res.status(400).send('Invalid or expired link');
    }

    const row = result.rows[0];
    if (row.used) return res.status(400).send('Link already used');
    if (row.expires_at < now) return res.status(400).send('Link expired');

    // Mark token as used
    await db.execute({
      sql: 'UPDATE magic_tokens SET used = 1 WHERE token = ?',
      args: [token],
    });

    // Fetch user email
    const userResult = await db.execute({
      sql: 'SELECT id, email FROM users WHERE id = ?',
      args: [row.user_id],
    });

    if (!userResult.rows.length) {
      return res.status(400).send('User not found');
    }

    const user = userResult.rows[0];

    // Sign JWT
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email },
      getJwtSecret(),
      { expiresIn: '30d' }
    );

    // Set cookie
    const isSecure = !!process.env.RAILWAY_ENVIRONMENT;
    res.cookie(COOKIE_NAME, jwtToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: COOKIE_MAX_AGE_MS,
    });

    // Return to a safe relative URL only (prevents open-redirect)
    const returnUrl = (next && next.startsWith('/')) ? next : '/play';
    // Minimal self-closing page: writes the cross-tab auth signal then closes.
    // If window.close() is blocked (email clients usually block it), the user
    // sees a single-line "signed in" message with a link back to the game.
    res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>HackLab — Signed In</title></head>
<body style="margin:0;background:#0a0f0a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace">
<p style="color:#4ec94e;font-size:1rem">
  Signed in.&nbsp;<a href="${returnUrl.replace(/"/g, '%22')}" style="color:#4ec94e">Return to HackLab &rarr;</a>
</p>
<script>
try { localStorage.setItem('hacklab-auth-event', String(Date.now())); } catch(e) {}
window.close();
</script>
</body></html>`);
  } catch (err) {
    console.error('[auth] verify error:', err.message);
    res.status(500).send('Verification failed');
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const cookieHeader = req.headers.cookie;
  const token = parseCookie(cookieHeader, COOKIE_NAME);
  if (!token) return res.json({ user: null });

  try {
    const payload = jwt.verify(token, getJwtSecret());
    return res.json({ user: { id: payload.userId, email: payload.email } });
  } catch {
    return res.json({ user: null });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});

// ─── Email HTML template ─────────────────────────────────────────────────────
function buildMagicLinkEmail(link) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="background:#0a0a0a;color:#ccc;font-family:'Courier New',monospace;padding:40px 20px;margin:0">
  <div style="max-width:480px;margin:0 auto">
    <div style="margin-bottom:24px">
      <span style="color:#00ff88;font-size:22px;font-weight:800;letter-spacing:2px">HACK</span><span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:2px">LAB</span>
    </div>
    <div style="background:#0f0f0f;border:1px solid #1a3a1a;border-radius:6px;padding:32px">
      <p style="color:#00aa2a;font-size:12px;margin:0 0 16px 0;letter-spacing:1px">// magic link auth</p>
      <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 12px 0">Sign in to HackLab</h1>
      <p style="color:#888;font-size:14px;line-height:1.6;margin:0 0 28px 0">
        Click the button below to sign in. This link expires in 15 minutes and can only be used once.
      </p>
      <a href="${link}" style="display:block;background:#00ff88;color:#000;font-weight:800;font-size:14px;font-family:'Courier New',monospace;padding:14px 24px;border-radius:3px;text-decoration:none;text-align:center">
        Sign in to HackLab →
      </a>
      <p style="color:#555;font-size:12px;margin:24px 0 0 0;line-height:1.6">
        If you didn't request this, you can safely ignore it.<br>
        Or copy this link: <span style="color:#00aa2a;word-break:break-all">${link}</span>
      </p>
    </div>
    <p style="color:#333;font-size:11px;margin:20px 0 0 0;text-align:center">
      HackLab · No password. One-time link. Free forever.
    </p>
  </div>
</body>
</html>`;
}

module.exports = router;
module.exports.getUserIdFromCookies = getUserIdFromCookies;
