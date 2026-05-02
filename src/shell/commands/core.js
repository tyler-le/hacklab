/**
 * Core commands: whoami, id, pwd, hostname, echo, env, history, file, uname, clear, help, hint
 */

function whoami() {
  return { stdout: 'hacklab' };
}

function id() {
  return { stdout: 'uid=1000(hacklab) gid=1000(hacklab) groups=1000(hacklab),33(www-data)' };
}

function pwd(ctx) {
  return { stdout: ctx.cwd };
}

function hostname() {
  return { stdout: 'megacorp-web-01' };
}

function uname(ctx, args) {
  if (args.includes('-a')) {
    return { stdout: 'Linux megacorp-web-01 5.15.0-generic #1 SMP x86_64 GNU/Linux' };
  }
  return { stdout: 'Linux' };
}

function echo(ctx, args) {
  return { stdout: args.join(' ') };
}

function env() {
  return {
    stdout: [
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'HOME=/var/www',
      'USER=hacklab',
      'SHELL=/bin/bash',
      'HOSTNAME=megacorp-web-01',
      'LANG=en_US.UTF-8',
    ].join('\n'),
  };
}

function history(ctx) {
  if (ctx.history.length === 0) return { stdout: '' };
  return {
    stdout: ctx.history.map((cmd, i) => `  ${i + 1}  ${cmd}`).join('\n'),
  };
}

function fileCmd(ctx, args) {
  if (args.length === 0) return { stderr: 'file: missing operand' };
  const path = args[0];
  const stat = ctx.fs.stat(path, ctx.cwd);
  if (!stat) return { stderr: `file: ${path}: No such file or directory` };
  const abs = ctx.fs.resolve(path, ctx.cwd);
  if (stat.type === 'dir') return { stdout: `${abs}: directory` };
  if (abs.endsWith('.js')) return { stdout: `${abs}: JavaScript source, ASCII text` };
  if (abs.endsWith('.log')) return { stdout: `${abs}: ASCII text, with very long lines` };
  if (abs.endsWith('.db')) return { stdout: `${abs}: SQLite 3.x database` };
  if (abs.endsWith('.txt')) return { stdout: `${abs}: ASCII text` };
  if (abs.endsWith('.css')) return { stdout: `${abs}: CSS stylesheet, ASCII text` };
  if (abs.endsWith('.html')) return { stdout: `${abs}: HTML document, ASCII text` };
  return { stdout: `${abs}: ASCII text` };
}

function clear() {
  return { stdout: '', clear: true };
}

function help() {
  return {
    stdout: [
      'Available commands:',
      '  ls [path]          List directory contents',
      '  cd [path]          Change directory',
      '  cat [file]         Display file contents',
      '  grep [-r] pat [p]  Search file contents',
      '  find [path] -name  Find files by name',
      '  head [-n N] file   Show first N lines',
      '  tail [-n N] file   Show last N lines',
      '  curl [url]         Make HTTP request',
      '  sqlite3 [db]       Open SQLite database',
      '  pwd                Print working directory',
      '  whoami             Print current user',
      '  id                 Print user/group info',
      '  hostname           Print hostname',
      '  echo [text]        Print text',
      '  env                Print environment variables',
      '  file [path]        Determine file type',
      '  history            Show command history',
      '  uname [-a]         Print system info',
      '  clear              Clear terminal',
      '  hint               Get a hint for the current stage',
      '  help               Show this help message',
    ].join('\n'),
  };
}

module.exports = { whoami, id, pwd, hostname, uname, echo, env, history, file: fileCmd, clear, help };
