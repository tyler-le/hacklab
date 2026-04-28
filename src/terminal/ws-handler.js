const sessionManager = require('../db/session-manager');
const { getStage, getStageCount } = require('../stages/stage-checker');
const { getGameState } = require('../routes/game');

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseCommand(input) {
  const raw = input.trim();
  const cmdMatch = raw.match(/^([\w-]+)\s*(.*)/);
  if (!cmdMatch) return { cmd: '', args: [], rawArgs: '', raw };

  const cmd = cmdMatch[1].toLowerCase();
  const argStr = cmdMatch[2];

  // For search and ping: preserve full raw args
  if ((cmd === 'search' || cmd === 'ping') && argStr) {
    return { cmd, args: [argStr], rawArgs: argStr, raw };
  }

  // For login: detect SQL injection patterns
  if (cmd === 'login' && argStr) {
    const looksLikeInjection = /['";]|(\bOR\b)|(\bUNION\b)|(\bAND\b)|(\bSELECT\b)|(--)/i.test(argStr);
    if (looksLikeInjection) {
      return { cmd, args: [argStr, ''], rawArgs: argStr, raw };
    }
    const parts = argStr.split(/\s+/);
    return { cmd, args: [parts[0], parts.slice(1).join(' ')], rawArgs: argStr, raw };
  }

  const args = argStr ? argStr.split(/\s+/) : [];
  return { cmd, args, rawArgs: argStr, raw };
}

function handleWebSocket(ws) {
  let sessionId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'init':
        handleInit(ws, msg);
        break;
      case 'command':
        handleCommand(ws, msg);
        break;
    }
  });

  function handleInit(ws, msg) {
    if (msg.sessionId) {
      const db = sessionManager.getSession(msg.sessionId);
      if (db) {
        sessionId = msg.sessionId;
        const state = getGameState(sessionId);
        const stage = getStage(state.currentStage);
        ws.send(JSON.stringify({
          type: 'init',
          sessionId,
          currentStage: state.currentStage,
          completedStages: [...state.completedStages],
          stageCount: getStageCount(),
          stage: { id: stage.id, title: stage.title, mission: stage.mission },
        }));
        return;
      }
    }
    // Create new session
    sessionId = sessionManager.createSession();
    const state = getGameState(sessionId);
    const stage = getStage(0);
    ws.send(JSON.stringify({
      type: 'init',
      sessionId,
      currentStage: 0,
      completedStages: [],
      stageCount: getStageCount(),
      stage: { id: stage.id, title: stage.title, mission: stage.mission },
    }));
  }

  function handleCommand(ws, msg) {
    const { command } = msg;
    if (!sessionId) return;

    const state = getGameState(sessionId);
    const db = sessionManager.getSession(sessionId);
    if (!db) return;

    const stageIndex = state.currentStage;
    const stage = getStage(stageIndex);
    const parts = parseCommand(command);

    const send = (payload) => ws.send(JSON.stringify({ type: 'result', ...payload }));

    switch (parts.cmd) {
      case 'help': {
        const lines = ['<span class="info">Available commands:</span>'];
        if (stage.helpCommands) {
          for (const hc of stage.helpCommands) {
            lines.push(`  <span class="cmd">${hc.cmd}</span>  - ${hc.desc}`);
          }
        }
        lines.push(`  <span class="cmd">hint</span>                - Get a hint`);
        lines.push(`  <span class="cmd">next</span>                - Go to next stage`);
        lines.push(`  <span class="cmd">restart</span>             - Restart from stage 1`);
        lines.push(`  <span class="cmd">clear</span>               - Clear terminal`);
        lines.push(`  <span class="cmd">status</span>              - Show current stage`);
        lines.push(`  <span class="cmd">help</span>                - Show this message`);
        send({ terminalLines: lines });
        break;
      }

      case 'hint': {
        if (!state.hintIndex) state.hintIndex = {};
        if (!state.hintIndex[stageIndex]) state.hintIndex[stageIndex] = 0;
        const idx = state.hintIndex[stageIndex];
        if (idx < stage.hints.length) {
          send({ terminalLines: [`<span class="warn">HINT: ${stage.hints[idx]}</span>`] });
          state.hintIndex[stageIndex]++;
        } else {
          send({ terminalLines: ['<span class="sys">No more hints available.</span>'] });
        }
        break;
      }

      case 'clear':
        send({ clear: true });
        break;

      case 'status':
        send({
          terminalLines: [
            `<span class="info">Current: ${stage.title}</span>`,
            `<span class="info">Progress: ${state.completedStages.size}/${getStageCount()} stages completed</span>`,
          ],
        });
        break;

      case 'next': {
        if (!state.completedStages.has(stageIndex)) {
          send({ terminalLines: ['<span class="err">Complete the current stage first.</span>'] });
        } else if (stageIndex >= getStageCount() - 1) {
          send({ terminalLines: ['<span class="info">No more stages. Type <span class="cmd">restart</span> to play again.</span>'] });
        } else {
          state.currentStage++;
          const newStage = getStage(state.currentStage);
          send({
            stageChange: {
              currentStage: state.currentStage,
              completedStages: [...state.completedStages],
              stage: { id: newStage.id, title: newStage.title, mission: newStage.mission },
            },
          });
        }
        break;
      }

      case 'restart': {
        // Reset DB
        sessionManager.destroySession(sessionId);
        sessionId = sessionManager.createSession();
        state.currentStage = 0;
        state.completedStages = new Set();
        state.hintIndex = {};
        // Update gameState map with new sessionId
        const { getGameState: ggs } = require('../routes/game');
        const newState = ggs(sessionId);
        newState.currentStage = 0;
        newState.completedStages = new Set();

        const s = getStage(0);
        send({
          restart: true,
          sessionId,
          stageChange: {
            currentStage: 0,
            completedStages: [],
            stage: { id: s.id, title: s.title, mission: s.mission },
          },
          terminalLines: [
            '<span class="sys">HackLab v2.0 restarted.</span>',
            '',
          ],
        });
        break;
      }

      case 'view-source':
        handleViewSource(ws, send, stage);
        break;

      case 'login':
        handleLogin(ws, send, db, stage, state, parts);
        break;

      case 'visit':
        handleVisit(ws, send, db, stage, state, parts);
        break;

      case 'search':
        handleSearch(ws, send, db, stage, state, parts);
        break;

      case 'ping':
        handlePing(ws, send, stage, state, parts);
        break;

      default:
        send({ terminalLines: [`<span class="err">Unknown command: ${escapeHtml(parts.cmd)}. Type 'help' for commands.</span>`] });
    }
  }

  function handleViewSource(ws, send, stage) {
    if (stage.id !== 'intro') {
      send({ terminalLines: [`<span class="err">Command 'view-source' is not available in this stage.</span>`] });
      return;
    }
    const lines = [
      `<span class="info">--- Page Source: portal.megacorp.local/login ---</span>`,
      `<span class="sys">&lt;form action="/auth" method="POST"&gt;</span>`,
      `<span class="sys">  &lt;input name="username" /&gt;</span>`,
      `<span class="sys">  &lt;input name="password" type="password" /&gt;</span>`,
      `<span class="sys">  &lt;!-- TODO: remove before deploy --&gt;</span>`,
      `<span class="sys">  &lt;!-- default test account: admin / password123 --&gt;</span>`,
      `<span class="sys">  &lt;button type="submit"&gt;Sign In&lt;/button&gt;</span>`,
      `<span class="sys">&lt;/form&gt;</span>`,
      `<span class="warn">Interesting... there's an HTML comment with credentials left in the source code!</span>`,
    ];
    send({ terminalLines: lines });
  }

  function handleLogin(ws, send, db, stage, state, parts) {
    if (stage.id !== 'intro' && stage.id !== 'sql_injection') {
      send({ terminalLines: [`<span class="err">Command 'login' is not available in this stage.</span>`] });
      return;
    }

    const username = parts.args[0] || '';
    const password = parts.args[1] || '';

    if (stage.id === 'sql_injection') {
      // VULNERABLE: string concatenation into real SQL
      const query = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;
      try {
        const rows = db.prepare(query).all();
        const loginOk = rows.length > 0;
        const hasOrTautology = /OR\s+[\d']\s*=\s*[\d']/i.test(query) || /OR\s+1\s*=\s*1/i.test(query);
        const stagePass = hasOrTautology && loginOk;

        const terminalLines = [];
        if (stagePass) {
          terminalLines.push(`<span class="success">ACCESS GRANTED!</span>`);
          terminalLines.push(`<span class="info">Logged in as: ${escapeHtml(rows[0].username)} (${escapeHtml(rows[0].role)})</span>`);
          terminalLines.push(`<span class="warn">You bypassed authentication without knowing any password!</span>`);
        } else if (loginOk) {
          terminalLines.push(`<span class="info">Login successful, but you used real credentials. Try bypassing the password check entirely with SQL injection!</span>`);
        } else {
          terminalLines.push(`<span class="err">Access denied.</span> <span class="sys">Try probing with a single quote first: login '</span>`);
        }

        send({
          terminalLines,
          query,
          queryResult: loginOk
            ? { rows: rows.map(r => ({ username: r.username, role: r.role })), cols: ['username', 'role'] }
            : { error: 'Invalid username or password.' },
          stagePass,
          stageSuccess: stagePass ? stage.success : null,
        });
      } catch (e) {
        // Intentionally leak SQL error
        send({
          terminalLines: [
            `<span class="err">Server returned error: SQL syntax error</span>`,
            `<span class="warn">The server leaked a SQL error! This confirms user input goes directly into a SQL query. Now use that knowledge to craft an injection that bypasses the login.</span>`,
          ],
          query,
          queryResult: { error: e.message },
          stagePass: false,
        });
      }
    } else {
      // Stage 1: parameterized (safe)
      const displayQuery = `SELECT * FROM users WHERE username='${escapeHtml(username)}' AND password='${escapeHtml(password)}'`;
      const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
      const stagePass = !!user && username === 'admin' && password === 'password123';

      const terminalLines = [];
      if (stagePass) {
        terminalLines.push(`<span class="success">ACCESS GRANTED!</span>`);
        terminalLines.push(`<span class="info">Logged in as: ${escapeHtml(user.username)} (${escapeHtml(user.role)})</span>`);
        terminalLines.push(`<span class="warn">You found credentials hidden in the page source!</span>`);
      } else if (user) {
        terminalLines.push(`<span class="info">Login successful as ${escapeHtml(user.username)}, but this isn't the target account.</span>`);
      } else {
        terminalLines.push(`<span class="err">Access denied. Invalid credentials.</span>`);
        terminalLines.push(`<span class="sys">Have you tried inspecting the page source?</span>`);
      }

      send({
        terminalLines,
        query: displayQuery,
        queryResult: user
          ? { rows: [{ status: 'Login successful', user: user.username, role: user.role }], cols: ['status', 'user', 'role'] }
          : { error: 'Invalid username or password.' },
        stagePass,
        stageSuccess: stagePass ? stage.success : null,
      });
    }
  }

  function handleVisit(ws, send, db, stage, state, parts) {
    if (stage.id !== 'idor') {
      send({ terminalLines: [`<span class="err">Command 'visit' is not available in this stage.</span>`] });
      return;
    }

    const url = parts.args[0] || '';
    const idMatch = url.match(/[?&]id=(\d+)/);

    if (!idMatch) {
      if (url.includes('/profile')) {
        send({ terminalLines: [`<span class="err">400 Bad Request: Missing required parameter 'id'</span>`, `<span class="sys">Try: visit /profile?id=1</span>`] });
      } else if (url.includes('/admin')) {
        send({ terminalLines: [`<span class="err">403 Forbidden: Admin panel access denied.</span>`, `<span class="sys">Hmm, there IS an admin panel... but it's locked down. Try exploring user profiles instead.</span>`] });
      } else {
        send({ terminalLines: [`<span class="err">404 Not Found: ${escapeHtml(url)}</span>`] });
      }
      return;
    }

    const id = parseInt(idMatch[1]);
    // REAL database query — no authorization check (IDOR vulnerability)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    if (!user) {
      send({
        terminalLines: [
          `<span class="sys">200 OK — Profile page loaded</span>`,
          `<span class="err">No employee found with id=${id}.</span>`,
          `<span class="sys">There are 5 employees in the system. Keep trying different IDs.</span>`,
        ],
        query: `SELECT * FROM users WHERE id = ${id}`,
        queryResult: { error: `No employee found with id=${id}` },
      });
      return;
    }

    const isAdmin = user.role === 'admin';
    const profileLines = [
      `<span class="sys">200 OK — Profile page loaded</span>`,
      ``,
      `<span class="info">══ Employee Profile ══</span>`,
      `  <span class="info">Name:</span>       ${escapeHtml(user.username)}`,
      `  <span class="info">Email:</span>      ${escapeHtml(user.email)}`,
      `  <span class="info">Department:</span> ${escapeHtml(user.department)}`,
      `  <span class="info">Role:</span>       ${escapeHtml(user.role)}`,
    ];

    if (isAdmin) {
      profileLines.push(``);
      profileLines.push(`  <span class="warn">══ Admin Notes (internal) ══</span>`);
      profileLines.push(`  <span class="warn">API Key:</span>    ${user.api_key}`);
      profileLines.push(`  <span class="warn">SSH Access:</span> ${user.ssh_access}`);
      profileLines.push(`  <span class="warn">DB Access:</span>  ${user.db_access}`);
      profileLines.push(``);
      profileLines.push(`<span class="success">You accessed the admin's profile and found internal credentials!</span>`);
    } else if (id !== 1) {
      profileLines.push(``);
      profileLines.push(`<span class="warn">You accessed someone else's profile! The server didn't check if you're allowed to view this.</span>`);
      profileLines.push(`<span class="sys">Keep looking — try to find the admin account.</span>`);
    }

    const queryResult = isAdmin
      ? { rows: [{ username: user.username, role: user.role, api_key: user.api_key, db_password: user.db_access }], cols: ['username', 'role', 'api_key', 'db_password'] }
      : { rows: [{ username: user.username, email: user.email, department: user.department, role: user.role }], cols: ['username', 'email', 'department', 'role'] };

    send({
      terminalLines: profileLines,
      query: `SELECT * FROM users WHERE id = ${id}`,
      queryResult,
      stagePass: isAdmin,
      stageSuccess: isAdmin ? stage.success : null,
    });
  }

  function handleSearch(ws, send, db, stage, state, parts) {
    if (stage.id !== 'xss') {
      send({ terminalLines: [`<span class="err">Command 'search' is not available in this stage.</span>`] });
      return;
    }

    const term = parts.rawArgs || parts.args[0] || '';
    const hasHtml = /<[a-z][\s\S]*>/i.test(term);
    const hasScript = /<script[\s>]/i.test(term);
    const callsStealCookie = /stealCookie\s*\(/i.test(term);

    // REAL database query (parameterized, safe)
    const rows = db.prepare(
      'SELECT username, department FROM users WHERE username LIKE ? OR department LIKE ?'
    ).all(`%${term}%`, `%${term}%`);

    const displayQuery = `SELECT username, department FROM users WHERE username LIKE '%${escapeHtml(term)}%' OR department LIKE '%${escapeHtml(term)}%'`;

    if (hasScript && callsStealCookie) {
      send({
        terminalLines: [
          `<span class="sys">200 OK — Search page loaded</span>`,
          `<span class="sys">Showing results for: ${escapeHtml(term)}</span>`,
          ``,
          `<span class="warn">The browser executed your script in the admin's session!</span>`,
          ``,
          `<span class="success">Cookie stolen: session=admin_8f3k9x2m7q</span>`,
          `<span class="success">You now have the admin's session token!</span>`,
          `<span class="info">With this cookie, you can impersonate the admin without knowing their password.</span>`,
        ],
        query: displayQuery,
        queryResult: { rows: [{ stolen_cookie: 'session=admin_8f3k9x2m7q', user: 'admin' }], cols: ['stolen_cookie', 'user'] },
        stagePass: true,
        stageSuccess: stage.success,
      });
      return;
    }

    if (hasScript) {
      send({
        terminalLines: [
          `<span class="sys">200 OK — Search page loaded</span>`,
          `<span class="sys">Showing results for: ${escapeHtml(term)}</span>`,
          ``,
          `<span class="warn">Your script executed! But it didn't steal the cookie.</span>`,
          `<span class="sys">Call the <span class="cmd">stealCookie()</span> function inside your script tag to capture the admin's session.</span>`,
        ],
        query: displayQuery,
      });
      return;
    }

    if (hasHtml) {
      const isBold = /<b>/i.test(term);
      const isImg = /<img/i.test(term);
      send({
        terminalLines: [
          `<span class="sys">200 OK — Search page loaded</span>`,
          `<span class="sys">Showing results for: ${escapeHtml(term)}</span>`,
          ``,
          `<span class="warn">The page rendered your HTML! ${isBold ? 'The text appeared bold.' : isImg ? 'The browser tried to load your image tag.' : 'Your HTML was injected into the page.'}</span>`,
          `<span class="info">This confirms the page is vulnerable to XSS. Now try injecting a &lt;script&gt; tag that calls stealCookie().</span>`,
        ],
        query: displayQuery,
      });
      return;
    }

    // Normal search
    send({
      terminalLines: [
        `<span class="sys">200 OK — Search page loaded</span>`,
        `<span class="sys">Showing results for: ${escapeHtml(term)}</span>`,
        rows.length > 0
          ? `<span class="info">Found ${rows.length} result(s).</span>`
          : `<span class="sys">No results found.</span>`,
        ``,
        `<span class="sys">The search term is displayed back on the page. What if it contained HTML or JavaScript code instead of plain text?</span>`,
      ],
      query: displayQuery,
      queryResult: rows.length > 0
        ? { rows: rows.map(r => ({ username: r.username, department: r.department })), cols: ['username', 'department'] }
        : null,
    });
  }

  function handlePing(ws, send, stage, state, parts) {
    if (stage.id !== 'command_injection') {
      send({ terminalLines: [`<span class="err">Command 'ping' is not available in this stage.</span>`] });
      return;
    }

    const target = parts.rawArgs || '';
    if (!target) {
      send({ terminalLines: ['<span class="err">Please provide a hostname. Usage: ping [host]</span>'] });
      return;
    }

    const shellCmd = `ping -c 1 ${target}`;
    const hasSeparator = /[;&|]/.test(target);

    // Parse injected commands
    const cmdParts = target.split(/\s*(;|&&|\|\||\|)\s*/);
    const commands = [];
    let current = '';
    for (const part of cmdParts) {
      if ([';', '&&', '||', '|'].includes(part)) {
        if (current.trim()) commands.push(current.trim());
        current = '';
      } else {
        current += part;
      }
    }
    if (current.trim()) commands.push(current.trim());

    const pingTarget = commands[0] || 'localhost';
    const isLocalhost = pingTarget === 'localhost' || pingTarget === '127.0.0.1';

    // Simulated ping output
    const pingLines = isLocalhost
      ? [
          `<span class="sys">$ ${escapeHtml(shellCmd)}</span>`,
          `<span class="sys">PING localhost (127.0.0.1): 56 data bytes</span>`,
          `<span class="sys">64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.042 ms</span>`,
        ]
      : [
          `<span class="sys">$ ${escapeHtml(shellCmd)}</span>`,
          `<span class="sys">PING ${escapeHtml(pingTarget)}: 56 data bytes</span>`,
          `<span class="sys">Request timeout for icmp_seq 0</span>`,
        ];

    // Check win condition
    const hasCat = /\bcat\b/.test(target);
    const hasSecretFile = /\/etc\/secrets\/api_keys/.test(target);
    const stagePass = hasSeparator && hasCat && hasSecretFile;

    if (stagePass) {
      // Simulated filesystem
      const SECRETS = [
        'AWS_SECRET_KEY=AKIA3R9F8GHSL29XKMP4',
        'STRIPE_LIVE_KEY=sk_live_4eC39HqLyjWDarjtT1',
        'DATABASE_URL=postgres://admin:S3cretP@ss!@prod-db:5432/megacorp',
      ];
      pingLines.push(``);
      pingLines.push(`<span class="warn">--- Injected command output ---</span>`);
      for (const line of SECRETS) {
        pingLines.push(`<span class="success">${escapeHtml(line)}</span>`);
      }
      pingLines.push(``);
      pingLines.push(`<span class="success">You read the server's secret API keys!</span>`);

      send({
        terminalLines: pingLines,
        stagePass: true,
        stageSuccess: stage.success,
        queryResult: {
          rows: SECRETS.map(s => {
            const [k, v] = s.split('=');
            return { key: k, value: v };
          }),
          cols: ['key', 'value'],
        },
      });
      return;
    }

    if (hasSeparator && commands.length > 1) {
      // Simulate injected commands
      const FAKE_FS = {
        '/var/www/megacorp': 'index.php  config.php  uploads/  logs/',
        '/etc': 'crontab  hostname  hosts  passwd  resolv.conf  secrets/',
        '/etc/secrets': 'api_keys.txt',
      };

      pingLines.push(``);
      pingLines.push(`<span class="warn">--- Injected command output ---</span>`);

      for (let i = 1; i < commands.length; i++) {
        const cmd = commands[i].trim();
        if (cmd === 'whoami') pingLines.push(`<span class="info">www-data</span>`);
        else if (cmd === 'id') pingLines.push(`<span class="info">uid=33(www-data) gid=33(www-data) groups=33(www-data)</span>`);
        else if (cmd === 'pwd') pingLines.push(`<span class="info">/var/www/megacorp</span>`);
        else if (cmd === 'hostname') pingLines.push(`<span class="info">megacorp-web-01</span>`);
        else if (cmd.startsWith('ls')) {
          const dir = cmd.replace('ls', '').trim() || '/var/www/megacorp';
          pingLines.push(`<span class="info">${FAKE_FS[dir] || `ls: cannot access '${escapeHtml(dir)}': No such file or directory`}</span>`);
        } else if (cmd.startsWith('cat')) {
          const file = cmd.replace('cat', '').trim();
          pingLines.push(`<span class="err">cat: ${escapeHtml(file)}: No such file or directory</span>`);
          if (/\/etc\/secrets/.test(file)) {
            pingLines.push(`<span class="sys">Try: cat /etc/secrets/api_keys.txt</span>`);
          }
        } else {
          pingLines.push(`<span class="info">(command executed)</span>`);
        }
      }

      pingLines.push(``);
      pingLines.push(`<span class="warn">Your injected command ran on the server! Now try to read the secret file at /etc/secrets/api_keys.txt</span>`);

      send({ terminalLines: pingLines });
      return;
    }

    // Normal ping, no injection
    if (isLocalhost) {
      pingLines.push(`<span class="sys">--- ping statistics ---</span>`);
      pingLines.push(`<span class="sys">1 packets transmitted, 1 received, 0% packet loss</span>`);
      pingLines.push(``);
      pingLines.push(`<span class="info">The server ran your input as part of a shell command. What if you added more commands after the hostname?</span>`);
    } else {
      pingLines.push(`<span class="sys">--- ping statistics ---</span>`);
      pingLines.push(`<span class="sys">1 packets transmitted, 0 received, 100% packet loss</span>`);
      pingLines.push(``);
      pingLines.push(`<span class="sys">Host unreachable. Try pinging localhost first.</span>`);
    }

    send({ terminalLines: pingLines });
  }
}

module.exports = { handleWebSocket };
