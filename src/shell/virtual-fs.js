/**
 * VirtualFS — read-only in-memory filesystem for the shell simulator.
 * The tree is a nested object: directories are objects, files are strings.
 */
class VirtualFS {
  constructor(tree) {
    this.tree = tree;
  }

  /**
   * Resolve a path (absolute or relative to cwd) into normalized segments.
   * Returns an array of path segments, e.g. ['var', 'www', 'megacorp'].
   */
  _resolve(path, cwd) {
    let segments;
    if (path.startsWith('/')) {
      segments = path.split('/').filter(Boolean);
    } else {
      segments = [...cwd.split('/').filter(Boolean), ...path.split('/').filter(Boolean)];
    }

    // Resolve . and ..
    const resolved = [];
    for (const seg of segments) {
      if (seg === '.') continue;
      if (seg === '..') {
        resolved.pop();
      } else {
        resolved.push(seg);
      }
    }
    return resolved;
  }

  /**
   * Walk the tree to the node at the given segments.
   * Returns { node, found: true } or { node: null, found: false }.
   */
  _walk(segments) {
    let node = this.tree;
    for (const seg of segments) {
      if (node === null || node === undefined || typeof node === 'string') {
        return { node: null, found: false };
      }
      if (!(seg in node)) {
        return { node: null, found: false };
      }
      node = node[seg];
    }
    return { node, found: true };
  }

  /**
   * Get the absolute path string from segments.
   */
  toPath(segments) {
    return '/' + segments.join('/');
  }

  /**
   * Resolve a path string relative to cwd into an absolute path string.
   */
  resolve(path, cwd) {
    return this.toPath(this._resolve(path, cwd));
  }

  /**
   * Check if a path exists.
   */
  exists(path, cwd) {
    const segments = this._resolve(path, cwd);
    return this._walk(segments).found;
  }

  /**
   * Get stat info for a path: { type: 'file'|'dir', size }.
   * Returns null if path doesn't exist.
   */
  stat(path, cwd) {
    const segments = this._resolve(path, cwd);
    const { node, found } = this._walk(segments);
    if (!found) return null;

    if (typeof node === 'string') {
      return { type: 'file', size: node.length };
    }
    return { type: 'dir', size: Object.keys(node).length };
  }

  /**
   * Read a file. Returns the string content.
   * Throws if path doesn't exist or is a directory.
   */
  readFile(path, cwd) {
    const abs = this.resolve(path, cwd);
    const segments = this._resolve(path, cwd);
    const { node, found } = this._walk(segments);
    if (!found) throw new Error(`cat: ${abs}: No such file or directory`);
    if (typeof node !== 'string') throw new Error(`cat: ${abs}: Is a directory`);
    return node;
  }

  /**
   * List a directory. Returns an array of { name, type } entries.
   * Throws if path doesn't exist or is a file.
   */
  readDir(path, cwd) {
    const abs = this.resolve(path, cwd);
    const segments = this._resolve(path, cwd);
    const { node, found } = this._walk(segments);
    if (!found) throw new Error(`ls: cannot access '${abs}': No such file or directory`);
    if (typeof node === 'string') throw new Error(`ls: ${abs}: Not a directory`);

    return Object.entries(node).map(([name, value]) => ({
      name,
      type: typeof value === 'string' ? 'file' : 'dir',
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
}

module.exports = VirtualFS;
