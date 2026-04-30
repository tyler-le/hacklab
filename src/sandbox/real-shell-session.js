const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const STAGE_FLAGS = {
  0: 'sk-megacorp-9f3k2j5h8d',
  1: 'pat_adm_Xf9mK2pLqR47',
  2: 'admin_token_7f3k9x',
  3: 'Pr0d_DB_M@st3r_Xk9m',
  4: 'AKIA3R9F8GHSL29XKMP4',
};

const EXEC_TIMEOUT_MS = 3000;
const OUTPUT_LIMIT_BYTES = 128 * 1024;

class RealShellSession {
  constructor(sessionId, currentStage) {
    this.sessionId = sessionId;
    this.currentStage = currentStage;
    this.sqliteMode = false;
    this.history = [];
    this.workdir = path.join(os.tmpdir(), 'hacklab-sandbox', sessionId);
    this.cwd = this.workdir;
    this._ensureSandboxLayout();
  }

  setStage(stageIndex) {
    this.currentStage = stageIndex;
  }

  getPrompt() {
    const rel = this.cwd.startsWith(this.workdir) ? this.cwd.slice(this.workdir.length) || '/' : this.cwd;
    return `sandbox@hacklab:${rel}$ `;
  }

  complete() {
    // Keep tab completion disabled for the scaffold to avoid fake suggestions.
    return { completions: [], partial: '', replaceFrom: 0 };
  }

  execute(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return { stdout: '', prompt: this.getPrompt(), sqliteMode: false };
    this.history.push(trimmed);

    // Built-ins handled in-process.
    if (trimmed === 'pwd') return { stdout: this.cwd, prompt: this.getPrompt(), sqliteMode: false };
    if (trimmed.startsWith('cd ')) return this._handleCd(trimmed.slice(3).trim());
    if (trimmed === 'cd') return this._handleCd(this.workdir);

    const execResult = this._execInShell(trimmed);
    const stageFlag = this._extractStageFlag(execResult.stdout || '');
    return {
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      stageFlag,
      prompt: this.getPrompt(),
      sqliteMode: false,
      queryResult: { type: 'shell', output: execResult.stdout || execResult.stderr || '' },
    };
  }

  destroy() {
    try {
      fs.rmSync(this.workdir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }

  _handleCd(targetRaw) {
    const target = targetRaw || this.workdir;
    const resolved = path.resolve(this.cwd, target);
    if (!resolved.startsWith(this.workdir)) {
      return { stderr: 'cd: access denied outside sandbox', prompt: this.getPrompt(), sqliteMode: false };
    }
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return { stderr: `cd: not a directory: ${target}`, prompt: this.getPrompt(), sqliteMode: false };
      }
      this.cwd = resolved;
      return { stdout: '', prompt: this.getPrompt(), sqliteMode: false };
    } catch {
      return { stderr: `cd: no such file or directory: ${target}`, prompt: this.getPrompt(), sqliteMode: false };
    }
  }

  _ensureSandboxLayout() {
    fs.mkdirSync(this.workdir, { recursive: true });
    const secretsDir = path.join(this.workdir, 'etc', 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(
      path.join(secretsDir, 'api_keys.txt'),
      [
        'AWS_SECRET_KEY=AKIA3R9F8GHSL29XKMP4',
        'STRIPE_LIVE_KEY=sk_live_4eC39HqLyjWDarjtT1',
        'DATABASE_URL=postgres://admin:S3cretP@ss!@prod-db:5432/megacorp',
      ].join('\n'),
      'utf8'
    );
  }

  _execInShell(command) {
    const env = {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: this.workdir,
      PWD: this.cwd,
      HACKLAB_SANDBOX: '1',
    };
    const result = spawnSync('/bin/sh', ['-lc', command], {
      cwd: this.cwd,
      env,
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: OUTPUT_LIMIT_BYTES,
      encoding: 'utf8',
    });

    const stdout = (result.stdout || '').trimEnd();
    let stderr = (result.stderr || '').trimEnd();
    if (result.error && result.error.code === 'ETIMEDOUT') {
      stderr = `${stderr}\n[command timed out]`.trim();
    } else if (result.error && result.error.code === 'ENOBUFS') {
      stderr = `${stderr}\n[output truncated]`.trim();
    } else if (result.error && !stderr) {
      stderr = result.error.message;
    }
    return { stdout, stderr };
  }

  _extractStageFlag(output) {
    const expected = STAGE_FLAGS[this.currentStage];
    if (!expected) return null;
    return output.includes(expected) ? expected : null;
  }
}

module.exports = RealShellSession;
