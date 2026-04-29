/**
 * Win Detector — passive stage completion detection.
 * Checks command results for win conditions without prescribing specific commands.
 */

const STAGE_IDS = ['intro', 'idor', 'xss', 'sql_injection', 'command_injection'];

/**
 * Check if a command result triggers a stage win.
 * Called after every command execution.
 * @param {number} stageIndex - current stage index
 * @param {object} result - command execution result from ShellSession
 * @param {string} command - the raw command that was executed
 * @returns {boolean} whether the stage is complete
 */
function checkWin(stageIndex, result, command) {
  if (result.stagePass) return true;

  const stageId = STAGE_IDS[stageIndex];
  if (!stageId) return false;

  switch (stageId) {
    case 'intro':
      // Win: successfully logged in as admin via the login page
      return result.stagePass === true;

    case 'idor':
      // Win: accessed admin profile (id=4)
      return result.stagePass === true;

    case 'xss':
      // Win: search input contains <script and stealCookie()
      return result.stagePass === true;

    case 'sql_injection':
      // Win: SQL injection query returns rows
      return result.stagePass === true;

    case 'command_injection':
      // Win: command injection reads secret file
      return result.stagePass === true;

    default:
      return false;
  }
}

module.exports = { checkWin, STAGE_IDS };
