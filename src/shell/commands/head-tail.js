/**
 * head and tail commands — show first/last N lines of a file.
 */

function head(ctx, args) {
  let n = 10;
  const files = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && args[i + 1]) {
      n = parseInt(args[i + 1]) || 10;
      i++;
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
    }
  }

  if (files.length === 0) return { stderr: 'head: missing operand' };

  try {
    const content = ctx.fs.readFile(files[0], ctx.cwd);
    const lines = content.split('\n').slice(0, n);
    return { stdout: lines.join('\n') };
  } catch (err) {
    return { stderr: err.message };
  }
}

function tail(ctx, args) {
  let n = 10;
  const files = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && args[i + 1]) {
      n = parseInt(args[i + 1]) || 10;
      i++;
    } else if (!args[i].startsWith('-')) {
      files.push(args[i]);
    }
  }

  if (files.length === 0) return { stderr: 'tail: missing operand' };

  try {
    const content = ctx.fs.readFile(files[0], ctx.cwd);
    const lines = content.split('\n').slice(-n);
    return { stdout: lines.join('\n') };
  } catch (err) {
    return { stderr: err.message };
  }
}

module.exports = { head, tail };
