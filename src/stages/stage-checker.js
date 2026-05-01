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
];

function getStage(index) {
  return STAGES[index] || null;
}

function getStageCount() {
  return STAGES.length;
}

module.exports = { STAGES, getStage, getStageCount };
