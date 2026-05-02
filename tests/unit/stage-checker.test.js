'use strict';
const { STAGES, getStage, getStageCount } = require('../../src/stages/stage-checker');

describe('stage-checker', () => {
  it('has 10 stages total', () => {
    expect(getStageCount()).toBe(10);
  });

  it('returns each stage by index', () => {
    for (let i = 0; i < 10; i++) {
      expect(getStage(i)).not.toBeNull();
    }
  });

  it('returns null for out-of-range index', () => {
    expect(getStage(10)).toBeNull();
    expect(getStage(-1)).toBeNull();
  });

  it('each stage has required fields', () => {
    for (const stage of STAGES) {
      expect(stage.id).toBeTruthy();
      expect(stage.title).toBeTruthy();
      expect(stage.mission).toBeTruthy();
      expect(Array.isArray(stage.hints)).toBe(true);
      expect(stage.hints.length).toBeGreaterThan(0);
      expect(stage.success).toBeTruthy();
      expect(stage.success.title).toBeTruthy();
    }
  });

  it('stage IDs are unique', () => {
    const ids = STAGES.map(s => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('free pack stages are indices 0–4', () => {
    const ids = ['intro', 'idor', 'xss', 'sql_injection', 'command_injection'];
    for (let i = 0; i < 5; i++) {
      expect(STAGES[i].id).toBe(ids[i]);
    }
  });

  it('advanced pack stages are indices 5–9', () => {
    const ids = ['price_tamper', 'path_traversal', 'ssrf', 'mass_assign', 'reset_poison'];
    for (let i = 0; i < 5; i++) {
      expect(STAGES[i + 5].id).toBe(ids[i]);
    }
  });

  it('each stage has at least 2 hints', () => {
    for (const stage of STAGES) {
      expect(stage.hints.length).toBeGreaterThanOrEqual(2);
    }
  });
});
