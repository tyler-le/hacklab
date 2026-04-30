const sessionManager = require('../db/session-manager');
const { getStage, getStageCount } = require('../stages/stage-checker');
const { getGameState } = require('../routes/game');
const ShellSession = require('../shell/shell');
const RealShellSession = require('../sandbox/real-shell-session');
const { escapeHtml } = require('../utils');

function getNudge(stageIndex, result, command) {
  const stageId = ['intro', 'idor', 'xss', 'sql_injection', 'command_injection'][stageIndex];

  if (stageId === 'intro') {
    // Logged in but not as admin with the right creds
    if (result.query && /username/.test(result.query) && result.loginSuccess && !result.stageFlag) {
      return '✓ Login successful, but you need to log in with the leaked credentials (admin/password123).';
    }
  }

  if (stageId === 'idor') {
    // Accessed an employee profile but not the admin
    if (/\/api\/employees\/\d+/.test(command) && result.stdout && /Employee Profile/i.test(result.stdout) && !result.stagePass) {
      return '✓ You can access employee profiles! But this one isn\'t the admin. Look for someone with sensitive data.';
    }
  }

  if (stageId === 'xss') {
    if (/\/api\/search/.test(command) && /<[a-z]/.test(command) && !result.stagePass) {
      if (/<script/i.test(command)) {
        return '✓ Script injection works! Now use document.cookie inside your script to read the admin\'s session cookie.';
      }
      return '✓ HTML injection works! Now try injecting a &lt;script&gt; tag.';
    }
  }

  if (stageId === 'sql_injection') {
    // Got a SQL error — they're probing
    if (result.query && result.stdout && /error/i.test(result.stdout)) {
      return '✓ SQL error! Your input is reaching the query. Study the error — can you make the query always return true?';
    }
    // Logged in but without injection
    if (result.query && result.loginSuccess && !result.stagePass) {
      return '✓ Login worked, but you used real credentials. The goal is to bypass authentication using SQL injection.';
    }
  }

  if (stageId === 'command_injection') {
    // Used a separator but didn't read the secrets file
    if (/\/api\/diagnostic/.test(command) && /[;&|]/.test(command) && !result.stagePass) {
      const hitSecrets = /\/etc\/secrets/.test(command);
      if (!hitSecrets) {
        return '✓ Command injection works! Now use it to read /etc/secrets/api_keys.txt';
      }
    }
  }

  return null;
}

function handleWebSocket(ws) {
  let sessionId = null;
  let shell = null;
  const useRealShell = process.env.ENABLE_REAL_SHELL === '1';

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'init':
        handleInit(msg);
        break;
      case 'command':
        handleCommand(msg);
        break;
      case 'complete':
        handleComplete(msg);
        break;
      case 'setStage':
        if (shell && msg.stageIndex !== undefined) {
          shell.setStage(msg.stageIndex);
        }
        break;
      case 'browser-navigate':
        handleBrowserNavigate(msg);
        break;
    }
  });

  ws.on('close', () => {
    if (shell && typeof shell.destroy === 'function') {
      shell.destroy();
    }
  });

  function send(payload) {
    ws.send(JSON.stringify({ type: 'result', ...payload }));
  }

  function handleInit(msg) {
    if (msg.sessionId) {
      const db = sessionManager.getSession(msg.sessionId);
      if (db) {
        sessionId = msg.sessionId;
        const state = getGameState(sessionId);
        const stage = getStage(state.currentStage);
        shell = useRealShell
          ? new RealShellSession(sessionId, state.currentStage)
          : new ShellSession(sessionId, state.currentStage);

        ws.send(JSON.stringify({
          type: 'init',
          sessionId,
          currentStage: state.currentStage,
          completedStages: [...state.completedStages],
          stageCount: getStageCount(),
          stage: { id: stage.id, title: stage.title, mission: stage.mission, flagPrompt: stage.flagPrompt },
          prompt: shell.getPrompt(),
        }));
        return;
      }
    }

    // Create new session
    sessionId = sessionManager.createSession();
    const state = getGameState(sessionId);
    const stage = getStage(0);
    shell = useRealShell
      ? new RealShellSession(sessionId, 0)
      : new ShellSession(sessionId, 0);

    ws.send(JSON.stringify({
      type: 'init',
      sessionId,
      currentStage: 0,
      completedStages: [],
      stageCount: getStageCount(),
      stage: { id: stage.id, title: stage.title, mission: stage.mission, flagPrompt: stage.flagPrompt },
      prompt: shell.getPrompt(),
    }));
  }

  function handleCommand(msg) {
    const { command } = msg;
    if (!sessionId || !shell) return;

    const state = getGameState(sessionId);
    const stageIndex = state.currentStage;
    const stage = getStage(stageIndex);
    const trimmed = command.trim();

    // Meta-commands handled outside the shell
    if (trimmed === 'status') {
      send({
        terminalLines: [
          `<span class="info">Current: ${stage.title}</span>`,
          `<span class="info">Progress: ${state.completedStages.size}/${getStageCount()} stages completed</span>`,
        ],
        prompt: shell.getPrompt(),
      });
      return;
    }

    if (trimmed === 'next') {
      if (!state.completedStages.has(stageIndex)) {
        send({ terminalLines: ['<span class="err">Complete the current stage first.</span>'], prompt: shell.getPrompt() });
      } else if (stageIndex >= getStageCount() - 1) {
        send({ terminalLines: ['<span class="info">No more stages. Type <span class="cmd">restart</span> to play again.</span>'], prompt: shell.getPrompt() });
      } else {
        state.currentStage++;
        shell.setStage(state.currentStage);
        const newStage = getStage(state.currentStage);
        send({
          stageChange: {
            currentStage: state.currentStage,
            completedStages: [...state.completedStages],
            stage: { id: newStage.id, title: newStage.title, mission: newStage.mission, flagPrompt: newStage.flagPrompt },
          },
          prompt: shell.getPrompt(),
        });
      }
      return;
    }

    if (trimmed === 'restart') {
      sessionManager.destroySession(sessionId);
      sessionId = sessionManager.createSession();
      const newState = getGameState(sessionId);
      newState.currentStage = 0;
      newState.completedStages = new Set();
      shell = useRealShell
        ? new RealShellSession(sessionId, 0)
        : new ShellSession(sessionId, 0);

      const s = getStage(0);
      send({
        restart: true,
        sessionId,
        stageChange: {
          currentStage: 0,
          completedStages: [],
          stage: { id: s.id, title: s.title, mission: s.mission },
        },
        terminalLines: ['<span class="sys">HackLab v2.0 restarted.</span>', ''],
        prompt: shell.getPrompt(),
      });
      return;
    }

    if (trimmed === 'hint') {
      if (!state.hintIndex) state.hintIndex = {};
      if (!state.hintIndex[stageIndex]) state.hintIndex[stageIndex] = 0;
      const idx = state.hintIndex[stageIndex];
      if (idx < stage.hints.length) {
        send({
          terminalLines: [`<span class="warn">HINT: ${stage.hints[idx]}</span>`],
          prompt: shell.getPrompt(),
        });
        state.hintIndex[stageIndex]++;
      } else {
        send({
          terminalLines: ['<span class="sys">No more hints available.</span>'],
          prompt: shell.getPrompt(),
        });
      }
      return;
    }

    // submit <flag> — verify the player captured the right secret
    if (trimmed.startsWith('submit ')) {
      const submitted = trimmed.slice(7).trim();
      if (!state.pendingFlags) state.pendingFlags = {};
      const expected = state.pendingFlags[stageIndex];
      const alreadyDone = state.completedStages.has(stageIndex);

      if (alreadyDone) {
        send({ terminalLines: ['<span class="sys">Stage already completed.</span>'], prompt: shell.getPrompt() });
        return;
      }
      if (!expected) {
        send({ terminalLines: ['<span class="err">No flag pending for this stage. Exploit the vulnerability first.</span>'], prompt: shell.getPrompt() });
        return;
      }
      if (submitted === expected) {
        state.completedStages.add(stageIndex);
        send({
          flagResult: 'correct',
          prompt: shell.getPrompt(),
          stagePass: true,
          stageSuccess: stage.success,
          completedStages: [...state.completedStages],
        });
      } else {
        send({ flagResult: 'incorrect', prompt: shell.getPrompt() });
      }
      return;
    }

    // All other commands go through the shell
    const result = shell.execute(trimmed);

    // Build terminal output
    const terminalLines = [];
    if (result.stderr) {
      terminalLines.push(`<span class="err">${escapeHtml(result.stderr)}</span>`);
    }
    if (result.stdout) {
      const lines = result.stdout.split('\n');
      for (const line of lines) {
        terminalLines.push(`<span class="sys">${escapeHtml(line)}</span>`);
      }
    }

    // Check for hint request from shell
    if (result.isHint) {
      if (!state.hintIndex) state.hintIndex = {};
      if (!state.hintIndex[stageIndex]) state.hintIndex[stageIndex] = 0;
      const idx = state.hintIndex[stageIndex];
      if (idx < stage.hints.length) {
        terminalLines.push(`<span class="warn">HINT: ${stage.hints[idx]}</span>`);
        state.hintIndex[stageIndex]++;
      } else {
        terminalLines.push('<span class="sys">No more hints available.</span>');
      }
    }

    // Check if the exploit just fired — store the expected flag and notify the player
    const alreadyCompleted = state.completedStages.has(stageIndex);
    if (result.stageFlag && !alreadyCompleted) {
      if (!state.pendingFlags) state.pendingFlags = {};
      const isNew = state.pendingFlags[stageIndex] !== result.stageFlag;
      state.pendingFlags[stageIndex] = result.stageFlag;
      if (isNew) {
        terminalLines.push(`<span class="info">✓ Exploit successful! Find the secret in the browser and submit it above.</span>`);
      }
    }

    // Near-miss feedback (only if exploit hasn't fired and stage not done)
    if (!result.stageFlag && !alreadyCompleted) {
      const nudge = getNudge(stageIndex, result, trimmed);
      if (nudge) terminalLines.push(`<span class="warn">${nudge}</span>`);
    }

    const payload = {
      prompt: result.prompt || shell.getPrompt(),
      sqliteMode: shell.sqliteMode,
    };

    if (terminalLines.length > 0) payload.terminalLines = terminalLines;
    if (result.clear) payload.clear = true;
    if (result.query) payload.query = result.query;
    if (result.queryResult) payload.queryResult = result.queryResult;

    send(payload);
  }

  function handleBrowserNavigate(msg) {
    if (!sessionId || !shell) return;
    const state = getGameState(sessionId);
    const stageIndex = state.currentStage;
    const alreadyCompleted = state.completedStages.has(stageIndex);
    if (alreadyCompleted) return;

    // Build a synthetic curl command and run it through the shell for win detection
    let cmd;
    if (msg.method === 'POST' && msg.body) {
      cmd = `curl -d "${msg.body}" "http://localhost:3000${msg.path}"`;
    } else {
      cmd = `curl "http://localhost:3000${msg.path}"`;
    }

    const result = shell.execute(cmd);

    // Always forward query/result to the monitor panel (visible on stages 3 & 4)
    const payload = {};
    if (result.query) payload.query = result.query;
    if (result.queryResult) payload.queryResult = result.queryResult;

    if (result.stageFlag) {
      if (!state.pendingFlags) state.pendingFlags = {};
      const isNew = state.pendingFlags[stageIndex] !== result.stageFlag;
      state.pendingFlags[stageIndex] = result.stageFlag;
      if (isNew) payload.exploitDetected = true;
    }

    if (Object.keys(payload).length > 0) send(payload);
  }

  function handleComplete(msg) {
    if (!shell) return;
    const result = shell.complete(msg.input || '');
    ws.send(JSON.stringify({ type: 'complete', ...result }));
  }
}

module.exports = { handleWebSocket };
