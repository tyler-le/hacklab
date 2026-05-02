/**
 * ShellSession — per-connection shell simulator.
 * Manages cwd, command history, sqlite mode, and dispatches commands.
 */

const VirtualFS = require('./virtual-fs');
const { buildFilesystem } = require('./fs-data');
const { parseCommandLine, splitArgs } = require('./command-parser');

// Commands
const core = require('./commands/core');
const ls = require('./commands/ls');
const cd = require('./commands/cd');
const cat = require('./commands/cat');
const grep = require('./commands/grep');
const find = require('./commands/find');
const { head, tail } = require('./commands/head-tail');
const curl = require('./commands/curl');
const { sqlite3Enter, executeSql } = require('./commands/sqlite3');

class ShellSession {
  constructor(sessionId, currentStage) {
    this.sessionId = sessionId;
    this.currentStage = currentStage;
    this.cwd = currentStage >= 5 ? '/var/www/pixelmart' : '/var/www/megacorp';
    this.fs = new VirtualFS(buildFilesystem(currentStage));
    this.history = [];
    this.sqliteMode = false;
  }

  /** Rebuild the virtual filesystem when the stage changes. */
  setStage(stageIndex) {
    this.currentStage = stageIndex;
    this.cwd = stageIndex >= 5 ? '/var/www/pixelmart' : '/var/www/megacorp';
    this.fs = new VirtualFS(buildFilesystem(stageIndex));
  }

  /**
   * Get the shell prompt string.
   */
  getPrompt() {
    if (this.sqliteMode) return 'sqlite> ';
    return `hacklab@megacorp:${this.cwd}$ `;
  }

  /**
   * Build a context object passed to commands.
   */
  _ctx() {
    return {
      fs: this.fs,
      cwd: this.cwd,
      history: this.history,
      sessionId: this.sessionId,
      currentStage: this.currentStage,
      sqliteMode: this.sqliteMode,
    };
  }

  /**
   * Execute a command line string.
   * Returns { stdout, stderr, prompt, clear?, stagePass?, query?, queryResult?, sqliteMode?, exitSqlite? }
   */
  execute(input) {
    const trimmed = input.trim();
    if (!trimmed) return { stdout: '', prompt: this.getPrompt() };

    this.history.push(trimmed);

    // SQLite mode — all input goes to SQL executor
    if (this.sqliteMode) {
      const result = executeSql(this._ctx(), trimmed);
      if (result.exitSqlite) {
        this.sqliteMode = false;
      }
      return { ...result, prompt: this.getPrompt() };
    }

    // Parse command line (pipes, semicolons, &&, ||)
    const segments = parseCommandLine(trimmed);
    const outputs = [];
    let lastResult = null;
    let stageFlag = null;
    let loginSuccess = false;
    let query = null;
    let queryResult = null;
    let doClear = false;

    for (const segment of segments) {
      const result = this._executeOne(segment.command, lastResult?.stdout);

      if (result.clear) doClear = true;
      if (result.stageFlag) stageFlag = result.stageFlag;
      if (result.loginSuccess) loginSuccess = true;
      if (result.query) query = result.query;
      if (result.queryResult) queryResult = result.queryResult;

      // Collect output
      if (result.stderr) outputs.push(result.stderr);
      else if (result.stdout) outputs.push(result.stdout);

      lastResult = result;

      // Handle && (stop on failure) and || (stop on success)
      if (segment.operator === '&&' && result.stderr) break;
      if (segment.operator === '||' && !result.stderr) break;
    }

    return {
      stdout: outputs.join('\n'),
      prompt: this.getPrompt(),
      clear: doClear,
      stageFlag,
      loginSuccess,
      query,
      queryResult,
      sqliteMode: this.sqliteMode,
    };
  }

  /**
   * Execute a single command (no pipes/chains).
   * stdin is piped input from the previous command (for pipe support).
   */
  _executeOne(command, stdin) {
    const args = splitArgs(command);
    if (args.length === 0) return { stdout: '' };

    const cmd = args[0];
    const cmdArgs = args.slice(1);
    const ctx = this._ctx();

    switch (cmd) {
      case 'ls': return ls(ctx, cmdArgs);
      case 'cd': {
        const result = cd(ctx, cmdArgs);
        // cd mutates cwd on the context — propagate to session
        this.cwd = ctx.cwd;
        return result;
      }
      case 'cat': return cat(ctx, cmdArgs);
      case 'grep': {
        // If there's piped input, grep from stdin
        if (stdin && cmdArgs.length === 1) {
          const pattern = cmdArgs[0];
          try {
            const regex = new RegExp(pattern, 'i');
            const lines = stdin.split('\n').filter(l => regex.test(l));
            return { stdout: lines.join('\n') };
          } catch {
            return { stderr: `grep: invalid regex: ${pattern}` };
          }
        }
        return grep(ctx, cmdArgs);
      }
      case 'find': return find(ctx, cmdArgs);
      case 'head': return head(ctx, cmdArgs);
      case 'tail': return tail(ctx, cmdArgs);
      case 'curl': return curl(ctx, cmdArgs);
      case 'sqlite3': {
        const result = sqlite3Enter(ctx, cmdArgs);
        if (ctx.sqliteMode) this.sqliteMode = true;
        return result;
      }
      case 'pwd': return core.pwd(ctx);
      case 'whoami': return core.whoami();
      case 'id': return core.id();
      case 'hostname': return core.hostname();
      case 'uname': return core.uname(ctx, cmdArgs);
      case 'echo': return core.echo(ctx, cmdArgs);
      case 'env':
      case 'printenv': return core.env();
      case 'history': return core.history(ctx);
      case 'file': return core.file(ctx, cmdArgs);
      case 'clear': return core.clear();
      case 'help': return core.help();
      case 'hint': return { stdout: '', isHint: true };
      case 'base64': return this._base64(stdin, cmdArgs);
      case 'wc': return this._wc(stdin, cmdArgs);
      case 'sort': return this._sort(stdin);
      case 'uniq': return this._uniq(stdin);
      default:
        return { stderr: `bash: ${cmd}: command not found` };
    }
  }

  // base64 encode/decode
  _base64(stdin, args) {
    const isDecode = args.includes('-d') || args.includes('--decode');
    const input = (stdin || args.filter(a => !a.startsWith('-')).join(' ')).trim();
    if (!input) return { stderr: 'base64: missing input' };
    try {
      if (isDecode) {
        const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
        return { stdout: Buffer.from(normalized, 'base64').toString('utf8') };
      } else {
        return { stdout: Buffer.from(input).toString('base64') };
      }
    } catch {
      return { stderr: 'base64: invalid input' };
    }
  }

  // Simple pipe-friendly commands
  _wc(stdin, args) {
    if (!stdin) return { stderr: 'wc: missing operand' };
    const lines = stdin.split('\n');
    if (args.includes('-l')) return { stdout: String(lines.length) };
    const words = stdin.split(/\s+/).filter(Boolean).length;
    const chars = stdin.length;
    return { stdout: `${lines.length} ${words} ${chars}` };
  }

  _sort(stdin) {
    if (!stdin) return { stdout: '' };
    return { stdout: stdin.split('\n').sort().join('\n') };
  }

  _uniq(stdin) {
    if (!stdin) return { stdout: '' };
    const lines = stdin.split('\n');
    return { stdout: lines.filter((l, i) => i === 0 || l !== lines[i - 1]).join('\n') };
  }

  /**
   * Tab completion. Returns { completions: string[], partial: string, replaceFrom: number }
   * - completions: list of possible completions
   * - partial: the token being completed
   * - replaceFrom: character index in input where the partial starts
   */
  complete(input) {
    if (this.sqliteMode) {
      return this._completeSqlite(input);
    }

    const cursorPos = input.length;
    // Find the start of the current token (walk back from cursor)
    let tokenStart = cursorPos;
    while (tokenStart > 0 && input[tokenStart - 1] !== ' ') {
      tokenStart--;
    }
    const partial = input.substring(tokenStart);

    // Determine if we're completing a command (first token) or a path argument
    const beforeCursor = input.substring(0, tokenStart).trim();
    const isFirstToken = beforeCursor.length === 0;

    if (isFirstToken) {
      return this._completeCommand(partial, tokenStart);
    }
    return this._completePath(partial, tokenStart);
  }

  _completeCommand(partial, replaceFrom) {
    const commands = [
      'ls', 'cd', 'cat', 'grep', 'find', 'head', 'tail', 'curl', 'sqlite3',
      'pwd', 'whoami', 'id', 'hostname', 'uname', 'echo', 'env', 'printenv',
      'history', 'file', 'clear', 'help', 'hint', 'base64', 'wc', 'sort', 'uniq',
      'next', 'restart', 'status',
    ];
    const matches = partial
      ? commands.filter(c => c.startsWith(partial))
      : commands;
    return { completions: matches, partial, replaceFrom };
  }

  _completePath(partial, replaceFrom) {
    // Split partial into directory part and name prefix
    let dirPath, namePrefix;
    const lastSlash = partial.lastIndexOf('/');
    if (lastSlash === -1) {
      dirPath = this.cwd;
      namePrefix = partial;
    } else {
      dirPath = partial.substring(0, lastSlash) || '/';
      namePrefix = partial.substring(lastSlash + 1);
    }

    try {
      const entries = this.fs.readDir(dirPath, this.cwd);
      const matches = entries
        .filter(e => e.name.startsWith(namePrefix))
        .map(e => {
          const base = lastSlash === -1 ? '' : partial.substring(0, lastSlash + 1);
          const suffix = e.type === 'dir' ? '/' : '';
          return base + e.name + suffix;
        });
      return { completions: matches, partial, replaceFrom };
    } catch {
      return { completions: [], partial, replaceFrom };
    }
  }

  _completeSqlite(input) {
    const partial = input.trim();
    const dotCmds = ['.tables', '.schema', '.quit', '.help', '.exit'];
    if (partial.startsWith('.')) {
      const matches = dotCmds.filter(c => c.startsWith(partial));
      return { completions: matches, partial, replaceFrom: input.length - partial.length };
    }

    // SQL keyword completion
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE',
      'DROP', 'ALTER', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ORDER', 'BY',
      'GROUP', 'HAVING', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
      'LIMIT', 'OFFSET', 'UNION', 'PRAGMA', 'TABLE', 'INTO', 'VALUES',
    ];
    // Get the last word
    const words = input.split(/\s+/);
    const lastWord = words[words.length - 1] || '';
    const replaceFrom = input.length - lastWord.length;
    const upper = lastWord.toUpperCase();
    const matches = keywords.filter(k => k.startsWith(upper));
    return { completions: matches, partial: lastWord, replaceFrom };
  }
}

module.exports = ShellSession;
