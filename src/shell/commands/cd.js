/**
 * cd command — change directory.
 */

function cd(ctx, args) {
  const target = args[0] || '/home/www-data';
  const resolved = ctx.fs.resolve(target, ctx.cwd);
  const stat = ctx.fs.stat(target, ctx.cwd);

  if (!stat) {
    return { stderr: `cd: ${target}: No such file or directory` };
  }
  if (stat.type !== 'dir') {
    return { stderr: `cd: ${target}: Not a directory` };
  }

  ctx.cwd = resolved;
  return { stdout: '' };
}

module.exports = cd;
