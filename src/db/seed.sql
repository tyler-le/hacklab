CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  email TEXT,
  department TEXT,
  api_key TEXT,
  ssh_access TEXT,
  db_access TEXT
);

INSERT INTO users VALUES
  (1, 'jsmith',  'p@ssw0rd123',   'employee', 'jsmith@megacorp.com',  'Sales',       NULL, NULL, NULL),
  (2, 'amendes', 'sunshine99',     'employee', 'amendes@megacorp.com', 'Marketing',   NULL, NULL, NULL),
  (3, 'kwilson', 'baseball2024',   'manager',  'kwilson@megacorp.com', 'Engineering', NULL, NULL, NULL),
  (4, 'admin',   'password123',    'admin',    'admin@megacorp.com',   'IT',
     'sk-megacorp-9f3k2j5h8d', 'admin@10.0.0.2 (key-based)', 'root:M3g4C0rp!@db.internal:3306'),
  (5, 'dbrown',  'qwerty456',      'employee', 'dbrown@megacorp.com',  'HR',          NULL, NULL, NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT,
  detail TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
