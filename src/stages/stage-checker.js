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
  // PIXELMART SECURITY REVIEW — Advanced Pack (Stages 6–10)
  // ============================================================
  {
    id: 'price_tamper',
    title: 'Stage 6: Price Manipulation',
    mission: `<span class="highlight">SCENARIO:</span> MegaCorp just acquired <span class="cmd">PixelMart</span>, a rushed e-commerce startup. Their dev team cut corners — and it shows.

<span class="highlight">OBJECTIVE:</span> Buy a Laptop Pro for just $0.01. Find the Transaction ID on the confirmation page and <span class="cmd">submit</span> it.

<span class="highlight">TIP:</span> Browse to <span class="cmd">/shop</span> to start shopping.`,
    hints: [
      'Read the source: cat /var/www/pixelmart/routes.js — the /shop/orders route reads price directly from req.body without validation.',
      'Add the Laptop Pro to your cart at /shop, then open the Request Builder tab. Send POST /shop/orders with the item and price fields.',
      'Exploit: curl -X POST http://portal.megacorp.internal/shop/orders -d "item=Laptop+Pro&price=0.01&quantity=1"',
    ],
    flagPrompt: 'Enter the Transaction ID from the order confirmation...',
    success: {
      title: 'Price Manipulation Successful!',
      subtitle: 'You bought a $999 laptop for $0.01 by sending your own price.',
      explanation: `The checkout endpoint read the price directly from the POST body — whatever you sent, the server accepted. This is "client-side trust": the server assumes the browser is honest.

This vulnerability appears in real e-commerce systems. Attackers intercept checkout requests with a proxy (Burp Suite) and change the price field before it reaches the server.

DEFENSE: Never trust client-supplied prices. Look up the price server-side from your product database using the item name/ID. Only use the client-submitted item identifier, never the price.`,
    },
  },
  {
    id: 'path_traversal',
    title: 'Stage 7: Directory Traversal',
    mission: `<span class="highlight">SCENARIO:</span> PixelMart serves product images via <span class="cmd">/shop/image?file=</span> — but the file parameter is never validated against the intended directory.

<span class="highlight">OBJECTIVE:</span> Read the admin credentials file. The flag is inside it.

<span class="highlight">TIP:</span> Browse to <span class="cmd">/shop/catalog</span> and read the source code to understand how images are served.`,
    hints: [
      'cat /var/www/pixelmart/routes.js — look at how the image path is constructed. Is the resolved path ever validated?',
      'The file parameter is appended to a base directory. Use ../ sequences to walk up and out of it.',
      'Once you know the base directory, figure out what directory sits next to it that might contain sensitive files.',
    ],
    flagPrompt: 'Enter the flag from the admin credentials file...',
    success: {
      title: 'Directory Traversal Successful!',
      subtitle: 'You escaped the image directory and read admin credentials.',
      explanation: `By inserting ../../ into the file parameter, you walked up the directory tree from /var/pixelmart/images/ to /var/pixelmart/admin/credentials.json. The server never checked whether the resolved path stayed within the intended base directory.

This attack can read any file the web server process has permission to access — config files, private keys, /etc/passwd, and more.

DEFENSE: After joining paths with path.join(), always call path.resolve() and verify the result starts with your expected base directory. Reject any request where it doesn't.`,
    },
  },
  {
    id: 'file_upload',
    title: 'Stage 8: File Upload Bypass',
    mission: `<span class="highlight">SCENARIO:</span> PixelMart's seller portal at <span class="cmd">/shop/upload</span> lets sellers upload product images. The server blocks <span class="cmd">.php</span>, <span class="cmd">.js</span>, and <span class="cmd">.sh</span> extensions — but the check is case-sensitive.

<span class="highlight">OBJECTIVE:</span> Upload a file with a <span class="cmd">.PHP</span> extension (uppercase) to bypass the filter. The server will execute it and show you the flag.

<span class="highlight">TIP:</span> Visit <span class="cmd">/shop/upload</span> in the Browser tab to see the upload form. Read <span class="cmd">routes.js</span> to understand exactly what the filter checks.`,
    hints: [
      'Read the source: cat /var/www/pixelmart/routes.js — the denylist check uses endsWith(".php") which is case-sensitive.',
      'Visit /shop/upload in the Browser tab and try uploading shell.php — it gets blocked. Now try shell.PHP.',
      'Exploit: curl -X POST http://portal.megacorp.internal/shop/upload -d "filename=shell.PHP&content=test"',
    ],
    flagPrompt: 'Enter the flag from the upload execution output...',
    success: {
      title: 'File Upload Bypass Successful!',
      subtitle: 'You bypassed the extension filter using uppercase to achieve code execution.',
      explanation: `The server blocked .php, .js, and .sh using a case-sensitive string comparison — endsWith('.php') does not match .PHP. The uploaded file was then served directly and executed.

This is a classic bypass. Real-world filters must lowercase the filename before checking, or better yet, use an allowlist of safe extensions (.jpg, .png, .gif) instead of a denylist of dangerous ones.

DEFENSE: Lowercase the entire filename before extension checking. Use an allowlist, not a denylist. Store uploads outside the web root so they can never be executed, and randomize filenames on the server.`,
    },
  },
  {
    id: 'mass_assign',
    title: 'Stage 9: Mass Assignment',
    mission: `<span class="highlight">SCENARIO:</span> PixelMart's registration API at <span class="cmd">/shop/register</span> uses <span class="cmd">Object.assign({}, req.body)</span> — every POST field is blindly copied to the user object, including <span class="cmd">role</span>.

<span class="highlight">OBJECTIVE:</span> Register with <span class="cmd">role=admin</span> in your POST body to get admin access. Then visit <span class="cmd">/shop/admin</span> to find the flag.

<span class="highlight">TIP:</span> Visit <span class="cmd">/shop/register</span> in the Browser tab to see the form. Read <span class="cmd">routes.js</span> to spot the dangerous Object.assign call.`,
    hints: [
      'Read the source: cat /var/www/pixelmart/routes.js — Object.assign(user, req.body) copies all POST fields including hidden ones like role.',
      'Visit /shop/register in the Browser tab. The form has username, password, email — but you can send extra fields via curl.',
      'Exploit: curl -X POST http://portal.megacorp.internal/shop/register -d "username=hacker&password=test&email=h@x.com&role=admin"',
    ],
    flagPrompt: 'Enter the Admin Access Token from the admin panel...',
    success: {
      title: 'Mass Assignment Exploited!',
      subtitle: 'You registered as admin by injecting the role field.',
      explanation: `The registration endpoint used Object.assign to copy all POST body fields onto the user object. Since role was never explicitly excluded, sending role=admin in the POST body set your account to admin — a privilege the form never offered.

Mass assignment vulnerabilities are common in frameworks that auto-bind request parameters to model objects (Rails, Laravel, Django, etc.).

DEFENSE: Explicitly whitelist allowed fields when creating objects from user input: const user = { username: body.username, password: body.password, email: body.email }. Never use Object.assign or spread operators directly with untrusted input.`,
    },
  },
  {
    id: 'reset_poison',
    title: 'Stage 10: Password Reset Poisoning',
    mission: `<span class="highlight">SCENARIO:</span> PixelMart's password reset at <span class="cmd">/shop/reset</span> builds the reset URL using the HTTP <span class="cmd">Host</span> header from the request. An attacker can inject a fake host to poison the reset link.

<span class="highlight">OBJECTIVE:</span> Send a reset request for <span class="cmd">admin@pixelmart.com</span> with a spoofed <span class="cmd">Host: evil.com</span> header. The email preview will show the poisoned link — find the flag there.

<span class="highlight">TIP:</span> Use <span class="cmd">-H "Host: evil.com"</span> in curl. Read <span class="cmd">routes.js</span> to see how the reset URL is constructed.`,
    hints: [
      'Read the source: cat /var/www/pixelmart/routes.js — the reset URL is built with req.headers.host, which the attacker controls.',
      'Visit /shop/reset in the Browser tab to see the reset form. The email preview panel shows exactly what would be emailed.',
      'Exploit: curl -X POST http://portal.megacorp.internal/shop/reset -d "email=admin@pixelmart.com" -H "Host: evil.com"',
    ],
    flagPrompt: 'Enter the Reset Token from the poisoned email preview...',
    success: {
      title: 'Password Reset Poisoning Successful!',
      subtitle: 'You redirected the admin reset link to your server.',
      explanation: `The reset endpoint built the password reset URL using the Host header from the HTTP request: http://\${req.headers.host}/shop/reset/confirm?token=... By sending Host: evil.com, you made the "email" contain a link to your own server. When the admin clicks it, they send you their valid reset token.

This is a real attack used to take over accounts at scale. The Host header is fully attacker-controlled.

DEFENSE: Never use the Host header to build URLs in security-critical flows. Hardcode the base URL in server configuration (process.env.BASE_URL) and use that instead.

MISSION COMPLETE: You've found every flaw in the PixelMart platform. Security review complete.`,
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
