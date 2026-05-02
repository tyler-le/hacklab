const express = require('express');
const router = express.Router();
const sessionManager = require('../db/session-manager');
const { getStage, getStageCount } = require('../stages/stage-checker');

// In-memory game state per session
const gameState = new Map();

// Clean up gameState when sessions are destroyed (TTL expiry, restart, etc.)
sessionManager.onSessionDestroyed((sessionId) => {
  gameState.delete(sessionId);
});

function getGameState(sessionId) {
  if (!gameState.has(sessionId)) {
    gameState.set(sessionId, {
      currentStage: 0,
      completedStages: new Set(),
    });
  }
  return gameState.get(sessionId);
}

// POST /api/session — create a new game session
router.post('/session', (req, res) => {
  const sessionId = sessionManager.createSession();
  gameState.set(sessionId, {
    currentStage: 0,
    completedStages: new Set(),
  });
  res.json({ sessionId });
});

// GET /api/session/:id — get current game state
router.get('/session/:id', (req, res) => {
  const db = sessionManager.getSession(req.params.id);
  if (!db) return res.status(404).json({ error: 'Session not found' });

  const state = getGameState(req.params.id);
  const stage = getStage(state.currentStage);

  res.json({
    currentStage: state.currentStage,
    completedStages: [...state.completedStages],
    stageCount: getStageCount(),
    stage: stage ? {
      id: stage.id,
      title: stage.title,
      mission: stage.mission,
      flagPrompt: stage.flagPrompt,
    } : null,
  });
});

// GET /api/stage/:index — get stage metadata
router.get('/stage/:index', (req, res) => {
  const stage = getStage(parseInt(req.params.index));
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  res.json({
    id: stage.id,
    title: stage.title,
    mission: stage.mission,
  });
});

// POST /api/stage/complete — mark current stage as completed
router.post('/stage/complete', (req, res) => {
  const { sessionId } = req.body;
  const state = getGameState(sessionId);
  state.completedStages.add(state.currentStage);
  res.json({ completedStages: [...state.completedStages] });
});

// POST /api/stage/switch — switch to a different stage
router.post('/stage/switch', (req, res) => {
  const { sessionId, stageIndex } = req.body;
  const state = getGameState(sessionId);

  if (stageIndex < 0 || stageIndex >= getStageCount()) {
    return res.status(400).json({ error: 'Invalid stage index' });
  }

  // Gate advanced stages (indices 5-9) behind payment
  if (stageIndex >= 5 && !state.advancedUnlocked) {
    return res.status(403).json({ error: 'Advanced Pack required', paymentRequired: true });
  }

  state.currentStage = stageIndex;
  const stage = getStage(stageIndex);

  res.json({
    currentStage: stageIndex,
    completedStages: [...state.completedStages],
    stage: {
      id: stage.id,
      title: stage.title,
      mission: stage.mission,
      flagPrompt: stage.flagPrompt,
    },
  });
});

// POST /api/stage/next — advance to next stage
router.post('/stage/next', (req, res) => {
  const { sessionId } = req.body;
  const state = getGameState(sessionId);

  if (!state.completedStages.has(state.currentStage)) {
    return res.status(400).json({ error: 'Complete the current stage first.' });
  }

  if (state.currentStage >= getStageCount() - 1) {
    return res.status(400).json({ error: 'No more stages.' });
  }

  state.currentStage++;
  const stage = getStage(state.currentStage);

  res.json({
    currentStage: state.currentStage,
    completedStages: [...state.completedStages],
    stage: {
      id: stage.id,
      title: stage.title,
      mission: stage.mission,
      flagPrompt: stage.flagPrompt,
    },
  });
});

// POST /api/hint — get a hint for the current stage
router.post('/hint', (req, res) => {
  const { sessionId, hintIndex } = req.body;
  const state = getGameState(sessionId);
  const stage = getStage(state.currentStage);

  if (!stage) return res.status(400).json({ error: 'Invalid stage' });

  if (hintIndex >= stage.hints.length) {
    return res.json({ hint: null, message: 'No more hints available.' });
  }

  res.json({ hint: stage.hints[hintIndex], hintIndex });
});

// POST /api/reset — reset the game session
router.post('/reset', (req, res) => {
  const { sessionId } = req.body;
  // Destroy old session and create new DB
  sessionManager.destroySession(sessionId);
  const newSessionId = sessionManager.createSession();
  gameState.set(newSessionId, {
    currentStage: 0,
    completedStages: new Set(),
  });
  // Clean up old game state
  gameState.delete(sessionId);
  res.json({ sessionId: newSessionId });
});

// POST /api/checkout — create a Stripe Checkout session
router.post('/checkout', async (req, res) => {
  // HOTFIX: purchases temporarily disabled while persistent session storage is being implemented.
  // Remove this block once the fix is deployed.
  return res.status(503).json({ error: 'Purchases are temporarily unavailable. Check back soon!' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Payment not configured' });
  }
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'HackLab — Operation Blacksite',
            description: '5 advanced hacking missions: Cookie Tampering, Verb Tampering, Verbose Errors, Debug Backdoor, Path Traversal',
          },
          unit_amount: 99,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/verify-payment — verify a Stripe payment and unlock advanced pack
router.post('/verify-payment', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Payment not configured' });
  }
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { session_id, sessionId: gameSessionId } = req.body;
    const stripeSession = await stripe.checkout.sessions.retrieve(session_id);
    if (stripeSession.payment_status === 'paid') {
      if (gameSessionId) {
        const state = getGameState(gameSessionId);
        state.advancedUnlocked = true;
      }
      res.json({ unlocked: true, stageCount: getStageCount() });
    } else {
      res.json({ unlocked: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getGameState = getGameState;
