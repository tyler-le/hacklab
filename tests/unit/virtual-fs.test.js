'use strict';
const VirtualFS = require('../../src/shell/virtual-fs');

const TREE = {
  home: {
    'www-data': {
      '.bash_history': 'ls\ncat /etc/passwd',
      notes: {
        'readme.txt': 'Some notes here',
      },
    },
  },
  etc: {
    passwd: 'root:x:0:0:root:/root:/bin/bash',
    secrets: {
      'api_keys.txt': 'AWS_SECRET_KEY=AKIA3R9F8GHSL29XKMP4',
    },
  },
  var: {
    www: {
      megacorp: {
        'routes.js': '// routes',
      },
    },
  },
};

describe('VirtualFS', () => {
  let fs;

  beforeEach(() => {
    fs = new VirtualFS(TREE);
  });

  describe('resolve', () => {
    it('resolves absolute path', () => {
      expect(fs.resolve('/etc/passwd', '/')).toBe('/etc/passwd');
    });

    it('resolves relative path from cwd', () => {
      expect(fs.resolve('secrets', '/etc')).toBe('/etc/secrets');
    });

    it('resolves .. segments', () => {
      expect(fs.resolve('../etc', '/home')).toBe('/etc');
    });

    it('resolves . segments', () => {
      expect(fs.resolve('./passwd', '/etc')).toBe('/etc/passwd');
    });

    it('resolves root', () => {
      expect(fs.resolve('/', '/')).toBe('/');
    });

    it('resolves chained .. past root stays at root', () => {
      expect(fs.resolve('../../../../../../', '/etc')).toBe('/');
    });
  });

  describe('exists', () => {
    it('returns true for a file', () => {
      expect(fs.exists('/etc/passwd', '/')).toBe(true);
    });

    it('returns true for a directory', () => {
      expect(fs.exists('/etc', '/')).toBe(true);
    });

    it('returns false for non-existent path', () => {
      expect(fs.exists('/etc/shadow', '/')).toBe(false);
    });

    it('returns false for deeply non-existent path', () => {
      expect(fs.exists('/a/b/c/d', '/')).toBe(false);
    });
  });

  describe('stat', () => {
    it('returns file stat with size', () => {
      const s = fs.stat('/etc/passwd', '/');
      expect(s).toEqual({ type: 'file', size: TREE.etc.passwd.length });
    });

    it('returns dir stat with child count', () => {
      const s = fs.stat('/etc', '/');
      expect(s.type).toBe('dir');
      expect(s.size).toBe(2); // passwd and secrets
    });

    it('returns null for non-existent path', () => {
      expect(fs.stat('/does/not/exist', '/')).toBeNull();
    });
  });

  describe('readFile', () => {
    it('returns file content', () => {
      expect(fs.readFile('/etc/passwd', '/')).toBe(TREE.etc.passwd);
    });

    it('throws for non-existent file', () => {
      expect(() => fs.readFile('/etc/shadow', '/')).toThrow('No such file or directory');
    });

    it('throws when reading a directory', () => {
      expect(() => fs.readFile('/etc', '/')).toThrow('Is a directory');
    });

    it('reads nested file', () => {
      const content = fs.readFile('/etc/secrets/api_keys.txt', '/');
      expect(content).toContain('AWS_SECRET_KEY');
    });

    it('resolves relative path', () => {
      const content = fs.readFile('passwd', '/etc');
      expect(content).toBe(TREE.etc.passwd);
    });
  });

  describe('readDir', () => {
    it('lists directory entries with types', () => {
      const entries = fs.readDir('/etc', '/');
      const names = entries.map(e => e.name);
      expect(names).toContain('passwd');
      expect(names).toContain('secrets');
    });

    it('marks files and dirs correctly', () => {
      const entries = fs.readDir('/etc', '/');
      const passwd = entries.find(e => e.name === 'passwd');
      const secrets = entries.find(e => e.name === 'secrets');
      expect(passwd.type).toBe('file');
      expect(secrets.type).toBe('dir');
    });

    it('returns entries sorted alphabetically', () => {
      const entries = fs.readDir('/etc', '/');
      const names = entries.map(e => e.name);
      expect(names).toEqual([...names].sort());
    });

    it('throws for non-existent directory', () => {
      expect(() => fs.readDir('/does/not/exist', '/')).toThrow('No such file or directory');
    });

    it('throws when listing a file', () => {
      expect(() => fs.readDir('/etc/passwd', '/')).toThrow('Not a directory');
    });

    it('reads root directory', () => {
      const entries = fs.readDir('/', '/');
      const names = entries.map(e => e.name);
      expect(names).toContain('etc');
      expect(names).toContain('home');
      expect(names).toContain('var');
    });
  });
});
