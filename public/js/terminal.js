// WebSocket terminal connection

let ws = null;
let sessionId = localStorage.getItem('hacklab-session');
let commandHistory = [];
let historyIndex = -1;

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'init', sessionId }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'init':
        sessionId = msg.sessionId;
        localStorage.setItem('hacklab-session', sessionId);
        onGameInit(msg);
        break;

      case 'result':
        onCommandResult(msg);
        break;
    }
  };

  ws.onclose = () => {
    printTerminal('<span class="err">Connection lost. Reconnecting...</span>');
    setTimeout(connectWebSocket, 2000);
  };
}

function sendCommand(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command', command }));
  }
}

function onGameInit(msg) {
  currentStage = msg.currentStage;
  completedStages = new Set(msg.completedStages);
  stageCount = msg.stageCount;

  renderStageDots();
  document.getElementById('missionText').innerHTML = msg.stage.mission;
  updateTabsForStage(msg.stage.id);

  printTerminal('<span class="sys">HackLab v2.0 initialized.</span>');
  printTerminal('<span class="sys">Target: MegaCorp Employee Portal (portal.megacorp.local)</span>');
  printTerminal('<span class="sys">Status: Connected to target network.</span>');
  printTerminal('');
  printTerminal(`<span class="warn">═══ ${msg.stage.title.toUpperCase()} ═══</span>`);
  printTerminal('');
  printTerminal('<span class="info">Type <span class="cmd">help</span> for available commands.</span>');
  printTerminal('');
}

function onCommandResult(msg) {
  // Clear terminal if requested
  if (msg.clear) {
    document.getElementById('terminalOutput').innerHTML = '';
    return;
  }

  // Handle stage change (next/restart)
  if (msg.stageChange) {
    const sc = msg.stageChange;
    const termOut = document.getElementById('terminalOutput');

    // Save current stage's terminal history before switching
    stageTerminalHistory[currentStage] = termOut.innerHTML;

    currentStage = sc.currentStage;
    completedStages = new Set(sc.completedStages);
    renderStageDots();
    document.getElementById('missionText').innerHTML = sc.stage.mission;
    updateTabsForStage(sc.stage.id);

    // Reset query display
    document.getElementById('queryDisplay').innerHTML =
      `<div class="editor-topbar"><span class="tab">query.sql</span><span>HackLab Monitor</span></div>` +
      `<div class="editor-body">` +
      `<div class="line-numbers"><div>1</div></div>` +
      `<div class="code-area"><span class="sql-comment">-- ${sc.stage.title}</span></div>` +
      `</div>`;
    document.getElementById('queryResult').innerHTML = '<span style="color: var(--green-dim)">No queries executed yet.</span>';

    // Reset URL bar
    document.getElementById('urlbarResponse').innerHTML = '<span style="color: var(--green-dim)">Enter a URL path above and press Go.</span>';
    document.getElementById('urlbarInput').value = '';

    // Restore or initialize terminal for the new stage
    if (stageTerminalHistory[sc.currentStage]) {
      termOut.innerHTML = stageTerminalHistory[sc.currentStage];
    } else {
      termOut.innerHTML = '';
    }

    const scroll = document.getElementById('terminalScroll');
    scroll.scrollTop = scroll.scrollHeight;
  }

  if (msg.restart) {
    sessionId = msg.sessionId;
    localStorage.setItem('hacklab-session', sessionId);
    document.getElementById('terminalOutput').innerHTML = '';
    // Clear all saved terminal histories
    Object.keys(stageTerminalHistory).forEach(k => delete stageTerminalHistory[k]);
  }

  // Print terminal lines
  if (msg.terminalLines) {
    for (const line of msg.terminalLines) {
      printTerminal(line);
    }
  }

  // Update SQL monitor
  if (msg.query) displayQuery(msg.query);
  if (msg.queryResult) displayResult(msg.queryResult);

  // Handle stage completion
  if (msg.stagePass && msg.stageSuccess) {
    completedStages.add(currentStage);
    renderStageDots();
    showSuccess(msg.stageSuccess);

    // Also notify server
    fetch('/api/stage/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  }
}

function printTerminal(html) {
  const el = document.getElementById('terminalOutput');
  const scroll = document.getElementById('terminalScroll');
  const line = document.createElement('div');
  line.innerHTML = html || '&nbsp;';
  el.appendChild(line);
  scroll.scrollTop = scroll.scrollHeight;
}

function handleTerminalKeydown(event) {
  if (event.key === 'Enter') {
    handleInput();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      document.getElementById('terminalInput').value = commandHistory[historyIndex];
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      document.getElementById('terminalInput').value = commandHistory[historyIndex];
    } else {
      historyIndex = commandHistory.length;
      document.getElementById('terminalInput').value = '';
    }
  }
}

function handleInput() {
  const input = document.getElementById('terminalInput');
  const raw = input.value.trim();
  input.value = '';

  // Echo the command
  printTerminal(`<span class="sys">hacklab&gt;</span> ${raw ? escapeHtml(raw) : ''}`);

  if (!raw) return;

  commandHistory.push(raw);
  historyIndex = commandHistory.length;

  sendCommand(raw);
}

// Submit URL bar — makes a real HTTP request to the IDOR endpoint
function submitUrlbar() {
  const urlInput = document.getElementById('urlbarInput');
  const responseEl = document.getElementById('urlbarResponse');
  let path = urlInput.value.trim();

  if (!path) { responseEl.innerHTML = '<span class="err">Please enter a URL path.</span>'; return; }
  if (!path.startsWith('/')) path = '/' + path;

  // Also send via terminal for the command log
  printTerminal(`<span class="sys">hacklab&gt;</span> visit ${escapeHtml(path)}`);
  sendCommand(`visit ${path}`);

  // Make a real HTTP request to the profile endpoint
  const idMatch = path.match(/[?&]id=(\d+)/);
  if (idMatch && path.includes('/profile')) {
    fetch(`/api/profile?id=${idMatch[1]}&sessionId=${sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          responseEl.innerHTML = `<div><span class="err">${escapeHtml(data.error)}</span></div>`;
        } else {
          let html = '<div><span class="info">══ Employee Profile ══</span></div>';
          for (const [key, val] of Object.entries(data.user)) {
            const cls = (key === 'api_key' || key === 'ssh_access' || key === 'db_access') ? 'warn' : 'info';
            html += `<div>  <span class="${cls}">${escapeHtml(key)}:</span> ${escapeHtml(val)}</div>`;
          }
          responseEl.innerHTML = html;
        }
      })
      .catch(() => {
        responseEl.innerHTML = '<span class="err">Network error.</span>';
      });
  } else {
    responseEl.innerHTML = `<span class="err">404 Not Found: ${escapeHtml(path)}</span>`;
  }
}

// Submit login form — makes a real HTTP request to the auth endpoint
function submitLoginForm() {
  const username = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');

  if (!username) { errorEl.textContent = 'Please enter a username.'; return; }

  // Determine stage mode
  const stageId = getCurrentStageId();

  // Also echo in terminal
  printTerminal(`<span class="sys">hacklab&gt;</span> login ${escapeHtml(username)} ${escapeHtml(password || '')}`);
  sendCommand(`login ${username} ${password || ''}`);

  // Make real HTTP request
  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, sessionId, stage: stageId }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        errorEl.innerHTML = '<span style="color: var(--green)">Access granted!</span>';
      } else {
        errorEl.textContent = data.error || 'Access denied.';
      }
    })
    .catch(() => {
      errorEl.textContent = 'Network error.';
    });
}

// Initialize
connectWebSocket();
