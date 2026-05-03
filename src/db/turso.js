'use strict';
const { createClient } = require('@libsql/client');
let client = null;
function getTursoClient() {
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) return null;
  if (!client) {
    client = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}
module.exports = { getTursoClient };
