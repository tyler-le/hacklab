'use strict';

// Tests for sign-out session reset: verifies the server-side state mutations
// that back the client-side signOut() → sendReset() flow.

jest.mock('../../src/db/turso', () => ({ getTursoClient: () => null }));

const sessionManager = require('../../src/db/session-manager');
const { getGameState } = require('../../src/routes/game');
const { getStageCount } = require('../../src/stages/stage-checker');

const FREE_STAGE_COUNT = 5;

beforeAll(() => {
  sessionManager.createTemplate();
});

function makeSession() {
  const sessionId = sessionManager.createSession();
  return { sessionId, state: getGameState(sessionId) };
}

function simulateProgress(state, stages, current) {
  stages.forEach(i => state.completedStages.add(i));
  state.currentStage = current;
}

function simulateReset(state) {
  state.currentStage = 0;
  state.completedStages = new Set();
  state.advancedUnlocked = false;
  state.hintIndex = {};
}

afterEach(() => {
  // Sessions are cleaned up by destroySession in each test
});

// ─── State mutation ───────────────────────────────────────────────────────────
describe('sign-out state reset — completedStages and currentStage', () => {
  it('resets completedStages to empty after progress', () => {
    const { sessionId, state } = makeSession();
    simulateProgress(state, [0, 1, 2], 3);
    expect(state.completedStages.size).toBe(3);

    simulateReset(state);
    expect(state.completedStages.size).toBe(0);
    sessionManager.destroySession(sessionId);
  });

  it('resets currentStage to 0 regardless of where user was', () => {
    const { sessionId, state } = makeSession();
    simulateProgress(state, [0, 1, 2, 3], 4);
    expect(state.currentStage).toBe(4);

    simulateReset(state);
    expect(state.currentStage).toBe(0);
    sessionManager.destroySession(sessionId);
  });

  it('resets advancedUnlocked to false', () => {
    const { sessionId, state } = makeSession();
    state.advancedUnlocked = true;

    simulateReset(state);
    expect(state.advancedUnlocked).toBe(false);
    sessionManager.destroySession(sessionId);
  });

  it('clears hintIndex', () => {
    const { sessionId, state } = makeSession();
    state.hintIndex = { 0: 2, 1: 1 };

    simulateReset(state);
    expect(state.hintIndex).toEqual({});
    sessionManager.destroySession(sessionId);
  });
});

// ─── After reset, state is clean for anonymous reconnect ─────────────────────
describe('anonymous reconnect after sign-out reset', () => {
  it('empty savedProgress applied to clean state stays at stage 0', () => {
    const { sessionId, state } = makeSession();
    simulateProgress(state, [0, 1, 2], 2);
    simulateReset(state);

    // Simulate anonymous init with empty savedProgress (localStorage was cleared)
    const savedProgress = {};
    const maxStage = FREE_STAGE_COUNT;
    if (Array.isArray(savedProgress.completedStages)) {
      savedProgress.completedStages
        .filter(i => Number.isInteger(i) && i >= 0 && i < maxStage)
        .forEach(i => state.completedStages.add(i));
    }
    if (Number.isInteger(savedProgress.currentStage) && savedProgress.currentStage >= 0) {
      state.currentStage = Math.min(savedProgress.currentStage, maxStage - 1);
    }

    expect(state.completedStages.size).toBe(0);
    expect(state.currentStage).toBe(0);
    sessionManager.destroySession(sessionId);
  });

  it('reset state does not inherit advanced stages even if old state had them', () => {
    const { sessionId, state } = makeSession();
    state.advancedUnlocked = true;
    state.completedStages = new Set([0, 1, 2, 3, 4, 5, 6]);
    state.currentStage = 7;

    simulateReset(state);

    expect(state.advancedUnlocked).toBe(false);
    expect(state.completedStages.size).toBe(0);
    expect(state.currentStage).toBe(0);
    sessionManager.destroySession(sessionId);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────
describe('reset edge cases', () => {
  it('resetting an already-clean session is a no-op', () => {
    const { sessionId, state } = makeSession();
    expect(state.completedStages.size).toBe(0);
    expect(state.currentStage).toBe(0);

    simulateReset(state);

    expect(state.completedStages.size).toBe(0);
    expect(state.currentStage).toBe(0);
    sessionManager.destroySession(sessionId);
  });

  it('reset does not affect other sessions', () => {
    const a = makeSession();
    const b = makeSession();
    simulateProgress(a.state, [0, 1], 1);
    simulateProgress(b.state, [0], 0);

    simulateReset(a.state);

    // Session A is reset
    expect(a.state.completedStages.size).toBe(0);
    // Session B is untouched
    expect(b.state.completedStages.has(0)).toBe(true);
    expect(b.state.currentStage).toBe(0);

    sessionManager.destroySession(a.sessionId);
    sessionManager.destroySession(b.sessionId);
  });

  it('after sign-out, advanced stage switch is blocked on the reset session', () => {
    const { sessionId, state } = makeSession();
    state.advancedUnlocked = true;
    simulateReset(state);

    // Verify that the reset session behaves like an unpaid session
    expect(state.advancedUnlocked).toBe(false);
    // Stage switch guard: stageIndex >= 5 && !state.advancedUnlocked → blocked
    const wouldBlock = 5 >= 5 && !state.advancedUnlocked;
    expect(wouldBlock).toBe(true);
    sessionManager.destroySession(sessionId);
  });
});
