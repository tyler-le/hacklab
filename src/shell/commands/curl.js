/**
 * curl command — makes virtual HTTP requests to the vulnerable web app.
 * Supports: curl [url], curl -d "data" [url], curl -X POST [url], curl -v [url]
 */

const { handleRequest } = require('../../webapp/vulnerable-app');

function curl(ctx, args) {
  let method = 'GET';
  let data = null;
  let verbose = false;
  let url = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-X' && args[i + 1]) {
      method = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === '-d' && args[i + 1]) {
      data = args[i + 1];
      method = 'POST'; // -d implies POST
      i++;
    } else if (args[i] === '-v' || args[i] === '--verbose') {
      verbose = true;
    } else if (args[i] === '-o' && args[i + 1]) {
      i++; // skip output file arg (ignore)
    } else if (args[i] === '-s' || args[i] === '--silent') {
      // ignore silently
    } else if (!args[i].startsWith('-')) {
      url = args[i];
    }
  }

  if (!url) return { stderr: 'curl: no URL specified' };

  // Normalize URL — strip http://localhost or similar
  let path = url;
  path = path.replace(/^https?:\/\/(localhost|127\.0\.0\.1|portal\.megacorp\.internal)(:\d+)?/, '');
  if (!path.startsWith('/')) path = '/' + path;

  const result = handleRequest(method, path, data, ctx.sessionId, ctx.currentStage);

  const output = [];
  if (verbose) {
    output.push(`> ${method} ${path} HTTP/1.1`);
    output.push(`> Host: portal.megacorp.internal`);
    if (data) output.push(`> Content-Type: application/x-www-form-urlencoded`);
    output.push(`>`);
    output.push(`< HTTP/1.1 ${result.status}`);
    for (const [k, v] of Object.entries(result.headers || {})) {
      output.push(`< ${k}: ${v}`);
    }
    output.push(`<`);
  }
  // If the handler provides plain-text output (e.g. diagnostic), use that for the terminal
  // instead of dumping raw HTML. The browser iframe still renders the full HTML body.
  if (result.rawOutput !== undefined) {
    output.push(result.rawOutput);
  } else {
    output.push(result.body);
  }

  return {
    stdout: output.join('\n'),
    stageFlag: result.stageFlag || null,
    loginSuccess: result.loginSuccess || false,
    query: result.query || null,
    queryResult: result.queryResult || null,
  };
}

module.exports = curl;
