// Game UI logic — stage dots, tabs, resize, hints, success display

let currentStage = 0;
let completedStages = new Set();
let stageCount = 5;
let stageCompleted = false;
let hintIndex = 0;
const stageTerminalHistory = {};

// Stage ID list for tab management
const STAGE_IDS = ['intro', 'idor', 'xss', 'sql_injection', 'command_injection'];

function getCurrentStageId() {
  return STAGE_IDS[currentStage] || 'intro';
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
  } else if (tabName === 'browser') {
    document.getElementById('tabBrowser').classList.add('active');
    document.querySelector('[data-tab="browser"]').classList.add('active');
    document.getElementById('loginUser').focus();
  }
}

function updateTabsForStage(stageId) {
  const termBtn = document.querySelector('[data-tab="terminal"]');
  const urlBtn = document.querySelector('[data-tab="urlbar"]');
  const browserBtn = document.querySelector('[data-tab="browser"]');

  termBtn.style.display = '';
  urlBtn.style.display = 'none';
  browserBtn.style.display = 'none';

  if (stageId === 'idor') {
    urlBtn.style.display = '';
  } else if (stageId === 'sql_injection') {
    browserBtn.style.display = '';
  }

  stageCompleted = false;
  hintIndex = 0;
  switchTab('terminal');
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
  // Save current stage's terminal history
  const termOut = document.getElementById('terminalOutput');
  stageTerminalHistory[currentStage] = termOut.innerHTML;

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
      updateTabsForStage(data.stage.id);

      // Reset query panel
      document.getElementById('queryDisplay').innerHTML =
        `<div class="editor-topbar"><span class="tab">query.sql</span><span>HackLab Monitor</span></div>` +
        `<div class="editor-body">` +
        `<div class="line-numbers"><div>1</div></div>` +
        `<div class="code-area"><span class="sql-comment">-- ${data.stage.title}</span></div>` +
        `</div>`;
      document.getElementById('queryResult').innerHTML = '<span style="color: var(--green-dim)">No queries executed yet.</span>';

      // Restore or initialize terminal for this stage
      if (stageTerminalHistory[idx]) {
        termOut.innerHTML = stageTerminalHistory[idx];
      } else {
        termOut.innerHTML = '';
        printTerminal(`<span class="warn">═══ ${data.stage.title.toUpperCase()} ═══</span>`);
        printTerminal('');
      }

      const scroll = document.getElementById('terminalScroll');
      scroll.scrollTop = scroll.scrollHeight;
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
  printTerminal('');
  printTerminal(`<span class="success">╔══════════════════════════════════════╗</span>`);
  printTerminal(`<span class="success">║  ${success.title}</span>`);
  printTerminal(`<span class="success">╚══════════════════════════════════════╝</span>`);
  printTerminal('');
  printTerminal(`<span class="info">${success.subtitle}</span>`);
  printTerminal('');

  // Print explanation lines
  const explanationLines = success.explanation.split('\n');
  for (const line of explanationLines) {
    printTerminal(`<span class="sys">${escapeHtml(line)}</span>`);
  }

  printTerminal('');
  if (currentStage < stageCount - 1) {
    printTerminal(`<span class="warn">Type <span class="cmd">next</span> to continue to the next stage.</span>`);
  } else {
    printTerminal(`<span class="success">You've completed all stages! Type <span class="cmd">restart</span> to play again.</span>`);
  }
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
