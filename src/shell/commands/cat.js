/**
 * cat command — display file contents.
 */

function cat(ctx, args) {
  if (args.length === 0) return { stderr: 'cat: missing operand' };

  const outputs = [];
  for (const path of args) {
    try {
      const content = ctx.fs.readFile(path, ctx.cwd);
      outputs.push(content);
    } catch (err) {
      outputs.push(err.message);
    }
  }
  return { stdout: outputs.join('\n') };
}

module.exports = cat;
