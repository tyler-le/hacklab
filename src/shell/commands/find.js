/**
 * find command — search for files by name.
 * Supports: find [path] -name [pattern], find [path] -type f|d
 */

function find(ctx, args) {
  let searchPath = '.';
  let namePattern = null;
  let typeFilter = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-name' && args[i + 1]) {
      namePattern = args[i + 1];
      i++;
    } else if (args[i] === '-type' && args[i + 1]) {
      typeFilter = args[i + 1];
      i++;
    } else if (!args[i].startsWith('-')) {
      searchPath = args[i];
    }
  }

  const results = [];
  const absPath = ctx.fs.resolve(searchPath, ctx.cwd);

  collectFiles(ctx.fs, absPath, namePattern, typeFilter, results);

  if (results.length === 0) return { stdout: '' };
  return { stdout: results.join('\n') };
}

function collectFiles(fs, dirPath, namePattern, typeFilter, results) {
  let entries;
  try {
    entries = fs.readDir(dirPath, '/');
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = dirPath === '/' ? '/' + entry.name : dirPath + '/' + entry.name;

    // Check type filter
    if (typeFilter === 'f' && entry.type !== 'file') {
      // still recurse into dirs
      if (entry.type === 'dir') collectFiles(fs, fullPath, namePattern, typeFilter, results);
      continue;
    }
    if (typeFilter === 'd' && entry.type !== 'dir') continue;

    // Check name pattern (simple glob: * matches anything)
    if (namePattern) {
      const regex = new RegExp('^' + namePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      if (regex.test(entry.name)) results.push(fullPath);
    } else {
      results.push(fullPath);
    }

    if (entry.type === 'dir') {
      collectFiles(fs, fullPath, namePattern, typeFilter, results);
    }
  }
}

module.exports = find;
