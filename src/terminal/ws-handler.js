const sessionManager = require('../db/session-manager');
const { getStage, getStageCount } = require('../stages/stage-checker');
const { getGameState } = require('../routes/game');
const { checkWin } = require('../stages/win-detector');
const ShellSession = require('../shell/shell');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function handleWebSocket(ws) {
  let sessionId = null;
  let shell = null;

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
        shell = new ShellSession(sessionId, state.currentStage);

        ws.send(JSON.stringify({
          type: 'init',
          sessionId,
          currentStage: state.currentStage,
          completedStages: [...state.completedStages],
          stageCount: getStageCount(),
          stage: { id: stage.id, title: stage.title, mission: stage.mission },
          prompt: shell.getPrompt(),
        }));
        return;
      }
    }

    // Create new session
    sessionId = sessionManager.createSession();
    const state = getGameState(sessionId);
    const stage = getStage(0);
    shell = new ShellSession(sessionId, 0);

    ws.send(JSON.stringify({
      type: 'init',
      sessionId,
      currentStage: 0,
      completedStages: [],
      stageCount: getStageCount(),
      stage: { id: stage.id, title: stage.title, mission: stage.mission },
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
        shell.currentStage = state.currentStage;
        const newStage = getStage(state.currentStage);
        send({
          stageChange: {
            currentStage: state.currentStage,
            completedStages: [...state.completedStages],
            stage: { id: newStage.id, title: newStage.title, mission: newStage.mission },
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
      shell = new ShellSession(sessionId, 0);

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

    // All other commands go through the shell
    const result = shell.execute(trimmed);

    // Build terminal output
    const terminalLines = [];
    if (result.stderr) {
      terminalLines.push(`<span class="err">${escapeHtml(result.stderr)}</span>`);
    }
    if (result.stdout) {
      // Split stdout into lines for terminal display
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

    // Check win condition
    const stagePass = checkWin(stageIndex, result, trimmed);
    if (stagePass && !state.completedStages.has(stageIndex)) {
      state.completedStages.add(stageIndex);
    }

    const payload = {
      prompt: result.prompt || shell.getPrompt(),
      sqliteMode: shell.sqliteMode,
    };

    if (terminalLines.length > 0) payload.terminalLines = terminalLines;
    if (result.clear) payload.clear = true;
    if (result.query) payload.query = result.query;
    if (result.queryResult) payload.queryResult = result.queryResult;
    if (stagePass) {
      payload.stagePass = true;
      payload.stageSuccess = stage.success;
      payload.completedStages = [...state.completedStages];
    }

    send(payload);
  }

  function handleComplete(msg) {
    if (!shell) return;
    const result = shell.complete(msg.input || '');
    ws.send(JSON.stringify({ type: 'complete', ...result }));
  }
}

module.exports = { handleWebSocket };
