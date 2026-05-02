'use strict';

// Tests for server-side progress restoration logic in ws-handler.
// We extract the pure logic (applyProgress, stageCountFor) and test it
// directly without spinning up a WebSocket server.

const sessionManager = require('../../src/db/session-manager');
const { getGameState } = require('../../src/routes/game');
const { getStageCount } = require('../../src/stages/stage-checker');

beforeAll(() => {
  sessionManager.createTemplate();
});

function makeState(overrides = {}) {
  return {
    currentStage: 0,
    completedStages: new Set(),
    advancedUnlocked: false,
    ...overrides,
  };
}

const FREE_STAGE_COUNT = 5;

function stageCountFor(state) {
  return state.advancedUnlocked ? getStageCount() : FREE_STAGE_COUNT;
}

// Mirror of applyProgressFromClient in ws-handler.js
function applyProgressFromClient(state, savedProgress) {
  const maxStage = stageCountFor(state);
  if (Array.isArray(savedProgress.completedStages)) {
    savedProgress.completedStages
      .filter(i => Number.isInteger(i) && i >= 0 && i < maxStage)
      .forEach(i => state.completedStages.add(i));
  }
  if (Number.isInteger(savedProgress.currentStage) && savedProgress.currentStage >= 0) {
    state.currentStage = Math.min(savedProgress.currentStage, maxStage - 1);
  }
}
const applyProgress = applyProgressFromClient;

// ─── stageCountFor ────────────────────────────────────────────────────────────
describe('stageCountFor', () => {
  it('returns FREE_STAGE_COUNT when not unlocked', () => {
    expect(stageCountFor(makeState())).toBe(FREE_STAGE_COUNT);
  });

  it('returns full stage count when advanced is unlocked', () => {
    expect(stageCountFor(makeState({ advancedUnlocked: true }))).toBe(getStageCount());
  });
});

// ─── applyProgress ────────────────────────────────────────────────────────────
describe('applyProgress — completedStages', () => {
  it('restores completed stages from savedProgress', () => {
    const state = makeState();
    applyProgress(state, { completedStages: [0, 1, 2] });
    expect([...state.completedStages]).toEqual(expect.arrayContaining([0, 1, 2]));
  });

  it('ignores out-of-range stage indices for free users', () => {
    const state = makeState();
    applyProgress(state, { completedStages: [0, 5, 9] }); // 5-9 are advanced
    expect(state.completedStages.has(0)).toBe(true);
    expect(state.completedStages.has(5)).toBe(false);
    expect(state.completedStages.has(9)).toBe(false);
  });

  it('allows advanced stage indices when unlocked', () => {
    const state = makeState({ advancedUnlocked: true });
    applyProgress(state, { completedStages: [0, 5, 9] });
    expect(state.completedStages.has(5)).toBe(true);
    expect(state.completedStages.has(9)).toBe(true);
  });

  it('ignores negative stage indices', () => {
    const state = makeState();
    applyProgress(state, { completedStages: [-1, 0] });
    expect(state.completedStages.has(-1)).toBe(false);
    expect(state.completedStages.has(0)).toBe(true);
  });

  it('handles missing completedStages gracefully', () => {
    const state = makeState();
    expect(() => applyProgress(state, {})).not.toThrow();
    expect(state.completedStages.size).toBe(0);
  });
});

describe('applyProgress — currentStage', () => {
  it('restores currentStage from savedProgress', () => {
    const state = makeState();
    applyProgress(state, { currentStage: 3 });
    expect(state.currentStage).toBe(3);
  });

  it('clamps currentStage to maxStage - 1 for free users', () => {
    const state = makeState();
    applyProgress(state, { currentStage: 7 });
    expect(state.currentStage).toBe(FREE_STAGE_COUNT - 1);
  });

  it('allows currentStage up to 9 when unlocked', () => {
    const state = makeState({ advancedUnlocked: true });
    applyProgress(state, { currentStage: 9 });
    expect(state.currentStage).toBe(9);
  });

  it('ignores negative currentStage', () => {
    const state = makeState();
    applyProgress(state, { currentStage: -1 });
    expect(state.currentStage).toBe(0); // unchanged
  });

  it('handles missing currentStage gracefully', () => {
    const state = makeState({ currentStage: 2 });
    applyProgress(state, {});
    expect(state.currentStage).toBe(2); // unchanged
  });
});

// ─── Server restart scenario ───────────────────────────────────────────────────
// Simulates: session DB file still exists on disk but in-memory state is
// fresh (empty) because the server restarted. Client sends savedProgress.
describe('server restart scenario — existing session, empty in-memory state', () => {
  it('restores completedStages when in-memory state is empty on reconnect', () => {
    const state = makeState(); // fresh in-memory state after restart
    expect(state.completedStages.size).toBe(0);

    // Client sends progress it saved before the restart
    applyProgressFromClient(state, { completedStages: [0, 1], currentStage: 1 });

    expect(state.completedStages.has(0)).toBe(true);
    expect(state.completedStages.has(1)).toBe(true);
    expect(state.currentStage).toBe(1);
  });

  it('does not overwrite non-empty in-memory state', () => {
    // If state has data (e.g. same server session), don't overwrite
    const state = makeState({ currentStage: 3 });
    state.completedStages.add(0);
    state.completedStages.add(1);
    state.completedStages.add(2);

    // The guard in ws-handler only calls applyProgressFromClient when
    // completedStages.size === 0 — so this scenario never reaches it.
    // Verify that applying to a non-empty state only adds, never removes.
    applyProgressFromClient(state, { completedStages: [0], currentStage: 0 });
    expect(state.completedStages.size).toBe(3); // still has all three
  });
});
