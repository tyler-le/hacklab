// Stage definitions — open-ended missions for v2
const STAGES = [
  {
    id: 'intro',
    title: 'Stage 1: Information Leakage',
    mission: `<span class="highlight">SCENARIO:</span> You have shell access to the MegaCorp web server. Their employee portal is running at <span class="cmd">http://portal.megacorp.internal</span>.

<span class="highlight">OBJECTIVE:</span> Find valid credentials, log in to the portal, and <span class="cmd">submit</span> the admin API key you find inside.

<span class="highlight">TIP:</span> Explore the web server files. Developers sometimes leave sensitive information in places they shouldn't.`,
    hints: [
      "Look around the web server files. Try: ls /var/www/megacorp/",
      "Read the source code: cat /var/www/megacorp/routes.js — look for the login route.",
      "The login page has an HTML comment with test credentials. Use: curl -d \"user=admin&pass=password123\" http://portal.megacorp.internal/login",
    ],
    flagPrompt: 'Enter the Admin API key you found...',
    success: {
      title: 'Information Leakage Exploited!',
      subtitle: 'You found credentials hidden in the page source code.',
      explanation: `You found credentials in an HTML comment. This is information leakage — sensitive data exposed in client-side code.

Anyone can view a page's source code. Comments, hidden fields, and JS files are all sent to the browser — they're not secret.

DEFENSE: Never put secrets in client-side code. Use environment variables and strip comments from production builds.`,
    },
  },
  {
    id: 'idor',
    title: 'Stage 2: Broken Access Control',
    mission: `<span class="highlight">SCENARIO:</span> You're logged in as employee <span class="cmd">jsmith</span> (id=1). The portal has an API endpoint for employee profiles at <span class="cmd">/api/employees/:id</span>.

<span class="highlight">OBJECTIVE:</span> Access the admin's profile, steal their personal access token, then <span class="cmd">submit</span> it to complete the stage.

<span class="highlight">TIP:</span> Read the server source code to find the API endpoints. What parameters do they take?`,
    hints: [
      "Read the source code: cat routes.js — look at the employees endpoint and its comments.",
      "Check notes.txt for the employee ID list. The API has no authorization check — try different IDs.",
      "The admin is at id=4. Try: curl http://portal.megacorp.internal/api/employees/4",
    ],
    flagPrompt: 'Enter the Personal Access Token you found...',
    success: {
      title: 'Broken Access Control Exploited!',
      subtitle: "You accessed the admin's profile by changing the ID in the URL.",
      explanation: `You changed /api/employees/1 to /api/employees/4 and the server returned the admin's profile — it never checked if you were authorized to view it.

This is IDOR (Insecure Direct Object Reference), the #1 most common web vulnerability. Sequential IDs make it trivial to enumerate every record.

DEFENSE: Always check authorization on every request. Use random UUIDs instead of sequential IDs.`,
    },
  },
  {
    id: 'xss',
    title: 'Stage 3: Cross-Site Scripting (XSS)',
    mission: `<span class="highlight">SCENARIO:</span> The employee directory has a search page at <span class="cmd">/api/search</span>. The admin browses this page while logged in — their session cookie is stored in the browser.

<span class="highlight">OBJECTIVE:</span> Inject <span class="cmd">alert(document.cookie)</span> into the search page to expose the admin's session token, then <span class="cmd">submit</span> the token value.

<span class="highlight">TIP:</span> Read the source code to see how user input is rendered. Is it escaped before being inserted into the HTML?`,
    hints: [
      "Read the source: cat /var/www/megacorp/routes.js — look at how the search term is rendered in the HTML. Is it escaped?",
      "Test HTML injection: open the browser tab, go to /api/search, and search for <b>test</b> — if 'test' appears bold in the results, the input isn't escaped. Now try a &lt;script&gt; tag.",
      "Read the cookie: curl \"http://portal.megacorp.internal/api/search?q=<script>alert(document.cookie)</script>\"",
    ],
    flagPrompt: 'Enter the session cookie value you stole...',
    success: {
      title: 'XSS Attack Successful!',
      subtitle: "You stole the admin's session cookie via cross-site scripting.",
      explanation: `You injected a <script> tag into the search results. Because the server didn't escape your input, the browser executed your JavaScript — which read the admin's session cookie via document.cookie.

In the real world, an attacker would embed this in a URL and trick the admin into clicking it. The script runs in the context of the trusted site, giving the attacker access to cookies, tokens, and session data. This is called "Reflected XSS."

DEFENSE: Escape all user input before rendering in HTML. Set HttpOnly on cookies so JavaScript can't read them. Use Content-Security-Policy headers.`,
    },
  },
  {
    id: 'sql_injection',
    title: 'Stage 4: SQL Injection',
    mission: `<span class="highlight">SCENARIO:</span> MegaCorp has a separate admin login at <span class="cmd">/api/admin/login</span>. It uses a SQL query to check credentials.

<span class="highlight">OBJECTIVE:</span> Bypass the login without knowing any password, then <span class="cmd">submit</span> the database master password exposed in the admin panel.

<span class="highlight">TIP:</span> Read the source code. How does the admin login build its SQL query compared to the regular login?`,
    hints: [
      "Read the source: cat /var/www/megacorp/routes.js — compare /login (safe) vs /api/admin/login (vulnerable). Notice the string concatenation.",
      "Probe for SQL injection: curl -X POST -d \"user='\" http://portal.megacorp.internal/api/admin/login — the error reveals the query structure.",
      "Inject: curl -X POST -d \"user=' OR 1=1 --&pass=x\" http://portal.megacorp.internal/api/admin/login",
    ],
    flagPrompt: 'Enter the database master password you found...',
    success: {
      title: 'Authentication Bypassed!',
      subtitle: 'You logged in without knowing any password using SQL injection.',
      explanation: `Your input turned the query into:
  SELECT * FROM users WHERE username='' OR 1=1 --' AND password=''

The ' closes the string, OR 1=1 is always true, and -- comments out the password check. The database returns all users.

DEFENSE: Use parameterized queries — never concatenate user input into SQL.`,
    },
  },
  {
    id: 'command_injection',
    title: 'Stage 5: Command Injection',
    mission: `<span class="highlight">SCENARIO:</span> MegaCorp has an internal server diagnostic tool at <span class="cmd">/api/diagnostic</span>. It takes a hostname and pings it — your input is passed directly to a shell command with no sanitization.

<span class="highlight">OBJECTIVE:</span> Exploit the tool and use <span class="cmd">cat /etc/secrets/api_keys.txt</span> to print the file contents. Find the <span class="cmd">AWS_SECRET_KEY</span> value and submit it.

<span class="highlight">TIP:</span> In a shell, <span class="cmd">;</span> separates commands. The Host field is your injection point.`,
    hints: [
      "Navigate to /api/diagnostic in the browser. Enter 'localhost' — it runs a real ping. Your input goes straight into a shell command on the server.",
      "Read the source: cat /var/www/megacorp/diagnostic.php — see how your input is used with no sanitization before execSync.",
      "Use ; to chain a second command after the ping. Try reading the secrets file.",
    ],
    flagPrompt: 'Enter the AWS secret key you leaked...',
    success: {
      title: 'Command Injection Successful!',
      subtitle: 'You executed arbitrary commands on the server and stole secret API keys.',
      explanation: `The ; character tells the shell to run a second command. Your input turned the command into:
  ping -c 1 localhost; cat /etc/secrets/api_keys.txt

The server expected a hostname but you injected a shell command. This is the most dangerous vulnerability — it gives an attacker direct server access.

DEFENSE: Never pass user input to shell commands. Use language-native libraries instead.

Congratulations — you've completed all 5 stages of HackLab!`,
    },
  },

  // ============================================================
  // OPERATION BLACKSITE — Advanced Pack (Stages 6–10)
  // ============================================================
  {
    id: 'cookie_tamper',
    title: 'Stage 6: Cookie Tampering',
    mission: `<span class="highlight">SCENARIO:</span> You've uncovered a hidden surveillance system called <span class="cmd">Project Sentinel</span>. A monitoring portal is running at <span class="cmd">/sentinel/login</span>. Credentials <span class="cmd">jsmith / password123</span> log you in with clearance level 1.

<span class="highlight">OBJECTIVE:</span> The dashboard requires clearance level 5. The server sets a <span class="cmd">clearance</span> cookie on login — modify it to gain access to the Sentinel dashboard and retrieve the control token.

<span class="highlight">TIP:</span> Use <span class="cmd">curl -v</span> to see the Set-Cookie header on login. Then replay the request with a modified cookie using <span class="cmd">curl -H "Cookie: clearance=5"</span>.`,
    hints: [
      'Log in first: curl -d "user=jsmith&pass=password123" http://portal.megacorp.internal/sentinel/login — use -v to see the Set-Cookie header.',
      'Read the source: cat /var/www/sentinel/routes.js — see how the dashboard checks the clearance cookie.',
      'Send the modified cookie: curl -H "Cookie: clearance=5" http://portal.megacorp.internal/sentinel/dashboard',
    ],
    flagPrompt: 'Enter the Sentinel control token...',
    success: {
      title: 'Cookie Tampering Successful!',
      subtitle: 'You elevated your clearance level by forging a cookie value.',
      explanation: `The server set clearance=1 in a cookie and trusted it on every subsequent request — never verifying it server-side.

Cookies are stored in the browser and can be freely modified by any user. Using them as an authorization mechanism without cryptographic signing is fundamentally broken.

DEFENSE: Never trust cookie values for authorization decisions. Use signed, server-side sessions (e.g. JWT with HMAC, or server-side session stores). Always validate permissions server-side on every request.`,
    },
  },
  {
    id: 'verb_tamper',
    title: 'Stage 7: HTTP Verb Tampering',
    mission: `<span class="highlight">SCENARIO:</span> An evidence locker at <span class="cmd">/sentinel/evidence</span> returns 403 Forbidden on GET requests. But the access control was written hastily — it only blocks GET.

<span class="highlight">OBJECTIVE:</span> Bypass the access restriction by using a different HTTP method. Retrieve the classified case file and submit the flag inside.

<span class="highlight">TIP:</span> Read the source code to see exactly which method is blocked. Try <span class="cmd">curl -X POST</span> to use a different verb.`,
    hints: [
      'Try the endpoint: curl http://portal.megacorp.internal/sentinel/evidence — you\'ll get a 403.',
      'Read the source: cat /var/www/sentinel/routes.js — look at how the method check is implemented.',
      'Bypass it: curl -X POST http://portal.megacorp.internal/sentinel/evidence',
    ],
    flagPrompt: 'Enter the case file flag...',
    success: {
      title: 'HTTP Verb Tampering Successful!',
      subtitle: 'You bypassed access control by using an unexpected HTTP method.',
      explanation: `The route handler checked if the method was GET and returned 403 — but allowed all other methods through. POST, PUT, PATCH, and DELETE all bypassed the restriction.

This is a common mistake when developers block specific methods instead of implementing proper authorization.

DEFENSE: Implement positive authorization (allow known-good) rather than negative (block known-bad). Use middleware that checks authentication and role on every request, regardless of HTTP method.`,
    },
  },
  {
    id: 'verbose_errors',
    title: 'Stage 8: Verbose Error Messages',
    mission: `<span class="highlight">SCENARIO:</span> The Sentinel report generator at <span class="cmd">/sentinel/report</span> accepts a numeric report ID. The developers left debug mode enabled — invalid input causes an unhandled exception that leaks internal details.

<span class="highlight">OBJECTIVE:</span> Trigger the error condition to expose the leaked database credential in the error output. Submit the DB password you find.

<span class="highlight">TIP:</span> The endpoint expects a numeric <span class="cmd">id</span> parameter. What happens when you pass something unexpected?`,
    hints: [
      'Try the normal endpoint: curl "http://portal.megacorp.internal/sentinel/report?id=1" — it works fine with a numeric ID.',
      'Now try an invalid value: curl "http://portal.megacorp.internal/sentinel/report?id=x" — watch what the error reveals.',
      'The stack trace exposes sensitive configuration. Look for the dbPassword field in the error output.',
    ],
    flagPrompt: 'Enter the leaked DB password...',
    success: {
      title: 'Verbose Error Exploited!',
      subtitle: 'You extracted database credentials from a leaked error stack trace.',
      explanation: `The application crashed on invalid input and returned a full stack trace — including internal configuration values like database credentials.

Verbose error messages are a goldmine for attackers. They reveal file paths, library versions, query structures, and sometimes credentials.

DEFENSE: Never expose stack traces or internal errors to users in production. Log errors server-side, return generic messages to clients. Use a global error handler that sanitizes all error output.`,
    },
  },
  {
    id: 'debug_param',
    title: 'Stage 9: Hidden Debug Parameter',
    mission: `<span class="highlight">SCENARIO:</span> The Sentinel export system at <span class="cmd">/sentinel/exports</span> is locked down — it returns 403. But a developer left a debug backdoor in the code that was never removed before deployment.

<span class="highlight">OBJECTIVE:</span> Find the hidden debug parameter in the source code and use it to bypass the access restriction. Retrieve the debug key from the dump.

<span class="highlight">TIP:</span> Read the source: <span class="cmd">cat /var/www/sentinel/routes.js</span> and look for TODO comments.`,
    hints: [
      'The endpoint is locked: curl http://portal.megacorp.internal/sentinel/exports returns 403.',
      'Read the source: cat /var/www/sentinel/routes.js — find the TODO comment about a debug parameter.',
      'Use the debug parameter: curl "http://portal.megacorp.internal/sentinel/exports?debug=true"',
    ],
    flagPrompt: 'Enter the debug key...',
    success: {
      title: 'Debug Backdoor Exploited!',
      subtitle: 'You accessed a locked endpoint via a forgotten debug parameter.',
      explanation: `A developer added ?debug=true during development to bypass auth checks and never removed it before shipping to production — creating a hidden backdoor.

Debug and test code in production is extremely dangerous. It's often undocumented, poorly secured, and forgotten.

DEFENSE: Use feature flags with proper access controls for debug modes. Conduct pre-deployment code reviews that specifically check for debug/test code. Use linters that flag TODO/FIXME comments in production builds.`,
    },
  },
  {
    id: 'path_traversal',
    title: 'Stage 10: Path Traversal',
    mission: `<span class="highlight">SCENARIO:</span> The Sentinel file server at <span class="cmd">/sentinel/download</span> serves files from <span class="cmd">/var/sentinel/files/</span> using a <span class="cmd">file</span> parameter. There is no path sanitization — you can escape the intended directory.

<span class="highlight">OBJECTIVE:</span> Use path traversal to read <span class="cmd">/etc/sentinel/master.key</span> — the master encryption key for the entire Sentinel surveillance network. This is the smoking gun.

<span class="highlight">TIP:</span> Use <span class="cmd">../</span> sequences to traverse up the directory tree.`,
    hints: [
      'Try a normal file: curl "http://portal.megacorp.internal/sentinel/download?file=report.pdf" — it serves the file.',
      'Read the source: cat /var/www/sentinel/routes.js — notice path.join() is used but the result is never validated against the base directory.',
      'Traverse to the key: curl "http://portal.megacorp.internal/sentinel/download?file=../../../etc/sentinel/master.key"',
    ],
    flagPrompt: 'Enter the master key value...',
    success: {
      title: 'Path Traversal — MegaCorp Exposed!',
      subtitle: 'You retrieved the master encryption key for Project Sentinel.',
      explanation: `By inserting ../ sequences into the file parameter, you escaped the /var/sentinel/files/ directory and read an arbitrary file from the server. path.join() was used but the result was never verified to stay within the intended directory.

This attack can expose any file the web server can read — config files, private keys, /etc/passwd, source code, and more.

DEFENSE: After joining paths, always verify the resolved path starts with the expected base directory (use path.resolve() and check with startsWith). Use a whitelist of allowed files. Run the web server with minimal filesystem permissions.

MISSION COMPLETE: You've exposed MegaCorp's illegal surveillance program, Project Sentinel. The master key is in your hands. The truth is out.`,
    },
  },
];

function getStage(index) {
  return STAGES[index] || null;
}

function getStageCount() {
  return STAGES.length;
}

module.exports = { STAGES, getStage, getStageCount };
