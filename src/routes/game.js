const express = require('express');
const router = express.Router();
const sessionManager = require('../db/session-manager');
const { getStage, getStageCount } = require('../stages/stage-checker');

// In-memory game state per session
const gameState = new Map();

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
    helpCommands: stage.helpCommands,
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

  state.currentStage = stageIndex;
  const stage = getStage(stageIndex);

  res.json({
    currentStage: stageIndex,
    completedStages: [...state.completedStages],
    stage: {
      id: stage.id,
      title: stage.title,
      mission: stage.mission,
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

// GET /api/view-source — returns the HTML source with the intentional vulnerability
router.get('/view-source', (req, res) => {
  res.json({
    source: [
      '<form action="/auth" method="POST">',
      '  <input name="username" />',
      '  <input name="password" type="password" />',
      '  <!-- TODO: remove before deploy -->',
      '  <!-- default test account: admin / password123 -->',
      '  <button type="submit">Sign In</button>',
      '</form>',
    ].join('\n'),
  });
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

module.exports = router;
module.exports.getGameState = getGameState;
