// Game UI logic — stage dots, tabs, resize, hints, success display

let currentStage = 0;
let completedStages = new Set();
let stageCount = 5;
let stageCompleted = false;
let hintIndex = 0;

// Per-stage UI state
const stageTerminalHistory = {};
const stageQueryHistory = {};
const stageBrowserHistory = {};
const stageActiveTab = {};

// Stage ID list for tab management
const STAGE_IDS = ['intro', 'idor', 'xss', 'sql_injection', 'command_injection'];

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
  document.getElementById('queryDisplay').innerHTML =
    `<div class="editor-topbar"><span class="tab">query.sql</span><span>HackLab Monitor</span></div>` +
    `<div class="editor-body">` +
    `<div class="line-numbers"><div>1</div></div>` +
    `<div class="code-area"><span class="sql-comment">-- ${title}</span></div>` +
    `</div>`;
  document.getElementById('queryResult').innerHTML = '<span style="color: var(--green-dim)">No queries executed yet.</span>';
}

// ========== TAB MANAGEMENT ==========
function switchTab(tabName) {
  document.querySelectorAll('.interaction-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

  if (tabName === 'terminal') {
    document.getElementById('tabTerminal').classList.add('active');
    document.querySelector('[data-tab="terminal"]').classList.add('active');
    document.getElementById('terminalInput').focus();
  } else if (tabName === 'urlbar') {
    document.getElementById('tabUrlbar').classList.add('active');
    document.querySelector('[data-tab="urlbar"]').classList.add('active');
    document.getElementById('urlbarInput').focus();
  }
}

function updateTabsForStage() {
  // All tabs always visible in v2
  stageCompleted = false;
  hintIndex = 0;
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
  ];
  el.innerHTML = titles.map((title, i) =>
    `<div class="stage-dot ${completedStages.has(i) ? 'completed' : ''} ${i === currentStage ? 'active' : ''}" onclick="jumpToStage(${i})">` +
    `<span class="stage-tooltip">${title}</span></div>`
  ).join('');
}

function jumpToStage(idx) {
  if (idx === currentStage) return;

  saveStageState(currentStage);

  fetch('/api/stage/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, stageIndex: idx }),
  })
    .then(r => r.json())
    .then(data => {
      currentStage = data.currentStage;
      completedStages = new Set(data.completedStages);
      renderStageDots();
      document.getElementById('missionText').innerHTML = data.stage.mission;
      updateTabsForStage();
      restoreStageState(idx, data.stage.title);
    });
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

  if (currentStage < stageCount - 1) {
    btnNext.textContent = 'Next Stage →';
    btnNext.onclick = () => {
      dismissSuccess();
      jumpToStage(currentStage + 1);
    };
    btnNext.style.display = '';
  } else {
    btnNext.style.display = 'none';
  }

  overlay.classList.add('visible');
}

function dismissSuccess() {
  document.getElementById('successOverlay').classList.remove('visible');
  document.getElementById('terminalInput').focus();
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
