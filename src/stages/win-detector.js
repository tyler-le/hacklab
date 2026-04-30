/**
 * Win Detector — passive stage completion detection.
 *
 * Win conditions are evaluated inside each route handler in vulnerable-app.js,
 * which sets `result.stagePass = true` when the player's action meets the
 * stage objective. This module simply surfaces that flag.
 */

function checkWin(stageIndex, result) {
  return result.stagePass === true;
}

module.exports = { checkWin };
