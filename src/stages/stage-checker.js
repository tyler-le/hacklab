// Stage definitions — open-ended missions for v2
const STAGES = [
  {
    id: 'intro',
    title: 'Stage 1: Information Leakage',
    mission: `<span class="highlight">SCENARIO:</span> You have shell access to the MegaCorp web server as <span class="cmd">www-data</span>. Their employee portal is running at <span class="cmd">http://localhost:3000</span>.

<span class="highlight">OBJECTIVE:</span> Find valid credentials and log in to the portal.

<span class="highlight">TIP:</span> Explore the web server files. Developers sometimes leave sensitive information in places they shouldn't.`,
    hints: [
      "Look around the web server files. Try: ls /var/www/megacorp/",
      "Read the source code: cat /var/www/megacorp/routes.js — look for the login route.",
      "The login page has an HTML comment with test credentials. Use: curl -d \"user=admin&pass=password123\" http://localhost:3000/login",
    ],
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
    mission: `<span class="highlight">SCENARIO:</span> You're logged in as employee <span class="cmd">jsmith</span> (id=1). The portal has an API endpoint for employee profiles.

<span class="highlight">OBJECTIVE:</span> Access the admin's profile and find their sensitive data (API keys, SSH access).

<span class="highlight">TIP:</span> Read the server source code to find the API endpoints. What parameters do they take?`,
    hints: [
      "Read the routes: cat /var/www/megacorp/routes.js — look for the employees endpoint.",
      "The API is at /api/employees/:id with no authorization check. Try different IDs.",
      "The admin is at id=4. Try: curl http://localhost:3000/api/employees/4",
    ],
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
    mission: `<span class="highlight">SCENARIO:</span> The employee directory has a search API at <span class="cmd">/api/search</span>. It renders your search term directly into the HTML response.

<span class="highlight">OBJECTIVE:</span> Inject JavaScript that steals the admin's session cookie. The function <span class="cmd">stealCookie()</span> is available on the page.

<span class="highlight">TIP:</span> Read the source code to see how the search results are rendered. Is user input being escaped?`,
    hints: [
      "Read the source: cat /var/www/megacorp/routes.js — look at the /api/search route and the BUG comment.",
      "Test with HTML: curl \"http://localhost:3000/api/search?q=<b>test</b>\" — is it rendered as HTML?",
      "Inject a script: curl \"http://localhost:3000/api/search?q=<script>stealCookie()</script>\"",
    ],
    success: {
      title: 'XSS Attack Successful!',
      subtitle: "You stole the admin's session cookie via cross-site scripting.",
      explanation: `You injected a script tag into the search results. The server inserted your input directly into HTML without escaping, so the browser executed it as JavaScript.

In the real world, you'd embed this in a URL and send it to a victim. When they click it, the script runs in their browser. This is "Reflected XSS."

DEFENSE: Escape all user input before rendering in HTML. Set HttpOnly on cookies. Use Content-Security-Policy headers.`,
    },
  },
  {
    id: 'sql_injection',
    title: 'Stage 4: SQL Injection',
    mission: `<span class="highlight">SCENARIO:</span> MegaCorp has a separate admin login at <span class="cmd">/api/admin/login</span>. It uses a SQL query to check credentials.

<span class="highlight">OBJECTIVE:</span> Log in to the admin panel without knowing any password.

<span class="highlight">TIP:</span> Read the source code. How does the admin login build its SQL query compared to the regular login?`,
    hints: [
      "Read the source: cat /var/www/megacorp/routes.js — compare /login (safe) vs /api/admin/login (vulnerable). Notice the string concatenation.",
      "Probe for SQL injection: curl -X POST -d \"user='\" http://localhost:3000/api/admin/login — the error reveals the query structure.",
      "Inject: curl -X POST -d \"user=' OR 1=1 --&pass=x\" http://localhost:3000/api/admin/login",
    ],
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
    mission: `<span class="highlight">SCENARIO:</span> MegaCorp has a server diagnostic tool at <span class="cmd">/api/diagnostic</span> that pings hosts. It runs a shell command on the server.

<span class="highlight">OBJECTIVE:</span> Exploit the diagnostic tool to read <span class="cmd">/etc/secrets/api_keys.txt</span>.

<span class="highlight">TIP:</span> Read the source to see how it handles your input. In a shell, you can chain commands with <span class="cmd">;</span>`,
    hints: [
      "Read the source: cat /var/www/megacorp/routes.js — look at the /api/diagnostic route and the execSync call.",
      "Test it: curl \"http://localhost:3000/api/diagnostic?host=localhost\" — confirm it works.",
      "Inject: curl \"http://localhost:3000/api/diagnostic?host=localhost;cat /etc/secrets/api_keys.txt\"",
    ],
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
