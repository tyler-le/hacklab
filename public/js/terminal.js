// WebSocket terminal connection

let ws = null;
let sessionId = localStorage.getItem('hacklab-session');
let commandHistory = [];
let historyIndex = -1;
let currentPrompt = 'hacklab@megacorp:/var/www/megacorp$ ';
let sqliteMode = false;
let lastBrowserHtml = '';
let isReconnecting = false;
let reconnectAttempts = 0;

function loadSavedProgress() {
  try {
    const raw = localStorage.getItem('hacklab-progress');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'init', sessionId, savedProgress: loadSavedProgress() }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'init':
        sessionId = msg.sessionId;
        localStorage.setItem('hacklab-session', sessionId);
        onGameInit(msg);
        break;

      case 'reset':
        onGameReset(msg);
        break;

      case 'result':
        onCommandResult(msg);
        break;

      case 'complete':
        handleCompletionResult(msg);
        break;
    }
  };

  ws.onclose = () => {
    if (!isReconnecting) {
      isReconnecting = true;
      setConnectionStatus('reconnecting');
    }
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
    reconnectAttempts++;
    setTimeout(connectWebSocket, delay);
  };
}

function setConnectionStatus(state) {
  const el = document.getElementById('connStatus');
  if (!el) return;
  if (state === 'reconnecting') {
    el.textContent = '⟳ Reconnecting...';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function sendCommand(command) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command', command }));
  }
}

function sendReset() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'reset' }));
  } else {
    // WS not open — force a fresh session on next reconnect so the server
    // doesn't replay old completedStages from its in-memory gameState.
    localStorage.removeItem('hacklab-session');
  }
}

// Force the WS to reconnect so the server re-reads the JWT cookie and picks
// up the correct userId. Call this after sign-in so Turso progress loads.
function reconnectWebSocket() {
  if (ws) ws.close();
}

function onGameInit(msg) {
  currentStage = msg.currentStage;
  completedStages = new Set(msg.completedStages);
  stageCount = msg.stageCount;
  advancedUnlocked = msg.advancedUnlocked || false;
  extraLevels = msg.extraLevels || false;

  // Persist server-authorised progress to localStorage
  saveProgress();
  // Restore per-stage UI history from localStorage
  loadUIState();

  // Show Request Builder tab only when extra levels are enabled server-side
  const rbTab = document.getElementById('bpTabRequest');
  if (rbTab) rbTab.style.display = extraLevels ? '' : 'none';

  if (msg.prompt) {
    currentPrompt = msg.prompt;
    updatePromptDisplay();
  }

  renderStageDots();
  updateMonitorTitle(currentStage);
  document.getElementById('missionText').innerHTML = msg.stage.mission;
  const fi = document.getElementById('flagInput'); if (fi && msg.stage.flagPrompt) fi.placeholder = msg.stage.flagPrompt;

  if (isReconnecting) {
    isReconnecting = false;
    reconnectAttempts = 0;
    setConnectionStatus('connected');
    printTerminal('<span class="sys">Reconnected.</span>');
    printTerminal('');
  } else {
    printTerminal('<span class="sys">HackLab initialized.</span>');
    printTerminal('<span class="sys">Target: MegaCorp Employee Portal (megacorp-web-01)</span>');
    printTerminal('<span class="sys">Shell access as: hacklab</span>');
    printTerminal('');
    printTerminal(`<span class="warn">═══ ${msg.stage.title.toUpperCase()} ═══</span>`);
    printTerminal('');
    if (msg.currentStage === 0) {
      printTerminal('<span class="info">Start by exploring the server. Type <span class="cmd">ls</span> and press Enter to list files.</span>');
      printTerminal('<span class="info">Then try <span class="cmd">cat routes.js</span> to read the source code.</span>');
      printTerminal('<span class="info">Use <span class="cmd">hint</span> if you get stuck, or <span class="cmd">help</span> for all commands.</span>');
    } else {
      printTerminal('<span class="info">Type <span class="cmd">help</span> for available commands, or <span class="cmd">hint</span> for a hint.</span>');
    }
    printTerminal('');
  }

function onGameReset(msg) {
  currentStage = msg.currentStage;
  completedStages = new Set(msg.completedStages);
  stageCount = msg.stageCount;
  advancedUnlocked = msg.advancedUnlocked || false;

  if (msg.prompt) {
    currentPrompt = msg.prompt;
    updatePromptDisplay();
  }

  // Clear terminal and all saved stage history
  document.getElementById('terminalOutput').innerHTML = '';
  Object.keys(stageTerminalHistory).forEach(k => delete stageTerminalHistory[k]);
  Object.keys(stageQueryHistory).forEach(k => delete stageQueryHistory[k]);
  Object.keys(stageBrowserHistory).forEach(k => delete stageBrowserHistory[k]);
  Object.keys(stageActiveTab).forEach(k => delete stageActiveTab[k]);
  resetBrowser();
  sqliteMode = false;

  renderStageDots();
  updateMonitorTitle(0);
  document.getElementById('missionText').innerHTML = msg.stage.mission;
  const fi = document.getElementById('flagInput');
  if (fi) { fi.placeholder = msg.stage.flagPrompt || ''; fi.value = ''; }
  const fr = document.getElementById('flagRow');
  if (fr) fr.classList.remove('correct', 'incorrect');

  printTerminal('<span class="sys">Signed out. Progress reset.</span>');
  printTerminal('');
}

  // Show paywall when landing page "Unlock" button sends user here
  if (new URLSearchParams(location.search).get('unlock') === '1') {
    history.replaceState({}, '', '/play');
    document.getElementById('paywallOverlay').classList.add('visible');
  }
}

function onCommandResult(msg) {
  // Update prompt
  if (msg.prompt) {
    currentPrompt = msg.prompt;
    updatePromptDisplay();
  }

  // Track sqlite mode
  if (msg.sqliteMode !== undefined) {
    sqliteMode = msg.sqliteMode;
  }
  if (msg.exitSqlite) {
    sqliteMode = false;
  }

  // Clear terminal if requested
  if (msg.clear) {
    document.getElementById('terminalOutput').innerHTML = '';
    return;
  }

  // Handle stage change (next/restart via terminal command)
  if (msg.stageChange) {
    const sc = msg.stageChange;

    saveStageState(currentStage);

    currentStage = sc.currentStage;
    completedStages = new Set(sc.completedStages);
    renderStageDots();
    document.getElementById('missionText').innerHTML = sc.stage.mission;
    const fi2 = document.getElementById('flagInput');
    if (fi2 && sc.stage.flagPrompt) fi2.placeholder = sc.stage.flagPrompt;
    const fr2 = document.getElementById('flagRow');
    if (fr2) { fr2.classList.remove('correct', 'incorrect'); if (fi2) fi2.value = ''; }
    updateTabsForStage();
    restoreStageState(sc.currentStage, sc.stage.title);
  }

  if (msg.restart) {
    sessionId = msg.sessionId;
    localStorage.setItem('hacklab-session', sessionId);
    document.getElementById('terminalOutput').innerHTML = '';
    // Clear all saved stage state
    Object.keys(stageTerminalHistory).forEach(k => delete stageTerminalHistory[k]);
    Object.keys(stageQueryHistory).forEach(k => delete stageQueryHistory[k]);
    Object.keys(stageBrowserHistory).forEach(k => delete stageBrowserHistory[k]);
    Object.keys(stageActiveTab).forEach(k => delete stageActiveTab[k]);
    resetBrowser();
    sqliteMode = false;
  }

  // Print terminal lines
  if (msg.terminalLines) {
    for (const line of msg.terminalLines) {
      printTerminal(line);
    }
  }

  // Update monitor panel (SQL or shell command)
  if (msg.query) {
    if (msg.queryResult && msg.queryResult.type === 'shell') {
      displayShellCommand(msg.query);
    } else {
      displayQuery(msg.query);
    }
  }
  if (msg.queryResult) displayResult(msg.queryResult);

  // Handle flag submission result
  if (msg.flagResult && typeof onFlagResult === 'function') {
    onFlagResult(msg.flagResult === 'correct');
  }

  // Response from Request Builder — route to builder panel, skip terminal output
  if (msg.responseHtml !== undefined) {
    if (typeof handleBuilderResponse === 'function') {
      handleBuilderResponse(msg.responseHtml, msg.exploitDetected);
    }
    return;
  }

  // Exploit detected via browser navigation (not from builder)
  if (msg.exploitDetected) {
    printTerminal('<span class="info">✓ Exploit successful! Find the secret in the browser and submit it above.</span>');
    const scroll = document.getElementById('terminalScroll');
    scroll.scrollTop = scroll.scrollHeight;
  }

  // Show paywall if needed
  if (msg.showPaywall && typeof showPaywall === 'function') {
    showPaywall();
  }

  // Handle stage completion
  if (msg.stagePass && msg.stageSuccess) {
    completedStages.add(currentStage);
    if (msg.completedStages) {
      completedStages = new Set(msg.completedStages);
    }
    saveProgress();
    renderStageDots();
    showSuccess(msg.stageSuccess);

    fetch('/api/stage/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  }
}

function updatePromptDisplay() {
  const el = document.getElementById('promptSymbol');
  if (el) el.textContent = currentPrompt;
}

function printTerminal(html) {
  const el = document.getElementById('terminalOutput');
  const scroll = document.getElementById('terminalScroll');
  const line = document.createElement('div');
  line.innerHTML = html || '&nbsp;';
  el.appendChild(line);
  scroll.scrollTop = scroll.scrollHeight;
}

function getInputValue() {
  return document.getElementById('terminalInput').textContent || '';
}

function setInputValue(val) {
  const el = document.getElementById('terminalInput');
  el.textContent = val;
  // Move cursor to end
  if (val) {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function setupTerminalInput() {
  const el = document.getElementById('terminalInput');
  el.addEventListener('keydown', handleTerminalKeydown);
  // Prevent pasting rich text — force plain text
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  // Prevent Enter from inserting a newline
  el.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
}

function handleTerminalKeydown(event) {
  if (event.key === 'Tab') {
    event.preventDefault();
    requestCompletion();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    handleInput();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      setInputValue(commandHistory[historyIndex]);
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      setInputValue(commandHistory[historyIndex]);
    } else {
      historyIndex = commandHistory.length;
      setInputValue('');
    }
  }
}

let lastTabInput = null;
let lastTabCompletions = null;
let tabCycleIndex = 0;

function requestCompletion() {
  const value = getInputValue();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({ type: 'complete', input: value }));
}

function handleCompletionResult(msg) {
  const completions = msg.completions || [];
  const partial = msg.partial || '';
  const replaceFrom = msg.replaceFrom ?? 0;

  if (completions.length === 0) return;

  const currentValue = getInputValue();

  if (completions.length === 1) {
    const completion = completions[0];
    const suffix = completion.endsWith('/') ? '' : ' ';
    setInputValue(currentValue.substring(0, replaceFrom) + completion + suffix);
    lastTabInput = null;
    lastTabCompletions = null;
    return;
  }

  // Multiple matches — find longest common prefix
  let common = completions[0];
  for (let i = 1; i < completions.length; i++) {
    while (!completions[i].startsWith(common)) {
      common = common.substring(0, common.length - 1);
    }
  }

  if (common.length > partial.length) {
    setInputValue(currentValue.substring(0, replaceFrom) + common);
    lastTabInput = null;
    lastTabCompletions = null;
    return;
  }

  // Show all completions
  printTerminal(`<span class="sys">${escapeHtml(currentPrompt)}</span> ${escapeHtml(currentValue)}`);
  const display = completions.map(c => escapeHtml(c)).join('  ');
  printTerminal(`<span class="info">${display}</span>`);

  lastTabInput = currentValue;
  lastTabCompletions = completions;
}

function handleInput() {
  const raw = getInputValue().trim();
  setInputValue('');

  // Echo the command with the current prompt
  const promptHtml = sqliteMode
    ? '<span class="sys">sqlite&gt;</span>'
    : `<span class="sys">${escapeHtml(currentPrompt)}</span>`;
  printTerminal(`${promptHtml} ${raw ? escapeHtml(raw) : ''}`);

  if (!raw) return;

  commandHistory.push(raw);
  historyIndex = commandHistory.length;

  sendCommand(raw);
}

// Early script — override alert before any user-injected XSS scripts run
const IFRAME_EARLY_SCRIPT = `<script>
window.alert = function(msg) {
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:monospace';
  d.innerHTML = '<div style="background:#1a1a2e;border:2px solid #ff4444;border-radius:8px;padding:24px 32px;max-width:90%;text-align:center">'
    + '<div style="color:#ff4444;font-size:18px;font-weight:bold;margin-bottom:12px">⚠ XSS Alert Triggered!</div>'
    + '<div style="color:#0f0;background:#000;padding:12px;border-radius:4px;margin-bottom:16px;word-break:break-all">' + String(msg).replace(/</g,'&lt;') + '</div>'
    + '<button onclick="this.parentElement.parentElement.remove()" style="background:#ff4444;color:#fff;border:none;padding:8px 24px;border-radius:4px;cursor:pointer;font-size:14px">Dismiss</button>'
    + '</div>';
  document.body.appendChild(d);
};
<\/script>`;

// Late script — intercept form submissions and link clicks
const IFRAME_LATE_SCRIPT = `<script>
document.addEventListener('submit', function(e) {
  e.preventDefault();
  var form = e.target;
  var data = new FormData(form);
  var params = [];
  for (var pair of data.entries()) {
    params.push(encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]));
  }
  // Use getAttribute to avoid about:srcdoc URL resolution issues
  var rawAction = form.getAttribute('action') || '';
  var method = (form.getAttribute('method') || 'GET').toUpperCase();
  window.parent.postMessage({
    type: 'iframe-form-submit',
    method: method,
    action: rawAction,
    body: params.join('&')
  }, '*');
});
document.addEventListener('click', function(e) {
  var a = e.target.closest('a');
  if (a && a.getAttribute('href')) {
    e.preventDefault();
    var raw = a.getAttribute('href');
    var path = raw.replace(/^https?:\\/\\/[^/]+/, '');
    window.parent.postMessage({
      type: 'iframe-navigate',
      path: path
    }, '*');
  }
});
<\/script>`;

// Inject early script at the top (before <body> or start), late script at the bottom
function injectIframeScript(html) {
  // Insert alert override as early as possible
  if (html.includes('<body>')) {
    html = html.replace('<body>', '<body>' + IFRAME_EARLY_SCRIPT);
  } else if (html.includes('<body ')) {
    html = html.replace(/<body[^>]*>/, '$&' + IFRAME_EARLY_SCRIPT);
  } else {
    html = IFRAME_EARLY_SCRIPT + html;
  }
  // Insert form/link intercept at the end
  if (html.includes('</body>')) {
    return html.replace('</body>', IFRAME_LATE_SCRIPT + '</body>');
  }
  return html + IFRAME_LATE_SCRIPT;
}

// Listen for messages from the iframe
window.addEventListener('message', function(e) {
  if (!e.data || !e.data.type) return;

  if (e.data.type === 'iframe-form-submit') {
    const { method, action, body } = e.data;
    let fetchPath, fetchMethod = method, fetchBody = null;

    if (method === 'POST') {
      fetchPath = action;
      fetchBody = body;
    } else {
      const sep = action.includes('?') ? '&' : '?';
      fetchPath = body ? `${action}${sep}${body}` : action;
    }

    // Load in browser silently — win detection via browser-navigate WS message
    loadInBrowser(fetchPath, fetchMethod, fetchBody);
  }

  if (e.data.type === 'iframe-navigate') {
    document.getElementById('urlbarInput').value = e.data.path;
    submitUrlbar();
  }
});

// Load a page into the browser iframe — silently sends a browser-navigate WS message for win detection
function loadInBrowser(path, method, body) {
  const placeholder = document.getElementById('browserPlaceholder');
  const frame = document.getElementById('browserFrame');
  const source = document.getElementById('browserSource');

  if (placeholder) placeholder.style.display = 'none';

  const fetchOpts = { method: method || 'GET' };
  if (method === 'POST' && body) {
    fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    fetchOpts.body = body;
  }

  const sep = path.includes('?') ? '&' : '?';
  fetch(`/webapp${path}${sep}sessionId=${encodeURIComponent(sessionId)}`, fetchOpts)
    .then(r => r.text())
    .then(html => {
      lastBrowserHtml = html;
      frame.style.display = 'block';
      source.style.display = 'none';
      frame.srcdoc = injectIframeScript(html);

      // Silently check win condition via WebSocket — no terminal output for browser navigations
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'browser-navigate',
          path,
          method: method || 'GET',
          body: body || '',
          sessionId,
          cookieHeader: typeof document !== 'undefined' ? document.cookie : '',
        }));
      }
    })
    .catch(() => {
      frame.style.display = 'none';
      source.style.display = 'block';
      source.textContent = 'Error loading page.';
    });
}

// Submit Browser URL bar — loads page in iframe via vulnerable-app
function submitUrlbar() {
  const urlInput = document.getElementById('urlbarInput');
  let path = urlInput.value.trim();
  // Strip full URL prefix if user typed or pasted it
  path = path.replace(/^https?:\/\/[^/]+/, '');
  if (!path || path === '/') {
    path = '/';
  }
  if (!path.startsWith('/')) path = '/' + path;

  urlInput.value = path;
  loadInBrowser(path);
}

function toggleViewSource() {
  const btn = document.getElementById('viewSourceBtn');
  const frame = document.getElementById('browserFrame');
  const source = document.getElementById('browserSource');

  if (!lastBrowserHtml) return;

  const isSource = source.style.display !== 'none';
  if (isSource) {
    // Switch back to rendered view
    frame.style.display = 'block';
    source.style.display = 'none';
    btn.classList.remove('active');
  } else {
    // Show source
    frame.style.display = 'none';
    source.style.display = 'block';
    source.textContent = lastBrowserHtml;
    btn.classList.add('active');
  }
}

function resetBrowser() {
  const frame = document.getElementById('browserFrame');
  const source = document.getElementById('browserSource');
  const placeholder = document.getElementById('browserPlaceholder');
  const btn = document.getElementById('viewSourceBtn');

  if (frame) frame.style.display = 'none';
  if (source) source.style.display = 'none';
  if (placeholder) placeholder.style.display = 'flex';
  if (btn) btn.classList.remove('active');
  lastBrowserHtml = '';
  document.getElementById('urlbarInput').value = '';
}

// Initialize
setupTerminalInput();
connectWebSocket();
