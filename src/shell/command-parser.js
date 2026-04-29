/**
 * Command parser — splits a command line into executable segments.
 * Handles: pipes (|), semicolons (;), && and ||, quoted strings.
 */

/**
 * Tokenize a raw command line into an array of tokens.
 * Respects single and double quotes.
 */
function tokenize(input) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch; // Keep quotes — splitArgs strips them later
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch; // Keep quotes
      continue;
    }

    if (!inSingle && !inDouble) {
      // Check for operators: ;, |, &&, ||
      if (ch === ';') {
        if (current) tokens.push(current);
        current = '';
        tokens.push(';');
        continue;
      }
      if (ch === '&' && input[i + 1] === '&') {
        if (current) tokens.push(current);
        current = '';
        tokens.push('&&');
        i++;
        continue;
      }
      if (ch === '|' && input[i + 1] === '|') {
        if (current) tokens.push(current);
        current = '';
        tokens.push('||');
        i++;
        continue;
      }
      if (ch === '|') {
        if (current) tokens.push(current);
        current = '';
        tokens.push('|');
        continue;
      }
    }

    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Parse a command line into a list of command segments.
 * Each segment: { command: string (trimmed), operator: string|null }
 * operator is what follows the command: ';', '&&', '||', '|', or null (last cmd).
 */
function parseCommandLine(input) {
  const tokens = tokenize(input);
  const segments = [];
  const operators = new Set([';', '&&', '||', '|']);

  let currentCmd = '';
  for (const token of tokens) {
    if (operators.has(token)) {
      segments.push({ command: currentCmd.trim(), operator: token });
      currentCmd = '';
    } else {
      currentCmd += token;
    }
  }
  if (currentCmd.trim()) {
    segments.push({ command: currentCmd.trim(), operator: null });
  }

  return segments;
}

/**
 * Split a single command string into argv (respecting quotes).
 */
function splitArgs(command) {
  const args = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

module.exports = { parseCommandLine, splitArgs };
