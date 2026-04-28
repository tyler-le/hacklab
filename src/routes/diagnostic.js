const express = require('express');
const router = express.Router();

// Simulated filesystem for the "server"
const FAKE_FS = {
  '/var/www/megacorp': ['index.php', 'config.php', 'uploads/', 'logs/'],
  '/etc': ['crontab', 'hostname', 'hosts', 'passwd', 'resolv.conf', 'secrets/'],
  '/etc/secrets': ['api_keys.txt'],
  '/etc/secrets/api_keys.txt': [
    'AWS_SECRET_KEY=AKIA3R9F8GHSL29XKMP4',
    'STRIPE_LIVE_KEY=sk_live_4eC39HqLyjWDarjtT1',
    'DATABASE_URL=postgres://admin:S3cretP@ss!@prod-db:5432/megacorp',
  ].join('\n'),
  '/etc/passwd': [
    'root:x:0:0:root:/root:/bin/bash',
    'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
    'postgres:x:26:26:PostgreSQL Server:/var/lib/pgsql:/bin/bash',
  ].join('\n'),
};

function simulateCommand(cmd) {
  cmd = cmd.trim();

  if (cmd === 'whoami') return 'www-data';
  if (cmd === 'id') return 'uid=33(www-data) gid=33(www-data) groups=33(www-data)';
  if (cmd === 'pwd') return '/var/www/megacorp';
  if (cmd === 'hostname') return 'megacorp-web-01';
  if (cmd === 'uname -a') return 'Linux megacorp-web-01 5.15.0-generic #1 SMP x86_64 GNU/Linux';

  // ls command
  const lsMatch = cmd.match(/^ls\s*(.*)/);
  if (lsMatch) {
    const dir = lsMatch[1].trim() || '/var/www/megacorp';
    const contents = FAKE_FS[dir];
    if (contents && Array.isArray(contents)) return contents.join('  ');
    return `ls: cannot access '${dir}': No such file or directory`;
  }

  // cat command
  const catMatch = cmd.match(/^cat\s+(.*)/);
  if (catMatch) {
    const filePath = catMatch[1].trim();
    const content = FAKE_FS[filePath];
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.join('\n');
    return `cat: ${filePath}: No such file or directory`;
  }

  // env
  if (cmd === 'env' || cmd === 'printenv') {
    return 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin\nHOME=/var/www\nUSER=www-data';
  }

  return `sh: ${cmd.split(' ')[0]}: command not found`;
}

function parsePingInput(input) {
  // Split on command separators: ;, &&, ||, |
  const parts = input.split(/\s*(;|&&|\|\||\|)\s*/);
  const commands = [];
  let currentCmd = '';

  for (const part of parts) {
    if ([';', '&&', '||', '|'].includes(part)) {
      if (currentCmd.trim()) commands.push(currentCmd.trim());
      currentCmd = '';
    } else {
      currentCmd += part;
    }
  }
  if (currentCmd.trim()) commands.push(currentCmd.trim());

  return commands;
}

// POST /api/ping
// Simulated command injection — parses input for shell separators and simulates commands
router.post('/ping', (req, res) => {
  const { host } = req.body;
  if (!host || !host.trim()) {
    return res.json({ error: 'Please provide a hostname' });
  }

  const shellCmd = `ping -c 1 ${host}`;
  const hasSeparator = /[;&|]/.test(host);

  // Check win condition
  const hasCat = /\bcat\b/.test(host);
  const hasSecretFile = /\/etc\/secrets\/api_keys/.test(host);
  const stagePass = hasSeparator && hasCat && hasSecretFile;

  // Simulate ping output
  const commands = parsePingInput(host);
  const pingTarget = commands[0] || 'localhost';
  const isLocalhost = pingTarget === 'localhost' || pingTarget === '127.0.0.1';

  let pingOutput;
  if (isLocalhost) {
    pingOutput = [
      `PING localhost (127.0.0.1): 56 data bytes`,
      `64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.042 ms`,
      `--- ping statistics ---`,
      `1 packets transmitted, 1 received, 0% packet loss`,
    ].join('\n');
  } else {
    pingOutput = [
      `PING ${pingTarget}: 56 data bytes`,
      `Request timeout for icmp_seq 0`,
      `--- ping statistics ---`,
      `1 packets transmitted, 0 received, 100% packet loss`,
    ].join('\n');
  }

  // Simulate injected commands
  const injectedOutputs = [];
  if (hasSeparator && commands.length > 1) {
    for (let i = 1; i < commands.length; i++) {
      injectedOutputs.push(simulateCommand(commands[i]));
    }
  }

  res.json({
    command: shellCmd,
    pingOutput,
    injectedOutputs,
    hasSeparator,
    stagePass,
  });
});

module.exports = router;
