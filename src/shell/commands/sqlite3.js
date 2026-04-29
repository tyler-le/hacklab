/**
 * sqlite3 command — interactive SQL mode against the session database.
 * Entering sqlite3 switches the shell to SQL mode (prompt becomes "sqlite>").
 * Dot-commands: .tables, .schema [table], .quit
 */

const sessionManager = require('../../db/session-manager');

/**
 * Enter sqlite3 interactive mode.
 * Returns an initial banner. Subsequent commands go through executeSql().
 */
function sqlite3Enter(ctx, args) {
  const dbPath = args[0] || '/var/lib/megacorp/megacorp.db';

  // Validate path looks like the megacorp db
  if (!dbPath.includes('megacorp.db')) {
    return { stderr: `Error: unable to open database "${dbPath}": no such file` };
  }

  const db = sessionManager.getSession(ctx.sessionId);
  if (!db) {
    return { stderr: 'Error: unable to open database: session expired' };
  }

  ctx.sqliteMode = true;
  return {
    stdout: `SQLite version 3.39.0 2022-07-21\nEnter ".help" for usage hints.\nsqlite>`,
    sqliteMode: true,
  };
}

/**
 * Execute a command in sqlite3 mode.
 * Returns { stdout, stderr, query?, queryResult?, exitSqlite? }
 */
function executeSql(ctx, input) {
  const trimmed = input.trim();

  if (!trimmed) return { stdout: '', sqliteMode: true };

  // Dot-commands
  if (trimmed === '.quit' || trimmed === '.exit') {
    ctx.sqliteMode = false;
    return { stdout: '', exitSqlite: true };
  }

  if (trimmed === '.help') {
    return {
      stdout: [
        '.help          Show this help',
        '.tables        List all tables',
        '.schema TABLE  Show CREATE statement for TABLE',
        '.quit          Exit sqlite3',
      ].join('\n'),
      sqliteMode: true,
    };
  }

  if (trimmed === '.tables') {
    const db = sessionManager.getSession(ctx.sessionId);
    if (!db) return { stderr: 'Error: session expired', sqliteMode: true };

    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      return {
        stdout: tables.map(t => t.name).join('  '),
        query: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        sqliteMode: true,
      };
    } catch (e) {
      return { stderr: `Error: ${e.message}`, sqliteMode: true };
    }
  }

  const schemaMatch = trimmed.match(/^\.schema\s+(\w+)$/);
  if (schemaMatch) {
    const tableName = schemaMatch[1];
    const db = sessionManager.getSession(ctx.sessionId);
    if (!db) return { stderr: 'Error: session expired', sqliteMode: true };

    try {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
      if (!row) return { stderr: `Error: no such table: ${tableName}`, sqliteMode: true };
      return {
        stdout: row.sql + ';',
        query: `SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`,
        sqliteMode: true,
      };
    } catch (e) {
      return { stderr: `Error: ${e.message}`, sqliteMode: true };
    }
  }

  // Regular SQL
  const db = sessionManager.getSession(ctx.sessionId);
  if (!db) return { stderr: 'Error: session expired', sqliteMode: true };

  const sql = trimmed.endsWith(';') ? trimmed : trimmed + ';';
  const rawSql = sql.replace(/;$/, '');

  try {
    if (/^\s*(SELECT|PRAGMA)/i.test(rawSql)) {
      const rows = db.prepare(rawSql).all();
      if (rows.length === 0) return { stdout: '', query: rawSql, queryResult: { columns: [], rows: [] }, sqliteMode: true };

      const columns = Object.keys(rows[0]);
      const dataRows = rows.map(r => columns.map(c => r[c]));

      // Format as pipe-separated table
      const header = columns.join('|');
      const body = dataRows.map(r => r.join('|')).join('\n');

      return {
        stdout: header + '\n' + body,
        query: rawSql,
        queryResult: { columns, rows: dataRows },
        sqliteMode: true,
      };
    } else {
      // Non-SELECT (INSERT, UPDATE, DELETE, etc.)
      const result = db.prepare(rawSql).run();
      return {
        stdout: result.changes > 0 ? `Changes: ${result.changes}` : '',
        query: rawSql,
        sqliteMode: true,
      };
    }
  } catch (e) {
    return { stderr: `Error: ${e.message}`, query: rawSql, sqliteMode: true };
  }
}

module.exports = { sqlite3Enter, executeSql };
