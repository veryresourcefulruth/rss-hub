-- RSS hub: people, nurseries, compliance, shifts, timesheets, invoices.
-- Money is stored in pence. Times are UK local "HH:MM"; dates "YYYY-MM-DD".

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  invoice_email TEXT,
  charge_rate INTEGER NOT NULL DEFAULT 0,       -- pence per hour billed to the nursery
  payment_days INTEGER NOT NULL DEFAULT 14,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Everyone who signs in. role: owner | coordinator | manager | staff
CREATE TABLE users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','coordinator','manager','staff')),
  client_id INTEGER REFERENCES clients(id),     -- managers only
  phone TEXT,
  pay_rate INTEGER,                             -- staff only, pence per hour
  qual_level INTEGER NOT NULL DEFAULT 0,        -- staff: 0 none, 2, 3, 6 (degree/QTS)
  training_name TEXT,                           -- staff: name used on Childcare 101, if different
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- One row per compliance item per member of staff.
-- type: dbs | rtw | ref1 | ref2 | qual | pfa | safeguarding | id | terms
-- status: pending (uploaded/entered, not yet checked) | verified | rejected
CREATE TABLE checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL REFERENCES users(email),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ref TEXT,                 -- certificate number, share code, referee name, qualification title
  detail TEXT,              -- JSON for extra fields (e.g. update service, barred list, level)
  issued_on TEXT,
  expires_on TEXT,
  verified_by TEXT,
  verified_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (email, type)
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES checks(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX idx_docs_check ON documents(check_id);

-- status: requested (by a manager) | open (offered to staff) | filled | cancelled
-- timesheet: ts_status: none | submitted | approved | queried
CREATE TABLE shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  finish TEXT NOT NULL,
  break_min INTEGER NOT NULL DEFAULT 0,
  room TEXT,
  needs_l3 INTEGER NOT NULL DEFAULT 0,
  needs_pfa INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  offered_to TEXT,          -- JSON array of emails; null = all eligible staff
  worker_email TEXT REFERENCES users(email),
  charge_rate INTEGER,      -- pence/hour, copied from the nursery when filled
  pay_rate INTEGER,         -- pence/hour, copied from the worker when filled
  requested_by TEXT,
  created_at TEXT NOT NULL,
  filled_at TEXT,
  cancelled_reason TEXT,
  ts_status TEXT NOT NULL DEFAULT 'none',
  act_start TEXT, act_finish TEXT, act_break INTEGER,
  ts_submitted_at TEXT,
  ts_approved_by TEXT, ts_approved_at TEXT,
  ts_comment TEXT,
  invoice_id INTEGER REFERENCES invoices(id),
  paid_export_at TEXT
);
CREATE INDEX idx_shifts_date ON shifts(date);
CREATE INDEX idx_shifts_worker ON shifts(worker_email, date);
CREATE INDEX idx_shifts_client ON shifts(client_id, date);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  net INTEGER NOT NULL,
  vat INTEGER NOT NULL,
  total INTEGER NOT NULL,
  vat_rate REAL NOT NULL,
  issued_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  created_by TEXT NOT NULL,
  void INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
