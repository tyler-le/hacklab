// Game UI logic — stage dots, tabs, resize, hints, success display

let currentStage = 0;
let completedStages = new Set();
let stageCount = 5;
let stageCompleted = false;
let hintIndex = 0;

// Advanced pack state — set from server on init, never from localStorage
let advancedUnlocked = false;
let extraLevels = false;
let paywallTargetStage = null;
const FREE_STAGE_COUNT = 5;

let currentUser = null; // { id, email } or null

// Per-stage UI state
const stageTerminalHistory = {};
const stageQueryHistory = {};
const stageBrowserHistory = {};
const stageActiveTab = {};

// Stage ID list for tab management
const STAGE_IDS = ['intro', 'idor', 'xss', 'sql_injection', 'command_injection',
  'price_tamper', 'path_traversal', 'ssrf', 'mass_assign', 'reset_poison'];

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

// ========== PROGRESS PERSISTENCE ==========
function loadSavedProgress() {
  try {
    const raw = localStorage.getItem('hacklab-progress');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveProgress() {
  try {
    const existing = loadSavedProgress();
    localStorage.setItem('hacklab-progress', JSON.stringify({
      completedStages: [...completedStages],
      currentStage,
      stripeSessionId: existing.stripeSessionId || null,
    }));
  } catch {}
}

function saveUIState() {
  try {
    localStorage.setItem('hacklab-ui', JSON.stringify({
      stageTerminalHistory,
      stageQueryHistory,
      stageBrowserHistory,
      stageActiveTab,
    }));
  } catch {}
}

function loadUIState() {
  try {
    const raw = localStorage.getItem('hacklab-ui');
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(stageTerminalHistory, data.stageTerminalHistory || {});
    Object.assign(stageQueryHistory, data.stageQueryHistory || {});
    Object.assign(stageBrowserHistory, data.stageBrowserHistory || {});
    Object.assign(stageActiveTab, data.stageActiveTab || {});
  } catch {}
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
  saveUIState();
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

const RB_PLACEHOLDERS = {
  5: '/shop/orders',
  6: '/shop/image?file=laptop.jpg',
  7: '/shop/seller/import',
  8: '/shop/register',
  9: '/shop/reset',
};

function updateTabsForStage() {
  // All tabs always visible in v2
  stageCompleted = false;
  hintIndex = 0;
  updateMonitorTitle(currentStage);
  // Update Request Builder URL placeholder for the current stage
  const rbPath = document.getElementById('rbPath');
  if (rbPath) rbPath.placeholder = RB_PLACEHOLDERS[currentStage] || '/';
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
    'Stage 6: Price Manipulation',
    'Stage 7: Directory Traversal',
    'Stage 8: Server-Side Request Forgery',
    'Stage 9: Mass Assignment',
    'Stage 10: Password Reset Poisoning',
  ];
  // Only render dots up to the server-authorised stage count
  el.innerHTML = titles.slice(0, stageCount).map((title, i) => {
    const isAdvanced = i >= FREE_STAGE_COUNT;
    const isLocked = isAdvanced && !advancedUnlocked;
    const isDone = completedStages.has(i);
    const isActive = i === currentStage;
    const classes = ['stage-dot'];
    if (isLocked) classes.push('locked');
    if (isDone) classes.push('completed');
    if (isActive) classes.push('active');
    const tooltip = isLocked ? title + ' [LOCKED]' : title;
    return `<div class="${classes.join(' ')}" onclick="${isLocked ? `showPaywall(${i})` : `jumpToStage(${i})`}">` +
      `<span class="stage-tooltip">${tooltip}</span></div>`;
  }).join('');
}

function jumpToStage(idx) {
  if (idx === currentStage) return;

  // Check paywall for advanced stages
  if (idx >= FREE_STAGE_COUNT && !advancedUnlocked) {
    showPaywall(idx);
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
      saveProgress();
      saveProgressToServer();
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

  // completedStages already includes currentStage by the time showSuccess is called
  const packSize = advancedUnlocked ? stageCount : FREE_STAGE_COUNT;
  const allDone = completedStages.size >= packSize;

  if (allDone) {
    btnNext.textContent = 'View Summary →';
    btnNext.onclick = () => { dismissSuccess(); showCompletion(); };
    btnNext.style.display = '';
  } else if (currentStage === FREE_STAGE_COUNT - 1 && !advancedUnlocked) {
    btnNext.textContent = 'Continue to Blacksite →';
    btnNext.onclick = () => { dismissSuccess(); showPaywall(FREE_STAGE_COUNT); };
    btnNext.style.display = '';
  } else if (currentStage < stageCount - 1) {
    btnNext.textContent = 'Next Stage →';
    btnNext.onclick = () => { dismissSuccess(); jumpToStage(currentStage + 1); };
    btnNext.style.display = '';
  } else {
    // On the last stage index but pack not fully done — go to first incomplete
    let firstIncomplete = 0;
    while (firstIncomplete < stageCount && completedStages.has(firstIncomplete)) firstIncomplete++;
    if (firstIncomplete < stageCount) {
      btnNext.textContent = `Continue (${completedStages.size}/${packSize}) →`;
      btnNext.onclick = () => { dismissSuccess(); jumpToStage(firstIncomplete); };
      btnNext.style.display = '';
    } else {
      btnNext.style.display = 'none';
    }
  }

  overlay.classList.add('visible');
}

function dismissSuccess() {
  document.getElementById('successOverlay').classList.remove('visible');
  document.getElementById('terminalInput').focus();
}

// ========== PAYWALL ==========
function showPaywall(targetStage) {
  if (!extraLevels) return;
  if (!currentUser) {
    showAuthModal('unlock', '/play?unlock=1');
    return;
  }
  paywallTargetStage = targetStage !== undefined ? targetStage : null;
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
      dismissPaywall();
      window.open(d.url, '_blank');
      if (btn) { btn.textContent = 'Unlock Operation Blacksite'; btn.disabled = false; }
    } else {
      if (btn) { btn.textContent = 'Unlock Operation Blacksite'; btn.disabled = false; }
      alert(d.error || 'Payment not available. Please try again.');
    }
  } catch (err) {
    if (btn) { btn.textContent = 'Unlock Operation Blacksite'; btn.disabled = false; }
    alert('Payment service unavailable. Please try again.');
  }
}

// Handle Stripe return URL — runs in the payment tab, posts result to opener then closes
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
        if (d.unlocked && window.opener) {
          window.opener.postMessage({ type: 'hacklab-payment-unlocked', stageCount: d.stageCount, stripeSessionId: sid }, window.location.origin);
          window.close();
          return;
        }
        // Fallback: no opener (e.g. user copied the URL) — handle inline
        if (d.unlocked) {
          const p = loadSavedProgress();
          p.stripeSessionId = sid;
          localStorage.setItem('hacklab-progress', JSON.stringify(p));
          advancedUnlocked = true;
          if (d.stageCount) stageCount = d.stageCount;
          saveProgress();
          saveProgressToServer();
        }
      } catch (e) { /* silently fail */ }
    }
    window.history.replaceState({}, '', '/');
    renderStageDots();
  }
})();

// Listen for payment confirmation posted from the Stripe return tab
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin) return;
  if (e.data && e.data.type === 'hacklab-payment-unlocked') {
    advancedUnlocked = true;
    if (e.data.stageCount) stageCount = e.data.stageCount;
    if (e.data.stripeSessionId) {
      const p = loadSavedProgress();
      p.stripeSessionId = e.data.stripeSessionId;
      localStorage.setItem('hacklab-progress', JSON.stringify(p));
    }
    saveProgress();
    saveProgressToServer();
    renderStageDots();
    showUnlockSuccess();
  }
});

function showUnlockSuccess() {
  const overlay = document.getElementById('unlockOverlay');
  if (!overlay) return;
  const btn = document.getElementById('unlockStartBtn');
  if (btn) {
    const target = paywallTargetStage !== null ? paywallTargetStage : FREE_STAGE_COUNT;
    const label = `Stage ${target + 1}`;
    btn.textContent = `Start ${label} →`;
    btn.onclick = () => {
      overlay.classList.remove('visible');
      jumpToStage(target);
    };
  }
  overlay.classList.add('visible');
}

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
    { num: '08', title: 'Server-Side Request Forgery (SSRF)', owasp: 'OWASP A10 — Server-Side Request Forgery' },
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
      ? `<button class="success-btn" onclick="dismissCompletion(); showPaywall(${FREE_STAGE_COUNT});">Continue to Blacksite &rarr;</button>`
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

// ========== AUTH ==========

// Cross-tab auth: when the magic-link tab writes this key, the original tab
// sees the storage event and updates its auth state without a page reload.
let _crossTabAuthCleanup = null;

function startCrossTabAuthWatch() {
  stopCrossTabAuthWatch();
  function onStorage(e) {
    if (e.key !== 'hacklab-auth-event') return;
    stopCrossTabAuthWatch();
    dismissAuthModal();
    initAuth();
  }
  window.addEventListener('storage', onStorage);
  _crossTabAuthCleanup = () => window.removeEventListener('storage', onStorage);
}

function stopCrossTabAuthWatch() {
  if (_crossTabAuthCleanup) { _crossTabAuthCleanup(); _crossTabAuthCleanup = null; }
}


async function initAuth() {
  const prevUser = currentUser;
  try {
    const r = await fetch('/api/auth/me');
    const d = await r.json();
    currentUser = d.user;
  } catch { currentUser = null; }

  // When the user signs in while the WS is already open, the server's WS
  // handler still has userId=null from when the connection was established.
  // That means saveUserProgress() is never called and loadUserProgress() is
  // never used. Reconnecting forces the server to re-read the JWT cookie so
  // the correct userId is captured for all subsequent Turso reads/writes.
  const prevId = prevUser ? prevUser.id : null;
  const newId = currentUser ? currentUser.id : null;
  if (prevId !== newId && newId !== null) {
    reconnectWebSocket();
  }

  renderAuthState();
}

function renderAuthState() {
  const authStatus = document.getElementById('authStatus');
  const signInBtn = document.getElementById('signInBtn');
  const authEmailEl = document.getElementById('authEmail');

  if (currentUser) {
    if (authStatus) { authStatus.style.display = ''; }
    if (authEmailEl) authEmailEl.textContent = currentUser.email;
    if (signInBtn) signInBtn.style.display = 'none';
  } else {
    if (authStatus) authStatus.style.display = 'none';
    if (signInBtn) signInBtn.style.display = '';
  }
}

function showAuthModal(reason, redirectTo) {
  const overlay = document.getElementById('authOverlay');
  const title = document.getElementById('authModalTitle');
  const sub = document.getElementById('authModalSub');
  const form = document.getElementById('authModalForm');
  const sent = document.getElementById('authModalSent');
  const input = document.getElementById('authEmailInput');

  if (reason === 'unlock') {
    title.textContent = 'Sign in to Unlock Blacksite';
    sub.textContent = 'Create a free account to purchase and permanently save your Blacksite access across any device.';
  } else {
    title.textContent = 'Sign in to HackLab';
    sub.textContent = 'Progress is saved to your account and works across devices and server restarts.';
  }

  form.style.display = '';
  sent.style.display = 'none';
  if (input) { input.value = ''; }
  overlay.dataset.redirectTo = redirectTo || '/play';
  overlay.classList.add('visible');
  setTimeout(() => { if (input) input.focus(); }, 100);
}

function dismissAuthModal() {
  stopCrossTabAuthWatch();
  document.getElementById('authOverlay').classList.remove('visible');
}

async function sendMagicLink() {
  const input = document.getElementById('authEmailInput');
  const btn = document.getElementById('authSubmitBtn');
  const overlay = document.getElementById('authOverlay');
  const email = input ? input.value.trim() : '';
  if (!email || !email.includes('@')) {
    if (input) input.focus();
    return;
  }

  const redirectTo = overlay.dataset.redirectTo || '/play';
  btn.textContent = 'Sending...';
  btn.disabled = true;

  try {
    const r = await fetch('/api/auth/send-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, next: redirectTo }),
    });
    const d = await r.json();
    if (d.sent) {
      document.getElementById('authModalForm').style.display = 'none';
      document.getElementById('authModalSent').style.display = '';
      startCrossTabAuthWatch(); // update this tab when the email link is clicked
    } else {
      btn.textContent = 'Send sign-in link';
      btn.disabled = false;
      alert(d.error || 'Failed to send link. Please try again.');
    }
  } catch {
    btn.textContent = 'Send sign-in link';
    btn.disabled = false;
    alert('Email service unavailable. Please try again.');
  }
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  advancedUnlocked = false;
  stageCount = FREE_STAGE_COUNT;
  completedStages = new Set();
  currentStage = 0;
  paywallTargetStage = null;
  localStorage.removeItem('hacklab-progress');
  saveProgress(); // persist the blank state so reconnect sees empty savedProgress
  renderAuthState();
  renderStageDots();
  sendReset(); // reset server-side session state; also clears sessionId if WS is down
}

async function saveProgressToServer() {
  if (!currentUser) return;
  try {
    const existing = loadSavedProgress();
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completedStages: [...completedStages],
        currentStage,
        advancedUnlocked,
        stripeSessionId: existing.stripeSessionId || null,
      }),
    });
  } catch {}
}

initAuth();

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

// ========== REQUEST BUILDER ==========

function switchBrowserPanel(tab) {
  const browserView = document.getElementById('bpBrowserView');
  const requestView = document.getElementById('bpRequestView');
  const btnBrowser  = document.getElementById('bpTabBrowser');
  const btnRequest  = document.getElementById('bpTabRequest');

  if (tab === 'browser') {
    browserView.style.display = '';
    requestView.style.display = 'none';
    btnBrowser.classList.add('active');
    btnRequest.classList.remove('active');
  } else {
    browserView.style.display = 'none';
    requestView.style.display = '';
    btnBrowser.classList.remove('active');
    btnRequest.classList.add('active');
    rbUpdatePreview();
  }
}

let _rbRowId = 0;

function rbAddRow(containerId, keyPlaceholder) {
  const container = document.getElementById(containerId);
  // Remove empty-hint if present
  const hint = container.querySelector('.rb-empty-hint');
  if (hint) hint.remove();

  const id = ++_rbRowId;
  const row = document.createElement('div');
  row.className = 'rb-kv-row';
  row.dataset.rowId = id;
  row.innerHTML =
    `<input class="rb-kv-key" placeholder="${keyPlaceholder}" oninput="rbUpdatePreview()" autocomplete="off" spellcheck="false">` +
    `<input class="rb-kv-val" placeholder="value" oninput="rbUpdatePreview()" autocomplete="off" spellcheck="false">` +
    `<button class="rb-kv-remove" onclick="rbRemoveRow(this,'${containerId}')" title="Remove">&#x2715;</button>`;
  container.appendChild(row);
  row.querySelector('.rb-kv-key').focus();
  rbUpdatePreview();
}

function rbRemoveRow(btn, containerId) {
  const row = btn.closest('.rb-kv-row');
  const container = document.getElementById(containerId);
  row.remove();
  // Restore hint if no rows left
  if (!container.querySelector('.rb-kv-row')) {
    const hint = document.createElement('span');
    hint.className = 'rb-empty-hint';
    hint.textContent = containerId === 'rbHeaderRows'
      ? 'No headers — click + Add to inject one (e.g. Host: evil.com)'
      : 'No body params — click + Add (used for POST requests)';
    container.appendChild(hint);
  }
  rbUpdatePreview();
}

function rbGetRows(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .rb-kv-row`);
  const result = [];
  rows.forEach(row => {
    const key = row.querySelector('.rb-kv-key').value.trim();
    const val = row.querySelector('.rb-kv-val').value.trim();
    if (key) result.push({ key, val });
  });
  return result;
}

function rbUpdatePreview() {
  const method  = document.getElementById('rbMethod').value;
  const path    = document.getElementById('rbPath').value.trim() || '/';
  const headers = rbGetRows('rbHeaderRows');
  const body    = rbGetRows('rbBodyRows');

  let lines = ['curl'];
  if (method !== 'GET') lines[0] += ` -X ${method}`;

  for (const { key, val } of headers) {
    lines.push(`  -H "${key}: ${val}"`);
  }

  if (method !== 'GET' && body.length > 0) {
    const bodyStr = body.map(({ key, val }) => `${key}=${val}`).join('&');
    lines.push(`  -d "${bodyStr}"`);
  }

  let fullPath = path;
  if (method === 'GET' && body.length > 0) {
    const qs = body.map(({ key, val }) => `${key}=${val}`).join('&');
    fullPath = path + (path.includes('?') ? '&' : '?') + qs;
  }

  lines.push(`  "http://portal.megacorp.internal${fullPath}"`);
  document.getElementById('rbCurlCode').textContent = lines.join(' \\\n');
}

function rbSend() {
  const method  = document.getElementById('rbMethod').value;
  const path    = document.getElementById('rbPath').value.trim() || '/';
  const headers = rbGetRows('rbHeaderRows');
  const body    = rbGetRows('rbBodyRows');

  const headersObj = {};
  headers.forEach(({ key, val }) => { headersObj[key] = val; });

  let finalPath = path;
  let bodyStr   = null;

  if (method === 'GET' && body.length > 0) {
    const qs = body.map(({ key, val }) => `${key}=${val}`).join('&');
    finalPath = path + (path.includes('?') ? '&' : '?') + qs;
  } else if (method !== 'GET' && body.length > 0) {
    bodyStr = body.map(({ key, val }) => `${key}=${val}`).join('&');
  }

  // Show loading state
  const responseArea  = document.getElementById('rbResponseArea');
  const statusEl      = document.getElementById('rbResponseStatus');
  const frameEl       = document.getElementById('rbResponseFrame');
  responseArea.classList.add('visible');
  statusEl.textContent = 'Sending...';
  statusEl.className = 'rb-response-status';
  frameEl.srcdoc = '<body style="background:#0a0a0a;color:#444;font-family:monospace;padding:20px;font-size:13px">Sending request...</body>';

  const btn = document.getElementById('rbSendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'browser-navigate',
      method,
      path: finalPath,
      body: bodyStr || '',
      headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
      fromBuilder: true,
    }));
  }
}

// Called from terminal.js when browser-navigate returns responseHtml
function handleBuilderResponse(html, exploitDetected) {
  const responseArea = document.getElementById('rbResponseArea');
  const statusEl     = document.getElementById('rbResponseStatus');
  const frameEl      = document.getElementById('rbResponseFrame');
  const btn          = document.getElementById('rbSendBtn');

  responseArea.classList.add('visible');

  if (exploitDetected) {
    statusEl.textContent = '✓ Exploit fired! Check the response for your flag.';
    statusEl.className = 'rb-response-status exploit';
  } else {
    statusEl.textContent = 'Response received';
    statusEl.className = 'rb-response-status success';
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Send'; }

  if (html) {
    const isHtml = /<[a-z]/i.test(html);
    if (isHtml) {
      frameEl.srcdoc = html;
    } else {
      const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      frameEl.srcdoc = `<body style="background:#0a0a0a;color:#00ff41;font-family:monospace;padding:16px;margin:0;white-space:pre-wrap;font-size:13px">${escaped}</body>`;
    }
  }
}
