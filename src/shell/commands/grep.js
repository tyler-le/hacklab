/**
 * grep command — search file contents.
 * Supports: grep pattern file, grep -r pattern [path], grep -i (case insensitive)
 */

function grep(ctx, args) {
  let recursive = false;
  let caseInsensitive = false;
  const positional = [];

  for (const arg of args) {
    if (arg === '-r' || arg === '-R') recursive = true;
    else if (arg === '-i') caseInsensitive = true;
    else if (arg === '-ri' || arg === '-ir') { recursive = true; caseInsensitive = true; }
    else positional.push(arg);
  }

  if (positional.length === 0) return { stderr: 'grep: missing pattern' };
  const pattern = positional[0];
  const target = positional[1] || (recursive ? ctx.cwd : null);

  if (!target && !recursive) {
    return { stderr: 'Usage: grep [-ri] PATTERN FILE' };
  }

  const flags = caseInsensitive ? 'i' : '';
  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return { stderr: `grep: invalid regex: ${pattern}` };
  }

  const results = [];

  if (recursive) {
    searchRecursive(ctx.fs, target || ctx.cwd, ctx.cwd, regex, results);
  } else {
    try {
      const content = ctx.fs.readFile(target, ctx.cwd);
      const lines = content.split('\n');
      for (const line of lines) {
        if (regex.test(line)) results.push(line);
      }
    } catch (err) {
      return { stderr: err.message };
    }
  }

  if (results.length === 0) return { stdout: '' };
  return { stdout: results.join('\n') };
}

function searchRecursive(fs, dirPath, cwd, regex, results) {
  let entries;
  try {
    entries = fs.readDir(dirPath, cwd);
  } catch {
    return;
  }

  const absDir = fs.resolve(dirPath, cwd);

  for (const entry of entries) {
    const fullPath = absDir === '/' ? '/' + entry.name : absDir + '/' + entry.name;
    if (entry.type === 'dir') {
      searchRecursive(fs, fullPath, '/', regex, results);
    } else {
      try {
        const content = fs.readFile(fullPath, '/');
        const lines = content.split('\n');
        for (const line of lines) {
          if (regex.test(line)) {
            results.push(`${fullPath}:${line}`);
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

module.exports = grep;
