// Stage definitions with metadata and completion checks
const STAGES = [
  {
    id: 'intro',
    title: 'Stage 1: Information Leakage',
    mission: `<span class="highlight">OBJECTIVE:</span> Log in to the MegaCorp employee portal.

Welcome, recruit! You've been hired to pen-test MegaCorp's security. Start by poking around their portal — see what information is publicly exposed.

<span class="highlight">COMMANDS:</span>
  <span class="cmd">login [username] [password]</span>  - attempt to log in
  <span class="cmd">view-source</span>                  - view the page source code
  <span class="cmd">help</span>                         - show available commands
  <span class="cmd">hint</span>                         - get a hint

<span class="highlight">TIP:</span> Before trying to break in, look around. Developers sometimes leave sensitive info where it shouldn't be. Try <span class="cmd">view-source</span> to inspect the page.`,
    hints: [
      "Try the view-source command to look at the login page's HTML.",
      "Developers sometimes leave comments in HTML with useful information...",
      "The source code contains: <!-- default test account: admin / password123 -->",
    ],
    success: {
      title: 'Information Leakage Exploited!',
      subtitle: 'You found credentials hidden in the page source code.',
      explanation: `You found credentials in an HTML comment. This is information leakage — sensitive data exposed in places anyone can look.

Anyone can right-click "View Source" on any webpage. Comments, hidden fields, and JS source code are all sent to the browser — they're not secret.

DEFENSE: Never put secrets in client-side code. Use environment variables and strip comments from production builds.`,
    },
    helpCommands: [
      { cmd: 'login [user] [pass]', desc: 'Attempt login' },
      { cmd: 'view-source', desc: 'View page source code' },
    ],
  },
  {
    id: 'idor',
    title: 'Stage 2: Broken Access Control',
    mission: `<span class="highlight">OBJECTIVE:</span> Access another employee's profile to find sensitive data.

You're now logged into the MegaCorp portal as <span class="cmd">jsmith</span>. You can see your own employee profile at:
<span class="cmd">portal.megacorp.local/profile?id=1</span>

Notice the <span class="cmd">id=1</span> in the URL. That's your user ID. What happens if you change it?

<span class="highlight">COMMANDS:</span>
  <span class="cmd">visit [url]</span>  - visit a URL on the portal
  <span class="cmd">help</span>        - show available commands
  <span class="cmd">hint</span>        - get a hint

<span class="highlight">TIP:</span> Switch to the <span class="cmd">Browser</span> tab to use the URL bar, or type <span class="cmd">visit /profile?id=1</span> in the terminal.
Try other IDs. The admin account might have some interesting info...`,
    hints: [
      "Try visiting profiles with different IDs: visit /profile?id=2, visit /profile?id=3, etc.",
      "There are 5 employees. The admin account has a special ID — try them all.",
      "The admin is at id=4. Try: visit /profile?id=4",
    ],
    success: {
      title: 'Broken Access Control Exploited!',
      subtitle: "You accessed the admin's profile by changing a URL parameter.",
      explanation: `You changed id=1 to id=4 in the URL and the server returned the admin's profile — it never checked if you were authorized to view it.

This is called IDOR (Insecure Direct Object Reference), the #1 most common web vulnerability per OWASP. Sequential IDs make it trivial to enumerate every record.

DEFENSE: Always check authorization on every request. Use random UUIDs instead of sequential IDs.`,
    },
    helpCommands: [
      { cmd: 'visit [url]', desc: 'Visit a URL on the portal' },
    ],
  },
  {
    id: 'xss',
    title: 'Stage 3: Cross-Site Scripting (XSS)',
    mission: `<span class="highlight">OBJECTIVE:</span> Steal the admin's session cookie using XSS.

MegaCorp's employee directory has a search feature. When you search for something, the page displays:
<span class="cmd">"Showing results for: [YOUR SEARCH TERM]"</span>

Your search term is placed directly into the HTML — without any sanitization. That means if you type HTML or JavaScript, the browser will execute it.

<span class="highlight">HOW THIS LEADS TO COOKIE THEFT:</span>
  1. You craft a search URL containing a <span class="cmd">&lt;script&gt;</span> tag
  2. You send that URL to the admin (via email, chat, etc.)
  3. When the admin clicks it, the script runs in THEIR browser
  4. The script reads THEIR cookies and sends them to you
  5. You use their session cookie to impersonate them

For this exercise, inject a script that calls <span class="cmd">stealCookie()</span> — this simulates sending the admin's cookie to your server.

<span class="highlight">COMMANDS:</span>
  <span class="cmd">search [term]</span>  - search the employee directory
  <span class="cmd">help</span>          - show available commands
  <span class="cmd">hint</span>          - get a hint

<span class="highlight">TIP:</span> Try searching for <span class="cmd">&lt;b&gt;test&lt;/b&gt;</span> first. Does the page render it as bold text, or show it as plain text?`,
    hints: [
      "Try: search <b>test</b> — if the page renders it as bold, the page doesn't sanitize HTML input.",
      "Now try a script tag: search &lt;script&gt;alert('xss')&lt;/script&gt; — does it execute?",
      "Try: search &lt;script&gt;stealCookie()&lt;/script&gt;",
    ],
    success: {
      title: 'XSS Attack Successful!',
      subtitle: "You stole the admin's session cookie via cross-site scripting.",
      explanation: `You injected &lt;script&gt;stealCookie()&lt;/script&gt; into the search field. The page displayed it without sanitizing, so the browser executed it as real JavaScript.

In the real world, you'd embed this in a URL and send it to a victim. When they click it, the script runs in their browser and sends their session cookie to you. This is "Reflected XSS."

DEFENSE: Escape all user input before rendering in HTML. Set HttpOnly on cookies. Use Content-Security-Policy headers.`,
    },
    helpCommands: [
      { cmd: 'search [term]', desc: 'Search the employee directory' },
    ],
  },
  {
    id: 'sql_injection',
    title: 'Stage 4: SQL Injection',
    mission: `<span class="highlight">OBJECTIVE:</span> Use SQL injection to log in without knowing any password.

MegaCorp's login form sends your input directly into a SQL query:
<span class="cmd">SELECT * FROM users WHERE username='[INPUT]' AND password='[INPUT]'</span>

Your input gets pasted between the quotes. The app then checks: "did the query return at least one user?" If yes, it logs you in as that user. It assumes the only way to get a result is with correct credentials — but what if you could rewrite the query itself?

<span class="highlight">HOW THE LOGIN WORKS:</span>
  1. You type a username and password
  2. Your input is inserted into the SQL query above
  3. The database runs the query
  4. If any rows come back → you're logged in as the first result
  5. If no rows → "access denied"

The key insight: your input isn't just data — it becomes part of the SQL command. If you can break out of the quotes, you can change what the query does.

<span class="highlight">COMMANDS:</span>
  <span class="cmd">login [username]</span>  - attempt to log in
  <span class="cmd">help</span>              - show available commands
  <span class="cmd">hint</span>              - get a hint

<span class="highlight">STEP 1:</span> Try <span class="cmd">login '</span> — type just a single quote as the username. What does the error tell you about how your input is used?

<span class="highlight">STEP 2:</span> Now think: the query checks username AND password. What if you could make the WHERE clause return true without needing either? Try closing the string with <span class="cmd">'</span>, adding <span class="cmd">OR 1=1</span> (always true), and <span class="cmd">--</span> to comment out the rest.`,
    hints: [
      "First, probe: try login ' — the error reveals the query structure.",
      "The query is: SELECT * FROM users WHERE username='INPUT' AND password='INPUT'. You control INPUT. What if your input closed the quote early and added OR 1=1?",
      "Try: login ' OR 1=1 --\nThe ' closes the username string. OR 1=1 makes it always true. -- comments out the rest.",
    ],
    success: {
      title: 'Authentication Bypassed!',
      subtitle: 'You logged in without knowing any password using SQL injection.',
      explanation: `Your input ' OR 1=1 -- turned the query into:
  SELECT * FROM users WHERE username='' OR 1=1 --' AND password=''

The ' closes the string, OR 1=1 is always true, and -- comments out the password check. The database returns all users and the app logs you in as the first one.

DEFENSE: Use parameterized queries — never concatenate user input into SQL.`,
    },
    helpCommands: [
      { cmd: 'login [username]', desc: 'Attempt login' },
    ],
  },
  {
    id: 'command_injection',
    title: 'Stage 5: Command Injection',
    mission: `<span class="highlight">OBJECTIVE:</span> Exploit a server diagnostic tool to read a secret file.

MegaCorp has a "Server Health" page that lets admins ping hosts to check if they're online. The tool runs a system command on the server:

<span class="cmd">ping -c 1 [YOUR INPUT]</span>

Your input goes directly into a shell command. Sound familiar? Just like SQL injection put your input into a query, this puts your input into a terminal command.

<span class="highlight">COMMANDS:</span>
  <span class="cmd">ping [host]</span>    - run the server diagnostic tool
  <span class="cmd">help</span>           - show available commands
  <span class="cmd">hint</span>           - get a hint

<span class="highlight">STEP 1:</span> Try <span class="cmd">ping localhost</span> — confirm the tool works normally.

<span class="highlight">STEP 2:</span> In a terminal, you can chain commands with <span class="cmd">;</span> or <span class="cmd">&&</span>. What if your input wasn't just a hostname?

<span class="highlight">GOAL:</span> There's a file at <span class="cmd">/etc/secrets/api_keys.txt</span> on the server. Read it.`,
    hints: [
      "Start with: ping localhost — confirm the tool works. Notice how your input becomes part of a shell command.",
      "In a shell, ; lets you run a second command after the first. Try: ping localhost; whoami",
      "Now read the file: ping localhost; cat /etc/secrets/api_keys.txt",
    ],
    success: {
      title: 'Command Injection Successful!',
      subtitle: 'You executed arbitrary commands on the server and stole secret API keys.',
      explanation: `The ; character tells the shell to run a second command. Your input turned the server command into:
  ping -c 1 localhost; cat /etc/secrets/api_keys.txt

The server expected a hostname but you injected a full shell command. This is the most dangerous class of vulnerability — it gives an attacker direct access to the server.

DEFENSE: Never pass user input to shell commands. Use language-native libraries instead.

Congratulations — you've completed all 5 stages of HackLab!`,
    },
    helpCommands: [
      { cmd: 'ping [host]', desc: 'Run server diagnostic tool' },
    ],
  },
];

function getStage(index) {
  return STAGES[index] || null;
}

function getStageCount() {
  return STAGES.length;
}

module.exports = { STAGES, getStage, getStageCount };
