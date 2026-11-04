-- Staff confirm or decline shifts RSS assigns to them; record who declined; owner overrides carried to confirmation.
ALTER TABLE shifts ADD COLUMN assigned_at TEXT;
ALTER TABLE shifts ADD COLUMN declined TEXT;
ALTER TABLE shifts ADD COLUMN override_by TEXT;

-- Academic and professional qualifications (e.g. BA, MSc, PGCE), completed or in progress.
CREATE TABLE quals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL REFERENCES users(email),
  level TEXT NOT NULL,
  subject TEXT NOT NULL,
  institution TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed','in_progress')),
  year TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_quals_email ON quals(email);

-- Staff headshots, so nurseries can confirm the person arriving is the person RSS booked.
CREATE TABLE photos (
  email TEXT PRIMARY KEY REFERENCES users(email),
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
