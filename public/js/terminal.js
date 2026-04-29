// WebSocket terminal connection

let ws = null;
let sessionId = localStorage.getItem('hacklab-session');
let commandHistory = [];
let historyIndex = -1;
let currentPrompt = 'www-data@megacorp:/var/www/megacorp$ ';
let sqliteMode = false;
let lastBrowserHtml = '';

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

      case 'complete':
        handleCompletionResult(msg);
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

  if (msg.prompt) {
    currentPrompt = msg.prompt;
    updatePromptDisplay();
  }

  renderStageDots();
  document.getElementById('missionText').innerHTML = msg.stage.mission;

  printTerminal('<span class="sys">HackLab v2.0 initialized.</span>');
  printTerminal('<span class="sys">Target: MegaCorp Employee Portal (megacorp-web-01)</span>');
  printTerminal('<span class="sys">Shell access as: www-data</span>');
  printTerminal('');
  printTerminal(`<span class="warn">═══ ${msg.stage.title.toUpperCase()} ═══</span>`);
  printTerminal('');
  printTerminal('<span class="info">Type <span class="cmd">help</span> for available commands, or <span class="cmd">hint</span> for a hint.</span>');
  printTerminal('');
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

  // Update SQL monitor
  if (msg.query) displayQuery(msg.query);
  if (msg.queryResult) displayResult(msg.queryResult);

  // Handle stage completion
  if (msg.stagePass && msg.stageSuccess) {
    completedStages.add(currentStage);
    if (msg.completedStages) {
      completedStages = new Set(msg.completedStages);
    }
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

// Script injected into iframe pages to intercept form submissions and links
const IFRAME_INTERCEPT_SCRIPT = `<script>
document.addEventListener('submit', function(e) {
  e.preventDefault();
  var form = e.target;
  var data = new FormData(form);
  var params = [];
  for (var pair of data.entries()) {
    params.push(encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]));
  }
  window.parent.postMessage({
    type: 'iframe-form-submit',
    method: (form.method || 'GET').toUpperCase(),
    action: form.action ? new URL(form.action, location.href).pathname : location.pathname,
    body: params.join('&')
  }, '*');
});
document.addEventListener('click', function(e) {
  var a = e.target.closest('a');
  if (a && a.href) {
    e.preventDefault();
    var url = new URL(a.href, location.href);
    window.parent.postMessage({
      type: 'iframe-navigate',
      path: url.pathname + url.search
    }, '*');
  }
});
<\/script>`;

// Inject the intercept script into HTML before </body> or at the end
function injectIframeScript(html) {
  if (html.includes('</body>')) {
    return html.replace('</body>', IFRAME_INTERCEPT_SCRIPT + '</body>');
  }
  return html + IFRAME_INTERCEPT_SCRIPT;
}

// Listen for messages from the iframe
window.addEventListener('message', function(e) {
  if (!e.data || !e.data.type) return;

  if (e.data.type === 'iframe-form-submit') {
    const { method, action, body } = e.data;
    // Build and send curl command through the shell for win detection
    let curlCmd;
    if (method === 'POST' && body) {
      curlCmd = `curl -d "${body}" http://localhost:3000${action}`;
    } else {
      curlCmd = `curl http://localhost:3000${action}`;
    }
    printTerminal(`<span class="sys">${escapeHtml(currentPrompt)}</span> ${escapeHtml(curlCmd)}`);
    sendCommand(curlCmd);

    // Also fetch the response to render in the iframe
    loadInBrowser(action, method, body);
  }

  if (e.data.type === 'iframe-navigate') {
    document.getElementById('urlbarInput').value = e.data.path;
    submitUrlbar();
  }
});

// Load a page into the browser iframe
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

  fetch(`/webapp${path}`, fetchOpts)
    .then(r => r.text())
    .then(html => {
      lastBrowserHtml = html;
      frame.style.display = 'block';
      source.style.display = 'none';
      frame.srcdoc = injectIframeScript(html);
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
  if (!path) return;
  if (!path.startsWith('/')) path = '/' + path;

  // Also send as a curl command through the terminal for win detection
  printTerminal(`<span class="sys">${escapeHtml(currentPrompt)}</span> curl http://localhost:3000${escapeHtml(path)}`);
  sendCommand(`curl http://localhost:3000${path}`);

  // Load in iframe
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
