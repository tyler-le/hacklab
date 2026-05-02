'use strict';
const { checkWin } = require('../../src/stages/win-detector');

describe('win-detector', () => {
  it('returns true when result.stagePass is true', () => {
    expect(checkWin(0, { stagePass: true })).toBe(true);
  });

  it('returns false when result.stagePass is false', () => {
    expect(checkWin(0, { stagePass: false })).toBe(false);
  });

  it('returns false when stagePass is absent', () => {
    expect(checkWin(0, {})).toBe(false);
  });

  it('returns false when stagePass is truthy but not strictly true', () => {
    expect(checkWin(0, { stagePass: 1 })).toBe(false);
    expect(checkWin(0, { stagePass: 'yes' })).toBe(false);
  });
});
