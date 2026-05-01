// Game UI logic — stage dots, tabs, resize, hints, success display

let currentStage = 0;
let completedStages = new Set();
let stageCount = 10;
let stageCompleted = false;
let hintIndex = 0;

// Advanced pack unlock state
let advancedUnlocked = localStorage.getItem('hacklab_advanced') === 'true';
const FREE_STAGE_COUNT = 5;

// Per-stage UI state
const stageTerminalHistory = {};
const stageQueryHistory = {};
const stageBrowserHistory = {};
const stageActiveTab = {};

// Stage ID list for tab management
const STAGE_IDS = ['intro', 'idor', 'xss', 'sql_injection', 'command_injection',
  'cookie_tamper', 'verb_tamper', 'verbose_errors', 'debug_param', 'path_traversal'];

// Monitor title per stage (null = hide the panel)
const MONITOR_TITLES = {
  0: null,
  1: null,
  2: null,
  3: 'SQL Query Monitor',
  4: 'Shell Command Monitor',
  5: null,
  6: null,
  7: null,
  8: null,
  9: null,
};

function updateMonitorTitle(stageIndex) {
  const panel = document.querySelector('.query-panel');
  const vHandle = document.getElementById('vHandle');
  const title = MONITOR_TITLES[stageIndex];

  if (title === null) {
    // Hide monitor — terminal fills the full left column
    if (panel) panel.style.display = 'none';
    if (vHandle) vHandle.style.display = 'none';
  } else {
    if (panel) panel.style.display = '';
    if (vHandle) vHandle.style.display = '';
    const el = document.getElementById('monitorTitle');
    if (el) el.textContent = title;
    const label = document.getElementById('queryLabel');
    if (label) label.textContent = stageIndex === 4 ? 'Command Output' : 'Query Result';
  }
}

function getCurrentStageId() {
  return STAGE_IDS[currentStage] || 'intro';
}

// ========== STAGE STATE SAVE/RESTORE ==========
function saveStageState(idx) {
  stageTerminalHistory[idx] = document.getElementById('terminalOutput').innerHTML;
  stageQueryHistory[idx] = {
    display: document.getElementById('queryDisplay').innerHTML,
    result: document.getElementById('queryResult').innerHTML,
  };
  stageBrowserHistory[idx] = {
    urlbar: document.getElementById('urlbarInput').value,
    frameHtml: typeof lastBrowserHtml !== 'undefined' ? lastBrowserHtml : '',
    frameVisible: document.getElementById('browserFrame').style.display !== 'none',
    sourceVisible: document.getElementById('browserSource').style.display !== 'none',
    sourceContent: document.getElementById('browserSource').textContent,
  };
  // Save which tab is active
  const activeTab = document.querySelector('.interaction-tab.active');
  if (activeTab) {
    stageActiveTab[idx] = activeTab.getAttribute('data-tab');
  }
}

function restoreStageState(idx, fallbackTitle) {
  const termOut = document.getElementById('terminalOutput');
  if (stageTerminalHistory[idx]) {
    termOut.innerHTML = stageTerminalHistory[idx];
  } else {
    termOut.innerHTML = '';
    printTerminal(`<span class="warn">═══ ${fallbackTitle.toUpperCase()} ═══</span>`);
    printTerminal('');
  }

  if (stageQueryHistory[idx]) {
    document.getElementById('queryDisplay').innerHTML = stageQueryHistory[idx].display;
    document.getElementById('queryResult').innerHTML = stageQueryHistory[idx].result;
  } else {
    resetQueryPanel(fallbackTitle);
  }

  if (stageBrowserHistory[idx]) {
    const b = stageBrowserHistory[idx];
    document.getElementById('urlbarInput').value = b.urlbar;
    if (typeof lastBrowserHtml !== 'undefined') lastBrowserHtml = b.frameHtml;
    const frame = document.getElementById('browserFrame');
    const source = document.getElementById('browserSource');
    const placeholder = document.getElementById('browserPlaceholder');
    const btn = document.getElementById('viewSourceBtn');

    if (b.frameVisible) {
      frame.style.display = 'block';
      frame.srcdoc = b.frameHtml;
      source.style.display = 'none';
      if (placeholder) placeholder.style.display = 'none';
    } else if (b.sourceVisible) {
      frame.style.display = 'none';
      source.style.display = 'block';
      source.textContent = b.sourceContent;
      if (placeholder) placeholder.style.display = 'none';
      if (btn) btn.classList.add('active');
    } else {
      resetBrowser();
    }
  } else {
    resetBrowser();
  }

  const scroll = document.getElementById('terminalScroll');
  scroll.scrollTop = scroll.scrollHeight;
}

function resetQueryPanel(title) {
  const isShellStage = currentStage === 4;
  const tab = isShellStage ? 'command' : 'query.sql';
  const comment = isShellStage ? `# ${title}` : `-- ${title}`;
  document.getElementById('queryDisplay').innerHTML =
    `<div class="editor-topbar"><span class="tab">${tab}</span><span>HackLab Monitor</span></div>` +
    `<div class="editor-body">` +
    `<div class="line-numbers"><div>1</div></div>` +
    `<div class="code-area"><span class="sql-comment">${comment}</span></div>` +
    `</div>`;
  document.getElementById('queryResult').innerHTML = `<span style="color: var(--green-dim)">No ${isShellStage ? 'commands' : 'queries'} executed yet.</span>`;
}

// ========== FLAG SUBMISSION ==========
function submitFlag() {
  const input = document.getElementById('flagInput');
  const row = document.getElementById('flagRow');
  const val = input.value.trim();
  if (!val) return;

  // Send as a terminal command — ws-handler processes it and responds with stagePass or error
  sendCommand('submit ' + val);

  // Visual feedback will be driven by the ws response (see terminal.js onFlagResult)
  // Briefly mark as pending
  row.classList.remove('correct', 'incorrect');
  input.blur();
}

// Called from terminal.js when a submit response comes back
function onFlagResult(correct) {
  const input = document.getElementById('flagInput');
  const row = document.getElementById('flagRow');
  if (correct) {
    row.classList.add('correct');
    row.classList.remove('incorrect');
    input.value = '';
  } else {
    row.classList.add('incorrect');
    row.classList.remove('correct');
    // Shake animation
    input.style.animation = 'none';
    requestAnimationFrame(() => { input.style.animation = 'shake .3s ease'; });
  }
}

// ========== TAB MANAGEMENT ==========
// Terminal and browser are always visible — just handle focus
function switchTab(tabName) {
  if (tabName === 'terminal') {
    document.getElementById('terminalInput').focus();
  } else if (tabName === 'urlbar') {
    document.getElementById('urlbarInput').focus();
  }
}

function updateTabsForStage() {
  // All tabs always visible in v2
  stageCompleted = false;
  hintIndex = 0;
  updateMonitorTitle(currentStage);
  // Restore the tab that was active when user left this stage, or default to terminal
  switchTab(stageActiveTab[currentStage] || 'terminal');
}

// ========== STAGE DOTS ==========
function renderStageDots() {
  const el = document.getElementById('stageIndicator');
  const titles = [
    'Stage 1: Information Leakage',
    'Stage 2: Broken Access Control',
    'Stage 3: Cross-Site Scripting (XSS)',
    'Stage 4: SQL Injection',
    'Stage 5: Command Injection',
    'Stage 6: Cookie Tampering',
    'Stage 7: HTTP Verb Tampering',
    'Stage 8: Verbose Error Messages',
    'Stage 9: Hidden Debug Parameter',
    'Stage 10: Path Traversal',
  ];
  el.innerHTML = titles.map((title, i) => {
    const isAdvanced = i >= FREE_STAGE_COUNT;
    const isLocked = isAdvanced && !advancedUnlocked;
    const isDone = completedStages.has(i);
    const isActive = i === currentStage;
    const classes = ['stage-dot'];
    if (isLocked) classes.push('locked');
    if (isDone) classes.push('completed');
    if (isActive) classes.push('active');
    const tooltip = isLocked ? title + ' [LOCKED]' : title;
    return `<div class="${classes.join(' ')}" onclick="${isLocked ? 'showPaywall()' : `jumpToStage(${i})`}">` +
      `<span class="stage-tooltip">${tooltip}</span></div>`;
  }).join('');
}

function jumpToStage(idx) {
  if (idx === currentStage) return;

  // Check paywall for advanced stages
  if (idx >= FREE_STAGE_COUNT && !advancedUnlocked) {
    showPaywall();
    return;
  }

  saveStageState(currentStage);

  fetch('/api/stage/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, stageIndex: idx }),
  })
    .then(r => {
      if (!r.ok) {
        return r.json().then(d => {
          if (d.paymentRequired) showPaywall();
          throw new Error(d.error || 'Switch failed');
        });
      }
      return r.json();
    })
    .then(data => {
      currentStage = data.currentStage;
      completedStages = new Set(data.completedStages);
      renderStageDots();
      document.getElementById('missionText').innerHTML = data.stage.mission;
      const fi = document.getElementById('flagInput');
      if (fi && data.stage.flagPrompt) fi.placeholder = data.stage.flagPrompt;
      const fr = document.getElementById('flagRow');
      if (fr) fr.classList.remove('correct', 'incorrect');
      updateTabsForStage();
      restoreStageState(idx, data.stage.title);
      // Sync the shell's stage so the filesystem updates
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'setStage', stageIndex: data.currentStage }));
      }
    })
    .catch(() => {}); // silently handle — paywall shown above
}

// ========== HINTS ==========
function requestHint() {
  fetch('/api/hint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, hintIndex }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.hint) {
        printTerminal(`<span class="warn">HINT: ${data.hint}</span>`);
        hintIndex++;
      } else {
        printTerminal('<span class="sys">No more hints available.</span>');
      }
    });
}

// ========== SUCCESS DISPLAY ==========
function showSuccess(success) {
  stageCompleted = true;

  const overlay = document.getElementById('successOverlay');
  document.getElementById('successTitle').textContent = success.title;
  document.getElementById('successSubtitle').textContent = success.subtitle;

  // Split explanation into main explanation and defense line
  const lines = success.explanation.split('\n');
  const defenseIdx = lines.findIndex(l => /^DEFENSE:/i.test(l.trim()));
  let explanation, defense;
  if (defenseIdx !== -1) {
    explanation = lines.slice(0, defenseIdx).join('\n').trim();
    defense = lines.slice(defenseIdx).join('\n').trim();
  } else {
    explanation = lines.join('\n').trim();
    defense = '';
  }

  document.getElementById('successExplanation').textContent = explanation;
  const defenseEl = document.getElementById('successDefense');
  if (defense) {
    defenseEl.textContent = defense;
    defenseEl.previousElementSibling.style.display = '';
  } else {
    defenseEl.textContent = '';
    defenseEl.previousElementSibling.style.display = 'none';
  }

  const btnBack = document.getElementById('successBtnBack');
  const btnNext = document.getElementById('successBtnNext');

  btnBack.textContent = '← Review Stage';
  btnBack.onclick = () => dismissSuccess();

  // After completing last free stage (stage 5, index 4), show paywall if not unlocked
  if (currentStage === FREE_STAGE_COUNT - 1 && !advancedUnlocked) {
    btnNext.textContent = 'Continue to Blacksite →';
    btnNext.onclick = () => {
      dismissSuccess();
      showPaywall();
    };
    btnNext.style.display = '';
  } else if (currentStage < stageCount - 1) {
    btnNext.textContent = 'Next Stage →';
    btnNext.onclick = () => {
      dismissSuccess();
      jumpToStage(currentStage + 1);
    };
    btnNext.style.display = '';
  } else {
    btnNext.textContent = 'View Summary →';
    btnNext.onclick = () => {
      dismissSuccess();
      showCompletion();
    };
    btnNext.style.display = '';
  }

  overlay.classList.add('visible');
}

function dismissSuccess() {
  document.getElementById('successOverlay').classList.remove('visible');
  document.getElementById('terminalInput').focus();
}

// ========== PAYWALL ==========
function showPaywall() {
  document.getElementById('paywallOverlay').classList.add('visible');
}

function dismissPaywall() {
  document.getElementById('paywallOverlay').classList.remove('visible');
  document.getElementById('terminalInput').focus();
}

async function startUnlock() {
  const btn = document.getElementById('paywallUnlockBtn');
  if (btn) { btn.textContent = 'Redirecting...'; btn.disabled = true; }
  try {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const d = await r.json();
    if (d.url) {
      window.location.href = d.url;
    } else {
      if (btn) { btn.textContent = 'Unlock Operation Blacksite'; btn.disabled = false; }
      alert(d.error || 'Payment not available. Please try again.');
    }
  } catch (err) {
    if (btn) { btn.textContent = 'Unlock Operation Blacksite'; btn.disabled = false; }
    alert('Payment service unavailable. Please try again.');
  }
}

// Handle Stripe return URL
(async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success') {
    const sid = params.get('session_id');
    if (sid) {
      try {
        const r = await fetch('/api/verify-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid, sessionId }),
        });
        const d = await r.json();
        if (d.unlocked) {
          localStorage.setItem('hacklab_advanced', 'true');
          advancedUnlocked = true;
          // Notify server via WS (will be done when WS connects in terminal.js onGameInit)
        }
      } catch (e) { /* silently fail */ }
    }
    window.history.replaceState({}, '', '/');
    renderStageDots();
  }
})();

function showCompletion() {
  const allDone = advancedUnlocked
    ? completedStages.size >= 10
    : completedStages.size >= FREE_STAGE_COUNT;

  const badge = document.getElementById('completionBadge');
  const title = document.getElementById('completionTitle');
  const subtitle = document.getElementById('completionSubtitle');
  const grid = document.getElementById('completionGrid');
  const footer = document.getElementById('completionFooter');

  const FREE_CARDS = [
    { num: '01', title: 'Information Leakage', owasp: 'OWASP A05 — Security Misconfiguration' },
    { num: '02', title: 'Broken Access Control (IDOR)', owasp: 'OWASP A01 — Broken Access Control' },
    { num: '03', title: 'Cross-Site Scripting (XSS)', owasp: 'OWASP A03 — Injection' },
    { num: '04', title: 'SQL Injection', owasp: 'OWASP A03 — Injection' },
    { num: '05', title: 'Command Injection', owasp: 'OWASP A03 — Injection' },
  ];
  const BLACKSITE_CARDS = [
    { num: '06', title: 'Cookie Tampering', owasp: 'OWASP A02 — Cryptographic Failures' },
    { num: '07', title: 'HTTP Verb Tampering', owasp: 'OWASP A01 — Broken Access Control' },
    { num: '08', title: 'Verbose Error Messages', owasp: 'OWASP A05 — Security Misconfiguration' },
    { num: '09', title: 'Hidden Debug Parameter', owasp: 'OWASP A05 — Security Misconfiguration' },
    { num: '10', title: 'Path Traversal', owasp: 'OWASP A01 — Broken Access Control' },
  ];

  const cards = advancedUnlocked ? [...FREE_CARDS, ...BLACKSITE_CARDS] : FREE_CARDS;

  if (badge) badge.textContent = advancedUnlocked ? 'OPERATION BLACKSITE COMPLETE' : 'HACKLAB COMPLETE';
  if (title) title.textContent = advancedUnlocked ? 'MegaCorp Exposed.' : 'Mission Accomplished';
  if (subtitle) subtitle.textContent = advancedUnlocked
    ? "You've uncovered and dismantled MegaCorp's illegal surveillance program, Project Sentinel."
    : "You've identified all 5 vulnerabilities in the MegaCorp portal.";

  if (grid) {
    grid.innerHTML = cards.map(c =>
      `<div class="completion-card">` +
      `<div class="completion-card-num">${c.num}</div>` +
      `<div class="completion-card-title">${c.title}</div>` +
      `<div class="completion-card-owasp">${c.owasp}</div>` +
      `</div>`
    ).join('');
  }

  if (footer) {
    const footerMsg = advancedUnlocked
      ? "You've identified 10 real-world web vulnerabilities. These attacks happen to production systems every day. Now you know how to spot them — and how to defend against them."
      : "These are real vulnerabilities found in production systems every day. Now you know how to spot them — and how to defend against them.";
    const blacksiteBtn = !advancedUnlocked
      ? `<button class="success-btn" onclick="dismissCompletion(); showPaywall();">Continue to Blacksite &rarr;</button>`
      : '';
    footer.innerHTML = `<p>${footerMsg}</p>
      <div class="completion-btn-row">
        <a class="success-btn coffee-modal-btn" href="https://buymeacoffee.com/tylerle" target="_blank" rel="noopener">&#9749; Buy me a coffee</a>
        <button class="success-btn secondary" onclick="dismissCompletion()">&larr; Back to Terminal</button>
        ${blacksiteBtn}
        <button class="success-btn" onclick="restartFromCompletion()">Play Again</button>
      </div>`;
  }

  document.getElementById('completionOverlay').classList.add('visible');
}

function dismissCompletion() {
  document.getElementById('completionOverlay').classList.remove('visible');
  document.getElementById('terminalInput').focus();
}

function restartFromCompletion() {
  dismissCompletion();
  sendCommand('restart');
}

// ========== RESIZE HANDLES ==========
(function setupResize() {
  const hHandle = document.getElementById('hHandle');
  const vHandle = document.getElementById('vHandle');
  const leftCol = document.querySelector('.left-col');
  const rightCol = document.querySelector('.right-col');
  const queryPanel = document.querySelector('.query-panel');
  const interactionPanel = document.querySelector('.interaction-panel');
  const mainSplit = document.querySelector('.main-split');

  let dragging = null;

  hHandle.addEventListener('mousedown', (e) => {
    dragging = 'h';
    hHandle.classList.add('active');
    e.preventDefault();
  });

  vHandle.addEventListener('mousedown', (e) => {
    dragging = 'v';
    vHandle.classList.add('active');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;

    if (dragging === 'h') {
      const rect = mainSplit.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(20, Math.min(80, pct));
      leftCol.style.flex = `0 0 ${clamped}%`;
      rightCol.style.flex = `0 0 ${100 - clamped}%`;
    } else if (dragging === 'v') {
      const rect = rightCol.getBoundingClientRect();
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.max(15, Math.min(70, pct));
      queryPanel.style.flex = `0 0 ${clamped}%`;
      interactionPanel.style.flex = `1 1 ${100 - clamped}%`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      hHandle.classList.remove('active');
      vHandle.classList.remove('active');
      dragging = null;
    }
  });
})();

// ========== CLICK TO FOCUS ==========
(function setupClickFocus() {
  const terminalPanel = document.querySelector('.terminal-panel');
  let mouseDownPos = null;

  terminalPanel.addEventListener('mousedown', (e) => {
    mouseDownPos = { x: e.clientX, y: e.clientY };
  });

  terminalPanel.addEventListener('mouseup', (e) => {
    if (!mouseDownPos) return;
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    mouseDownPos = null;

    // Only focus if it was a click, not a drag (for text selection)
    if (dist < 5 && !window.getSelection().toString()) {
      document.getElementById('terminalInput').focus();
    }
  });
})();
