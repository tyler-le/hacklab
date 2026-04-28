// SQL Tokenizer and Display — VS Code Dark+ colors

const SQL_KEYWORDS = new Set([
  'SELECT','FROM','WHERE','AND','OR','NOT','IN','IS','NULL','LIKE',
  'BETWEEN','EXISTS','CASE','WHEN','THEN','ELSE','END','AS',
  'JOIN','INNER','LEFT','RIGHT','OUTER','CROSS','ON',
  'INSERT','INTO','VALUES','UPDATE','SET','DELETE','DROP',
  'CREATE','ALTER','TABLE','INDEX','VIEW','DATABASE',
  'UNION','ALL','DISTINCT','ORDER','BY','GROUP','HAVING',
  'LIMIT','OFFSET','ASC','DESC','TRUE','FALSE',
]);

const SQL_FUNCTIONS = new Set([
  'COUNT','SUM','AVG','MIN','MAX','COALESCE','IFNULL',
  'UPPER','LOWER','LENGTH','SUBSTR','TRIM','REPLACE',
  'CAST','CONVERT','DATE','NOW','CURRENT_TIMESTAMP',
]);

function tokenizeSql(sql) {
  const tokens = [];
  let i = 0;

  while (i < sql.length) {
    // Whitespace
    if (/\s/.test(sql[i])) {
      let start = i;
      while (i < sql.length && /\s/.test(sql[i])) i++;
      tokens.push({ type: 'whitespace', value: sql.slice(start, i) });
      continue;
    }
    // Comment
    if (sql[i] === '-' && sql[i+1] === '-') {
      let start = i;
      while (i < sql.length && sql[i] !== '\n') i++;
      tokens.push({ type: 'comment', value: sql.slice(start, i) });
      continue;
    }
    // String
    if (sql[i] === "'") {
      let start = i; i++;
      while (i < sql.length && sql[i] !== "'") i++;
      if (i < sql.length) i++;
      tokens.push({ type: 'string', value: sql.slice(start, i) });
      continue;
    }
    // Number
    if (/\d/.test(sql[i])) {
      let start = i;
      while (i < sql.length && /[\d.]/.test(sql[i])) i++;
      tokens.push({ type: 'number', value: sql.slice(start, i) });
      continue;
    }
    // Identifier / keyword
    if (/[a-zA-Z_]/.test(sql[i])) {
      let start = i;
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) i++;
      const word = sql.slice(start, i);
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) tokens.push({ type: 'keyword', value: word });
      else if (SQL_FUNCTIONS.has(upper)) tokens.push({ type: 'function', value: word });
      else tokens.push({ type: 'identifier', value: word });
      continue;
    }
    // Star
    if (sql[i] === '*') { tokens.push({ type: 'star', value: '*' }); i++; continue; }
    // Parens
    if (sql[i] === '(' || sql[i] === ')') { tokens.push({ type: 'paren', value: sql[i] }); i++; continue; }
    // Comma
    if (sql[i] === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue; }
    // Operators
    if (/[=<>!]/.test(sql[i])) {
      let start = i;
      while (i < sql.length && /[=<>!]/.test(sql[i])) i++;
      tokens.push({ type: 'operator', value: sql.slice(start, i) });
      continue;
    }
    // Default
    tokens.push({ type: 'default', value: sql[i] });
    i++;
  }
  return tokens;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function displayQuery(sql) {
  const tokens = tokenizeSql(sql);
  let highlighted = '';
  for (const t of tokens) {
    const escaped = escapeHtml(t.value);
    highlighted += `<span class="sql-${t.type}">${escaped}</span>`;
  }

  const lines = highlighted.split('\n');
  const lineNums = lines.map((_, i) => `<div>${i + 1}</div>`).join('');

  document.getElementById('queryDisplay').innerHTML =
    `<div class="editor-topbar"><span class="tab">query.sql</span><span>HackLab Monitor</span></div>` +
    `<div class="editor-body">` +
    `<div class="line-numbers">${lineNums}</div>` +
    `<div class="code-area">${highlighted}</div>` +
    `</div>`;
}

function displayResult(result) {
  const el = document.getElementById('queryResult');
  el.className = 'query-result';

  if (!result) {
    el.innerHTML = `<span style="color: var(--green-dim)">Query returned 0 rows.</span>`;
    return;
  }

  if (result.error) {
    el.className = 'query-result error';
    el.innerHTML = `<span style="color: var(--red)">${escapeHtml(result.error)}</span>`;
    return;
  }

  if (result.rows && result.rows.length > 0) {
    el.className = 'query-result success';
    const cols = result.cols || Object.keys(result.rows[0]);
    let html = '<table class="result-table"><thead><tr>';
    for (const c of cols) html += `<th>${escapeHtml(c)}</th>`;
    html += '</tr></thead><tbody>';
    for (const row of result.rows) {
      html += '<tr>';
      for (const c of cols) html += `<td>${escapeHtml(row[c] ?? '')}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
    return;
  }

  el.innerHTML = `<span style="color: var(--green-dim)">Query returned 0 rows.</span>`;
}
