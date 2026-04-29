/**
 * ls command — list directory contents.
 * Supports: ls, ls [path], ls -l, ls -a, ls -la
 */

function ls(ctx, args) {
  let showLong = false;
  let showHidden = false;
  const paths = [];

  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (arg.includes('l')) showLong = true;
      if (arg.includes('a')) showHidden = true;
    } else {
      paths.push(arg);
    }
  }

  const targetPath = paths[0] || ctx.cwd;

  try {
    const entries = ctx.fs.readDir(targetPath, ctx.cwd);
    let filtered = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));

    if (showLong) {
      const lines = [];
      if (showHidden) {
        lines.push('drwxr-xr-x  .  www-data www-data');
        lines.push('drwxr-xr-x  ..  www-data www-data');
      }
      for (const entry of filtered) {
        const perms = entry.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
        const size = entry.type === 'dir' ? '-' : ctx.fs.stat(targetPath + '/' + entry.name, ctx.cwd)?.size || 0;
        const name = entry.type === 'dir' ? entry.name + '/' : entry.name;
        lines.push(`${perms}  ${name}\twww-data www-data\t${size}`);
      }
      return { stdout: lines.join('\n') };
    }

    const names = filtered.map(e => e.type === 'dir' ? e.name + '/' : e.name);
    return { stdout: names.join('  ') };
  } catch (err) {
    return { stderr: err.message };
  }
}

module.exports = ls;
