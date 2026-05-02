'use strict';
const VirtualFS = require('../../src/shell/virtual-fs');
const cat = require('../../src/shell/commands/cat');
const cd = require('../../src/shell/commands/cd');
const grep = require('../../src/shell/commands/grep');
const find = require('../../src/shell/commands/find');
const { head, tail } = require('../../src/shell/commands/head-tail');
const ls = require('../../src/shell/commands/ls');
const core = require('../../src/shell/commands/core');

const TREE = {
  home: {
    'www-data': {
      '.bash_history': 'ls\ncat /etc/passwd\ncurl http://portal.megacorp.internal/login',
    },
  },
  etc: {
    passwd: 'root:x:0:0:root:/root:/bin/bash\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
    secrets: {
      'api_keys.txt': 'AWS_SECRET_KEY=AKIA3R9F8GHSL29XKMP4\nAWS_ACCESS_KEY=ACCESS123',
    },
  },
  var: {
    www: {
      megacorp: {
        'routes.js': '// routes\nconst express = require("express");\n// TODO: remove debug endpoint',
        'config.json': '{"debug": true, "password": "hunter2"}',
      },
    },
  },
};

function makeCtx(cwd = '/') {
  const fs = new VirtualFS(TREE);
  return { fs, cwd, history: [], sessionId: 'test', currentStage: 0 };
}

// ─── cat ──────────────────────────────────────────────────────────────────────
describe('cat', () => {
  it('reads a file by absolute path', () => {
    const result = cat(makeCtx(), ['/etc/passwd']);
    expect(result.stdout).toContain('root:x:0:0');
  });

  it('reads a file by relative path', () => {
    const ctx = makeCtx('/etc');
    const result = cat(ctx, ['passwd']);
    expect(result.stdout).toContain('root:x:0:0');
  });

  it('errors on missing operand', () => {
    expect(cat(makeCtx(), []).stderr).toMatch(/missing operand/);
  });

  it('errors on non-existent file', () => {
    const result = cat(makeCtx(), ['/etc/shadow']);
    expect(result.stdout).toMatch(/No such file/);
  });

  it('errors on directory', () => {
    const result = cat(makeCtx(), ['/etc']);
    expect(result.stdout).toMatch(/Is a directory/);
  });

  it('concatenates multiple files', () => {
    const result = cat(makeCtx(), ['/etc/passwd', '/etc/secrets/api_keys.txt']);
    expect(result.stdout).toContain('root:x:0:0');
    expect(result.stdout).toContain('AWS_SECRET_KEY');
  });
});

// ─── cd ───────────────────────────────────────────────────────────────────────
describe('cd', () => {
  it('changes directory to an absolute path', () => {
    const ctx = makeCtx('/');
    const result = cd(ctx, ['/etc']);
    expect(result.stderr).toBeUndefined();
    expect(ctx.cwd).toBe('/etc');
  });

  it('changes directory to a relative path', () => {
    const ctx = makeCtx('/var');
    cd(ctx, ['www']);
    expect(ctx.cwd).toBe('/var/www');
  });

  it('defaults to /home/www-data with no args', () => {
    const ctx = makeCtx('/etc');
    cd(ctx, []);
    expect(ctx.cwd).toBe('/home/www-data');
  });

  it('errors on non-existent directory', () => {
    const ctx = makeCtx('/');
    const result = cd(ctx, ['/nope']);
    expect(result.stderr).toMatch(/No such file or directory/);
    expect(ctx.cwd).toBe('/');
  });

  it('errors when target is a file', () => {
    const ctx = makeCtx('/');
    const result = cd(ctx, ['/etc/passwd']);
    expect(result.stderr).toMatch(/Not a directory/);
  });

  it('handles .. navigation', () => {
    const ctx = makeCtx('/var/www');
    cd(ctx, ['..']);
    expect(ctx.cwd).toBe('/var');
  });
});

// ─── ls ───────────────────────────────────────────────────────────────────────
describe('ls', () => {
  it('lists current directory', () => {
    const ctx = makeCtx('/etc');
    const result = ls(ctx, []);
    expect(result.stdout).toContain('passwd');
    expect(result.stdout).toContain('secrets');
  });

  it('lists a specified directory', () => {
    const ctx = makeCtx('/');
    const result = ls(ctx, ['/etc']);
    expect(result.stdout).toContain('passwd');
  });

  it('errors on non-existent directory', () => {
    const ctx = makeCtx('/');
    const result = ls(ctx, ['/nope']);
    expect(result.stderr).toMatch(/No such file/);
  });

  it('-a flag includes hidden files', () => {
    const ctx = makeCtx('/home/www-data');
    const result = ls(ctx, ['-a']);
    expect(result.stdout).toContain('.bash_history');
  });

  it('without -a flag hides dot files', () => {
    const ctx = makeCtx('/home/www-data');
    const result = ls(ctx, []);
    expect(result.stdout).not.toContain('.bash_history');
  });
});

// ─── grep ─────────────────────────────────────────────────────────────────────
describe('grep', () => {
  it('finds matching lines in a file', () => {
    const result = grep(makeCtx(), ['root', '/etc/passwd']);
    expect(result.stdout).toContain('root:x:0:0');
  });

  it('returns empty stdout when no match', () => {
    const result = grep(makeCtx(), ['NOEXIST', '/etc/passwd']);
    expect(result.stdout).toBe('');
  });

  it('case-insensitive search with -i', () => {
    const result = grep(makeCtx(), ['-i', 'ROOT', '/etc/passwd']);
    expect(result.stdout).toContain('root:x:0:0');
  });

  it('recursive search with -r', () => {
    const result = grep(makeCtx('/var/www/megacorp'), ['-r', 'debug']);
    expect(result.stdout).toContain('debug');
  });

  it('errors on missing pattern', () => {
    expect(grep(makeCtx(), []).stderr).toMatch(/missing pattern/);
  });

  it('errors on invalid regex', () => {
    const result = grep(makeCtx(), ['[invalid', '/etc/passwd']);
    expect(result.stderr).toMatch(/invalid regex/);
  });

  it('errors without file when not recursive', () => {
    const result = grep(makeCtx(), ['root']);
    expect(result.stderr).toMatch(/Usage/);
  });
});

// ─── find ─────────────────────────────────────────────────────────────────────
describe('find', () => {
  it('finds files by name glob', () => {
    const ctx = makeCtx('/');
    const result = find(ctx, ['/etc', '-name', '*.txt']);
    expect(result.stdout).toContain('api_keys.txt');
  });

  it('finds all files with -type f', () => {
    const ctx = makeCtx('/etc');
    const result = find(ctx, ['/etc', '-type', 'f']);
    expect(result.stdout).toContain('passwd');
    expect(result.stdout).not.toContain('/etc/secrets\n');
  });

  it('finds directories with -type d', () => {
    const ctx = makeCtx('/');
    const result = find(ctx, ['/etc', '-type', 'd']);
    expect(result.stdout).toContain('secrets');
    expect(result.stdout).not.toContain('passwd');
  });

  it('returns empty on no match', () => {
    const ctx = makeCtx('/');
    const result = find(ctx, ['/etc', '-name', '*.md']);
    expect(result.stdout).toBe('');
  });

  it('finds from current directory by default', () => {
    const ctx = makeCtx('/etc');
    const result = find(ctx, []);
    expect(result.stdout).toContain('passwd');
  });
});

// ─── head / tail ──────────────────────────────────────────────────────────────
describe('head', () => {
  it('returns first 10 lines by default', () => {
    const content = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n');
    const fs = new VirtualFS({ f: content });
    const ctx = { fs, cwd: '/', history: [] };
    const result = head(ctx, ['/f']);
    const lines = result.stdout.split('\n');
    expect(lines.length).toBe(10);
    expect(lines[0]).toBe('line1');
  });

  it('respects -n flag', () => {
    const content = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n');
    const fs = new VirtualFS({ f: content });
    const ctx = { fs, cwd: '/', history: [] };
    const result = head(ctx, ['-n', '3', '/f']);
    expect(result.stdout.split('\n').length).toBe(3);
  });

  it('errors on missing operand', () => {
    expect(head(makeCtx(), []).stderr).toMatch(/missing operand/);
  });

  it('errors on non-existent file', () => {
    const result = head(makeCtx(), ['/nope']);
    expect(result.stderr).toMatch(/No such file/);
  });
});

describe('tail', () => {
  it('returns last 10 lines by default', () => {
    const content = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n');
    const fs = new VirtualFS({ f: content });
    const ctx = { fs, cwd: '/', history: [] };
    const result = tail(ctx, ['/f']);
    const lines = result.stdout.split('\n');
    expect(lines.length).toBe(10);
    expect(lines[lines.length - 1]).toBe('line15');
  });

  it('respects -n flag', () => {
    const content = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n');
    const fs = new VirtualFS({ f: content });
    const ctx = { fs, cwd: '/', history: [] };
    const result = tail(ctx, ['-n', '2', '/f']);
    expect(result.stdout.split('\n').length).toBe(2);
    expect(result.stdout).toContain('line15');
  });

  it('errors on missing operand', () => {
    expect(tail(makeCtx(), []).stderr).toMatch(/missing operand/);
  });
});

// ─── core commands ────────────────────────────────────────────────────────────
describe('core commands', () => {
  describe('whoami', () => {
    it('returns hacklab', () => {
      expect(core.whoami(makeCtx(), []).stdout).toBe('hacklab');
    });
  });

  describe('pwd', () => {
    it('returns current directory', () => {
      const ctx = makeCtx('/var/www/megacorp');
      expect(core.pwd(ctx, []).stdout).toBe('/var/www/megacorp');
    });
  });

  describe('echo', () => {
    it('echoes arguments', () => {
      expect(core.echo(makeCtx(), ['hello', 'world']).stdout).toBe('hello world');
    });

    it('echoes with no args returns empty line', () => {
      expect(core.echo(makeCtx(), []).stdout).toBe('');
    });
  });

  describe('clear', () => {
    it('returns clear flag', () => {
      expect(core.clear(makeCtx(), []).clear).toBe(true);
    });
  });

  describe('history', () => {
    it('returns command history', () => {
      const ctx = makeCtx('/');
      ctx.history = ['ls', 'cat /etc/passwd'];
      const result = core.history(ctx, []);
      expect(result.stdout).toContain('ls');
      expect(result.stdout).toContain('cat /etc/passwd');
    });

    it('returns empty when no history', () => {
      const ctx = makeCtx('/');
      const result = core.history(ctx, []);
      expect(result.stdout).toBe('');
    });
  });
});
